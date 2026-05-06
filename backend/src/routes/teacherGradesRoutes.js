import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getGradeEntry,
  saveGradeEntry,
  publishGradeEntry,
  listReopenRequests,
  createReopenRequest,
  submitMuhassala,
  getMonthlyWorkControlStatuses,
  getTermWorkControlStatus,
} from "../controllers/teacherGradesController.js";

const router = express.Router();

// مهم جدًا: كل مسارات درجات المعلم تحتاج req.user
router.use(authMiddleware);

router.get("/monthly-work-statuses", getMonthlyWorkControlStatuses);
router.get("/term-work-status", getTermWorkControlStatus);

router.get("/entry", getGradeEntry);
router.post("/entry/save", saveGradeEntry);
router.post("/entry/publish", publishGradeEntry);

router.post("/muhassala/submit", submitMuhassala);

router.get("/reopen-requests", listReopenRequests);
router.post("/reopen-requests", createReopenRequest);

export default router;