// backend/src/routes/parentPermissionsRoutes.js
import { Router } from "express";
import {
  createPermission,
  getPermissionForDay,
} from "../controllers/parentPermissionsController.js";

const router = Router();

// /api/parent/permissions
router.get("/permissions", getPermissionForDay);
router.post("/permissions", createPermission);

export default router;
