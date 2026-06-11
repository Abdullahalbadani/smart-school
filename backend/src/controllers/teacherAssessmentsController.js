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

async function assertOwnAssessment(teacherId, assessmentId, schoolId, db = pool) {
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

  if (!rows.length) {
    throw forbidden("التقييم غير موجود أو غير تابع لك أو لمدرستك.");
  }

  return rows[0];
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

function parseBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  const raw = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(raw);
}

function buildLatePolicy(body) {
  if (body?.late_policy_json) {
    if (typeof body.late_policy_json === "object") {
      return body.late_policy_json;
    }

    if (typeof body.late_policy_json === "string") {
      try {
        return JSON.parse(body.late_policy_json);
      } catch {
      }
    }
  }

  const lateUntil = String(body?.late_until || "").trim();

  return {
    submission_kind: body?.submission_kind ?? "none",
    allow_late_submission: parseBoolean(body?.allow_late_submission),
    late_until: lateUntil || null,
  };
}

function toLegacyAssessmentType(assessment) {
  if (!assessment) return null;

  if (assessment.type === "exam") {
    if (assessment.exam_kind === "monthly") return "monthly_exam";
    if (assessment.exam_kind === "midterm") return "midterm_exam";
    if (assessment.exam_kind === "final") return "final_exam";
    return "exam";
  }

  if (assessment.type === "aggregate") {
    if (assessment.aggregate_kind === "midterm") return "midterm_muhassala";
    if (assessment.aggregate_kind === "final") return "final_muhassala";
    return "aggregate";
  }

  return assessment.type;
}

function parseAssessmentClassification(body) {
  const rawType = String(body?.type || "").trim();
  const rawExamKind = String(body?.exam_kind || "").trim();
  const rawAggregateKind = String(body?.aggregate_kind || "").trim();
  const seq = body?.sequence_no == null || body?.sequence_no === "" ? null : Number(body.sequence_no);

  if (rawType === "exam") {
    if (!["monthly", "midterm", "final"].includes(rawExamKind)) {
      throw badRequest("نوع الاختبار غير صحيح.");
    }

    return {
      canonical_type: "exam",
      exam_kind: rawExamKind,
      aggregate_kind: null,
      sequence_no: rawExamKind === "monthly" ? (Number.isFinite(seq) && seq > 0 ? seq : 1) : null,
      is_system_generated: false,
    };
  }

  if (rawType === "aggregate") {
    if (!["midterm", "final"].includes(rawAggregateKind)) {
      throw badRequest("نوع المحصلة غير صحيح.");
    }

    return {
      canonical_type: "aggregate",
      exam_kind: null,
      aggregate_kind: rawAggregateKind,
      sequence_no: null,
      is_system_generated: false,
    };
  }

  if (rawType === "quiz" || rawType === "monthly_exam") {
    return {
      canonical_type: "exam",
      exam_kind: "monthly",
      aggregate_kind: null,
      sequence_no: Number.isFinite(seq) && seq > 0 ? seq : 1,
      is_system_generated: false,
    };
  }

  if (rawType === "midterm_exam") {
    return {
      canonical_type: "exam",
      exam_kind: "midterm",
      aggregate_kind: null,
      sequence_no: null,
      is_system_generated: false,
    };
  }

  if (rawType === "final_exam") {
    return {
      canonical_type: "exam",
      exam_kind: "final",
      aggregate_kind: null,
      sequence_no: null,
      is_system_generated: false,
    };
  }

  if (rawType === "midterm_muhassala") {
    return {
      canonical_type: "aggregate",
      exam_kind: null,
      aggregate_kind: "midterm",
      sequence_no: null,
      is_system_generated: true,
    };
  }

  if (rawType === "final_muhassala") {
    return {
      canonical_type: "aggregate",
      exam_kind: null,
      aggregate_kind: "final",
      sequence_no: null,
      is_system_generated: true,
    };
  }

  if (["classwork", "activity", "homework", "project", "oral"].includes(rawType)) {
    return {
      canonical_type: rawType,
      exam_kind: null,
      aggregate_kind: null,
      sequence_no: null,
      is_system_generated: false,
    };
  }

  if (rawType === "live_online") {
    return {
      canonical_type: "activity",
      exam_kind: null,
      aggregate_kind: null,
      sequence_no: null,
      is_system_generated: false,
      force_mode: "live_online",
    };
  }

  throw badRequest("نوع التقييم غير صحيح.");
}
function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getSchoolGradingPolicy(db, schoolId) {
  const { rows } = await db.query(
    `
    SELECT
      monthly_exam_max_grade,
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

function getExamMaxScoreFromPolicy(policy, examKind, totalScore = null) {
  const direct = positiveNumber(totalScore);
  if (direct) return direct;

  if (examKind === "monthly") {
    return positiveNumber(policy?.monthly_exam_max_grade);
  }

  if (examKind === "midterm") {
    return positiveNumber(policy?.midterm_exam_max_grade);
  }

  if (examKind === "final") {
    return positiveNumber(policy?.final_exam_max_grade);
  }

  return null;
}

function getAggregateMaxScoreFromPolicy(policy, aggregateKind) {
  if (aggregateKind === "midterm") {
    return positiveNumber(policy?.midterm_muhassala_max_grade);
  }

  if (aggregateKind === "final") {
    return positiveNumber(policy?.final_muhassala_max_grade);
  }

  return null;
}

function missingScoreMessage(kind) {
  if (kind === "monthly") {
    return "يجب تحديد درجة الاختبار الشهري من جدول الإدارة أو من إعدادات المدرسة.";
  }

  if (kind === "midterm") {
    return "يجب ضبط درجة الاختبار النصفي من إعدادات المدرسة.";
  }

  if (kind === "final") {
    return "يجب ضبط درجة الاختبار النهائي من إعدادات المدرسة.";
  }

  if (kind === "midterm_muhassala") {
    return "يجب ضبط درجة محصلة النصفي من إعدادات المدرسة.";
  }

  if (kind === "final_muhassala") {
    return "يجب ضبط درجة محصلة النهائي من إعدادات المدرسة.";
  }

  return "يجب ضبط درجة التقييم من إعدادات المدرسة.";
}
function mapExamTypeToContext(examType, sequenceNo = null, totalScore = null, policy = null) {
  const raw = String(examType || "").trim().toLowerCase();

  if (["monthly", "monthly_exam", "monthly-test", "شهري", "اختبار شهري"].includes(raw)) {
    return {
      legacy_type: "monthly_exam",
      canonical_type: "exam",
      exam_kind: "monthly",
      sequence_no: Number.isFinite(Number(sequenceNo)) && Number(sequenceNo) > 0 ? Number(sequenceNo) : 1,
      max_score: getExamMaxScoreFromPolicy(policy, "monthly", totalScore),
    };
  }

  if (["midyear", "midterm", "midterm_exam", "نصفي", "اختبار نصفي"].includes(raw)) {
    return {
      legacy_type: "midterm_exam",
      canonical_type: "exam",
      exam_kind: "midterm",
      sequence_no: null,
      max_score: getExamMaxScoreFromPolicy(policy, "midterm", totalScore),
    };
  }

  if (["final", "final_exam", "نهائي", "اختبار نهائي"].includes(raw)) {
    return {
      legacy_type: "final_exam",
      canonical_type: "exam",
      exam_kind: "final",
      sequence_no: null,
      max_score: getExamMaxScoreFromPolicy(policy, "final", totalScore),
    };
  }

  return null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getCurrentLocalParts() {
  const now = new Date();

  return {
    todayDate: [now.getFullYear(), pad2(now.getMonth() + 1), pad2(now.getDate())].join("-"),
    nowTime: [pad2(now.getHours()), pad2(now.getMinutes()), pad2(now.getSeconds())].join(":"),
  };
}

function normalizeTimeText(value, fallback) {
  const raw = String(value || fallback || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

  if (!match) {
    return fallback;
  }

  return `${pad2(match[1])}:${match[2]}:${match[3] || "00"}`;
}

function getExamAvailability(startTime, endTime, nowTime) {
  if (nowTime < startTime) {
    return { availability: "upcoming", can_grade: false };
  }

  if (nowTime <= endTime) {
    return { availability: "running", can_grade: false };
  }

  return { availability: "finished", can_grade: true };
}

function getOfficialMessage(availability, title) {
  if (availability === "upcoming") {
    return `${title} مجدول اليوم ولم يبدأ بعد.`;
  }

  if (availability === "running") {
    return `${title} جارٍ الآن، ويمكن فتح رصد الدرجات بعد انتهاء وقته.`;
  }

  return `${title} انتهى وقته، يمكنك فتح رصد الدرجات.`;
}

function buildOfficialPayload({ sourceType, exam, mapped, title, nowTime }) {
  const startTime = normalizeTimeText(exam.start_time, "00:00:00");
  const endTime = normalizeTimeText(exam.end_time, "23:59:59");
  const state = getExamAvailability(startTime, endTime, nowTime);
  const examDate = String(exam.exam_date).slice(0, 10);
  const finalTitle = title || exam.exam_title || "اختبار رسمي";

  return {
    matched: true,
    source_type: sourceType,
    source_id: Number(exam.source_id),
    type: mapped.legacy_type,
    legacy_type: mapped.legacy_type,
    canonical_type: mapped.canonical_type,
    exam_kind: mapped.exam_kind,
    sequence_no: mapped.sequence_no,
    title: finalTitle,
    mode: "in_class",
    max_score: mapped.max_score,
    exam_date: examDate,
    starts_at: `${examDate}T${startTime}`,
    due_at: `${examDate}T${endTime}`,
    starts_at_time: startTime,
    ends_at_time: endTime,
    availability: state.availability,
    can_grade: state.can_grade,
    can_create_assessment: state.can_grade,
    message: getOfficialMessage(state.availability, finalTitle),
  };
}

async function findTodayOfficialAssessmentContext({
  schoolId,
  teacherId,
  assignment,
  sourceType = null,
  sourceId = null,
  db = pool,
}) {
  const { todayDate, nowTime } = getCurrentLocalParts();
  const wantedSourceId = Number(sourceId);
  const safeSourceId = Number.isFinite(wantedSourceId) && wantedSourceId > 0 ? wantedSourceId : null;
const gradingPolicy = await getSchoolGradingPolicy(db, schoolId);
  if (!sourceType || sourceType === "timetable_override") {
    const monthlyQ = await db.query(
      `
      SELECT
        o.id AS source_id,
        COALESCE(o.exam_kind, 'monthly') AS exam_type,
        COALESCE(o.exam_title, 'اختبار شهري') AS exam_title,
      o.exam_total AS exam_total,
        o.date::text AS exam_date,
        p.start_time::text AS start_time,
        p.end_time::text AS end_time,
        EXTRACT(MONTH FROM o.date)::int AS sequence_no
      FROM timetable_overrides o
      JOIN timetables tt
        ON tt.id = o.timetable_id
       AND tt.school_id = o.school_id
      LEFT JOIN timetable_entries te
        ON te.timetable_id = tt.id
       AND te.day_of_week = o.day_of_week
       AND te.period_id = o.period_id
       AND te.school_id = o.school_id
      JOIN periods p
        ON p.id = o.period_id
       AND (p.school_id = o.school_id OR p.school_id IS NULL)
      WHERE o.school_id = $1
        AND tt.academic_year_id = $2
        AND tt.term = $3
        AND tt.section_id = $4
        AND o.type = 'exam'
        AND o.status = 'published'
        AND tt.status = 'published'
        AND COALESCE(o.subject_id, te.subject_id) = $5
        AND COALESCE(o.teacher_id, te.teacher_id) = $6
        AND COALESCE(o.exam_kind, 'monthly') IN ('monthly', 'monthly_exam')
        AND o.date::date = $7::date
        AND ($8::bigint IS NULL OR o.id = $8::bigint)
      ORDER BY p.start_time ASC
      LIMIT 1
      `,
      [
        schoolId,
        assignment.academic_year_id,
        assignment.term,
        assignment.section_id,
        assignment.subject_id,
        teacherId,
        todayDate,
        sourceType === "timetable_override" ? safeSourceId : null,
      ]
    );

    if (monthlyQ.rows.length) {
      const exam = monthlyQ.rows[0];
const mapped = mapExamTypeToContext(exam.exam_type, exam.sequence_no, exam.exam_total, gradingPolicy);
if (mapped && !mapped.max_score) {
  return {
    matched: true,
    source_type: "timetable_override",
    source_id: Number(exam.source_id),
    type: mapped.legacy_type,
    legacy_type: mapped.legacy_type,
    canonical_type: mapped.canonical_type,
    exam_kind: mapped.exam_kind,
    sequence_no: mapped.sequence_no,
    title: exam.exam_title,
    mode: "in_class",
    max_score: null,
    exam_date: String(exam.exam_date).slice(0, 10),
    availability: "missing_score",
    can_grade: false,
    can_create_assessment: false,
    message: missingScoreMessage(mapped.exam_kind),
  };
}
      if (mapped) {
      const payload = buildOfficialPayload({
  sourceType: "timetable_override",
  exam,
  mapped,
  title: exam.exam_title,
  nowTime,
});

if (payload.availability === "upcoming") {
  return null;
}

return payload;
      }
    }
  }

  if (!sourceType || sourceType === "exam_timetable_entry") {
    const examQ = await db.query(
      `
      SELECT
        ete.id AS source_id,
        et.exam_type,
        et.month AS sequence_no,
        ete.exam_date::text AS exam_date,
        ete.start_time::text AS start_time,
        ete.end_time::text AS end_time
      FROM exam_timetable_entries ete
      JOIN exam_timetables et
        ON et.id = ete.exam_timetable_id
      WHERE et.academic_year_id = $1
        AND et.school_id = $7
        AND (
          (et.scope = 'section' AND et.section_id = $2)
          OR
          (et.scope = 'grade' AND et.grade_id = $3)
        )
        AND ete.subject_id = $4
        AND ete.exam_date::date = $5::date
        AND et.status = 'published'
        AND et.exam_type IN ('midyear', 'midterm', 'final')
        AND ($6::bigint IS NULL OR ete.id = $6::bigint)
      ORDER BY ete.start_time ASC
      LIMIT 1
      `,
      [
        assignment.academic_year_id,
        assignment.section_id,
        assignment.grade_id,
        assignment.subject_id,
        todayDate,
        sourceType === "exam_timetable_entry" ? safeSourceId : null,
        schoolId,
      ]
    );

    if (examQ.rows.length) {
      const exam = examQ.rows[0];
const mapped = mapExamTypeToContext(exam.exam_type, exam.sequence_no, null, gradingPolicy);
if (mapped && !mapped.max_score) {
  return {
    matched: true,
    source_type: "exam_timetable_entry",
    source_id: Number(exam.source_id),
    type: mapped.legacy_type,
    legacy_type: mapped.legacy_type,
    canonical_type: mapped.canonical_type,
    exam_kind: mapped.exam_kind,
    sequence_no: mapped.sequence_no,
    title: mapped.exam_kind === "midterm" ? "اختبار نصفي" : "اختبار نهائي",
    mode: "in_class",
    max_score: null,
    exam_date: String(exam.exam_date).slice(0, 10),
    availability: "missing_score",
    can_grade: false,
    can_create_assessment: false,
    message: missingScoreMessage(mapped.exam_kind),
  };
}
      if (mapped) {
        const title =
          mapped.exam_kind === "midterm"
            ? "اختبار نصفي"
            : mapped.exam_kind === "final"
              ? "اختبار نهائي"
              : "اختبار رسمي";

      const payload = buildOfficialPayload({
  sourceType: "exam_timetable_entry",
  exam,
  mapped,
  title,
  nowTime,
});

if (payload.availability === "upcoming") {
  return null;
}

return payload;
      }
    }
  }

  return null;
}

async function findExistingAssessmentForClassification(db, schoolId, teacherAssignmentId, classification) {
  if (classification.canonical_type === "exam") {
    const { rows } = await db.query(
      `
      SELECT id, created_at
      FROM assessments
      WHERE school_id = $1
        AND teacher_assignment_id = $2
        AND type = 'exam'
        AND exam_kind = $3
        AND (
          ($3 = 'monthly' AND sequence_no = $4)
          OR
          ($3 <> 'monthly' AND sequence_no IS NULL)
        )
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [schoolId, teacherAssignmentId, classification.exam_kind, classification.sequence_no]
    );

    return rows[0] || null;
  }

  if (classification.canonical_type === "aggregate") {
    const { rows } = await db.query(
      `
      SELECT id, created_at
      FROM assessments
      WHERE school_id = $1
        AND teacher_assignment_id = $2
        AND type = 'aggregate'
        AND aggregate_kind = $3
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [schoolId, teacherAssignmentId, classification.aggregate_kind]
    );

    return rows[0] || null;
  }

  return null;
}

export async function listAssessments(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح." });

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(403).json({ message: "حساب المعلم غير موجود." });

    const teacherAssignmentId = Number(req.query.teacher_assignment_id);
    const status = String(req.query.status || "all").trim();
    const typeFilter = String(req.query.type || "all").trim();
    const q = String(req.query.q || "").trim();

    if (!teacherAssignmentId) {
      return res.status(400).json({ message: "teacher_assignment_id مطلوب." });
    }

    await assertOwnAssignment(teacherId, teacherAssignmentId, schoolId);

    const params = [teacherAssignmentId, schoolId];
    const where = [`a.teacher_assignment_id = $1`, `a.school_id = $2`];
    let idx = 3;

    if (status !== "all") {
      params.push(status);
      where.push(`a.status = $${idx++}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`(a.title ILIKE $${idx} OR COALESCE(a.description, '') ILIKE $${idx})`);
      idx += 1;
    }

    const { rows } = await pool.query(
      `
      SELECT
        a.id,
        a.teacher_assignment_id,
        ta.term,
        a.type,
        a.exam_kind,
        a.aggregate_kind,
        a.sequence_no,
        a.is_system_generated,
        a.title_short,
        a.mode,
        a.status,
        a.title,
        a.description,
        a.max_score,
        a.starts_at,
        a.due_at,
        a.duration_minutes,
        a.late_policy_json,
        a.published_at,
        a.closed_at,
        a.created_at,
        a.updated_at,
        ay.name AS academic_year_name,
        st.name AS stage_name,
        COALESCE(g.grade_name, g.name) AS grade_name,
        s.name AS section_name,
        subj.name AS subject_name,
        (
          SELECT COUNT(*)
          FROM student_enrollments se
          WHERE se.academic_year_id = ta.academic_year_id
            AND se.term = ta.term
            AND se.school_id = a.school_id
            AND (se.section_id = ta.section_id OR (ta.section_id IS NULL AND se.grade_id = ta.grade_id))
            AND COALESCE(se.status, 'enrolled') = 'enrolled'
        )::int AS students_count,
        (
          SELECT COUNT(*)
          FROM submissions sub
          WHERE sub.assessment_id = a.id
        )::int AS submissions_count
      FROM assessments a
      JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
      LEFT JOIN academic_years ay ON ay.id = ta.academic_year_id
      LEFT JOIN stages st ON st.id = ta.stage_id
      LEFT JOIN grades g ON g.id = ta.grade_id
      LEFT JOIN sections s ON s.id = ta.section_id
      LEFT JOIN subjects subj ON subj.id = ta.subject_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at DESC
      LIMIT 300
      `,
      params
    );

    let items = rows.map((r) => ({
      ...r,
      canonical_type: r.type,
      type: toLegacyAssessmentType(r),
      scope_label: [
        r.stage_name,
        r.grade_name,
        r.section_name ? `شعبة: ${r.section_name}` : null,
        r.subject_name ? `مادة: ${r.subject_name}` : null,
      ]
        .filter(Boolean)
        .join(" • "),
    }));

    if (typeFilter !== "all") {
      items = items.filter((item) => {
        if (typeFilter === "exam") return item.canonical_type === "exam";
        if (typeFilter === "aggregate") return item.canonical_type === "aggregate";
        return item.type === typeFilter || item.canonical_type === typeFilter;
      });
    }

    return res.json({ items });
  } catch (e) {
    console.error("listAssessments error:", e);
    return res.status(e.status || 500).json({ message: e.message || "خطأ في السيرفر" });
  }
}

export async function createAssessment(req, res) {
  const client = await pool.connect();

  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح." });

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(403).json({ message: "حساب المعلم غير موجود." });

    const teacherAssignmentId = Number(req.body.teacher_assignment_id);
    let title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    let startsAt = req.body.starts_at || null;
    let dueAt = req.body.due_at || null;
let maxScore =
  req.body.max_score === undefined || req.body.max_score === null || req.body.max_score === ""
    ? null
    : Number(req.body.max_score);    const durationMinutes = req.body.duration_minutes ? Number(req.body.duration_minutes) : null;
    const sourceType = String(req.body.source_type || "").trim();
    const sourceId = Number(req.body.source_id);
    const hasOfficialSource =
      ["timetable_override", "exam_timetable_entry"].includes(sourceType) &&
      Number.isFinite(sourceId) &&
      sourceId > 0;

    if (!teacherAssignmentId) throw badRequest("teacher_assignment_id مطلوب.");
    if (!title) throw badRequest("عنوان التقييم مطلوب.");
    // if (!Number.isFinite(maxScore) || maxScore <= 0) throw badRequest("max_score غير صحيح.");

    const classification = parseAssessmentClassification(req.body);
    let mode = normalizeMode(req.body.mode);

    if (classification.canonical_type === "classwork" || classification.canonical_type === "exam") {
      mode = "in_class";
    }

    if (classification.force_mode) {
      mode = classification.force_mode;
    }

    if (!["in_class", "home_submission", "home_no_submission", "live_online"].includes(mode)) {
      throw badRequest("mode غير صحيح.");
    }

    await client.query("BEGIN");
   const assignment = await assertOwnAssignment(teacherId, teacherAssignmentId, schoolId, client);
const gradingPolicy = await getSchoolGradingPolicy(client, schoolId);
let initialStatus = "draft";

if (classification.canonical_type === "aggregate") {
  maxScore = getAggregateMaxScoreFromPolicy(gradingPolicy, classification.aggregate_kind);

  if (!maxScore) {
    const key =
      classification.aggregate_kind === "midterm"
        ? "midterm_muhassala"
        : "final_muhassala";

    throw badRequest(missingScoreMessage(key));
  }

  classification.is_system_generated = true;
}
    if (hasOfficialSource) {
      const officialContext = await findTodayOfficialAssessmentContext({
        schoolId,
        teacherId,
        assignment,
        sourceType,
        sourceId,
        db: client,
      });

      if (!officialContext) {
        throw badRequest("لا يوجد اختبار رسمي لهذا النطاق في يومه المحدد.");
      }

      if (!officialContext.can_grade) {
        throw badRequest(officialContext.message || "لا يمكن فتح رصد الدرجات قبل انتهاء وقت الاختبار الرسمي.");
      }
if (!positiveNumber(officialContext.max_score)) {
  throw badRequest(officialContext.message || missingScoreMessage(officialContext.exam_kind));
}
      classification.canonical_type = officialContext.canonical_type;
      classification.exam_kind = officialContext.exam_kind;
      classification.aggregate_kind = null;
      classification.sequence_no = officialContext.sequence_no;
      classification.is_system_generated = true;
      mode = "in_class";
      title = title || officialContext.title;
      startsAt = officialContext.starts_at;
      dueAt = officialContext.due_at;
      maxScore = officialContext.max_score;
      initialStatus = "published";
    }
if (!Number.isFinite(Number(maxScore)) || Number(maxScore) <= 0) {
  throw badRequest("درجة التقييم غير صحيحة.");
}
    const assessmentRes = await client.query(
      `
      INSERT INTO assessments (
        school_id,
        teacher_assignment_id,
        type,
        exam_kind,
        aggregate_kind,
        sequence_no,
        is_system_generated,
        mode,
        status,
        title,
        title_short,
        description,
        max_score,
        starts_at,
        due_at,
        duration_minutes,
        late_policy_json,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id, created_at
      `,
      [
        schoolId,
        teacherAssignmentId,
        classification.canonical_type,
        classification.exam_kind,
        classification.aggregate_kind,
        classification.sequence_no,
        classification.is_system_generated,
        mode,
        initialStatus,
        title,
        title,
        description || null,
        maxScore,
        startsAt,
        dueAt,
        durationMinutes,
        JSON.stringify(buildLatePolicy(req.body)),
      ]
    );

    let assessmentId = assessmentRes.rows[0]?.id;
    let createdAt = assessmentRes.rows[0]?.created_at;

    if (!assessmentId) {
      const existingAssessment = await findExistingAssessmentForClassification(
        client,
        schoolId,
        teacherAssignmentId,
        classification
      );

      if (!existingAssessment) {
        throw badRequest("التقييم موجود مسبقًا أو تعذر إنشاؤه.");
      }

      await client.query("COMMIT");

      return res.status(200).json({
        id: existingAssessment.id,
        created_at: existingAssessment.created_at,
        message: "التقييم موجود مسبقًا، تم استخدامه بدل إنشاء نسخة مكررة.",
        canonical_type: classification.canonical_type,
        exam_kind: classification.exam_kind,
        aggregate_kind: classification.aggregate_kind,
        sequence_no: classification.sequence_no,
        reused: true,
      });
    }

    if (initialStatus === "published") {
      await client.query(
        `
        UPDATE assessments
        SET published_at = COALESCE(published_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
        `,
        [assessmentId, schoolId]
      );
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await client.query(
          `
          INSERT INTO assessment_attachments
            (assessment_id, file_url, file_name, file_type, file_size, created_at)
          VALUES
            ($1, $2, $3, $4, $5, NOW())
          `,
          [
            assessmentId,
            `/uploads/assessments/${file.filename}`,
            file.originalname,
            file.mimetype,
            file.size,
          ]
        );
      }
    }

    await client.query("COMMIT");

    return res.status(201).json({
      id: assessmentId,
      created_at: createdAt,
      message: "تم إنشاء التقييم مع المرفقات بنجاح",
      canonical_type: classification.canonical_type,
      exam_kind: classification.exam_kind,
      aggregate_kind: classification.aggregate_kind,
      sequence_no: classification.sequence_no,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("createAssessment error:", e);
    return res.status(e.status || 500).json({ message: e.message || "خطأ في السيرفر" });
  } finally {
    client.release();
  }
}

export async function publishAssessment(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح." });

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(403).json({ message: "حساب المعلم غير موجود." });

    const assessmentId = Number(req.params.id);
    if (!assessmentId) throw badRequest("id غير صحيح.");

    const assessment = await assertOwnAssessment(teacherId, assessmentId, schoolId);

    if (assessment.status === "closed") {
      throw badRequest("لا يمكن نشر تقييم مغلق.");
    }

    if (assessment.status === "published") {
      throw badRequest("تم نشر هذا التقييم بالفعل.");
    }

    if (assessment.status === "scheduled") {
      throw badRequest("هذا تقييم رسمي مجدول ولا يتم نشره يدويًا من هنا.");
    }

    await pool.query(
      `
      UPDATE assessments
      SET status = 'published',
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      `,
      [assessmentId, schoolId]
    );

    try {
      await WorkflowNotifications.notifyAssessmentPublished({
        app: req.app,
        schoolId,
        assessmentId,
      });
    } catch (notifyErr) {
      console.error("Notification error (assessment published):", notifyErr);
    }

    return res.status(204).send();
  } catch (e) {
    console.error("publishAssessment error:", e);
    return res.status(e.status || 500).json({ message: e.message || "خطأ في السيرفر" });
  }
}

export async function closeAssessment(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح." });

    const teacherId = await getTeacherIdByUserId(userId, schoolId);
    if (!teacherId) return res.status(403).json({ message: "حساب المعلم غير موجود." });

    const assessmentId = Number(req.params.id);
    if (!assessmentId) throw badRequest("id غير صحيح.");

    const assessment = await assertOwnAssessment(teacherId, assessmentId, schoolId);

    if (assessment.status !== "published") {
      throw badRequest("لا يمكن إغلاق التقييم إلا بعد نشره.");
    }

    await pool.query(
      `
      UPDATE assessments
      SET status = 'closed',
          closed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND school_id = $2
      `,
      [assessmentId, schoolId]
    );

    return res.status(204).send();
  } catch (e) {
    console.error("closeAssessment error:", e);
    return res.status(e.status || 500).json({ message: e.message || "خطأ في السيرفر" });
  }
}

export async function getOfficialAssessmentContext(req, res) {
  try {
    const userId = pickUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ matched: false });
    }

    const teacherId = await getTeacherIdByUserId(userId, schoolId);

    if (!teacherId) {
      return res.status(403).json({ matched: false });
    }

    const teacherAssignmentId = Number(req.query.teacher_assignment_id);
    const term = Number(req.query.term);

    if (!teacherAssignmentId || !term) {
      return res.json({ matched: false });
    }

    const assignment = await assertOwnAssignment(
      teacherId,
      teacherAssignmentId,
      schoolId
    );

    if (Number(assignment.term) !== term) {
      return res.json({ matched: false });
    }

    const context = await findTodayOfficialAssessmentContext({
      schoolId,
      teacherId,
      assignment,
    });

    if (!context) {
      return res.json({ matched: false });
    }

    return res.json(context);
  } catch (e) {
    console.error("getOfficialAssessmentContext error:", e);
    return res.status(500).json({ matched: false });
  }
}
