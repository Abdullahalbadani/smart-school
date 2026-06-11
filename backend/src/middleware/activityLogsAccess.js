// src/middleware/activityLogsAccess.js
import { logAudit } from "../utils/auditLogger.js";

const VIEW_PERMISSIONS = new Set([
  "activity_logs.view",
  "audit_logs.view",
  "system.activity_logs.view",
]);

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function isAdministrationRole(user) {
  const role = normalizeRole(user?.role || user?.role_name);

  return (
    Number(user?.role_id) === 1 ||
    role === "admin" ||
    role === "administrator" ||
    role === "school_admin" ||
    role === "superadmin" ||
    role === "super_admin" ||
    role.includes("مدير")
  );
}

function hasViewPermission(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.some((permission) => VIEW_PERMISSIONS.has(String(permission || "").trim()));
}

/**
 * سجل التدقيق يحتوي تفاصيل حساسة، لذلك لا يكفي مجرد تسجيل الدخول لرؤيته.
 * يسمح لمدير المدرسة أو لمستخدم مُنح صلاحية عرض السجل صراحةً.
 */
export default async function activityLogsAccess(req, res, next) {
  if (isAdministrationRole(req.user) || hasViewPermission(req.user)) {
    return next();
  }

  await logAudit({
    req,
    action: "DENY",
    actionLabel: "رفض عرض سجل الأحداث",
    module: "Security",
    moduleLabel: "الأمان والصلاحيات",
    tableName: "activity_logs",
    description: `تم رفض وصول المستخدم ${req.user?.name || req.user?.username || req.user?.id || "غير معروف"} إلى سجل الأحداث`,
    details: {
      requested_path: req.originalUrl || req.url,
      requested_method: req.method,
    },
    metadata: {
      severity: "sensitive",
      result: "failure",
    },
    eventKey: "ACTIVITY_LOGS_ACCESS_DENIED",
    statusCode: 403,
  });

  return res.status(403).json({
    success: false,
    message: "ليس لديك صلاحية لعرض سجل الأحداث",
  });
}
