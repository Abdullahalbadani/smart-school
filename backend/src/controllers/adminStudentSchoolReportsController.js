import { pool } from "../config/db.js";
import {
  htmlToPdfBuffer,
  renderSchoolReportHtml,
  reportDateOnly,
  resolveSchoolLogoDataUrl,
  safeFilePart,
} from "../services/reports/schoolReportService.js";

const ALLOWED_STATUSES = new Set(["active", "inactive", "graduated", "withdrawn", "suspended"]);

const STATUS_LABELS = {
  active: "نشط",
  inactive: "غير نشط",
  graduated: "متخرج",
  withdrawn: "منسحب",
  suspended: "موقوف",
};

const COLUMN_DEFINITIONS = {
  student_code: { key: "student_code", label: "رقم القيد" },
  full_name: { key: "full_name", label: "اسم الطالب" },
  gender: { key: "gender_label", label: "الجنس" },
  birth_date: { key: "birth_date", label: "تاريخ الميلاد", formatter: reportDateOnly },
  phone: { key: "phone", label: "هاتف الطالب" },
  stage_name: { key: "stage_name", label: "المرحلة" },
  grade_name: { key: "grade_name", label: "الصف" },
  section_name: { key: "section_name", label: "الشعبة" },
  guardian_name: { key: "guardian_name", label: "اسم ولي الأمر" },
  guardian_phone: { key: "guardian_phone", label: "هاتف ولي الأمر" },
  status: { key: "status_label", label: "الحالة" },
  admission_date: { key: "admission_date", label: "تاريخ الالتحاق", formatter: reportDateOnly },
  address: { key: "address", label: "العنوان" },
  roll_number: { key: "roll_number", label: "الرقم في الصف" },
};

const PRESETS = {
  short: ["student_code", "full_name", "grade_name", "section_name"],
  detailed: [
    "student_code",
    "full_name",
    "gender",
    "birth_date",
    "phone",
    "grade_name",
    "section_name",
    "guardian_name",
    "guardian_phone",
    "status",
    "admission_date",
    "address",
  ],
};

function getSchoolId(req) {
  return Number(req.user?.school_id || req.user?.school?.id || 0) || null;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeStatuses(value) {
  const input = Array.isArray(value) ? value : [];
  const statuses = [...new Set(input.map((item) => String(item || "").trim()).filter((item) => ALLOWED_STATUSES.has(item)))];
  return statuses.length ? statuses : ["active"];
}

function normalizeColumns(payload = {}) {
  const preset = String(payload.preset || "short").trim();
  const source = preset === "manual" ? payload.columns : PRESETS[preset] || PRESETS.short;
  const safeColumns = [...new Set((Array.isArray(source) ? source : []).map(String).filter((key) => COLUMN_DEFINITIONS[key]))];
  return safeColumns.length ? safeColumns : PRESETS.short;
}

function normalizePayload(body = {}) {
  return {
    stageId: positiveInt(body.stage_id),
    gradeId: positiveInt(body.grade_id),
    sectionId: positiveInt(body.section_id),
    statuses: normalizeStatuses(body.statuses),
    columns: normalizeColumns(body),
  };
}

async function getSchool(schoolId) {
  const { rows } = await pool.query(
    `SELECT id, name_ar, name_en, phone, email, address, logo_url FROM schools WHERE id = $1 LIMIT 1`,
    [schoolId]
  );

  const school = rows[0];
  if (!school) throw Object.assign(new Error("تعذر العثور على بيانات المدرسة."), { status: 404 });

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

async function getActiveAcademicYear(schoolId) {
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

async function getScope(schoolId, payload) {
  if (payload.sectionId) {
    const { rows } = await pool.query(
      `
        SELECT sec.id AS section_id, sec.name AS section_name,
               gr.id AS grade_id, gr.name AS grade_name,
               st.id AS stage_id, st.name AS stage_name
        FROM sections sec
        JOIN grades gr ON gr.id = sec.grade_id AND gr.school_id = $1
        JOIN stages st ON st.id = gr.stage_id AND st.school_id = $1
        WHERE sec.id = $2 AND sec.school_id = $1
        LIMIT 1
      `,
      [schoolId, payload.sectionId]
    );
    if (!rows[0]) throw Object.assign(new Error("الشعبة المحددة غير موجودة داخل المدرسة."), { status: 400 });
    return rows[0];
  }

  if (payload.gradeId) {
    const { rows } = await pool.query(
      `
        SELECT NULL::int AS section_id, NULL::text AS section_name,
               gr.id AS grade_id, gr.name AS grade_name,
               st.id AS stage_id, st.name AS stage_name
        FROM grades gr
        JOIN stages st ON st.id = gr.stage_id AND st.school_id = $1
        WHERE gr.id = $2 AND gr.school_id = $1
        LIMIT 1
      `,
      [schoolId, payload.gradeId]
    );
    if (!rows[0]) throw Object.assign(new Error("الصف المحدد غير موجود داخل المدرسة."), { status: 400 });
    return rows[0];
  }

  if (payload.stageId) {
    const { rows } = await pool.query(
      `
        SELECT NULL::int AS section_id, NULL::text AS section_name,
               NULL::int AS grade_id, NULL::text AS grade_name,
               st.id AS stage_id, st.name AS stage_name
        FROM stages st
        WHERE st.id = $2 AND st.school_id = $1
        LIMIT 1
      `,
      [schoolId, payload.stageId]
    );
    if (!rows[0]) throw Object.assign(new Error("المرحلة المحددة غير موجودة داخل المدرسة."), { status: 400 });
    return rows[0];
  }

  return {
    section_id: null,
    section_name: null,
    grade_id: null,
    grade_name: null,
    stage_id: null,
    stage_name: null,
  };
}

function scopeFilters(payload, scope) {
  return {
    stageId: scope.stage_id || payload.stageId || null,
    gradeId: scope.grade_id || payload.gradeId || null,
    sectionId: scope.section_id || payload.sectionId || null,
  };
}

async function queryStudents(schoolId, academicYearId, filters, statuses, { countOnly = false } = {}) {
  const selectSql = countOnly
    ? `COUNT(*)::int AS total`
    : `
        s.student_code,
        s.full_name,
        CASE WHEN s.gender = 'male' THEN 'ذكر' WHEN s.gender = 'female' THEN 'أنثى' ELSE COALESCE(s.gender, '—') END AS gender_label,
        s.birth_date,
        s.phone,
        s.address,
        s.admission_date,
        s.status,
        CASE s.status
          WHEN 'active' THEN 'نشط'
          WHEN 'inactive' THEN 'غير نشط'
          WHEN 'graduated' THEN 'متخرج'
          WHEN 'withdrawn' THEN 'منسحب'
          WHEN 'suspended' THEN 'موقوف'
          ELSE COALESCE(s.status, '—')
        END AS status_label,
        se.roll_number,
        st.name AS stage_name,
        gr.name AS grade_name,
        sec.name AS section_name,
        guardian.full_name AS guardian_name,
        guardian.phone AS guardian_phone
      `;

  const orderSql = countOnly ? "" : `ORDER BY se.roll_number NULLS LAST, s.full_name ASC, s.id ASC`;

  const { rows } = await pool.query(
    `
      SELECT ${selectSql}
      FROM students s
      JOIN LATERAL (
        SELECT enrollment.*
        FROM student_enrollments enrollment
        WHERE enrollment.student_id = s.id
          AND enrollment.school_id = $1
          AND enrollment.academic_year_id = $2
        ORDER BY enrollment.created_at DESC NULLS LAST, enrollment.id DESC
        LIMIT 1
      ) se ON TRUE
      LEFT JOIN stages st ON st.id = se.stage_id AND st.school_id = $1
      LEFT JOIN grades gr ON gr.id = se.grade_id AND gr.school_id = $1
      LEFT JOIN sections sec ON sec.id = se.section_id AND sec.school_id = $1
      LEFT JOIN LATERAL (
        SELECT g.full_name, g.phone
        FROM student_guardians sg
        JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $1
        WHERE sg.school_id = $1 AND sg.student_id = s.id
        ORDER BY sg.is_primary DESC NULLS LAST, sg.id DESC
        LIMIT 1
      ) guardian ON TRUE
      WHERE s.school_id = $1
        AND ($3::int IS NULL OR se.stage_id = $3)
        AND ($4::int IS NULL OR se.grade_id = $4)
        AND ($5::int IS NULL OR se.section_id = $5)
        AND s.status = ANY($6::text[])
      ${orderSql}
    `,
    [schoolId, academicYearId, filters.stageId, filters.gradeId, filters.sectionId, statuses]
  );

  return countOnly ? Number(rows[0]?.total || 0) : rows;
}

function getTitle(scope) {
  if (scope.section_name && scope.grade_name) return `كشف طلاب الصف ${scope.grade_name} — الشعبة (${scope.section_name})`;
  if (scope.grade_name) return `كشف طلاب الصف ${scope.grade_name}`;
  if (scope.stage_name) return `كشف طلاب المرحلة ${scope.stage_name}`;
  return "كشف جميع طلاب المدرسة";
}

function getStatusesLabel(statuses) {
  if (statuses.length === 1 && statuses[0] === "active") return "";
  if (statuses.length === ALLOWED_STATUSES.size) return "الحالات المدرجة: جميع حالات الطلاب";
  return `الحالات المدرجة: ${statuses.map((status) => STATUS_LABELS[status] || status).join("، ")}`;
}

function getColumns(columnKeys) {
  return columnKeys.map((key) => COLUMN_DEFINITIONS[key]);
}

function getMetaItems(scope) {
  return [
    scope.stage_name ? { label: "المرحلة", value: scope.stage_name } : null,
    scope.grade_name ? { label: "الصف", value: scope.grade_name } : null,
    scope.section_name ? { label: "الشعبة", value: scope.section_name } : null,
  ].filter(Boolean);
}

async function buildReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });

  const payload = normalizePayload(req.body || {});
  const [school, academicYear, scope] = await Promise.all([
    getSchool(schoolId),
    getActiveAcademicYear(schoolId),
    getScope(schoolId, payload),
  ]);
  const filters = scopeFilters(payload, scope);
  const rows = await queryStudents(schoolId, academicYear.id, filters, payload.statuses);
  const title = getTitle(scope);

  return {
    school,
    academicYear,
    scope,
    rows,
    title,
    columns: getColumns(payload.columns),
    statusesLabel: getStatusesLabel(payload.statuses),
    metaItems: getMetaItems(scope),
  };
}

function sendError(res, error, fallback) {
  console.error(fallback, error);
  const status = Number(error?.status || 500);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? "تعذر إنشاء الكشف حاليًا. يرجى المحاولة مرة أخرى." : error.message,
  });
}

export async function previewStudentSchoolReport(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح: تعذر تحديد المدرسة." });

    const payload = normalizePayload(req.body || {});
    const [academicYear, scope] = await Promise.all([
      getActiveAcademicYear(schoolId),
      getScope(schoolId, payload),
    ]);
    const filters = scopeFilters(payload, scope);
    const total = await queryStudents(schoolId, academicYear.id, filters, payload.statuses, { countOnly: true });

    return res.json({
      success: true,
      data: {
        total,
        title: getTitle(scope),
        academic_year: academicYear.name,
        statuses_label: getStatusesLabel(payload.statuses),
      },
    });
  } catch (error) {
    return sendError(res, error, "previewStudentSchoolReport error:");
  }
}

export async function downloadStudentSchoolReportPdf(req, res) {
  try {
    const report = await buildReport(req);
    if (!report.rows.length) return res.status(404).json({ success: false, message: "لا يوجد طلاب مطابقون لإعدادات الكشف." });

    const html = renderSchoolReportHtml(report);
    const pdf = await htmlToPdfBuffer(html, { landscape: true });
    const fileName = `${safeFilePart(report.title)}-${safeFilePart(report.academicYear.name)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="students-report.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(pdf);
  } catch (error) {
    return sendError(res, error, "downloadStudentSchoolReportPdf error:");
  }
}

export async function printStudentSchoolReport(req, res) {
  try {
    const report = await buildReport(req);
    if (!report.rows.length) return res.status(404).json({ success: false, message: "لا يوجد طلاب مطابقون لإعدادات الكشف." });

    const html = renderSchoolReportHtml({ ...report, autoPrint: true });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    return sendError(res, error, "printStudentSchoolReport error:");
  }
}
