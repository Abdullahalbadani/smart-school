import express from "express";
import { getMeta, getScopes, listStudents } from "../controllers/teacherStudentsController.js";

// ✅ غيّر اسم الميدلوير حسب مشروعك
import  requireAuth  from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/meta", requireAuth, getMeta);
router.get("/scopes", requireAuth, getScopes);
router.get("/list", requireAuth, listStudents);

export default router;
