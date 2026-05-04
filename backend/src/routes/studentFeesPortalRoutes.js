// src/routes/studentFeesPortalRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { studentFeesOverview } from "../controllers/studentFeesPortalController.js";

const router = Router();

// ✅ المسار محمي بـ authMiddleware لضمان توفر بيانات الطالب ومدرسته
router.get("/overview", authMiddleware, studentFeesOverview);

export default router;