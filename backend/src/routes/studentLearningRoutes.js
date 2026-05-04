import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  listStudentActivities,
  getStudentActivityDetail,
  submitStudentActivity,
  listStudentGrades,
} from "../controllers/studentLearningController.js";

const router = express.Router();

const uploadDir = path.join(process.cwd(), "uploads", "submissions");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const safe = `sub_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

router.use(authMiddleware);

router.get("/activities", listStudentActivities);
router.get("/activities/:id", getStudentActivityDetail);
router.post("/activities/:id/submit", upload.single("file"), submitStudentActivity);

router.get("/grades", listStudentGrades);

export default router;