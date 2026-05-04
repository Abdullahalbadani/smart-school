// src/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import UserModel from "../modules/userModel.js";

export default async function authMiddleware(req, res, next) {
  try {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is missing in environment variables");
      return res.status(500).json({
        message: "خطأ في إعدادات الخادم",
      });
    }

    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        message: "غير مصرح",
      });
    }

    const token = match[1]?.trim();

    if (!token) {
      return res.status(401).json({
        message: "توكن غير موجود",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({
        message: "الجلسة منتهية، الرجاء تسجيل الدخول",
      });
    }

    if (!decoded?.id) {
      return res.status(401).json({
        message: "توكن غير صالح",
      });
    }

    const userFromDb = await UserModel.getById(decoded.id);

    if (!userFromDb) {
      return res.status(401).json({
        message: "المستخدم لم يعد موجودًا",
      });
    }

  
    if (
      userFromDb.is_active === false ||
      String(userFromDb.status || "").toLowerCase() === "inactive" ||
      String(userFromDb.status || "").toLowerCase() === "disabled"
    ) {
      return res.status(403).json({
        message: "هذا المستخدم موقوف",
      });
    }

    if (
      userFromDb.school_status &&
      ["inactive", "disabled", "suspended"].includes(
        String(userFromDb.school_status).toLowerCase()
      )
    ) {
      return res.status(403).json({
        message: "هذه المدرسة غير مفعلة حاليًا",
      });
    }

    const currentVersion = userFromDb.token_version ?? 0;

    if (
      decoded.tokenVersion == null ||
      Number(decoded.tokenVersion) !== Number(currentVersion)
    ) {
      return res.status(401).json({
        message: "تم تحديث صلاحياتك أو بياناتك، الرجاء تسجيل الدخول من جديد",
      });
    }

   
    if (!userFromDb.school_id) {
      return res.status(403).json({
        message: "هذا المستخدم غير مرتبط بمدرسة",
      });
    }

    const requestedSchoolSlug = String(
      req.params.slug || req.headers["x-school-slug"] || ""
    )
      .trim()
      .toLowerCase();

    const userSchoolSlug = String(userFromDb.school_slug || "")
      .trim()
      .toLowerCase();

    if (requestedSchoolSlug && userSchoolSlug !== requestedSchoolSlug) {
      return res.status(403).json({
        message: "لا يمكنك الوصول إلى بيانات مدرسة أخرى",
      });
    }

    req.user = {
      id: userFromDb.id,
      school_id: userFromDb.school_id,
      school_slug: userFromDb.school_slug,

  
      role_id: userFromDb.role_id,
      role: userFromDb.role_name,

      permissions: Array.isArray(decoded.permissions)
        ? decoded.permissions
        : [],

      tokenVersion: currentVersion,
    };

    return next();
  } catch (err) {
    console.error("authMiddleware error:", err);

    return res.status(500).json({
      message: "خطأ في المصادقة",
    });
  }
}