// src/controllers/profileController.js
import bcrypt from "bcrypt";
import UserModel from "../modules/userModel.js";
import { pool } from "../config/db.js";

// 👤 جلب بيانات المستخدم الحالي
export const getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const user = await UserModel.getById(userId);

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    if (user.school_id !== schoolId) {
      return res.status(403).json({ message: "لا يمكنك الوصول إلى هذا الحساب" });
    }

    return res.json({
      id: user.id,
      school_id: user.school_id,
      school_slug: user.school_slug,
      school_name_ar: user.school_name_ar,
      school_name_en: user.school_name_en,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      status: user.status,
      role_id: user.role_id,
      role: user.role_name,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error("getMyProfile error:", err);
    return res.status(500).json({
      message: "حدث خطأ في الخادم أثناء جلب بيانات الحساب",
    });
  }
};

// 🔑 تغيير كلمة المرور
export const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    const { currentPassword, newPassword } = req.body;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "الرجاء إدخال كلمة المرور الحالية والجديدة",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف",
      });
    }

    const user = await UserModel.getById(userId);

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    if (user.school_id !== schoolId) {
      return res.status(403).json({ message: "لا يمكنك تعديل هذا الحساب" });
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);

    if (!ok) {
      return res.status(400).json({
        message: "كلمة المرور الحالية غير صحيحة",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          token_version = COALESCE(token_version, 0) + 1,
          updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      `,
      [hashed, userId, schoolId]
    );

    return res.json({
      message: "تم تحديث كلمة المرور بنجاح، يرجى تسجيل الدخول من جديد",
    });
  } catch (err) {
    console.error("changePassword error:", err);
    return res.status(500).json({
      message: "حدث خطأ في الخادم أثناء تحديث كلمة المرور",
    });
  }
};

// 📧 تغيير البريد الإلكتروني
export const changeEmail = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;
    const newEmail = String(req.body?.newEmail || "").trim().toLowerCase();

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (!newEmail) {
      return res.status(400).json({
        message: "الرجاء إدخال البريد الجديد",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
        AND school_id = $2
        AND id <> $3
      LIMIT 1
      `,
      [newEmail, schoolId, userId]
    );

    if (rows.length > 0) {
      return res.status(400).json({
        message: "هذا البريد مستخدم بالفعل داخل نفس المدرسة",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET email = $1,
          updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      `,
      [newEmail, userId, schoolId]
    );

    return res.json({
      message: "تم تحديث البريد الإلكتروني بنجاح",
      email: newEmail,
    });
  } catch (err) {
    console.error("changeEmail error:", err);
    return res.status(500).json({
      message: "حدث خطأ في الخادم أثناء تحديث البريد الإلكتروني",
    });
  }
};