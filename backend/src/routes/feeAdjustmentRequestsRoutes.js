// src/routes/feeAdjustmentRequestsRoutes.js
import { Router } from "express";
import { FeeAdjustmentRequestsController } from "../controllers/feeAdjustmentRequestsController.js";

const router = Router();

router.get("/", FeeAdjustmentRequestsController.list);

router.post("/", FeeAdjustmentRequestsController.create);

router.post("/:id/approve", FeeAdjustmentRequestsController.approve);

router.post("/:id/reject", FeeAdjustmentRequestsController.reject);

export default router;