import express from "express";
import {
  loginPlatformAdmin,
  logoutPlatformAdmin,
  getPlatformMe,
} from "../controllers/platformAuthController.js";
import platformAuthMiddleware from "../middleware/platformAuthMiddleware.js";

const router = express.Router();



router.post("/login",  loginPlatformAdmin);
router.get("/me", platformAuthMiddleware, getPlatformMe);

router.post("/logout", logoutPlatformAdmin);

export default router;