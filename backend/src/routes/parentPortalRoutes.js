// src/routes/parentPortalRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getParentMe,
  getParentMeta,
  getChildTimetable,
  getParentExamsMeta,
  getChildExams,
} from "../controllers/parentPortalController.js";

const router = express.Router();

router.get("/me", authMiddleware, getParentMe);
router.get("/meta", authMiddleware, getParentMeta);
router.get("/timetable", authMiddleware, getChildTimetable);

// ✅ Exams for parent
router.get("/exams/meta", authMiddleware, getParentExamsMeta);
router.get("/exams", authMiddleware, getChildExams);

export default router;