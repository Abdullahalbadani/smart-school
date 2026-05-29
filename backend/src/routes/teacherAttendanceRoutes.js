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
   SESSIONS (Today Slots + Frontend Aliases)
   مهم:
   هذه المسارات يجب أن تكون قبل /sessions/:id
========================= */

// الواجهة تطلب:
// GET /api/teacher/attendance/sessions?academicYearId=6&term=1
router.get("/sessions", TeacherAttendanceController.sessionSlots);

// الرابط القديم/الأصلي
router.get("/sessions/slots", TeacherAttendanceController.sessionSlots);

// الواجهة تطلب:
// GET /api/teacher/attendance/sessions/history?academicYearId=6&term=1
router.get("/sessions/history", TeacherAttendanceController.historySearch);

// الواجهة تطلب:
// GET /api/teacher/attendance/sessions/log?academicYearId=6&term=1
router.get("/sessions/log", TeacherAttendanceController.historySearch);

/* =========================
   PERMITS (Parent requests / excuses)
   - مسارات واضحة + Aliases للتوافق
========================= */
router.get("/permits", TeacherAttendanceController.permitsList);
router.get("/permits/approved", TeacherAttendanceController.permitsApproved);
router.get("/permits/excuses", TeacherAttendanceController.permitsExcuses);
router.get("/permits/map", TeacherAttendanceController.permitsMap);

// Aliases لو الفرونت يستخدمها
router.get("/approved", TeacherAttendanceController.permitsApproved);
router.get("/excuses", TeacherAttendanceController.permitsExcuses);

/* =========================
   HISTORY + REPORTS
========================= */

// الرابط العام القديم:
// GET /api/teacher/attendance/history
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
// مهم جدًا:
// هذا يجب أن يبقى بعد /sessions/history و /sessions/log
// حتى لا يعتبر Express كلمة history أو log أنها id
router.get("/sessions/:id", TeacherAttendanceController.getSession);
router.patch("/sessions/:id", TeacherAttendanceController.updateSession);

// Lock/Unlock
router.patch("/sessions/:id/lock", TeacherAttendanceController.lockSession);
router.patch("/sessions/:id/unlock", TeacherAttendanceController.unlockSession);

// End
router.patch("/sessions/:id/end", TeacherAttendanceController.endSession);
router.post("/sessions/:id/end", TeacherAttendanceController.endSession);

// Scan QR to mark present inside this session
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