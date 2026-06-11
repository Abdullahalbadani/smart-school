// backend/src/controllers/teacherNotificationsSendController.js
import { pool } from "../config/db.js";
import { createNotification } from "../modules/notifications/notificationCreateService.js";
import { getAdminUserIds } from "../modules/notifications/notificationTargetsResolvers.js";

function uniquePositiveIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

async function getTeacherIdByUserId(userId, schoolId) {
  const { rows } = await pool.query(
    `SELECT id
     FROM teachers
     WHERE user_id = $1
       AND school_id = $2
       AND COALESCE(is_active, true) = true
     LIMIT 1`,
    [userId, schoolId]
  );
  return rows[0]?.id || null;
}

async function getUserDisplayName(userId, schoolId) {
  const { rows } = await pool.query(
    `SELECT name
     FROM users
     WHERE id = $1 AND school_id = $2
     LIMIT 1`,
    [userId, schoolId]
  );
  return rows[0]?.name || "معلم";
}

async function sendManualNotification({
  req,
  schoolId,
  senderUserId,
  senderDisplayName,
  title,
  body,
  recipientUserIds,
  meta,
}) {
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
    notificationId: result.request_id,
    inserted: result.recipients_created || 0,
  };
}

async function assertTeacherScope({ teacherId, schoolId, academicYearId, term, sectionId }) {
  const { rowCount } = await pool.query(
    `SELECT 1
     FROM section_subject_teachers
     WHERE teacher_id = $1
       AND academic_year_id = $2
       AND term = $3
       AND section_id = $4
       AND school_id = $5
       AND COALESCE(status, 'active') = 'active'
     LIMIT 1`,
    [teacherId, academicYearId, term, sectionId, schoolId]
  );
  return rowCount > 0;
}

async function getAllowedStudentIds({ teacherId, schoolId, academicYearId, term, studentIds }) {
  const requested = uniquePositiveIds(studentIds);
  if (!requested.length) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT se.student_id
     FROM student_enrollments se
     JOIN section_subject_teachers sst
       ON sst.section_id = se.section_id
      AND sst.academic_year_id = se.academic_year_id
      AND sst.term = se.term
      AND sst.school_id = se.school_id
      AND COALESCE(sst.status, 'active') = 'active'
     WHERE se.student_id = ANY($1::int[])
       AND sst.teacher_id = $2
       AND se.school_id = $3
       AND se.academic_year_id = $4
       AND se.term = $5`,
    [requested, teacherId, schoolId, academicYearId, term]
  );

  return uniquePositiveIds(rows.map((row) => row.student_id));
}

async function assertAllStudentsWithinTeacherScope({
  teacherId,
  schoolId,
  academicYearId,
  term,
  studentIds,
}) {
  const requested = uniquePositiveIds(studentIds);
  const allowed = await getAllowedStudentIds({
    teacherId,
    schoolId,
    academicYearId,
    term,
    studentIds: requested,
  });

  if (!requested.length || allowed.length !== requested.length) {
    const error = new Error("بعض الطلاب المحددين ليسوا ضمن نطاق المعلم");
    error.status = 403;
    throw error;
  }

  return allowed;
}

async function canTeacherAccessStudent({ teacherId, schoolId, studentId }) {
  const { rowCount } = await pool.query(
    `SELECT 1
     FROM student_enrollments se
     JOIN section_subject_teachers sst
       ON sst.section_id = se.section_id
      AND sst.academic_year_id = se.academic_year_id
      AND sst.term = se.term
      AND sst.school_id = se.school_id
      AND COALESCE(sst.status, 'active') = 'active'
     WHERE se.student_id = $1
       AND se.school_id = $2
       AND sst.teacher_id = $3
     LIMIT 1`,
    [studentId, schoolId, teacherId]
  );
  return rowCount > 0;
}

export async function getTeacherScopes(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(404).json({ message: "لم يتم العثور على سجل المعلم في هذه المدرسة" });

    const { rows } = await pool.query(
      `SELECT DISTINCT
         sst.academic_year_id,
         sst.term,
         stg.id AS stage_id,
         stg.name AS stage_name,
         g.id AS grade_id,
         g.name AS grade_name,
         sec.id AS section_id,
         sec.name AS section_name
       FROM section_subject_teachers sst
       JOIN sections sec ON sec.id = sst.section_id AND sec.school_id = $2
       JOIN grades g ON g.id = sec.grade_id AND g.school_id = $2
       JOIN stages stg ON stg.id = g.stage_id AND stg.school_id = $2
       WHERE sst.teacher_id = $1
         AND sst.school_id = $2
         AND COALESCE(sst.status, 'active') = 'active'
       ORDER BY sst.academic_year_id DESC, sst.term DESC, stg.name, g.name, sec.name`,
      [teacherId, schoolId]
    );
    return res.json({ items: rows });
  } catch (error) {
    return next(error);
  }
}

export async function listScopeStudents(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const academicYearId = Number(req.query.academic_year_id);
    const term = Number(req.query.term);
    const sectionId = Number(req.query.section_id);
    const q = String(req.query.q || "").trim();
    if (!academicYearId || !term || !sectionId) {
      return res.status(400).json({ message: "academic_year_id و term و section_id مطلوبة" });
    }

    const allowed = await assertTeacherScope({ teacherId, schoolId, academicYearId, term, sectionId });
    if (!allowed) return res.status(403).json({ message: "هذه الشعبة ليست ضمن نطاقك" });

    const { rows } = await pool.query(
      `SELECT
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
       LIMIT 400`,
      [academicYearId, term, sectionId, q, schoolId]
    );
    return res.json({ items: rows });
  } catch (error) {
    return next(error);
  }
}

export async function listStudentGuardians(req, res, next) {
  try {
    const userId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const studentId = Number(req.params.studentId);
    if (!studentId) return res.status(400).json({ message: "studentId غير صحيح" });

    const allowed = await canTeacherAccessStudent({ teacherId, schoolId, studentId });
    if (!allowed) return res.status(403).json({ message: "الطالب ليس ضمن نطاق المعلم" });

    const { rows } = await pool.query(
      `SELECT
         g.id AS guardian_id,
         g.user_id AS guardian_user_id,
         COALESCE(g.full_name, u.name, 'ولي أمر') AS guardian_name
       FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $2
       JOIN users u
         ON u.id = g.user_id
        AND u.school_id = $2
        AND COALESCE(u.status, 'active') = 'active'
       WHERE sg.student_id = $1 AND sg.school_id = $2
       ORDER BY guardian_name ASC`,
      [studentId, schoolId]
    );
    return res.json({ items: rows });
  } catch (error) {
    return next(error);
  }
}

export async function sendToAdmins(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const senderName = await getUserDisplayName(senderUserId, schoolId);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) return res.status(400).json({ message: "العنوان والنص مطلوبان" });

    const adminIds = await getAdminUserIds({ schoolId });
    if (!adminIds.length) return res.status(400).json({ message: "لا توجد حسابات إدارة لهذه المدرسة" });

    const out = await sendManualNotification({
      req,
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: adminIds,
      meta: { ui_source: "teacher_send_admins" },
    });
    return res.json({ ok: true, notification_id: out.notificationId, recipients: out.inserted });
  } catch (error) {
    return next(error);
  }
}

export async function sendToStudents(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(senderUserId, schoolId);
    if (!teacherId) return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

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
    const academicYearId = Number(academic_year_id);
    const normalizedTerm = Number(term);
    if (!title || !body || !academicYearId || !normalizedTerm) {
      return res.status(400).json({ message: "جميع الحقول الأساسية مطلوبة" });
    }

    let recipientUserIds = [];
    if (mode === "selected") {
      const allowedStudentIds = await assertAllStudentsWithinTeacherScope({
        teacherId,
        schoolId,
        academicYearId,
        term: normalizedTerm,
        studentIds: student_ids,
      });
      const { rows } = await pool.query(
        `SELECT user_id FROM students
         WHERE id = ANY($1::int[])
           AND school_id = $2
           AND user_id IS NOT NULL`,
        [allowedStudentIds, schoolId]
      );
      recipientUserIds = rows.map((row) => row.user_id);
    } else if (mode === "section_all") {
      const sectionId = Number(section_id);
      if (!sectionId) return res.status(400).json({ message: "section_id مطلوب" });
      const allowed = await assertTeacherScope({
        teacherId,
        schoolId,
        academicYearId,
        term: normalizedTerm,
        sectionId,
      });
      if (!allowed) return res.status(403).json({ message: "هذه الشعبة ليست ضمن نطاقك" });

      const { rows } = await pool.query(
        `SELECT st.user_id
         FROM student_enrollments se
         JOIN students st ON st.id = se.student_id AND st.school_id = $4
         WHERE se.academic_year_id = $1
           AND se.term = $2
           AND se.section_id = $3
           AND se.school_id = $4
           AND st.user_id IS NOT NULL`,
        [academicYearId, normalizedTerm, sectionId, schoolId]
      );
      recipientUserIds = rows.map((row) => row.user_id);
    } else if (mode === "grade_all") {
      const gradeId = Number(grade_id);
      if (!gradeId) return res.status(400).json({ message: "grade_id مطلوب" });
      const { rows } = await pool.query(
        `SELECT DISTINCT st.user_id
         FROM student_enrollments se
         JOIN students st ON st.id = se.student_id AND st.school_id = $5
         JOIN sections sec ON sec.id = se.section_id AND sec.school_id = $5
         JOIN section_subject_teachers sst
           ON sst.section_id = se.section_id
          AND sst.academic_year_id = se.academic_year_id
          AND sst.term = se.term
          AND sst.school_id = se.school_id
          AND COALESCE(sst.status, 'active') = 'active'
         WHERE se.academic_year_id = $1
           AND se.term = $2
           AND sec.grade_id = $3
           AND sst.teacher_id = $4
           AND se.school_id = $5
           AND st.user_id IS NOT NULL`,
        [academicYearId, normalizedTerm, gradeId, teacherId, schoolId]
      );
      recipientUserIds = rows.map((row) => row.user_id);
    } else {
      return res.status(400).json({ message: "نوع الإرسال غير صالح" });
    }

    if (!uniquePositiveIds(recipientUserIds).length) {
      return res.status(400).json({ message: "لا يوجد مستلمون ضمن النطاق الحالي" });
    }

    const out = await sendManualNotification({
      req,
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds,
      meta: {
        ui_source: "teacher_send_students",
        mode,
        academic_year_id: academicYearId,
        term: normalizedTerm,
        section_id: Number(section_id) || null,
        grade_id: Number(grade_id) || null,
      },
    });
    return res.json({ ok: true, notification_id: out.notificationId, recipients: out.inserted });
  } catch (error) {
    return next(error);
  }
}

export async function sendToGuardians(req, res, next) {
  try {
    const senderUserId = req.user.id;
    const schoolId = req.user.school_id;
    const teacherId = await getTeacherIdByUserId(senderUserId, schoolId);
    if (!teacherId) return res.status(404).json({ message: "لم يتم العثور على سجل المعلم" });

    const senderName = await getUserDisplayName(senderUserId, schoolId);
    const {
      title,
      body,
      academic_year_id,
      term,
      student_ids = [],
      guardian_user_ids = null,
    } = req.body || {};
    const academicYearId = Number(academic_year_id);
    const normalizedTerm = Number(term);
    if (!title || !body || !academicYearId || !normalizedTerm || !student_ids.length) {
      return res.status(400).json({ message: "البيانات الأساسية مطلوبة" });
    }

    const allowedStudentIds = await assertAllStudentsWithinTeacherScope({
      teacherId,
      schoolId,
      academicYearId,
      term: normalizedTerm,
      studentIds: student_ids,
    });

    const { rows } = await pool.query(
      `SELECT DISTINCT u.id AS user_id
       FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $2
       JOIN users u
         ON u.id = g.user_id
        AND u.school_id = $2
        AND COALESCE(u.status, 'active') = 'active'
       WHERE sg.student_id = ANY($1::int[])
         AND sg.school_id = $2`,
      [allowedStudentIds, schoolId]
    );

    const allowedGuardianIds = uniquePositiveIds(rows.map((row) => row.user_id));
    const requestedGuardianIds = uniquePositiveIds(guardian_user_ids || []);
    const finalGuardianIds = requestedGuardianIds.length
      ? allowedGuardianIds.filter((id) => requestedGuardianIds.includes(id))
      : allowedGuardianIds;

    if (!finalGuardianIds.length) {
      return res.status(400).json({ message: "لا يوجد أولياء أمور صالحون لهؤلاء الطلاب" });
    }

    const out = await sendManualNotification({
      req,
      schoolId,
      senderUserId,
      senderDisplayName: senderName,
      title,
      body,
      recipientUserIds: finalGuardianIds,
      meta: {
        ui_source: "teacher_send_guardians",
        academic_year_id: academicYearId,
        term: normalizedTerm,
        student_ids: allowedStudentIds,
      },
    });
    return res.json({ ok: true, notification_id: out.notificationId, recipients: out.inserted });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
}
