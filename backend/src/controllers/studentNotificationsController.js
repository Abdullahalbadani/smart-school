// backend/src/controllers/studentNotificationsController.js
import { pool } from "../config/db.js";

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

// ✅ جلب مدراء نفس المدرسة حصراً
async function getAdminUserIds(schoolId) {
  const sql = `
    SELECT DISTINCT u.id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE u.school_id = $1
      AND LOWER(r.name) IN ('admin','administrator','super_admin','school_admin')
      AND COALESCE(u.status,'active') = 'active'
  `;
  const { rows } = await pool.query(sql, [schoolId]);
  return rows.map(r => Number(r.id));
}

async function emitToUsers(req, userIds) {
  const io = req.app.get("io");
  if (!io) return;
  for (const uid of userIds) {
    io.to(`user_${uid}`).emit("notification:new");
  }
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
    return res.json({ items: rows });
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
    const adminIds = await getAdminUserIds(schoolId);
    if (!adminIds.length) return res.status(400).json({ message: "لا يوجد حسابات إدارة لهذه المدرسة" });

    const meta = { ui_source: "student_portal", to: "admins", school_id: schoolId };

    const insN = await pool.query(
      `
      INSERT INTO notifications
        (source, category, priority, title, body, sender_user_id, school_id, sender_display_name, meta, created_at)
      VALUES
        ('manual','general','normal',$1,$2,$3,$4,$5,$6::jsonb,NOW())
      RETURNING id
      `,
      [title, body, userId, schoolId, senderName, JSON.stringify(meta)]
    );

    const notificationId = insN.rows[0].id;

    await pool.query(
      `
      INSERT INTO notification_recipients (notification_id, school_id, recipient_user_id, is_read, created_at)
      SELECT $1, $3, x, false, NOW()
      FROM UNNEST($2::int[]) AS x
      `,
      [notificationId, adminIds, schoolId]
    );

    await emitToUsers(req, adminIds);

    return res.json({ ok: true, notification_id: notificationId, recipients: adminIds.length });
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
    const teacher_user_ids = Array.isArray(req.body?.teacher_user_ids) ? req.body.teacher_user_ids : [];

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

    const allowedSet = new Set(allowed.map(x => Number(x.teacher_user_id)));

    let targets = [];
    if (mode === "all") {
      targets = [...allowedSet];
    } else {
      targets = teacher_user_ids.map(Number).filter(id => allowedSet.has(id));
    }

    targets = targets.filter(id => id && id !== userId);

    if (!targets.length) return res.status(400).json({ message: "لا يوجد مستلمين صالحين" });

    const senderName = await getSenderName(userId, schoolId);
    const meta = { ui_source: "student_portal", to: "teachers", mode, school_id: schoolId };

    const insN = await pool.query(
      `
      INSERT INTO notifications
        (source, category, priority, title, body, sender_user_id, school_id, sender_display_name, meta, created_at)
      VALUES
        ('manual','general','normal',$1,$2,$3,$4,$5,$6::jsonb,NOW())
      RETURNING id
      `,
      [title, body, userId, schoolId, senderName, JSON.stringify(meta)]
    );

    const notificationId = insN.rows[0].id;

    await pool.query(
      `
      INSERT INTO notification_recipients (notification_id, school_id, recipient_user_id, is_read, created_at)
      SELECT $1, $3, x, false, NOW()
      FROM UNNEST($2::int[]) AS x
      `,
      [notificationId, targets, schoolId]
    );

    await emitToUsers(req, targets);

    return res.json({ ok: true, notification_id: notificationId, recipients: targets.length });
  } catch (e) {
    console.error("sendTeachers error:", e);
    return res.status(500).json({ message: "خطأ في الخادم" });
  }
}