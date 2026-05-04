// backend/src/routes/teacherNotificationsSendRoutes.js
import express from "express";
import {
  getTeacherScopes,
  listScopeStudents,
  listStudentGuardians,
  sendToAdmins,
  sendToStudents,
  sendToGuardians,
} from "../controllers/teacherNotificationsSendController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// حماية المسارات لضمان استخراج school_id
router.use(authMiddleware);

// نطاقات المعلم
router.get("/scopes", getTeacherScopes);

// طلاب شعبة معينة (من نطاقه ومدرسته فقط)
router.get("/students", listScopeStudents);

// أولياء أمور طالب معين
router.get("/students/:studentId/guardians", listStudentGuardians);

// إرسال للإدارة
router.post("/send/admins", sendToAdmins);

// إرسال للطلاب
router.post("/send/students", sendToStudents);

// إرسال للأولياء
router.post("/send/guardians", sendToGuardians);

export default router;