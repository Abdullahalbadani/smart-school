import PermissionRoleModel from "../modules/permissionRoleModel.js";

export default async function loadPermissions(req, res, next) {
  try {
    if (!req.user) {
      return next();
    }

    if (!req.user.role_id) {
      req.user.permissions = [];
      return next();
    }

    const codes = await PermissionRoleModel.getPermissionCodesForRole(
      req.user.role_id,
      req.user.school_id
    );

    req.user.permissions = Array.isArray(codes) ? codes : [];

    return next();
  } catch (err) {
    console.error("loadPermissions error:", err);

    return res.status(500).json({
      message: "خطأ في تحميل صلاحيات المستخدم",
    });
  }
}