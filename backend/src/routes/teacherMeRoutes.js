import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { TeacherMeController } from "../controllers/teacherMeController.js";

const router = express.Router();

// حماية المسارات (هوية المعلم تتطلب دائماً تسجيل الدخول)
router.use(authMiddleware);

router.get("/card", TeacherMeController.card);
router.get("/token", TeacherMeController.token);

export default router;