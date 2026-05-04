// backend/src/routes/studentAttendanceRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { StudentAttendanceController } from "../controllers/studentAttendanceController.js";

const router = express.Router();
router.use(authMiddleware);

// ملخص اليوم + رسالة قوية للواجهة
router.get("/today", StudentAttendanceController.today);

// أسبوع المدرسة الحالي (سبت -> جمعة)
router.get("/week", StudentAttendanceController.week);

// نطاق عام (يُستخدم للشهر/الفصل)
router.get("/range", StudentAttendanceController.range);

// نسبة حضور العام + إحصائيات
router.get("/stats", StudentAttendanceController.stats);

export default router;
