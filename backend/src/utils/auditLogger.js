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

  const oldCleaned = cleanSensitiveData(oldData);
  const newCleaned = cleanSensitiveData(newData);

  const allKeys = new Set([
    ...Object.keys(oldCleaned),
    ...Object.keys(newCleaned)
  ]);

  const changed = [];
  for (const key of allKeys) {
    const valOld = oldCleaned[key];
    const valNew = newCleaned[key];

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
  if (ua.includes("tablet") || ua.includes("ipad") || ua.includes("playbook") || ua.includes("silk")) {
    return "Tablet";
  }
  if (ua.includes("mobi") || ua.includes("iphone") || ua.includes("android") || ua.includes("windows phone")) {
    return "Mobile";
  }
  return "Desktop";
}

function getReqMeta(req) {
  if (!req) return { ipAddress: "127.0.0.1", userAgent: null, sessionId: null, deviceInfo: "Desktop" };

  // Safe IP Extraction
  const forwardedFor = req.headers?.["x-forwarded-for"];
  let ipAddress =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "127.0.0.1";

  if (ipAddress === "::1" || ipAddress === "localhost") {
    ipAddress = "127.0.0.1";
  }
  // If comma separated, take first
  if (ipAddress.includes(",")) {
    ipAddress = ipAddress.split(",")[0].trim();
  }

  const userAgent = req.headers?.["user-agent"] || null;
  const deviceInfo = getDeviceInfo(userAgent);

  // Extract Session ID from JWT Token signature or cookie header
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
    // Session is identified by the last 20 characters of the token signature
    sessionId = token.length > 20 ? token.substring(token.length - 20) : token;
  }

  return { ipAddress, userAgent, sessionId, deviceInfo };
}

/**
 * تسجيل حدث إداري تفصيلي شامل في جدول activity_logs
 */
export async function logAudit({
  req = null,
  action = "ACTIVITY",
  actionLabel = null,
  module = "System",
  tableName = null,
  recordId = null,
  oldData = null,
  newData = null,
  description = "",
  reason = null,
  schoolIdFallback = null,
  userIdFallback = null,
  userNameFallback = null,
  userRoleFallback = null
} = {}) {
  try {
    const schoolId =
      req?.user?.school_id ||
      schoolIdFallback ||
      null;

    if (!schoolId) {
      console.warn("[Audit Logger] Skipped: No school_id found");
      return null;
    }

    const userId = req?.user?.id || userIdFallback || null;
    const userName = req?.user?.name || req?.user?.username || userNameFallback || "النظام";
    const userRole = req?.user?.role || userRoleFallback || "system";

    const { ipAddress, userAgent, sessionId, deviceInfo } = getReqMeta(req);

    // Filter and compute data changes
    const cleanOld = oldData ? cleanSensitiveData(oldData) : null;
    const cleanNew = newData ? cleanSensitiveData(newData) : null;
    const changedFields = (cleanOld && cleanNew) ? calculateChangedFields(cleanOld, cleanNew) : [];

    const now = new Date();
    const eventDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const eventTime = now.toTimeString().split(" ")[0]; // HH:MM:SS

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
        reason,
        ip_address,
        user_agent,
        session_id,
        device_info,
        event_date,
        event_time
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12::jsonb,
        $13, $14, $15::inet, $16, $17, $18, $19::date, $20::time
      )
      RETURNING id
    `;

    const values = [
      schoolId,
      userId,
      userName,
      userRole,
      action.toUpperCase(),
      actionLabel,
      module,
      tableName,
      recordId ? BigInt(recordId) : null,
      cleanOld ? JSON.stringify(cleanOld) : null,
      cleanNew ? JSON.stringify(cleanNew) : null,
      changedFields.length > 0 ? JSON.stringify(changedFields) : null,
      description,
      reason,
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
    console.error("[Audit Logger] Error saving audit log:", error);
    return null;
  }
}

export default logAudit;
