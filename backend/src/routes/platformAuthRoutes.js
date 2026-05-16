import express from "express";
import {
  loginPlatformAdmin,
  getPlatformMe,
} from "../controllers/platformAuthController.js";
import platformAuthMiddleware from "../middleware/platformAuthMiddleware.js";

const router = express.Router();

router.post("/login", loginPlatformAdmin);
router.get("/me", platformAuthMiddleware, getPlatformMe);

export default router;