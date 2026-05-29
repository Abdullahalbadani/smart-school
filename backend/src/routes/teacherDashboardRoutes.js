import express from "express";
import requireAuth from "../middleware/authMiddleware.js";
import {
  getHero,
  getNextLesson,
} from "../controllers/teacherDashboardController.js";

const router = express.Router();

// المسارات القديمة
router.get("/hero", requireAuth, getHero);
router.get("/next-lesson", requireAuth, getNextLesson);

// المسارات التي تطلبها الواجهة الحالية
router.get("/dashboard/hero", requireAuth, getHero);
router.get("/dashboard/next-lesson", requireAuth, getNextLesson);

export default router;