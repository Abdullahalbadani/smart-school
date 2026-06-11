// backend/src/modules/notifications/notificationCreateService.js
import { pool } from "../../config/db.js";

const SENSITIVE_KEY_RE = /(password|passcode|token|secret|authorization|cookie|api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|jwt|session)/i;

function uniqueIntIds(ids = []) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];
}

function toPositiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} غير صالح`);
  }
  return number;
}

function toOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toNonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function limitText(value, maxLength, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maxLength);
}

function sanitizePriority(priority) {
  const normalized = String(priority || "normal").trim().toLowerCase();
  return ["normal", "important", "urgent"].includes(normalized)
    ? normalized
    : "normal";
}

function sanitizeSource(source) {
  const normalized = String(source || "system").trim().toLowerCase();
  return ["system", "manual"].includes(normalized) ? normalized : "system";
}

function sanitizeMetaValue(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (["number", "boolean"].includes(typeof value)) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeMetaValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, 100)) {
      output[key] = SENSITIVE_KEY_RE.test(key)
        ? "[REDACTED]"
        : sanitizeMetaValue(nestedValue, depth + 1);
    }
    return output;
  }

  return String(value).slice(0, 2000);
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return sanitizeMetaValue(meta);
}

async function validateSender({ client, senderUserId, schoolId }) {
  if (!senderUserId) return null;

  const { rows } = await client.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND school_id = $2
       AND COALESCE(status, 'active') = 'active'
     LIMIT 1`,
    [senderUserId, schoolId]
  );

  if (!rows.length) {
    throw new Error("المرسل غير موجود أو لا ينتمي إلى المدرسة الحالية");
  }

  return Number(rows[0].id);
}

async function validateRecipients({ client, recipientUserIds, schoolId }) {
  const requested = uniqueIntIds(recipientUserIds);
  if (!requested.length) return [];

  const { rows } = await client.query(
    `SELECT id
     FROM users
     WHERE id = ANY($1::int[])
       AND school_id = $2
       AND COALESCE(status, 'active') = 'active'`,
    [requested, schoolId]
  );

  return uniqueIntIds(rows.map((row) => row.id));
}

async function isRecentDuplicate({
  client,
  schoolId,
  source,
  title,
  body,
  relatedType = null,
  relatedId = null,
  recipientUserIds = [],
  dedupeWindowSeconds = 0,
}) {
  if (!dedupeWindowSeconds || dedupeWindowSeconds <= 0) return false;
  if (!recipientUserIds.length) return false;

  const { rowCount } = await client.query(
    `SELECT 1
     FROM notifications n
     JOIN notification_recipients nr
       ON nr.notification_id = n.id
      AND nr.school_id = n.school_id
     WHERE n.school_id = $1
       AND n.source = $2
       AND n.title = $3
       AND COALESCE(n.body, '') = COALESCE($4, '')
       AND COALESCE(n.related_type, '') = COALESCE($5, '')
       AND COALESCE(n.related_id, 0) = COALESCE($6, 0)
       AND nr.recipient_user_id = ANY($7::int[])
       AND nr.school_id = $1
       AND n.created_at >= now() - (($8)::text || ' seconds')::interval
     LIMIT 1`,
    [
      schoolId,
      source,
      title,
      body || "",
      relatedType,
      relatedId,
      recipientUserIds,
      Number(dedupeWindowSeconds),
    ]
  );

  return rowCount > 0;
}

function buildRealtimePayload({ notification, recipientRow }) {
  return {
    recipient_row_id: Number(recipientRow.id),
    id: Number(notification.id),
    school_id: Number(notification.school_id),
    source: notification.source,
    category: notification.category,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    sender_name: notification.sender_display_name || "النظام",
    created_at: notification.created_at,
    is_read: false,
    read_at: null,
    related:
      notification.related_type || notification.related_id
        ? {
            type: notification.related_type || null,
            id:
              notification.related_id != null
                ? Number(notification.related_id)
                : null,
            label: notification.meta?.related_label || null,
          }
        : null,
    meta: notification.meta || {},
  };
}

export function emitRealtimeToUsers(
  app,
  recipientsRows,
  notificationRow,
  { allowRealtime = true } = {}
) {
  const stats = {
    enabled: !!allowRealtime,
    attempted_users: 0,
    sent_users: 0,
    error: null,
  };

  if (!allowRealtime) return stats;

  try {
    const io = app?.get?.("io");
    if (!io) {
      stats.error = "io_not_found";
      return stats;
    }

    for (const recipientRow of recipientsRows || []) {
      const userId = Number(recipientRow.recipient_user_id);
      if (!Number.isInteger(userId) || userId <= 0) continue;

      stats.attempted_users += 1;
      const payload = buildRealtimePayload({
        notification: notificationRow,
        recipientRow,
      });

      io.to(`user_${userId}`).emit("notification:new", payload);
      io.to(`user_${userId}`).emit("notification:unread-count:refresh");
      stats.sent_users += 1;
    }

    return stats;
  } catch (error) {
    console.warn("emitRealtimeToUsers warning:", error.message);
    stats.error = error.message || "emit_failed";
    return stats;
  }
}

function skippedResult(reason) {
  return {
    success: true,
    skipped: true,
    reason,
    request_id: null,
    created_rows: 0,
    recipients_created: 0,
    realtime_sent: 0,
    realtime_sent_count: 0,
    notification: null,
    recipients: [],
  };
}

/**
 * Central notification creation service.
 * Enforces school isolation for the notification, sender and every recipient.
 */
export async function createNotification({
  app = null,
  schoolId,
  source = "system",
  category = "general",
  priority = "normal",
  title,
  body = "",
  senderUserId = null,
  senderDisplayName = null,
  relatedType = null,
  relatedId = null,
  meta = {},
  recipientUserIds = [],
  dedupeWindowSeconds = 0,
  allowRealtime = true,
}) {
  const normalizedSchoolId = toPositiveInt(schoolId, "schoolId");
  const requestedRecipients = uniqueIntIds(recipientUserIds);

  const normalized = {
    schoolId: normalizedSchoolId,
    source: sanitizeSource(source),
    category: limitText(category, 50, "general"),
    priority: sanitizePriority(priority),
    title: limitText(title, 500),
    body: limitText(body, 10000),
    senderUserId: toOptionalPositiveInt(senderUserId),
    senderDisplayName: senderDisplayName
      ? limitText(senderDisplayName, 250)
      : null,
    relatedType: relatedType ? limitText(relatedType, 100) : null,
    relatedId: toOptionalPositiveInt(relatedId),
    meta: safeMeta(meta),
    dedupeWindowSeconds: toNonNegativeInt(dedupeWindowSeconds, 0),
    allowRealtime: toBool(allowRealtime, true),
  };

  if (!normalized.title) throw new Error("title مطلوب");
  if (!requestedRecipients.length) return skippedResult("no_recipients");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await validateSender({
      client,
      senderUserId: normalized.senderUserId,
      schoolId: normalized.schoolId,
    });

    const recipients = await validateRecipients({
      client,
      recipientUserIds: requestedRecipients,
      schoolId: normalized.schoolId,
    });

    if (!recipients.length) {
      await client.query("ROLLBACK");
      return skippedResult("no_valid_recipients");
    }

    const duplicate = await isRecentDuplicate({
      client,
      schoolId: normalized.schoolId,
      source: normalized.source,
      title: normalized.title,
      body: normalized.body,
      relatedType: normalized.relatedType,
      relatedId: normalized.relatedId,
      recipientUserIds: recipients,
      dedupeWindowSeconds: normalized.dedupeWindowSeconds,
    });

    if (duplicate) {
      await client.query("ROLLBACK");
      return skippedResult("duplicate_recent");
    }

    const { rows: notificationRows } = await client.query(
      `INSERT INTO notifications (
         school_id,
         source,
         category,
         priority,
         title,
         body,
         sender_user_id,
         sender_display_name,
         related_type,
         related_id,
         meta
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING *`,
      [
        normalized.schoolId,
        normalized.source,
        normalized.category,
        normalized.priority,
        normalized.title,
        normalized.body,
        normalized.senderUserId,
        normalized.senderDisplayName,
        normalized.relatedType,
        normalized.relatedId,
        JSON.stringify(normalized.meta),
      ]
    );

    const notificationRow = notificationRows[0];

    const { rows: recipientRows } = await client.query(
      `INSERT INTO notification_recipients (
         school_id,
         notification_id,
         recipient_user_id
       )
       SELECT $1, $2, x.recipient_user_id
       FROM unnest($3::int[]) AS x(recipient_user_id)
       ON CONFLICT (notification_id, recipient_user_id) DO NOTHING
       RETURNING *`,
      [normalized.schoolId, notificationRow.id, recipients]
    );

    await client.query("COMMIT");

    const realtimeStats = emitRealtimeToUsers(app, recipientRows, notificationRow, {
      allowRealtime: normalized.allowRealtime,
    });

    return {
      success: true,
      skipped: false,
      reason: null,
      request_id: Number(notificationRow.id),
      created_rows: recipientRows.length,
      recipients_created: recipientRows.length,
      invalid_recipient_ids: requestedRecipients.filter(
        (id) => !recipients.includes(id)
      ),
      realtime_sent: realtimeStats.sent_users,
      realtime_sent_count: realtimeStats.sent_users,
      realtime_attempted_count: realtimeStats.attempted_users,
      allow_realtime: normalized.allowRealtime,
      realtime: realtimeStats,
      notification: notificationRow,
      recipients: recipientRows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createSystemNotification({
  app,
  schoolId,
  category,
  priority,
  title,
  body,
  relatedType,
  relatedId,
  meta,
  recipientUserIds,
  dedupeWindowSeconds = 0,
  allowRealtime = true,
}) {
  return createNotification({
    app,
    schoolId,
    source: "system",
    category,
    priority,
    title,
    body,
    senderUserId: null,
    senderDisplayName: "النظام",
    relatedType,
    relatedId,
    meta,
    recipientUserIds,
    dedupeWindowSeconds,
    allowRealtime,
  });
}
