import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { AdminTeacherPermitsController } from "../controllers/adminTeacherPermitsController.js";

const router = express.Router();
router.use(authMiddleware);


// list + count
// نظام عين الصقر للحصص المرفوضة
router.get("/alerts/rejected-subs", AdminTeacherPermitsController.getRejectedSubsAlerts);
router.get("/", AdminTeacherPermitsController.list); // ?status=&from=&to=&q=&count=1
router.get("/:id", AdminTeacherPermitsController.getOne);
router.patch("/:id/decision", AdminTeacherPermitsController.decide); // {status, decision_note}

export default router;
