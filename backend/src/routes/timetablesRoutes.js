import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import TimetablesController from "../controllers/timetablesController.js";

const router = Router();

// =========================
// Meta / Lists
// =========================
router.get("/meta", authMiddleware, TimetablesController.meta);
router.get("/list", authMiddleware, TimetablesController.list);
router.get("/teachers", authMiddleware, TimetablesController.teachersBySubject);

// ✅ فحص تعارض المعلم قبل الحفظ
// لازم يكون قبل /:id
router.get(
  "/check-teacher-conflict",
  authMiddleware,
  TimetablesController.checkTeacherConflict
);

// =========================
// Create / Copy
// =========================
router.post("/get-or-create", authMiddleware, TimetablesController.getOrCreate);
router.post("/:id/copy-from", authMiddleware, TimetablesController.copyFrom);

// =========================
// Publish / Unpublish
// =========================
router.put("/:id/publish", authMiddleware, TimetablesController.publish);
router.put("/:id/unpublish", authMiddleware, TimetablesController.unpublish);

// =========================
// Weekly template entries
// =========================
router.put("/:id/entries", authMiddleware, TimetablesController.saveEntries);
router.delete("/:id/entries", authMiddleware, TimetablesController.clearEntries);

// =========================
// Overrides (اختبارات / إلغاء / استثناءات أسبوعية)
// =========================
router.get("/:id/overrides", authMiddleware, TimetablesController.listOverrides);
router.put("/:id/overrides", authMiddleware, TimetablesController.upsertOverride);
router.delete("/:id/overrides", authMiddleware, TimetablesController.deleteOverride);

// إذا أردت تأكيد/تحديث استثناءات أسبوع معين
router.put(
  "/:id/overrides/publish-week",
  authMiddleware,
  TimetablesController.publishWeekOverrides
);

// =========================
// Delete timetable
// =========================
router.delete("/:id", authMiddleware, TimetablesController.remove);

// =========================
// Get timetable + entries
// لازم يكون الأخير
// =========================
router.get("/:id", authMiddleware, TimetablesController.getById);

export default router;