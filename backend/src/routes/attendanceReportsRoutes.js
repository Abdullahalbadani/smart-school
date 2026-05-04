// routes/attendanceReportsRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js"; // ✅ استدعاء الميدل وير
import attendanceReportsController from "../controllers/attendanceReportsController.js";

const router = express.Router();

// ✅ تطبيق الميدل وير على جميع مسارات التقارير لتوفير بيانات المدرسة (school_id)
router.use(authMiddleware);

// Students
router.get("/attendance/students", attendanceReportsController.getStudentsAttendanceReport);
router.get("/attendance/students/:id/details", attendanceReportsController.getStudentAttendanceDetails);

// Teachers
router.get("/attendance/teachers", attendanceReportsController.getTeachersAttendanceReport);
router.get("/attendance/teachers/:id/details", attendanceReportsController.getTeacherAttendanceDetails);

export default router;