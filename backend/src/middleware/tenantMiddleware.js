// src/middleware/tenantMiddleware.js
import { pool } from "../config/db.js";
import jwt from "jsonwebtoken";

export const tenantMiddleware = async (req, res, next) => {
  try {
    let schoolId =
      req.user?.school_id ||
      req.headers["x-school-id"] ||
      req.body?.school_id ||
req.query?.school_id;

    let slug = String(
    req.params.slug ||
  req.headers["x-school-slug"] ||
  req.body?.slug ||         // ← أضف علامة ?
  req.query?.slug ||        // ← أضف علامة ?
  ""
    )
      .trim()
      .toLowerCase();

    // إذا لم نجد schoolId ولكن يوجد توكن في الهيدر أو الكوكيز، نحاول فكه لاستخراج school_id
    if (!schoolId) {
      let t = null;
      if (req.headers.cookie) {
        try {
          const cookies = {};
          req.headers.cookie.split(";").forEach((cookie) => {
            const parts = cookie.split("=");
            if (parts.length >= 2) {
              cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join("="));
            }
          });
          t = cookies.token;
        } catch (err) {}
      }
      if (!t && req.headers.authorization) {
        const match = req.headers.authorization.match(/^Bearer\s+(.+)$/i);
        t = match ? match[1]?.trim() : null;
      }
      if (t) {
        const jwtSecret = process.env.JWT_SECRET;
        if (jwtSecret) {
          try {
            const decoded = jwt.verify(t, jwtSecret);
            schoolId = decoded?.school_id || decoded?.schoolId;
          } catch (err) {}
        }
      }
    }

    let school = null;

    if (schoolId) {
      const result = await pool.query(
        `
        SELECT id, name_ar, name_en, slug, is_active
        FROM schools
        WHERE id = $1
        LIMIT 1
        `,
        [schoolId]
      );
      school = result.rows[0];
    } else if (slug) {
      const result = await pool.query(
        `
        SELECT id, name_ar, name_en, slug, is_active
        FROM schools
        WHERE LOWER(slug) = $1
        LIMIT 1
        `,
        [slug]
      );
      school = result.rows[0];
    }

    if (!school) {
      return res.status(400).json({
        message: "يجب تحديد المدرسة أولًا أو المدرسة غير مسجلة",
      });
    }

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
    req.school_id = school.id;

    return next();
  } catch (error) {
    console.error("tenantMiddleware error:", error);

    return res.status(500).json({
      message: "خطأ داخلي في الخادم",
    });
  }
};