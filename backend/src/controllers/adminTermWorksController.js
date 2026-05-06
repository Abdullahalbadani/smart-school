import { pool } from "../config/db.js";

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function notFound(message) {
    const err = new Error(message);
    err.status = 404;
    return err;
}

function toPositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseId(value, name) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw badRequest(`${name} مطلوب.`);
    }
    return n;
}
function pickUserId(req) {
    const id = Number(req.user?.id || req.user?.user_id || req.user?.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
}
function getTermConfig(term, settings, examAssessment, aggregateAssessment) {
    if (term === 1) {
        const examMax =
            toPositiveNumber(examAssessment?.max_score) ||
            toPositiveNumber(settings?.midterm_exam_max_grade) ||
            30;

        const aggregateMax =
            toPositiveNumber(aggregateAssessment?.max_score) ||
            toPositiveNumber(settings?.midterm_muhassala_max_grade) ||
            20;

        return {
            term,
            term_label: "الفصل الأول",
            exam_kind: "midterm",
            aggregate_kind: "midterm",
            exam_label: "اختبار نصفي",
            aggregate_label: "محصلة النصفي",
            total_label: "مجموع الفصل الأول",
            exam_max: examMax,
            aggregate_max: aggregateMax,
            total_max: examMax + aggregateMax,
        };
    }

    if (term === 2) {
        const examMax =
            toPositiveNumber(examAssessment?.max_score) ||
            toPositiveNumber(settings?.final_exam_max_grade) ||
            30;

        const aggregateMax =
            toPositiveNumber(aggregateAssessment?.max_score) ||
            toPositiveNumber(settings?.final_muhassala_max_grade) ||
            20;

        return {
            term,
            term_label: "الفصل الثاني",
            exam_kind: "final",
            aggregate_kind: "final",
            exam_label: "اختبار نهائي",
            aggregate_label: "محصلة النهائي",
            total_label: "مجموع الفصل الثاني",
            exam_max: examMax,
            aggregate_max: aggregateMax,
            total_max: examMax + aggregateMax,
        };
    }

    throw badRequest("الفصل الدراسي غير صحيح.");
}

function gradeStatusText(row) {
    if (!row) return "غير موجود";
    if (!row.is_published) return "غير منشور";
    if (row.status === "graded") return "مرصود";
    if (row.status === "absent") return "غائب";
    if (row.status === "excused") return "معذور";
    if (row.status === "missing") return "ناقص";
    return row.status || "غير معروف";
}

function getPublishedScore(row) {
    if (!row) return null;
    if (!row.is_published) return null;
    if (row.status !== "graded") return null;

    const n = Number(row.score);
    return Number.isFinite(n) ? n : null;
}

async function getSchoolSettings(schoolId) {
    const { rows } = await pool.query(
        `
    SELECT
      midterm_exam_max_grade,
      midterm_muhassala_max_grade,
      final_exam_max_grade,
      final_muhassala_max_grade,
      midterm_max_grade,
      final_term_max_grade,
      grading_scale,
      pass_mark
    FROM school_settings
    WHERE school_id = $1
    LIMIT 1
    `,
        [schoolId]
    );

    return rows[0] || null;
}

async function findAssignment(params) {
    const {
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
    } = params;

    const { rows } = await pool.query(
        `
    SELECT
      ta.id,
      ta.teacher_id,
      ta.academic_year_id,
      ta.term,
      ta.stage_id,
      ta.grade_id,
      ta.section_id,
      ta.subject_id
    FROM teacher_assignments ta
    JOIN teachers t ON t.id = ta.teacher_id
    WHERE ta.academic_year_id = $1
      AND ta.term = $2
      AND ta.stage_id = $3
      AND ta.grade_id = $4
      AND ta.section_id = $5
      AND ta.subject_id = $6
      AND t.school_id = $7
      AND COALESCE(t.is_active, true) = true
    ORDER BY ta.id DESC
    LIMIT 1
    `,
        [academicYearId, term, stageId, gradeId, sectionId, subjectId, schoolId]
    );

    return rows[0] || null;
}

async function findAssessment(teacherAssignmentId, schoolId, kind, assessmentGroup) {
    const legacyType =
        assessmentGroup === "exam"
            ? kind === "midterm"
                ? "midterm_exam"
                : "final_exam"
            : kind === "midterm"
                ? "midterm_muhassala"
                : "final_muhassala";

    const kindColumn = assessmentGroup === "exam" ? "exam_kind" : "aggregate_kind";

    const { rows } = await pool.query(
        `
    SELECT
      id,
      teacher_assignment_id,
      type,
      exam_kind,
      aggregate_kind,
      status,
      title,
      max_score,
      published_at,
      closed_at
    FROM assessments
    WHERE teacher_assignment_id = $1
      AND school_id = $2
      AND (
        (type = $3 AND ${kindColumn} = $4)
        OR type = $5
      )
    ORDER BY id DESC
    LIMIT 1
    `,
        [teacherAssignmentId, schoolId, assessmentGroup, kind, legacyType]
    );

    return rows[0] || null;
}

async function loadStudents(params) {
    const { schoolId, academicYearId, term, gradeId, sectionId } = params;

    const { rows } = await pool.query(
        `
    SELECT
      se.student_id,
      s.full_name,
      s.student_code,
      se.roll_number
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.academic_year_id = $1
      AND se.term = $2
      AND se.grade_id = $3
      AND se.section_id = $4
      AND se.school_id = $5
      AND s.school_id = $5
      AND COALESCE(se.status, 'enrolled') = 'enrolled'
    ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
    `,
        [academicYearId, term, gradeId, sectionId, schoolId]
    );

    return rows;
}

async function loadGradesMap(assessmentId, schoolId) {
    if (!assessmentId) return new Map();

    const { rows } = await pool.query(
        `
    SELECT
      student_id,
      status,
      score,
      COALESCE(is_published, false) AS is_published,
      published_at
    FROM assessment_grades
    WHERE assessment_id = $1
      AND school_id = $2
    `,
        [assessmentId, schoolId]
    );

    const map = new Map();

    for (const row of rows) {
        map.set(Number(row.student_id), {
            status: row.status,
            score: row.score,
            is_published: !!row.is_published,
            published_at: row.published_at,
        });
    }

    return map;
}

export async function getTermWorks(req, res) {
    try {
        const schoolId = req.user?.school_id;
        if (!schoolId) {
            return res.status(401).json({ message: "غير مصرح." });
        }

        const academicYearId = parseId(req.query.academic_year_id, "السنة الدراسية");
        const term = parseId(req.query.term, "الفصل الدراسي");
        const stageId = parseId(req.query.stage_id, "المرحلة");
        const gradeId = parseId(req.query.grade_id, "الصف");
        const sectionId = parseId(req.query.section_id, "الشعبة");
        const subjectId = parseId(req.query.subject_id, "المادة");

        if (![1, 2].includes(term)) {
            throw badRequest("الفصل الدراسي يجب أن يكون 1 أو 2.");
        }

        const data = await buildTermWorksData({
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
        });

        return res.json(data);
    } catch (e) {
        console.error("getTermWorks error:", e);
        return res.status(e.status || 500).json({
            message: e.message || "خطأ في السيرفر",
        });
    }
}

async function getApproval(params) {
    const {
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
        teacherAssignmentId,
    } = params;

    const { rows } = await pool.query(
        `
    SELECT
      id,
      status,
      approved_by,
      approved_at,
      returned_by,
      returned_at,
      return_note,
      created_at,
      updated_at
    FROM term_work_approvals
    WHERE school_id = $1
      AND academic_year_id = $2
      AND term = $3
      AND stage_id = $4
      AND grade_id = $5
      AND section_id = $6
      AND subject_id = $7
      AND teacher_assignment_id = $8
    LIMIT 1
    `,
        [
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
            teacherAssignmentId,
        ]
    );

    return rows[0] || {
        status: "pending",
        approved_by: null,
        approved_at: null,
        returned_by: null,
        returned_at: null,
        return_note: null,
    };
}

async function upsertApproval(params) {
    const {
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
        teacherAssignmentId,
        status,
        userId,
        note,
    } = params;

    const approvedBy = status === "approved" ? userId : null;
    const returnedBy = status === "returned" ? userId : null;
    const returnNote = status === "returned" ? note : null;

    const { rows } = await pool.query(
        `
    INSERT INTO term_work_approvals (
      school_id,
      academic_year_id,
      term,
      stage_id,
      grade_id,
      section_id,
      subject_id,
      teacher_assignment_id,
      status,
      approved_by,
      approved_at,
      returned_by,
      returned_at,
      return_note,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
 $9::varchar(20),
$10,
CASE WHEN $9::text = 'approved' THEN NOW() ELSE NULL END,
$11,
CASE WHEN $9::text = 'returned' THEN NOW() ELSE NULL END,
$12,
NOW()
    )
    ON CONFLICT (
      school_id,
      academic_year_id,
      term,
      stage_id,
      grade_id,
      section_id,
      subject_id,
      teacher_assignment_id
    )
    DO UPDATE SET
      status = EXCLUDED.status,
      approved_by = EXCLUDED.approved_by,
      approved_at = EXCLUDED.approved_at,
      returned_by = EXCLUDED.returned_by,
      returned_at = EXCLUDED.returned_at,
      return_note = EXCLUDED.return_note,
      updated_at = NOW()
    RETURNING *
    `,
        [
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
            teacherAssignmentId,
            status,
            approvedBy,
            returnedBy,
            returnNote,
        ]
    );

    return rows[0];
}

async function buildTermWorksData(params) {
    const {
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
    } = params;

    const assignment = await findAssignment({
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
    });

    if (!assignment) {
        throw notFound("لا يوجد تكليف معلم مطابق لهذه المادة والشعبة.");
    }

    const settings = await getSchoolSettings(schoolId);

    const baseConfig =
        term === 1
            ? {
                exam_kind: "midterm",
                aggregate_kind: "midterm",
            }
            : {
                exam_kind: "final",
                aggregate_kind: "final",
            };

    const examAssessment = await findAssessment(
        assignment.id,
        schoolId,
        baseConfig.exam_kind,
        "exam"
    );

    const aggregateAssessment = await findAssessment(
        assignment.id,
        schoolId,
        baseConfig.aggregate_kind,
        "aggregate"
    );

    const config = getTermConfig(term, settings, examAssessment, aggregateAssessment);

    const students = await loadStudents({
        schoolId,
        academicYearId,
        term,
        gradeId,
        sectionId,
    });

    const examGrades = await loadGradesMap(examAssessment?.id, schoolId);
    const aggregateGrades = await loadGradesMap(aggregateAssessment?.id, schoolId);

    const rows = students.map((student) => {
        const studentId = Number(student.student_id);

        const examGrade = examGrades.get(studentId) || null;
        const aggregateGrade = aggregateGrades.get(studentId) || null;

        const examScore = getPublishedScore(examGrade);
        const aggregateScore = getPublishedScore(aggregateGrade);

        const missing = [];

        if (!examAssessment) {
            missing.push(`لا يوجد ${config.exam_label}`);
        } else if (examScore === null) {
            missing.push(`${config.exam_label}: ${gradeStatusText(examGrade)}`);
        }

        if (!aggregateAssessment) {
            missing.push(`لا توجد ${config.aggregate_label}`);
        } else if (aggregateScore === null) {
            missing.push(`${config.aggregate_label}: ${gradeStatusText(aggregateGrade)}`);
        }

        const isComplete = missing.length === 0;
        const total = isComplete ? examScore + aggregateScore : null;

        return {
            student_id: studentId,
            full_name: student.full_name,
            student_code: student.student_code,
            roll_number: student.roll_number,
            exam_score: examScore,
            aggregate_score: aggregateScore,
            total_score: total,
            is_complete: isComplete,
            status: isComplete ? "مكتمل" : "ناقص",
            missing,
        };
    });

    const completeCount = rows.filter((row) => row.is_complete).length;
    const missingCount = rows.length - completeCount;

    const approval = await getApproval({
        schoolId,
        academicYearId,
        term,
        stageId,
        gradeId,
        sectionId,
        subjectId,
        teacherAssignmentId: assignment.id,
    });

    return {
        assignment,
        config,
        assessments: {
            exam: examAssessment
                ? {
                    id: examAssessment.id,
                    title: examAssessment.title,
                    status: examAssessment.status,
                    max_score: examAssessment.max_score,
                }
                : null,
            aggregate: aggregateAssessment
                ? {
                    id: aggregateAssessment.id,
                    title: aggregateAssessment.title,
                    status: aggregateAssessment.status,
                    max_score: aggregateAssessment.max_score,
                }
                : null,
        },
        approval,
        summary: {
            students_count: rows.length,
            complete_count: completeCount,
            missing_count: missingCount,
            can_approve: rows.length > 0 && missingCount === 0 && approval.status !== "approved",
        },
        students: rows,
    };
}
export async function approveTermWorks(req, res) {
    try {
        const schoolId = req.user?.school_id;
        const userId = pickUserId(req);

        if (!schoolId || !userId) {
            return res.status(401).json({ message: "غير مصرح." });
        }

        const academicYearId = parseId(req.body.academic_year_id, "السنة الدراسية");
        const term = parseId(req.body.term, "الفصل الدراسي");
        const stageId = parseId(req.body.stage_id, "المرحلة");
        const gradeId = parseId(req.body.grade_id, "الصف");
        const sectionId = parseId(req.body.section_id, "الشعبة");
        const subjectId = parseId(req.body.subject_id, "المادة");

        if (![1, 2].includes(term)) {
            throw badRequest("الفصل الدراسي يجب أن يكون 1 أو 2.");
        }

        const data = await buildTermWorksData({
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
        });

        if (!data.summary.can_approve) {
            throw badRequest(
                data.summary.missing_count > 0
                    ? `لا يمكن اعتماد المادة، يوجد ${data.summary.missing_count} طالب لديهم درجات ناقصة.`
                    : "لا يمكن اعتماد هذه المادة."
            );
        }

        const approval = await upsertApproval({
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
            teacherAssignmentId: data.assignment.id,
            status: "approved",
            userId,
            note: null,
        });

        return res.json({
            message: "تم اعتماد الأعمال الفصلية بنجاح.",
            approval,
        });
    } catch (e) {
        console.error("approveTermWorks error:", e);
        return res.status(e.status || 500).json({
            message: e.message || "خطأ في السيرفر",
        });
    }
}
function getTermWorkKinds(term) {
  const t = Number(term);

  if (t === 1) {
    return {
      examKind: "midterm",
      aggregateKind: "midterm",
      legacyExamType: "midterm_exam",
      legacyAggregateType: "midterm_muhassala",
    };
  }

  if (t === 2) {
    return {
      examKind: "final",
      aggregateKind: "final",
      legacyExamType: "final_exam",
      legacyAggregateType: "final_muhassala",
    };
  }

  throw badRequest("الفصل الدراسي يجب أن يكون 1 أو 2.");
}

async function reopenReturnedTermWorkAssessments(params) {
  const { schoolId, teacherAssignmentId, term } = params;
  const kinds = getTermWorkKinds(term);

  const { rows } = await pool.query(
    `
    SELECT id
    FROM assessments
    WHERE school_id = $1
      AND teacher_assignment_id = $2
      AND (
        (type = 'exam' AND exam_kind = $3)
        OR
        (type = 'aggregate' AND aggregate_kind = $4)
        OR
        type = $5
        OR
        type = $6
      )
    `,
    [
      schoolId,
      teacherAssignmentId,
      kinds.examKind,
      kinds.aggregateKind,
      kinds.legacyExamType,
      kinds.legacyAggregateType,
    ]
  );

  const assessmentIds = rows.map((r) => Number(r.id)).filter(Boolean);

  if (!assessmentIds.length) {
    return;
  }

  // نفتح درجات الطلاب للتعديل من جديد
  await pool.query(
    `
    UPDATE assessment_grades
    SET
      is_published = false,
      published_at = NULL,
      updated_at = NOW()
    WHERE school_id = $1
      AND assessment_id = ANY($2::bigint[])
    `,
    [schoolId, assessmentIds]
  );

  // إذا كان التقييم مغلقًا، نعيده منشورًا كنشاط موجود لكن درجاته غير منشورة
  await pool.query(
    `
    UPDATE assessments
    SET
      status = CASE WHEN status = 'closed' THEN 'published' ELSE status END,
      closed_at = NULL,
      updated_at = NOW()
    WHERE school_id = $1
      AND id = ANY($2::bigint[])
    `,
    [schoolId, assessmentIds]
  );
}
export async function returnTermWorks(req, res) {
    try {
        const schoolId = req.user?.school_id;
        const userId = pickUserId(req);

        if (!schoolId || !userId) {
            return res.status(401).json({ message: "غير مصرح." });
        }

        const academicYearId = parseId(req.body.academic_year_id, "السنة الدراسية");
        const term = parseId(req.body.term, "الفصل الدراسي");
        const stageId = parseId(req.body.stage_id, "المرحلة");
        const gradeId = parseId(req.body.grade_id, "الصف");
        const sectionId = parseId(req.body.section_id, "الشعبة");
        const subjectId = parseId(req.body.subject_id, "المادة");
const note = String(req.body.note || req.body.return_note || "").trim();
        if (![1, 2].includes(term)) {
            throw badRequest("الفصل الدراسي يجب أن يكون 1 أو 2.");
        }

        if (!note) {
            throw badRequest("اكتب سبب الإرجاع للمعلم.");
        }

        const data = await buildTermWorksData({
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
        });
if (data.approval?.status === "approved") {
  throw badRequest("لا يمكن إرجاع أعمال فصلية معتمدة.");
}
        const approval = await upsertApproval({
            schoolId,
            academicYearId,
            term,
            stageId,
            gradeId,
            sectionId,
            subjectId,
            teacherAssignmentId: data.assignment.id,
            status: "returned",
            userId,
            note,
        });
await reopenReturnedTermWorkAssessments({
  schoolId,
  teacherAssignmentId: data.assignment.id,
  term,
});
        return res.json({
            message: "تم إرجاع الأعمال الفصلية للمعلم.",
            approval,
        });
    } catch (e) {
        console.error("returnTermWorks error:", e);
        return res.status(e.status || 500).json({
            message: e.message || "خطأ في السيرفر",
        });
    }
}