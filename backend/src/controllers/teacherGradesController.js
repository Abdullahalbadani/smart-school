// src/controllers/teacherGradesController.js
import { pool } from "../config/db.js";

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

// ✅ إضافة schoolId لحماية جلب المعلم
async function getTeacherIdByUserId(userId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT id
    FROM teachers
    WHERE user_id = $1 AND school_id = $2
      AND COALESCE(is_active, true) = true
    LIMIT 1
    `,
    [userId, schoolId]
  );
  return rows[0]?.id ?? null;
}

// ✅ إضافة schoolId لحماية التكليف
async function assertOwnAssignment(teacherId, teacherAssignmentId, schoolId, db = pool) {
  const { rows } = await db.query(
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
    WHERE ta.id = $1
      AND ta.teacher_id = $2
      AND t.school_id = $3
      AND COALESCE(t.is_active, true) = true
    LIMIT 1
    `,
    [teacherAssignmentId, teacherId, schoolId]
  );

  if (!rows.length) {
    throw forbidden("نطاق التدريس غير صحيح أو لا يتبع لمدرستك.");
  }

  return rows[0];
}

// ✅ إضافة schoolId لحماية التقييم
async function getOwnedAssessment(teacherId, assessmentId, schoolId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT
      a.*,
      ta.teacher_id,
      ta.academic_year_id,
      ta.term,
      ta.stage_id,
      ta.grade_id,
      ta.section_id,
      ta.subject_id
    FROM assessments a
    JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    WHERE a.id = $1
      AND ta.teacher_id = $2
      AND a.school_id = $3
    LIMIT 1
    `,
    [assessmentId, teacherId, schoolId]
  );

  return rows[0] ?? null;
}

async function getGradesPublishState(assessmentId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE COALESCE(is_published, false) = true)::int AS published_rows
    FROM assessment_grades
    WHERE assessment_id = $1
    `,
    [assessmentId]
  );

  const totalRows = Number(rows[0]?.total_rows || 0);
  const publishedRows = Number(rows[0]?.published_rows || 0);

  return {
    totalRows,
    publishedRows,
    allPublished: totalRows > 0 && publishedRows === totalRows,
    anyPublished: publishedRows > 0,
  };
}

function toLegacyAssessmentType(assessment) {
  if (!assessment) return null;

  if (assessment.type === "exam") {
    if (assessment.exam_kind === "monthly") return "monthly_exam";
    if (assessment.exam_kind === "midterm") return "midterm_exam";
    if (assessment.exam_kind === "final") return "final_exam";
  }

  if (assessment.type === "aggregate") {
    if (assessment.aggregate_kind === "midterm") return "midterm_muhassala";
    if (assessment.aggregate_kind === "final") return "final_muhassala";
  }

  return assessment.type;
}

function normalizeAggregateKind(input) {
  const value = String(input || "").trim();

  if (value === "midterm" || value === "midterm_muhassala") return "midterm";
  if (value === "final" || value === "final_muhassala") return "final";

  return null;
}
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getSchoolGradingSettings(schoolId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT
      midterm_muhassala_max_grade,
      final_muhassala_max_grade,
      midterm_exam_max_grade,
      final_exam_max_grade,
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
function deriveEntryAssessmentStatus(assessment, students) {
  if (!assessment) return "draft";
  if (assessment.status === "closed") return "closed";

  const total = students.length;
  const publishedGrades = students.filter((s) => !!s.is_published).length;

  if (total > 0 && publishedGrades === total) return "published";
  if (assessment.status === "draft") return "draft";
  return "active";
}

// ✅ إضافة schoolId لحماية جلب الطلاب
async function loadStudentsForAssessment(assessment, schoolId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT
      se.student_id,
      s.full_name,
      s.student_code,
      se.roll_number,

      ag.id AS grade_id,
      ag.status,
      ag.score,
      ag.feedback,
      ag.is_published,
      ag.published_at,

      sub.id AS submission_id,
      sub.status AS submission_status,
      sub.note AS submitted_text,
      sub.submitted_at,

      sa.file_url,
      sa.file_name,
      sa.file_type,
      sa.file_size,

      CASE
        WHEN a.due_at IS NOT NULL
         AND sub.submitted_at IS NOT NULL
         AND sub.submitted_at > a.due_at
        THEN true
        ELSE false
      END AS is_late

    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    JOIN assessments a ON a.id = $1
    LEFT JOIN assessment_grades ag
      ON ag.assessment_id = a.id
     AND ag.student_id = se.student_id
    LEFT JOIN LATERAL (
      SELECT sub1.*
      FROM submissions sub1
      WHERE sub1.assessment_id = a.id
        AND sub1.student_id = se.student_id
      ORDER BY COALESCE(sub1.submitted_at, sub1.created_at) DESC, sub1.id DESC
      LIMIT 1
    ) sub ON true
    LEFT JOIN LATERAL (
      SELECT sa1.*
      FROM submission_attachments sa1
      WHERE sa1.submission_id = sub.id
      ORDER BY sa1.id ASC
      LIMIT 1
    ) sa ON true

    WHERE se.academic_year_id = $2
      AND se.term = $3
      AND (se.section_id = $4 OR ($4 IS NULL AND se.grade_id = $5))
      AND COALESCE(se.status, 'enrolled') = 'enrolled'
      AND se.school_id = $6
      AND s.school_id = $6

    ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
    `,
    [
      assessment.id,
      assessment.academic_year_id,
      assessment.term,
      assessment.section_id,
      assessment.grade_id,
      schoolId,
    ]
  );

  return rows;
}

// ✅ إضافة schoolId لضمان دقة معرفات الطلاب
async function loadEligibleStudentIdsForAssessment(assessment, schoolId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT se.student_id
    FROM student_enrollments se
    WHERE se.academic_year_id = $1
      AND se.term = $2
      AND (se.section_id = $3 OR ($3 IS NULL AND se.grade_id = $4))
      AND COALESCE(se.status, 'enrolled') = 'enrolled'
      AND se.school_id = $5
    `,
    [
      assessment.academic_year_id,
      assessment.term,
      assessment.section_id,
      assessment.grade_id,
      schoolId,
    ]
  );

  return new Set(rows.map((r) => Number(r.student_id)));
}

async function getActiveGradePolicyForAssignment(teacherAssignmentId, schoolId, db = pool) {
  const { rows } = await db.query(
    `
    SELECT gp.*
    FROM teacher_assignments ta
    JOIN teachers t ON t.id = ta.teacher_id
    JOIN grade_policies gp
      ON gp.academic_year_id = ta.academic_year_id
     AND gp.term = ta.term
     AND gp.subject_id = ta.subject_id
     AND (gp.stage_id IS NULL OR gp.stage_id = ta.stage_id)
     AND (gp.grade_id IS NULL OR gp.grade_id = ta.grade_id)
     AND COALESCE(gp.is_active, true) = true
     AND gp.school_id = $2
    WHERE ta.id = $1
      AND t.school_id = $2
      AND COALESCE(t.is_active, true) = true
    ORDER BY
      CASE WHEN gp.grade_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN gp.stage_id IS NOT NULL THEN 0 ELSE 1 END,
      gp.id DESC
    LIMIT 1
    `,
    [teacherAssignmentId, schoolId]
  );

  return rows[0] ?? null;
}
function getAggregateMaxScore(settings, aggregateKind) {
  if (aggregateKind === "midterm") {
    const score = positiveNumber(settings?.midterm_muhassala_max_grade);
    if (!score) throw badRequest("يجب ضبط درجة محصلة النصفي من إعدادات المدرسة.");
    return score;
  }

  if (aggregateKind === "final") {
    const score = positiveNumber(settings?.final_muhassala_max_grade);
    if (!score) throw badRequest("يجب ضبط درجة محصلة النهائي من إعدادات المدرسة.");
    return score;
  }

  throw badRequest("نوع المحصلة غير صحيح.");
}

// ✅ إضافة schoolId لمنع التداخل بين محصلات المدارس
async function findExistingAggregateAssessment(teacherAssignmentId, aggregateKind, schoolId, db = pool) {
  const legacyType = aggregateKind === "midterm" ? "midterm_muhassala" : "final_muhassala";

  const { rows } = await db.query(
    `
    SELECT *
    FROM assessments
    WHERE teacher_assignment_id = $1
      AND school_id = $2
      AND (
        (type = 'aggregate' AND aggregate_kind = $3)
        OR type = $4
      )
    ORDER BY id DESC
    LIMIT 1
    `,
    [teacherAssignmentId, schoolId, aggregateKind, legacyType]
  );

  return rows[0] ?? null;
}

export async function getGradeEntry(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const assessmentId = Number(req.query.assessment_id);
    if (!assessmentId) {
      throw badRequest("assessment_id مطلوب.");
    }

    const assessment = await getOwnedAssessment(teacherId, assessmentId, schoolId);
    if (!assessment) {
      throw forbidden("التقييم غير موجود أو لا يتبع لمدرستك.");
    }

    const students = await loadStudentsForAssessment(assessment, schoolId);
    const derivedStatus = deriveEntryAssessmentStatus(assessment, students);

    return res.json({
      assessment: {
        id: assessment.id,
        teacher_assignment_id: assessment.teacher_assignment_id,

        // توافق مؤقت مع الواجهة القديمة
        type: toLegacyAssessmentType(assessment),

        // الحقول الجديدة
        canonical_type: assessment.type,
        exam_kind: assessment.exam_kind,
        aggregate_kind: assessment.aggregate_kind,
        sequence_no: assessment.sequence_no,
        is_system_generated: assessment.is_system_generated,

        mode: assessment.mode,
        status: derivedStatus,
        title: assessment.title,
        title_short: assessment.title_short,
        description: assessment.description,
        max_score: assessment.max_score,
        starts_at: assessment.starts_at,
        due_at: assessment.due_at,
        duration_minutes: assessment.duration_minutes,
        published_at: assessment.published_at,
        closed_at: assessment.closed_at,
      },
      students,
    });
  } catch (e) {
    console.error("getGradeEntry error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function saveGradeEntry(req, res) {
  const client = await pool.connect();
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const assessmentId = Number(req.body?.assessment_id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!assessmentId) {
      throw badRequest("assessment_id مطلوب.");
    }
    if (!items.length) {
      throw badRequest("لا توجد بيانات درجات للحفظ.");
    }

    const assessment = await getOwnedAssessment(teacherId, assessmentId, schoolId, client);
    if (!assessment) {
      throw forbidden("التقييم غير موجود أو لا يتبع لمدرستك.");
    }

    if (assessment.status === "closed") {
      throw badRequest("لا يمكن تعديل درجات تقييم مغلق.");
    }

    const validStudentIds = await loadEligibleStudentIdsForAssessment(assessment, schoolId, client);

    await client.query("BEGIN");

    const gradeState = await getGradesPublishState(assessmentId, client);
    if (gradeState.anyPublished) {
      throw badRequest("لا يمكن تعديل درجات تم نشرها. اطلب إعادة فتح النشاط أولاً.");
    }

    for (const item of items) {
      const studentId = Number(item.student_id);
      const status = String(item.status || "missing").trim();
      const feedback = item.feedback ?? null;
      const score =
        item.score === null || item.score === undefined || item.score === ""
          ? null
          : Number(item.score);

      if (!studentId) {
        throw badRequest("يوجد student_id غير صحيح.");
      }

      if (!validStudentIds.has(studentId)) {
        throw badRequest(`الطالب ${studentId} ليس ضمن نطاق هذا التقييم.`);
      }

      if (!["graded", "missing", "excused", "absent"].includes(status)) {
        throw badRequest("يوجد status غير صحيح.");
      }

      if (status === "graded") {
        if (!Number.isFinite(score)) {
          throw badRequest("يوجد طالب تم تقييمه بدون درجة.");
        }
        if (score < 0 || score > Number(assessment.max_score)) {
          throw badRequest("يوجد درجة خارج المدى المسموح.");
        }
      }

      const prevQ = await client.query(
        `
        SELECT id, status, score
        FROM assessment_grades
        WHERE assessment_id = $1
          AND student_id = $2
        LIMIT 1
        `,
        [assessmentId, studentId]
      );

      if (prevQ.rows.length) {
        const prev = prevQ.rows[0];

        // ✅ إضافة school_id للتحديث
        await client.query(
          `
          UPDATE assessment_grades
          SET status = $1,
              score = $2,
              feedback = $3,
              graded_by = $4,
              graded_at = NOW(),
              updated_at = NOW()
          WHERE id = $5 AND school_id = $6
          `,
          [status, status === "graded" ? score : null, feedback, userId, prev.id, schoolId]
        );

        if (
          prev.status !== status ||
          Number(prev.score ?? -1) !== Number((status === "graded" ? score : null) ?? -1)
        ) {
          // ✅ إدخال school_id
          await client.query(
            `
            INSERT INTO grade_change_logs
              (school_id, grade_id, changed_by, old_status, new_status, old_score, new_score, reason, changed_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `,
            [
              schoolId,
              prev.id,
              userId,
              prev.status,
              status,
              prev.score,
              status === "graded" ? score : null,
              "حفظ مسودة / تعديل من المعلم",
            ]
          );
        }
      } else {
        // ✅ إدخال school_id
        const insertQ = await client.query(
          `
          INSERT INTO assessment_grades
            (school_id, assessment_id, student_id, status, score, feedback, graded_by, graded_at, is_published, created_at, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, NOW(), false, NOW(), NOW())
          RETURNING id
          `,
          [schoolId, assessmentId, studentId, status, status === "graded" ? score : null, feedback, userId]
        );

        await client.query(
          `
          INSERT INTO grade_change_logs
            (school_id, grade_id, changed_by, old_status, new_status, old_score, new_score, reason, changed_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `,
          [
            schoolId,
            insertQ.rows[0].id,
            userId,
            null,
            status,
            null,
            status === "graded" ? score : null,
            "إنشاء درجة جديدة",
          ]
        );
      }
    }

    if (assessment.status === "draft") {
      await client.query(
        `
        UPDATE assessments
        SET status = 'active',
            updated_at = NOW()
        WHERE id = $1 AND school_id = $2
        `,
        [assessmentId, schoolId]
      );
    }

    await client.query("COMMIT");
    return res.status(204).send();
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("saveGradeEntry error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    client.release();
  }
}
async function resetReturnedMonthlyWorkToPending(assessmentId, schoolId, db = pool) {
  await db.query(
    `
    UPDATE monthly_work_approvals
    SET
      status = 'pending',
      returned_by = NULL,
      returned_at = NULL,
      return_note = NULL,
      updated_at = NOW()
    WHERE school_id = $1
      AND assessment_id = $2
      AND status = 'returned'
    `,
    [schoolId, assessmentId]
  );
}
export async function publishGradeEntry(req, res) {
  const client = await pool.connect();

  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);

    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const assessmentId = Number(req.body?.assessment_id);

    if (!assessmentId) {
      throw badRequest("assessment_id مطلوب.");
    }

    const assessment = await getOwnedAssessment(
      teacherId,
      assessmentId,
      schoolId,
      client
    );

    if (!assessment) {
      throw forbidden("التقييم غير موجود أو لا يتبع لمدرستك.");
    }

    if (assessment.status === "closed") {
      throw badRequest("لا يمكن نشر درجات تقييم مغلق.");
    }

    await client.query("BEGIN");

    const gradeState = await getGradesPublishState(assessmentId, client);

    if (gradeState.anyPublished) {
      throw badRequest("تم نشر درجات هذا التقييم بالفعل.");
    }

    await client.query(
      `
      INSERT INTO assessment_grades
        (school_id, assessment_id, student_id, status, score, feedback, graded_by, graded_at, is_published, published_at, created_at, updated_at)
      SELECT
        $1,
        $2,
        se.student_id,
        'missing',
        NULL,
        NULL,
        $3,
        NOW(),
        true,
        NOW(),
        NOW(),
        NOW()
      FROM student_enrollments se
      WHERE se.academic_year_id = $4
        AND se.term = $5
        AND (se.section_id = $6 OR ($6 IS NULL AND se.grade_id = $7))
        AND COALESCE(se.status, 'enrolled') = 'enrolled'
        AND se.school_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM assessment_grades ag
          WHERE ag.assessment_id = $2
            AND ag.student_id = se.student_id
        )
      `,
      [
        schoolId,
        assessmentId,
        userId,
        assessment.academic_year_id,
        assessment.term,
        assessment.section_id,
        assessment.grade_id,
      ]
    );

    await client.query(
      `
      UPDATE assessment_grades
      SET
        is_published = true,
        published_at = COALESCE(published_at, NOW()),
        updated_at = NOW()
      WHERE assessment_id = $1
        AND school_id = $2
      `,
      [assessmentId, schoolId]
    );

    await client.query(
      `
      UPDATE assessments
      SET
        status = 'published',
        published_at = COALESCE(published_at, NOW()),
        updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      `,
      [assessmentId, schoolId]
    );

    await resetReturnedMonthlyWorkToPending(assessmentId, schoolId, client);

    await client.query("COMMIT");

    return res.status(204).send();
  } catch (e) {
    await client.query("ROLLBACK");

    console.error("publishGradeEntry error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    client.release();
  }
}

export async function listReopenRequests(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const teacherAssignmentId = Number(req.query.teacher_assignment_id);
    if (!teacherAssignmentId) {
      throw badRequest("teacher_assignment_id مطلوب.");
    }

    await assertOwnAssignment(teacherId, teacherAssignmentId, schoolId);

    const { rows } = await pool.query(
      `
      SELECT
        arr.id,
        arr.assessment_id,
        arr.reason,
        arr.status,
        arr.admin_note,
        arr.created_at,
        arr.decided_at,
        a.title AS assessment_title
      FROM assessment_reopen_requests arr
      JOIN assessments a ON a.id = arr.assessment_id
      WHERE a.teacher_assignment_id = $1 AND a.school_id = $2
      ORDER BY arr.created_at DESC
      `,
      [teacherAssignmentId, schoolId]
    );

    return res.json({ items: rows });
  } catch (e) {
    console.error("listReopenRequests error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function createReopenRequest(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const assessmentId = Number(req.body?.assessment_id);
    const reason = String(req.body?.reason || "").trim();

    if (!assessmentId) {
      throw badRequest("assessment_id مطلوب.");
    }
    if (!reason) {
      throw badRequest("سبب الطلب مطلوب.");
    }

    const assessment = await getOwnedAssessment(teacherId, assessmentId, schoolId);
    if (!assessment) {
      throw forbidden("التقييم غير موجود أو لا يتبع لمدرستك.");
    }

    const gradeState = await getGradesPublishState(assessmentId);

    if (!(assessment.status === "closed" || gradeState.anyPublished)) {
      throw badRequest("يمكن طلب إعادة الفتح فقط بعد نشر الدرجات أو بعد إغلاق التقييم.");
    }

    const existsQ = await pool.query(
      `
      SELECT id
      FROM assessment_reopen_requests
      WHERE assessment_id = $1
        AND status = 'pending'
      LIMIT 1
      `,
      [assessmentId]
    );

    if (existsQ.rows.length) {
      throw badRequest("يوجد طلب إعادة فتح معلق لهذا التقييم بالفعل.");
    }

    // ✅ إضافة school_id
    const { rows } = await pool.query(
      `
      INSERT INTO assessment_reopen_requests
        (school_id, assessment_id, requested_by_user_id, reason, status, created_at)
      VALUES
        ($1, $2, $3, $4, 'pending', NOW())
      RETURNING id, created_at
      `,
      [schoolId, assessmentId, userId, reason]
    );

    return res.status(201).json({
      id: rows[0].id,
      created_at: rows[0].created_at,
    });
  } catch (e) {
    console.error("createReopenRequest error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}
async function assertTermWorkNotApproved(assignment, schoolId, term, db = pool) {
  const { rows } = await db.query(
    `
    SELECT status
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
      assignment.academic_year_id,
      term,
      assignment.stage_id,
      assignment.grade_id,
      assignment.section_id,
      assignment.subject_id,
      assignment.id,
    ]
  );

  if (rows[0]?.status === "approved") {
    throw badRequest("لا يمكن تعديل المحصلة لأن أعمال هذا الفصل معتمدة من الكنترول.");
  }
}
export async function submitMuhassala(req, res) {
  const client = await pool.connect();
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) {
      return res.status(403).json({ message: "حساب المعلم غير موجود." });
    }

    const teacherAssignmentId = Number(req.body?.teacher_assignment_id);
    const term = Number(req.body?.term);
    const aggregateKind = normalizeAggregateKind(req.body?.type);
    const grades = Array.isArray(req.body?.grades) ? req.body.grades : [];

    if (!teacherAssignmentId || !term || !aggregateKind) {
      throw badRequest("النطاق والفصل ونوع المحصلة مطلوبان.");
    }

    if (!grades.length) {
      throw badRequest("لا توجد درجات للاعتماد.");
    }

    const assignment = await assertOwnAssignment(teacherId, teacherAssignmentId, schoolId, client);
await assertTermWorkNotApproved(assignment, schoolId, term, client);
    if (Number(assignment.term) !== term) {
      throw badRequest("الفصل المرسل لا يطابق فصل نطاق التدريس.");
    }

    const gradingSettings = await getSchoolGradingSettings(schoolId, client);
const maxScore = getAggregateMaxScore(gradingSettings, aggregateKind);
    const allowedStudentIds = new Set(
      (
        await client.query(
          `
          SELECT se.student_id
          FROM student_enrollments se
          WHERE se.academic_year_id = $1
            AND se.term = $2
            AND (se.section_id = $3 OR ($3 IS NULL AND se.grade_id = $4))
            AND COALESCE(se.status, 'enrolled') = 'enrolled'
            AND se.school_id = $5
          `,
          [
            assignment.academic_year_id,
            assignment.term,
            assignment.section_id,
            assignment.grade_id,
            schoolId
          ]
        )
      ).rows.map((r) => Number(r.student_id))
    );
const submittedStudentIds = new Set();

for (const g of grades) {
  const studentId = Number(g.student_id);
  const score = Number(g.score);

  if (!studentId || !Number.isFinite(score)) {
    throw badRequest("يوجد student_id أو score غير صحيح.");
  }

  if (submittedStudentIds.has(studentId)) {
    throw badRequest("يوجد طالب مكرر في بيانات المحصلة.");
  }

  if (!allowedStudentIds.has(studentId)) {
    throw badRequest(`الطالب ${studentId} ليس ضمن نطاق هذه المحصلة.`);
  }

  if (score < 0 || score > maxScore) {
    throw badRequest(`يجب أن تكون درجة المحصلة بين 0 و ${maxScore}.`);
  }

  submittedStudentIds.add(studentId);
}

if (submittedStudentIds.size !== allowedStudentIds.size) {
  throw badRequest("يجب إدخال درجة المحصلة لجميع الطلاب قبل الاعتماد.");
}
    await client.query("BEGIN");

    let assessment = await findExistingAggregateAssessment(
      teacherAssignmentId,
      aggregateKind,
      schoolId,
      client
    );

    if (!assessment) {
      const title = aggregateKind === "midterm" ? "محصلة النصفي" : "محصلة النهائي";

      const insertAssm = await client.query(
        `
        INSERT INTO assessments (
          school_id,
          teacher_assignment_id,
          type,
          aggregate_kind,
          mode,
          status,
          title,
          title_short,
          max_score,
          is_system_generated,
          created_at,
          updated_at,
          published_at
        )
        VALUES (
          $1, $2, 'aggregate', $3, 'in_class', 'published', $4, $5, $6, true, NOW(), NOW(), NOW()
        )
        RETURNING *
        `,
        [
          schoolId,
          teacherAssignmentId,
          aggregateKind,
          title,
          aggregateKind === "midterm" ? "محصلة النصفي" : "محصلة النهائي",
          maxScore,
        ]
      );

      assessment = insertAssm.rows[0];
    } else {
      const title = aggregateKind === "midterm" ? "محصلة النصفي" : "محصلة النهائي";

      const updateQ = await client.query(
        `
        UPDATE assessments
        SET type = 'aggregate',
            aggregate_kind = $2,
            is_system_generated = true,
            mode = COALESCE(mode, 'in_class'),
            status = 'published',
            title = COALESCE(title, $3),
            title_short = COALESCE(title_short, $4),
            max_score = $5,
            published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
        WHERE id = $1 AND school_id = $6
        RETURNING *
        `,
        [
          assessment.id,
          aggregateKind,
          title,
          aggregateKind === "midterm" ? "محصلة النصفي" : "محصلة النهائي",
          maxScore,
          schoolId
        ]
      );

      assessment = updateQ.rows[0];
    }

    for (const g of grades) {
      const studentId = Number(g.student_id);
      const score = Number(g.score);

      if (!studentId || !Number.isFinite(score)) {
        throw badRequest("يوجد student_id أو score غير صحيح.");
      }

      if (!allowedStudentIds.has(studentId)) {
        throw badRequest(`الطالب ${studentId} ليس ضمن نطاق هذه المحصلة.`);
      }

      if (score < 0 || score > maxScore) {
        throw badRequest(`يجب أن تكون درجة المحصلة بين 0 و ${maxScore}.`);
      }

      const prevQ = await client.query(
        `
        SELECT id, status, score
        FROM assessment_grades
        WHERE assessment_id = $1
          AND student_id = $2
        LIMIT 1
        `,
        [assessment.id, studentId]
      );

      if (prevQ.rows.length > 0) {
        const prev = prevQ.rows[0];

        await client.query(
          `
          UPDATE assessment_grades
          SET status = 'graded',
              score = $1,
              is_published = true,
              published_at = COALESCE(published_at, NOW()),
              graded_by = $2,
              graded_at = NOW(),
              updated_at = NOW()
          WHERE id = $3 AND school_id = $4
          `,
          [score, userId, prev.id, schoolId]
        );

        if (Number(prev.score ?? -1) !== Number(score ?? -1) || prev.status !== "graded") {
          await client.query(
            `
            INSERT INTO grade_change_logs
              (school_id, grade_id, changed_by, old_status, new_status, old_score, new_score, reason, changed_at)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `,
            [
              schoolId,
              prev.id,
              userId,
              prev.status,
              "graded",
              prev.score,
              score,
              aggregateKind === "midterm"
                ? "اعتماد محصلة النصفي"
                : "اعتماد محصلة النهائي",
            ]
          );
        }
      } else {
        const insertGrade = await client.query(
          `
          INSERT INTO assessment_grades
            (school_id, assessment_id, student_id, status, score, is_published, published_at, graded_by, graded_at, created_at, updated_at)
          VALUES
            ($1, $2, $3, 'graded', $4, true, NOW(), $5, NOW(), NOW(), NOW())
          RETURNING id
          `,
          [schoolId, assessment.id, studentId, score, userId]
        );

        await client.query(
          `
          INSERT INTO grade_change_logs
            (school_id, grade_id, changed_by, old_status, new_status, old_score, new_score, reason, changed_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          `,
          [
            schoolId,
            insertGrade.rows[0].id,
            userId,
            null,
            "graded",
            null,
            score,
            aggregateKind === "midterm"
              ? "إنشاء محصلة النصفي"
              : "إنشاء محصلة النهائي",
          ]
        );
      }
    }

    await client.query("COMMIT");
    return res.status(200).json({
      message: "تم اعتماد المحصلة بنجاح.",
      assessment_id: assessment.id,
      aggregate_kind: aggregateKind,
      max_score: maxScore,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("submitMuhassala error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    client.release();
  }
}
export async function getTermWorkControlStatus(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherAssignmentId = Number(req.query.teacher_assignment_id);
    const term = Number(req.query.term);

    if (!Number.isInteger(teacherAssignmentId) || teacherAssignmentId <= 0) {
      throw badRequest("teacher_assignment_id مطلوب.");
    }

    if (![1, 2].includes(term)) {
      throw badRequest("الفصل الدراسي غير صحيح.");
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    const assignment = await assertOwnAssignment(
      teacherId,
      teacherAssignmentId,
      schoolId
    );

    const { rows } = await pool.query(
      `
      SELECT
        status,
        approved_at,
        returned_at,
        return_note,
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
        assignment.academic_year_id,
        term,
        assignment.stage_id,
        assignment.grade_id,
        assignment.section_id,
        assignment.subject_id,
        teacherAssignmentId,
      ]
    );

    return res.json({
      status: rows[0]?.status || "pending",
      approved_at: rows[0]?.approved_at || null,
      returned_at: rows[0]?.returned_at || null,
      return_note: rows[0]?.return_note || null,
      updated_at: rows[0]?.updated_at || null,
    });
  } catch (e) {
    console.error("getTermWorkControlStatus error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}
export async function getMonthlyWorkControlStatuses(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const teacherAssignmentId = Number(req.query.teacher_assignment_id);
    const term = Number(req.query.term);

    if (!Number.isInteger(teacherAssignmentId) || teacherAssignmentId <= 0) {
      throw badRequest("teacher_assignment_id مطلوب.");
    }

    if (![1, 2].includes(term)) {
      throw badRequest("الفصل الدراسي غير صحيح.");
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    const assignment = await assertOwnAssignment(
      teacherId,
      teacherAssignmentId,
      schoolId
    );

    const { rows } = await pool.query(
      `
      SELECT
        mwa.assessment_id,
        mwa.status,
        mwa.approved_at,
        mwa.returned_at,
        mwa.return_note,
        mwa.updated_at,
        a.title,
        a.sequence_no,
        a.max_score,
        a.status AS assessment_status
      FROM monthly_work_approvals mwa
      JOIN assessments a
        ON a.id = mwa.assessment_id
       AND a.school_id = mwa.school_id
      WHERE mwa.school_id = $1
        AND mwa.academic_year_id = $2
        AND mwa.term = $3
        AND mwa.stage_id = $4
        AND mwa.grade_id = $5
        AND mwa.section_id = $6
        AND mwa.subject_id = $7
        AND mwa.teacher_assignment_id = $8
        AND a.type = 'exam'
        AND a.exam_kind = 'monthly'
        AND mwa.status IN ('returned', 'approved')
      ORDER BY a.sequence_no NULLS LAST, a.id
      `,
      [
        schoolId,
        assignment.academic_year_id,
        term,
        assignment.stage_id,
        assignment.grade_id,
        assignment.section_id,
        assignment.subject_id,
        teacherAssignmentId,
      ]
    );

    const items = rows.map((row) => ({
      assessment_id: row.assessment_id,
      status: row.status || "pending",
      title: row.title || "اختبار شهري",
      sequence_no: row.sequence_no,
      max_score: row.max_score,
      assessment_status: row.assessment_status,
      approved_at: row.approved_at || null,
      returned_at: row.returned_at || null,
      return_note: row.return_note || null,
      updated_at: row.updated_at || null,
    }));

    return res.json({
      returned_count: items.filter((item) => item.status === "returned").length,
      approved_count: items.filter((item) => item.status === "approved").length,
      items,
    });
  } catch (e) {
    console.error("getMonthlyWorkControlStatuses error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}