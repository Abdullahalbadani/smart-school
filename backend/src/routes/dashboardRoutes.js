// src/routes/dashboardRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  getDashboardStats,
  getAdminHomeDashboard,
} from "../controllers/dashboardController.js";

const router = Router();

// الإحصائيات القديمة الموجودة حاليًا
router.get("/stats", authMiddleware, getDashboardStats);

// الداشبورد الجديدة الكاملة
router.get("/admin-home", authMiddleware, getAdminHomeDashboard);

export default router;