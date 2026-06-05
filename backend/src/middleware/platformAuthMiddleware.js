import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

export default async function platformAuthMiddleware(req, res, next) {
  try {
    let token = null;

    if (req.headers.cookie) {
      try {
        const cookies = {};
        req.headers.cookie.split(";").forEach((cookie) => {
          const parts = cookie.split("=");
          if (parts.length >= 2) {
            cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("="));
          }
        });
        token = cookies.token;
      } catch (err) {
        console.error("Error parsing cookies in platformAuthMiddleware:", err);
      }
    }

    if (!token) {
      const authHeader = req.headers.authorization || "";
      token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح، التوكن غير موجود",
      });
    }

    const secret = process.env.PLATFORM_JWT_SECRET;

    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "PLATFORM_JWT_SECRET غير مضبوط في ملف البيئة",
      });
    }

    const payload = jwt.verify(token, secret);

    if (payload.type !== "platform_admin") {
      return res.status(403).json({
        success: false,
        message: "هذا التوكن غير مخصص للوحة مالك النظام",
      });
    }

    const result = await pool.query(
      `
      SELECT id, name, email, status, token_version
      FROM platform_admins
      WHERE id = $1
      LIMIT 1
      `,
      [payload.id]
    );

    const admin = result.rows[0];

    if (!admin || admin.status !== "active") {
      return res.status(401).json({
        success: false,
        message: "حساب مالك النظام غير مفعل",
      });
    }

    if (Number(admin.token_version) !== Number(payload.token_version)) {
      return res.status(401).json({
        success: false,
        message: "انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد",
      });
    }

    req.platformAdmin = admin;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "جلسة غير صالحة أو منتهية",
    });
  }
}