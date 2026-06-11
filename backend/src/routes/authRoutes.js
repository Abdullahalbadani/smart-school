// src/routes/authRoutes.js
import { Router } from "express";
import jwt from "jsonwebtoken";
import { AuthController } from "../controllers/authController.js";
import { pool } from "../config/db.js";
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
        if (parts.length >= 2) cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("="));
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
      if (decoded?.id && decoded?.school_id) {
        const userResult = await pool.query(
          `
            SELECT id, name, username
            FROM users
            WHERE id = $1 AND school_id = $2
            LIMIT 1
          `,
          [decoded.id, decoded.school_id]
        );
        const user = userResult.rows[0] || {};
        const actorName = user.name || user.username || `المستخدم رقم ${decoded.id}`;

        await logAudit({
          req,
          action: "LOGOUT",
          actionLabel: "تسجيل الخروج",
          module: "Security",
          moduleLabel: "الأمان وتسجيل الدخول",
          tableName: "users",
          recordId: decoded.id,
          description: `قام المستخدم (${actorName}) بتسجيل الخروج من النظام`,
          metadata: {
            severity: "normal",
            result: "success",
          },
          eventKey: "LOGOUT",
          schoolIdFallback: decoded.school_id,
          userIdFallback: decoded.id,
          userNameFallback: actorName,
          userRoleFallback: decoded.role || "system",
          statusCode: 200,
        });
      }
    }
  } catch (err) {
    // حتى عند انتهاء التوكن أو فشل قراءة بياناته يجب إكمال تسجيل الخروج محليًا.
    console.warn("logout audit warning:", err.message);
  }

  res.clearCookie("token");
  return res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
});

export default router;
