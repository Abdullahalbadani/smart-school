// backend/src/modules/notifications/notificationsInboxService.js
import { pool } from "../../config/db.js";

function buildInboxWhere({ userId, schoolId, filter, q }) {
  // ✅ أضفنا school_id كشرط أساسي في بناء الاستعلام
  const conditions = [`nr.recipient_user_id = $1`, `nr.school_id = $2`];
  const params = [userId, schoolId];
  let idx = 3; // المعاملات القادمة تبدأ من 3

  if (filter === "unread") {
    conditions.push(`nr.is_read = false`);
  } else if (filter === "read") {
    conditions.push(`nr.is_read = true`);
  } else if (filter === "system") {
    conditions.push(`n.source = 'system'`);
  } else if (filter === "manual") {
    conditions.push(`n.source = 'manual'`);
  } else if (filter === "finance") {
    conditions.push(`COALESCE(n.category,'') = 'finance'`);
  }

  if (q && String(q).trim()) {
    conditions.push(`(
      n.title ILIKE $${idx}
      OR n.body ILIKE $${idx}
      OR COALESCE(n.category, '') ILIKE $${idx}
      OR COALESCE(n.sender_display_name, '') ILIKE $${idx}
    )`);
    params.push(`%${String(q).trim()}%`);
    idx++;
  }

  return { whereSql: conditions.join(" AND "), params, nextIndex: idx };
}

export async function getInboxList({ userId, schoolId, filter = "all", q = "", limit = 20, offset = 0 }) {
  if (!schoolId) throw new Error("schoolId مطلوب لجلب الرسائل");

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { whereSql, params, nextIndex } = buildInboxWhere({ userId, schoolId, filter, q });

  const sql = `
    SELECT
      nr.id AS recipient_row_id,
      nr.notification_id,
      nr.is_read,
      nr.read_at,
      nr.created_at AS recipient_created_at,

      n.id,
      n.source,
      n.category,
      n.priority,
      n.title,
      n.body,
      COALESCE(n.sender_display_name, u.name, 'النظام') AS sender_name,
      n.sender_user_id,
      n.related_type,
      n.related_id,
      n.meta,
      n.created_at,

      COUNT(*) OVER() AS total_count
    FROM notification_recipients nr
    INNER JOIN notifications n ON n.id = nr.notification_id AND n.school_id = $2
    LEFT JOIN users u ON u.id = n.sender_user_id AND u.school_id = $2
    WHERE ${whereSql}
    ORDER BY n.created_at DESC, nr.id DESC
    LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
  `;

  const result = await pool.query(sql, [...params, safeLimit, safeOffset]);
  const rows = result.rows || [];
  const total = rows[0] ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit: safeLimit,
    offset: safeOffset,
    items: rows.map((r) => ({
      recipient_row_id: Number(r.recipient_row_id),
      id: Number(r.id),
      source: r.source,
      category: r.category || "general",
      priority: r.priority || "normal",
      title: r.title,
      body: r.body,
      sender_name: r.sender_name || "النظام",
      created_at: r.created_at,
      is_read: !!r.is_read,
      read_at: r.read_at,
      related: (r.related_type || r.related_id)
        ? {
            type: r.related_type || null,
            id: r.related_id != null ? Number(r.related_id) : null,
            label: (r.meta && r.meta.related_label) || null,
          }
        : null,
      meta: r.meta || {},
    })),
  };
}

export async function getInboxUnreadCount({ userId, schoolId }) {
  if (!schoolId) return { unread_count: 0 };

  const sql = `
    SELECT COUNT(*)::int AS unread_count
    FROM notification_recipients
    WHERE recipient_user_id = $1
      AND school_id = $2
      AND is_read = false
  `;
  const result = await pool.query(sql, [userId, schoolId]);

  return {
    unread_count: result.rows[0]?.unread_count || 0,
  };
}

export async function markRecipientRowAsRead({ userId, schoolId, recipientRowId }) {
  if (!schoolId) return null;

  const sql = `
    UPDATE notification_recipients nr
    SET
      is_read = true,
      read_at = COALESCE(nr.read_at, now())
    WHERE nr.id = $1
      AND nr.recipient_user_id = $2
      AND nr.school_id = $3
    RETURNING nr.id, nr.notification_id, nr.is_read, nr.read_at
  `;
  const result = await pool.query(sql, [recipientRowId, userId, schoolId]);

  if (!result.rows.length) return null;

  const row = result.rows[0];
  return {
    recipient_row_id: Number(row.id),
    notification_id: Number(row.notification_id),
    is_read: !!row.is_read,
    read_at: row.read_at,
  };
}

export async function markAllInboxAsRead({ userId, schoolId }) {
  if (!schoolId) return { updated_count: 0 };

  const sql = `
    UPDATE notification_recipients
    SET
      is_read = true,
      read_at = COALESCE(read_at, now())
    WHERE recipient_user_id = $1
      AND school_id = $2
      AND is_read = false
  `;
  const result = await pool.query(sql, [userId, schoolId]);

  return {
    updated_count: result.rowCount || 0,
  };
}