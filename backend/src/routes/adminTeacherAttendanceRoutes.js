import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { AdminTeacherAttendanceController } from "../controllers/adminTeacherAttendanceController.js";

const router = express.Router();
router.use(authMiddleware);



// ===== Day Summary + Open/Lock =====
router.get("/day", AdminTeacherAttendanceController.daySummary); // ?date=YYYY-MM-DD
router.post("/day/open", AdminTeacherAttendanceController.openDay); // {date}
router.patch("/day/:id/lock", AdminTeacherAttendanceController.lockDay);
router.patch("/day/:id/unlock", AdminTeacherAttendanceController.unlockDay);

// ===== Scan + Manual =====
router.post("/scan", AdminTeacherAttendanceController.scan); // {date, code}
router.post("/entries", AdminTeacherAttendanceController.createEntry); // {date, teacher_id, status, method}
router.patch("/entries/:id", AdminTeacherAttendanceController.updateEntry); // {status, method, reason?}

export default router;
