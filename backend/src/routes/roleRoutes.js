// src/routes/roleRoutes.js
import express from "express";
import {
  createRole,
  getRoles,
  getRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  updateRolePermissions,
  grantAllPermissions, // ✅ الإضافة الجديدة
} from "../controllers/roleController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";

const router = express.Router();

/* ======================
   🔒 إدارة الأدوار
====================== */

// إنشاء دور جديد
router.post(
  "/",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  createRole
);

// جلب كل الأدوار
router.get(
  "/",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  getRoles
);

// جلب دور واحد
router.get(
  "/:id",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  getRole
);

// تحديث دور
router.put(
  "/:id",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  updateRole
);

// حذف دور
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  deleteRole
);

/* ======================
   🔑 صلاحيات الدور
====================== */

// جلب صلاحيات دور معين
router.get(
  "/:id/permissions",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  getRolePermissions
);

// تحديث صلاحيات دور (checkboxes)
router.post(
  "/:id/permissions",
  authMiddleware,
  checkPermission("rbac.manage_roles"),
  updateRolePermissions
);

/* ======================
   ✅ ميزة احترافية
   🔐 منح كل الصلاحيات
====================== */

// router.post(
//   "/:id/grant-all-permissions",
//   authMiddleware,
//   checkPermission("rbac.manage_roles"),
//   grantAllPermissions
// );

export default router;