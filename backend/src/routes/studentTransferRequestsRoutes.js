// src/routes/studentTransferRequestsRoutes.js
import { Router } from "express";
import { StudentTransferRequestsController } from "../controllers/studentTransferRequestsController.js";

const router = Router();

router.get("/", StudentTransferRequestsController.list);

router.post("/", StudentTransferRequestsController.create);

router.post("/:id/approve", StudentTransferRequestsController.approve);

router.post("/:id/reject", StudentTransferRequestsController.reject);

export default router;