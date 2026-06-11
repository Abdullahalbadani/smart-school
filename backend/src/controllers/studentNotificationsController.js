// backend/src/controllers/studentNotificationsController.js
import { pool } from "../config/db.js";
import { createNotification } from "../modules/notifications/notificationCreateService.js";
import { getAdminUserIds as getNotificationAdminUserIds } from "../modules/notifications/notificationTargetsResolvers.js";
import { getAttachmentsForNotificationIds } from "../modules/notifications/notificationsAttachmentsService.js";

/**
 * نظام إشعارات الطلاب المحصن (SaaS-Ready)
 * يضمن عزل البيانات تماماً بين المدارس باستخدام school_id
 */

// ======================= HELPERS =======================

function getQ(req, key, def = "") {
  return String(req.query?.[key] ?? def).trim();
}

function getInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function normalizeStatus(s) {
  const v = String(s || "all").toLowerCase();
  return ["all", "unread", "read", "has_unread", "fully_read"].includes(v) ? v : "all";
}

function getSchoolId(req) {
  return req.user?.school_id;
}

// ✅ جلب اسم المرسل مع التأكد من المدرسة
async function getSenderName(userId, schoolId) {
  const { rows } = await pool.query(
    `SELECT name FROM users WHERE id=$1 AND school_id=$2`, 
    [userId, schoolId]
  );
  return rows[0]?.name || "—";
}

// ✅ جلب سياق الطالب (الشعبة والسنة) ضمن مدرسته فقط
async function getStudentContext(userId, schoolId) {
  const q = `
    SELECT
      s.id AS student_id,
      se.academic_year_id,
      se.section_id
    FROM students s
    LEFT JOIN student_enrollments se
      ON se.student_id = s.id AND se.school_id = $2
    WHERE s.user_id = $1 AND s.school_id = $2
    ORDER BY se.created_at DESC NULLS LAST, se.id DESC NULLS LAST
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [userId, schoolId]);
  return rows[0] || null;
}

// ✅ جلب المعلمين المسموح بمراسلتهم (في نفس المدرسة والشعبة)
async function listAllowedTeacherUsers({ academic_year_id, section_id, schoolId, q = "" }) {
  try {
    const sql = `
      SELECT
        t.user_id AS teacher_user_id,
        COALESCE(t.full_name, u.name) AS teacher_name,
        COALESCE(array_remove(array_agg(DISTINCT sub.name), NULL), '{}') AS subjects
      FROM section_subject_teachers sst
      JOIN teachers t ON t.id = sst.teacher_id AND t.school_id = $4
      LEFT JOIN users u ON u.id = t.user_id AND u.school_id = $4
      LEFT JOIN subjects sub ON sub.id = sst.subject_id AND sub.school_id = $4
      WHERE sst.academic_year_id = $1
        AND sst.section_id = $2
        AND sst.school_id = $4
        AND COALESCE(sst.status,'active') = 'active'
        AND t.user_id IS NOT NULL
        AND ($3 = '' OR COALESCE(t.full_name, u.name) ILIKE '%' || $3 || '%')
      GROUP BY t.user_id, COALESCE(t.full_name, u.name)
      ORDER BY teacher_name
    `;
    const { rows } = await pool.query(sql, [academic_year_id, section_id, q, schoolId]);
    return rows.map(r => ({
      teacher_user_id: Number(r.teacher_user_id),
      teacher_name: r.teacher_name,
      subjects: r.subjects || [],
    }));
  } catch {
    // Fallback في حال عدم وجود جدول المواد أو خطأ في التجميع
    const sql = `
      SELECT DISTINCT
        t.user_id AS teacher_user_id,
        COALESCE(t.full_name, u.name) AS teacher_name
      FROM section_subject_teachers sst
      JOIN teachers t ON t.id = sst.teacher_id AND t.school_id = $4
      LEFT JOIN users u ON u.id = t.user_id AND u.school_id = $4
      WHERE sst.academic_year_id = $1
        AND sst.section_id = $2
        AND sst.school_id = $4
        AND COALESCE(sst.status,'active') = 'active'
        AND t.user_id IS NOT NULL
        AND ($3 = '' OR COALESCE(t.full_name, u.name) ILIKE '%' || $3 || '%')
      ORDER BY teacher_name
    `;
    const { rows } = await pool.query(sql, [academic_year_id, section_id, q, schoolId]);
    return rows.map(r => ({
      teacher_user_id: Number(r.teacher_user_id),
      teacher_name: r.teacher_name,
      subjects: [],
    }));
  }
}

async function sendManualNotification({ req, schoolId, senderUserId, senderDisplayName, title, body, recipientUserIds, meta }) {
  const result = await createNotification({
    app: req.app,
    schoolId,
    source: "manual",
    category: "general",
    priority: "normal",
    title,
    body,
    senderUserId,
    senderDisplayName,
    meta,
    recipientUserIds,
  });

  return {
    notification_id: result.request_id,
    recipients: result.recipients_created || 0,
  };
}

function emitUnreadRefresh(req) {
  const userId = req.user?.id;
  const io = req.app?.get?.("io");
  if (io && userId) io.to(`user_${userId}`).emit("notification:unread-count:refresh");
}

// ======================= HANDLERS =======================

export async function unreadCount(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notification_recipients
       WHERE recipient_user_id=$1 AND school_id=$2
         AND COALESCE(is_read,false)=false`,
      [userId, schoolId]
    );
    return res.json({ count: rows[0]?.count ?? 0 });
  } catch (e) {
    console.error("unreadCount error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function listInbox(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const status = normalizeStatus(getQ(req, "status", "all"));
    const q = getQ(req, "q", "");

    const where = [`nr.recipient_user_id = $1`, `nr.school_id = $2`];
    const params = [userId, schoolId];
    let idx = 3;

    if (status === "unread") where.push(`COALESCE(nr.is_read,false)=false`);
    if (status === "read") where.push(`COALESCE(nr.is_read,false)=true`);

    if (q) {
      params.push(q);
      where.push(`(n.title ILIKE '%'||$${idx}||'%' OR n.body ILIKE '%'||$${idx}||'%')`);
      idx++;
    }

    const sql = `
      SELECT
        nr.id AS id,
        n.id  AS notification_id,
        n.source, n.category, n.priority,
        n.title, n.body,
        n.sender_user_id,
        COALESCE(n.sender_display_name, u.name, 'النظام') AS sender_name,
        nr.is_read, nr.read_at,
        n.created_at
      FROM notification_recipients nr
      JOIN notifications n ON n.id = nr.notification_id AND n.school_id = $2
      LEFT JOIN users u ON u.id = n.sender_user_id AND u.school_id = $2
      WHERE ${where.join(" AND ")}
      ORDER BY n.created_at DESC
      LIMIT 80
    `;

    const { rows } = await pool.query(sql, params);
    const attachmentsMap = await getAttachmentsForNotificationIds(
      rows.map((row) => Number(row.notification_id)),
      schoolId
    );
    return res.json({
      items: rows.map((row) => ({
        ...row,
        attachments: attachmentsMap.get(Number(row.notification_id)) || [],
      })),
    });
  } catch (e) {
    console.error("listInbox error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function markOneRead(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const id = getInt(req.params.id);
    if (!id) return res.status(400).json({ message: "معرف غير صالح" });

    const q = `
      UPDATE notification_recipients
      SET is_read = true,
          read_at = NOW()
      WHERE id = $1
        AND recipient_user_id = $2
        AND school_id = $3
        AND COALESCE(is_read,false)=false
      RETURNING id
    `;
    const { rowCount } = await pool.query(q, [id, userId, schoolId]);

    emitUnreadRefresh(req);
    return res.status(200).json({ ok: true, updated: rowCount });
  } catch (e) {
    console.error("markOneRead error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function markAllRead(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);

    const q = `
      UPDATE notification_recipients
      SET is_read = true,
          read_at = NOW()
      WHERE recipient_user_id = $1
        AND school_id = $2
        AND COALESCE(is_read,false)=false
    `;
    const { rowCount } = await pool.query(q, [userId, schoolId]);
    emitUnreadRefresh(req);
    return res.json({ ok: true, updated: rowCount });
  } catch (e) {
    console.error("markAllRead error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function listOutbox(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const status = normalizeStatus(getQ(req, "status", "all"));
    const q = getQ(req, "q", "");

    const having = [];
    const params = [userId, schoolId];
    let idx = 3;

    let where = `n.sender_user_id = $1 AND n.school_id = $2`;

    if (q) {
      params.push(q);
      where += ` AND (n.title ILIKE '%'||$${idx}||'%' OR n.body ILIKE '%'||$${idx}||'%')`;
      idx++;
    }

    if (status === "has_unread") {
      having.push(`SUM(CASE WHEN COALESCE(nr.is_read,false)=true THEN 1 ELSE 0 END) < COUNT(nr.id)`);
    }
    if (status === "fully_read") {
      having.push(`SUM(CASE WHEN COALESCE(nr.is_read,false)=true THEN 1 ELSE 0 END) = COUNT(nr.id)`);
    }

    const sql = `
      SELECT
        n.id, n.title, n.body, n.category, n.priority, n.source, n.created_at,
        COUNT(nr.id)::int AS recipients_total,
        SUM(CASE WHEN COALESCE(nr.is_read,false)=true THEN 1 ELSE 0 END)::int AS recipients_read
      FROM notifications n
      JOIN notification_recipients nr ON nr.notification_id = n.id AND nr.school_id = $2
      WHERE ${where}
      GROUP BY n.id
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY n.created_at DESC
      LIMIT 80
    `;
    const { rows } = await pool.query(sql, params);
    return res.json({ items: rows });
  } catch (e) {
    console.error("listOutbox error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function outboxRecipients(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const nid = getInt(req.params.id);
    if (!nid) return res.status(400).json({ message: "معرف غير صالح" });

    // تأكد أن الإشعار ملك الطالب في هذه المدرسة
    const own = await pool.query(
      `SELECT id FROM notifications WHERE id=$1 AND sender_user_id=$2 AND school_id=$3`, 
      [nid, userId, schoolId]
    );
    if (!own.rowCount) return res.status(403).json({ message: "غير مصرح" });

    const sql = `
      SELECT
        nr.id,
        nr.recipient_user_id AS recipient_user_id,
        COALESCE(u.name, '—') AS recipient_name,
        COALESCE(nr.is_read,false) AS is_read,
        nr.read_at,
        nr.created_at AS delivered_at
      FROM notification_recipients nr
      LEFT JOIN users u ON u.id = nr.recipient_user_id AND u.school_id = $2
      WHERE nr.notification_id = $1 AND nr.school_id = $2
      ORDER BY nr.created_at ASC
    `;
    const { rows } = await pool.query(sql, [nid, schoolId]);
    return res.json({ items: rows });
  } catch (e) {
    console.error("outboxRecipients error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function listMyTeachers(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const q = getQ(req, "q", "");

    const ctx = await getStudentContext(userId, schoolId);
    if (!ctx?.academic_year_id || !ctx?.section_id) {
      return res.json({ items: [] });
    }

    const items = await listAllowedTeacherUsers({
      academic_year_id: ctx.academic_year_id,
      section_id: ctx.section_id,
      schoolId,
      q,
    });

    return res.json({ items });
  } catch (e) {
    console.error("listMyTeachers error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function sendAdmins(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) return res.status(400).json({ message: "العنوان والنص مطلوبان" });

    const senderName = await getSenderName(userId, schoolId);
    const adminIds = await getNotificationAdminUserIds({ schoolId });
    if (!adminIds.length) return res.status(400).json({ message: "لا يوجد حسابات إدارة لهذه المدرسة" });

    const out = await sendManualNotification({
      req,
      schoolId,
      senderUserId: userId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: adminIds,
      meta: { ui_source: "student_portal", to: "admins", school_id: schoolId },
    });

    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("sendAdmins error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

export async function sendTeachers(req, res) {
  try {
    const userId = req.user.id;
    const schoolId = getSchoolId(req);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const mode = String(req.body?.mode || "selected");
    const teacherUserIds = Array.isArray(req.body?.teacher_user_ids)
      ? req.body.teacher_user_ids
      : [];

    if (!title || !body) return res.status(400).json({ message: "العنوان والنص مطلوبان" });

    const ctx = await getStudentContext(userId, schoolId);
    if (!ctx?.academic_year_id || !ctx?.section_id) {
      return res.status(400).json({ message: "لم يتم تحديد شعبة الطالب الحالية" });
    }

    const allowed = await listAllowedTeacherUsers({
      academic_year_id: ctx.academic_year_id,
      section_id: ctx.section_id,
      schoolId,
      q: "",
    });
    const allowedSet = new Set(allowed.map((item) => Number(item.teacher_user_id)));

    let targets = [];
    if (mode === "all") targets = [...allowedSet];
    else targets = teacherUserIds.map(Number).filter((id) => allowedSet.has(id));

    targets = targets.filter((id) => id && id !== userId);
    if (!targets.length) return res.status(400).json({ message: "لا يوجد مستلمين صالحين" });

    const senderName = await getSenderName(userId, schoolId);
    const out = await sendManualNotification({
      req,
      schoolId,
      senderUserId: userId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: targets,
      meta: { ui_source: "student_portal", to: "teachers", mode, school_id: schoolId },
    });

    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error("sendTeachers error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}

