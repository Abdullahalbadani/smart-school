import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
// ✅ استدعاء الكنترولر الذي قمنا بتأمينه وبرمجته لعزل المدارس
import { getDashboardStats } from "../controllers/dashboardController.js";

const router = Router();

// ✅ توجيه الطلب مباشرة إلى الكنترولر الآمن
router.get("/stats", authMiddleware, getDashboardStats);

export default router;