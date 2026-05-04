// src/routes/userRoutes.js
import { Router } from "express";
import { UserController } from "../controllers/userController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import loadPermissions from "../middleware/loadPermissions.js";
import checkPermission from "../middleware/checkPermission.js";

const router = Router();

/**
 * 🔹 صلاحيات القائمة للمستخدم الحالي
 * GET /api/users/me/menu-permissions
 * يُستخدم في admin.js -> fetchMenuPermissions()
 */
router.get(
  "/me/menu-permissions",
  authMiddleware,
  UserController.getMyMenuPermissions
);

// إنشاء مستخدم جديد
router.post(
  "/",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_users"),
  UserController.create
);

// عرض كل المستخدمين
router.get(
  "/",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_users"),
  UserController.getAll
);

// عرض مستخدم واحد
router.get(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_users"),
  UserController.getOne
);

// تحديث مستخدم
router.put(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_users"),
  UserController.update
);

// حذف مستخدم
router.delete(
  "/:id",
  authMiddleware,
  loadPermissions,
  checkPermission("rbac.manage_users"),
  UserController.delete
);

export default router;
