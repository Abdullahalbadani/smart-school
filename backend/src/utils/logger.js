// backend/src/utils/logger.js
import { pool } from "../config/db.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "new_password",
  "old_password",
  "confirm_password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "Authorization",
]);

function normalizeAction(action) {
  const a = String(action || "ACTIVITY").trim().toUpperCase();
  const allowed = new Set([
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
    "ISSUE",
    "CANCEL",
    "LOCK",
    "UNLOCK",
    "ACTIVITY",
  ]);
  return allowed.has(a) ? a : "ACTIVITY";
}

function cleanSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSensitiveData);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (value && typeof value === "object") {
      cleaned[key] = cleanSensitiveData(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function calculateChangedFields(oldData, newData) {
  if (!oldData || !newData || typeof oldData !== "object" || typeof newData !== "object") {
    return [];
  }
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const changed = [];
  for (const key of allKeys) {
    const valOld = oldData[key];
    const valNew = newData[key];
    if (valOld && typeof valOld === "object" && valNew && typeof valNew === "object") {
      if (JSON.stringify(valOld) !== JSON.stringify(valNew)) {
        changed.push(key);
      }
    } else if (valOld !== valNew) {
      changed.push(key);
    }
  }
  return changed;
}

function getDeviceInfo(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (ua.includes("tablet") || ua.includes("ipad")) return "Tablet";
  if (ua.includes("mobi") || ua.includes("iphone") || ua.includes("android")) return "Mobile";
  return "Desktop";
}

function getReqMeta(req) {
  if (!req) return { ipAddress: "127.0.0.1", userAgent: null, sessionId: null, deviceInfo: "Desktop" };

  const forwardedFor = req.headers?.["x-forwarded-for"];
  let ipAddress =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "127.0.0.1";

  if (ipAddress === "::1" || ipAddress === "localhost") {
    ipAddress = "127.0.0.1";
  }
  if (ipAddress.includes(",")) {
    ipAddress = ipAddress.split(",")[0].trim();
  }

  const userAgent = req.headers?.["user-agent"] || null;
  const deviceInfo = getDeviceInfo(userAgent);

  let sessionId = null;
  const cookieHeader = req.headers?.cookie || "";
  let token = null;
  if (cookieHeader) {
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]*)/);
    if (tokenMatch) {
      token = decodeURIComponent(tokenMatch[1]);
    }
  }
  if (!token) {
    const authHeader = req.headers?.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    token = match ? match[1]?.trim() : null;
  }
  if (token) {
    sessionId = token.length > 20 ? token.substring(token.length - 20) : token;
  }

  return { ipAddress, userAgent, sessionId, deviceInfo };
}

function toIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toTextOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * تسجيل حدث إداري تفصيلي داخل activity_logs
 * متوافق بالكامل مع الأعمدة المحدثة والقديمة
 */
export async function logActivity({
  req = null,
  school_id = null,
  user_id = null,
  action = "ACTIVITY",
  resource_type = null,
  resource_id = null,
  entity_type = null,
  entity_id = null,
  description = "",
  details = {},
  metadata = {},
  changes = {},
  path = null,
  method = null,
  status_code = null,
} = {}) {
  try {
    const schoolId =
      toIntOrNull(school_id) ||
      toIntOrNull(req?.user?.school_id) ||
      toIntOrNull(req?.user?.school?.id);

    if (!schoolId) return null;

    const userId =
      toIntOrNull(user_id) ||
      toIntOrNull(req?.user?.id) ||
      toIntOrNull(req?.user?.user_id);

    const actionValue = normalizeAction(action);
    const finalPath = toTextOrNull(path) || toTextOrNull(req?.originalUrl) || toTextOrNull(req?.url);
    const finalMethod = toTextOrNull(method) || toTextOrNull(req?.method);
    const finalStatusCode = toIntOrNull(status_code) || toIntOrNull(req?.res?.statusCode);

    const { ipAddress, userAgent, sessionId, deviceInfo } = getReqMeta(req);

    // Dynamic user details
    const userName = req?.user?.name || req?.user?.username || "النظام";
    const userRole = req?.user?.role || "system";

    const now = new Date();
    const eventDate = now.toISOString().split("T")[0];
    const eventTime = now.toTimeString().split(" ")[0];

    const finalMetadata = {
      ...cleanSensitiveData(metadata),
      request: {
        ip_address: ipAddress,
        referer: req?.headers?.referer || null,
      },
    };

    const finalDescription =
      toTextOrNull(description) ||
      `${userName} ${actionValue === "CREATE" ? "أضاف" : actionValue === "UPDATE" ? "عدّل" : actionValue === "DELETE" ? "حذف" : "أجرى عملية"} في قسم ${resource_type || entity_type || "النظام"}`;

    const cleanOld = changes?.before ? cleanSensitiveData(changes.before) : null;
    const cleanNew = changes?.after ? cleanSensitiveData(changes.after) : null;
    const changedFields = (cleanOld && cleanNew) ? calculateChangedFields(cleanOld, cleanNew) : [];

    const query = `
      INSERT INTO activity_logs (
        school_id,
        user_id,
        user_name,
        user_role,
        action,
        action_label,
        module,
        table_name,
        record_id,
        old_data,
        new_data,
        changed_fields,
        description,
        details,
        metadata,
        changes,
        path,
        method,
        status_code,
        ip_address,
        user_agent,
        session_id,
        device_info,
        event_date,
        event_time
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12::jsonb,
        $13, $14::jsonb, $15::jsonb, $16::jsonb,
        $17, $18, $19, $20::inet, $21, $22, $23, $24::date, $25::time
      )
      RETURNING id
    `;

    const finalRecordId = toIntOrNull(resource_id) || toIntOrNull(entity_id);
    const finalModule = toTextOrNull(resource_type) || toTextOrNull(entity_type) || "System";
    const finalTableName = toTextOrNull(entity_type) || toTextOrNull(resource_type);

    const values = [
      schoolId,
      userId,
      userName,
      userRole,
      actionValue,
      null, // action_label can be null for auto logged
      finalModule,
      finalTableName,
      finalRecordId ? BigInt(finalRecordId) : null,
      cleanOld ? JSON.stringify(cleanOld) : null,
      cleanNew ? JSON.stringify(cleanNew) : null,
      changedFields.length > 0 ? JSON.stringify(changedFields) : null,
      finalDescription,
      JSON.stringify(cleanSensitiveData(details)),
      JSON.stringify(finalMetadata),
      JSON.stringify(cleanSensitiveData(changes)),
      finalPath,
      finalMethod,
      finalStatusCode,
      ipAddress,
      userAgent,
      sessionId,
      deviceInfo,
      eventDate,
      eventTime
    ];

    const result = await pool.query(query, values);
    return result.rows[0]?.id || null;
  } catch (error) {
    console.error("Activity Logger Error:", error.message);
    return null;
  }
}

export default logActivity;