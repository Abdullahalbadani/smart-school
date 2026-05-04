// src/controllers/parentPortalController.js
import { pool } from "../config/db.js";

/* =========================
   Helpers
========================= */
// ✅ إضافة schoolId
async function getGuardianByUserId(userId, schoolId) {
  const q = `
    SELECT id, user_id, full_name, phone, email
    FROM guardians
    WHERE user_id = $1 AND school_id = $2
    LIMIT 1
  `;
  const r = await pool.query(q, [userId, schoolId]);
  return r.rows[0] || null;
}

// ✅ إضافة schoolId لحماية الابناء
async function getChildrenForGuardian(guardianId, schoolId) {
  const q = `
    SELECT
      s.id AS student_id,
      s.student_code,
      s.full_name,
      sg.relation,
      sg.is_primary,

      e.academic_year_id,
      e.stage_id,
      st.name AS stage_name,
      e.grade_id,
      g.name  AS grade_name,
      e.section_id,
      sec.name AS section_name

    FROM student_guardians sg
    JOIN students s ON s.id = sg.student_id AND s.school_id = $2

    LEFT JOIN LATERAL (
      SELECT *
      FROM student_enrollments e
      WHERE e.student_id = s.id AND e.school_id = $2
      ORDER BY e.academic_year_id DESC, e.id DESC
      LIMIT 1
    ) e ON TRUE

    LEFT JOIN stages   st  ON st.id  = e.stage_id
    LEFT JOIN grades   g   ON g.id   = e.grade_id
    LEFT JOIN sections sec ON sec.id = e.section_id

    WHERE sg.guardian_id = $1 AND sg.school_id = $2
    ORDER BY sg.is_primary DESC, s.full_name
  `;
  const r = await pool.query(q, [guardianId, schoolId]);
  return r.rows || [];
}

/* =========================
   GET /api/parent/me
========================= */
export const getParentMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const guardian = await getGuardianByUserId(userId, schoolId);
    if (!guardian) return res.status(404).json({ message: "وليّ الأمر غير موجود أو لا يتبع لهذه المدرسة" });

    const children = await getChildrenForGuardian(guardian.id, schoolId);

    return res.json({
      data: {
        guardian,
        children,
      },
    });
  } catch (err) {
    console.error("getParentMe error:", err);
    return res.status(500).json({ message: "خطأ بالخادم" });
  }
};

/* =========================
   GET /api/parent/meta  (periods + days)
========================= */
export const getParentMeta = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    // ✅ جلب الحصص التابعة للمدرسة فقط
    const q = `
      SELECT id, name, start_time, end_time, sort_order
      FROM periods
      WHERE school_id = $1
      ORDER BY sort_order ASC
    `;
    const r = await pool.query(q, [schoolId]);

    return res.json({
      data: {
        periods: r.rows || [],
        days: [
          { id: 1, name: "السبت" },
          { id: 2, name: "الأحد" },
          { id: 3, name: "الاثنين" },
          { id: 4, name: "الثلاثاء" },
          { id: 5, name: "الأربعاء" },
          { id: 6, name: "الخميس" },
        ],
      },
    });
  } catch (err) {
    console.error("getParentMeta error:", err);
    return res.status(500).json({ message: "خطأ بالخادم" });
  }
};

/* =========================
   GET /api/parent/timetable?studentId=15&term=1
========================= */
export const getChildTimetable = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const guardian = await getGuardianByUserId(userId, schoolId);
    if (!guardian) return res.status(404).json({ message: "وليّ الأمر غير موجود" });

    const studentId = Number(req.query.studentId);
    const term = Number(req.query.term || 1);

    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ message: "studentId غير صحيح" });
    }
    if (!Number.isFinite(term) || term <= 0) {
      return res.status(400).json({ message: "term غير صحيح" });
    }

    // ✅ تحقق أن الابن مربوط بولي الأمر في هذه المدرسة
    const linkQ = `SELECT 1 FROM student_guardians WHERE guardian_id=$1 AND student_id=$2 AND school_id=$3 LIMIT 1`;
    const linkR = await pool.query(linkQ, [guardian.id, studentId, schoolId]);
    if (!linkR.rowCount) return res.status(403).json({ message: "هذا الطالب غير مربوط بهذا وليّ الأمر" });

    // بيانات الطالب
    const stuQ = `SELECT id, student_code, full_name FROM students WHERE id=$1 AND school_id=$2 LIMIT 1`;
    const stuR = await pool.query(stuQ, [studentId, schoolId]);
    const student = stuR.rows[0] || null;
    if (!student) return res.status(404).json({ message: "الطالب غير موجود" });

    // آخر تسجيل (stage/grade/section)
    const enrQ = `
      SELECT
        e.student_id,
        e.academic_year_id,
        e.stage_id, st.name AS stage_name,
        e.grade_id, g.name  AS grade_name,
        e.section_id, sec.name AS section_name,
        e.status
      FROM student_enrollments e
      LEFT JOIN stages   st  ON st.id  = e.stage_id
      LEFT JOIN grades   g   ON g.id   = e.grade_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE e.student_id = $1 AND e.school_id = $2
      ORDER BY e.academic_year_id DESC, e.id DESC
      LIMIT 1
    `;
    const enrR = await pool.query(enrQ, [studentId, schoolId]);
    const enrollment = enrR.rows[0] || null;

    if (!enrollment?.stage_id || !enrollment?.grade_id || !enrollment?.section_id) {
      return res.json({
        data: {
          student,
          enrollment: enrollment || null,
          timetable: null,
          entries: [],
          message: "لا يوجد تسجيل (شعبة/صف) لهذا الطالب",
        },
      });
    }

    // ابحث عن جدول مطابق (الأولوية published) ✅ محمية بالمدرسة
    const ttQ = `
      SELECT id, academic_year_id, stage_id, grade_id, section_id, term, status, created_at
      FROM timetables
      WHERE stage_id=$1 AND grade_id=$2 AND section_id=$3 AND term=$4 AND school_id=$5
      ORDER BY (status='published') DESC, id DESC
      LIMIT 1
    `;
    const ttR = await pool.query(ttQ, [enrollment.stage_id, enrollment.grade_id, enrollment.section_id, term, schoolId]);
    const timetable = ttR.rows[0] || null;

    if (!timetable) {
      return res.json({
        data: {
          student,
          enrollment,
          timetable: null,
          entries: [],
          message: "لا يوجد جدول منشور/موجود لهذه الشعبة في هذا الترم",
        },
      });
    }

    // entries
    const entQ = `
      SELECT
        te.day_of_week,
        te.period_id,
        te.room,

        p.name AS period_name,
        p.start_time,
        p.end_time,
        p.sort_order,

        sub.name AS subject_name,
        t.full_name AS teacher_name

      FROM timetable_entries te
      JOIN periods p ON p.id = te.period_id
      LEFT JOIN subjects sub ON sub.id = te.subject_id
      LEFT JOIN teachers t ON t.id = te.teacher_id
      WHERE te.timetable_id = $1
      ORDER BY te.day_of_week ASC, p.sort_order ASC
    `;
    const entR = await pool.query(entQ, [timetable.id]);

    return res.json({
      data: {
        student,
        enrollment,
        timetable,
        entries: entR.rows || [],
      },
    });
  } catch (err) {
    console.error("getChildTimetable error:", err);
    return res.status(500).json({ message: "خطأ بالخادم" });
  }
};

/* =========================
   GET /api/parent/exams/meta
========================= */
export const getParentExamsMeta = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    // ✅ جلب المواد الخاصة بالمدرسة فقط
    const subjectsQ = `SELECT id, name FROM subjects WHERE school_id = $1 ORDER BY id ASC`;
    const subs = await pool.query(subjectsQ, [schoolId]);

    const months = [
      { id: 1, name: "يناير" }, { id: 2, name: "فبراير" }, { id: 3, name: "مارس" },
      { id: 4, name: "أبريل" }, { id: 5, name: "مايو" }, { id: 6, name: "يونيو" },
      { id: 7, name: "يوليو" }, { id: 8, name: "أغسطس" }, { id: 9, name: "سبتمبر" },
      { id:10, name: "أكتوبر" }, { id:11, name: "نوفمبر" }, { id:12, name: "ديسمبر" },
    ];

    return res.json({
      data: {
        months,
        subjects: subs.rows || [],
      },
    });
  } catch (err) {
    console.error("getParentExamsMeta error:", err);
    return res.status(500).json({ message: "خطأ بالخادم" });
  }
};

function isValidExamType(t) {
  return ["monthly", "midyear", "final"].includes(String(t || ""));
}

/* =========================
   GET /api/parent/exams?studentId=15&examType=midyear&month=1&subjectId=3
========================= */
export const getChildExams = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const guardian = await getGuardianByUserId(userId, schoolId);
    if (!guardian) return res.status(404).json({ message: "وليّ الأمر غير موجود" });

    const studentId = Number(req.query.studentId);
    const examTypeRaw = String(req.query.examType || "").trim();
    const month = req.query.month ? Number(req.query.month) : null;
    const subjectId = req.query.subjectId ? Number(req.query.subjectId) : null;

    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ message: "studentId غير صحيح" });
    }

    if (examTypeRaw && !isValidExamType(examTypeRaw)) {
      return res.status(400).json({ message: "examType غير صحيح" });
    }

    if (examTypeRaw === "monthly" && month && (!Number.isFinite(month) || month < 1 || month > 12)) {
      return res.status(400).json({ message: "month غير صحيح" });
    }

    if (subjectId && (!Number.isFinite(subjectId) || subjectId <= 0)) {
      return res.status(400).json({ message: "subjectId غير صحيح" });
    }

    // تحقق الربط
    const linkQ = `SELECT 1 FROM student_guardians WHERE guardian_id=$1 AND student_id=$2 AND school_id=$3 LIMIT 1`;
    const linkR = await pool.query(linkQ, [guardian.id, studentId, schoolId]);
    if (!linkR.rowCount) return res.status(403).json({ message: "هذا الطالب غير مربوط بهذا وليّ الأمر" });

    // بيانات الطالب
    const stuQ = `SELECT id, student_code, full_name FROM students WHERE id=$1 AND school_id=$2 LIMIT 1`;
    const stuR = await pool.query(stuQ, [studentId, schoolId]);
    const student = stuR.rows[0] || null;
    if (!student) return res.status(404).json({ message: "الطالب غير موجود" });

    // آخر تسجيل
    const enrQ = `
      SELECT
        e.student_id,
        e.academic_year_id,
        e.stage_id, st.name AS stage_name,
        e.grade_id, g.name  AS grade_name,
        e.section_id, sec.name AS section_name,
        e.status
      FROM student_enrollments e
      LEFT JOIN stages   st  ON st.id  = e.stage_id
      LEFT JOIN grades   g   ON g.id   = e.grade_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE e.student_id = $1 AND e.school_id = $2
      ORDER BY e.academic_year_id DESC, e.id DESC
      LIMIT 1
    `;
    const enrR = await pool.query(enrQ, [studentId, schoolId]);
    const enrollment = enrR.rows[0] || null;

    if (!enrollment?.academic_year_id || !enrollment?.stage_id || !enrollment?.grade_id) {
      return res.json({
        data: {
          student,
          enrollment,
          filters: { examType: examTypeRaw || null, month: month || null, subjectId: subjectId || null },
          exams: [],
        },
      });
    }

    const academicYearId = enrollment.academic_year_id;
    const stageId = enrollment.stage_id;
    const gradeId = enrollment.grade_id;
    const sectionId = enrollment.section_id || null;

    // ===== Helpers =====
    async function pickTimetable(scope, exType, m) {
      const params = [academicYearId, stageId, gradeId, exType, scope, schoolId];
      let where = `
        WHERE academic_year_id=$1
          AND stage_id=$2
          AND grade_id=$3
          AND exam_type=$4
          AND status='published'
          AND scope=$5
          AND school_id=$6
      `;

      if (scope === "section") {
        params.push(sectionId);
        where += ` AND section_id=$${params.length}`;
      } else {
        where += ` AND section_id IS NULL`;
      }

      if (exType === "monthly" && m) {
        params.push(m);
        where += ` AND month=$${params.length}`;
      }

      const q = `SELECT id, scope, exam_type, month FROM exam_timetables ${where} ORDER BY id DESC LIMIT 1`;
      const r = await pool.query(q, params);
      return r.rows[0] || null;
    }

    async function listMonthlyTimetables(scope, monthFilter = null) {
      const params = [academicYearId, stageId, gradeId, scope, schoolId];
      let where = `
        WHERE academic_year_id=$1
          AND stage_id=$2
          AND grade_id=$3
          AND exam_type='monthly'
          AND status='published'
          AND scope=$4
          AND school_id=$5
      `;

      if (scope === "section") {
        params.push(sectionId);
        where += ` AND section_id=$${params.length}`;
      } else {
        where += ` AND section_id IS NULL`;
      }

      if (monthFilter) {
        params.push(monthFilter);
        where += ` AND month=$${params.length}`;
      }

      const q = `
        SELECT DISTINCT ON (month)
          id, scope, exam_type, month
        FROM exam_timetables
        ${where}
        ORDER BY month ASC, id DESC
      `;
      const r = await pool.query(q, params);
      return r.rows || [];
    }

    async function loadEntries(timetableId, scope) {
      const entQ = `
        SELECT
          e.exam_date::date AS exam_date,
          e.start_time,
          e.end_time,
          e.room,
          e.notes,
          e.apply_to_section_id,
          sec2.name AS apply_to_section_name,
          e.subject_id,
          sub.name AS subject_name,
          t.scope,
          t.exam_type,
          t.month
        FROM exam_timetable_entries e
        JOIN exam_timetables t ON t.id = e.exam_timetable_id
        LEFT JOIN subjects sub ON sub.id = e.subject_id
        LEFT JOIN sections sec2 ON sec2.id = e.apply_to_section_id
        WHERE e.exam_timetable_id = $1
        ORDER BY e.exam_date::date ASC, e.start_time ASC
      `;
      const entR = await pool.query(entQ, [timetableId]);
      let rows = entR.rows || [];

      if (scope === "grade" && sectionId) {
        rows = rows.filter(
          (x) => x.apply_to_section_id == null || String(x.apply_to_section_id) === String(sectionId)
        );
      }

      if (subjectId) {
        rows = rows.filter((x) => Number(x.subject_id) === Number(subjectId));
      }

      return rows;
    }

    // ===== Main logic =====
    let exams = [];
    let mVal = null;

    if (examTypeRaw) {
      const exType = examTypeRaw;
      mVal = exType === "monthly" ? (month || (new Date().getMonth() + 1)) : null;

      let tt = null;
      if (sectionId) tt = await pickTimetable("section", exType, mVal);
      if (!tt) tt = await pickTimetable("grade", exType, mVal);

      if (!tt?.id) {
        return res.json({
          data: {
            student,
            enrollment,
            filters: { examType: examTypeRaw || null, month: mVal || null, subjectId: subjectId || null },
            exams: [],
          },
        });
      }

      exams = await loadEntries(tt.id, tt.scope);
    } else {
      const timetablesToLoad = [];
      const monthFilter = null;
      let secMonthly = [];
      
      if (sectionId) secMonthly = await listMonthlyTimetables("section", monthFilter);
      const grdMonthly = await listMonthlyTimetables("grade", monthFilter);

      const secMap = new Map(secMonthly.map((t) => [String(t.month), t]));
      const grdMap = new Map(grdMonthly.map((t) => [String(t.month), t]));
      const monthsUnion = new Set([...secMap.keys(), ...grdMap.keys()]);

      for (const m of monthsUnion) {
        const t = secMap.get(m) || grdMap.get(m);
        if (t?.id) timetablesToLoad.push({ id: t.id, scope: t.scope });
      }

      for (const exType of ["midyear", "final"]) {
        let tt = null;
        if (sectionId) tt = await pickTimetable("section", exType, null);
        if (!tt) tt = await pickTimetable("grade", exType, null);
        if (tt?.id) timetablesToLoad.push({ id: tt.id, scope: tt.scope });
      }

      if (!timetablesToLoad.length) {
        return res.json({
          data: {
            student,
            enrollment,
            filters: { examType: null, month: null, subjectId: subjectId || null },
            exams: [],
          },
        });
      }

      for (const t of timetablesToLoad) {
        const rows = await loadEntries(t.id, t.scope);
        exams.push(...rows);
      }

      exams.sort((a, b) => {
        const ad = String(a.exam_date || "");
        const bd = String(b.exam_date || "");
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
    }

    return res.json({
      data: {
        student,
        enrollment,
        filters: { examType: examTypeRaw || null, month: mVal || null, subjectId: subjectId || null },
        exams,
      },
    });
  } catch (err) {
    console.error("getChildExams error:", err);
    return res.status(500).json({ message: "خطأ بالخادم" });
  }
};