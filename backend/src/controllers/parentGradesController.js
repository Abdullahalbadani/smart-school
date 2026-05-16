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

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function statusLabel(status) {
  const map = {
    graded: "مرصودة",
    passed: "ناجح",
    failed: "راسب",
    incomplete: "ناقص",
    missing: "ناقص",
    absent: "غائب",
    excused: "معذور",
    not_approved: "غير معتمد",
    pending: "قيد الانتظار",
  };

  return map[status] || status || "—";
}

function termLabel(term) {
  if (Number(term) === 1) return "الفصل الأول";
  if (Number(term) === 2) return "الفصل الثاني";
  return "—";
}

function percent(score, maxScore) {
  const s = Number(score);
  const m = Number(maxScore);

  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;

  return (s / m) * 100;
}

function gradeLabelFromPercentage(percentage) {
  const p = Number(percentage);

  if (!Number.isFinite(p)) return "—";
  if (p >= 90) return "ممتاز";
  if (p >= 80) return "جيد جدًا";
  if (p >= 70) return "جيد";
  if (p >= 60) return "مقبول";

  return "ضعيف";
}

function detectAssessmentKind(row) {
  const type = String(row.type || "").toLowerCase();
  const examKind = String(row.exam_kind || "").toLowerCase();
  const aggregateKind = String(row.aggregate_kind || "").toLowerCase();
  const title = `${row.title || ""} ${row.title_short || ""}`.toLowerCase();

  // 1) الاختبارات الشهرية
  if (
    type.includes("monthly") ||
    examKind.includes("monthly") ||
    title.includes("شهري") ||
    title.includes("monthly")
  ) {
    return "monthly";
  }

  // 2) الأعمال الفصلية / المحصلة
  if (
    type === "aggregate" ||
    type.includes("muhassala") ||
    type.includes("aggregate") ||
    aggregateKind ||
    title.includes("محصلة")
  ) {
    return "term_work";
  }

  // 3) الاختبارات
  // مهم: نضع الاختبارات قبل الأنشطة حتى لا تدخل "اختبار نصفي" ضمن النشاطات.
  if (
    type.includes("exam") ||
    type.includes("quiz") ||
    examKind ||
    title.includes("اختبار") ||
    title.includes("امتحان")
  ) {
    return "exams";
  }

  // 4) الأنشطة والتكليفات
  if (
    type.includes("activity") ||
    type.includes("classwork") ||
    type.includes("homework") ||
    type.includes("assignment") ||
    type.includes("task") ||
    type.includes("participation") ||
    title.includes("نشاط") ||
    title.includes("نشاط صفي") ||
    title.includes("واجب") ||
    title.includes("تكليف")
  ) {
    return "activities";
  }

  return "other";
}

function kindLabel(kind) {
  const map = {
    monthly: "اختبار شهري",
    exams: "اختبار",
    activities: "نشاط / تكليف",
    term_work: "عمل فصلي / محصلة",
    other: "تقييم",
  };

  return map[kind] || "تقييم";
}

function allowedByType(kind, requestedType) {
  if (!requestedType || requestedType === "all") return true;

  if (requestedType === "monthly") return kind === "monthly";
  if (requestedType === "exams") return kind === "exams" || kind === "monthly";
  if (requestedType === "activities") return kind === "activities";
  if (requestedType === "term_work") return kind === "term_work";

  return true;
}

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

async function loadAssessmentGrades(db, schoolId, studentId) {
  const { rows } = await db.query(
    `
    SELECT
      ag.id AS grade_id,
      ag.assessment_id,
      ag.student_id,
      ag.status AS grade_status,
      ag.score,
      ag.feedback,
      ag.graded_at,
      ag.published_at AS grade_published_at,
      ag.is_published,

      a.title,
      a.title_short,
      a.type,
      a.exam_kind,
      a.aggregate_kind,
      a.sequence_no,
      a.max_score,
      a.status AS assessment_status,
      a.published_at AS assessment_published_at,
      a.created_at AS assessment_created_at,

      ta.id AS teacher_assignment_id,
      ta.academic_year_id,
      ay.name AS academic_year_name,
      ta.term,
      ta.stage_id,
      st.name AS stage_name,
      ta.grade_id,
      COALESCE(g.grade_name, g.name) AS grade_name,
      ta.section_id,
      sec.name AS section_name,
      ta.subject_id,
      subj.name AS subject_name

    FROM assessment_grades ag
    JOIN assessments a
      ON a.id = ag.assessment_id
     AND a.school_id = ag.school_id

    LEFT JOIN teacher_assignments ta
      ON ta.id = a.teacher_assignment_id

    LEFT JOIN academic_years ay
      ON ay.id = ta.academic_year_id

    LEFT JOIN stages st
      ON st.id = ta.stage_id

    LEFT JOIN grades g
      ON g.id = ta.grade_id

    LEFT JOIN sections sec
      ON sec.id = ta.section_id

    LEFT JOIN subjects subj
      ON subj.id = ta.subject_id

    WHERE ag.school_id = $1
      AND ag.student_id = $2
      AND COALESCE(ag.is_published, false) = true
      AND (
        a.status = 'published'
        OR a.published_at IS NOT NULL
      )

    ORDER BY
      ta.academic_year_id DESC NULLS LAST,
      ta.term DESC NULLS LAST,
      COALESCE(a.published_at, ag.published_at, a.created_at) DESC NULLS LAST,
      subj.name ASC NULLS LAST,
      a.id DESC
    `,
    [schoolId, studentId]
  );

  return rows;
}

function buildSummary(grades) {
  const graded = grades.filter((g) => g.grade_status === "graded");
  const percents = graded
    .map((g) => percent(g.score, g.max_score))
    .filter((p) => Number.isFinite(p));

  const average =
    percents.length > 0
      ? percents.reduce((sum, p) => sum + p, 0) / percents.length
      : null;

  return {
    total_count: grades.length,
    graded_count: graded.length,
    absent_count: grades.filter((g) => g.grade_status === "absent").length,
    excused_count: grades.filter((g) => g.grade_status === "excused").length,
    average_percentage: average,
    average_grade_label: gradeLabelFromPercentage(average),
  };
}

export async function getParentChildAssessmentGrades(req, res) {
  try {
    const schoolId = Number(req.user?.school_id);
    const parentUserId = pickUserId(req);

    if (!schoolId || !parentUserId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const requestedType = String(req.query.type || "all").trim();
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
        message: "لا تملك صلاحية عرض درجات هذا الطالب.",
      });
    }

    const realStudentId = Number(student.id);
    const rawGrades = await loadAssessmentGrades(pool, schoolId, realStudentId);

    const grades = rawGrades
      .map((row) => {
        const kind = detectAssessmentKind(row);
        const percentage = percent(row.score, row.max_score);

        return {
          ...row,
          kind,
          kind_label: kindLabel(kind),
          term_label: termLabel(row.term),
          status_label: statusLabel(row.grade_status),
          percentage,
          grade_label: gradeLabelFromPercentage(percentage),
        };
      })
      .filter((row) => allowedByType(row.kind, requestedType));

    return res.json({
      student,
      type: requestedType,
      summary: buildSummary(grades),
      grades,
    });
  } catch (e) {
    console.error("getParentChildAssessmentGrades error:", e);

    return res.status(500).json({
      message: "خطأ في جلب درجات الابن.",
    });
  }
}