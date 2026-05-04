// src/routes/academicYearRoutes.js
import express from "express";

import {
  getAcademicYears,
  getActiveAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  deleteAcademicYear,
  setActiveAcademicYear,
} from "../controllers/academicYearController.js";

import authMiddleware from "../middleware/authMiddleware.js";
import  checkPermission  from "../middleware/checkPermission.js";

const router = express.Router();

/**
 * ملاحظات عن الصلاحيات:
 * - استخدمت:
 *    calendar.view_years   لعرض السنوات
 *    calendar.manage_years للإضافة والتعديل والحذف والتفعيل
 * - لو ما عندك permission باسم "calendar.manage_years" أضِفه في جدول permissions
 *   واربطه بدور الـ admin في جدول role_permissions.
 */

// جلب كل السنوات الدراسية
router.get(
  "/",
  authMiddleware,
  checkPermission("calendar.view_years"),
  getAcademicYears
);

// جلب السنة الدراسية الحالية
router.get(
  "/active",
  authMiddleware,
  checkPermission("calendar.view_years"),
  getActiveAcademicYear
);

// إنشاء سنة دراسية جديدة
router.post(
  "/",
  authMiddleware,
  checkPermission("calendar.manage_years"),
  createAcademicYear
);

// تعديل سنة دراسية
router.put(
  "/:id",
  authMiddleware,
  checkPermission("calendar.manage_years"),
  updateAcademicYear
);

// حذف سنة دراسية
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("calendar.manage_years"),
  deleteAcademicYear
);

// تعيين سنة كـ سنة حالية
router.patch(
  "/:id/activate",
  authMiddleware,
  checkPermission("calendar.manage_years"),
  setActiveAcademicYear
);

export default router;
