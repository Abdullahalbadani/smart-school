import { pool } from "../config/db.js";

function pickUserId(req) {
  const id = Number(
    req.user?.id ||
      req.user?.user_id ||
      req.user?.userId ||
      req.user?.sub
  );

  return Number.isInteger(id) && id > 0 ? id : null;
}

function statusLabel(status) {
  const map = {
    passed: "ناجح",
    failed: "راسب",
    incomplete: "ناقص",
    missing: "ناقص",
    absent: "غائب",
    excused: "معذور",
    not_approved: "غير معتمد",
  };

  return map[status] || status || "—";
}

function termLabel(term) {
  if (Number(term) === 1) return "الفصل الأول";
  if (Number(term) === 2) return "الفصل الثاني";
  return "—";
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDefaultMax(settings, term) {
  if (Number(term) === 1) {
    return {
      exam_max: toNumber(settings?.midterm_exam_max_grade, 30),
      aggregate_max: toNumber(settings?.midterm_muhassala_max_grade, 20),
    };
  }

  return {
    exam_max: toNumber(settings?.final_exam_max_grade, 30),
    aggregate_max: toNumber(settings?.final_muhassala_max_grade, 20),
  };
}

async function getSchoolSettings(db, schoolId) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM school_settings
    WHERE school_id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  return rows[0] || {};
}

/*
  البحث عن الطالب مع التحقق أنه تابع لولي الأمر الحالي.
  يدعم البحث بطريقتين:
  1. student_id
  2. student_code مثل: S7-0181 أو 0181
*/
async function findAccessibleStudent(db, schoolId, parentUserId, options = {}) {
  const studentId = Number(options.studentId);
  const studentCode = String(options.studentCode || "").trim();

  const validStudentId =
    Number.isInteger(studentId) && studentId > 0 ? studentId : null;

  const cleanCode = studentCode || "";

  const { rows } = await db.query(
    `
    SELECT
      s.id,
      s.full_name,
      s.student_code,
      s.school_id
    FROM guardians g
    JOIN student_guardians sg
      ON sg.guardian_id = g.id
     AND sg.school_id = g.school_id
    JOIN students s
      ON s.id = sg.student_id
     AND s.school_id = sg.school_id
    WHERE g.school_id = $1
      AND g.user_id = $2
      AND (
        ($3::bigint IS NOT NULL AND s.id = $3)
        OR
        (
          $4::text <> ''
          AND (
            LOWER(s.student_code) = LOWER($4)
            OR s.student_code ILIKE '%' || $4
            OR regexp_replace(s.student_code, '[^0-9]', '', 'g')
               LIKE '%' || regexp_replace($4, '[^0-9]', '', 'g')
          )
        )
      )
    LIMIT 1
    `,
    [schoolId, parentUserId, validStudentId, cleanCode]
  );

  return rows[0] || null;
}

async function loadPublishedResults(db, schoolId, studentId) {
  const { rows } = await db.query(
    `
    SELECT
      b.id AS batch_id,
      b.academic_year_id,
      ay.name AS academic_year_name,
      b.term,
      b.stage_id,
      st.name AS stage_name,
      b.grade_id,
      COALESCE(g.grade_name, g.name) AS grade_name,
      b.section_id,
      sec.name AS section_name,
      b.status AS batch_status,
      b.published_at,

      trs.id AS student_result_id,
      trs.total_score,
      trs.max_score,
      trs.percentage,
      trs.grade_label,
      trs.passed_subjects,
      trs.failed_subjects,
      trs.missing_subjects,
      trs.rank_in_section,
      trs.status AS student_status

    FROM term_result_students trs
    JOIN term_result_batches b
      ON b.id = trs.batch_id
     AND b.school_id = trs.school_id

    LEFT JOIN academic_years ay
      ON ay.id = b.academic_year_id

    LEFT JOIN stages st
      ON st.id = b.stage_id

    LEFT JOIN grades g
      ON g.id = b.grade_id

    LEFT JOIN sections sec
      ON sec.id = b.section_id

    WHERE trs.school_id = $1
      AND trs.student_id = $2
      AND b.status = 'published'

    ORDER BY
      b.academic_year_id DESC,
      b.term DESC,
      b.published_at DESC NULLS LAST,
      b.id DESC
    `,
    [schoolId, studentId]
  );

  return rows;
}

async function loadSubjects(db, schoolId, batchId, studentId, settings, term) {
  const defaults = getDefaultMax(settings, term);

  const { rows } = await db.query(
    `
    SELECT
      trsub.id,
      trsub.subject_id,
      subj.name AS subject_name,

      trsub.exam_score,
      trsub.aggregate_score,
      trsub.total_score,
      trsub.max_score,
      trsub.percentage,
      trsub.grade_label,
      trsub.status,
      trsub.missing_reason,

      exam_a.max_score AS exam_max_score,
      agg_a.max_score AS aggregate_max_score

    FROM term_result_subjects trsub

    LEFT JOIN subjects subj
      ON subj.id = trsub.subject_id

    LEFT JOIN assessments exam_a
      ON exam_a.id = trsub.exam_assessment_id
     AND exam_a.school_id = trsub.school_id

    LEFT JOIN assessments agg_a
      ON agg_a.id = trsub.aggregate_assessment_id
     AND agg_a.school_id = trsub.school_id

    WHERE trsub.school_id = $1
      AND trsub.batch_id = $2
      AND trsub.student_id = $3

    ORDER BY subj.name ASC, trsub.subject_id ASC
    `,
    [schoolId, batchId, studentId]
  );

  return rows.map((row) => ({
    ...row,
    exam_max_score: toNumber(row.exam_max_score, defaults.exam_max),
    aggregate_max_score: toNumber(
      row.aggregate_max_score,
      defaults.aggregate_max
    ),
    status_label: statusLabel(row.status),
  }));
}

export async function getParentChildTermResults(req, res) {
  try {
    const schoolId = Number(req.user?.school_id);
    const parentUserId = pickUserId(req);

    if (!schoolId || !parentUserId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const studentId = Number(req.query.student_id || req.query.studentId);
    const studentCode = String(
      req.query.student_code || req.query.studentCode || ""
    ).trim();

    const hasStudentId = Number.isInteger(studentId) && studentId > 0;
    const hasStudentCode = studentCode.length > 0;

    if (!hasStudentId && !hasStudentCode) {
      return res.status(400).json({
        message: "اختر الابن أولًا.",
      });
    }

    const student = await findAccessibleStudent(pool, schoolId, parentUserId, {
      studentId: hasStudentId ? studentId : null,
      studentCode,
    });

    if (!student) {
      return res.status(403).json({
        message: "لا تملك صلاحية عرض نتائج هذا الطالب.",
      });
    }

    const realStudentId = Number(student.id);

    const settings = await getSchoolSettings(pool, schoolId);
    const results = await loadPublishedResults(pool, schoolId, realStudentId);

    const enriched = [];

    for (const result of results) {
      const subjects = await loadSubjects(
        pool,
        schoolId,
        result.batch_id,
        realStudentId,
        settings,
        result.term
      );

      enriched.push({
        ...result,
        term_label: termLabel(result.term),
        student_status_label: statusLabel(result.student_status),
        subjects,
      });
    }

    return res.json({
      student,
      results: enriched,
      active_result: enriched[0] || null,
    });
  } catch (e) {
    console.error("getParentChildTermResults error:", e);

    return res.status(500).json({
      message: "خطأ في جلب نتائج الابن.",
    });
  }
}