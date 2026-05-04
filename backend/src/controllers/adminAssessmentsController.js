import { pool } from '../config/db.js';
import { logActivity } from '../utils/logger.js';

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

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeGradeStatus(value, score) {
  const raw = String(value || '').trim();

  if (['graded', 'missing', 'excused', 'absent'].includes(raw)) {
    return raw;
  }

  if (score === null || score === undefined || score === '') {
    return 'missing';
  }

  return 'graded';
}

function parseScore(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toLegacyAssessmentType(assessment) {
  if (!assessment) return null;

  if (assessment.type === 'exam') {
    if (assessment.exam_kind === 'monthly') return 'monthly_exam';
    if (assessment.exam_kind === 'midterm') return 'midterm_exam';
    if (assessment.exam_kind === 'final') return 'final_exam';
    return 'exam';
  }

  if (assessment.type === 'aggregate') {
    if (assessment.aggregate_kind === 'midterm') return 'midterm_muhassala';
    if (assessment.aggregate_kind === 'final') return 'final_muhassala';
    return 'aggregate';
  }

  return assessment.type;
}

async function getAssessmentForAdmin(assessmentId, schoolId, db = pool) {
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
      ta.subject_id,
      u.name AS teacher_name,
      ay.name AS academic_year_name,
      st.name AS stage_name,
      COALESCE(g.grade_name, g.name) AS grade_name,
      sec.name AS section_name,
      subj.name AS subject_name
    FROM assessments a
    JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    JOIN teachers t ON t.id = ta.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id
    LEFT JOIN stages st ON st.id = ta.stage_id
    LEFT JOIN grades g ON g.id = ta.grade_id
    LEFT JOIN sections sec ON sec.id = ta.section_id
    LEFT JOIN subjects subj ON subj.id = ta.subject_id
    WHERE a.id = $1
      AND a.school_id = $2
      AND t.school_id = $2
    LIMIT 1
    `,
    [assessmentId, schoolId]
  );

  return rows[0] ?? null;
}

async function getEligibleStudentIdsForAssessment(assessment, schoolId, sectionId = null, db = pool) {
  const selectedSectionId = sectionId || assessment.section_id || null;

  const { rows } = await db.query(
    `
    SELECT se.student_id
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    WHERE se.academic_year_id = $1
      AND se.term = $2
      AND se.school_id = $3
      AND s.school_id = $3
      AND COALESCE(se.status, 'enrolled') = 'enrolled'
      AND (
        ($4::int IS NOT NULL AND se.section_id = $4)
        OR
        ($4::int IS NULL AND $5::int IS NOT NULL AND se.section_id = $5)
        OR
        ($4::int IS NULL AND $5::int IS NULL AND se.grade_id = $6)
      )
    `,
    [
      assessment.academic_year_id,
      assessment.term,
      schoolId,
      selectedSectionId,
      assessment.section_id,
      assessment.grade_id,
    ]
  );

  return new Set(rows.map((r) => Number(r.student_id)));
}

export const getAdminAssessments = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const sectionId = toInt(req.query.section_id);
    const subjectId = toInt(req.query.subject_id);

    if (!schoolId) {
      return res.status(401).json({ message: 'غير مصرح.' });
    }

    if (!sectionId || !subjectId) {
      return res.status(400).json({ message: 'الرجاء تحديد الشعبة والمادة.' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        a.id AS assessment_id,
        a.title,
        a.max_score,
        a.status,
        a.type AS canonical_type,
        a.exam_kind,
        a.aggregate_kind,
        a.sequence_no,
        a.is_system_generated,
        a.created_at,
        u.name AS teacher_name,
        COUNT(ag.id)::int AS grades_count,
        COUNT(ag.id) FILTER (WHERE COALESCE(ag.is_published, false) = true)::int AS published_grades_count
      FROM assessments a
      JOIN teacher_assignments ta ON a.teacher_assignment_id = ta.id
      JOIN teachers t ON ta.teacher_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN assessment_grades ag
        ON ag.assessment_id = a.id
       AND ag.school_id = a.school_id
      WHERE a.school_id = $1
        AND t.school_id = $1
        AND ta.section_id = $2
        AND ta.subject_id = $3
      GROUP BY
        a.id,
        a.title,
        a.max_score,
        a.status,
        a.type,
        a.exam_kind,
        a.aggregate_kind,
        a.sequence_no,
        a.is_system_generated,
        a.created_at,
        u.name
      ORDER BY a.created_at DESC
      `,
      [schoolId, sectionId, subjectId]
    );

    const data = rows.map((row) => ({
      ...row,
      type: toLegacyAssessmentType(row),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Admin Assessment Fetch Error:', error);
    return res.status(500).json({ message: 'خطأ في جلب بيانات التقييمات.' });
  }
};

export const getAssessmentGrades = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const assessmentId = toInt(req.params.assessment_id);
    const sectionId = toInt(req.query.section_id);

    if (!schoolId) {
      return res.status(401).json({ message: 'غير مصرح.' });
    }

    if (!assessmentId) {
      return res.status(400).json({ message: 'معرف التقييم غير صحيح.' });
    }

    const assessment = await getAssessmentForAdmin(assessmentId, schoolId);

    if (!assessment) {
      throw notFound('التقييم غير موجود أو لا يتبع لمدرستك.');
    }

    if (sectionId && assessment.section_id && Number(sectionId) !== Number(assessment.section_id)) {
      throw badRequest('الشعبة المرسلة لا تطابق شعبة التقييم.');
    }

    const selectedSectionId = sectionId || assessment.section_id || null;

    const { rows } = await pool.query(
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
        ag.graded_at,
        u.name AS grader_name
      FROM student_enrollments se
      JOIN students s ON s.id = se.student_id
      LEFT JOIN assessment_grades ag
        ON ag.assessment_id = $7
       AND ag.student_id = se.student_id
       AND ag.school_id = $3
      LEFT JOIN users u ON ag.graded_by = u.id
      WHERE se.academic_year_id = $1
        AND se.term = $2
        AND se.school_id = $3
        AND s.school_id = $3
        AND COALESCE(se.status, 'enrolled') = 'enrolled'
        AND (
          ($4::int IS NOT NULL AND se.section_id = $4)
          OR
          ($4::int IS NULL AND $5::int IS NOT NULL AND se.section_id = $5)
          OR
          ($4::int IS NULL AND $5::int IS NULL AND se.grade_id = $6)
        )
      ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
      `,
      [
        assessment.academic_year_id,
        assessment.term,
        schoolId,
        selectedSectionId,
        assessment.section_id,
        assessment.grade_id,
        assessmentId,
      ]
    );

    return res.json({
      success: true,
      assessment: {
        id: assessment.id,
        title: assessment.title,
        max_score: assessment.max_score,
        status: assessment.status,
        type: toLegacyAssessmentType(assessment),
        canonical_type: assessment.type,
        exam_kind: assessment.exam_kind,
        aggregate_kind: assessment.aggregate_kind,
        sequence_no: assessment.sequence_no,
        teacher_name: assessment.teacher_name,
        academic_year_name: assessment.academic_year_name,
        stage_name: assessment.stage_name,
        grade_name: assessment.grade_name,
        section_name: assessment.section_name,
        subject_name: assessment.subject_name,
      },
      data: rows,
    });
  } catch (error) {
    console.error('Error fetching admin assessment grades:', error);
    return res.status(error.status || 500).json({ message: error.message || 'حدث خطأ أثناء جلب قائمة الدرجات.' });
  }
};

export const bulkOverrideGrades = async (req, res) => {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    const adminId = pickUserId(req);
    const assessmentId = toInt(req.params.assessment_id);
    const sectionId = toInt(req.body?.section_id || req.query?.section_id);
    const gradesList = Array.isArray(req.body?.gradesList)
      ? req.body.gradesList
      : Array.isArray(req.body?.items)
        ? req.body.items
        : [];

    if (!schoolId || !adminId) {
      return res.status(401).json({ message: 'غير مصرح.' });
    }

    if (!assessmentId) {
      return res.status(400).json({ message: 'معرف التقييم غير صحيح.' });
    }

    if (!gradesList.length) {
      return res.status(400).json({ message: 'لا توجد تعديلات للحفظ.' });
    }

    await client.query('BEGIN');

    const assessment = await getAssessmentForAdmin(assessmentId, schoolId, client);

    if (!assessment) {
      throw notFound('التقييم غير موجود أو لا يتبع لمدرستك.');
    }

    if (assessment.status === 'closed') {
      throw badRequest('لا يمكن تعديل درجات تقييم مغلق.');
    }

    if (sectionId && assessment.section_id && Number(sectionId) !== Number(assessment.section_id)) {
      throw badRequest('الشعبة المرسلة لا تطابق شعبة التقييم.');
    }

    const allowedStudentIds = await getEligibleStudentIdsForAssessment(
      assessment,
      schoolId,
      sectionId,
      client
    );

    if (!allowedStudentIds.size) {
      throw badRequest('لا يوجد طلاب ضمن نطاق هذا التقييم.');
    }

    let updatedCount = 0;
    let insertedCount = 0;
    const changesLog = [];

    for (const item of gradesList) {
      const studentId = toInt(item.student_id);
      const parsedScore = parseScore(item.score);
      const status = normalizeGradeStatus(item.status, item.score);
      const feedback = item.feedback === undefined ? null : item.feedback;

      if (!studentId) {
        throw badRequest('يوجد student_id غير صحيح.');
      }

      if (!allowedStudentIds.has(studentId)) {
        throw forbidden(`الطالب ${studentId} ليس ضمن نطاق هذا التقييم.`);
      }

      if (!['graded', 'missing', 'excused', 'absent'].includes(status)) {
        throw badRequest('يوجد status غير صحيح.');
      }

      if (status === 'graded') {
        if (!Number.isFinite(parsedScore)) {
          throw badRequest('يوجد طالب تم تقييمه بدون درجة صحيحة.');
        }

        if (parsedScore < 0 || parsedScore > Number(assessment.max_score)) {
          throw badRequest(`يجب أن تكون الدرجة بين 0 و ${assessment.max_score}.`);
        }
      }

      const finalScore = status === 'graded' ? parsedScore : null;

      const checkRes = await client.query(
        `
        SELECT id, status, score
        FROM assessment_grades
        WHERE assessment_id = $1
          AND student_id = $2
          AND school_id = $3
        LIMIT 1
        `,
        [assessmentId, studentId, schoolId]
      );

      if (checkRes.rows.length > 0) {
        const oldGrade = checkRes.rows[0];

        await client.query(
          `
          UPDATE assessment_grades
          SET status = $1,
              score = $2,
              feedback = $3,
              graded_by = $4,
              graded_at = NOW(),
              is_published = true,
              published_at = COALESCE(published_at, NOW()),
              updated_at = NOW()
          WHERE id = $5
            AND school_id = $6
          `,
          [status, finalScore, feedback, adminId, oldGrade.id, schoolId]
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
            oldGrade.id,
            adminId,
            oldGrade.status,
            status,
            oldGrade.score,
            finalScore,
            'تعديل بواسطة الإدارة أو الكنترول',
          ]
        );

        updatedCount += 1;
        changesLog.push({
          student_id: studentId,
          old_status: oldGrade.status,
          new_status: status,
          old_score: oldGrade.score,
          new_score: finalScore,
        });
      } else {
        const insertRes = await client.query(
          `
          INSERT INTO assessment_grades
            (school_id, assessment_id, student_id, status, score, feedback, graded_by, graded_at, is_published, published_at, created_at, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, NOW(), true, NOW(), NOW(), NOW())
          RETURNING id
          `,
          [schoolId, assessmentId, studentId, status, finalScore, feedback, adminId]
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
            insertRes.rows[0].id,
            adminId,
            null,
            status,
            null,
            finalScore,
            'إدخال بواسطة الإدارة أو الكنترول',
          ]
        );

        insertedCount += 1;
        changesLog.push({
          student_id: studentId,
          old_status: null,
          new_status: status,
          old_score: null,
          new_score: finalScore,
        });
      }
    }

    await client.query(
      `
      UPDATE assessments
      SET status = 'published',
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      `,
      [assessmentId, schoolId]
    );

    await client.query('COMMIT');

    await logActivity({
      school_id: schoolId,
      user_id: adminId,
      action: 'UPDATE',
      resource_type: 'assessment_grades',
      resource_id: assessmentId,
      description: `تعديل إداري في (${assessment.title}) لعدد (${updatedCount + insertedCount}) طالب`,
      changes: changesLog.length > 0 ? { updates: changesLog } : null,
      req,
    });

    res.locals.skipAutoLog = true;

    return res.json({
      success: true,
      message: `تم اعتماد التعديلات بنجاح. تم تعديل ${updatedCount} وإضافة ${insertedCount}.`,
      updatedCount,
      insertedCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Admin Bulk Override Error:', error);
    return res.status(error.status || 500).json({ message: error.message || 'حدث خطأ في الخادم أثناء اعتماد الدرجات.' });
  } finally {
    client.release();
  }
};

export const getSubjectsByGradeId = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const gradeId = toInt(req.query.grade_id);

    if (!schoolId) {
      return res.status(401).json({ success: false, message: 'غير مصرح.' });
    }

    if (!gradeId) {
      return res.status(400).json({ success: false, message: 'معرف الصف مطلوب' });
    }

    const { rows } = await pool.query(
      `
      SELECT DISTINCT s.id, s.name
      FROM grade_subjects gs
      JOIN grades g ON g.id = gs.grade_id
      JOIN subjects s ON s.id = gs.subject_id
      WHERE gs.grade_id = $1
        AND g.school_id = $2
        AND s.school_id = $2
        AND COALESCE(s.is_active, true) = true
        AND COALESCE(gs.is_active, true) = true
      ORDER BY s.name ASC
      `,
      [gradeId, schoolId]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching subjects by grade:', error);
    return res.status(500).json({ success: false, message: 'خطأ في جلب المواد' });
  }
};
