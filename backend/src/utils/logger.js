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

  return allowed.has(a) ? a : a;
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

function safeJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out = {};

  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;

    if (val && typeof val === "object" && !Array.isArray(val)) {
      out[key] = safeJson(val);
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) => {
        if (item && typeof item === "object") return safeJson(item);
        return item;
      });
    } else {
      out[key] = val;
    }
  }

  return out;
}

function getReqMeta(req) {
  if (!req) return {};

  const forwardedFor = req.headers?.["x-forwarded-for"];
  const ipAddress =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  return safeJson({
    ip_address: ipAddress,
    referer: req.headers?.referer || req.headers?.referrer || null,
  });
}

/**
 * تسجيل حدث إداري تفصيلي داخل activity_logs
 *
 * أمثلة الاستخدام:
 * await logActivity({
 *   req,
 *   action: "UPDATE",
 *   resource_type: "attendance",
 *   resource_id: entryId,
 *   entity_type: "attendance_entry",
 *   entity_id: entryId,
 *   description: "عدّل حضور الطالب أحمد من غائب إلى حاضر",
 *   details: { student_name: "أحمد", section_name: "أ" },
 *   changes: { before: { status: "absent" }, after: { status: "present" } }
 * });
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

    const finalMetadata = {
      ...safeJson(metadata),
      request: {
        ...getReqMeta(req),
      },
    };

    const finalDescription =
      toTextOrNull(description) ||
      `${actionValue} على ${toTextOrNull(resource_type) || toTextOrNull(entity_type) || "system"}`;

    const query = `
      INSERT INTO activity_logs (
        school_id,
        user_id,
        action,
        entity_type,
        entity_id,
        resource_type,
        resource_id,
        description,
        details,
        metadata,
        changes,
        path,
        method,
        status_code,
        user_agent
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9::jsonb,
        $10::jsonb,
        $11::jsonb,
        $12,$13,$14,$15
      )
      RETURNING id
    `;

    const values = [
      schoolId,
      userId,
      actionValue,

      toTextOrNull(entity_type),
      toIntOrNull(entity_id),

      toTextOrNull(resource_type),
      resource_id === null || resource_id === undefined ? null : String(resource_id),

      finalDescription,

      JSON.stringify(safeJson(details)),
      JSON.stringify(finalMetadata),
      JSON.stringify(safeJson(changes)),

      finalPath,
      finalMethod,
      finalStatusCode,

      req?.headers?.["user-agent"] || null,
    ];

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  } catch (error) {
    console.error("Activity Logger Error:", error.message);
    return null;
  }
}

export default logActivity;