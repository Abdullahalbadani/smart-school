import { pool } from "../config/db.js";

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ✅ جلب رقم المعلم المرتبط بالمستخدم في هذه المدرسة حصراً
async function resolveTeacherId(req) {
  if (req.user?.teacher_id) return req.user.teacher_id;
  const userId = req.user?.id;
  const schoolId = req.user?.school_id;
  if (!userId || !schoolId) return null;

  const r = await pool.query(
    `SELECT id FROM teachers WHERE user_id = $1 AND school_id = $2 AND COALESCE(is_active,true)=true LIMIT 1`,
    [userId, schoolId]
  );
  return r.rows[0]?.id ?? null;
}

// 1️⃣ جلب البيانات الأساسية (محمية بالكامل برقم المدرسة)
export const getMeta = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const yearsQ = await pool.query(
      `SELECT id, name FROM academic_years WHERE school_id = $1 ORDER BY id DESC`,
      [schoolId]
    );

    // ✅ هنا قمنا بحصر المراحل بمدرستك فقط (المفروض يرجع 'ابتدائي' فقط)
    const stagesQ = await pool.query(
      `SELECT id, name FROM stages WHERE school_id = $1 ORDER BY id`,
      [schoolId]
    );

    return res.json({
      data: {
        years: yearsQ.rows,
        stages: stagesQ.rows,
        terms: [
          { id: 1, name: "الفصل الأول" },
          { id: 2, name: "الفصل الثاني" },
        ],
      },
    });
  } catch (e) {
    console.error("teacher students meta error:", e);
    return res.status(500).json({ message: "خطأ في جلب بيانات الفلاتر" });
  }
};

// 2️⃣ جلب نطاقات التدريس (مع حماية الـ JOIN لعدم تسريب أسماء من مدارس أخرى)
export const getScopes = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const teacherId = await resolveTeacherId(req);

    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);

    if (!academicYearId || !term) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const q = `
      SELECT 
        ta.id::bigint AS teacher_assignment_id,
        ta.stage_id::int,
        st.name::text AS stage_name,
        ta.grade_id::int,
        gr.name::text AS grade_name,
        ta.section_id::int,
        sec.name::text AS section_name,
        ta.subject_id::int,
        sub.name::text AS subject_name,
        'official'::text AS source
      FROM teacher_assignments ta
      JOIN teachers teacher_check
        ON teacher_check.id = ta.teacher_id
       AND teacher_check.school_id = $2
       AND COALESCE(teacher_check.is_active, true) = true
      LEFT JOIN stages st
        ON st.id = ta.stage_id
       AND st.school_id = $2
      LEFT JOIN grades gr
        ON gr.id = ta.grade_id
       AND gr.school_id = $2
      LEFT JOIN sections sec
        ON sec.id = ta.section_id
       AND sec.school_id = $2
      LEFT JOIN subjects sub
        ON sub.id = ta.subject_id
       AND sub.school_id = $2
      WHERE ta.teacher_id = $1
        AND ta.academic_year_id = $3
        AND ta.term::int = $4

      UNION

      SELECT DISTINCT
        NULL::bigint AS teacher_assignment_id,
        t.stage_id::int,
        st.name::text AS stage_name,
        t.grade_id::int,
        gr.name::text AS grade_name,
        t.section_id::int,
        sec.name::text AS section_name,
        te.subject_id::int,
        sub.name::text AS subject_name,
        'timetable'::text AS source
      FROM timetable_entries te
      JOIN timetables t
        ON t.id = te.timetable_id
       AND t.school_id = $2
      LEFT JOIN stages st
        ON st.id = t.stage_id
       AND st.school_id = $2
      LEFT JOIN grades gr
        ON gr.id = t.grade_id
       AND gr.school_id = $2
      LEFT JOIN sections sec
        ON sec.id = t.section_id
       AND sec.school_id = $2
      LEFT JOIN subjects sub
        ON sub.id = te.subject_id
       AND sub.school_id = $2
      WHERE te.teacher_id = $1
        AND te.school_id = $2
        AND t.academic_year_id = $3
        AND t.term::int = $4
        AND t.status = 'published'
        AND NOT EXISTS (
          SELECT 1
          FROM teacher_assignments ta2
          JOIN teachers teacher_check2
            ON teacher_check2.id = ta2.teacher_id
           AND teacher_check2.school_id = $2
           AND COALESCE(teacher_check2.is_active, true) = true
          WHERE ta2.teacher_id = te.teacher_id
            AND ta2.subject_id = te.subject_id
            AND ta2.section_id = t.section_id
            AND ta2.academic_year_id = $3
            AND ta2.term::int = $4
        )
      ORDER BY stage_name, grade_name, section_name, subject_name
    `;

    const r = await pool.query(q, [teacherId, schoolId, academicYearId, term]);

    return res.json({ data: r.rows });
  } catch (e) {
    console.error("teacher scopes error:", e);
    return res.status(500).json({ message: "خطأ في جلب النطاقات" });
  }
};

// 3️⃣ جلب قائمة الطلاب (محمية بالكامل)
export const listStudents = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const teacherId = await resolveTeacherId(req);

    if (!schoolId || !teacherId) return res.status(403).json({ message: "غير مصرح" });

    const { academicYearId, term, stageId, gradeId, sectionId, q: qText = "" } = req.query;

    const sql = `
      SELECT DISTINCT
        s.id AS student_id, s.student_code, s.full_name,
        st.name AS stage_name, gr.name AS grade_name, sec.name AS section_name,
        pg.phone AS guardian_phone
      FROM student_enrollments e
      JOIN students s ON s.id = e.student_id AND s.school_id = e.school_id
      LEFT JOIN stages st ON st.id = e.stage_id AND st.school_id = e.school_id
      LEFT JOIN grades gr ON gr.id = e.grade_id AND gr.school_id = e.school_id
      LEFT JOIN sections sec ON sec.id = e.section_id AND sec.school_id = e.school_id
      LEFT JOIN LATERAL (
        SELECT gu.phone FROM student_guardians sg
        JOIN guardians gu ON gu.id = sg.guardian_id AND gu.school_id = sg.school_id
        WHERE sg.student_id = s.id AND sg.school_id = e.school_id
        ORDER BY sg.is_primary DESC, sg.id ASC LIMIT 1
      ) pg ON true
      WHERE e.school_id = $1
        AND e.academic_year_id = $2
        AND e.term::int = $3
        AND ($4::int IS NULL OR e.stage_id = $4)
        AND ($5::int IS NULL OR e.grade_id = $5)
        AND ($6::int IS NULL OR e.section_id = $6)
        AND ($7::text = '' OR s.full_name ILIKE ('%' || $7 || '%'))
      ORDER BY s.full_name ASC LIMIT 1000
    `;

    const r = await pool.query(sql, [schoolId, toInt(academicYearId), toInt(term), toInt(stageId), toInt(gradeId), toInt(sectionId), qText.trim()]);
    return res.json({ data: r.rows });
  } catch (e) {
    console.error("teacher students list error:", e);
    return res.status(500).json({ message: "خطأ في جلب الطلاب" });
  }
};