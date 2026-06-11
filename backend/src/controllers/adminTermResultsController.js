import { pool } from "../config/db.js";
import WorkflowNotifications from "../modules/notifications/workflowNotificationService.js";

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${label} غير صحيح.`);
  }
  return n;
}

function parseTerm(value) {
  const n = Number(value);
  if (![1, 2].includes(n)) {
    throw badRequest("الفصل الدراسي يجب أن يكون 1 أو 2.");
  }
  return n;
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstNumber(source, keys, fallback = null) {
  if (!source || typeof source !== "object") return fallback;

  for (const key of keys) {
    const n = Number(source[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return fallback;
}

function resolvePassScore(settings, term, totalMax) {
  const termSpecificKeys =
    Number(term) === 1
      ? [
          "midterm_pass_mark",
          "midterm_passing_score",
          "midterm_success_score",
          "midterm_min_score",
          "midyear_pass_mark",
          "half_year_pass_mark",
        ]
      : [
          "final_term_pass_mark",
          "final_pass_mark",
          "final_passing_score",
          "final_success_score",
          "term2_pass_mark",
        ];

  const direct = firstNumber(settings, termSpecificKeys, null);

  if (direct !== null) {
    if (direct <= 1) return totalMax * direct;
    if (direct <= totalMax) return direct;
    if (direct <= 100) return totalMax * (direct / 100);
    return direct;
  }

  const passPercent = firstNumber(
    settings,
    ["pass_mark", "passing_percentage", "pass_percentage", "success_percentage"],
    50
  );

  if (passPercent <= 1) return totalMax * passPercent;
  return totalMax * (passPercent / 100);
}

function getTermConfig(settings, term) {
  if (term === 1) {
    const examMax = firstNumber(settings, ["midterm_exam_max_grade"], 30);
    const aggregateMax = firstNumber(settings, ["midterm_muhassala_max_grade"], 20);
    const totalMax = examMax + aggregateMax;

    return {
      term,
      term_label: "الفصل الأول",
      exam_kind: "midterm",
      aggregate_kind: "midterm",
      legacy_exam_type: "midterm_exam",
      legacy_aggregate_type: "midterm_muhassala",
      exam_label: "اختبار نصفي",
      aggregate_label: "محصلة النصفي",
      total_label: "مجموع الفصل الأول",
      exam_max: examMax,
      aggregate_max: aggregateMax,
      total_max: totalMax,
      pass_score: resolvePassScore(settings, term, totalMax),
    };
  }

  const examMax = firstNumber(settings, ["final_exam_max_grade"], 30);
  const aggregateMax = firstNumber(settings, ["final_muhassala_max_grade"], 20);
  const totalMax = examMax + aggregateMax;

  return {
    term,
    term_label: "الفصل الثاني",
    exam_kind: "final",
    aggregate_kind: "final",
    legacy_exam_type: "final_exam",
    legacy_aggregate_type: "final_muhassala",
    exam_label: "اختبار نهائي",
    aggregate_label: "محصلة النهائي",
    total_label: "مجموع الفصل الثاني",
    exam_max: examMax,
    aggregate_max: aggregateMax,
    total_max: totalMax,
    pass_score: resolvePassScore(settings, term, totalMax),
  };
}

function getGradeLabel(percentage) {
  const p = Number(percentage);

  if (!Number.isFinite(p)) return null;
  if (p >= 90) return "ممتاز";
  if (p >= 80) return "جيد جدًا";
  if (p >= 70) return "جيد";
  if (p >= 60) return "مقبول";

  return "ضعيف";
}

function getSubjectPassScore(termConfig, maxScore) {
  const baseMax = Number(termConfig.total_max || 50);
  const basePass = Number(termConfig.pass_score || baseMax * 0.5);

  if (!Number.isFinite(baseMax) || baseMax <= 0) {
    return Number(maxScore) * 0.5;
  }

  return Number(maxScore) * (basePass / baseMax);
}

function readGradeComponent(grade) {
  if (!grade) {
    return {
      ok: false,
      kind: "missing",
      score: null,
      reason: "لا توجد درجة.",
    };
  }

  if (!grade.is_published) {
    return {
      ok: false,
      kind: "missing",
      score: null,
      reason: "الدرجة غير منشورة.",
    };
  }

  if (grade.status === "graded") {
    const score = Number(grade.score);

    if (!Number.isFinite(score)) {
      return {
        ok: false,
        kind: "missing",
        score: null,
        reason: "درجة غير صحيحة.",
      };
    }

    return {
      ok: true,
      kind: "graded",
      score,
      reason: null,
    };
  }

  if (grade.status === "absent") {
    return {
      ok: true,
      kind: "absent",
      score: 0,
      reason: "غائب، حُسبت الدرجة صفر.",
    };
  }

  if (grade.status === "excused") {
    return {
      ok: false,
      kind: "excused",
      score: null,
      reason: "الطالب معذور.",
    };
  }

  return {
    ok: false,
    kind: "missing",
    score: null,
    reason: "درجة ناقصة.",
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

async function loadStudents(db, params) {
  const { schoolId, academicYearId, term, stageId, gradeId, sectionId } = params;

  const { rows } = await db.query(
    `
    SELECT
      se.student_id,
      s.full_name,
      s.student_code,
      se.roll_number
    FROM student_enrollments se
    JOIN students s
      ON s.id = se.student_id
     AND s.school_id = se.school_id
    WHERE se.school_id = $1
      AND se.academic_year_id = $2
      AND se.term = $3
      AND se.stage_id = $4
      AND se.grade_id = $5
      AND se.section_id = $6
      AND COALESCE(se.status, 'enrolled') = 'enrolled'
    ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
    `,
    [schoolId, academicYearId, term, stageId, gradeId, sectionId]
  );

  return rows;
}

async function loadExpectedSubjects(db, params, termConfig) {
  const { schoolId, academicYearId, term, stageId, gradeId, sectionId } = params;

  const { rows } = await db.query(
    `
    SELECT DISTINCT ON (ta.subject_id)
      ta.id AS teacher_assignment_id,
      ta.subject_id,
      subj.name AS subject_name,

      twa.status AS approval_status,
      twa.approved_at,

      exam_assm.id AS exam_assessment_id,
      exam_assm.max_score AS exam_max_score,

      agg_assm.id AS aggregate_assessment_id,
      agg_assm.max_score AS aggregate_max_score

    FROM teacher_assignments ta
    JOIN teachers t
      ON t.id = ta.teacher_id
     AND t.school_id = $1
     AND COALESCE(t.is_active, true) = true
    JOIN subjects subj
      ON subj.id = ta.subject_id

    LEFT JOIN term_work_approvals twa
      ON twa.school_id = $1
     AND twa.academic_year_id = ta.academic_year_id
     AND twa.term = ta.term
     AND twa.stage_id = ta.stage_id
     AND twa.grade_id = ta.grade_id
     AND twa.section_id = $6
     AND twa.subject_id = ta.subject_id
     AND twa.teacher_assignment_id = ta.id

    LEFT JOIN LATERAL (
      SELECT a.id, a.max_score
      FROM assessments a
      WHERE a.school_id = $1
        AND a.teacher_assignment_id = ta.id
        AND (
          (a.type = 'exam' AND a.exam_kind = $7)
          OR a.type = $8
        )
      ORDER BY a.id DESC
      LIMIT 1
    ) exam_assm ON true

    LEFT JOIN LATERAL (
      SELECT a.id, a.max_score
      FROM assessments a
      WHERE a.school_id = $1
        AND a.teacher_assignment_id = ta.id
        AND (
          (a.type = 'aggregate' AND a.aggregate_kind = $9)
          OR a.type = $10
        )
      ORDER BY a.id DESC
      LIMIT 1
    ) agg_assm ON true

    WHERE ta.academic_year_id = $2
      AND ta.term = $3
      AND ta.stage_id = $4
      AND ta.grade_id = $5
      AND (ta.section_id = $6 OR ta.section_id IS NULL)

    ORDER BY ta.subject_id, ta.id DESC
    `,
    [
      schoolId,
      academicYearId,
      term,
      stageId,
      gradeId,
      sectionId,
      termConfig.exam_kind,
      termConfig.legacy_exam_type,
      termConfig.aggregate_kind,
      termConfig.legacy_aggregate_type,
    ]
  );

  return rows;
}

async function loadGradesMap(db, schoolId, assessmentIds, studentIds) {
  const ids = assessmentIds.map(Number).filter(Boolean);
  const students = studentIds.map(Number).filter(Boolean);

  if (!ids.length || !students.length) return new Map();

  const { rows } = await db.query(
    `
    SELECT
      assessment_id,
      student_id,
      status,
      score,
      is_published
    FROM assessment_grades
    WHERE school_id = $1
      AND assessment_id = ANY($2::bigint[])
      AND student_id = ANY($3::bigint[])
    `,
    [schoolId, ids, students]
  );

  const map = new Map();

  for (const row of rows) {
    map.set(`${Number(row.assessment_id)}:${Number(row.student_id)}`, row);
  }

  return map;
}

async function getOrCreateBatch(db, params, userId) {
  const { schoolId, academicYearId, term, stageId, gradeId, sectionId } = params;

  const existing = await db.query(
    `
    SELECT *
    FROM term_result_batches
    WHERE school_id = $1
      AND academic_year_id = $2
      AND term = $3
      AND stage_id = $4
      AND grade_id = $5
      AND section_id = $6
    LIMIT 1
    `,
    [schoolId, academicYearId, term, stageId, gradeId, sectionId]
  );

  if (existing.rows.length) {
    const batch = existing.rows[0];

    if (["approved", "published"].includes(batch.status)) {
      throw badRequest("لا يمكن إعادة احتساب نتائج معتمدة أو منشورة.");
    }

    const updated = await db.query(
      `
      UPDATE term_result_batches
      SET
        status = 'calculated',
        calculated_by = $1,
        calculated_at = NOW(),
        approved_by = NULL,
        approved_at = NULL,
        published_by = NULL,
        published_at = NULL,
        updated_at = NOW()
      WHERE id = $2
        AND school_id = $3
      RETURNING *
      `,
      [userId, batch.id, schoolId]
    );

    return updated.rows[0];
  }

  const inserted = await db.query(
    `
    INSERT INTO term_result_batches (
      school_id,
      academic_year_id,
      term,
      stage_id,
      grade_id,
      section_id,
      status,
      calculated_by,
      calculated_at,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      'calculated',
      $7,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING *
    `,
    [schoolId, academicYearId, term, stageId, gradeId, sectionId, userId]
  );

  return inserted.rows[0];
}

function buildSubjectResult({ subject, studentId, gradeMap, termConfig }) {
  const examMax = toNumber(subject.exam_max_score, termConfig.exam_max);
  const aggregateMax = toNumber(subject.aggregate_max_score, termConfig.aggregate_max);
  const maxScore = examMax + aggregateMax;
  const passScore = getSubjectPassScore(termConfig, maxScore);

  if (subject.approval_status !== "approved") {
    return {
      student_id: studentId,
      subject_id: subject.subject_id,
      teacher_assignment_id: subject.teacher_assignment_id,
      exam_assessment_id: subject.exam_assessment_id || null,
      aggregate_assessment_id: subject.aggregate_assessment_id || null,
      exam_score: null,
      aggregate_score: null,
      total_score: null,
      max_score: maxScore,
      percentage: null,
      grade_label: null,
      status: "not_approved",
      missing_reason: "لم تعتمد الأعمال الفصلية من الكنترول.",
    };
  }

  const examGrade = subject.exam_assessment_id
    ? gradeMap.get(`${Number(subject.exam_assessment_id)}:${Number(studentId)}`)
    : null;

  const aggregateGrade = subject.aggregate_assessment_id
    ? gradeMap.get(`${Number(subject.aggregate_assessment_id)}:${Number(studentId)}`)
    : null;

  const exam = readGradeComponent(examGrade);
  const aggregate = readGradeComponent(aggregateGrade);

  if (!exam.ok || !aggregate.ok) {
    const reasonParts = [];

    if (!exam.ok) reasonParts.push(`${termConfig.exam_label}: ${exam.reason}`);
    if (!aggregate.ok) reasonParts.push(`${termConfig.aggregate_label}: ${aggregate.reason}`);

    const status =
      exam.kind === "excused" || aggregate.kind === "excused"
        ? "excused"
        : "missing";

    return {
      student_id: studentId,
      subject_id: subject.subject_id,
      teacher_assignment_id: subject.teacher_assignment_id,
      exam_assessment_id: subject.exam_assessment_id || null,
      aggregate_assessment_id: subject.aggregate_assessment_id || null,
      exam_score: exam.score,
      aggregate_score: aggregate.score,
      total_score: null,
      max_score: maxScore,
      percentage: null,
      grade_label: null,
      status,
      missing_reason: reasonParts.join(" | "),
    };
  }

  const total = Number(exam.score) + Number(aggregate.score);
  const percentage = maxScore > 0 ? (total / maxScore) * 100 : null;
  const subjectPassScore = passScore || termConfig.pass_score;
  const status = total >= subjectPassScore ? "passed" : "failed";
  const gradeLabel = getGradeLabel(percentage);

  const notes = [];
  if (exam.kind === "absent") notes.push(`${termConfig.exam_label}: غائب حُسب صفر.`);
  if (aggregate.kind === "absent") notes.push(`${termConfig.aggregate_label}: غائب حُسب صفر.`);

  return {
    student_id: studentId,
    subject_id: subject.subject_id,
    teacher_assignment_id: subject.teacher_assignment_id,
    exam_assessment_id: subject.exam_assessment_id || null,
    aggregate_assessment_id: subject.aggregate_assessment_id || null,
    exam_score: exam.score,
    aggregate_score: aggregate.score,
    total_score: total,
    max_score: maxScore,
    percentage,
    grade_label: gradeLabel,
    status,
    missing_reason: notes.length ? notes.join(" | ") : null,
  };
}

async function insertStudentResult(db, params) {
  const {
    schoolId,
    batchId,
    studentId,
    totalScore,
    maxScore,
    percentage,
    gradeLabel,
    passedSubjects,
    failedSubjects,
    missingSubjects,
    status,
  } = params;

  const { rows } = await db.query(
    `
    INSERT INTO term_result_students (
      school_id,
      batch_id,
      student_id,
      total_score,
      max_score,
      percentage,
      grade_label,
      passed_subjects,
      failed_subjects,
      missing_subjects,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
    )
    RETURNING id
    `,
    [
      schoolId,
      batchId,
      studentId,
      totalScore,
      maxScore,
      percentage,
      gradeLabel,
      passedSubjects,
      failedSubjects,
      missingSubjects,
      status,
    ]
  );

  return rows[0].id;
}

async function insertSubjectResults(db, schoolId, batchId, studentResultId, subjectResults) {
  for (const item of subjectResults) {
    await db.query(
      `
      INSERT INTO term_result_subjects (
        school_id,
        batch_id,
        student_result_id,
        student_id,
        subject_id,
        teacher_assignment_id,
        exam_assessment_id,
        aggregate_assessment_id,
        exam_score,
        aggregate_score,
        total_score,
        max_score,
        percentage,
        grade_label,
        status,
        missing_reason,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        NOW(), NOW()
      )
      `,
      [
        schoolId,
        batchId,
        studentResultId,
        item.student_id,
        item.subject_id,
        item.teacher_assignment_id,
        item.exam_assessment_id,
        item.aggregate_assessment_id,
        item.exam_score,
        item.aggregate_score,
        item.total_score,
        item.max_score,
        item.percentage,
        item.grade_label ?? null,
        item.status,
        item.missing_reason,
      ]
    );
  }
}

async function updateRanks(db, schoolId, batchId) {
  await db.query(
    `
    WITH ranked AS (
      SELECT
        id,
        DENSE_RANK() OVER (
          ORDER BY percentage DESC, total_score DESC, id ASC
        ) AS rnk
      FROM term_result_students
      WHERE school_id = $1
        AND batch_id = $2
        AND status IN ('passed', 'failed')
        AND percentage IS NOT NULL
    )
    UPDATE term_result_students trs
    SET rank_in_section = ranked.rnk,
        updated_at = NOW()
    FROM ranked
    WHERE trs.id = ranked.id
    `,
    [schoolId, batchId]
  );
}

async function findBatch(db, params) {
  const { schoolId, academicYearId, term, stageId, gradeId, sectionId } = params;

  const { rows } = await db.query(
    `
    SELECT *
    FROM term_result_batches
    WHERE school_id = $1
      AND academic_year_id = $2
      AND term = $3
      AND stage_id = $4
      AND grade_id = $5
      AND section_id = $6
    LIMIT 1
    `,
    [schoolId, academicYearId, term, stageId, gradeId, sectionId]
  );

  return rows[0] || null;
}

async function loadBatchData(db, batchId, schoolId) {
  const batchQ = await db.query(
    `
    SELECT *
    FROM term_result_batches
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [batchId, schoolId]
  );

  const batch = batchQ.rows[0] || null;

  if (!batch) {
    return {
      batch: null,
      summary: {
        students_count: 0,
        passed_count: 0,
        failed_count: 0,
        incomplete_count: 0,
      },
      students: [],
    };
  }

  const studentsQ = await db.query(
    `
    SELECT
      trs.*,
      s.full_name,
      s.student_code,
      se.roll_number
    FROM term_result_students trs
    JOIN students s
      ON s.id = trs.student_id
     AND s.school_id = trs.school_id
    LEFT JOIN student_enrollments se
      ON se.student_id = trs.student_id
     AND se.school_id = trs.school_id
     AND se.academic_year_id = $3
     AND se.term = $4
    WHERE trs.school_id = $1
      AND trs.batch_id = $2
    ORDER BY
      CASE WHEN trs.rank_in_section IS NULL THEN 999999 ELSE trs.rank_in_section END,
      COALESCE(se.roll_number, 999999),
      s.full_name ASC
    `,
    [schoolId, batchId, batch.academic_year_id, batch.term]
  );

  const subjectsQ = await db.query(
    `
    SELECT
      trsub.*,
      subj.name AS subject_name
    FROM term_result_subjects trsub
    LEFT JOIN subjects subj
      ON subj.id = trsub.subject_id
    WHERE trsub.school_id = $1
      AND trsub.batch_id = $2
    ORDER BY subj.name ASC, trsub.subject_id ASC
    `,
    [schoolId, batchId]
  );

  const subjectsByStudent = new Map();

  for (const item of subjectsQ.rows) {
    const key = Number(item.student_id);
    if (!subjectsByStudent.has(key)) subjectsByStudent.set(key, []);
    subjectsByStudent.get(key).push(item);
  }

  const students = studentsQ.rows.map((student) => ({
    ...student,
    subjects: subjectsByStudent.get(Number(student.student_id)) || [],
  }));

  return {
    batch,
    summary: {
      students_count: students.length,
      passed_count: students.filter((s) => s.status === "passed").length,
      failed_count: students.filter((s) => s.status === "failed").length,
      incomplete_count: students.filter((s) => s.status === "incomplete").length,
    },
    students,
  };
}

function parseFiltersFromQuery(req) {
  const schoolId = req.user?.school_id;
  const userId = pickUserId(req);

  if (!schoolId || !userId) {
    return {
      unauthorized: true,
    };
  }

  return {
    schoolId,
    userId,
    academicYearId: parseId(req.query.academic_year_id, "السنة الدراسية"),
    term: parseTerm(req.query.term),
    stageId: parseId(req.query.stage_id, "المرحلة"),
    gradeId: parseId(req.query.grade_id, "الصف"),
    sectionId: parseId(req.query.section_id, "الشعبة"),
  };
}

function parseFiltersFromBody(req) {
  const schoolId = req.user?.school_id;
  const userId = pickUserId(req);

  if (!schoolId || !userId) {
    return {
      unauthorized: true,
    };
  }

  return {
    schoolId,
    userId,
    academicYearId: parseId(req.body.academic_year_id, "السنة الدراسية"),
    term: parseTerm(req.body.term),
    stageId: parseId(req.body.stage_id, "المرحلة"),
    gradeId: parseId(req.body.grade_id, "الصف"),
    sectionId: parseId(req.body.section_id, "الشعبة"),
  };
}

export async function getTermResults(req, res) {
  try {
    const filters = parseFiltersFromQuery(req);

    if (filters.unauthorized) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const batch = await findBatch(pool, filters);

    if (!batch) {
      return res.json({
        batch: null,
        summary: {
          students_count: 0,
          passed_count: 0,
          failed_count: 0,
          incomplete_count: 0,
        },
        students: [],
      });
    }

    const data = await loadBatchData(pool, batch.id, filters.schoolId);
    return res.json(data);
  } catch (e) {
    console.error("getTermResults error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function calculateTermResults(req, res) {
  const client = await pool.connect();

  try {
    const filters = parseFiltersFromBody(req);

    if (filters.unauthorized) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    await client.query("BEGIN");

    const settings = await getSchoolSettings(client, filters.schoolId);
    const termConfig = getTermConfig(settings, filters.term);

    const students = await loadStudents(client, filters);

    if (!students.length) {
      throw badRequest("لا يوجد طلاب في هذه الشعبة.");
    }

    const subjects = await loadExpectedSubjects(client, filters, termConfig);

    if (!subjects.length) {
      throw badRequest("لا توجد مواد أو تكليفات معلمين لهذه الشعبة.");
    }

    const batch = await getOrCreateBatch(client, filters, filters.userId);

    await client.query(
      `
      DELETE FROM term_result_subjects
      WHERE school_id = $1
        AND batch_id = $2
      `,
      [filters.schoolId, batch.id]
    );

    await client.query(
      `
      DELETE FROM term_result_students
      WHERE school_id = $1
        AND batch_id = $2
      `,
      [filters.schoolId, batch.id]
    );

    const assessmentIds = subjects.flatMap((s) => [
      s.exam_assessment_id,
      s.aggregate_assessment_id,
    ]);

    const studentIds = students.map((s) => Number(s.student_id));

    const gradeMap = await loadGradesMap(
      client,
      filters.schoolId,
      assessmentIds,
      studentIds
    );

    for (const student of students) {
      const subjectResults = subjects.map((subject) =>
        buildSubjectResult({
          subject,
          studentId: Number(student.student_id),
          gradeMap,
          termConfig,
        })
      );

      const missingSubjects = subjectResults.filter((s) =>
        ["missing", "excused", "not_approved"].includes(s.status)
      ).length;

      const failedSubjects = subjectResults.filter((s) => s.status === "failed").length;
      const passedSubjects = subjectResults.filter((s) => s.status === "passed").length;

      const isComplete = missingSubjects === 0;

      const totalScore = isComplete
        ? subjectResults.reduce((sum, s) => sum + Number(s.total_score || 0), 0)
        : null;

      const maxScore = isComplete
        ? subjectResults.reduce((sum, s) => sum + Number(s.max_score || 0), 0)
        : null;

      const percentage =
        isComplete && maxScore > 0
          ? (Number(totalScore) / Number(maxScore)) * 100
          : null;

      const gradeLabel = isComplete ? getGradeLabel(percentage) : null;

      const status = !isComplete
        ? "incomplete"
        : failedSubjects > 0
          ? "failed"
          : "passed";

      const studentResultId = await insertStudentResult(client, {
        schoolId: filters.schoolId,
        batchId: batch.id,
        studentId: Number(student.student_id),
        totalScore,
        maxScore,
        percentage,
        gradeLabel,
        passedSubjects,
        failedSubjects,
        missingSubjects,
        status,
      });

      await insertSubjectResults(
        client,
        filters.schoolId,
        batch.id,
        studentResultId,
        subjectResults
      );
    }

    await updateRanks(client, filters.schoolId, batch.id);

    await client.query("COMMIT");

    const data = await loadBatchData(pool, batch.id, filters.schoolId);

    return res.json({
      message: "تم احتساب نتائج نهاية الفصل بنجاح.",
      ...data,
    });
  } catch (e) {
    await client.query("ROLLBACK");

    console.error("calculateTermResults error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    client.release();
  }
}

export async function approveTermResults(req, res) {
  try {
    const filters = parseFiltersFromBody(req);

    if (filters.unauthorized) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const batch = await findBatch(pool, filters);

    if (!batch) {
      throw badRequest("لا توجد نتائج محسوبة للاعتماد.");
    }

    if (batch.status === "published") {
      throw badRequest("لا يمكن اعتماد نتيجة منشورة مسبقًا.");
    }

    const data = await loadBatchData(pool, batch.id, filters.schoolId);

    if (!data.students.length) {
      throw badRequest("لا توجد نتائج طلاب للاعتماد.");
    }

    const incompleteCount = data.students.filter((s) => s.status === "incomplete").length;

    if (incompleteCount > 0) {
      throw badRequest(`لا يمكن اعتماد النتائج، يوجد ${incompleteCount} طالب لديهم نتائج ناقصة.`);
    }

    const { rows } = await pool.query(
      `
      UPDATE term_result_batches
      SET
        status = 'approved',
        approved_by = $1,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
        AND school_id = $3
      RETURNING *
      `,
      [filters.userId, batch.id, filters.schoolId]
    );

    const updatedData = await loadBatchData(pool, rows[0].id, filters.schoolId);

    return res.json({
      message: "تم اعتماد نتائج نهاية الفصل.",
      ...updatedData,
    });
  } catch (e) {
    console.error("approveTermResults error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function publishTermResults(req, res) {
  try {
    const filters = parseFiltersFromBody(req);

    if (filters.unauthorized) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const batch = await findBatch(pool, filters);

    if (!batch) {
      throw badRequest("لا توجد نتائج للنشر.");
    }

    if (batch.status !== "approved") {
      throw badRequest("لا يمكن نشر النتائج إلا بعد اعتمادها.");
    }

    const { rows } = await pool.query(
      `
      UPDATE term_result_batches
      SET
        status = 'published',
        published_by = $1,
        published_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
        AND school_id = $3
      RETURNING *
      `,
      [filters.userId, batch.id, filters.schoolId]
    );

    const data = await loadBatchData(pool, rows[0].id, filters.schoolId);

    try {
      await WorkflowNotifications.notifyTermResultsPublication({
        app: req.app,
        schoolId: filters.schoolId,
        batchId: rows[0].id,
        published: true,
      });
    } catch (notifyErr) {
      console.error("Notification error (term results published):", notifyErr);
    }

    return res.json({
      message: "تم نشر نتائج نهاية الفصل.",
      ...data,
    });
  } catch (e) {
    console.error("publishTermResults error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function unpublishTermResults(req, res) {
  try {
    const filters = parseFiltersFromBody(req);

    if (filters.unauthorized) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const batch = await findBatch(pool, filters);

    if (!batch) {
      throw badRequest("لا توجد نتائج.");
    }

    if (batch.status !== "published") {
      throw badRequest("النتائج ليست منشورة.");
    }

    const { rows } = await pool.query(
      `
      UPDATE term_result_batches
      SET
        status = 'approved',
        published_by = NULL,
        published_at = NULL,
        updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      RETURNING *
      `,
      [batch.id, filters.schoolId]
    );

    const data = await loadBatchData(pool, rows[0].id, filters.schoolId);

    try {
      await WorkflowNotifications.notifyTermResultsPublication({
        app: req.app,
        schoolId: filters.schoolId,
        batchId: rows[0].id,
        published: false,
      });
    } catch (notifyErr) {
      console.error("Notification error (term results unpublished):", notifyErr);
    }

    return res.json({
      message: "تم إلغاء نشر النتائج.",
      ...data,
    });
  } catch (e) {
    console.error("unpublishTermResults error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}