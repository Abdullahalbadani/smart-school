import { pool } from "../config/db.js";

const ADMIN_ROLE_NAMES = new Set([
  "admin",
  "administrator",
  "school_admin",
  "school-admin",
  "super_admin",
  "superadmin",
]);

const PERMISSION_GROUPS = {
  send: ["notifications.send", "notifications.manage"],
  sentLog: ["notifications.sent_log.view", "notifications.view_sent_log", "notifications.manage"],
};

function hasAdministrativeRole(user) {
  const role = String(user?.role || user?.role_name || "").trim().toLowerCase();
  return ADMIN_ROLE_NAMES.has(role) || role.includes("مدير");
}

function hasEmbeddedPermission(user, allowedCodes) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return allowedCodes.some((code) => permissions.includes(code));
}

async function hasSchoolScopedRolePermission({ userId, roleId, schoolId, allowedCodes }) {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  if (!Number.isInteger(roleId) || roleId <= 0) return false;
  if (!Number.isInteger(schoolId) || schoolId <= 0) return false;
  if (!Array.isArray(allowedCodes) || !allowedCodes.length) return false;

  const { rowCount } = await pool.query(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r
       ON r.id = ur.role_id
      AND r.school_id = ur.school_id
     JOIN role_permissions rp
       ON rp.role_id = r.id
      AND rp.school_id = ur.school_id
     JOIN permissions p
       ON p.id = rp.permission_id
     WHERE ur.user_id = $1
       AND ur.role_id = $2
       AND ur.school_id = $3
       AND p.code = ANY($4::text[])
     LIMIT 1`,
    [userId, roleId, schoolId, allowedCodes]
  );

  return rowCount > 0;
}

export function requireNotificationsAdminAccess(group = "send") {
  const allowedCodes = PERMISSION_GROUPS[group] || PERMISSION_GROUPS.send;

  return async function notificationsAdminAccess(req, res, next) {
    try {
      const user = req.user;
      const userId = Number(user?.id);
      const schoolId = Number(user?.school_id);
      const roleId = Number(user?.role_id);

      if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(schoolId) || schoolId <= 0) {
        return res.status(401).json({ ok: false, message: "غير مصرح" });
      }

      if (hasAdministrativeRole(user) || hasEmbeddedPermission(user, allowedCodes)) {
        return next();
      }

      const allowed = await hasSchoolScopedRolePermission({
        userId,
        roleId,
        schoolId,
        allowedCodes,
      });

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          message: "ليس لديك صلاحية لإدارة الإشعارات",
        });
      }

      return next();
    } catch (error) {
      console.error("notificationsAdminAccess error:", error);
      return res.status(500).json({
        ok: false,
        message: "تعذر التحقق من صلاحية إدارة الإشعارات",
      });
    }
  };
}
