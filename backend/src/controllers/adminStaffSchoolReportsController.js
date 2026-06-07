import { pool } from "../config/db.js";
import {
  getSchoolReportLayout,
  htmlToPdfBuffer,
  renderSchoolReportHtml,
  resolveSchoolLogoDataUrl,
  safeFilePart,
} from "../services/reports/schoolReportService.js";

const ALLOWED_SCOPES = new Set(["teachers", "employees", "all"]);
const ALLOWED_STATUSES = new Set(["active", "inactive"]);

const STATUS_LABELS = {
  active: "نشط",
  inactive: "موقوف",
};

const COLUMN_DEFINITIONS = {
  full_name: { key: "full_name", label: "الاسم" },
  phone: { key: "phone", label: "رقم الجوال" },
  job_title: { key: "job_title", label: "المسمى الوظيفي" },
  staff_type: { key: "type_label", label: "النوع" },
  account_status: { key: "account_status_label", label: "حالة الحساب" },
  username: { key: "username", label: "اسم المستخدم" },
  email: { key: "email", label: "البريد الإلكتروني" },
  roles: { key: "roles_names", label: "الأدوار" },
  status: { key: "status_label", label: "الحالة" },
  notes: { key: "notes", label: "ملاحظات" },
};

const PRESETS = {
  short: ["full_name", "phone", "job_title", "status"],
  detailed: [
    "full_name",
    "phone",
    "job_title",
    "staff_type",
    "account_status",
    "username",
    "email",
    "roles",
    "status",
    "notes",
  ],
};

function getSchoolId(req) {
  return Number(req.user?.school_id || req.user?.school?.id || 0) || null;
}

function normalizeScope(value) {
  const scope = String(value || "teachers").trim();
  return ALLOWED_SCOPES.has(scope) ? scope : "teachers";
}

function normalizeStatuses(value) {
  const input = Array.isArray(value) ? value : [];
  const statuses = [
    ...new Set(
      input
        .map((item) => String(item || "").trim())
        .filter((item) => ALLOWED_STATUSES.has(item))
    ),
  ];

  return statuses.length ? statuses : ["active"];
}

function normalizeColumns(payload = {}) {
  const preset = String(payload.preset || "short").trim();
  const source = preset === "manual" ? payload.columns : PRESETS[preset] || PRESETS.short;
  const safeColumns = [
    ...new Set(
      (Array.isArray(source) ? source : [])
        .map(String)
        .filter((key) => COLUMN_DEFINITIONS[key])
    ),
  ];

  return safeColumns.length ? safeColumns : PRESETS.short;
}

function normalizePayload(body = {}) {
  return {
    scope: normalizeScope(body.scope),
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

async function queryStaff(schoolId, scope, statuses, { countOnly = false } = {}) {
  const selectSql = countOnly
    ? `COUNT(*)::int AS total`
    : `
        e.id,
        e.full_name,
        e.phone,
        COALESCE(NULLIF(TRIM(e.job_title), ''), '—') AS job_title,
        COALESCE(NULLIF(TRIM(e.notes), ''), '—') AS notes,
        e.is_teacher,
        e.is_active,
        CASE WHEN e.is_teacher THEN 'معلم' ELSE 'موظف' END AS type_label,
        CASE WHEN e.user_id IS NULL THEN 'بدون حساب' ELSE 'مربوط' END AS account_status_label,
        COALESCE(NULLIF(TRIM(u.username), ''), '—') AS username,
        COALESCE(NULLIF(TRIM(u.email), ''), '—') AS email,
        COALESCE(NULLIF(TRIM(role_summary.roles_names), ''), '—') AS roles_names,
        CASE WHEN e.is_active THEN 'نشط' ELSE 'موقوف' END AS status_label
      `;

  const orderSql = countOnly ? "" : `ORDER BY e.is_teacher DESC, e.full_name ASC, e.id ASC`;

  const { rows } = await pool.query(
    `
      WITH role_summary AS (
        SELECT
          ur.user_id,
          STRING_AGG(DISTINCT r.name, '، ' ORDER BY r.name) AS roles_names
        FROM user_roles ur
        JOIN roles r
          ON r.id = ur.role_id
         AND r.school_id = $1
        WHERE ur.school_id = $1
        GROUP BY ur.user_id
      )
      SELECT ${selectSql}
      FROM employees e
      LEFT JOIN users u
        ON u.id = e.user_id
       AND u.school_id = e.school_id
      LEFT JOIN role_summary
        ON role_summary.user_id = e.user_id
      WHERE e.school_id = $1
        AND (
          $2::text = 'all'
          OR ($2::text = 'teachers' AND e.is_teacher = TRUE)
          OR ($2::text = 'employees' AND e.is_teacher = FALSE)
        )
        AND (CASE WHEN e.is_active THEN 'active' ELSE 'inactive' END) = ANY($3::text[])
      ${orderSql}
    `,
    [schoolId, scope, statuses]
  );

  return countOnly ? Number(rows[0]?.total || 0) : rows;
}

function getTitle(scope) {
  if (scope === "teachers") return "كشف معلمي المدرسة";
  if (scope === "employees") return "كشف موظفي المدرسة";
  return "كشف العاملين بالمدرسة";
}

function getStatusesLabel(statuses) {
  if (statuses.length === 1 && statuses[0] === "active") return "";
  if (statuses.length === ALLOWED_STATUSES.size) return "الحالات المدرجة: جميع الحالات";
  return `الحالات المدرجة: ${statuses.map((status) => STATUS_LABELS[status] || status).join("، ")}`;
}

function getColumns(columnKeys) {
  return columnKeys.map((key) => COLUMN_DEFINITIONS[key]);
}

function getCountMeta(scope) {
  if (scope === "teachers") return { countLabel: "عدد المعلمين", countUnit: "معلمًا" };
  if (scope === "employees") return { countLabel: "عدد الموظفين", countUnit: "موظفًا" };
  return { countLabel: "عدد العاملين", countUnit: "فردًا" };
}

function getMetaItems(scope) {
  if (scope === "teachers") return [{ label: "الفئة", value: "المعلمون" }];
  if (scope === "employees") return [{ label: "الفئة", value: "الموظفون" }];
  return [{ label: "الفئة", value: "جميع العاملين" }];
}

async function buildReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) {
    throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });
  }

  const payload = normalizePayload(req.body || {});
  const [school, academicYear, rows] = await Promise.all([
    getSchool(schoolId),
    getActiveAcademicYear(schoolId),
    queryStaff(schoolId, payload.scope, payload.statuses),
  ]);

  return {
    school,
    academicYear,
    rows,
    title: getTitle(payload.scope),
    columns: getColumns(payload.columns),
    statusesLabel: getStatusesLabel(payload.statuses),
    metaItems: getMetaItems(payload.scope),
    ...getCountMeta(payload.scope),
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

export async function previewStaffSchoolReport(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح: تعذر تحديد المدرسة." });
    }

    const payload = normalizePayload(req.body || {});
    const [academicYear, total] = await Promise.all([
      getActiveAcademicYear(schoolId),
      queryStaff(schoolId, payload.scope, payload.statuses, { countOnly: true }),
    ]);

    return res.json({
      success: true,
      data: {
        total,
        title: getTitle(payload.scope),
        academic_year: academicYear.name,
        statuses_label: getStatusesLabel(payload.statuses),
      },
    });
  } catch (error) {
    return sendError(res, error, "previewStaffSchoolReport error:");
  }
}

export async function downloadStaffSchoolReportPdf(req, res) {
  try {
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
    res.setHeader("Content-Disposition", `attachment; filename="staff-report.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(pdf);
  } catch (error) {
    return sendError(res, error, "downloadStaffSchoolReportPdf error:");
  }
}

export async function printStaffSchoolReport(req, res) {
  try {
    const report = await buildReport(req);
    if (!report.rows.length) {
      return res.status(404).json({ success: false, message: "لا توجد بيانات مطابقة لإعدادات الكشف." });
    }

    const layout = getSchoolReportLayout(report.columns);
    const html = renderSchoolReportHtml({ ...report, landscape: layout.landscape, autoPrint: true });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(html);
  } catch (error) {
    return sendError(res, error, "printStaffSchoolReport error:");
  }
}
