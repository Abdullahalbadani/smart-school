// backend/src/modules/notifications/notificationsSentLogService.js
import { pool } from "../../config/db.js";

function toSafeInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * قائمة الإشعارات المرسلة (محمية برقم المدرسة)
 */
export async function listSentNotifications({
  schoolId, // 👈 NEW
  q = "",
  category = "",
  priority = "",
  senderUserId = null,
  limit = 20,
  offset = 0,
}) {
  if (!schoolId) throw new Error("schoolId مطلوب لجلب سجل الإرسال");

  const safeLimit = toSafeInt(limit, 20, 1, 100);
  const safeOffset = toSafeInt(offset, 0, 0, 100000);

  const params = [schoolId]; // $1 هو دائماً رقم المدرسة
  const where = [`n.school_id = $1`, `n.source = 'manual'`];
  let i = 2;

  if (senderUserId) {
    where.push(`n.sender_user_id = $${i++}`);
    params.push(Number(senderUserId));
  }

  if (q && String(q).trim()) {
    where.push(`(
      n.title ILIKE $${i}
      OR COALESCE(n.body, '') ILIKE $${i}
      OR COALESCE(n.category, '') ILIKE $${i}
      OR COALESCE(n.sender_display_name, '') ILIKE $${i}
    )`);
    params.push(`%${String(q).trim()}%`);
    i++;
  }

  if (category && String(category).trim()) {
    where.push(`n.category = $${i++}`);
    params.push(String(category).trim());
  }

  if (priority && String(priority).trim()) {
    where.push(`n.priority = $${i++}`);
    params.push(String(priority).trim().toLowerCase());
  }

  const sql = `
    SELECT
      n.id,
      n.source,
      n.category,
      n.priority,
      n.title,
      n.body,
      n.sender_user_id,
      COALESCE(n.sender_display_name, u.name, '—') AS sender_name,
      n.related_type,
      n.related_id,
      n.meta,
      n.created_at,

      -- إحصائيات القراءة لنفس المدرسة فقط
      COUNT(nr.id)::int AS recipients_count,
      COUNT(nr.id) FILTER (WHERE nr.is_read = true)::int AS read_count,
      COUNT(nr.id) FILTER (WHERE nr.is_read = false)::int AS unread_count,

      COUNT(*) OVER()::int AS total_count
    FROM notifications n
    LEFT JOIN users u ON u.id = n.sender_user_id AND u.school_id = $1
    LEFT JOIN notification_recipients nr ON nr.notification_id = n.id AND nr.school_id = $1
    WHERE ${where.join(" AND ")}
    GROUP BY n.id, u.name
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;

  const result = await pool.query(sql, [...params, safeLimit, safeOffset]);
  const rows = result.rows || [];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    items: rows.map((r) => ({
      id: Number(r.id),
      source: r.source,
      category: r.category || "general",
      priority: r.priority || "normal",
      title: r.title,
      body: r.body,
      sender_user_id: r.sender_user_id ? Number(r.sender_user_id) : null,
      sender_name: r.sender_name || "—",
      related_type: r.related_type || null,
      related_id: r.related_id != null ? Number(r.related_id) : null,
      meta: r.meta || {},
      created_at: r.created_at,
      recipients_count: Number(r.recipients_count || 0),
      read_count: Number(r.read_count || 0),
      unread_count: Number(r.unread_count || 0),
    })),
  };
}

/**
 * تفاصيل إشعار مرسل مع قائمة المستلمين (محمية برقم المدرسة)
 */
export async function getSentNotificationDetails(notificationId, schoolId) {
  if (!schoolId) throw new Error("schoolId مطلوب");
  
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("notificationId غير صالح");
  }

  // 1. استعلام الرأس (Header) - التأكد أن الإشعار ينتمي للمدرسة
  const headerSql = `
    SELECT
      n.id,
      n.source,
      n.category,
      n.priority,
      n.title,
      n.body,
      n.sender_user_id,
      COALESCE(n.sender_display_name, u.name, '—') AS sender_name,
      n.related_type,
      n.related_id,
      n.meta,
      n.created_at,
      COUNT(nr.id)::int AS recipients_count,
      COUNT(nr.id) FILTER (WHERE nr.is_read = true)::int AS read_count,
      COUNT(nr.id) FILTER (WHERE nr.is_read = false)::int AS unread_count
    FROM notifications n
    LEFT JOIN users u ON u.id = n.sender_user_id AND u.school_id = $2
    LEFT JOIN notification_recipients nr ON nr.notification_id = n.id AND nr.school_id = $2
    WHERE n.id = $1
      AND n.school_id = $2
      AND n.source = 'manual'
    GROUP BY n.id, u.name
    LIMIT 1
  `;

  // 2. استعلام المستلمين - جلب مستلمي نفس المدرسة فقط
  const recSql = `
    SELECT
      nr.id AS recipient_row_id,
      nr.recipient_user_id,
      nr.is_read,
      nr.read_at,
      nr.created_at AS recipient_created_at,
      usr.name AS recipient_name,
      usr.username AS recipient_username,
      usr.email AS recipient_email
    FROM notification_recipients nr
    JOIN users usr ON usr.id = nr.recipient_user_id AND usr.school_id = $2
    WHERE nr.notification_id = $1
      AND nr.school_id = $2
    ORDER BY nr.is_read ASC, nr.id DESC
  `;

  const [headerRes, recipientsRes] = await Promise.all([
    pool.query(headerSql, [id, schoolId]),
    pool.query(recSql, [id, schoolId]),
  ]);

  const header = headerRes.rows[0];
  if (!header) return null;

  return {
    notification: {
      id: Number(header.id),
      source: header.source,
      category: header.category || "general",
      priority: header.priority || "normal",
      title: header.title,
      body: header.body,
      sender_user_id: header.sender_user_id ? Number(header.sender_user_id) : null,
      sender_name: header.sender_name || "—",
      related_type: header.related_type || null,
      related_id: header.related_id != null ? Number(header.related_id) : null,
      meta: header.meta || {},
      created_at: header.created_at,
      recipients_count: Number(header.recipients_count || 0),
      read_count: Number(header.read_count || 0),
      unread_count: Number(header.unread_count || 0),
    },
    recipients: (recipientsRes.rows || []).map((r) => ({
      recipient_row_id: Number(r.recipient_row_id),
      recipient_user_id: Number(r.recipient_user_id),
      is_read: !!r.is_read,
      read_at: r.read_at,
      recipient_created_at: r.recipient_created_at,
      recipient_name: r.recipient_name || "—",
      recipient_username: r.recipient_username || null,
      recipient_email: r.recipient_email || null,
    })),
  };
}