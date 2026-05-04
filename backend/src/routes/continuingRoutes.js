// src/routes/continuingRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { ContinuingController } from "../controllers/continuingController.js";

const router = express.Router();

router.get("/continuing/eligible", authMiddleware, ContinuingController.getEligible);
router.post("/continuing/preview", authMiddleware, ContinuingController.preview);
router.post("/continuing/register-bulk", authMiddleware, ContinuingController.registerBulk);

export default router;
