// src/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import UserModel from "../modules/userModel.js";
import { pool } from "../config/db.js";

function subscriptionBlockedResponse(res, code, message, school) {
  const params = new URLSearchParams({
    code,
    school: school?.name_ar || school?.name_en || school?.slug || "",
    status: school?.subscription_status || "",
    plan: school?.subscription_plan || "",
    trial_ends_at: school?.trial_ends_at
      ? new Date(school.trial_ends_at).toISOString()
      : "",
    subscription_ends_at: school?.subscription_ends_at
      ? new Date(school.subscription_ends_at).toISOString()
      : "",
  });

  return res.status(403).json({
    success: false,
    message,
    code,
    redirect_url: `/frontend/subscription/expired.html?${params.toString()}`,
    school,
  });
}

export default async function authMiddleware(req, res, next) {
  try {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is missing in environment variables");
      return res.status(500).json({
        success: false,
        message: "خطأ في إعدادات الخادم",
      });
    }

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
        console.error("Error parsing cookies in authMiddleware:", err);
      }
    }

    if (!token) {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      token = match ? match[1]?.trim() : null;
    }

    if (!token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح، التوكن غير موجود",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "الجلسة منتهية، الرجاء تسجيل الدخول",
      });
    }

    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: "توكن غير صالح",
      });
    }

    const userFromDb = await UserModel.getById(decoded.id);

    if (!userFromDb) {
      return res.status(401).json({
        success: false,
        message: "المستخدم لم يعد موجودًا",
      });
    }

    if (
      userFromDb.is_active === false ||
      String(userFromDb.status || "").toLowerCase() === "inactive" ||
      String(userFromDb.status || "").toLowerCase() === "disabled"
    ) {
      return res.status(403).json({
        success: false,
        message: "هذا المستخدم موقوف",
      });
    }

    const currentVersion = userFromDb.token_version ?? 0;

    if (
      decoded.tokenVersion == null ||
      Number(decoded.tokenVersion) !== Number(currentVersion)
    ) {
      return res.status(401).json({
        success: false,
        message: "تم تحديث صلاحياتك أو بياناتك، الرجاء تسجيل الدخول من جديد",
      });
    }

    if (!userFromDb.school_id) {
      return res.status(403).json({
        success: false,
        message: "هذا المستخدم غير مرتبط بمدرسة",
      });
    }

    const schoolResult = await pool.query(
      `
      SELECT
        id,
        name_ar,
        name_en,
        slug,
        is_active,
        subscription_status,
        subscription_plan,
        trial_ends_at,
        subscription_ends_at
      FROM schools
      WHERE id = $1
      LIMIT 1
      `,
      [userFromDb.school_id]
    );

    const school = schoolResult.rows[0];

    if (!school) {
      return res.status(403).json({
        success: false,
        message: "المدرسة غير موجودة",
        code: "SCHOOL_NOT_FOUND",
      });
    }

    const subscriptionStatus = String(
      school.subscription_status || ""
    ).toLowerCase();

    const subscriptionPlan = String(
      school.subscription_plan || ""
    ).toLowerCase();

    if (subscriptionStatus === "suspended") {
      return subscriptionBlockedResponse(
        res,
        "SCHOOL_SUSPENDED",
        "تم إيقاف اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
        school
      );
    }

    if (subscriptionStatus === "cancelled") {
      return subscriptionBlockedResponse(
        res,
        "SCHOOL_CANCELLED",
        "تم إلغاء اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
        school
      );
    }

    if (subscriptionStatus === "expired") {
      return subscriptionBlockedResponse(
        res,
        "SCHOOL_EXPIRED",
        "انتهى اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
        school
      );
    }

    if (!school.is_active) {
      return subscriptionBlockedResponse(
        res,
        "SCHOOL_INACTIVE",
        "تم إيقاف المدرسة، يرجى التواصل مع إدارة النظام",
        school
      );
    }

    if (
      userFromDb.school_status &&
      ["inactive", "disabled", "suspended"].includes(
        String(userFromDb.school_status).toLowerCase()
      )
    ) {
      return subscriptionBlockedResponse(
        res,
        "SCHOOL_INACTIVE",
        "هذه المدرسة غير مفعلة حاليًا",
        school
      );
    }

    const now = new Date();

    const trialExpired =
      subscriptionStatus === "trial" &&
      school.trial_ends_at &&
      new Date(school.trial_ends_at) < now;

    const subscriptionExpired =
      subscriptionStatus === "active" &&
      subscriptionPlan !== "lifetime" &&
      school.subscription_ends_at &&
      new Date(school.subscription_ends_at) < now;

    if (trialExpired || subscriptionExpired) {
      await pool.query(
        `
        UPDATE schools
        SET
          subscription_status = 'expired',
          is_active = false,
          updated_at = NOW()
        WHERE id = $1
        `,
        [school.id]
      );

      return subscriptionBlockedResponse(
        res,
        "SUBSCRIPTION_EXPIRED",
        "انتهت مدة استخدام النظام، يرجى التواصل مع إدارة النظام",
        {
          ...school,
          is_active: false,
          subscription_status: "expired",
        }
      );
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
        success: false,
        message: "لا يمكنك الوصول إلى بيانات مدرسة أخرى",
      });
    }

    req.user = {
      id: userFromDb.id,
      school_id: userFromDb.school_id,
      school_slug: userFromDb.school_slug,
      name: userFromDb.name || userFromDb.full_name || userFromDb.username || "مستخدم",
      username: userFromDb.username,

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
      success: false,
      message: "خطأ في المصادقة",
    });
  }
}