import express from "express";
import requireAuth from "../middleware/authMiddleware.js";
import { getHero, getNextLesson } from "../controllers/teacherDashboardController.js";

const router = express.Router();

// جميع مسارات لوحة التحكم تتطلب تسجيل دخول لفلترة البيانات حسب المدرسة
router.get("/hero", requireAuth, getHero);
router.get("/next-lesson", requireAuth, getNextLesson);

export default router;