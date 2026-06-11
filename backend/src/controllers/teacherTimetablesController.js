// src/controllers/teacherTimetablesController.js
import { pool } from "../config/db.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ✅ تم إضافة schoolId
async function getTeacherByUserId(userId, schoolId) {
  const q = await pool.query(
    "SELECT id, full_name, phone, user_id FROM teachers WHERE user_id=$1 AND school_id=$2 LIMIT 1",
    [userId, schoolId]
  );
  return q.rows[0] || null;
}

const days = [
  { id: 1, name: "السبت" },
  { id: 2, name: "الأحد" },
  { id: 3, name: "الاثنين" },
  { id: 4, name: "الثلاثاء" },
  { id: 5, name: "الأربعاء" },
  { id: 6, name: "الخميس" },
  { id: 7, name: "الجمعة" },
];

const MONTHS_AR = [
  { id: 1, name: "يناير" },
  { id: 2, name: "فبراير" },
  { id: 3, name: "مارس" },
  { id: 4, name: "أبريل" },
  { id: 5, name: "مايو" },
  { id: 6, name: "يونيو" },
  { id: 7, name: "يوليو" },
  { id: 8, name: "أغسطس" },
  { id: 9, name: "سبتمبر" },
  { id: 10, name: "أكتوبر" },
  { id: 11, name: "نوفمبر" },
  { id: 12, name: "ديسمبر" },
];

function isExamType(t) {
  return ["monthly", "midyear", "final"].includes(String(t || ""));
}

// ✅ تم إضافة schoolId
async function getTeacherSubjectIds(teacherId, schoolId) {
  const q = await pool.query(
    `
    SELECT DISTINCT te.subject_id
    FROM timetable_entries te
    JOIN timetables tt ON tt.id = te.timetable_id
    WHERE te.teacher_id = $1
      AND tt.status = 'published'
      AND tt.school_id = $2
    `,
    [teacherId, schoolId]
  );
  return q.rows.map((r) => r.subject_id).filter(Boolean);
}

export const TeacherTimetablesController = {
  // =========================
  // GET /api/teacher/timetables/meta
  // =========================
  async meta(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) {
        return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });
      }

      // ✅ فلترة حسب المدرسة
      const [yearsQ, periodsQ, settingsQ] = await Promise.all([
        pool.query(
          "SELECT id, name, is_active FROM academic_years WHERE school_id = $1 ORDER BY is_active DESC, id DESC",
          [schoolId]
        ),
        pool.query(
          "SELECT id, name, start_time, end_time, sort_order FROM periods WHERE school_id = $1 ORDER BY sort_order",
          [schoolId]
        ),
        pool.query(
          "SELECT working_days FROM school_settings WHERE school_id = $1 LIMIT 1",
          [schoolId]
        ),
      ]);

      const subjectsQ = await pool.query(
        `
        SELECT DISTINCT s.id, s.name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN subjects s ON s.id = te.subject_id
        WHERE te.teacher_id = $1
          AND tt.status = 'published'
          AND tt.school_id = $2
        ORDER BY s.name
        `,
        [teacher.id, schoolId]
      );

      return res.json({
        data: {
          teacher: {
            id: teacher.id,
            full_name: teacher.full_name,
            phone: teacher.phone,
          },
          years: yearsQ.rows,
          terms: [1, 2],
          days,
          periods: periodsQ.rows,
          working_days: settingsQ.rows[0]?.working_days || [],
          subjects: subjectsQ.rows,
        },
      });
    } catch (e) {
      console.error("teacher timetables meta error:", e);
      return res.status(500).json({ message: "خطأ في تحميل بيانات بوابة المعلّم" });
    }
  },

  // =========================
  // GET /api/teacher/timetables?academicYearId=&term=&status=&weekStart=YYYY-MM-DD
  // =========================
  async list(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      let academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      const status = (req.query.status || "published").toLowerCase();

      const weekStart = String(req.query.weekStart || "").slice(0, 10);
      const hasWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekStart);

      if (!academicYearId) {
        const lastYear = await pool.query("SELECT id FROM academic_years WHERE school_id = $1 ORDER BY id DESC LIMIT 1", [schoolId]);
        academicYearId = lastYear.rows[0]?.id || null;
      }
      if (!academicYearId) return res.status(400).json({ message: "academicYearId مطلوب" });

      // ✅ فلترة حسب المدرسة
      const wh = ["tt.academic_year_id = $1", "tt.term = $2", "tt.school_id = $3"];
      const params = [academicYearId, term, schoolId];

      if (status !== "all") {
        wh.push(`tt.status = $${params.length + 1}`);
        params.push(status);
      }

      let joinOverrides = `LEFT JOIN timetable_overrides o ON 1=0`;
      if (hasWeekStart) {
        joinOverrides = `
          LEFT JOIN timetable_overrides o
            ON o.timetable_id = tt.id
           AND o.period_id = te.period_id
           AND o.day_of_week = te.day_of_week
           AND o.date BETWEEN $${params.length + 1}::date AND ($${params.length + 1}::date + interval '6 day')::date
        `;
        params.push(weekStart);
      }

      const teacherParamIdx = params.length + 1;
      wh.push(`(te.teacher_id = $${teacherParamIdx} OR (o.teacher_id IS NOT NULL AND o.teacher_id = $${teacherParamIdx}))`);
      params.push(teacher.id);

      const q = `
        SELECT
          te.id, te.day_of_week, te.period_id, p.name AS period_name, p.start_time, p.end_time, p.sort_order,
          COALESCE(o.type, 'lesson') AS type, COALESCE(o.room, te.room) AS room, COALESCE(o.notes, te.notes) AS notes,
          COALESCE(o.subject_id, te.subject_id) AS subject_id, COALESCE(s2.name, s.name) AS subject_name,
          COALESCE(o.teacher_id, te.teacher_id) AS teacher_id, o.exam_title, o.exam_kind, o.exam_total,
          tt.id AS timetable_id, tt.status, tt.stage_id, st.name AS stage_name, tt.grade_id, gr.name AS grade_name,
          tt.section_id, sc.name AS section_name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN periods p ON p.id = te.period_id
        JOIN subjects s ON s.id = te.subject_id
        ${joinOverrides}
        LEFT JOIN subjects s2 ON s2.id = o.subject_id
        JOIN stages st ON st.id = tt.stage_id
        JOIN grades gr ON gr.id = tt.grade_id
        JOIN sections sc ON sc.id = tt.section_id
        WHERE ${wh.join(" AND ")}
        ORDER BY te.day_of_week, p.sort_order
        LIMIT 1500
      `;

      const rows = await pool.query(q, params);

      return res.json({
        data: {
          teacher: { id: teacher.id, full_name: teacher.full_name },
          academicYearId,
          term,
          status,
          weekStart: hasWeekStart ? weekStart : null,
          entries: rows.rows,
        },
      });
    } catch (e) {
      console.error("teacher timetables list error:", e);
      return res.status(500).json({ message: "خطأ في جلب جدول المعلّم" });
    }
  },

  // =========================
  // GET /api/teacher/timetables/classes?academicYearId=&term=
  // =========================
  async classes(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      const academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      if (!academicYearId) return res.status(400).json({ message: "academicYearId مطلوب" });

      // ✅ فلترة حسب المدرسة
      const q = `
        SELECT DISTINCT
          tt.stage_id, st.name AS stage_name,
          tt.grade_id, gr.name AS grade_name,
          tt.section_id, sc.name AS section_name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN stages st ON st.id = tt.stage_id
        JOIN grades gr ON gr.id = tt.grade_id
        JOIN sections sc ON sc.id = tt.section_id
        WHERE tt.academic_year_id = $1
          AND tt.term = $2
          AND te.teacher_id = $3
          AND tt.school_id = $4
          AND tt.status = 'published'
        ORDER BY st.name, gr.name, sc.name
      `;
      const rows = await pool.query(q, [academicYearId, term, teacher.id, schoolId]);

      return res.json({ data: rows.rows });
    } catch (e) {
      console.error("teacher classes error:", e);
      return res.status(500).json({ message: "خطأ في جلب شعب المعلّم" });
    }
  },

  // =========================
  // GET /api/teacher/timetables/exams/meta
  // =========================
  async examsMeta(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      const yearsQ = await pool.query(
        "SELECT id, name FROM academic_years WHERE school_id = $1 ORDER BY id DESC", [schoolId]
      );

      const subjectsQ = await pool.query(
        `
        SELECT DISTINCT s.id, s.name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN subjects s ON s.id = te.subject_id
        WHERE te.teacher_id = $1
          AND tt.school_id = $2
          AND tt.status = 'published'
        ORDER BY s.name
        `,
        [teacher.id, schoolId]
      );

      return res.json({
        data: {
          teacher: { id: teacher.id, full_name: teacher.full_name },
          years: yearsQ.rows,
          terms: [1, 2],
          examTypes: ["monthly", "midyear", "final"],
          months: MONTHS_AR,
          subjects: subjectsQ.rows,
        },
      });
    } catch (e) {
      console.error("teacher exams meta error:", e);
      return res.status(500).json({ message: "خطأ في تحميل ميتا الاختبارات" });
    }
  },

  // =========================
  // GET /api/teacher/timetables/exams?academicYearId=&term=&examType=&month=&subjectId=
  // =========================
  async examsList(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      let academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      const examType = String(req.query.examType || "midyear").trim();
      const month = toInt(req.query.month);
      const subjectId = toInt(req.query.subjectId);

      if (!isExamType(examType)) return res.status(400).json({ message: "examType غير صحيح" });

      if (!academicYearId) {
        const lastYear = await pool.query("SELECT id FROM academic_years WHERE school_id = $1 ORDER BY id DESC LIMIT 1", [schoolId]);
        academicYearId = lastYear.rows[0]?.id || null;
      }
      if (!academicYearId) return res.status(400).json({ message: "academicYearId مطلوب" });

      const teacherSubjectIds = await getTeacherSubjectIds(teacher.id, schoolId);
      if (!teacherSubjectIds.length) {
        return res.json({
          data: { teacher: { id: teacher.id, full_name: teacher.full_name }, academicYearId, term, examType, exams: [], entries: [] },
        });
      }

      if (subjectId && !teacherSubjectIds.includes(subjectId)) {
        return res.json({
          data: { teacher: { id: teacher.id, full_name: teacher.full_name }, academicYearId, term, examType, exams: [], entries: [] },
        });
      }

      // ✅ فلترة المدرسة بشكل محكم
      const wh = [
        "et.academic_year_id = $1",
        "et.status = 'published'",
        "et.exam_type = $2",
        "ee.subject_id = ANY($3::int[])",
        "et.school_id = $4",
        `EXISTS (
          SELECT 1
          FROM timetable_entries te2
          JOIN timetables tt2 ON tt2.id = te2.timetable_id
          WHERE te2.teacher_id = $5
            AND tt2.academic_year_id = $1
            AND tt2.term = $6
            AND tt2.school_id = $4
            AND tt2.status = 'published'
            AND tt2.stage_id = et.stage_id
            AND tt2.grade_id = et.grade_id
            AND (et.section_id IS NULL OR tt2.section_id = et.section_id)
            AND te2.subject_id = ee.subject_id
        )`,
      ];

      const params = [academicYearId, examType, teacherSubjectIds, schoolId, teacher.id, term];

      if (examType === "monthly" && month) {
        wh.push(`EXTRACT(MONTH FROM ee.exam_date)::int = $${params.length + 1}`);
        params.push(month);
      }
      if (subjectId) {
        wh.push(`ee.subject_id = $${params.length + 1}`);
        params.push(subjectId);
      }

      const q = `
        SELECT
          ee.id, ee.exam_date::date AS exam_date, ee.start_time, ee.end_time, ee.room, ee.notes,
          ee.subject_id, s.name AS subject_name, et.id AS exam_timetable_id, et.exam_type,
          et.stage_id, st.name AS stage_name, et.grade_id, gr.name AS grade_name, et.section_id, sc.name AS section_name
        FROM exam_timetable_entries ee
        JOIN exam_timetables et ON et.id = ee.exam_timetable_id
        JOIN subjects s ON s.id = ee.subject_id
        JOIN stages st ON st.id = et.stage_id
        JOIN grades gr ON gr.id = et.grade_id
        LEFT JOIN sections sc ON sc.id = et.section_id
        WHERE ${wh.join(" AND ")}
        ORDER BY ee.exam_date ASC, ee.start_time ASC NULLS LAST
        LIMIT 2000
      `;

      const rows = await pool.query(q, params);

      return res.json({
        data: {
          teacher: { id: teacher.id, full_name: teacher.full_name },
          academicYearId, term, examType, month: examType === "monthly" ? month || null : null,
          subjectId: subjectId || null, exams: rows.rows, entries: rows.rows,
        },
      });
    } catch (e) {
      console.error("teacher exams list error:", e);
      return res.status(500).json({ message: "خطأ في جلب جدول الاختبارات" });
    }
  },

  // ============================================================
  // ✅✅ NEW: الطلاب
  // ============================================================

  // =========================
  // GET /api/teacher/timetables/students/scopes?academicYearId=&term=
  // =========================
  async studentsScopes(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      const academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      if (!academicYearId) return res.status(400).json({ message: "academicYearId مطلوب" });

      // ✅ فلترة حسب المدرسة
      const q = `
        SELECT DISTINCT
          tt.stage_id, st.name AS stage_name,
          tt.grade_id, gr.name AS grade_name,
          tt.section_id, sc.name AS section_name,
          te.subject_id, su.name AS subject_name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN stages st ON st.id = tt.stage_id
        JOIN grades gr ON gr.id = tt.grade_id
        JOIN sections sc ON sc.id = tt.section_id
        JOIN subjects su ON su.id = te.subject_id
        WHERE tt.academic_year_id = $1
          AND tt.term = $2
          AND te.teacher_id = $3
          AND tt.school_id = $4
          AND tt.status = 'published'
        ORDER BY st.name, gr.name, sc.name, su.name
      `;

      const rows = await pool.query(q, [academicYearId, term, teacher.id, schoolId]);

      return res.json({ data: { academicYearId, term, scopes: rows.rows } });
    } catch (e) {
      console.error("teacher students scopes error:", e);
      return res.status(500).json({ message: "خطأ في جلب نطاقات طلاب المعلّم" });
    }
  },

  // =========================
  // GET /api/teacher/timetables/students?academicYearId=&term=&stageId=&gradeId=&sectionId=&search=
  // =========================
  async studentsList(req, res) {
    try {
      const userId = req.user?.id;
      const schoolId = req.user?.school_id;
      if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacher = await getTeacherByUserId(userId, schoolId);
      if (!teacher) return res.status(404).json({ message: "لا يوجد معلم مرتبط بهذا المستخدم" });

      const academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      const stageId = toInt(req.query.stageId);
      const gradeId = toInt(req.query.gradeId);
      const sectionId = toInt(req.query.sectionId);
      const search = String(req.query.search || "").trim();

      if (!academicYearId) return res.status(400).json({ message: "academicYearId مطلوب" });
      if (!stageId || !gradeId || !sectionId) return res.status(400).json({ message: "stageId/gradeId/sectionId مطلوبة" });

      // ✅ التحقق من المدرسة
      const allowQ = await pool.query(
        `
        SELECT 1
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        WHERE te.teacher_id = $1
          AND tt.academic_year_id = $2
          AND tt.term = $3
          AND tt.stage_id = $4
          AND tt.grade_id = $5
          AND tt.section_id = $6
          AND tt.school_id = $7
          AND tt.status = 'published'
        LIMIT 1
        `,
        [teacher.id, academicYearId, term, stageId, gradeId, sectionId, schoolId]
      );
      if (!allowQ.rows.length) return res.status(403).json({ message: "هذه الشعبة ليست ضمن شعب هذا المعلّم" });

      // ✅ جلب الطلاب المسجلين مع إضافة e.school_id = $5
      const params = [academicYearId, stageId, gradeId, sectionId, schoolId];
      let where = `
        e.academic_year_id = $1
        AND e.stage_id = $2
        AND e.grade_id = $3
        AND e.section_id = $4
        AND e.school_id = $5
      `;

      if (search) {
        params.push(`%${search}%`);
        where += ` AND (s.full_name ILIKE $${params.length} OR s.student_code ILIKE $${params.length})`;
      }

      const q = `
        SELECT
          s.id, s.student_code, s.full_name, (gr.name || ' / ' || sc.name) AS class_label, g.phone AS parent_phone
        FROM student_enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN grades gr ON gr.id = e.grade_id
        JOIN sections sc ON sc.id = e.section_id
        LEFT JOIN LATERAL (
          SELECT gg.phone
          FROM student_guardians sg
          JOIN guardians gg ON gg.id = sg.guardian_id
          WHERE sg.student_id = s.id
          ORDER BY sg.is_primary DESC, sg.id ASC
          LIMIT 1
        ) g ON TRUE
        WHERE ${where}
        ORDER BY s.full_name
        LIMIT 2000
      `;

      const rows = await pool.query(q, params);

      return res.json({
        data: { academicYearId, term, stageId, gradeId, sectionId, students: rows.rows },
      });
    } catch (e) {
      console.error("teacher students list error:", e);
      return res.status(500).json({ message: "خطأ في جلب قائمة الطلاب" });
    }
  },
};