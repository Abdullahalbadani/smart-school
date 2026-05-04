import { Router } from "express";
import { PermissionController } from "../controllers/permissionController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";

const router = Router();

// 🔒 جميع المسارات يجب أن تكون محمية بتسجيل الدخول
router.use(authMiddleware);

// 👁️ عرض الصلاحيات (مسموح لأي شخص يملك صلاحية إدارة الأدوار ليتمكن من رؤية القائمة)
router.get("/", PermissionController.getPermissions);
router.get("/:id", PermissionController.getPermission);

// ⚠️ إنشاء، تعديل، وحذف صلاحية (عمليات حساسة ومحكومة بصلاحية إدارة الصلاحيات)
router.post("/", checkPermission("rbac.manage_permissions"), PermissionController.createPermission);
router.put("/:id", checkPermission("rbac.manage_permissions"), PermissionController.updatePermission);
router.delete("/:id", checkPermission("rbac.manage_permissions"), PermissionController.deletePermission);

export default router;