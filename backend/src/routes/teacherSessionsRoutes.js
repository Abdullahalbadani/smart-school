import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  startSession,
  endSession,
  sessionStudents,
  saveAttendance,
} from "../controllers/teacherSessionsController.js";

const router = express.Router();

router.use(authMiddleware);

// بدء الحصة
router.post("/start", startSession);

// إنهاء الحصة
router.post("/:id/end", endSession);

// طلاب الحصة
router.get("/:id/students", sessionStudents);

// حفظ الحضور
router.post("/:id/attendance", saveAttendance);

export default router;
