// src/controllers/studentLearningController.js
import { unlink } from "fs/promises";
import { pool } from "../config/db.js";

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function pickSchoolId(req) {
  const value = Number(req.user?.school_id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

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

function parseRequiredPositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} غير صحيح.`);
  }

  return parsed;
}

function parseOptionalPositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseRequiredPositiveInteger(value, fieldName);
}

async function removeUploadedFile(file) {
  if (!file?.path) return;

  try {
    await unlink(file.path);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("removeUploadedFile error:", error);
    }
  }
}

// ✅ سحب بيانات الطالب للسنة النشطة فقط (مع حماية school_id)
async function getStudentContext(userId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      s.id AS student_id,
      s.full_name,
      s.student_code,
      se.id AS enrollment_id,
      se.academic_year_id,
      se.term,
      se.stage_id,
      se.grade_id,
      se.section_id
    FROM students s
    LEFT JOIN LATERAL (
      SELECT se1.*
      FROM student_enrollments se1
      JOIN academic_years ay
        ON ay.id = se1.academic_year_id
       AND ay.school_id = se1.school_id
      WHERE se1.student_id = s.id
        AND COALESCE(se1.status, 'enrolled') = 'enrolled'
        AND ay.is_active = true
        AND ay.school_id = $2
        AND se1.school_id = $2
      ORDER BY se1.id DESC
      LIMIT 1
    ) se ON TRUE
    WHERE s.user_id = $1
      AND s.school_id = $2
    LIMIT 1
    `,
    [userId, schoolId]
  );

  return rows[0] ?? null;
}

// ✅ جلب تقييم متاح للطالب فقط ومنع الوصول إلى بيانات مدرسة أخرى
async function getAccessibleAssessment(studentCtx, assessmentId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      a.*,
      ta.academic_year_id,
      ta.term,
      ta.stage_id,
      ta.grade_id,
      ta.section_id,
      ta.subject_id,
      subj.name AS subject_name,
      t.full_name AS teacher_name
    FROM assessments a
    JOIN teacher_assignments ta
      ON ta.id = a.teacher_assignment_id
     AND ta.school_id = a.school_id
    LEFT JOIN subjects subj
      ON subj.id = ta.subject_id
     AND subj.school_id = a.school_id
    LEFT JOIN teachers t
      ON t.id = ta.teacher_id
     AND t.school_id = a.school_id
    WHERE a.id = $1
      AND a.school_id = $6
      AND ta.school_id = $6
      AND ta.academic_year_id = $2
      AND ta.term = $3
      AND (
        ta.section_id = $4
        OR (ta.section_id IS NULL AND ta.grade_id = $5)
      )
      AND a.status IN ('published', 'active', 'closed')
    LIMIT 1
    `,
    [
      assessmentId,
      studentCtx.academic_year_id,
      studentCtx.term,
      studentCtx.section_id,
      studentCtx.grade_id,
      schoolId,
    ]
  );

  return rows[0] ?? null;
}

function normalizeMode(mode) {
  const raw = String(mode || "").trim();

  const map = {
    in_class: "in_class",
    home_submission: "home_submission",
    home_no_submission: "home_no_submission",
    live_online: "live_online",
    submission: "home_submission",
    at_home: "home_no_submission",
    online_exam: "live_online",
  };

  return map[raw] || raw;
}

function buildStudentStatus(row) {
  if (row.is_published === true && row.score != null) return "graded";
  if (row.submission_id) return "submitted";
  if (row.status === "closed" && !row.submission_id) return "missed";
  return "pending";
}

function canStudentSubmit(assessment, existingSubmission) {
  const mode = normalizeMode(assessment.mode);

  if (existingSubmission) {
    return {
      allowed: false,
      reason: "تم إرسال الحل مسبقًا، ويسمح النظام بتسليم واحد فقط.",
    };
  }

  if (!["home_submission", "live_online"].includes(mode)) {
    return {
      allowed: false,
      reason: "هذا التقييم لا يستقبل تسليمًا من الطالب.",
    };
  }

  if (assessment.status === "closed") {
    return {
      allowed: false,
      reason: "تم إغلاق هذا التقييم.",
    };
  }

  const now = Date.now();

  if (assessment.starts_at) {
    const startsAt = new Date(assessment.starts_at).getTime();

    if (Number.isFinite(startsAt) && now < startsAt) {
      return {
        allowed: false,
        reason: "لم يبدأ وقت التقييم بعد.",
      };
    }
  }

  const latePolicy = assessment.late_policy_json || {};

  const allowLate =
    !!latePolicy.allow_late_submission ||
    !!latePolicy.allow_late ||
    false;

  if (assessment.due_at) {
    const dueAt = new Date(assessment.due_at).getTime();

    if (Number.isFinite(dueAt) && now > dueAt) {
      if (!allowLate) {
        return {
          allowed: false,
          reason: "انتهى موعد التسليم.",
        };
      }

      const lateUntil = latePolicy.late_until
        ? new Date(latePolicy.late_until).getTime()
        : null;

      if (lateUntil && Number.isFinite(lateUntil) && now > lateUntil) {
        return {
          allowed: false,
          reason: "انتهت أيضًا فترة التسليم المتأخر.",
        };
      }
    }
  }

  return {
    allowed: true,
    reason: null,
  };
}

// ✅ تصفية الأنشطة بشكل سليم
export async function listStudentActivities(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = pickSchoolId(req);

    if (!userId || !schoolId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const studentCtx = await getStudentContext(userId, schoolId);

    if (!studentCtx?.student_id || !studentCtx.section_id) {
      return res.status(403).json({
        message: "لم يتم العثور على تسجيل دراسي فعّال للطالب.",
      });
    }

    const status = String(req.query.status || "all").trim();

    const subjectId = parseOptionalPositiveInteger(
      req.query.subject_id,
      "subject_id"
    );

    const q = String(req.query.q || "").trim();

    const params = [
      studentCtx.student_id,
      studentCtx.academic_year_id,
      studentCtx.term,
      studentCtx.section_id,
      studentCtx.grade_id,
      schoolId,
    ];

    const where = [
      `ta.academic_year_id = $2`,
      `ta.term = $3`,
      `(ta.section_id = $4 OR (ta.section_id IS NULL AND ta.grade_id = $5))`,
      `ta.school_id = $6`,
      `a.type <> 'aggregate'`,
      `a.status IN ('published', 'active', 'closed')`,
      `a.school_id = $6`,
    ];

    let idx = 7;

    if (subjectId) {
      params.push(subjectId);
      where.push(`ta.subject_id = $${idx++}`);
    }

    if (q) {
      params.push(`%${q}%`);

      where.push(
        `(a.title ILIKE $${idx} OR COALESCE(subj.name, '') ILIKE $${idx})`
      );

      idx += 1;
    }

    const { rows } = await pool.query(
      `
      SELECT
        a.id,
        a.title,
        a.type,
        a.mode,
        a.status,
        a.description,
        a.max_score,
        a.starts_at,
        a.due_at,
        a.created_at,
        subj.id AS subject_id,
        subj.name AS subject_name,
        t.full_name AS teacher_name,
        sub.id AS submission_id,
        sub.submitted_at,
        ag.score,
        ag.is_published
      FROM assessments a
      JOIN teacher_assignments ta
        ON ta.id = a.teacher_assignment_id
       AND ta.school_id = a.school_id
      LEFT JOIN subjects subj
        ON subj.id = ta.subject_id
       AND subj.school_id = a.school_id
      LEFT JOIN teachers t
        ON t.id = ta.teacher_id
       AND t.school_id = a.school_id
      LEFT JOIN submissions sub
        ON sub.assessment_id = a.id
       AND sub.student_id = $1
       AND sub.school_id = $6
      LEFT JOIN assessment_grades ag
        ON ag.assessment_id = a.id
       AND ag.student_id = $1
       AND ag.school_id = $6
      WHERE ${where.join(" AND ")}
      ORDER BY
        COALESCE(a.due_at, a.starts_at, a.created_at) DESC,
        a.id DESC
      `,
      params
    );

    let items = rows.map((row) => ({
      ...row,
      student_status: buildStudentStatus(row),
    }));

    if (status !== "all") {
      items = items.filter((item) => item.student_status === status);
    }

    return res.json({
      items,
    });
  } catch (e) {
    console.error("listStudentActivities error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

// ✅ جلب نشاط واحد للطالب مع الدرجة والمرفقات
export async function getStudentActivityDetail(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = pickSchoolId(req);

    if (!userId || !schoolId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const studentCtx = await getStudentContext(userId, schoolId);

    if (!studentCtx?.student_id || !studentCtx.section_id) {
      return res.status(403).json({
        message: "لم يتم العثور على تسجيل دراسي فعّال للطالب.",
      });
    }

    const assessmentId = parseRequiredPositiveInteger(
      req.params.id,
      "id"
    );

    const assessment = await getAccessibleAssessment(
      studentCtx,
      assessmentId,
      schoolId
    );

    if (!assessment) {
      throw notFound("النشاط غير موجود.");
    }

    const submissionQ = await pool.query(
      `
      SELECT
        id,
        status,
        note AS submitted_text,
        submitted_at,
        created_at
      FROM submissions
      WHERE assessment_id = $1
        AND student_id = $2
        AND school_id = $3
      ORDER BY
        COALESCE(submitted_at, created_at) DESC,
        id DESC
      LIMIT 1
      `,
      [
        assessmentId,
        studentCtx.student_id,
        schoolId,
      ]
    );

    const submission = submissionQ.rows[0] || null;

    if (submission) {
      const submissionAttachmentsQ = await pool.query(
        `
        SELECT
          id,
          file_url,
          file_name,
          file_type,
          file_size
        FROM submission_attachments
        WHERE submission_id = $1
          AND school_id = $2
        ORDER BY id ASC
        `,
        [
          submission.id,
          schoolId,
        ]
      );

      submission.attachments = submissionAttachmentsQ.rows;
    }

    const gradeQ = await pool.query(
      `
      SELECT
        score,
        feedback,
        is_published
      FROM assessment_grades
      WHERE assessment_id = $1
        AND student_id = $2
        AND school_id = $3
      LIMIT 1
      `,
      [
        assessmentId,
        studentCtx.student_id,
        schoolId,
      ]
    );

    const grade = gradeQ.rows[0] || null;

    const assessmentAttachmentsQ = await pool.query(
      `
      SELECT
        id,
        file_url,
        file_name,
        file_type,
        file_size
      FROM assessment_attachments
      WHERE assessment_id = $1
        AND school_id = $2
      ORDER BY id ASC
      `,
      [
        assessmentId,
        schoolId,
      ]
    );

    const allowed = canStudentSubmit(
      assessment,
      submission
    );

    return res.json({
      item: {
        id: assessment.id,
        title: assessment.title,
        type: assessment.type,
        mode: assessment.mode,
        status: assessment.status,
        description: assessment.description,
        max_score: assessment.max_score,
        starts_at: assessment.starts_at,
        due_at: assessment.due_at,
        subject_name: assessment.subject_name,
        teacher_name: assessment.teacher_name,
        attachments: assessmentAttachmentsQ.rows,
        submission,
        score: grade ? grade.score : null,
        feedback: grade ? grade.feedback : null,
        is_published: grade ? grade.is_published : false,

        student_status: buildStudentStatus({
          status: assessment.status,
          submission_id: submission?.id || null,
          score: grade ? grade.score : null,
          is_published: grade ? grade.is_published : false,
        }),

        can_submit: allowed.allowed,
        submit_block_reason: allowed.reason,
      },
    });
  } catch (e) {
    console.error("getStudentActivityDetail error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

// ✅ رفع حل النشاط من الطالب
export async function submitStudentActivity(req, res) {
  let client = null;
  let transactionStarted = false;
  let keepUploadedFile = false;

  try {
    const userId = pickUserId(req);
    const schoolId = pickSchoolId(req);

    if (!userId || !schoolId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const studentCtx = await getStudentContext(
      userId,
      schoolId
    );

    if (!studentCtx?.student_id || !studentCtx.section_id) {
      return res.status(403).json({
        message: "لم يتم العثور على تسجيل دراسي فعّال للطالب.",
      });
    }

    const assessmentId = parseRequiredPositiveInteger(
      req.params.id,
      "id"
    );

    const text = String(req.body?.text || "").trim();
    const file = req.file || null;

    if (!text && !file) {
      throw badRequest(
        "أدخل نصًا أو ارفع ملفًا واحدًا على الأقل."
      );
    }

    if (file && !file.filename) {
      throw badRequest(
        "تعذر حفظ الملف المرفق."
      );
    }

    const assessment = await getAccessibleAssessment(
      studentCtx,
      assessmentId,
      schoolId
    );

    if (!assessment) {
      throw notFound("النشاط غير موجود.");
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const existingQ = await client.query(
      `
      SELECT id
      FROM submissions
      WHERE assessment_id = $1
        AND student_id = $2
        AND school_id = $3
      LIMIT 1
      `,
      [
        assessmentId,
        studentCtx.student_id,
        schoolId,
      ]
    );

    const existing = existingQ.rows[0] || null;

    const allowed = canStudentSubmit(
      assessment,
      existing
    );

    if (!allowed.allowed) {
      throw badRequest(
        allowed.reason || "التسليم غير متاح."
      );
    }

    const insertSubmissionQ = await client.query(
      `
      INSERT INTO submissions
        (
          assessment_id,
          student_id,
          status,
          note,
          submitted_at,
          created_at,
          updated_at,
          school_id
        )
      VALUES
        (
          $1,
          $2,
          'submitted',
          $3,
          NOW(),
          NOW(),
          NOW(),
          $4
        )
      ON CONFLICT ON CONSTRAINT uq_submission
      DO NOTHING
      RETURNING
        id,
        submitted_at
      `,
      [
        assessmentId,
        studentCtx.student_id,
        text || null,
        schoolId,
      ]
    );

    const submission =
      insertSubmissionQ.rows[0] || null;

    if (!submission) {
      throw badRequest(
        "تم إرسال الحل مسبقًا، ويسمح النظام بتسليم واحد فقط."
      );
    }

    if (file) {
      const fileUrl =
        `/uploads/submissions/${file.filename}`;

      await client.query(
        `
        INSERT INTO submission_attachments
          (
            submission_id,
            file_url,
            file_name,
            file_type,
            file_size,
            created_at,
            school_id
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            NOW(),
            $6
          )
        `,
        [
          submission.id,
          fileUrl,
          file.originalname || file.filename,
          file.mimetype || null,
          file.size || null,
          schoolId,
        ]
      );
    }

    await client.query("COMMIT");

    transactionStarted = false;
    keepUploadedFile = true;

    return res.status(201).json({
      id: submission.id,
      submitted_at: submission.submitted_at,
    });
  } catch (e) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "submitStudentActivity rollback error:",
          rollbackError
        );
      }
    }

    console.error(
      "submitStudentActivity error:",
      e
    );

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    if (!keepUploadedFile) {
      await removeUploadedFile(req.file);
    }

    if (client) {
      client.release();
    }
  }
}

function gradeWord(percent) {
  if (
    percent === null ||
    percent === undefined ||
    percent === ""
  ) {
    return null;
  }

  const value = Number(percent);

  if (!Number.isFinite(value)) {
    return null;
  }

  if (value >= 90) return "ممتاز";
  if (value >= 80) return "جيد جدًا";
  if (value >= 70) return "جيد";
  if (value >= 60) return "مقبول";

  return "ضعيف";
}

// ✅ تحديد تصنيف الدرجة
function detectGradeKind(row) {
  const type =
    String(row.type || "").toLowerCase();

  const examKind =
    String(row.exam_kind || "").toLowerCase();

  const aggregateKind =
    String(row.aggregate_kind || "").toLowerCase();

  const title =
    `${row.assessment_title || ""} ${row.title_short || ""}`
      .toLowerCase();

  // الاختبارات الشهرية أولًا
  if (
    type.includes("monthly") ||
    examKind.includes("monthly") ||
    title.includes("شهري") ||
    title.includes("monthly")
  ) {
    return "monthly";
  }

  // المحصلة الفصلية
  if (
    type === "aggregate" ||
    type.includes("aggregate") ||
    type.includes("muhassala") ||
    aggregateKind ||
    title.includes("محصلة")
  ) {
    return "term_work";
  }

  // الاختبارات
  if (
    type.includes("exam") ||
    type.includes("quiz") ||
    examKind ||
    title.includes("اختبار") ||
    title.includes("امتحان")
  ) {
    return "exams";
  }

  // الأنشطة والتكليفات
  if (
    type.includes("activity") ||
    type.includes("classwork") ||
    type.includes("homework") ||
    type.includes("assignment") ||
    type.includes("task") ||
    type.includes("participation") ||
    type.includes("project") ||
    type.includes("oral") ||
    title.includes("نشاط") ||
    title.includes("نشاط صفي") ||
    title.includes("واجب") ||
    title.includes("تكليف") ||
    title.includes("مشروع") ||
    title.includes("شفهي")
  ) {
    return "activities";
  }

  return "other";
}

function gradeKindLabel(kind) {
  const map = {
    monthly: "اختبار شهري",
    exams: "اختبار",
    activities: "نشاط / تكليف",
    term_work: "عمل فصلي / محصلة",
    other: "تقييم",
  };

  return map[kind] || "تقييم";
}

function isAllowedGradeKind(kind, requestedType) {
  if (!requestedType || requestedType === "all") {
    return true;
  }

  if (requestedType === "monthly") {
    return kind === "monthly";
  }

  if (requestedType === "exams") {
    return kind === "exams" || kind === "monthly";
  }

  if (requestedType === "activities") {
    return kind === "activities";
  }

  if (requestedType === "term_work") {
    return kind === "term_work";
  }

  return true;
}

// ✅ عرض درجات الطالب مع حماية school_id والشعبة الحالية
export async function listStudentGrades(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = pickSchoolId(req);

    if (!userId || !schoolId) {
      return res.status(401).json({
        message: "غير مصرح.",
      });
    }

    const studentCtx = await getStudentContext(
      userId,
      schoolId
    );

    if (!studentCtx?.student_id || !studentCtx.section_id) {
      return res.status(403).json({
        message: "لم يتم العثور على تسجيل دراسي فعّال للطالب.",
      });
    }

    const requestedType =
      String(req.query.type || "all").trim();

    const subjectId = parseOptionalPositiveInteger(
      req.query.subject_id,
      "subject_id"
    );

    const q = String(req.query.q || "").trim();

    const params = [
      studentCtx.student_id,
      studentCtx.academic_year_id,
      studentCtx.term,
      schoolId,
      studentCtx.section_id,
      studentCtx.grade_id,
    ];

    const where = [
      `ag.student_id = $1`,
      `COALESCE(ag.is_published, false) = true`,
      `ta.academic_year_id = $2`,
      `ta.term = $3`,
      `ag.school_id = $4`,
      `a.school_id = $4`,
      `ta.school_id = $4`,
      `(ta.section_id = $5 OR (ta.section_id IS NULL AND ta.grade_id = $6))`,
      `(a.status IN ('published', 'active', 'closed') OR a.published_at IS NOT NULL)`,
    ];

    let idx = 7;

    if (subjectId) {
      params.push(subjectId);
      where.push(`ta.subject_id = $${idx++}`);
    }

    if (q) {
      params.push(`%${q}%`);

      where.push(
        `(a.title ILIKE $${idx} OR COALESCE(subj.name, '') ILIKE $${idx})`
      );

      idx += 1;
    }

    const { rows } = await pool.query(
      `
      SELECT
        ag.id AS grade_id,
        ag.status,
        ag.score,
        ag.feedback,
        ag.graded_at,
        ag.published_at,
        ag.is_published,

        a.id AS assessment_id,
        a.title AS assessment_title,
        a.title_short,
        a.type,
        a.exam_kind,
        a.aggregate_kind,
        a.max_score,
        a.status AS assessment_status,
        a.published_at AS assessment_published_at,
        a.created_at AS assessment_created_at,

        ta.subject_id,
        ta.academic_year_id,
        ay.name AS academic_year_name,
        ta.term,
        ta.stage_id,
        ta.grade_id,
        ta.section_id,

        subj.name AS subject_name,
        t.full_name AS teacher_name,

        CASE
          WHEN a.max_score > 0
            AND ag.score IS NOT NULL
          THEN ROUND(
            (ag.score::numeric / a.max_score::numeric) * 100,
            2
          )
          ELSE NULL
        END AS percentage

      FROM assessment_grades ag

      JOIN assessments a
        ON a.id = ag.assessment_id
       AND a.school_id = ag.school_id

      JOIN teacher_assignments ta
        ON ta.id = a.teacher_assignment_id
       AND ta.school_id = a.school_id

      LEFT JOIN academic_years ay
        ON ay.id = ta.academic_year_id
       AND ay.school_id = ag.school_id

      LEFT JOIN subjects subj
        ON subj.id = ta.subject_id
       AND subj.school_id = ag.school_id

      LEFT JOIN teachers t
        ON t.id = ta.teacher_id
       AND t.school_id = ag.school_id

      WHERE ${where.join(" AND ")}

      ORDER BY
        COALESCE(
          ag.published_at,
          ag.graded_at,
          a.published_at,
          a.created_at
        ) DESC,
        subj.name ASC NULLS LAST,
        a.id DESC
      `,
      params
    );

    let items = rows.map((row) => {
      const kind = detectGradeKind(row);

      return {
        ...row,
        kind,
        kind_label: gradeKindLabel(kind),

        status_label:
          row.status === "graded"
            ? "تم نشر الدرجة"
            : row.status === "absent"
            ? "غائب"
            : row.status === "excused"
            ? "معذور"
            : "تمت المعالجة",

        grade_word: gradeWord(row.percentage),
      };
    });

    items = items.filter((item) =>
      isAllowedGradeKind(
        item.kind,
        requestedType
      )
    );

    const gradedItems = items.filter(
      (item) => item.status === "graded"
    );

    const percentages = gradedItems
      .filter(
        (item) =>
          item.percentage !== null &&
          item.percentage !== undefined
      )
      .map((item) => Number(item.percentage))
      .filter((value) => Number.isFinite(value));

    const average =
      percentages.length > 0
        ? percentages.reduce(
            (sum, value) => sum + value,
            0
          ) / percentages.length
        : null;

    return res.json({
      items,

      summary: {
        total_count: items.length,

        graded_count:
          gradedItems.length,

        absent_count:
          items.filter(
            (item) => item.status === "absent"
          ).length,

        excused_count:
          items.filter(
            (item) => item.status === "excused"
          ).length,

        average_percentage:
          average,

        average_grade_word:
          gradeWord(average),
      },
    });
  } catch (e) {
    console.error("listStudentGrades error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}