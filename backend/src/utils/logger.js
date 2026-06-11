// backend/src/utils/logger.js
import crypto from "crypto";
import net from "net";
import { pool } from "../config/db.js";

const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Aden";
const MAX_OBJECT_KEYS = 120;
const MAX_ARRAY_ITEMS = 120;
const MAX_STRING_LENGTH = 4000;

const SENSITIVE_KEY_PARTS = [
  "password",
  "passwd",
  "passcode",
  "pwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "credential",
  "api_key",
  "apikey",
  "private_key",
  "refresh_token",
  "access_token",
  "client_secret",
  "google_drive_refresh_token",
];

const ALLOWED_ACTIONS = new Set([
  "ACTIVITY",
  "VIEW",
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "APPROVE",
  "REJECT",
  "PUBLISH",
  "UNPUBLISH",
  "PRINT",
  "EXPORT",
  "IMPORT",
  "ISSUE",
  "CANCEL",
  "LOCK",
  "UNLOCK",
  "ACTIVATE",
  "DEACTIVATE",
  "RESTORE",
  "DOWNLOAD",
  "SEND",
  "SUBMIT",
  "TRANSFER",
  "DENY",
  "RESET",
]);

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function truncateString(value) {
  const text = String(value);
  if (text.length <= MAX_STRING_LENGTH) return text;
  return `${text.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

/**
 * ينظف البيانات قبل حفظها داخل سجل التدقيق:
 * - يمنع كلمات المرور والتوكنات والأسرار في أي مستوى متداخل.
 * - يحول BigInt والتواريخ إلى قيم قابلة للحفظ في JSON.
 * - يضع حدودًا لحجم السجل حتى لا تتضخم قاعدة البيانات بسبب طلب واحد كبير.
 */
export function cleanSensitiveData(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[max-depth]";

  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => cleanSensitiveData(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} items truncated]`);
    return items;
  }

  if (typeof value === "object") {
    const cleaned = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

    for (const [key, nestedValue] of entries) {
      if (isSensitiveKey(key)) continue;
      const cleanValue = cleanSensitiveData(nestedValue, depth + 1);
      if (cleanValue !== undefined) cleaned[key] = cleanValue;
    }

    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      cleaned.__truncated_keys = Object.keys(value).length - MAX_OBJECT_KEYS;
    }

    return cleaned;
  }

  return truncateString(value);
}

function comparable(value) {
  if (value && typeof value === "object") return JSON.stringify(cleanSensitiveData(value));
  return value;
}

export function calculateChangedFields(oldData, newData) {
  if (!oldData || !newData || typeof oldData !== "object" || typeof newData !== "object") {
    return [];
  }

  const oldClean = cleanSensitiveData(oldData);
  const newClean = cleanSensitiveData(newData);
  const allKeys = new Set([...Object.keys(oldClean), ...Object.keys(newClean)]);
  const changed = [];

  for (const key of allKeys) {
    if (comparable(oldClean[key]) !== comparable(newClean[key])) changed.push(key);
  }

  return changed;
}

function normalizeAction(action) {
  const normalized = String(action || "ACTIVITY").trim().toUpperCase();
  return ALLOWED_ACTIONS.has(normalized) ? normalized : "ACTIVITY";
}

function toPositiveIntOrNull(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeIp(rawIp) {
  let ip = String(rawIp || "").trim();
  if (!ip) return "127.0.0.1";
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip === "::1" || ip === "localhost") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return net.isIP(ip) ? ip : "127.0.0.1";
}

function getDeviceInfo(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (ua.includes("tablet") || ua.includes("ipad") || ua.includes("playbook") || ua.includes("silk")) {
    return "Tablet";
  }
  if (ua.includes("mobi") || ua.includes("iphone") || ua.includes("android") || ua.includes("windows phone")) {
    return "Mobile";
  }
  return "Desktop";
}

function extractToken(req) {
  if (!req) return null;

  const cookieHeader = req.headers?.cookie || "";
  if (cookieHeader) {
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]*)/);
    if (tokenMatch) return decodeURIComponent(tokenMatch[1]);
  }

  const authHeader = req.headers?.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]?.trim() : null;
}

function hashSessionToken(token) {
  if (!token) return null;
  return crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);
}

export function getReqMeta(req) {
  if (!req) {
    return {
      ipAddress: "127.0.0.1",
      userAgent: null,
      sessionId: null,
      deviceInfo: "Desktop",
    };
  }

  const forwardedFor = req.headers?.["x-forwarded-for"];
  const ipAddress = normalizeIp(
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
      req.ip ||
      req.socket?.remoteAddress ||
      "127.0.0.1"
  );

  const userAgent = req.headers?.["user-agent"] || null;
  return {
    ipAddress,
    userAgent,
    sessionId: hashSessionToken(extractToken(req)),
    deviceInfo: getDeviceInfo(userAgent),
  };
}

function zonedDateTimeParts(date = new Date(), timeZone = APP_TIMEZONE) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      eventDate: `${values.year}-${values.month}-${values.day}`,
      eventTime: `${values.hour}:${values.minute}:${values.second}`,
    };
  } catch {
    return {
      eventDate: date.toISOString().slice(0, 10),
      eventTime: date.toISOString().slice(11, 19),
    };
  }
}

function jsonOrNull(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(cleanSensitiveData(value));
}

function markAuditLogged(req, auditId) {
  if (!req) return;
  req.auditLogged = true;
  if (!Array.isArray(req.auditLogIds)) req.auditLogIds = [];
  if (auditId !== null && auditId !== undefined) req.auditLogIds.push(String(auditId));
}

/**
 * تسجيل حدث مفصل داخل activity_logs مع تعبئة الأعمدة الحديثة والقديمة معًا.
 * تم الحفاظ على أسماء الوسائط القديمة حتى تبقى الاستدعاءات الحالية متوافقة.
 */
export async function logActivity({
  req = null,
  school_id = null,
  schoolId = null,
  user_id = null,
  userId = null,
  user_name = null,
  userName = null,
  user_role = null,
  userRole = null,
  action = "ACTIVITY",
  action_label = null,
  actionLabel = null,
  module = null,
  module_label = null,
  moduleLabel = null,
  table_name = null,
  tableName = null,
  record_id = null,
  recordId = null,
  resource_type = null,
  resource_id = null,
  entity_type = null,
  entity_id = null,
  description = "",
  details = {},
  metadata = {},
  changes = {},
  old_data = null,
  oldData = null,
  new_data = null,
  newData = null,
  changed_fields = null,
  changedFields = null,
  reason = null,
  severity = null,
  result = null,
  event_key = null,
  eventKey = null,
  path = null,
  method = null,
  status_code = null,
  statusCode = null,
} = {}) {
  try {
    const finalSchoolId =
      toPositiveIntOrNull(school_id) ||
      toPositiveIntOrNull(schoolId) ||
      toPositiveIntOrNull(req?.user?.school_id) ||
      toPositiveIntOrNull(req?.user?.school?.id) ||
      toPositiveIntOrNull(req?.schoolId) ||
      toPositiveIntOrNull(req?.school_id);

    if (!finalSchoolId) return null;

    const finalUserId =
      toPositiveIntOrNull(user_id) ||
      toPositiveIntOrNull(userId) ||
      toPositiveIntOrNull(req?.user?.id) ||
      toPositiveIntOrNull(req?.user?.user_id);

    const actionValue = normalizeAction(action);
    const finalActionLabel = toTextOrNull(action_label) || toTextOrNull(actionLabel);
    const finalModule =
      toTextOrNull(module) || toTextOrNull(resource_type) || toTextOrNull(entity_type) || "System";
    const finalModuleLabel = toTextOrNull(module_label) || toTextOrNull(moduleLabel);
    const finalTableName = toTextOrNull(table_name) || toTextOrNull(tableName) || toTextOrNull(entity_type);
    const finalRecordId =
      toPositiveIntOrNull(record_id) ||
      toPositiveIntOrNull(recordId) ||
      toPositiveIntOrNull(resource_id) ||
      toPositiveIntOrNull(entity_id);

    const finalResourceType = toTextOrNull(resource_type) || toTextOrNull(entity_type) || finalTableName || finalModule;
    const finalEntityType = toTextOrNull(entity_type) || finalResourceType;
    const finalResourceId = toTextOrNull(resource_id) || (finalRecordId ? String(finalRecordId) : null);
    const finalEntityId = toPositiveIntOrNull(entity_id) || finalRecordId;

    const finalPath = toTextOrNull(path) || toTextOrNull(req?.originalUrl) || toTextOrNull(req?.url);
    const finalMethod = toTextOrNull(method) || toTextOrNull(req?.method);
    const finalStatusCode =
      toPositiveIntOrNull(status_code) ||
      toPositiveIntOrNull(statusCode) ||
      toPositiveIntOrNull(req?.res?.statusCode);

    const { ipAddress, userAgent, sessionId, deviceInfo } = getReqMeta(req);
    const finalUserName =
      toTextOrNull(user_name) ||
      toTextOrNull(userName) ||
      toTextOrNull(req?.user?.name) ||
      toTextOrNull(req?.user?.full_name) ||
      toTextOrNull(req?.user?.username) ||
      "النظام";
    const finalUserRole =
      toTextOrNull(user_role) ||
      toTextOrNull(userRole) ||
      toTextOrNull(req?.user?.role) ||
      toTextOrNull(req?.user?.role_name) ||
      "system";

    const cleanOld = cleanSensitiveData(old_data ?? oldData ?? changes?.before ?? null);
    const cleanNew = cleanSensitiveData(new_data ?? newData ?? changes?.after ?? null);
    const computedChangedFields =
      Array.isArray(changed_fields ?? changedFields)
        ? cleanSensitiveData(changed_fields ?? changedFields)
        : calculateChangedFields(cleanOld, cleanNew);

    const finalEventKey = toTextOrNull(event_key) || toTextOrNull(eventKey);
    const finalSeverity = toTextOrNull(severity) || toTextOrNull(metadata?.severity) || "normal";
    const finalResult =
      toTextOrNull(result) ||
      toTextOrNull(metadata?.result) ||
      (finalStatusCode && finalStatusCode >= 400 ? "failure" : "success");

    const finalMetadata = cleanSensitiveData({
      ...metadata,
      ...(finalEventKey ? { event_key: finalEventKey } : {}),
      severity: finalSeverity,
      result: finalResult,
      ...(finalModuleLabel ? { module_label: finalModuleLabel } : {}),
      request: {
        ...(metadata?.request || {}),
        ip_address: ipAddress,
        referer: req?.headers?.referer || null,
      },
    });

    const finalChanges = cleanSensitiveData({
      ...(changes || {}),
      ...(cleanOld !== null && cleanOld !== undefined ? { before: cleanOld } : {}),
      ...(cleanNew !== null && cleanNew !== undefined ? { after: cleanNew } : {}),
      ...(computedChangedFields.length ? { changed_fields: computedChangedFields } : {}),
    });

    const finalDescription =
      toTextOrNull(description) ||
      `${finalUserName} نفّذ عملية ${finalActionLabel || actionValue} في قسم ${finalModuleLabel || finalModule}`;

    const { eventDate, eventTime } = zonedDateTimeParts();

    const query = `
      INSERT INTO activity_logs (
        school_id,
        user_id,
        action,
        entity_type,
        entity_id,
        description,
        details,
        metadata,
        path,
        method,
        status_code,
        ip_address,
        user_agent,
        resource_type,
        resource_id,
        changes,
        user_name,
        user_role,
        action_label,
        module,
        table_name,
        record_id,
        old_data,
        new_data,
        changed_fields,
        reason,
        session_id,
        device_info,
        event_date,
        event_time
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7::jsonb, $8::jsonb, $9, $10, $11, $12::inet, $13,
        $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22,
        $23::jsonb, $24::jsonb, $25::jsonb, $26, $27, $28, $29::date, $30::time
      )
      RETURNING id
    `;

    const values = [
      finalSchoolId,
      finalUserId,
      actionValue,
      finalEntityType,
      finalEntityId,
      finalDescription,
      jsonOrNull(details) || "{}",
      jsonOrNull(finalMetadata) || "{}",
      finalPath,
      finalMethod,
      finalStatusCode,
      ipAddress,
      userAgent,
      finalResourceType,
      finalResourceId,
      jsonOrNull(finalChanges) || "{}",
      finalUserName,
      finalUserRole,
      finalActionLabel,
      finalModule,
      finalTableName,
      finalRecordId,
      jsonOrNull(cleanOld),
      jsonOrNull(cleanNew),
      computedChangedFields.length ? jsonOrNull(computedChangedFields) : null,
      toTextOrNull(reason),
      sessionId,
      deviceInfo,
      eventDate,
      eventTime,
    ];

    const dbResult = await pool.query(query, values);
    const auditId = dbResult.rows[0]?.id || null;
    markAuditLogged(req, auditId);
    return auditId;
  } catch (error) {
    console.error("Activity Logger Error:", error.message);
    return null;
  }
}

export default logActivity;
