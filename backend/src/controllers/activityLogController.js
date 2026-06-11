// backend/src/controllers/activityLogController.js
import { pool } from "../config/db.js";

const MODULE_LABELS = {
  Security: "الأمان وتسجيل الدخول",
  Finance: "الرسوم والمدفوعات",
  Grades: "الدرجات والنتائج",
  users: "المستخدمون",
  roles: "الأدوار والصلاحيات",
  permissions: "الصلاحيات",
  students: "الطلاب",
  guardians: "أولياء الأمور",
  employees: "الموظفون والمعلمون",
  "school-settings": "إعدادات المدرسة",
  "academic-years": "السنوات الدراسية",
  stages: "المراحل الدراسية",
  grades: "الصفوف الدراسية",
  sections: "الشعب الدراسية",
  subjects: "المواد الدراسية",
  periods: "الحصص الدراسية",
  curriculum: "الخطة الدراسية",
  "assign-teachers": "توزيع المعلمين",
  attendance: "الحضور والغياب",
  assessments: "الاختبارات والتقييمات",
  results: "النتائج الدراسية",
  fees: "الرسوم والمدفوعات",
  "fee-rules": "قواعد الرسوم",
  "fee-adjustments": "طلبات تعديل الرسوم",
  reports: "التقارير المدرسية",
  "school-reports": "التقارير المدرسية",
  backups: "النسخ الاحتياطية",
  notifications: "الإشعارات والرسائل",
  timetables: "الجداول الدراسية",
  certificates: "الشهادات",
  transfers: "طلبات نقل الطلاب",
  permits: "الأذونات",
  learning: "الأنشطة التعليمية",
  system: "النظام",
  System: "النظام",
};

const ACTION_LABELS = {
  VIEW: "عرض",
  CREATE: "إضافة",
  UPDATE: "تعديل",
  DELETE: "حذف",
  LOGIN: "تسجيل دخول",
  LOGOUT: "تسجيل خروج",
  APPROVE: "اعتماد",
  REJECT: "رفض",
  PUBLISH: "نشر",
  UNPUBLISH: "إلغاء نشر",
  PRINT: "طباعة",
  EXPORT: "تصدير",
  IMPORT: "استيراد",
  ISSUE: "إصدار",
  CANCEL: "إلغاء",
  LOCK: "إغلاق",
  UNLOCK: "إعادة فتح",
  ACTIVATE: "تفعيل",
  DEACTIVATE: "تعطيل",
  RESTORE: "استعادة",
  DOWNLOAD: "تنزيل",
  SEND: "إرسال",
  SUBMIT: "تسليم",
  TRANSFER: "نقل",
  DENY: "رفض وصول",
  RESET: "إعادة تعيين",
  ACTIVITY: "عملية",
};

function toPage(value, fallback = 1) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function toLimit(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

function toOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isTruthy(value) {
  return /^(?:1|true|yes)$/i.test(String(value ?? "").trim());
}

function moduleLabel(module, metadata = {}) {
  return metadata?.module_label || MODULE_LABELS[module] || module || "النظام";
}

function actionLabel(row) {
  return row.action_label || ACTION_LABELS[String(row.action || "").toUpperCase()] || "عملية";
}

function severityOf(row) {
  return row.metadata?.severity || (row.status_code >= 400 ? "important" : "normal");
}

function resultOf(row) {
  return row.metadata?.result || (row.status_code >= 400 ? "failure" : "success");
}

export const getRecentActivities = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح: لم يتم تحديد المدرسة.",
      });
    }

    const page = toPage(req.query.page, 1);
    const limit = toLimit(req.query.limit, 20);
    const offset = (page - 1) * limit;

    const filterDate = toOptionalText(req.query.date);
    const dateFrom = toOptionalText(req.query.date_from);
    const dateTo = toOptionalText(req.query.date_to);
    const filterAction = toOptionalText(req.query.action)?.toUpperCase() || null;
    const filterModule = toOptionalText(req.query.module);
    const filterUser = toOptionalText(req.query.user);
    const filterSeverity = toOptionalText(req.query.severity);
    const filterResult = toOptionalText(req.query.result);
    const search = toOptionalText(req.query.q || req.query.search);
    const includeNoise = isTruthy(req.query.include_noise);
    const scope = String(req.query.scope || "dashboard").trim().toLowerCase();
    const dashboardOnly = !["all", "full", "full_log"].includes(scope);

    const values = [schoolId];
    const where = [`a.school_id = $1`];

    function add(value) {
      values.push(value);
      return `$${values.length}`;
    }

    if (!includeNoise) {
      where.push(`COALESCE(a.path, '') NOT ILIKE '%/preview%'`);
      where.push(`COALESCE(a.path, '') NOT ILIKE '%/inbox/read-all%'`);
      where.push(`COALESCE(a.path, '') !~* '/inbox/[0-9]+/read/?$'`);
      where.push(`COALESCE(a.metadata->>'visibility', 'dashboard') <> 'hidden'`);
    }

    if (dashboardOnly) {
      where.push(`COALESCE(a.metadata->>'visibility', 'dashboard') = 'dashboard'`);
    }

    if (filterDate) where.push(`COALESCE(a.event_date, DATE(a.created_at)) = ${add(filterDate)}::date`);
    if (dateFrom) where.push(`COALESCE(a.event_date, DATE(a.created_at)) >= ${add(dateFrom)}::date`);
    if (dateTo) where.push(`COALESCE(a.event_date, DATE(a.created_at)) <= ${add(dateTo)}::date`);
    if (filterAction) where.push(`UPPER(COALESCE(a.action, '')) = ${add(filterAction)}`);
    if (filterModule) where.push(`COALESCE(a.module, a.resource_type, a.entity_type, '') = ${add(filterModule)}`);
    if (filterSeverity) where.push(`COALESCE(a.metadata->>'severity', 'normal') = ${add(filterSeverity)}`);
    if (filterResult) where.push(`COALESCE(a.metadata->>'result', CASE WHEN COALESCE(a.status_code, 200) >= 400 THEN 'failure' ELSE 'success' END) = ${add(filterResult)}`);

    if (filterUser) {
      const p = add(`%${filterUser}%`);
      where.push(`(COALESCE(a.user_name, '') ILIKE ${p} OR COALESCE(u.name, '') ILIKE ${p} OR COALESCE(u.username, '') ILIKE ${p})`);
    }

    if (search) {
      const p = add(`%${search}%`);
      where.push(`(
        COALESCE(a.description, '') ILIKE ${p}
        OR COALESCE(a.action_label, '') ILIKE ${p}
        OR COALESCE(a.module, '') ILIKE ${p}
        OR COALESCE(a.table_name, '') ILIKE ${p}
        OR COALESCE(a.user_name, '') ILIKE ${p}
        OR COALESCE(a.resource_id, '') ILIKE ${p}
      )`);
    }

    const whereSql = `WHERE ${where.join("\n        AND ")}`;

    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM activity_logs a
      LEFT JOIN users u
        ON u.id = a.user_id
       AND u.school_id = a.school_id
      ${whereSql}
    `;
    const countRes = await pool.query(countQuery, values);
    const totalCount = countRes.rows[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    const fetchValues = [...values, limit, offset];
    const limitPlaceholder = `$${fetchValues.length - 1}`;
    const offsetPlaceholder = `$${fetchValues.length}`;

    const query = `
      SELECT
        a.id,
        a.school_id,
        a.user_id,
        a.action,
        a.action_label,
        a.module,
        a.table_name,
        a.record_id,
        a.entity_type,
        a.entity_id,
        a.resource_type,
        a.resource_id,
        COALESCE(a.old_data, '{}'::jsonb) AS old_data,
        COALESCE(a.new_data, '{}'::jsonb) AS new_data,
        COALESCE(a.changed_fields, '[]'::jsonb) AS changed_fields,
        COALESCE(a.changes, '{}'::jsonb) AS changes,
        COALESCE(a.details, '{}'::jsonb) AS details,
        COALESCE(a.metadata, '{}'::jsonb) AS metadata,
        a.description,
        a.reason,
        a.path,
        a.method,
        a.status_code,
        a.ip_address,
        a.user_agent,
        a.session_id,
        a.device_info,
        a.event_date,
        a.event_time,
        a.created_at,
        COALESCE(a.user_name, u.name, u.username, 'مستخدم غير معروف') AS user_name,
        COALESCE(a.user_role, 'system') AS user_role,
        u.username AS user_username
      FROM activity_logs a
      LEFT JOIN users u
        ON u.id = a.user_id
       AND u.school_id = a.school_id
      ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const { rows } = await pool.query(query, fetchValues);

    const data = rows.map((row) => {
      const displayModule = row.module || row.resource_type || row.entity_type || "system";
      const displayModuleLabel = moduleLabel(displayModule, row.metadata);
      const displayActionLabel = actionLabel(row);
      const severity = severityOf(row);
      const result = resultOf(row);

      return {
        ...row,
        action_label: displayActionLabel,
        module: displayModule,
        module_label: displayModuleLabel,
        severity,
        result,
        event_key: row.metadata?.event_key || null,
        target_label: row.details?.target_label || null,
        title: displayActionLabel,
        actor_name: row.user_name,
        display_text: row.description || `${row.user_name} نفّذ ${displayActionLabel} في قسم ${displayModuleLabel}`,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      filters: {
        include_noise: includeNoise,
        scope: dashboardOnly ? "dashboard" : "all",
      },
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب سجل النشاطات",
    });
  }
};

export default {
  getRecentActivities,
};
