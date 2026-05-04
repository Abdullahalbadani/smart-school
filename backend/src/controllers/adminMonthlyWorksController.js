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

function parseId(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${name} مطلوب.`);
  }
  return n;
}

function parseOptionalId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isAbsentStatus(status) {
  const s = normalizeText(status);
  return ["absent", "absence", "غائب", "غياب"].includes(s);
}

function isExcusedStatus(status) {
  const s = normalizeText(status);
  return ["excused", "excuse", "معذور", "بعذر"].includes(s);
}

function hasUsableScore(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

function statusLabel(status) {
  if (status === "recorded") return "مرصود";
  if (status === "excused") return "معذور";
  if (status === "absent") return "غائب";
  return "ناقص";
}

function publicationLabel(value) {
  if (value === true) return "منشور";
  if (value === false) return "غير منشور";
  return "لا يحتاج نشر";
}

async function loadMonthlyAssessment(assessmentId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      a.id,
      a.school_id,
      a.teacher_assignment_id,
      a.type,
      a.exam_kind,
      a.sequence_no,
      a.title,
      a.max_score,
      a.status,
      a.starts_at,
      a.due_at,
      a.published_at,
      a.closed_at,
      a.is_system_generated,
      ta.teacher_id,
      ta.academic_year_id,
      ta.term,
      ta.stage_id,
      ta.grade_id,
      ta.section_id,
      ta.subject_id,
      t.full_name AS teacher_name,
      ay.name AS academic_year_name,
      st.name AS stage_name,
      COALESCE(g.grade_name, g.name) AS grade_name,
      sec.name AS section_name,
      sub.name AS subject_name
    FROM assessments a
    JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    JOIN teachers t ON t.id = ta.teacher_id AND t.school_id = a.school_id
    LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id AND ay.school_id = a.school_id
    LEFT JOIN stages st ON st.id = ta.stage_id AND st.school_id = a.school_id
    LEFT JOIN grades g ON g.id = ta.grade_id AND g.school_id = a.school_id
    LEFT JOIN sections sec ON sec.id = ta.section_id AND sec.school_id = a.school_id
    LEFT JOIN subjects sub ON sub.id = ta.subject_id AND sub.school_id = a.school_id
    WHERE a.id = $1
      AND a.school_id = $2
      AND a.type = 'exam'
      AND a.exam_kind = 'monthly'
    LIMIT 1
    `,
    [assessmentId, schoolId]
  );

  if (!rows[0]) {
    throw notFound("لم يتم العثور على الاختبار الشهري.");
  }

  return rows[0];
}

async function findExamOverride(assessment) {
  const assessmentDate = toDateOnly(assessment.starts_at);

  const { rows } = await pool.query(
    `
    SELECT
      tov.id,
      tov.timetable_id,
      tov.date AS exam_date,
      tov.day_of_week,
      tov.period_id,
      tov.type,
      tov.subject_id,
      tov.teacher_id,
      tov.exam_title,
      tov.exam_kind,
      tov.exam_total,
      tov.status,
      p.name AS period_name,
      p.start_time,
      p.end_time
    FROM timetable_overrides tov
    JOIN timetables tt ON tt.id = tov.timetable_id AND tt.school_id = tov.school_id
    LEFT JOIN periods p ON p.id = tov.period_id AND p.school_id = tov.school_id
    WHERE tov.school_id = $1
      AND tt.academic_year_id = $2
      AND tt.term = $3
      AND tt.stage_id = $4
      AND tt.grade_id = $5
      AND tt.section_id = $6
      AND tov.subject_id = $7
      AND tov.teacher_id = $8
      AND tov.exam_kind = 'monthly'
      AND COALESCE(tov.status, 'published') = 'published'
      AND ($9::date IS NULL OR tov.date = $9::date)
    ORDER BY
      CASE WHEN $9::date IS NOT NULL AND tov.date = $9::date THEN 0 ELSE 1 END,
      tov.date DESC,
      tov.id DESC
    LIMIT 1
    `,
    [
      assessment.school_id,
      assessment.academic_year_id,
      assessment.term,
      assessment.stage_id,
      assessment.grade_id,
      assessment.section_id,
      assessment.subject_id,
      assessment.teacher_id,
      assessmentDate,
    ]
  );

  return rows[0] || null;
}

async function loadStudents(assessment) {
  const { rows } = await pool.query(
    `
    SELECT
      s.id,
      s.student_code,
      s.full_name,
      se.roll_number,
      se.status AS enrollment_status
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
    WHERE se.school_id = $1
      AND se.academic_year_id = $2
      AND se.stage_id = $3
      AND se.grade_id = $4
      AND se.section_id = $5
      AND (se.term IS NULL OR se.term = $6)
      AND COALESCE(LOWER(se.status), 'active') NOT IN ('left', 'withdrawn', 'inactive', 'transferred', 'graduated')
    ORDER BY se.roll_number NULLS LAST, s.full_name, s.id
    `,
    [
      assessment.school_id,
      assessment.academic_year_id,
      assessment.stage_id,
      assessment.grade_id,
      assessment.section_id,
      assessment.term,
    ]
  );

  return rows;
}

async function loadAssessmentGrades(assessmentId, schoolId) {
  const { rows } = await pool.query(
    `
    SELECT
      student_id,
      status,
      score,
      feedback,
      is_published,
      published_at,
      graded_at
    FROM assessment_grades
    WHERE school_id = $1
      AND assessment_id = $2
    `,
    [schoolId, assessmentId]
  );

  return new Map(rows.map((row) => [Number(row.student_id), row]));
}

async function loadAttendanceMap(assessment, examOverride) {
  if (!examOverride?.exam_date || !examOverride?.period_id) {
    return new Map();
  }

  const { rows } = await pool.query(
    `
    SELECT
      ae.student_id,
      ae.status,
      ae.reason_id,
      ar.name AS reason_name,
      ae.note,
      sess.id AS session_id
    FROM attendance_sessions sess
    JOIN attendance_entries ae ON ae.session_id = sess.id
    LEFT JOIN attendance_reasons ar ON ar.id = ae.reason_id AND ar.school_id = sess.school_id
    WHERE sess.school_id = $1
      AND sess.academic_year_id = $2
      AND sess.term = $3
      AND sess.attendance_date = $4::date
      AND sess.period_id = $5
      AND sess.section_id = $6
      AND sess.subject_id = $7
      AND sess.teacher_id = $8
    `,
    [
      assessment.school_id,
      assessment.academic_year_id,
      assessment.term,
      examOverride.exam_date,
      examOverride.period_id,
      assessment.section_id,
      assessment.subject_id,
      assessment.teacher_id,
    ]
  );

  return new Map(rows.map((row) => [Number(row.student_id), row]));
}

async function loadExcusesMap(schoolId, studentIds, examOverride) {
  if (!studentIds.length || !examOverride?.exam_date) {
    return new Map();
  }

  const { rows } = await pool.query(
    `
    SELECT
      id,
      student_id,
      request_date,
      type,
      time_from,
      time_to,
      reason_text,
      decision_note,
      decided_at
    FROM permission_requests
    WHERE school_id = $1
      AND student_id = ANY($2::int[])
      AND request_date = $3::date
      AND status = 'APPROVED'
      AND type = 'ABSENCE'
      AND (
        $4::time IS NULL
        OR $5::time IS NULL
        OR time_from IS NULL
        OR time_to IS NULL
        OR (time_from <= $5::time AND time_to >= $4::time)
      )
    ORDER BY decided_at DESC NULLS LAST, id DESC
    `,
    [
      schoolId,
      studentIds,
      examOverride.exam_date,
      examOverride.start_time,
      examOverride.end_time,
    ]
  );

  const map = new Map();

  for (const row of rows) {
    const studentId = Number(row.student_id);
    if (!map.has(studentId)) map.set(studentId, row);
  }

  return map;
}

function buildStudentRows(students, gradesMap, attendanceMap, excusesMap) {
  return students.map((student, index) => {
    const studentId = Number(student.id);
    const grade = gradesMap.get(studentId) || null;
    const attendance = attendanceMap.get(studentId) || null;
    const excuse = excusesMap.get(studentId) || null;

    const hasScore = hasUsableScore(grade?.score);
    const gradeStatus = grade?.status || null;
    const absentFromGrade = isAbsentStatus(gradeStatus);
    const excusedFromGrade = isExcusedStatus(gradeStatus);
    const absentFromAttendance = isAbsentStatus(attendance?.status);

    let rowStatus = "missing";
    let source = "none";

    if (hasScore) {
      rowStatus = "recorded";
      source = "grade";
    } else if (excuse || excusedFromGrade) {
      rowStatus = "excused";
      source = excuse ? "permission_request" : "grade_status";
    } else if (absentFromAttendance || absentFromGrade) {
      rowStatus = "absent";
      source = absentFromAttendance ? "attendance" : "grade_status";
    }

    const needsPublish = !!grade && grade.is_published !== true;

    return {
      no: index + 1,
      student_id: studentId,
      student_code: student.student_code,
      student_name: student.full_name,
      roll_number: student.roll_number,
      score: hasScore ? Number(grade.score) : null,
      grade_status: gradeStatus,
      attendance_status: attendance?.status || null,
      attendance_reason: attendance?.reason_name || null,
      excuse_id: excuse?.id || null,
      excuse_reason: excuse?.reason_text || null,
      status: rowStatus,
      status_label: statusLabel(rowStatus),
      status_source: source,
      is_published: grade ? grade.is_published === true : null,
      publication_label: publicationLabel(grade ? grade.is_published === true : null),
      needs_publish: needsPublish,
      published_at: grade?.published_at || null,
      note:
        rowStatus === "recorded"
          ? ""
          : rowStatus === "excused"
            ? excuse?.reason_text || "عذر معتمد"
            : rowStatus === "absent"
              ? attendance?.reason_name || attendance?.status || "غائب في التحضير"
              : "لا توجد درجة ولا غياب ولا عذر معتمد",
    };
  });
}

function buildSummary(rows) {
  const summary = {
    total_students: rows.length,
    recorded: 0,
    excused: 0,
    absent: 0,
    missing: 0,
    published: 0,
    unpublished: 0,
    can_approve: false,
  };

  for (const row of rows) {
    if (row.status === "recorded") summary.recorded += 1;
    if (row.status === "excused") summary.excused += 1;
    if (row.status === "absent") summary.absent += 1;
    if (row.status === "missing") summary.missing += 1;
    if (row.is_published === true) summary.published += 1;
    if (row.needs_publish) summary.unpublished += 1;
  }

  summary.can_approve =
    summary.total_students > 0 &&
    summary.missing === 0 &&
    summary.unpublished === 0;

  return summary;
}
function pickUserId(req) {
  const value =
    req.user?.id ||
    req.user?.user_id ||
    req.user?.userId ||
    req.user?.sub ||
    null;

  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getMonthlyApproval(assessment) {
  const { rows } = await pool.query(
    `
    SELECT
      status,
      approved_by,
      approved_at,
      returned_by,
      returned_at,
      return_note,
      updated_at
    FROM monthly_work_approvals
    WHERE school_id = $1
      AND assessment_id = $2
    LIMIT 1
    `,
    [assessment.school_id, assessment.id]
  );

  return {
    status: rows[0]?.status || "pending",
    approved_by: rows[0]?.approved_by || null,
    approved_at: rows[0]?.approved_at || null,
    returned_by: rows[0]?.returned_by || null,
    returned_at: rows[0]?.returned_at || null,
    return_note: rows[0]?.return_note || null,
    updated_at: rows[0]?.updated_at || null,
  };
}

async function upsertMonthlyApproval(assessment, status, userId, note = null) {
  const { rows } = await pool.query(
    `
    INSERT INTO monthly_work_approvals (
      school_id,
      academic_year_id,
      term,
      stage_id,
      grade_id,
      section_id,
      subject_id,
      teacher_assignment_id,
      assessment_id,
      status,
      approved_by,
      approved_at,
      returned_by,
      returned_at,
      return_note,
      created_at,
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
      $9,
      $10::varchar(20),
      CASE WHEN $10::text = 'approved' THEN $11 ELSE NULL END,
      CASE WHEN $10::text = 'approved' THEN NOW() ELSE NULL END,
      CASE WHEN $10::text = 'returned' THEN $11 ELSE NULL END,
      CASE WHEN $10::text = 'returned' THEN NOW() ELSE NULL END,
      CASE WHEN $10::text = 'returned' THEN $12 ELSE NULL END,
      NOW(),
      NOW()
    )
    ON CONFLICT (school_id, assessment_id)
    DO UPDATE SET
      status = $10::varchar(20),
      approved_by = CASE WHEN $10::text = 'approved' THEN $11 ELSE NULL END,
      approved_at = CASE WHEN $10::text = 'approved' THEN NOW() ELSE NULL END,
      returned_by = CASE WHEN $10::text = 'returned' THEN $11 ELSE NULL END,
      returned_at = CASE WHEN $10::text = 'returned' THEN NOW() ELSE NULL END,
      return_note = CASE WHEN $10::text = 'returned' THEN $12 ELSE NULL END,
      updated_at = NOW()
    RETURNING
      status,
      approved_by,
      approved_at,
      returned_by,
      returned_at,
      return_note,
      updated_at
    `,
    [
      assessment.school_id,
      assessment.academic_year_id,
      assessment.term,
      assessment.stage_id,
      assessment.grade_id,
      assessment.section_id,
      assessment.subject_id,
      assessment.teacher_assignment_id,
      assessment.id,
      status,
      userId,
      note,
    ]
  );

  return rows[0];
}

async function buildMonthlyWorksData(assessmentId, schoolId) {
  const assessment = await loadMonthlyAssessment(assessmentId, schoolId);
  const examOverride = await findExamOverride(assessment);
  const students = await loadStudents(assessment);
  const studentIds = students.map((student) => Number(student.id));
  const gradesMap = await loadAssessmentGrades(assessment.id, schoolId);
  const attendanceMap = await loadAttendanceMap(assessment, examOverride);
  const excusesMap = await loadExcusesMap(schoolId, studentIds, examOverride);
  const rows = buildStudentRows(students, gradesMap, attendanceMap, excusesMap);
  const summary = buildSummary(rows);
  const approval = await getMonthlyApproval(assessment);

  return {
    assessment,
    examOverride,
    rows,
    summary,
    approval,
  };
}

function monthlyWorksResponse(data) {
  const assessment = data.assessment;
  const examOverride = data.examOverride;

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      max_score: assessment.max_score,
      status: assessment.status,
      sequence_no: assessment.sequence_no,
      starts_at: assessment.starts_at,
      due_at: assessment.due_at,
      teacher_assignment_id: assessment.teacher_assignment_id,
      teacher_name: assessment.teacher_name,
      academic_year_id: assessment.academic_year_id,
      academic_year_name: assessment.academic_year_name,
      term: assessment.term,
      stage_id: assessment.stage_id,
      stage_name: assessment.stage_name,
      grade_id: assessment.grade_id,
      grade_name: assessment.grade_name,
      section_id: assessment.section_id,
      section_name: assessment.section_name,
      subject_id: assessment.subject_id,
      subject_name: assessment.subject_name,
    },
    exam_session: examOverride
      ? {
          override_id: examOverride.id,
          exam_date: examOverride.exam_date,
          period_id: examOverride.period_id,
          period_name: examOverride.period_name,
          start_time: examOverride.start_time,
          end_time: examOverride.end_time,
        }
      : null,
    approval: data.approval,
    summary: data.summary,
    students: data.rows,
  };
}
export async function listMonthlyAssessments(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح." });

    const academicYearId = parseId(req.query.academic_year_id, "السنة الدراسية");
    const term = parseId(req.query.term, "الفصل الدراسي");
    const stageId = parseId(req.query.stage_id, "المرحلة");
    const gradeId = parseId(req.query.grade_id, "الصف");
    const sectionId = parseId(req.query.section_id, "الشعبة");
    const subjectId = parseId(req.query.subject_id, "المادة");
    const teacherAssignmentId = parseOptionalId(req.query.teacher_assignment_id);

    const params = [schoolId, academicYearId, term, stageId, gradeId, sectionId, subjectId];
    let assignmentFilter = "";

    if (teacherAssignmentId) {
      params.push(teacherAssignmentId);
      assignmentFilter = `AND ta.id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        a.id,
        a.teacher_assignment_id,
        a.title,
        a.max_score,
        a.status,
        a.sequence_no,
        a.starts_at,
        a.due_at,
        a.published_at,
        a.closed_at,
        a.is_system_generated,
        t.full_name AS teacher_name
      FROM assessments a
      JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
      JOIN teachers t ON t.id = ta.teacher_id AND t.school_id = a.school_id
      WHERE a.school_id = $1
        AND ta.academic_year_id = $2
        AND ta.term = $3
        AND ta.stage_id = $4
        AND ta.grade_id = $5
        AND ta.section_id = $6
        AND ta.subject_id = $7
        AND a.type = 'exam'
        AND a.exam_kind = 'monthly'
        ${assignmentFilter}
      ORDER BY a.starts_at DESC NULLS LAST, a.sequence_no DESC NULLS LAST, a.id DESC
      `,
      params
    );

    return res.json({ items: rows });
  } catch (e) {
    console.error("listMonthlyAssessments error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function getMonthlyWorks(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح." });

    const assessmentId = parseId(req.query.assessment_id, "الاختبار الشهري");
    const data = await buildMonthlyWorksData(assessmentId, schoolId);

    return res.json(monthlyWorksResponse(data));
  } catch (e) {
    console.error("getMonthlyWorks error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}
export async function approveMonthlyWorks(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const assessmentId = parseId(req.body?.assessment_id, "الاختبار الشهري");
    const data = await buildMonthlyWorksData(assessmentId, schoolId);

    if (!data.summary.can_approve) {
      throw badRequest("لا يمكن اعتماد الكشف الشهري قبل اكتمال الدرجات ونشرها.");
    }

    const approval = await upsertMonthlyApproval(
      data.assessment,
      "approved",
      userId,
      null
    );

    return res.json({
      message: "تم اعتماد الكشف الشهري بنجاح.",
      approval,
    });
  } catch (e) {
    console.error("approveMonthlyWorks error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function returnMonthlyWorks(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const assessmentId = parseId(req.body?.assessment_id, "الاختبار الشهري");
    const returnNote = String(req.body?.return_note || "").trim();

    if (!returnNote) {
      throw badRequest("سبب الإرجاع مطلوب.");
    }

    const data = await buildMonthlyWorksData(assessmentId, schoolId);

    if (data.approval.status === "approved") {
      throw badRequest("لا يمكن إرجاع كشف شهري معتمد.");
    }

    const approval = await upsertMonthlyApproval(
      data.assessment,
      "returned",
      userId,
      returnNote
    );

    return res.json({
      message: "تم إرجاع الكشف الشهري للمعلم.",
      approval,
    });
  } catch (e) {
    console.error("returnMonthlyWorks error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}