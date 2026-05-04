// src/routes/teacherAttendanceRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { TeacherAttendanceController } from "../controllers/teacherAttendanceController.js";

const router = express.Router();
router.use(authMiddleware);

/* =========================
   META + SCOPES + REASONS
========================= */
router.get("/meta", TeacherAttendanceController.meta);
router.get("/scopes", TeacherAttendanceController.scopes);
router.get("/reasons", TeacherAttendanceController.reasons);

/* =========================
   SESSIONS (Today Slots)
========================= */
router.get("/sessions/slots", TeacherAttendanceController.sessionSlots);

/* =========================
   PERMITS (Parent requests / excuses)
   - مسارات واضحة + Aliases للتوافق
========================= */
router.get("/permits", TeacherAttendanceController.permitsList);
router.get("/permits/approved", TeacherAttendanceController.permitsApproved);
router.get("/permits/excuses", TeacherAttendanceController.permitsExcuses);
router.get("/permits/map", TeacherAttendanceController.permitsMap);

// Aliases (لو الفرونت يستخدمها)
router.get("/approved", TeacherAttendanceController.permitsApproved);
router.get("/excuses", TeacherAttendanceController.permitsExcuses);

/* =========================
   HISTORY + REPORTS
========================= */
router.get("/history", TeacherAttendanceController.historySearch);
router.get("/report/aggregate", TeacherAttendanceController.reportAggregate);

/* =========================
   SESSIONS (CRUD + Lock/Unlock/End)
========================= */
// Create/Open session
router.post("/sessions", TeacherAttendanceController.createSession);

// Alias: لو الفرونت يرسل /sessions/start
router.post("/sessions/start", TeacherAttendanceController.createSession);

// Get/Update
router.get("/sessions/:id", TeacherAttendanceController.getSession);
router.patch("/sessions/:id", TeacherAttendanceController.updateSession);

// Lock/Unlock
router.patch("/sessions/:id/lock", TeacherAttendanceController.lockSession);
router.patch("/sessions/:id/unlock", TeacherAttendanceController.unlockSession);

// End (يسجل ended_at حسب الكنترولر الحالي)
router.patch("/sessions/:id/end", TeacherAttendanceController.endSession);
router.post("/sessions/:id/end", TeacherAttendanceController.endSession);

// ✅ NEW: Scan QR to mark present inside this session
router.post("/sessions/:id/scan", TeacherAttendanceController.scanMarkPresentByToken);

/* =========================
   ENTRIES (Students + Save Attendance)
========================= */
router.get("/sessions/:id/entries", TeacherAttendanceController.listEntries);
router.put("/sessions/:id/entries", TeacherAttendanceController.saveEntries);

// Aliases للتوافق مع فرونت قديم
router.get("/sessions/:id/students", TeacherAttendanceController.listEntries);
router.post("/sessions/:id/attendance", TeacherAttendanceController.saveEntries);

export default router;
