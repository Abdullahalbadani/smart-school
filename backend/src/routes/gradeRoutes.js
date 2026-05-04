import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import loadPermissions from "../middleware/loadPermissions.js";
import checkPermission from "../middleware/checkPermission.js";
import { getGrades } from "../controllers/gradeController.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  loadPermissions,
  // checkPermission("grades.view"),
  getGrades
);

export default router;