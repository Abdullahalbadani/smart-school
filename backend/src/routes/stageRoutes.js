import { Router } from "express";
import  authMiddleware  from "../middleware/authMiddleware.js";
import  checkPermission  from "../middleware/checkPermission.js";
import { getStages } from "../controllers/stageController.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  checkPermission("view_academic_years"), // مؤقتاً نستخدم صلاحية عامة
  getStages
);

export default router;
