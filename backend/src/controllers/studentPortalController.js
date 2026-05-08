// src/controllers/studentPortalController.js
import { pool } from "../config/db.js";

const DAYS = [
  { id: 1, name: "السبت" },
  { id: 2, name: "الأحد" },
  { id: 3, name: "الاثنين" },
  { id: 4, name: "الثلاثاء" },
  { id: 5, name: "الأربعاء" },
  { id: 6, name: "الخميس" },
];

// ====== Exam constants ======
const EXAM_MONTHS = [
  { id: 1, name: "يناير" }, { id: 2, name: "فبراير" }, { id: 3, name: "مارس" },
  { id: 4, name: "أبريل" }, { id: 5, name: "مايو" }, { id: 6, name: "يونيو" },
  { id: 7, name: "يوليو" }, { id: 8, name: "أغسطس" }, { id: 9, name: "سبتمبر" },
  { id: 10, name: "أكتوبر" }, { id: 11, name: "نوفمبر" }, { id: 12, name: "ديسمبر" },
];

const EXAM_TYPES = [
  { id: "monthly", name: "اختبار شهري" },
  { id: "midyear", name: "اختبار نصف العام" },
  { id: "final", name: "اختبار آخر العام" },
];

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidExamType(t) {
  return ["monthly", "midyear", "final"].includes(String(t || ""));
}

export const getStudentHeroStats = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    // ✅ تحديث الاستعلام ليشمل school_id في كل المراحل
    const query = `
      WITH current_student AS (
        SELECT s.id AS student_id
        FROM students s
        WHERE s.user_id = $1 AND s.school_id = $2
        LIMIT 1
      ),
      current_year AS (
        SELECT ay.id AS academic_year_id
        FROM academic_years ay
        WHERE ay.is_active = true AND ay.school_id = $2
        ORDER BY ay.id DESC
        LIMIT 1
      ),
      attendance_stats AS (
        SELECT
          COUNT(*) AS total_sessions,
          COUNT(*) FILTER (
            WHERE ae.status IN ('present', 'late')
          ) AS attended_sessions
        FROM attendance_entries ae
        JOIN attendance_sessions ats
          ON ats.id = ae.session_id
        JOIN current_student cs
          ON cs.student_id = ae.student_id
        JOIN current_year cy
          ON cy.academic_year_id = ats.academic_year_id
        WHERE ats.school_id = $2
      ),
      grade_stats AS (
        SELECT
          COALESCE(
            ROUND(
              (
                SUM(COALESCE(ag.score, 0)) /
                NULLIF(SUM(a.max_score), 0)::numeric
              ) * 100,
              2
            ),
            0
          ) AS average_grade
        FROM assessment_grades ag
        JOIN assessments a
          ON a.id = ag.assessment_id
        JOIN teacher_assignments ta
          ON ta.id = a.teacher_assignment_id
        JOIN current_student cs
          ON cs.student_id = ag.student_id
        JOIN current_year cy
          ON cy.academic_year_id = ta.academic_year_id
        WHERE ag.is_published = true
          AND ag.score IS NOT NULL
          AND ag.school_id = $2
      ),
      fee_stats AS (
        SELECT
          COALESCE(
            SUM(
              GREATEST(fi.amount - COALESCE(fi.paid_amount, 0), 0)
            ),
            0
          ) AS remaining_fees
        FROM fee_contracts fc
        JOIN fee_installments fi
          ON fi.contract_id = fc.id
        JOIN current_student cs
          ON cs.student_id = fc.student_id
        JOIN current_year cy
          ON cy.academic_year_id = fc.academic_year_id
        WHERE fc.status = 'active' AND fc.school_id = $2
      )
      SELECT
        cs.student_id,
        COALESCE(
          ROUND(
            (
              attendance_stats.attended_sessions::numeric /
              NULLIF(attendance_stats.total_sessions, 0)
            ) * 100,
            2
          ),
          0
        ) AS attendance_rate,
        COALESCE(grade_stats.average_grade, 0) AS average_grade,
        COALESCE(fee_stats.remaining_fees, 0) AS remaining_fees
      FROM current_student cs
      LEFT JOIN attendance_stats ON true
      LEFT JOIN grade_stats ON true
      LEFT JOIN fee_stats ON true;
    `;

    const { rows } = await pool.query(query, [userId, schoolId]);

    if (!rows.length) {
      return res.status(404).json({
        message: "لم يتم العثور على الطالب المرتبط بهذا المستخدم في مدرستك",
      });
    }

    const row = rows[0];

    return res.json({
      studentId: row.student_id,
      attendanceRate: Number(row.attendance_rate || 0),
      averageGrade: Number(row.average_grade || 0),
      remainingFees: Number(row.remaining_fees || 0),
    });
  } catch (error) {
    console.error("getStudentHeroStats error:", error);
    return res.status(500).json({ message: "خطأ في جلب بيانات الشريط العلوي" });
  }
};

// ====== shared helper: get student + last enrollment ======
async function getStudentAndEnrollment(userId, academicYearIdQ, schoolId) {
  // 1) الطالب المرتبط بالمستخدم في نفس المدرسة ✅
  const studentQ = await pool.query(
    `SELECT id, user_id, full_name
     FROM students
     WHERE user_id = $1 AND school_id = $2
     LIMIT 1`,
    [userId, schoolId]
  );

  const student = studentQ.rows[0] || null;
  if (!student) return { student: null, enrollment: null, academicYearId: null };

  // 2) آخر تسجيل enrollment في نفس المدرسة ✅
  const enrollQ = await pool.query(
    `
    SELECT
      se.*,
      ay.name AS year_name,
      st.name AS stage_name,
      g.name  AS grade_name,
      sc.name AS section_name
    FROM student_enrollments se
    JOIN academic_years ay ON ay.id = se.academic_year_id
    JOIN stages st ON st.id = se.stage_id
    JOIN grades g  ON g.id  = se.grade_id
    JOIN sections sc ON sc.id = se.section_id
    WHERE se.student_id = $1 AND se.school_id = $3
      AND ($2::int IS NULL OR se.academic_year_id = $2)
    ORDER BY se.id DESC
    LIMIT 1
    `,
    [student.id, academicYearIdQ, schoolId]
  );

  const enrollment = enrollQ.rows[0] || null;
  if (!enrollment) return { student, enrollment: null, academicYearId: null };

  const academicYearId = academicYearIdQ || enrollment.academic_year_id;
  return { student, enrollment, academicYearId };
}

// =========================
// GET /api/student/meta
// =========================
export const getMeta = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    // ✅ جلب سنوات وحصص المدرسة فقط
    const yearsQ = await pool.query(`SELECT id, name FROM academic_years WHERE school_id = $1 ORDER BY id DESC`, [schoolId]);

    const periodsQ = await pool.query(
      `SELECT id, name, start_time, end_time, sort_order
       FROM periods
       WHERE school_id = $1
       ORDER BY sort_order ASC`,
       [schoolId]
    );

    return res.json({
      data: {
        days: DAYS,
        years: yearsQ.rows,
        periods: periodsQ.rows,
      },
    });
  } catch (e) {
    console.error("studentPortal getMeta error:", e);
    return res.status(500).json({ message: "فشل تحميل meta" });
  }
};

// =========================
// GET /api/student/timetable
// =========================
export const getTimetable = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const term = toInt(req.query.term) || 1;
    const academicYearIdQ = req.query.academicYearId ? toInt(req.query.academicYearId) : null;

    const { student, enrollment, academicYearId } = await getStudentAndEnrollment(userId, academicYearIdQ, schoolId);

    if (!student) return res.status(404).json({ message: "لا يوجد طالب مرتبط بهذا المستخدم" });

    if (!enrollment) {
      return res.json({
        data: { student, enrollment: null, timetable: null, entries: [] },
        message: "لا يوجد تسجيل (enrollment) لهذا الطالب.",
      });
    }

    // جدول منشور في مدرسة الطالب ✅
    const ttQ = await pool.query(
      `
      SELECT id, status
      FROM timetables
      WHERE academic_year_id = $1
        AND term = $2
        AND stage_id = $3
        AND grade_id = $4
        AND section_id = $5
        AND status = 'published'
        AND school_id = $6
      ORDER BY id DESC
      LIMIT 1
      `,
      [academicYearId, term, enrollment.stage_id, enrollment.grade_id, enrollment.section_id, schoolId]
    );

    const tt = ttQ.rows[0] || null;
    if (!tt) {
      return res.json({
        data: { student, enrollment, timetable: null, entries: [] },
        message: "لا يوجد جدول منشور لهذه الشعبة/الترم.",
      });
    }

    const weekStart = String(req.query.weekStart || "").slice(0, 10);
    const hasWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekStart);

    let joinOverrides = `LEFT JOIN timetable_overrides o ON 1=0`;
    const params = [tt.id];

    if (hasWeekStart) {
      joinOverrides = `
        LEFT JOIN timetable_overrides o
          ON o.timetable_id = te.timetable_id
          AND o.period_id = te.period_id
          AND o.day_of_week = te.day_of_week
          AND o.date BETWEEN $2::date AND ($2::date + interval '6 day')::date
          AND o.school_id = $3
      `;
      params.push(weekStart, schoolId);
    }

    const entriesQ = await pool.query(
      `
      SELECT
        te.id,
        te.day_of_week,
        te.period_id,
        p.name AS period_name,
        p.start_time,
        p.end_time,

        COALESCE(o.type, 'lesson') AS type,
        COALESCE(o.room, te.room) AS room,
        COALESCE(o.notes, te.notes) AS notes,

        COALESCE(o.subject_id, te.subject_id) AS subject_id,
        COALESCE(sub2.name, sub.name) AS subject_name,

        COALESCE(o.teacher_id, te.teacher_id) AS teacher_id,
        COALESCE(tch2.full_name, tch.full_name) AS teacher_name,

        o.exam_title,
        o.exam_kind,
        o.exam_total,
        (o.date::date) AS override_date

      FROM timetable_entries te
      JOIN periods p ON p.id = te.period_id
      LEFT JOIN subjects sub ON sub.id = te.subject_id
      LEFT JOIN teachers tch ON tch.id = te.teacher_id

      ${joinOverrides}
      LEFT JOIN subjects sub2 ON sub2.id = o.subject_id
      LEFT JOIN teachers tch2 ON tch2.id = o.teacher_id

      WHERE te.timetable_id = $1
      ORDER BY te.day_of_week ASC, p.sort_order ASC
      `,
      params
    );

    return res.json({
      data: {
        student,
        enrollment,
        timetable: {
          id: tt.id,
          status: tt.status,
          academic_year_id: academicYearId,
          term,
        },
        weekStart: hasWeekStart ? weekStart : null,
        entries: entriesQ.rows,
      },
    });
  } catch (e) {
    console.error("studentPortal getTimetable error:", e);
    return res.status(500).json({ message: "فشل تحميل جدول الطالب" });
  }
};

// =========================
// GET /api/student/exams/meta
// =========================
export const getExamMeta = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const academicYearIdQ = req.query.academicYearId ? toInt(req.query.academicYearId) : null;

    const { student, enrollment, academicYearId } = await getStudentAndEnrollment(userId, academicYearIdQ, schoolId);

    if (!student) return res.status(404).json({ message: "لا يوجد طالب مرتبط بهذا المستخدم" });

    // ✅ جلب مواد المدرسة فقط
    const subjectsQ = await pool.query(
      `SELECT id, name FROM subjects WHERE is_active=true AND school_id = $1 ORDER BY name`,
      [schoolId]
    );

    return res.json({
      data: {
        student,
        enrollment,
        academicYearId: academicYearId || academicYearIdQ || null,
        examTypes: EXAM_TYPES,
        months: EXAM_MONTHS,
        subjects: subjectsQ.rows,
      },
    });
  } catch (e) {
    console.error("studentPortal getExamMeta error:", e);
    return res.status(500).json({ message: "فشل تحميل meta الامتحانات" });
  }
};

// =========================
// GET /api/student/exams
// =========================
export const getExams = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const academicYearIdQ = req.query.academicYearId ? toInt(req.query.academicYearId) : null;
    const examTypeRaw = String(req.query.examType || "").trim();
    const examType = isValidExamType(examTypeRaw) ? examTypeRaw : "";
    const monthRaw = toInt(req.query.month);
    const month = examType === "monthly" && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;
    const subjectId = toInt(req.query.subjectId);

    const { student, enrollment, academicYearId } = await getStudentAndEnrollment(userId, academicYearIdQ, schoolId);

    if (!student) return res.status(404).json({ message: "لا يوجد طالب مرتبط بهذا المستخدم" });

    if (!enrollment || !academicYearId) {
      return res.json({
        data: { student, enrollment: enrollment || null, exams: [] },
        message: "لا يوجد تسجيل (enrollment) لهذا الطالب.",
      });
    }

    // ✅ تصفية جداول الامتحانات بمدرسة الطالب
    const wh = [
      "et.status='published'",
      "et.academic_year_id=$1",
      "et.stage_id=$2",
      "et.grade_id=$3",
      "(et.scope='grade' OR (et.scope='section' AND et.section_id=$4))",
      "et.school_id=$5"
    ];
    const params = [academicYearId, enrollment.stage_id, enrollment.grade_id, enrollment.section_id, schoolId];
    let idx = 6;

    if (examType) {
      wh.push(`et.exam_type=$${idx++}`);
      params.push(examType);
    }
    if (examType === "monthly" && month) {
      wh.push(`et.month=$${idx++}`);
      params.push(month);
    }

    let subjectWhere = "";
    if (subjectId) {
      subjectWhere = ` AND e.subject_id = $${idx++}`;
      params.push(subjectId);
    }

    const q = `
      WITH tts AS (
        SELECT et.id, et.exam_type, et.month, et.scope, et.section_id
        FROM exam_timetables et
        WHERE ${wh.join(" AND ")}
      )
      SELECT
        e.id,
        e.exam_timetable_id,
        t.exam_type,
        t.month,
        t.scope,
        e.exam_date AS date,
        to_char(e.start_time,'HH24:MI') AS start_time,
        to_char(e.end_time,'HH24:MI') AS end_time,
        e.room,
        e.notes,
        e.subject_id,
        s.name AS subject_name,
        e.apply_to_section_id,
        sc.name AS apply_to_section_name
      FROM exam_timetable_entries e
      JOIN tts t ON t.id = e.exam_timetable_id
      JOIN subjects s ON s.id = e.subject_id
      LEFT JOIN sections sc ON sc.id = e.apply_to_section_id
      WHERE
        (
          t.scope='section'
          OR (
            t.scope='grade'
            AND (e.apply_to_section_id IS NULL OR e.apply_to_section_id=$4)
          )
        )
        ${subjectWhere}
      ORDER BY e.exam_date ASC, e.start_time ASC
    `;

    const rows = await pool.query(q, params);

    return res.json({
      data: {
        student,
        enrollment,
        academicYearId,
        filters: { examType: examType || null, month: month || null, subjectId: subjectId || null },
        exams: rows.rows,
      },
    });
  } catch (e) {
    console.error("studentPortal getExams error:", e);
    return res.status(500).json({ message: "فشل تحميل جدول الامتحانات للطالب" });
  }
};