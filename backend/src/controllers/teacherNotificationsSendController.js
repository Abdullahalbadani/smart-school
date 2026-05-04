// backend/src/controllers/teacherNotificationsSendController.js
import { pool } from "../config/db.js";

// ==========================================
// ✅ المساعدات (School Scoped Helpers)
// ==========================================

async function getTeacherIdByUserId(userId, schoolId) {
  // التأكد من جلب سجل المعلم الخاص بنفس المدرسة لضمان الأمان
  const r = await pool.query(
    `SELECT id FROM teachers WHERE user_id = $1 AND school_id = $2 LIMIT 1`,
    [userId, schoolId]
  );
  return r.rows[0]?.id || null;
}

async function getUserDisplayName(userId, schoolId) {
  const r = await pool.query(
    `SELECT name FROM users WHERE id = $1 AND school_id = $2 LIMIT 1`,
    [userId, schoolId]
  );
  return r.rows[0]?.name || "معلم";
}

async function createNotificationWithRecipients({
  schoolId, // 👈 إلزامي لنظام الـ SaaS
  senderUserId,
  senderDisplayName,
  title,
  body,
  recipientUserIds,
  meta,
}) {
  // إدراج الإشعار مع school_id
  const insN = `
    INSERT INTO notifications (school_id, source, category, priority, title, body, sender_user_id, sender_display_name, meta)
    VALUES ($1, 'manual','general','normal',$2,$3,$4,$5,$6)
    RETURNING id
  `;
  const n = await pool.query(insN, [
    schoolId,
    title,
    body,
    senderUserId,
    senderDisplayName || null,
    meta ? JSON.stringify(meta) : null,
  ]);
  const notificationId = n.rows[0].id;

  const uniq = [...new Set((recipientUserIds || []).map(Number))].filter(
    (x) => Number.isInteger(x) && x > 0
  );

  if (!uniq.length) return { notificationId, inserted: 0 };

  // إدراج المستلمين مع school_id لضمان عزل البيانات
  const values = uniq
    .map((_, i) => `($1, $2, $${i + 3}, FALSE, NULL)`)
    .join(",");
  const params = [notificationId, schoolId, ...uniq];

  const insR = `
    INSERT INTO notification_recipients (notification_id, school_id, recipient_user_id, is_read, read_at)
    VALUES ${values}
  `;
  await pool.query(insR, params);

  return { notificationId, inserted: uniq.length, recipients: uniq };
}

function emitToUsers(req, userIds) {
  const io = req.app.get("io");
  (userIds || []).forEach((uid) => {
    io?.to(`user_${uid}`).emit("notification:new");
  });
}

// ==========================================
// 1️⃣ نطاقات المعلم (SCOPES)
// ==========================================
export async function getTeacherScopes(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);

    if (!teacherId)
      return res
        .status(404)
        .json({ message: "لم يتم العثور على سجل المعلم في هذه المدرسة" });

    const sql = `
      SELECT DISTINCT
        sst.academic_year_id,
        sst.term,
        stg.id AS stage_id, stg.name AS stage_name,
        g.id AS grade_id,  g.name  AS grade_name,
        sec.id AS section_id, sec.name AS section_name
      FROM section_subject_teachers sst
      JOIN sections sec ON sec.id = sst.section_id AND sec.school_id = $2
      JOIN grades g ON g.id = sec.grade_id AND g.school_id = $2
      JOIN stages stg ON stg.id = g.stage_id AND stg.school_id = $2
      WHERE sst.teacher_id = $1
        AND sst.school_id = $2
        AND COALESCE(sst.status,'active') = 'active'
      ORDER BY sst.academic_year_id DESC, sst.term DESC, stg.name, g.name, sec.name
    `;
    const { rows } = await pool.query(sql, [teacherId, schoolId]);
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
}

// ==========================================
// 2️⃣ طلاب الشعبة (STUDENTS in a SCOPE)
// ==========================================
export async function listScopeStudents(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId)
      return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const academicYearId = Number(req.query.academic_year_id);
    const term = Number(req.query.term);
    const sectionId = Number(req.query.section_id);
    const q = String(req.query.q || "").trim();

    if (!academicYearId || !term || !sectionId) {
      return res
        .status(400)
        .json({ message: "academic_year_id و term و section_id مطلوبة" });
    }

    // تحقق النطاق والمدرسة
    const ok = await pool.query(
      `SELECT 1 FROM section_subject_teachers WHERE teacher_id = $1 AND academic_year_id = $2 AND term = $3 AND section_id = $4 AND school_id = $5 LIMIT 1`,
      [teacherId, academicYearId, term, sectionId, schoolId]
    );
    if (!ok.rows.length)
      return res.status(403).json({ message: "هذه الشعبة ليست ضمن نطاقك" });

    const sql = `
      SELECT
        st.id AS student_id,
        st.user_id,
        st.student_code,
        st.full_name AS student_name
      FROM student_enrollments se
      JOIN students st ON st.id = se.student_id AND st.school_id = $5
      WHERE se.academic_year_id = $1
        AND se.term = $2
        AND se.section_id = $3
        AND se.school_id = $5
        AND st.user_id IS NOT NULL
        AND ($4 = '' OR st.full_name ILIKE '%' || $4 || '%' OR st.student_code ILIKE '%' || $4 || '%')
      ORDER BY st.full_name ASC
      LIMIT 400
    `;
    const { rows } = await pool.query(sql, [
      academicYearId,
      term,
      sectionId,
      q,
      schoolId,
    ]);
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
}

// ==========================================
// 3️⃣ أولياء أمور طالب (Guardians for ONE student)
// ==========================================
export async function listStudentGuardians(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId)
      return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const studentId = Number(req.params.studentId);
    if (!studentId)
      return res.status(400).json({ message: "studentId غير صحيح" });

    // تحقق أن الطالب يتبع لنفس مدرسة المعلم
    const ok = await pool.query(
      `SELECT 1 FROM student_enrollments WHERE student_id = $1 AND school_id = $2 LIMIT 1`,
      [studentId, schoolId]
    );
    if (!ok.rows.length)
      return res
        .status(403)
        .json({ message: "الطالب ليس ضمن نطاق هذه المدرسة" });

    const sql = `
      SELECT
        g.id AS guardian_id,
        g.user_id AS guardian_user_id,
        COALESCE(g.full_name, u.name, 'ولي أمر') AS guardian_name
      FROM student_guardians sg
      JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $2
      JOIN users u ON u.id = g.user_id AND u.school_id = $2
      WHERE sg.student_id = $1 AND sg.school_id = $2
      ORDER BY guardian_name ASC
    `;
    const { rows } = await pool.query(sql, [studentId, schoolId]);
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
}

// ==========================================
// 4️⃣ الإرسال للإدارة (Send to Admins)
// ==========================================
export async function sendToAdmins(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const senderName = await getUserDisplayName(senderUserId, schoolId);

    const { title, body } = req.body || {};
    if (!title || !body)
      return res.status(400).json({ message: "العنوان والنص مطلوبان" });

    // جلب مدراء المدرسة الحالية فقط
    const admins = await pool.query(
      `
      SELECT id FROM users
      WHERE school_id = $1 
        AND (LOWER(username) LIKE 'admin%' OR LOWER(email) LIKE '%admin%' OR LOWER(username) LIKE '%admins%')
    `,
      [schoolId]
    );
    const adminIds = admins.rows.map((r) => r.id);

    if (!adminIds.length)
      return res
        .status(400)
        .json({ message: "لا توجد حسابات إدارة لهذه المدرسة" });

    const out = await createNotificationWithRecipients({
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: adminIds,
      meta: { ui_source: "teacher_send_admins" },
    });

    emitToUsers(req, out.recipients);
    res.json({
      ok: true,
      notification_id: out.notificationId,
      recipients: out.inserted,
    });
  } catch (e) {
    next(e);
  }
}

// ==========================================
// 5️⃣ الإرسال للطلاب (Send to Students)
// ==========================================
export async function sendToStudents(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(senderUserId, schoolId);
    if (!teacherId)
      return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const senderName = await getUserDisplayName(senderUserId, schoolId);
    const {
      title,
      body,
      mode,
      academic_year_id,
      term,
      section_id,
      grade_id,
      student_ids = [],
    } = req.body || {};

    if (!title || !body || !academic_year_id || !term)
      return res.status(400).json({ message: "جميع الحقول الأساسية مطلوبة" });

    let recipientUserIds = [];

    if (mode === "selected") {
      if (!Array.isArray(student_ids) || !student_ids.length)
        return res.status(400).json({ message: "اختر طلابًا أولاً" });

      const q = `
        SELECT DISTINCT st.user_id FROM students st
        JOIN student_enrollments se ON se.student_id = st.id AND se.school_id = $5
        JOIN section_subject_teachers sst ON sst.section_id = se.section_id AND sst.school_id = $5
        WHERE st.id = ANY($1::int[]) AND st.school_id = $5 AND sst.teacher_id = $2
          AND se.academic_year_id = $3 AND se.term = $4
      `;
      const { rows } = await pool.query(q, [
        student_ids.map(Number),
        teacherId,
        Number(academic_year_id),
        Number(term),
        schoolId,
      ]);
      recipientUserIds = rows.map((r) => r.user_id);
    } else if (mode === "section_all") {
      if (!section_id)
        return res.status(400).json({ message: "section_id مطلوب" });

      const ok = await pool.query(
        `SELECT 1 FROM section_subject_teachers WHERE teacher_id=$1 AND academic_year_id=$2 AND term=$3 AND section_id=$4 AND school_id=$5 LIMIT 1`,
        [
          teacherId,
          Number(academic_year_id),
          Number(term),
          Number(section_id),
          schoolId,
        ]
      );
      if (!ok.rows.length)
        return res.status(403).json({ message: "هذه الشعبة ليست ضمن نطاقك" });

      const q = `
        SELECT st.user_id FROM student_enrollments se
        JOIN students st ON st.id = se.student_id AND st.school_id = $4
        WHERE se.academic_year_id = $1 AND se.term = $2 AND se.section_id = $3 AND se.school_id = $4
      `;
      const { rows } = await pool.query(q, [
        Number(academic_year_id),
        Number(term),
        Number(section_id),
        schoolId,
      ]);
      recipientUserIds = rows.map((r) => r.user_id);
    } else if (mode === "grade_all") {
      if (!grade_id) return res.status(400).json({ message: "grade_id مطلوب" });

      const q = `
        SELECT DISTINCT st.user_id FROM student_enrollments se
        JOIN students st ON st.id = se.student_id AND st.school_id = $5
        JOIN sections sec ON sec.id = se.section_id AND sec.school_id = $5
        JOIN section_subject_teachers sst ON sst.section_id = se.section_id AND sst.school_id = $5
        WHERE se.academic_year_id = $1 AND se.term = $2 AND sec.grade_id = $3 AND sst.teacher_id = $4 AND se.school_id = $5
      `;
      const { rows } = await pool.query(q, [
        Number(academic_year_id),
        Number(term),
        Number(grade_id),
        teacherId,
        schoolId,
      ]);
      recipientUserIds = rows.map((r) => r.user_id);
    }

    if (!recipientUserIds.length)
      return res
        .status(400)
        .json({ message: "لا يوجد مستلمون ضمن النطاق الحالي" });

    const out = await createNotificationWithRecipients({
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds,
      meta: {
        ui_source: "teacher_send_students",
        mode,
        academic_year_id,
        term,
        section_id,
        grade_id,
      },
    });

    emitToUsers(req, out.recipients);
    res.json({
      ok: true,
      notification_id: out.notificationId,
      recipients: out.inserted,
    });
  } catch (e) {
    next(e);
  }
}

// ==========================================
// 6️⃣ الإرسال للأولياء (Send to Guardians)
// ==========================================
export async function sendToGuardians(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(senderUserId, schoolId);
    if (!teacherId)
      return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const senderName = await getUserDisplayName(senderUserId, schoolId);
    const {
      title,
      body,
      academic_year_id,
      term,
      student_ids = [],
      guardian_user_ids = null,
    } = req.body || {};

    if (!title || !body || !academic_year_id || !term || !student_ids.length)
      return res.status(400).json({ message: "البيانات الأساسية مطلوبة" });

    // تحقق الطلاب ضمن نطاق المعلم والمدرسة
    const ok = await pool.query(
      `SELECT COUNT(*)::int AS c FROM student_enrollments se
       JOIN section_subject_teachers sst ON sst.section_id = se.section_id AND sst.school_id = se.school_id
       WHERE se.student_id = ANY($1::int[]) AND sst.teacher_id = $2 AND se.school_id = $3`,
      [student_ids.map(Number), teacherId, schoolId]
    );
    if ((ok.rows[0]?.c ?? 0) <= 0)
      return res.status(403).json({ message: "طلاب خارج نطاقك" });

    let finalGuardianIds = [];
    if (Array.isArray(guardian_user_ids) && guardian_user_ids.length) {
      finalGuardianIds = guardian_user_ids.map(Number).filter((id) => id > 0);
    } else {
      const q = `
        SELECT DISTINCT u.id AS user_id FROM student_guardians sg
        JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $2
        JOIN users u ON u.id = g.user_id AND u.school_id = $2
        WHERE sg.student_id = ANY($1::int[]) AND sg.school_id = $2
      `;
      const { rows } = await pool.query(q, [student_ids.map(Number), schoolId]);
      finalGuardianIds = rows.map((r) => r.user_id);
    }

    if (!finalGuardianIds.length)
      return res
        .status(400)
        .json({ message: "لا يوجد أولياء أمور لهؤلاء الطلاب" });

    const out = await createNotificationWithRecipients({
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: finalGuardianIds,
      meta: { ui_source: "teacher_send_guardians" },
    });

    emitToUsers(req, out.recipients);
    res.json({
      ok: true,
      notification_id: out.notificationId,
      recipients: out.inserted,
    });
  } catch (e) {
    next(e);
  }
}
