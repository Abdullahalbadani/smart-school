// src/routes/studentPortalRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getMeta,
  getTimetable,
  getExamMeta,
  getExams,
  getStudentHeroStats
} from "../controllers/studentPortalController.js";

const router = express.Router();

// meta: days + periods + years
router.get("/meta", authMiddleware, getMeta);

// timetable published for student class
router.get("/timetable", authMiddleware, getTimetable);

// stats for top bar
router.get("/hero-stats", authMiddleware, getStudentHeroStats);

// exam metadata and list
router.get("/exams/meta", authMiddleware, getExamMeta);
router.get("/exams", authMiddleware, getExams);

export default router;