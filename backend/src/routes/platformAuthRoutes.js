import express from "express";
import {
  loginPlatformAdmin,
  getPlatformMe,
} from "../controllers/platformAuthController.js";
import platformAuthMiddleware from "../middleware/platformAuthMiddleware.js";
import { rateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

const platformLoginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10, // الحد الأقصى 10 محاولات
  message: "لقد قمت بمحاولات تسجيل دخول كثيرة جداً. يرجى المحاولة بعد 15 دقيقة."
});

router.post("/login", platformLoginLimiter, loginPlatformAdmin);
router.get("/me", platformAuthMiddleware, getPlatformMe);

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
});

export default router;