// backend/src/routes/parentAttendanceRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { ParentAttendanceController } from "../controllers/parentAttendanceController.js";

const router = express.Router();
router.use(authMiddleware);

// /api/parent/attendance/today?studentId=..&date=YYYY-MM-DD&term=1&yearId=1
router.get("/today", ParentAttendanceController.today);

// /api/parent/attendance/week?studentId=..&end=YYYY-MM-DD&term=1&yearId=1
router.get("/week", ParentAttendanceController.week);
router.get("/range", ParentAttendanceController.range);

export default router;
