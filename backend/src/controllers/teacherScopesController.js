import { pool } from "../config/db.js";

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId;
}

async function getTeacherIdByUserId(userId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT id
    FROM teachers
    WHERE user_id = $1
      AND school_id = $2
      AND COALESCE(is_active, true) = true
    LIMIT 1
    `,
    [userId, schoolId]
  );

  return rows[0]?.id ?? null;
}

export async function listTeacherScopes(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);

    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود في هذه المدرسة." });
    }

    const term = req.query.term ? Number(req.query.term) : null;

    if (req.query.term && ![1, 2].includes(term)) {
      return res.status(400).json({ message: "قيمة term غير صحيحة." });
    }

    const { rows } = await pool.query(
      `
      SELECT
        ta.id AS teacher_assignment_id,
        ta.term,
        ta.academic_year_id,
        ay.name AS academic_year_name,

        ta.stage_id,
        st.name AS stage_name,

        ta.grade_id,
        g.name AS grade_name,

        ta.section_id,
        sec.name AS section_name,

        ta.subject_id,
        sub.name AS subject_name
      FROM teacher_assignments ta
      JOIN teachers t
        ON t.id = ta.teacher_id
       AND t.school_id = $3
       AND COALESCE(t.is_active, true) = true
      JOIN academic_years ay
        ON ay.id = ta.academic_year_id
       AND ay.school_id = $3
      LEFT JOIN stages st
        ON st.id = ta.stage_id
       AND st.school_id = $3
      LEFT JOIN grades g
        ON g.id = ta.grade_id
       AND g.school_id = $3
      JOIN sections sec
        ON sec.id = ta.section_id
       AND sec.school_id = $3
      JOIN subjects sub
        ON sub.id = ta.subject_id
       AND sub.school_id = $3
      WHERE ta.teacher_id = $1
        AND ($2::int IS NULL OR ta.term = $2::int)
        AND ay.is_active = true
      ORDER BY
        ta.term,
        COALESCE(st.order_index, 0),
        COALESCE(g.order_index, 0),
        sec.name,
        sub.name
      `,
      [teacherId, term, schoolId]
    );

    res.json({
      items: rows.map((r) => ({
        teacher_assignment_id: Number(r.teacher_assignment_id),
        term: Number(r.term),
        academic_year_id: r.academic_year_id ? Number(r.academic_year_id) : null,
        academic_year_name: r.academic_year_name ?? null,
        stage_id: r.stage_id ? Number(r.stage_id) : null,
        stage_name: r.stage_name ?? null,
        grade_id: r.grade_id ? Number(r.grade_id) : null,
        grade_name: r.grade_name ?? null,
        section_id: Number(r.section_id),
        section_name: r.section_name,
        subject_id: Number(r.subject_id),
        subject_name: r.subject_name,
      })),
    });
  } catch (e) {
    console.error("teacher scopes error:", e);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
}