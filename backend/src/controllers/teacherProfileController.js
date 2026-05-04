// backend/src/controllers/teacherProfileController.js
import { pool } from "../config/db.js";

export async function getTeacherJobProfile(req, res) {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ استخراج رقم المدرسة
    if (!userId || !schoolId) return res.status(401).json({ ok: false, message: "غير مصرح" });

    // academicYearId / term (اختياري)
    let academicYearId = Number(req.query.academicYearId || 0) || 0;
    let term = Number(req.query.term || 0) || 0;
    if (term !== 1 && term !== 2) term = 1;

    // ✅ جلب المعلم المرتبط بالمستخدم ومحمي برقم المدرسة
    const teacherQ = await pool.query(
      `
      SELECT
        t.id AS teacher_id,
        t.full_name AS full_name,
        COALESCE(emp.phone, t.phone, u.phone) AS phone,
        COALESCE(emp.id::text, t.id::text) AS code,
        t.is_active AS is_active
      FROM public.users u
      JOIN public.teachers t ON t.user_id = u.id AND t.school_id = $2
      LEFT JOIN LATERAL (
        SELECT e.*
        FROM public.employees e
        WHERE (e.teacher_id = t.id OR e.user_id = u.id) AND e.school_id = $2
        ORDER BY e.id DESC
        LIMIT 1
      ) emp ON TRUE
      WHERE u.id = $1 AND u.school_id = $2
      LIMIT 1
      `,
      [userId, schoolId]
    );

    if (!teacherQ.rows.length) {
      return res
        .status(404)
        .json({ ok: false, message: "لا يوجد معلم مرتبط بهذا الحساب في هذه المدرسة" });
    }

    const teacher = teacherQ.rows[0];

    // ✅ السنة النشطة إن لم تُرسل (محمية برقم المدرسة)
    let yearName = "";
    if (!academicYearId) {
      const y = await pool.query(
        `SELECT id, name FROM public.academic_years WHERE is_active = true AND school_id = $1 ORDER BY id DESC LIMIT 1`,
        [schoolId]
      );
      if (y.rows.length) {
        academicYearId = Number(y.rows[0].id);
        yearName = y.rows[0].name || "";
      }
    } else {
      const y = await pool.query(
        `SELECT name FROM public.academic_years WHERE id = $1 AND school_id = $2`,
        [academicYearId, schoolId]
      );
      yearName = y.rows[0]?.name || "";
    }

    if (!academicYearId) {
      return res.status(400).json({
        ok: false,
        message: "لا توجد سنة دراسية نشطة ولم يتم إرسال academicYearId",
      });
    }

    // ✅ نطاقات التدريس من الجدول (بدون teaching_scopes) محمية برقم المدرسة
    const scopesQ = await pool.query(
      `
      SELECT DISTINCT
        t.stage_id,
        st.name AS stage_name,
        st.order_no AS stage_order_no,

        t.grade_id,
        gr.name AS grade_name,
        gr.order_no AS grade_order_no,

        t.section_id,
        sec.name AS section_name,

        te.subject_id,
        sub.name AS subject_name

      FROM public.timetable_entries te
      JOIN public.timetables t   ON t.id = te.timetable_id

      JOIN public.stages st      ON st.id = t.stage_id
      JOIN public.grades gr      ON gr.id = t.grade_id
      JOIN public.sections sec   ON sec.id = t.section_id
      JOIN public.subjects sub   ON sub.id = te.subject_id

      WHERE te.teacher_id = $1
        AND t.academic_year_id = $2
        AND t.term = $3
        AND t.school_id = $4
        AND t.status = 'published'

      ORDER BY st.order_no, gr.order_no, sec.name, sub.name
      `,
      [teacher.teacher_id, academicYearId, term, schoolId]
    );

    const scopes = scopesQ.rows || [];

    // ✅ قوائم فريدة
    const uniqBy = (arr, keyFn) => {
      const m = new Map();
      for (const x of arr) {
        const k = keyFn(x);
        if (!m.has(k)) m.set(k, x);
      }
      return Array.from(m.values());
    };

    const stages = uniqBy(scopes, (x) => String(x.stage_id)).map((x) => ({
      id: x.stage_id,
      name: x.stage_name,
      order_no: x.stage_order_no,
    }));

    const grades = uniqBy(scopes, (x) => String(x.grade_id)).map((x) => ({
      id: x.grade_id,
      name: x.grade_name,
      order_no: x.grade_order_no,
    }));

    const sections = uniqBy(scopes, (x) => String(x.section_id)).map((x) => ({
      id: x.section_id,
      name: x.section_name,
    }));

    const subjects = uniqBy(scopes, (x) => String(x.subject_id)).map((x) => ({
      id: x.subject_id,
      name: x.subject_name,
    }));

    return res.json({
      ok: true,
      data: {
        teacher: {
          id: teacher.teacher_id,
          full_name: teacher.full_name,
          phone: teacher.phone,
          code: teacher.code,
          is_active: teacher.is_active,
        },
        meta: {
          academic_year_id: academicYearId,
          academic_year_name: yearName,
          term,
        },
        stats: {
          stages: stages.length,
          grades: grades.length,
          sections: sections.length,
          subjects: subjects.length,
        },
        lists: { stages, grades, sections, subjects },

        // ✅ scopes التفصيلية (نولّد id ثابت من القيم)
        scopes: scopes.map((x) => ({
          id: `${x.stage_id}-${x.grade_id}-${x.section_id}-${x.subject_id}`,
          stage_id: x.stage_id,
          stage_name: x.stage_name,
          grade_id: x.grade_id,
          grade_name: x.grade_name,
          section_id: x.section_id,
          section_name: x.section_name,
          subject_id: x.subject_id,
          subject_name: x.subject_name,
        })),
      },
    });
  } catch (err) {
    console.error("getTeacherJobProfile error:", err);
    return res.status(500).json({ ok: false, message: "خطأ سيرفر" });
  }
}