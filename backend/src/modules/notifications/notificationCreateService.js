// backend/src/modules/notifications/notificationCreateService.js
import { pool } from "../../config/db.js";

function uniqueIntIds(ids = []) {
  return [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((x) => Number(x))
        .filter((x) => Number.isInteger(x) && x > 0)
    ),
  ];
}

function sanitizePriority(priority) {
  const p = String(priority || "normal").toLowerCase();
  return ["normal", "important", "urgent"].includes(p) ? p : "normal";
}

function sanitizeSource(source) {
  const s = String(source || "system").toLowerCase();
  return ["system", "manual"].includes(s) ? s : "system";
}

function sanitizeCategory(category) {
  return String(category || "general").trim() || "general";
}

function safeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta;
}

function toBool(v, fallback = true) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function toNonNegativeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// ✅ إضافة school_id لفحص التكرار داخل نفس المدرسة فقط
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

  const sql = `
    SELECT 1
    FROM notifications n
    JOIN notification_recipients nr ON nr.notification_id = n.id
    WHERE n.school_id = $8
      AND n.source = $1
      AND n.title = $2
      AND COALESCE(n.body, '') = COALESCE($3, '')
      AND COALESCE(n.related_type, '') = COALESCE($4, '')
      AND COALESCE(n.related_id, 0) = COALESCE($5, 0)
      AND nr.recipient_user_id = ANY($6::int[])
      AND n.created_at >= now() - (($7)::text || ' seconds')::interval
    LIMIT 1
  `;

  const result = await client.query(sql, [
    source,
    title,
    body || "",
    relatedType,
    relatedId,
    recipientUserIds,
    Number(dedupeWindowSeconds),
    schoolId, // 👈 المعامل الثامن
  ]);

  return result.rowCount > 0;
}

function buildRealtimePayload({ notification, recipientRow }) {
  return {
    recipient_row_id: Number(recipientRow.id),
    id: Number(notification.id),
    school_id: Number(notification.school_id), // ✅ إرسال رقم المدرسة للفرونت-إند للتأكد
    source: notification.source,
    category: notification.category,
    priority: notification.priority,
    title: notification.title,
    body: notification.body,
    sender_name: notification.sender_display_name || "النظام",
    created_at: notification.created_at,
    is_read: false,
    read_at: null,
    related: (notification.related_type || notification.related_id)
      ? {
          type: notification.related_type || null,
          id: notification.related_id != null ? Number(notification.related_id) : null,
          label: notification.meta?.related_label || null,
        }
      : null,
    meta: notification.meta || {},
  };
}

function emitRealtimeToUsers(app, recipientsRows, notificationRow, { allowRealtime = true } = {}) {
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

    let sent = 0;
    let attempted = 0;

    for (const rr of recipientsRows || []) {
      const userId = Number(rr.recipient_user_id);
      if (!Number.isInteger(userId) || userId <= 0) continue;

      attempted++;

      const payload = buildRealtimePayload({
        notification: notificationRow,
        recipientRow: rr,
      });

      // إرسال الإشعار لغرفة المستخدم الشخصية
      io.to(`user_${userId}`).emit("notification:new", payload);
      io.to(`user_${userId}`).emit("notification:unread-count:refresh");
      sent++;
    }

    stats.attempted_users = attempted;
    stats.sent_users = sent;
    return stats;
  } catch (err) {
    console.warn("emitRealtimeToUsers warning:", err.message);
    stats.error = err.message || "emit_failed";
    return stats;
  }
}

/**
 * createNotification
 * خدمة موحدة لإنشاء إشعار واحد وإرساله لعدة مستلمين (معزولة بالمدرسة)
 */
export async function createNotification({
  app = null,
  schoolId, // 👈 NEW: إجباري الآن لمعرفة مسار الإشعار
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
  if (!schoolId) throw new Error("schoolId مطلوب لإنشاء الإشعار");

  const recipients = uniqueIntIds(recipientUserIds);

  if (!title || !String(title).trim()) {
    throw new Error("title مطلوب");
  }

  if (!recipients.length) {
    return {
      success: true,
      skipped: true,
      reason: "no_recipients",
      request_id: null,
      created_rows: 0,
      recipients_created: 0,
      realtime_sent: 0,
      realtime_sent_count: 0,
      notification: null,
      recipients: [],
    };
  }

  const normalized = {
    schoolId: Number(schoolId),
    source: sanitizeSource(source),
    category: sanitizeCategory(category),
    priority: sanitizePriority(priority),
    title: String(title).trim(),
    body: String(body || "").trim(),
    senderUserId: senderUserId ? Number(senderUserId) : null,
    senderDisplayName: senderDisplayName ? String(senderDisplayName).trim() : null,
    relatedType: relatedType ? String(relatedType).trim() : null,
    relatedId: relatedId != null ? Number(relatedId) : null,
    meta: safeMeta(meta),
    dedupeWindowSeconds: toNonNegativeInt(dedupeWindowSeconds, 0),
    allowRealtime: toBool(allowRealtime, true),
  };

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const duplicate = await isRecentDuplicate({
      client,
      schoolId: normalized.schoolId, // 👈 تمرير المدرسة
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
      return {
        success: true,
        skipped: true,
        reason: "duplicate_recent",
        request_id: null,
        created_rows: 0,
        recipients_created: 0,
        realtime_sent: 0,
        realtime_sent_count: 0,
        notification: null,
        recipients: [],
      };
    }

    // ✅ إدراج الإشعار مع school_id
    const insertNotificationSql = `
      INSERT INTO notifications (
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
      RETURNING *
    `;

    const notifResult = await client.query(insertNotificationSql, [
      normalized.schoolId,
      normalized.source,
      normalized.category,
      normalized.priority,
      normalized.title,
      normalized.body || null,
      normalized.senderUserId,
      normalized.senderDisplayName,
      normalized.relatedType,
      normalized.relatedId,
      JSON.stringify(normalized.meta),
    ]);

    const notificationRow = notifResult.rows[0];

    // ✅ ربط المستلمين مع الإشعار (وحقن school_id للأمان الإضافي)
    const insertRecipientsSql = `
      INSERT INTO notification_recipients (
        school_id,
        notification_id,
        recipient_user_id
      )
      SELECT $1, $2, x.recipient_user_id
      FROM unnest($3::int[]) AS x(recipient_user_id)
      RETURNING *
    `;

    const recResult = await client.query(insertRecipientsSql, [
      normalized.schoolId,
      notificationRow.id,
      recipients,
    ]);

    const recipientRows = recResult.rows || [];

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
      realtime_sent: realtimeStats.sent_users,
      realtime_sent_count: realtimeStats.sent_users,
      realtime_attempted_count: realtimeStats.attempted_users,
      allow_realtime: normalized.allowRealtime,
      realtime: realtimeStats,
      notification: notificationRow,
      recipients: recipientRows,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Helper سريع لإشعارات النظام (معزول بالمدرسة)
 */
export async function createSystemNotification({
  app,
  schoolId, // 👈 NEW
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
    schoolId, // 👈 تمرير المدرسة
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