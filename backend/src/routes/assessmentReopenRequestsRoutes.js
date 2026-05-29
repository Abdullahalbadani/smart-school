// src/routes/assessmentReopenRequestsRoutes.js
import { Router } from "express";
import { AssessmentReopenRequestsController } from "../controllers/assessmentReopenRequestsController.js";

const router = Router();

router.get("/", AssessmentReopenRequestsController.list);

router.post("/:id/approve", AssessmentReopenRequestsController.approve);

router.post("/:id/reject", AssessmentReopenRequestsController.reject);

export default router;