import express from "express";
import {
  addModule,
  fetchModules,
  fetchModuleById,
  editModule,
  removeModule,
} from "../controllers/moduleController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import loadPermissions from "../middleware/loadPermissions.js";
import checkPermission from "../middleware/checkPermission.js";

const router = express.Router();

/**
 * ملاحظة مهمة:
 * صفحة "الأدوار" و "الصلاحيات" تحتاج فقط أن تقرأ قائمة الوحدات،
 * عشان تعبي الـ select في الواجهة، مو بالضرورة يعدّل الوحدات.
 *
 * لذلك:
 *  - GET /modules: نسمح به لأي دور عنده واحدة من صلاحيات RBAC.
 *  - POST/PUT/DELETE: نربطها بصلاحية rbac.manage_modules فقط.
 */

// مساعدة: دالة لفحص أي صلاحية من مجموعة
import PermissionRoleModel from "../modules/permissionRoleModel.js";

function checkAnyPermission(codes = []) {
  return async function (req, res, next) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "غير مصرح" });
      }

      const roleName = String(user.role || user.role_name || "").toLowerCase();

      // الأدمـن الكامل يتخطى الفحص
      if (
        roleName === "admin" ||
        roleName === "superadmin" ||
        user.role_id === 1
      ) {
        return next();
      }

      // لو عنده user.permissions جرب نبحث فيها
      if (Array.isArray(user.permissions)) {
        const hasFromArray = codes.some((c) =>
          user.permissions.includes(c)
        );
        if (hasFromArray) return next();
      }

      // فحص من قاعدة البيانات: هل الدور يملك أي من هذه الصلاحيات؟
      const hasAny = await PermissionRoleModel.roleHasAnyPermission(
        user.role_id,
        codes
      );
      if (!hasAny) {
        return res
          .status(403)
          .json({ message: "ليس لديك صلاحية لتنفيذ هذا الإجراء" });
      }

      return next();
    } catch (err) {
      console.error("checkAnyPermission error:", err);
      return res
        .status(500)
        .json({ message: "خطأ في التحقق من صلاحيات المستخدم" });
    }
  };
}

// ======================= الراوتات =======================

// عرض كل الوحدات (قراءة فقط)
// يكفي أن يكون عنده أي صلاحية من صلاحيات RBAC
router.get(
  "/",
  authMiddleware,
  loadPermissions,
  checkAnyPermission([
    "rbac.manage_modules",
    "rbac.manage_permissions",
    "rbac.manage_roles",
    "rbac.manage_users",
  ]),
  fetchModules
);

// إنشاء وحدة
router.post(
  "/",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_modules"),
  addModule
);

// جلب وحدة واحدة
router.get(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_modules"),
  fetchModuleById
);

// تعديل وحدة
router.put(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_modules"),
  editModule
);

// حذف وحدة
router.delete(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_modules"),
  removeModule
);

export default router;
