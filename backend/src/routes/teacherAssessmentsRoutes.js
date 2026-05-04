import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  listAssessments,
  createAssessment,
  publishAssessment,
  closeAssessment,
  getOfficialAssessmentContext,
} from "../controllers/teacherAssessmentsController.js";

const router = express.Router();

// =========================================
// إعدادات رفع المرفقات الخاصة بالمعلم (Multer)
// =========================================
const uploadDir = path.join(process.cwd(), "uploads", "assessments");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const safe = `asm_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // الحد الأقصى للملف الواحد: 10 ميجابايت
  },
});
// =========================================

router.use(authMiddleware);

router.get("/official-context", getOfficialAssessmentContext);
router.get("/", listAssessments);

// ✅ تم الإصلاح: إضافة upload.array لفك تشفير الـ FormData واستقبال حتى 5 ملفات
router.post("/", upload.array("files", 5), createAssessment);

router.post("/:id/publish", publishAssessment);
router.post("/:id/close", closeAssessment);

export default router;