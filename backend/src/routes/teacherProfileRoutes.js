import express from "express";
import { getTeacherJobProfile } from "../controllers/teacherProfileController.js";

const router = express.Router();

// ✅ هنا "/" لأننا سنركبه على /api/teacher/profile
router.get("/", getTeacherJobProfile);

export default router;
