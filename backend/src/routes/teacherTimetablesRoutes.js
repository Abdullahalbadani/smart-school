// src/routes/teacherTimetablesRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { TeacherTimetablesController } from "../controllers/teacherTimetablesController.js";

const router = express.Router();

// حماية جميع المسارات
router.use(authMiddleware);

// الأساسية
router.get("/meta", TeacherTimetablesController.meta);
router.get("/", TeacherTimetablesController.list);
router.get("/classes", TeacherTimetablesController.classes);

// الاختبارات (ضمن نفس الروتر)
router.get("/exams/meta", TeacherTimetablesController.examsMeta);
router.get("/exams", TeacherTimetablesController.examsList);

// ✅ الطلاب
router.get("/students/scopes", TeacherTimetablesController.studentsScopes);
router.get("/students", TeacherTimetablesController.studentsList);

export default router;
