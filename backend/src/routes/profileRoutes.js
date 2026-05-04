// src/routes/profileRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getMyProfile,
  changePassword,
  changeEmail,
} from "../controllers/profileController.js";

const router = Router();

router.use(authMiddleware);

// GET /api/profile/me
router.get("/me", getMyProfile);

// PUT /api/profile/password
router.put("/password", changePassword);

// PUT /api/profile/email
router.put("/email", changeEmail);

export default router;