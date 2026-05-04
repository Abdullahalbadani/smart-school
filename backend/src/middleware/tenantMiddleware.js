// src/middleware/tenantMiddleware.js
import { pool } from "../config/db.js";

export const tenantMiddleware = async (req, res, next) => {
  try {
    const slug = String(
      req.params.slug ||
        req.headers["x-school-slug"] ||
        req.body.slug ||
        req.query.slug ||
        ""
    )
      .trim()
      .toLowerCase();

    if (!slug) {
      return res.status(400).json({
        message: "يجب تحديد المدرسة أولًا",
      });
    }

    const result = await pool.query(
      `
      SELECT id, name_ar, name_en, slug, is_active
      FROM schools
      WHERE LOWER(slug) = $1
      LIMIT 1
      `,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "المدرسة غير مسجلة في النظام",
      });
    }

    const school = result.rows[0];

    if (!school.is_active) {
      return res.status(403).json({
        message: "المدرسة غير مفعلة",
      });
    }

    if (
      req.user?.school_id &&
      Number(req.user.school_id) !== Number(school.id)
    ) {
      return res.status(403).json({
        message: "لا يمكنك الوصول إلى بيانات مدرسة أخرى",
      });
    }

    req.school = school;
    req.schoolId = school.id;

    return next();
  } catch (error) {
    console.error("tenantMiddleware error:", error);

    return res.status(500).json({
      message: "خطأ داخلي في الخادم",
    });
  }
};