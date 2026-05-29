// backend/src/routes/studentReportsRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { StudentReportsController } from "../controllers/studentReportsController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/summary", StudentReportsController.summary);
router.get("/", StudentReportsController.list);
router.get("/:studentId/profile", StudentReportsController.profile);

export default router;