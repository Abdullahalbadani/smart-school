// backend/src/controllers/teacherNotificationsController.js
import { pool } from "../config/db.js";
import { getAttachmentsForNotificationIds } from "../modules/notifications/notificationsAttachmentsService.js";

// ✅ تعريف حالات القراءة (تم إبقاء المنطق الخاص بك كما هو مع مراعاة الأمان)
const unreadWhere = `(nr.read_at IS NULL AND NOT COALESCE(nr.is_read, FALSE))`;
const readWhere = `(nr.read_at IS NOT NULL OR COALESCE(nr.is_read, FALSE))`;

function emitUnreadRefresh(req, userId) {
  const io = req.app?.get?.("io");
  if (io && userId) {
    io.to(`user_${Number(userId)}`).emit("notification:unread-count:refresh");
  }
}

// 1. جلب عدد الإشعارات غير المقروءة (محمية بالمدرسة)
export async function getUnreadCount(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id; // 👈 استخراج المدرسة من التوكن

    const sql = `
      SELECT COUNT(*)::int AS count
      FROM notification_recipients nr
      WHERE nr.recipient_user_id = $1
        AND nr.school_id = $2
        AND ${unreadWhere}
    `;
    const { rows } = await pool.query(sql, [userId, schoolId]);
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (e) {
    next(e);
  }
}

// 2. قائمة صندوق الوارد (محمية بالمدرسة)
export async function listInbox(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const status = String(req.query.status || "all");
    const q = String(req.query.q || "").trim();

    const statusFilter =
      status === "unread" ? unreadWhere :
      status === "read" ? readWhere :
      "TRUE";

    const sql = `
      SELECT
        n.id,
        n.source,
        n.category,
        n.priority,
        n.title,
        n.body,
        n.sender_user_id,
        n.sender_display_name,
        n.created_at,
        nr.is_read,
        nr.read_at
      FROM notification_recipients nr
      JOIN notifications n ON n.id = nr.notification_id AND n.school_id = $2
      WHERE nr.recipient_user_id = $1
        AND nr.school_id = $2
        AND ${statusFilter}
        AND (
          $3 = '' OR
          n.title ILIKE '%' || $3 || '%' OR
          n.body  ILIKE '%' || $3 || '%' OR
          COALESCE(n.sender_display_name,'') ILIKE '%' || $3 || '%'
        )
      ORDER BY n.created_at DESC
      LIMIT 200
    `;

    const { rows } = await pool.query(sql, [userId, schoolId, q]);
    const attachmentsMap = await getAttachmentsForNotificationIds(
      rows.map((row) => Number(row.id)),
      schoolId
    );
    res.json({
      items: rows.map((row) => ({
        ...row,
        attachments: attachmentsMap.get(Number(row.id)) || [],
      })),
    });
  } catch (e) {
    next(e);
  }
}

// 3. تعليم إشعار واحد كمقروء (محمية بالمدرسة)
export async function markOneRead(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const notificationId = Number(req.params.id);

    const sql = `
      UPDATE notification_recipients nr
      SET is_read = TRUE,
          read_at = COALESCE(nr.read_at, NOW())
      WHERE nr.recipient_user_id = $1
        AND nr.notification_id = $2
        AND nr.school_id = $3
    `;
    await pool.query(sql, [userId, notificationId, schoolId]);
    emitUnreadRefresh(req, userId);

    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

// 4. تعليم كل الوارد كمقروء (محمية بالمدرسة)
export async function markAllRead(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;

    const sql = `
      UPDATE notification_recipients nr
      SET is_read = TRUE,
          read_at = COALESCE(nr.read_at, NOW())
      WHERE nr.recipient_user_id = $1
        AND nr.school_id = $2
        AND ${unreadWhere}
    `;
    await pool.query(sql, [userId, schoolId]);
    emitUnreadRefresh(req, userId);

    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

// 5. قائمة الصندوق الصادر (محمية بالمدرسة)
export async function listOutbox(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const status = String(req.query.status || "all");
    const q = String(req.query.q || "").trim();

    const having =
      status === "unread"
        ? `HAVING COUNT(*) FILTER (WHERE ${unreadWhere}) > 0`
        : status === "read"
        ? `HAVING COUNT(*) FILTER (WHERE ${unreadWhere}) = 0`
        : "";

    const sql = `
      SELECT
        n.id,
        n.title,
        n.body,
        n.created_at,
        COUNT(nr.id)::int AS recipients_total,
        COUNT(nr.id) FILTER (WHERE ${readWhere})::int AS recipients_read
      FROM notifications n
      JOIN notification_recipients nr ON nr.notification_id = n.id AND nr.school_id = $2
      WHERE n.sender_user_id = $1
        AND n.school_id = $2
        AND (
          $3 = '' OR
          n.title ILIKE '%' || $3 || '%' OR
          n.body  ILIKE '%' || $3 || '%'
        )
      GROUP BY n.id
      ${having}
      ORDER BY n.created_at DESC
      LIMIT 200
    `;

    const { rows } = await pool.query(sql, [userId, schoolId, q]);
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
}

// 6. تفاصيل مستلمي الإشعار الصادر (محمية بالمدرسة)
export async function outboxRecipients(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const notificationId = Number(req.params.id);

    // التحقق من ملكية الإشعار للمستخدم وللمدرسة
    const check = await pool.query(
      `SELECT id FROM notifications WHERE id = $1 AND sender_user_id = $2 AND school_id = $3`,
      [notificationId, userId, schoolId]
    );
    
    if (!check.rows.length) {
      return res.status(404).json({ message: "الإشعار غير موجود أو لا يخصك" });
    }

    const sql = `
      SELECT
        nr.recipient_user_id,
        COALESCE(u.name, u.username, u.email, ('user_' || nr.recipient_user_id::text)) AS name,
        nr.is_read,
        nr.read_at,
        nr.created_at
      FROM notification_recipients nr
      LEFT JOIN users u ON u.id = nr.recipient_user_id AND u.school_id = $2
      WHERE nr.notification_id = $1
        AND nr.school_id = $2
      ORDER BY nr.id ASC
    `;

    const { rows } = await pool.query(sql, [notificationId, schoolId]);
    res.json({ recipients: rows });
  } catch (e) {
    next(e);
  }
}