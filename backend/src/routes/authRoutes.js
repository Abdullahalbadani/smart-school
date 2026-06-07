// src/routes/authRoutes.js
import { Router } from "express";
import { AuthController } from "../controllers/authController.js";
import jwt from "jsonwebtoken";
import { logAudit } from "../utils/auditLogger.js";

const router = Router();


router.post("/login", AuthController.login);

router.post("/logout", async (req, res) => {
  try {
    let token = null;
    if (req.headers.cookie) {
      const cookies = {};
      req.headers.cookie.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        if (parts.length >= 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("="));
        }
      });
      token = cookies.token;
    }
    if (!token) {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      token = match ? match[1]?.trim() : null;
    }
    if (token && process.env.JWT_SECRET) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded && decoded.id) {
        await logAudit({
          action: "LOGOUT",
          actionLabel: "تسجيل الخروج",
          module: "Security",
          tableName: "users",
          recordId: decoded.id,
          description: `قام المستخدم بتسجيل الخروج من النظام`,
          schoolIdFallback: decoded.school_id,
          userIdFallback: decoded.id,
          userNameFallback: decoded.role || "مستخدم",
          userRoleFallback: decoded.role || "system"
        });
      }
    }
  } catch (err) {
    // Ignore error, we still want to log out
  }
  res.clearCookie("token");
  return res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
});

export default router;
