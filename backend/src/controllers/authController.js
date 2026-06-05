// src/controllers/authController.js
import UserModel from "../modules/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import PermissionRoleModel from "../modules/permissionRoleModel.js";
import { getPortalsSettings } from "../modules/schoolSettingsModel.js";
import { pool } from "../config/db.js";
import { logAudit } from "../utils/auditLogger.js";

function buildSubscriptionRedirectUrl(school, code) {
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

  return `/frontend/subscription/expired.html?${params.toString()}`;
}

function blockedSchoolLoginResponse(res, code, message, school) {
  return res.status(403).json({
    success: false,
    message,
    code,
    redirect_url: buildSubscriptionRedirectUrl(school, code),
    school: {
      id: school?.id,
      name_ar: school?.name_ar,
      name_en: school?.name_en,
      slug: school?.slug,
      is_active: school?.is_active,
      subscription_status: school?.subscription_status,
      subscription_plan: school?.subscription_plan,
      trial_ends_at: school?.trial_ends_at,
      subscription_ends_at: school?.subscription_ends_at,
    },
  });
}

async function getFullSchoolForLogin(schoolId, slug) {
  if (schoolId) {
    const result = await pool.query(
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
      [schoolId]
    );

    return result.rows[0] || null;
  }

  const result = await pool.query(
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
    WHERE LOWER(slug) = LOWER($1)
    LIMIT 1
    `,
    [slug]
  );

  return result.rows[0] || null;
}

async function checkSchoolAccessForLogin(res, school) {
  if (!school) {
    return res.status(401).json({
      success: false,
      message: "بيانات الدخول غير صحيحة",
    });
  }

  const subscriptionStatus = String(
    school.subscription_status || ""
  ).toLowerCase();

  const subscriptionPlan = String(
    school.subscription_plan || ""
  ).toLowerCase();

  if (subscriptionStatus === "suspended") {
    return blockedSchoolLoginResponse(
      res,
      "SCHOOL_SUSPENDED",
      "تم إيقاف اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
      school
    );
  }

  if (subscriptionStatus === "cancelled") {
    return blockedSchoolLoginResponse(
      res,
      "SCHOOL_CANCELLED",
      "تم إلغاء اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
      school
    );
  }

  if (subscriptionStatus === "expired") {
    return blockedSchoolLoginResponse(
      res,
      "SCHOOL_EXPIRED",
      "انتهى اشتراك المدرسة، يرجى التواصل مع إدارة النظام",
      school
    );
  }

  if (!school.is_active) {
    return blockedSchoolLoginResponse(
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

    return blockedSchoolLoginResponse(
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

  return null;
}

export const AuthController = {
  async login(req, res) {
    try {
      const slug = String(req.body.slug || "").trim().toLowerCase();
      const loginValue = String(req.body.login || req.body.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body.password || "");

      if (!slug || !loginValue || !password) {
        return res.status(400).json({
          success: false,
          message:
            "الرجاء إدخال معرف المدرسة واسم المستخدم أو البريد وكلمة المرور",
        });
      }

      const user = await UserModel.getByLoginAndSchoolSlug(slug, loginValue);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "بيانات الدخول غير صحيحة",
        });
      }

      const school = await getFullSchoolForLogin(user.school_id, slug);
      const blockedSchoolResponse = await checkSchoolAccessForLogin(
        res,
        school
      );

      if (blockedSchoolResponse) {
        return blockedSchoolResponse;
      }

      const match = await bcrypt.compare(password, user.password_hash);

      if (!match) {
        await logAudit({
          req,
          action: "LOGIN",
          actionLabel: "فشل تسجيل الدخول",
          module: "Security",
          tableName: "users",
          recordId: user.id,
          description: `محاولة تسجيل دخول فاشلة للمستخدم (${user.username}) - كلمة مرور خاطئة`,
          schoolIdFallback: user.school_id,
          userIdFallback: user.id,
          userNameFallback: user.name || user.full_name || user.username || "مستخدم",
          userRoleFallback: user.role_name || "system"
        });
        return res.status(401).json({
          success: false,
          message: "بيانات الدخول غير صحيحة",
        });
      }

      const status = String(user.status ?? "").toLowerCase().trim();

      const isActive =
        user.is_active !== undefined && user.is_active !== null
          ? !!user.is_active
          : status
          ? status === "active"
          : true;

      if (!isActive) {
        return res.status(403).json({
          success: false,
          message: "هذا الحساب معطل. راجع إدارة المدرسة.",
        });
      }

      if (!user.role_name || !user.role_id) {
        return res.status(403).json({
          success: false,
          message: "هذا الحساب ليس لديه صلاحيات دخول",
        });
      }

      const portalSettings = await getPortalsSettings(user.school_id);

      if (portalSettings) {
        const role = String(user.role_name || "").toLowerCase();

        if (
          role.includes("teacher") ||
          role.includes("معلم") ||
          role.includes("مدرس")
        ) {
          if (portalSettings.allow_teacher_portal === false) {
            return res.status(403).json({
              success: false,
              message:
                "عفوًا، بوابة المعلمين معطلة حاليًا من قبل الإدارة.",
            });
          }
        }

        if (
          role.includes("parent") ||
          role.includes("أب") ||
          role.includes("ولي أمر")
        ) {
          if (portalSettings.allow_parent_portal === false) {
            return res.status(403).json({
              success: false,
              message:
                "عفوًا، بوابة أولياء الأمور معطلة حاليًا من قبل الإدارة.",
            });
          }
        }

        if (role.includes("student") || role.includes("طالب")) {
          if (portalSettings.allow_student_portal === false) {
            return res.status(403).json({
              success: false,
              message:
                "عفوًا، بوابة الطلاب معطلة حاليًا من قبل الإدارة.",
            });
          }
        }
      }

      const permissionCodes =
        await PermissionRoleModel.getPermissionCodesForRole(user.role_id);

      const permissions = Array.isArray(permissionCodes)
        ? permissionCodes
        : [];

      const tokenVersion = user.token_version ?? 0;

      const payload = {
        id: user.id,
        school_id: user.school_id,
        school_slug: user.school_slug,
        role_id: user.role_id,
        role: user.role_name,
        permissions,
        tokenVersion,
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      await logAudit({
        req,
        action: "LOGIN",
        actionLabel: "تسجيل دخول ناجح",
        module: "Security",
        tableName: "users",
        recordId: user.id,
        newData: { username: user.username, role: user.role_name },
        description: `قام المستخدم (${user.username}) بتسجيل الدخول إلى النظام بنجاح`,
        schoolIdFallback: user.school_id,
        userIdFallback: user.id,
        userNameFallback: user.name || user.full_name || user.username || "مستخدم",
        userRoleFallback: user.role_name || "system"
      });

      return res.json({
        success: true,
        message: "تم تسجيل الدخول بنجاح",
        token,
        user: {
          id: user.id,
          school_id: user.school_id,

          name: user.name || user.full_name || user.username,
          email: user.email,
          username: user.username,
          phone: user.phone,

          role: user.role_name,
          role_name: user.role_name,
          role_id: user.role_id,

          permissions,

          school_slug: user.school_slug,
          school_name_ar: user.school_name_ar,
          school_name_en: user.school_name_en,
          logo_url: user.logo_url || user.school_logo_url,
        },
        school: {
          id: user.school_id,
          slug: user.school_slug,
          name_ar: user.school_name_ar,
          name_en: user.school_name_en,
          logo_url: user.logo_url || user.school_logo_url,
        },
      });
    } catch (err) {
      console.error("❌ خطأ في السيرفر أثناء تسجيل الدخول:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في السيرفر أثناء تسجيل الدخول",
      });
    }
  },
};