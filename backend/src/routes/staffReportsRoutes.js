// backend/src/routes/staffReportsRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { StaffReportsController } from "../controllers/staffReportsController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/summary", StaffReportsController.summary);
router.get("/", StaffReportsController.list);
router.get("/:employeeId/profile", StaffReportsController.profile);

export default router;