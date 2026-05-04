// src/routes/periodsRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { listPeriods, createPeriod, updatePeriod, deletePeriod } from "../controllers/periodsController.js";

const router = express.Router();

router.get("/", authMiddleware, listPeriods);
router.post("/", authMiddleware, createPeriod);
router.put("/:id", authMiddleware, updatePeriod);
router.delete("/:id", authMiddleware, deletePeriod);

export default router;
