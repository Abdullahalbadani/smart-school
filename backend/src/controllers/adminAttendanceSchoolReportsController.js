import { pool } from "../config/db.js";
import {
  getSchoolReportLayout,
  htmlToPdfBuffer,
  renderSchoolReportHtml,
  reportDateOnly,
  resolveSchoolLogoDataUrl,
  safeFilePart,
} from "../services/reports/schoolReportService.js";

const STUDENT_COLUMNS = {
  student_name: { key: "student_name", label: "اسم الطالب" },
  student_code: { key: "student_code", label: "الكود" },
  grade_section: { key: "grade_section", label: "الصف / الشعبة" },
  total_sessions: { key: "total_sessions", label: "إجمالي الحصص" },
  present_count: { key: "present_count", label: "حاضر" },
  total_absent: { key: "total_absent", label: "غياب" },
  total_late: { key: "total_late", label: "تأخير" },
  total_excused: { key: "total_excused", label: "بعذر" },
  late_minutes_total: { key: "late_minutes_total", label: "دقائق التأخير" },
  attendance_percent: { key: "attendance_percent_label", label: "نسبة الحضور" },
};

const TEACHER_COLUMNS = {
  teacher_name: { key: "teacher_name", label: "اسم المعلم" },
  total_days: { key: "total_days", label: "إجمالي الأيام" },
  present_days: { key: "present_days", label: "حاضر" },
  total_absent: { key: "total_absent", label: "غائب" },
  late_days: { key: "late_days", label: "متأخر" },
  method: { key: "method_label", label: "طريقة التسجيل" },
  presence_percent: { key: "presence_percent_label", label: "نسبة الالتزام" },
};

const STUDENT_PRESETS = {
  short: [
    "student_name",
    "student_code",
    "grade_section",
    "total_sessions",
    "present_count",
    "total_absent",
    "total_late",
    "total_excused",
    "attendance_percent",
  ],
  detailed: [
    "student_name",
    "student_code",
    "grade_section",
    "total_sessions",
    "present_count",
    "total_absent",
    "total_late",
    "total_excused",
    "late_minutes_total",
    "attendance_percent",
  ],
};

const TEACHER_PRESETS = {
  short: [
    "teacher_name",
    "total_days",
    "present_days",
    "total_absent",
    "late_days",
    "presence_percent",
  ],
  detailed: [
    "teacher_name",
    "total_days",
    "present_days",
    "total_absent",
    "late_days",
    "method",
    "presence_percent",
  ],
};

const STUDENT_SORTS = new Map([
  ["name_asc", "student_name ASC"],
  ["absent_desc", "total_absent DESC, student_name ASC"],
  ["late_desc", "total_late DESC, student_name ASC"],
  ["pct_asc", "attendance_percent ASC, student_name ASC"],
  ["total_desc", "total_sessions DESC, student_name ASC"],
]);

const TEACHER_SORTS = new Map([
  ["name_asc", "teacher_name ASC"],
  ["absent_desc", "total_absent DESC, teacher_name ASC"],
  ["late_desc", "late_days DESC, teacher_name ASC"],
  ["pct_asc", "presence_percent ASC, teacher_name ASC"],
  ["total_desc", "total_days DESC, teacher_name ASC"],
]);

function getSchoolId(req) {
  return Number(req.user?.school_id || req.user?.school?.id || 0) || null;
}

function toInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeMethod(value) {
  const method = String(value || "").trim();
  return method === "scan" || method === "manual" ? method : "";
}

function normalizeMonth(value) {
  const month = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : "";
}

function monthToRange(month) {
  const normalized = normalizeMonth(month);
  if (!normalized) return { from: "", to: "" };

  const [year, monthNumber] = normalized.split("-").map(Number);
  const end = new Date(year, monthNumber, 0);
  const pad = (value) => String(value).padStart(2, "0");

  return {
    from: `${year}-${pad(monthNumber)}-01`,
    to: `${year}-${pad(monthNumber)}-${pad(end.getDate())}`,
  };
}

function normalizeColumns(payload, definitions, presets) {
  const preset = String(payload?.preset || "short").trim();
  const requested = preset === "manual" ? payload?.columns : presets[preset] || presets.short;
  const keys = [
    ...new Set(
      (Array.isArray(requested) ? requested : [])
        .map((item) => String(item || "").trim())
        .filter((item) => definitions[item])
    ),
  ];

  return keys.length ? keys : presets.short;
}

function normalizeStudentPayload(body = {}) {
  return {
    columns: normalizeColumns(body, STUDENT_COLUMNS, STUDENT_PRESETS),
    year_id: toInt(body.year_id),
    term_id: toInt(body.term_id),
    stage_id: toInt(body.stage_id),
    grade_id: toInt(body.grade_id),
    section_id: toInt(body.section_id),
    from: normalizeDate(body.from),
    to: normalizeDate(body.to),
    method: normalizeMethod(body.method),
    sort: STUDENT_SORTS.has(String(body.sort || "")) ? String(body.sort) : "name_asc",
  };
}

function normalizeTeacherPayload(body = {}) {
  const monthRange = monthToRange(body.month);
  return {
    columns: normalizeColumns(body, TEACHER_COLUMNS, TEACHER_PRESETS),
    year_id: toInt(body.year_id),
    teacher_id: toInt(body.teacher_id),
    month: normalizeMonth(body.month),
    from: normalizeDate(body.from) || monthRange.from,
    to: normalizeDate(body.to) || monthRange.to,
    method: normalizeMethod(body.method),
    sort: TEACHER_SORTS.has(String(body.sort || "")) ? String(body.sort) : "name_asc",
  };
}

async function getSchool(schoolId) {
  const { rows } = await pool.query(
    `SELECT id, name_ar, name_en, phone, email, address, logo_url FROM schools WHERE id = $1 LIMIT 1`,
    [schoolId]
  );

  const school = rows[0];
  if (!school) {
    throw Object.assign(new Error("تعذر العثور على بيانات المدرسة."), { status: 404 });
  }

  return {
    id: school.id,
    nameAr: school.name_ar || "المدرسة",
    nameEn: school.name_en || "",
    phone: school.phone || "",
    email: school.email || "",
    address: school.address || "",
    logoDataUrl: await resolveSchoolLogoDataUrl(school.logo_url),
  };
}

async function getAcademicYear(schoolId, requestedYearId) {
  if (requestedYearId) {
    const { rows } = await pool.query(
      `SELECT id, name, start_date, end_date FROM academic_years WHERE id = $1 AND school_id = $2 LIMIT 1`,
      [requestedYearId, schoolId]
    );

    if (!rows[0]) {
      throw Object.assign(new Error("تعذر العثور على السنة الدراسية المحددة."), { status: 400 });
    }

    return rows[0];
  }

  const { rows } = await pool.query(
    `
      SELECT id, name, start_date, end_date
      FROM academic_years
      WHERE school_id = $1 AND is_active = TRUE
      ORDER BY id DESC
      LIMIT 1
    `,
    [schoolId]
  );

  if (!rows[0]) {
    throw Object.assign(new Error("يرجى تفعيل سنة دراسية قبل إنشاء الكشف."), { status: 400 });
  }

  return rows[0];
}

async function getStudentScopeNames(schoolId, payload) {
  const { rows } = await pool.query(
    `
      SELECT
        (SELECT name FROM stages WHERE id = $2 AND school_id = $1 LIMIT 1) AS stage_name,
        (SELECT name FROM grades WHERE id = $3 AND school_id = $1 LIMIT 1) AS grade_name,
        (SELECT name FROM sections WHERE id = $4 AND school_id = $1 LIMIT 1) AS section_name
    `,
    [schoolId, payload.stage_id, payload.grade_id, payload.section_id]
  );

  return rows[0] || {};
}

function makeMethodCondition(alias, method) {
  if (method === "scan") return `${alias}.note ILIKE '%[QR]%'`;
  if (method === "manual") return `(${alias}.note NOT ILIKE '%[QR]%' OR ${alias}.note IS NULL)`;
  return "";
}

function pushFilter(params, where, sql, value) {
  if (value === undefined || value === null || value === "") return;
  params.push(value);
  where.push(sql.replace("$VALUE", `$${params.length}`));
}

async function queryStudentsAttendance(schoolId, academicYear, payload, { countOnly = false } = {}) {
  const params = [schoolId, academicYear.id];
  const enrollmentWhere = [
    `s.school_id = $1`,
    `se.school_id = $1`,
    `se.academic_year_id = $2`,
  ];
  const sessionWhere = [
    `ses.school_id = $1`,
    `ses.academic_year_id = $2`,
  ];

  const addSharedFilter = (value, enrollmentSql, sessionSql) => {
    if (value === undefined || value === null || value === "") return;
    params.push(value);
    const placeholder = `$${params.length}`;
    enrollmentWhere.push(enrollmentSql.replace("$VALUE", placeholder));
    sessionWhere.push(sessionSql.replace("$VALUE", placeholder));
  };

  addSharedFilter(payload.term_id, `se.term = $VALUE`, `ses.term = $VALUE`);
  addSharedFilter(payload.stage_id, `se.stage_id = $VALUE`, `ses.stage_id = $VALUE`);
  addSharedFilter(payload.grade_id, `se.grade_id = $VALUE`, `ses.grade_id = $VALUE`);
  addSharedFilter(payload.section_id, `se.section_id = $VALUE`, `ses.section_id = $VALUE`);

  pushFilter(params, sessionWhere, `ses.attendance_date >= $VALUE::date`, payload.from);
  pushFilter(params, sessionWhere, `ses.attendance_date <= $VALUE::date`, payload.to);

  const methodCondition = makeMethodCondition("ae", payload.method);
  const subMethodCondition = makeMethodCondition("ae_sub", payload.method);

  if (payload.method) {
    const subSessionWhere = sessionWhere.map((condition) => condition.replaceAll("ses.", "ses_sub."));
    enrollmentWhere.push(`EXISTS (
      SELECT 1
      FROM attendance_entries ae_sub
      JOIN attendance_sessions ses_sub ON ses_sub.id = ae_sub.session_id
      WHERE ae_sub.student_id = s.id
        AND ae_sub.school_id = $1
        AND ${subSessionWhere.join(" AND ")}
        AND ${subMethodCondition}
    )`);
  }

  const selectedStudents = `
    SELECT DISTINCT ON (s.id)
      s.id AS student_id,
      s.full_name AS student_name,
      s.student_code,
      COALESCE(NULLIF(TRIM(g.name), ''), '—') AS grade_name,
      COALESCE(NULLIF(TRIM(sec.name), ''), '—') AS section_name,
      CONCAT(COALESCE(NULLIF(TRIM(g.name), ''), '—'), ' - ', COALESCE(NULLIF(TRIM(sec.name), ''), '—')) AS grade_section
    FROM students s
    JOIN student_enrollments se ON se.student_id = s.id
    LEFT JOIN grades g ON g.id = se.grade_id
    LEFT JOIN sections sec ON sec.id = se.section_id
    WHERE ${enrollmentWhere.join(" AND ")}
    ORDER BY s.id, se.id DESC
  `;

  const orderSql = STUDENT_SORTS.get(payload.sort) || STUDENT_SORTS.get("name_asc");
  const { rows } = await pool.query(
    `
      WITH filtered_students AS (${selectedStudents}),
      filtered_entries AS (
        SELECT ae.student_id, ae.status, ae.late_minutes
        FROM attendance_entries ae
        JOIN attendance_sessions ses ON ses.id = ae.session_id
        WHERE ae.school_id = $1
          AND ${sessionWhere.join(" AND ")}
          ${methodCondition ? `AND ${methodCondition}` : ""}
      ),
      agg AS (
        SELECT
          student_id,
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'present')::int AS present_count,
          COUNT(*) FILTER (WHERE status = 'absent')::int AS total_absent,
          COUNT(*) FILTER (WHERE status = 'late')::int AS total_late,
          COUNT(*) FILTER (WHERE status = 'excused')::int AS total_excused,
          COALESCE(SUM(late_minutes), 0)::int AS late_minutes_total
        FROM filtered_entries
        GROUP BY student_id
      )
      SELECT
        fs.student_id,
        fs.student_name,
        fs.student_code,
        fs.grade_section,
        COALESCE(agg.total_sessions, 0) AS total_sessions,
        COALESCE(agg.present_count, 0) AS present_count,
        COALESCE(agg.total_absent, 0) AS total_absent,
        COALESCE(agg.total_late, 0) AS total_late,
        COALESCE(agg.total_excused, 0) AS total_excused,
        COALESCE(agg.late_minutes_total, 0) AS late_minutes_total,
        CASE
          WHEN COALESCE(agg.total_sessions, 0) = 0 THEN 0
          ELSE ROUND(((COALESCE(agg.present_count, 0) + COALESCE(agg.total_excused, 0))::numeric / agg.total_sessions::numeric) * 100, 2)
        END AS attendance_percent
      FROM filtered_students fs
      LEFT JOIN agg ON agg.student_id = fs.student_id
      ORDER BY ${orderSql}
    `,
    params
  );

  if (countOnly) return rows.length;

  return rows.map((row) => ({
    ...row,
    attendance_percent_label: `${row.attendance_percent ?? 0}%`,
  }));
}

async function getTeacherName(schoolId, teacherId) {
  if (!teacherId) return "";
  const { rows } = await pool.query(`SELECT full_name FROM teachers WHERE id = $1 AND school_id = $2 LIMIT 1`, [teacherId, schoolId]);
  return rows[0]?.full_name || "";
}

async function queryTeachersAttendance(schoolId, academicYear, payload, { countOnly = false } = {}) {
  const params = [schoolId, academicYear.id];
  const attendanceWhere = [
    `tad.school_id = $1`,
    `tad.academic_year_id = $2`,
  ];

  pushFilter(params, attendanceWhere, `tae.recorded_at::date >= $VALUE::date`, payload.from);
  pushFilter(params, attendanceWhere, `tae.recorded_at::date <= $VALUE::date`, payload.to);

  let methodPlaceholder = "";
  if (payload.method) {
    params.push(payload.method);
    methodPlaceholder = `$${params.length}`;
    attendanceWhere.push(`tae.method = ${methodPlaceholder}`);
  }

  const teacherWhere = [`t.school_id = $1`];
  if (payload.teacher_id) {
    params.push(payload.teacher_id);
    teacherWhere.push(`t.id = $${params.length}`);
  }

  if (payload.method) {
    const subAttendanceWhere = attendanceWhere
      .map((condition) => condition.replaceAll("tad.", "tad_sub.").replaceAll("tae.", "tae_sub."));
    teacherWhere.push(`EXISTS (
      SELECT 1
      FROM teacher_attendance_entries tae_sub
      JOIN teacher_attendance_days tad_sub ON tad_sub.id = tae_sub.day_id
      WHERE tae_sub.teacher_id = t.id
        AND ${subAttendanceWhere.join(" AND ")}
    )`);
  }

  const orderSql = TEACHER_SORTS.get(payload.sort) || TEACHER_SORTS.get("name_asc");
  const { rows } = await pool.query(
    `
      WITH filtered_entries AS (
        SELECT tae.teacher_id, tae.status, tae.method
        FROM teacher_attendance_entries tae
        JOIN teacher_attendance_days tad ON tad.id = tae.day_id
        WHERE ${attendanceWhere.join(" AND ")}
      ),
      agg AS (
        SELECT
          teacher_id,
          COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late'))::int AS total_days,
          COUNT(*) FILTER (WHERE status = 'present')::int AS present_days,
          COUNT(*) FILTER (WHERE status = 'absent')::int AS total_absent,
          COUNT(*) FILTER (WHERE status = 'late')::int AS late_days,
          COALESCE(STRING_AGG(DISTINCT NULLIF(TRIM(method), ''), '، '), '—') AS method_label
        FROM filtered_entries
        GROUP BY teacher_id
      )
      SELECT
        t.id AS teacher_id,
        t.full_name AS teacher_name,
        COALESCE(agg.total_days, 0) AS total_days,
        COALESCE(agg.present_days, 0) AS present_days,
        COALESCE(agg.total_absent, 0) AS total_absent,
        COALESCE(agg.late_days, 0) AS late_days,
        COALESCE(agg.method_label, '—') AS method_label,
        CASE
          WHEN COALESCE(agg.total_days, 0) = 0 THEN 0
          ELSE ROUND((COALESCE(agg.present_days, 0)::numeric / agg.total_days::numeric) * 100, 2)
        END AS presence_percent
      FROM teachers t
      LEFT JOIN agg ON agg.teacher_id = t.id
      WHERE ${teacherWhere.join(" AND ")}
      ORDER BY ${orderSql}
    `,
    params
  );

  if (countOnly) return rows.length;

  return rows.map((row) => ({
    ...row,
    presence_percent_label: `${row.presence_percent ?? 0}%`,
  }));
}

function getStudentTitle(scope) {
  if (scope.section_name && scope.grade_name) return `كشف حضور وغياب طلاب الصف ${scope.grade_name} — الشعبة (${scope.section_name})`;
  if (scope.grade_name) return `كشف حضور وغياب طلاب الصف ${scope.grade_name}`;
  if (scope.stage_name) return `كشف حضور وغياب طلاب المرحلة ${scope.stage_name}`;
  return "كشف حضور وغياب جميع طلاب المدرسة";
}

function getTeacherTitle(teacherName) {
  return teacherName ? `كشف حضور وغياب المعلم: ${teacherName}` : "كشف حضور وغياب معلمي المدرسة";
}

function termLabel(termId) {
  if (termId === 1) return "الترم الأول";
  if (termId === 2) return "الترم الثاني";
  return "";
}

function methodLabel(method) {
  if (method === "scan") return "بصمة / مسح";
  if (method === "manual") return "يدوي";
  return "";
}

function buildSubtitle(payload) {
  const parts = [];
  const term = termLabel(payload.term_id);
  if (term) parts.push(term);
  if (payload.from && payload.to) parts.push(`الفترة: من ${reportDateOnly(payload.from)} إلى ${reportDateOnly(payload.to)}`);
  else if (payload.from) parts.push(`الفترة: ابتداءً من ${reportDateOnly(payload.from)}`);
  else if (payload.to) parts.push(`الفترة: حتى ${reportDateOnly(payload.to)}`);
  return parts.join(" • ");
}

function buildMetaItems(payload) {
  const method = methodLabel(payload.method);
  return method ? [{ label: "طريقة التسجيل", value: method }] : [];
}

function getColumns(keys, definitions) {
  return keys.map((key) => definitions[key]);
}

async function buildStudentsReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });

  const payload = normalizeStudentPayload(req.body || {});
  const academicYear = await getAcademicYear(schoolId, payload.year_id);
  const [school, scope, rows] = await Promise.all([
    getSchool(schoolId),
    getStudentScopeNames(schoolId, payload),
    queryStudentsAttendance(schoolId, academicYear, payload),
  ]);

  return {
    school,
    academicYear,
    rows,
    title: getStudentTitle(scope),
    subtitle: buildSubtitle(payload),
    metaItems: buildMetaItems(payload),
    columns: getColumns(payload.columns, STUDENT_COLUMNS),
    countLabel: "عدد الطلاب",
    countUnit: "طالبًا",
  };
}

async function buildTeachersReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });

  const payload = normalizeTeacherPayload(req.body || {});
  const academicYear = await getAcademicYear(schoolId, payload.year_id);
  const [school, teacherName, rows] = await Promise.all([
    getSchool(schoolId),
    getTeacherName(schoolId, payload.teacher_id),
    queryTeachersAttendance(schoolId, academicYear, payload),
  ]);

  return {
    school,
    academicYear,
    rows,
    title: getTeacherTitle(teacherName),
    subtitle: buildSubtitle(payload),
    metaItems: buildMetaItems(payload),
    columns: getColumns(payload.columns, TEACHER_COLUMNS),
    countLabel: "عدد المعلمين",
    countUnit: "معلمًا",
  };
}

function sendError(res, error, label) {
  console.error(label, error);
  const status = Number(error?.status || 500);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? "تعذر إنشاء الكشف حاليًا. يرجى المحاولة مرة أخرى." : error.message,
  });
}

async function sendPdf(req, res, buildReport, fallbackName) {
  const report = await buildReport(req);
  if (!report.rows.length) {
    return res.status(404).json({ success: false, message: "لا توجد بيانات مطابقة لإعدادات الكشف." });
  }

  const layout = getSchoolReportLayout(report.columns);
  const html = renderSchoolReportHtml({ ...report, landscape: layout.landscape });
  const pdf = await htmlToPdfBuffer(html, { landscape: layout.landscape });
  const fileName = `${safeFilePart(report.title)}-${safeFilePart(report.academicYear.name)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return res.send(pdf);
}

async function sendPrint(req, res, buildReport) {
  const report = await buildReport(req);
  if (!report.rows.length) {
    return res.status(404).json({ success: false, message: "لا توجد بيانات مطابقة لإعدادات الكشف." });
  }

  const layout = getSchoolReportLayout(report.columns);
  const html = renderSchoolReportHtml({ ...report, landscape: layout.landscape, autoPrint: true });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(html);
}

async function preview(req, res, type) {
  const schoolId = getSchoolId(req);
  if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح: تعذر تحديد المدرسة." });

  if (type === "students") {
    const payload = normalizeStudentPayload(req.body || {});
    const academicYear = await getAcademicYear(schoolId, payload.year_id);
    const [scope, total] = await Promise.all([
      getStudentScopeNames(schoolId, payload),
      queryStudentsAttendance(schoolId, academicYear, payload, { countOnly: true }),
    ]);

    return res.json({ success: true, data: { total, title: getStudentTitle(scope), academic_year: academicYear.name } });
  }

  const payload = normalizeTeacherPayload(req.body || {});
  const academicYear = await getAcademicYear(schoolId, payload.year_id);
  const [teacherName, total] = await Promise.all([
    getTeacherName(schoolId, payload.teacher_id),
    queryTeachersAttendance(schoolId, academicYear, payload, { countOnly: true }),
  ]);

  return res.json({ success: true, data: { total, title: getTeacherTitle(teacherName), academic_year: academicYear.name } });
}

export async function previewStudentsAttendanceSchoolReport(req, res) {
  try {
    return await preview(req, res, "students");
  } catch (error) {
    return sendError(res, error, "previewStudentsAttendanceSchoolReport error:");
  }
}

export async function downloadStudentsAttendanceSchoolReportPdf(req, res) {
  try {
    return await sendPdf(req, res, buildStudentsReport, "students-attendance-report.pdf");
  } catch (error) {
    return sendError(res, error, "downloadStudentsAttendanceSchoolReportPdf error:");
  }
}

export async function printStudentsAttendanceSchoolReport(req, res) {
  try {
    return await sendPrint(req, res, buildStudentsReport);
  } catch (error) {
    return sendError(res, error, "printStudentsAttendanceSchoolReport error:");
  }
}

export async function previewTeachersAttendanceSchoolReport(req, res) {
  try {
    return await preview(req, res, "teachers");
  } catch (error) {
    return sendError(res, error, "previewTeachersAttendanceSchoolReport error:");
  }
}

export async function downloadTeachersAttendanceSchoolReportPdf(req, res) {
  try {
    return await sendPdf(req, res, buildTeachersReport, "teachers-attendance-report.pdf");
  } catch (error) {
    return sendError(res, error, "downloadTeachersAttendanceSchoolReportPdf error:");
  }
}

export async function printTeachersAttendanceSchoolReport(req, res) {
  try {
    return await sendPrint(req, res, buildTeachersReport);
  } catch (error) {
    return sendError(res, error, "printTeachersAttendanceSchoolReport error:");
  }
}
