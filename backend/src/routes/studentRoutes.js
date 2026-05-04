import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";
import { searchStudents } from "../controllers/metaController.js";
import {
  registerStudent,
  listStudents,
  getStudentById,
  deleteStudentById,
  updateStudentById,
  getNextStudentCode, // ✅ 1. أضفنا استيراد الدالة هنا
} from "../controllers/studentController.js";

const router = Router();

// POST /api/students/register
router.post(
  "/register",
  authMiddleware,
  checkPermission("admission.create_student"),
  registerStudent
);

// GET /api/students
router.get(
  "/",
  authMiddleware,
  checkPermission("admission.view_students"),
  listStudents
);

// ✅ GET /api/students/search
router.get(
  "/search",
  authMiddleware,
  checkPermission("admission.view_students"),
  searchStudents
);

// ✅ 2. نقلنا /next-code ليكون قبل /:id (تجنباً لفخ الـ params)
router.get(
  '/next-code', 
  authMiddleware, 
  getNextStudentCode
);

// GET /api/students/:id
router.get(
  "/:id",
  authMiddleware,
  checkPermission("admission.view_students"),
  getStudentById
);

// ✅ PUT/PATCH /api/students/:id (تعديل)
router.put(
  "/:id",
  authMiddleware,
  checkPermission("admission.update_student"),
  updateStudentById
);

router.patch(
  "/:id",
  authMiddleware,
  checkPermission("admission.update_student"),
  updateStudentById
);

// DELETE /api/students/:id
router.delete(
  "/:id",
  authMiddleware,
  checkPermission("admission.delete_student"),
  deleteStudentById
);

export default router;