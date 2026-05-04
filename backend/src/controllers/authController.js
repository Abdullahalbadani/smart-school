// src/controllers/authController.js
import UserModel from "../modules/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import PermissionRoleModel from "../modules/permissionRoleModel.js";
import { getPortalsSettings } from "../modules/schoolSettingsModel.js"; // ✅ استيراد إعدادات البوابات

export const AuthController = {
  async login(req, res) {
    try {
      const slug = String(req.body.slug || "").trim().toLowerCase();
      const loginValue = String(req.body.login || req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");

      if (!slug || !loginValue || !password) {
        return res.status(400).json({
          message: "الرجاء إدخال معرف المدرسة واسم المستخدم أو البريد وكلمة المرور",
        });
      }

      const user = await UserModel.getByLoginAndSchoolSlug(slug, loginValue);

      if (!user) {
        return res.status(401).json({
          message: "بيانات الدخول غير صحيحة",
        });
      }

      if (!user.school_is_active) {
        return res.status(403).json({
          message: "هذه المدرسة غير مفعلة حاليًا",
        });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({
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
          message: "هذا الحساب معطل. راجع إدارة المدرسة.",
        });
      }

      if (!user.role_name || !user.role_id) {
        return res.status(403).json({
          message: "هذا الحساب ليس لديه صلاحيات دخول",
        });
      }

      // ==========================================
      // 🛡️ حارس البوابات (نظام التحكم في الوصول)
      // ==========================================
      const portalSettings = await getPortalsSettings(user.school_id);
      if (portalSettings) {
        const role = String(user.role_name || "").toLowerCase();

        // 1. التحقق من بوابة المعلمين
        if (role.includes("teacher") || role.includes("معلم") || role.includes("مدرس")) {
          if (!portalSettings.allow_teacher_portal) {
            return res.status(403).json({
              message: "عفواً، بوابة المعلمين معطلة حالياً من قبل الإدارة.",
            });
          }
        }

        // 2. التحقق من بوابة أولياء الأمور
        if (role.includes("parent") || role.includes("أب") || role.includes("ولي أمر")) {
          if (!portalSettings.allow_parent_portal) {
            return res.status(403).json({
              message: "عفواً، بوابة أولياء الأمور معطلة حالياً من قبل الإدارة.",
            });
          }
        }
      }
      // ==========================================

      const permissionCodes =
        await PermissionRoleModel.getPermissionCodesForRole(user.role_id);

      const permissions = Array.isArray(permissionCodes) ? permissionCodes : [];
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

      return res.json({
        message: "تم تسجيل الدخول بنجاح",
        token,
        // ✅ تم إضافة بيانات المدرسة والشعار داخل الـ user لكي يحفظها المتصفح فوراً
        user: {
          id: user.id,
          school_id: user.school_id,
          name: user.name || user.full_name || user.username,
          email: user.email,
          username: user.username,
          phone: user.phone,
          role: user.role_name,
          role_id: user.role_id,
          permissions,
          // بيانات المدرسة:
          school_slug: user.school_slug,
          school_name_ar: user.school_name_ar,
          school_name_en: user.school_name_en,
          logo_url: user.logo_url || user.school_logo_url // 👈 السطر السحري للشعار
        },
        school: {
          id: user.school_id,
          slug: user.school_slug,
          name_ar: user.school_name_ar,
          name_en: user.school_name_en,
          logo_url: user.logo_url || user.school_logo_url
        },
      });
    } catch (err) {
      console.error("❌ خطأ في السيرفر أثناء تسجيل الدخول:", err);
      return res.status(500).json({
        message: "خطأ في السيرفر أثناء تسجيل الدخول",
      });
    }
  },
};