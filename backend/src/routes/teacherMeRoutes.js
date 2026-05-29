// src/routes/teacherMeRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { TeacherMeController } from "../controllers/teacherMeController.js";

const router = express.Router();

// حماية المسارات
router.use(authMiddleware);

/*
  لأن هذا الملف مركب في server.js على:
  /api/teacher/me

  إذن:
  router.get("/") = /api/teacher/me
*/
router.get("/", TeacherMeController.card);

// المسارات الموجودة سابقًا
router.get("/card", TeacherMeController.card);
router.get("/token", TeacherMeController.token);

export default router;