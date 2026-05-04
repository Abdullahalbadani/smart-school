import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import ExamTimetablesController from "../controllers/examTimetablesController.js";

const router = Router();

// ✅ Meta (dropdowns)
router.get("/meta", authMiddleware, ExamTimetablesController.meta);

// ✅ List (لازم قبل /:id)
router.get("/list", authMiddleware, ExamTimetablesController.list);

// Get or create timetable header
router.post("/get-or-create", authMiddleware, ExamTimetablesController.getOrCreate);

// Copy from another exam timetable
router.post("/:id/copy-from", authMiddleware, ExamTimetablesController.copyFrom);

// Publish / Unpublish
router.put("/:id/publish", authMiddleware, ExamTimetablesController.publish);
router.put("/:id/unpublish", authMiddleware, ExamTimetablesController.unpublish);

// Save draft entries (bulk replace)
router.put("/:id/entries", authMiddleware, ExamTimetablesController.saveEntries);

// Clear entries
router.delete("/:id/entries", authMiddleware, ExamTimetablesController.clearEntries);

// Delete timetable (draft only)
router.delete("/:id", authMiddleware, ExamTimetablesController.remove);

// Get timetable + entries
router.get("/:id", authMiddleware, ExamTimetablesController.getById);

export default router;
