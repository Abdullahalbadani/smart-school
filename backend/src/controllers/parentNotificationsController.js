// backend/src/controllers/parentNotificationsController.js
import { pool } from "../config/db.js";

// ==========================================
// ✅ Helpers (Schema-safe & Multi-tenant)
// ==========================================

async function hasTable(name) {
  const { rows } = await pool.query(`SELECT to_regclass($1) AS t`, [
    `public.${name}`,
  ]);
  return !!rows[0]?.t;
}

async function hasColumn(table, column) {
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
    `,
    [table, column]
  );
  return rows.length > 0;
}

function pickUserId(req) {
  // الأولوية لـ req.user.id الموثق من التوكن
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId;
}

function getSchoolId(req) {
  return req.user?.school_id;
}

// ==========================================
// 🛡️ Admins Lookup (Isolated by School)
// ==========================================

async function getAdminUserIds(schoolId) {
  if (!schoolId) return [];

  // 1) البحث عبر الصلاحيات الموحدة (roles table) - مع فلترة المدرسة
  if ((await hasColumn("users", "role_id")) && (await hasTable("roles"))) {
    const { rows } = await pool.query(
      `
      SELECT u.id
      FROM users u
      JOIN roles r ON r.id=u.role_id
      WHERE u.school_id = $1
        AND LOWER(r.name) IN ('admin','administrator','super_admin','school_admin')
        AND COALESCE(u.status,'active')='active'
    `,
      [schoolId]
    );
    if (rows.length > 0) return rows.map((r) => Number(r.id));
  }

  // 2) البحث عبر جداول الربط (user_roles) - مع فلترة المدرسة
  for (const linkTable of [
    "user_roles",
    "users_roles",
    "user_role_assignments",
  ]) {
    if ((await hasTable(linkTable)) && (await hasTable("roles"))) {
      const { rows } = await pool.query(
        `
        SELECT DISTINCT u.id
        FROM ${linkTable} ur
        JOIN roles r ON r.id=ur.role_id
        JOIN users u ON u.id=ur.user_id
        WHERE u.school_id = $1
          AND LOWER(r.name) IN ('admin','administrator','super_admin','school_admin')
          AND COALESCE(u.status,'active')='active'
      `,
        [schoolId]
      );
      if (rows.length > 0) return rows.map((r) => Number(r.id));
    }
  }

  // 3) fallback user_type/role/type columns - مع فلترة المدرسة
  for (const col of ["role", "user_type", "type"]) {
    if (await hasColumn("users", col)) {
      const { rows } = await pool.query(
        `
        SELECT id
        FROM users
        WHERE school_id = $1
          AND LOWER(${col}) IN ('admin','administrator')
          AND COALESCE(status,'active')='active'
      `,
        [schoolId]
      );
      if (rows.length > 0) return rows.map((r) => Number(r.id));
    }
  }

  // 4) fallback username=admin - مع فلترة المدرسة
  if (await hasColumn("users", "username")) {
    const { rows } = await pool.query(
      `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND LOWER(username)='admin'
        AND COALESCE(status,'active')='active'
    `,
      [schoolId]
    );
    return rows.map((r) => Number(r.id));
  }

  return [];
}

// ==========================================
// 👨‍👩‍👧‍👦 Parent ↔ Children (School Scoped)
// ==========================================

async function getLinkedChildren(parentUserId, schoolId) {
  if (!schoolId) return [];

  if (!(await hasTable("student_guardians")))
    throw new Error("جدول student_guardians غير موجود.");
  if (!(await hasTable("guardians")))
    throw new Error("جدول guardians غير موجود.");

  const gHasUserId = await hasColumn("guardians", "user_id");

  if (gHasUserId) {
    // الحالة القياسية: ولي الأمر والطالب يتبعان لنفس المدرسة
    const { rows } = await pool.query(
      `
      SELECT s.id AS student_id, s.user_id AS student_user_id, s.full_name AS student_name, s.student_code
      FROM guardians g
      JOIN student_guardians sg ON sg.guardian_id = g.id
      JOIN students s ON s.id = sg.student_id
      WHERE g.user_id = $1 
        AND g.school_id = $2 
        AND s.school_id = $2
      ORDER BY s.full_name
    `,
      [parentUserId, schoolId]
    );
    return rows.map((r) => ({
      student_id: Number(r.student_id),
      student_user_id: r.student_user_id ? Number(r.student_user_id) : null,
      student_name: r.student_name,
      student_code: r.student_code,
    }));
  }

  // fallback لو guardians لا يحتوي user_id
  const { rows } = await pool.query(
    `
    SELECT s.id AS student_id, s.user_id AS student_user_id, s.full_name AS student_name, s.student_code
    FROM student_guardians sg
    JOIN students s ON s.id = sg.student_id
    WHERE sg.guardian_id = $1 AND s.school_id = $2
    ORDER BY s.full_name
  `,
    [parentUserId, schoolId]
  );

  return rows.map((r) => ({
    student_id: Number(r.student_id),
    student_user_id: r.student_user_id ? Number(r.student_user_id) : null,
    student_name: r.student_name,
    student_code: r.student_code,
  }));
}

async function assertChildBelongsToParent(parentUserId, studentId, schoolId) {
  const children = await getLinkedChildren(parentUserId, schoolId);
  const ok = children.find((c) => c.student_id === Number(studentId));
  if (!ok) {
    const e = new Error("هذا الطالب غير مرتبط بهذا الحساب في هذه المدرسة.");
    e.status = 403;
    throw e;
  }
  return ok;
}

// ==========================================
// 👨‍🏫 Teachers for a child (School Scoped)
// ==========================================

async function getTeachersForStudent(studentId, schoolId) {
  if (!(await hasTable("student_enrollments")))
    throw new Error("جدول student_enrollments غير موجود.");

  const hasCreatedAt = await hasColumn("student_enrollments", "created_at");
  const order = hasCreatedAt ? "created_at DESC NULLS LAST" : "id DESC";

  // جلب آخر التحاق نشط في نفس المدرسة
  const enr = await pool.query(
    `
    SELECT academic_year_id, term, section_id
    FROM student_enrollments
    WHERE student_id=$1 AND school_id=$2
      AND COALESCE(status,'enrolled') IN ('enrolled','active')
      AND section_id IS NOT NULL
    ORDER BY ${order} LIMIT 1
  `,
    [studentId, schoolId]
  );

  const row = enr.rows[0];
  if (!row) return [];

  const { rows } = await pool.query(
    `
    SELECT t.id AS teacher_id, t.user_id AS teacher_user_id, t.full_name AS teacher_name,
           ARRAY_AGG(DISTINCT sub.name ORDER BY sub.name) AS subjects
    FROM section_subject_teachers sst
    JOIN teachers t ON t.id = sst.teacher_id
    LEFT JOIN subjects sub ON sub.id = sst.subject_id
    WHERE sst.academic_year_id = $1 AND sst.term = $2 AND sst.section_id = $3 AND sst.school_id = $4
      AND COALESCE(sst.status,'active')='active' AND COALESCE(t.is_active, true) = true
    GROUP BY t.id, t.user_id, t.full_name
    ORDER BY t.full_name
  `,
    [row.academic_year_id, row.term, row.section_id, schoolId]
  );

  return rows
    .map((r) => ({
      teacher_id: Number(r.teacher_id),
      teacher_user_id: r.teacher_user_id ? Number(r.teacher_user_id) : null,
      teacher_name: r.teacher_name,
      subjects: Array.isArray(r.subjects) ? r.subjects.filter(Boolean) : [],
    }))
    .filter((x) => x.teacher_user_id);
}

// ==========================================
// ✉️ Notifications Core (Multi-tenant)
// ==========================================

const ALLOWED_SOURCES = new Set(["manual", "system"]);

async function createNotification(
  senderUserId,
  schoolId,
  title,
  body,
  source = "manual"
) {
  const safeSource = ALLOWED_SOURCES.has(String(source).toLowerCase())
    ? source.toLowerCase()
    : "manual";
  const { rows } = await pool.query(
    `
    INSERT INTO notifications (sender_user_id, school_id, sender_display_name, title, body, source)
    VALUES ($1, $2, (SELECT name FROM users WHERE id=$1 AND school_id=$2), $3, $4, $5)
    RETURNING id, created_at
  `,
    [senderUserId, schoolId, title, body, safeSource]
  );
  return rows[0];
}

async function insertRecipients(notificationId, schoolId, recipientUserIds) {
  const ids = [...new Set(recipientUserIds.map(Number).filter(Boolean))];
  if (!ids.length) return 0;

  const params = [notificationId, schoolId];
  const values = ids.map((uid, i) => {
    params.push(uid);
    return `($1, $2, $${i + 3}, false)`;
  });

  await pool.query(
    `
    INSERT INTO notification_recipients (notification_id, school_id, recipient_user_id, is_read)
    VALUES ${values.join(",")}
  `,
    params
  );
  return ids.length;
}

// ==========================================
// 🚀 API Handlers
// ==========================================

export async function listChildren(req, res) {
  try {
    const items = await getLinkedChildren(pickUserId(req), getSchoolId(req));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function childTeachers(req, res) {
  try {
    const studentId = Number(req.params.studentId);
    const schoolId = getSchoolId(req);
    await assertChildBelongsToParent(pickUserId(req), studentId, schoolId);
    const items = await getTeachersForStudent(studentId, schoolId);
    res.json({ items });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notification_recipients 
       WHERE recipient_user_id=$1 AND school_id=$2 AND COALESCE(is_read,false)=false`,
      [pickUserId(req), getSchoolId(req)]
    );
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function listInbox(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = getSchoolId(req);
    const status = String(req.query.status || "all");
    const q = String(req.query.q || "").trim();

    const where = [`nr.recipient_user_id = $1`, `nr.school_id = $2`];
    const params = [userId, schoolId];
    let i = 3;

    if (status === "unread") where.push(`COALESCE(nr.is_read,false)=false`);
    if (status === "read") where.push(`COALESCE(nr.is_read,false)=true`);
    if (q) {
      params.push(`%${q}%`);
      where.push(`(n.title ILIKE $${i} OR n.body ILIKE $${i})`);
      i++;
    }

    const { rows } = await pool.query(
      `
      SELECT n.id, n.title, n.body, n.created_at, COALESCE(nr.is_read,false) AS is_read, 
             nr.read_at, u.name AS sender_display_name
      FROM notification_recipients nr
      JOIN notifications n ON n.id = nr.notification_id
      LEFT JOIN users u ON u.id = n.sender_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY n.created_at DESC LIMIT 200
    `,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function markOneRead(req, res) {
  try {
    await pool.query(
      `UPDATE notification_recipients SET is_read=true, read_at=NOW() 
       WHERE recipient_user_id=$1 AND notification_id=$2 AND school_id=$3`,
      [pickUserId(req), Number(req.params.id), getSchoolId(req)]
    );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function markAllRead(req, res) {
  try {
    await pool.query(
      `UPDATE notification_recipients SET is_read=true, read_at=NOW() 
       WHERE recipient_user_id=$1 AND school_id=$2 AND COALESCE(is_read,false)=false`,
      [pickUserId(req), getSchoolId(req)]
    );
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function listOutbox(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = getSchoolId(req);
    const q = String(req.query.q || "").trim();
    const params = [userId, schoolId];
    let where = `n.sender_user_id=$1 AND n.school_id=$2`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (n.title ILIKE $3 OR n.body ILIKE $3)`;
    }

    const { rows } = await pool.query(
      `
      SELECT n.id, n.title, n.body, n.created_at,
             COUNT(nr.recipient_user_id)::int AS recipients_total,
             SUM(CASE WHEN COALESCE(nr.is_read,false)=true THEN 1 ELSE 0 END)::int AS recipients_read
      FROM notifications n
      JOIN notification_recipients nr ON nr.notification_id=n.id
      WHERE ${where}
      GROUP BY n.id ORDER BY n.created_at DESC LIMIT 200
    `,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function outboxRecipients(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = getSchoolId(req);
    const notifId = Number(req.params.id);

    const own = await pool.query(
      `SELECT 1 FROM notifications WHERE id=$1 AND sender_user_id=$2 AND school_id=$3 LIMIT 1`,
      [notifId, userId, schoolId]
    );
    if (!own.rows.length) return res.status(403).json({ message: "غير مصرح." });

    const { rows } = await pool.query(
      `
      SELECT nr.recipient_user_id, u.name, nr.read_at, n.created_at AS delivered_at
      FROM notification_recipients nr
      JOIN notifications n ON n.id=nr.notification_id
      JOIN users u ON u.id=nr.recipient_user_id
      WHERE nr.notification_id=$1 AND nr.school_id=$2
      ORDER BY u.name
    `,
      [notifId, schoolId]
    );
    res.json({ recipients: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function sendAdmins(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const { title, body } = req.body;
    if (!title || !body)
      return res.status(400).json({ message: "العنوان والنص مطلوبان." });

    const adminIds = await getAdminUserIds(schoolId);
    if (!adminIds.length)
      return res
        .status(400)
        .json({ message: "لا توجد حسابات إدارة لهذه المدرسة." });

    const n = await createNotification(pickUserId(req), schoolId, title, body);
    const recipients = await insertRecipients(n.id, schoolId, adminIds);
    res.json({ id: n.id, recipients });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function sendChildren(req, res) {
  try {
    const parentUserId = pickUserId(req);
    const schoolId = getSchoolId(req);
    const { title, body, mode = "one", student_id, student_ids } = req.body;
    if (!title || !body)
      return res.status(400).json({ message: "العنوان والنص مطلوبان." });

    const children = await getLinkedChildren(parentUserId, schoolId);
    let targetChildren = [];
    if (mode === "all") targetChildren = children;
    else if (mode === "selected") {
      const set = new Set((student_ids || []).map(Number));
      targetChildren = children.filter((c) => set.has(c.student_id));
    } else {
      const one = children.find((c) => c.student_id === Number(student_id));
      if (!one)
        return res
          .status(403)
          .json({ message: "هذا الطالب غير مرتبط بهذا الحساب." });
      targetChildren = [one];
    }

    const recipientUserIds = targetChildren
      .map((c) => c.student_user_id)
      .filter(Boolean);
    if (!recipientUserIds.length)
      return res
        .status(400)
        .json({ message: "لا توجد حسابات مستخدم للأبناء." });

    const n = await createNotification(parentUserId, schoolId, title, body);
    const recipients = await insertRecipients(n.id, schoolId, recipientUserIds);
    res.json({ id: n.id, recipients });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export async function sendTeachers(req, res) {
  try {
    const parentUserId = pickUserId(req);
    const schoolId = getSchoolId(req);
    const { title, body, student_id, teacher_user_ids } = req.body;
    if (!title || !body || !student_id)
      return res.status(400).json({ message: "البيانات الأساسية مطلوبة." });

    await assertChildBelongsToParent(parentUserId, student_id, schoolId);
    const teachers = await getTeachersForStudent(student_id, schoolId);
    const allTeacherUserIds = teachers.map((t) => t.teacher_user_id);

    let targets = teacher_user_ids?.length
      ? allTeacherUserIds.filter((id) =>
          teacher_user_ids.map(Number).includes(id)
        )
      : allTeacherUserIds;
    if (!targets.length)
      return res
        .status(400)
        .json({ message: "لا يوجد معلمون متاحون لهذا الابن." });

    const n = await createNotification(parentUserId, schoolId, title, body);
    const recipients = await insertRecipients(n.id, schoolId, targets);
    res.json({ id: n.id, recipients });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}
