import express from "express";
import {
  loginPlatformAdmin,
  getPlatformMe,
} from "../controllers/platformAuthController.js";
import platformAuthMiddleware from "../middleware/platformAuthMiddleware.js";

const router = express.Router();



router.post("/login",  loginPlatformAdmin);
router.get("/me", platformAuthMiddleware, getPlatformMe);

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
});

export default router;