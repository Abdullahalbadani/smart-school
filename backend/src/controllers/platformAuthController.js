import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

function getRequestMeta(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ipAddress = String(
    (Array.isArray(forwarded) ? forwarded[0] : forwarded) ||
      req.ip ||
      req.socket?.remoteAddress ||
      "127.0.0.1"
  )
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "");

  return {
    ipAddress: ipAddress === "::1" ? "127.0.0.1" : ipAddress,
    userAgent: req.headers?.["user-agent"] || null,
  };
}

async function logPlatformAuth({
  req,
  platformAdminId = null,
  action,
  description,
  metadata = {},
}) {
  try {
    const { ipAddress, userAgent } = getRequestMeta(req);
    await pool.query(
      `
      INSERT INTO platform_activity_logs
      (platform_admin_id, action, entity_type, entity_id, description, metadata, ip_address, user_agent)
      VALUES ($1, $2, 'platform_admin', $3, $4, $5::jsonb, $6, $7)
      `,
      [
        platformAdminId,
        action,
        platformAdminId,
        description,
        JSON.stringify(metadata || {}),
        ipAddress,
        userAgent,
      ]
    );
  } catch (error) {
    // فشل التسجيل لا يمنع المصادقة نفسها، لكنه يظهر بوضوح في سجل الخادم.
    console.error("platform auth log error:", error.message);
  }
}

function extractPlatformToken(req) {
  const cookieHeader = req.headers?.cookie || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]*)/);
  if (cookieMatch) return decodeURIComponent(cookieMatch[1]);

  const authHeader = req.headers?.authorization || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1]?.trim() : null;
}

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
      await logPlatformAuth({
        req,
        action: "LOGIN_FAILED",
        description: `محاولة دخول فاشلة إلى إدارة المنصة باستخدام البريد (${String(email).trim()})`,
        metadata: { result: "failure", reason: "account_not_found", severity: "important" },
      });

      return res.status(401).json({
        success: false,
        message: "بيانات الدخول غير صحيحة",
      });
    }

    if (admin.status !== "active") {
      await logPlatformAuth({
        req,
        platformAdminId: admin.id,
        action: "LOGIN_FAILED",
        description: `رفض دخول مالك النظام (${admin.email}) لأن الحساب غير مفعل`,
        metadata: { result: "failure", reason: "inactive_account", severity: "sensitive" },
      });

      return res.status(403).json({
        success: false,
        message: "حساب مالك النظام غير مفعل",
      });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (!isValid) {
      await logPlatformAuth({
        req,
        platformAdminId: admin.id,
        action: "LOGIN_FAILED",
        description: `محاولة دخول فاشلة إلى إدارة المنصة للحساب (${admin.email}) - كلمة مرور خاطئة`,
        metadata: { result: "failure", reason: "wrong_password", severity: "important" },
      });

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

    await logPlatformAuth({
      req,
      platformAdminId: admin.id,
      action: "LOGIN_SUCCESS",
      description: `سجل مالك النظام (${admin.email}) الدخول إلى إدارة المنصة بنجاح`,
      metadata: { result: "success", severity: "normal" },
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    });

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

export async function logoutPlatformAdmin(req, res) {
  try {
    const secret = process.env.PLATFORM_JWT_SECRET;
    const token = extractPlatformToken(req);

    if (secret && token) {
      const decoded = jwt.verify(token, secret);
      if (decoded?.id) {
        await logPlatformAuth({
          req,
          platformAdminId: decoded.id,
          action: "LOGOUT",
          description: `سجل مالك النظام (${decoded.email || decoded.id}) الخروج من إدارة المنصة`,
          metadata: { result: "success", severity: "normal" },
        });
      }
    }
  } catch (error) {
    // تسجيل الخروج المحلي يستمر حتى إذا انتهت صلاحية التوكن.
    console.warn("platform logout audit warning:", error.message);
  }

  res.clearCookie("token");
  return res.json({ success: true, message: "تم تسجيل الخروج بنجاح" });
}

export async function getPlatformMe(req, res) {
  return res.json({
    success: true,
    admin: req.platformAdmin,
  });
}
