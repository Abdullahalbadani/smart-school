    import { pool } from "../config/db.js";
import {
  getSchoolReportLayout,
  htmlToPdfBuffer,
  renderSchoolReportHtml,
  reportDateOnly,
  resolveSchoolLogoDataUrl,
  safeFilePart,
} from "../services/reports/schoolReportService.js";

const METHOD_LABELS = {
  cash: "نقدًا",
  transfer: "حوالة/تحويل",
  wallet: "محفظة",
  card: "بطاقة",
  other: "أخرى",
};

const COLLECTION_COLUMNS = {
  paid_at: { key: "paid_at_label", label: "التاريخ" },
  student_name: { key: "student_name", label: "اسم الطالب" },
  student_code: { key: "student_code", label: "رقم القيد" },
  grade_name: { key: "grade_name", label: "الصف" },
  section_name: { key: "section_name", label: "الشعبة" },
  amount: { key: "amount_label", label: "المبلغ" },
  method: { key: "method_label", label: "طريقة الدفع" },
  provider: { key: "provider", label: "الجهة" },
  reference: { key: "reference", label: "المرجع" },
  receipt_no: { key: "receipt_no", label: "رقم الإيصال" },
};

const OUTSTANDING_COLUMNS = {
  student_name: { key: "student_name", label: "اسم الطالب" },
  student_code: { key: "student_code", label: "رقم القيد" },
  grade_name: { key: "grade_name", label: "الصف" },
  section_name: { key: "section_name", label: "الشعبة" },
  annual_amount: { key: "annual_amount_label", label: "الإجمالي السنوي" },
  paid_total: { key: "paid_total_label", label: "المدفوع" },
  remaining: { key: "remaining_label", label: "المتبقي" },
  next_due_date: { key: "next_due_date_label", label: "موعد القسط القادم" },
};

const COLLECTION_PRESETS = {
  short: ["paid_at", "student_name", "student_code", "grade_name", "section_name", "amount", "method", "receipt_no"],
  detailed: ["paid_at", "student_name", "student_code", "grade_name", "section_name", "amount", "method", "provider", "reference", "receipt_no"],
};

const OUTSTANDING_PRESETS = {
  short: ["student_name", "student_code", "grade_name", "section_name", "annual_amount", "paid_total", "remaining"],
  detailed: ["student_name", "student_code", "grade_name", "section_name", "annual_amount", "paid_total", "remaining", "next_due_date"],
};

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
  return Object.prototype.hasOwnProperty.call(METHOD_LABELS, method) ? method : "";
}

function normalizeColumns(body, definitions, presets) {
  const preset = String(body?.preset || "short").trim();
  const source = preset === "manual" ? body?.columns : presets[preset] || presets.short;
  const keys = [...new Set((Array.isArray(source) ? source : []).map(String).filter((key) => definitions[key]))];
  return keys.length ? keys : presets.short;
}

function normalizeCollectionsPayload(body = {}) {
  return {
    year_id: toInt(body.year_id),
    grade_id: toInt(body.grade_id),
    section_id: toInt(body.section_id),
    from: normalizeDate(body.from),
    to: normalizeDate(body.to),
    method: normalizeMethod(body.method),
    columns: normalizeColumns(body, COLLECTION_COLUMNS, COLLECTION_PRESETS),
  };
}

function normalizeOutstandingPayload(body = {}) {
  return {
    year_id: toInt(body.year_id),
    grade_id: toInt(body.grade_id),
    section_id: toInt(body.section_id),
    columns: normalizeColumns(body, OUTSTANDING_COLUMNS, OUTSTANDING_PRESETS),
  };
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  const number = Number.isFinite(amount) ? amount.toLocaleString("en-US") : "0";
  return `${number} ${currency || "YER"}`;
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

async function getAcademicYear(schoolId, yearId) {
  if (!yearId) throw Object.assign(new Error("اختر السنة الدراسية قبل إنشاء الكشف."), { status: 400 });
  const { rows } = await pool.query(
    `SELECT id, name, start_date, end_date FROM academic_years WHERE id = $1 AND school_id = $2 LIMIT 1`,
    [yearId, schoolId]
  );
  if (!rows[0]) throw Object.assign(new Error("تعذر العثور على السنة الدراسية المحددة."), { status: 400 });
  return rows[0];
}

async function getSettings(schoolId) {
  const { rows } = await pool.query(
    `SELECT ss.invoice_prefix, ss.student_code_prefix, s.currency
     FROM school_settings ss
     JOIN schools s ON s.id = ss.school_id
     WHERE ss.school_id = $1
     LIMIT 1`,
    [schoolId]
  );
  return {
    invoicePrefix: rows[0]?.invoice_prefix || "",
    studentPrefix: rows[0]?.student_code_prefix || "",
    currency: rows[0]?.currency || "YER",
  };
}

async function getScopeNames(schoolId, payload) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT name FROM grades WHERE id = $2 AND school_id = $1 LIMIT 1) AS grade_name,
       (SELECT name FROM sections WHERE id = $3 AND school_id = $1 LIMIT 1) AS section_name`,
    [schoolId, payload.grade_id, payload.section_id]
  );
  return rows[0] || {};
}

function buildScopeSuffix(scope) {
  if (scope.grade_name && scope.section_name) return ` لطلاب الصف ${scope.grade_name} — الشعبة (${scope.section_name})`;
  if (scope.grade_name) return ` لطلاب الصف ${scope.grade_name}`;
  if (scope.section_name) return ` لطلاب الشعبة (${scope.section_name})`;
  return "";
}

function makeCollectionsSubtitle(payload) {
  const items = [];
  if (payload.from || payload.to) items.push(`الفترة: من ${payload.from ? reportDateOnly(payload.from) : "—"} إلى ${payload.to ? reportDateOnly(payload.to) : "—"}`);
  if (payload.method) items.push(`طريقة الدفع: ${METHOD_LABELS[payload.method] || payload.method}`);
  return items.join(" • ");
}

function pushFilter(params, where, sql, value) {
  if (value === undefined || value === null || value === "") return;
  params.push(value);
  where.push(sql.replace("$VALUE", `$${params.length}`));
}

async function queryCollections(schoolId, academicYear, payload, settings, { countOnly = false } = {}) {
  const params = [schoolId, academicYear.id];
  const where = [
    `p.school_id = $1`,
    `c.school_id = $1`,
    `s.school_id = $1`,
    `p.status = 'confirmed'`,
    `c.academic_year_id = $2`,
  ];
  pushFilter(params, where, `p.paid_at::date >= $VALUE::date`, payload.from);
  pushFilter(params, where, `p.paid_at::date <= $VALUE::date`, payload.to);
  pushFilter(params, where, `p.method = $VALUE`, payload.method);
  pushFilter(params, where, `se.grade_id = $VALUE`, payload.grade_id);
  pushFilter(params, where, `se.section_id = $VALUE`, payload.section_id);

  const selectSql = countOnly
    ? `COUNT(*)::int AS total`
    : `p.paid_at, p.amount, p.method, p.provider, p.reference, p.receipt_number,
       s.full_name AS student_name, s.student_code, gr.name AS grade_name, sec.name AS section_name`;
  const orderSql = countOnly ? "" : `ORDER BY p.paid_at DESC, p.id DESC`;

  const { rows } = await pool.query(
    `SELECT ${selectSql}
     FROM fee_payments p
     JOIN fee_contracts c ON c.id = p.contract_id
     JOIN students s ON s.id = c.student_id
     LEFT JOIN student_enrollments se
       ON se.student_id = s.id
      AND se.academic_year_id = c.academic_year_id
      AND se.status = 'enrolled'
     LEFT JOIN grades gr ON gr.id = se.grade_id
     LEFT JOIN sections sec ON sec.id = se.section_id
     WHERE ${where.join(" AND ")}
     ${orderSql}`,
    params
  );

  if (countOnly) return Number(rows[0]?.total || 0);
  return rows.map((row) => ({
    paid_at_label: reportDateOnly(row.paid_at),
    student_name: row.student_name || "—",
    student_code: row.student_code ? `${settings.studentPrefix}${row.student_code}` : "—",
    grade_name: row.grade_name || "—",
    section_name: row.section_name || "—",
    amount_label: formatMoney(row.amount, settings.currency),
    method_label: METHOD_LABELS[row.method] || row.method || "—",
    provider: row.provider || "—",
    reference: row.reference || "—",
    receipt_no: row.receipt_number ? `${settings.invoicePrefix}${row.receipt_number}` : "—",
  }));
}

async function queryOutstanding(schoolId, academicYear, payload, settings, { countOnly = false } = {}) {
  const params = [schoolId, academicYear.id];
  const where = [`c.school_id = $1`, `s.school_id = $1`, `c.academic_year_id = $2`, `c.status = 'active'`];
  pushFilter(params, where, `se.grade_id = $VALUE`, payload.grade_id);
  pushFilter(params, where, `se.section_id = $VALUE`, payload.section_id);

  const baseSql = `
    SELECT
      s.full_name AS student_name,
      s.student_code,
      gr.name AS grade_name,
      sec.name AS section_name,
      c.annual_amount,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0)::bigint AS paid_total,
      GREATEST(c.annual_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0), 0)::bigint AS remaining,
      (SELECT MIN(fi.due_date) FROM fee_installments fi WHERE fi.contract_id = c.id AND fi.status IN ('unpaid', 'partial')) AS next_due_date
    FROM fee_contracts c
    JOIN students s ON s.id = c.student_id
    LEFT JOIN fee_payments p ON p.contract_id = c.id
    LEFT JOIN student_enrollments se
      ON se.student_id = s.id
     AND se.academic_year_id = c.academic_year_id
     AND se.status = 'enrolled'
    LEFT JOIN grades gr ON gr.id = se.grade_id
    LEFT JOIN sections sec ON sec.id = se.section_id
    WHERE ${where.join(" AND ")}
    GROUP BY c.id, s.id, gr.name, sec.name
    HAVING GREATEST(c.annual_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'confirmed'), 0), 0) > 0
  `;

  if (countOnly) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM (${baseSql}) report_rows`, params);
    return Number(rows[0]?.total || 0);
  }

  const { rows } = await pool.query(`${baseSql} ORDER BY remaining DESC, student_name ASC`, params);
  return rows.map((row) => ({
    student_name: row.student_name || "—",
    student_code: row.student_code ? `${settings.studentPrefix}${row.student_code}` : "—",
    grade_name: row.grade_name || "—",
    section_name: row.section_name || "—",
    annual_amount_label: formatMoney(row.annual_amount, settings.currency),
    paid_total_label: formatMoney(row.paid_total, settings.currency),
    remaining_label: formatMoney(row.remaining, settings.currency),
    next_due_date_label: row.next_due_date ? reportDateOnly(row.next_due_date) : "—",
  }));
}

function mapColumns(keys, definitions) {
  return keys.map((key) => definitions[key]);
}

async function buildCollectionsReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });
  const payload = normalizeCollectionsPayload(req.body || {});
  const [school, academicYear, settings, scope] = await Promise.all([
    getSchool(schoolId),
    getAcademicYear(schoolId, payload.year_id),
    getSettings(schoolId),
    getScopeNames(schoolId, payload),
  ]);
  const rows = await queryCollections(schoolId, academicYear, payload, settings);
  return {
    school,
    academicYear,
    rows,
    title: `كشف تحصيل الرسوم المدرسية${buildScopeSuffix(scope)}`,
    subtitle: makeCollectionsSubtitle(payload),
    columns: mapColumns(payload.columns, COLLECTION_COLUMNS),
    countLabel: "عدد العمليات",
    countUnit: "عملية",
    metaItems: [{ label: "العملة", value: settings.currency }],
  };
}

async function buildOutstandingReport(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) throw Object.assign(new Error("غير مصرح: تعذر تحديد المدرسة."), { status: 401 });
  const payload = normalizeOutstandingPayload(req.body || {});
  const [school, academicYear, settings, scope] = await Promise.all([
    getSchool(schoolId),
    getAcademicYear(schoolId, payload.year_id),
    getSettings(schoolId),
    getScopeNames(schoolId, payload),
  ]);
  const rows = await queryOutstanding(schoolId, academicYear, payload, settings);
  return {
    school,
    academicYear,
    rows,
    title: `كشف الطلاب المتأخرين في سداد الرسوم${buildScopeSuffix(scope)}`,
    columns: mapColumns(payload.columns, OUTSTANDING_COLUMNS),
    countLabel: "عدد الطلاب",
    countUnit: "طالبًا",
    metaItems: [{ label: "العملة", value: settings.currency }],
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

async function sendPdf(res, report, fallbackFileName) {
  if (!report.rows.length) return res.status(404).json({ success: false, message: "لا توجد بيانات مطابقة لإعدادات الكشف." });
  const layout = getSchoolReportLayout(report.columns);
  const html = renderSchoolReportHtml({ ...report, landscape: layout.landscape });
  const pdf = await htmlToPdfBuffer(html, { landscape: layout.landscape });
  const fileName = `${safeFilePart(report.title)}-${safeFilePart(report.academicYear.name)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return res.send(pdf);
}

function sendPrint(res, report) {
  if (!report.rows.length) return res.status(404).json({ success: false, message: "لا توجد بيانات مطابقة لإعدادات الكشف." });
  const layout = getSchoolReportLayout(report.columns);
  const html = renderSchoolReportHtml({ ...report, landscape: layout.landscape, autoPrint: true });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(html);
}

export async function previewFeesCollectionsSchoolReport(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح: تعذر تحديد المدرسة." });
    const payload = normalizeCollectionsPayload(req.body || {});
    const academicYear = await getAcademicYear(schoolId, payload.year_id);
    const settings = await getSettings(schoolId);
    const total = await queryCollections(schoolId, academicYear, payload, settings, { countOnly: true });
    const scope = await getScopeNames(schoolId, payload);
    return res.json({ success: true, data: { total, title: `كشف تحصيل الرسوم المدرسية${buildScopeSuffix(scope)}`, academic_year: academicYear.name } });
  } catch (error) {
    return sendError(res, error, "previewFeesCollectionsSchoolReport error:");
  }
}

export async function downloadFeesCollectionsSchoolReportPdf(req, res) {
  try {
    return await sendPdf(res, await buildCollectionsReport(req), "fees-collections-report.pdf");
  } catch (error) {
    return sendError(res, error, "downloadFeesCollectionsSchoolReportPdf error:");
  }
}

export async function printFeesCollectionsSchoolReport(req, res) {
  try {
    return sendPrint(res, await buildCollectionsReport(req));
  } catch (error) {
    return sendError(res, error, "printFeesCollectionsSchoolReport error:");
  }
}

export async function previewFeesOutstandingSchoolReport(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح: تعذر تحديد المدرسة." });
    const payload = normalizeOutstandingPayload(req.body || {});
    const academicYear = await getAcademicYear(schoolId, payload.year_id);
    const settings = await getSettings(schoolId);
    const total = await queryOutstanding(schoolId, academicYear, payload, settings, { countOnly: true });
    const scope = await getScopeNames(schoolId, payload);
    return res.json({ success: true, data: { total, title: `كشف الطلاب المتأخرين في سداد الرسوم${buildScopeSuffix(scope)}`, academic_year: academicYear.name } });
  } catch (error) {
    return sendError(res, error, "previewFeesOutstandingSchoolReport error:");
  }
}

export async function downloadFeesOutstandingSchoolReportPdf(req, res) {
  try {
    return await sendPdf(res, await buildOutstandingReport(req), "fees-outstanding-report.pdf");
  } catch (error) {
    return sendError(res, error, "downloadFeesOutstandingSchoolReportPdf error:");
  }
}

export async function printFeesOutstandingSchoolReport(req, res) {
  try {
    return sendPrint(res, await buildOutstandingReport(req));
  } catch (error) {
    return sendError(res, error, "printFeesOutstandingSchoolReport error:");
  }
}
