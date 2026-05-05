import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getGradeEntry,
  saveGradeEntry,
  publishGradeEntry,
  listReopenRequests,
  createReopenRequest,
  submitMuhassala ,
  getMonthlyWorkControlStatuses,
  getTermWorkControlStatus
} from "../controllers/teacherGradesController.js";

const router = express.Router();
router.get("/monthly-work-statuses", getMonthlyWorkControlStatuses);
router.get("/term-work-status", getTermWorkControlStatus);
router.use(authMiddleware);

router.get("/entry", getGradeEntry);
router.post("/entry/save", saveGradeEntry);
router.post("/entry/publish", publishGradeEntry);

// المسار الخاص باعتماد المحصلة ورفعها للإدارة
router.post("/muhassala/submit", submitMuhassala);

router.get("/reopen-requests", listReopenRequests);
router.post("/reopen-requests", createReopenRequest);

export default router;