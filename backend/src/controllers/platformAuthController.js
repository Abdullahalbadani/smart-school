import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

export async function loginPlatformAdmin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "البريد وكلمة المرور مطلوبان",
      });
    }

    const result = await pool.query(
      `
      SELECT id, name, email, password_hash, status, token_version
      FROM platform_admins
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    const admin = result.rows[0];

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "بيانات الدخول غير صحيحة",
      });
    }

    if (admin.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "حساب مالك النظام غير مفعل",
      });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "بيانات الدخول غير صحيحة",
      });
    }

    const secret = process.env.PLATFORM_JWT_SECRET;

    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "PLATFORM_JWT_SECRET غير مضبوط",
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        type: "platform_admin",
        token_version: admin.token_version,
      },
      secret,
      { expiresIn: "12h" }
    );

    await pool.query(
      `
      UPDATE platform_admins
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [admin.id]
    );

    return res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error("loginPlatformAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تسجيل الدخول",
    });
  }
}

export async function getPlatformMe(req, res) {
  return res.json({
    success: true,
    admin: req.platformAdmin,
  });
}