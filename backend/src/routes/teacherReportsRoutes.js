import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js"; // ✅ استدعاء حارس البوابة
import {
  getTeacherReportsMeta,
  getTeacherReportScopes,
  getTeacherReportContext,
  generateTeacherReport,
} from "../controllers/teacherReportsController.js";

const router = Router();

// ✅ تطبيق الحماية على جميع مسارات التقارير لضمان معرفة هوية المعلم ومدرسته
router.use(authMiddleware);

router.get("/meta", getTeacherReportsMeta);
router.get("/scopes", getTeacherReportScopes);
router.get("/context", getTeacherReportContext);
router.post("/generate", generateTeacherReport);

export default router;