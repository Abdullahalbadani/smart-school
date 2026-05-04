// src/modules/userModel.js
import { pool } from "../config/db.js";

const UserModel = {
  // ✅ إنشاء مستخدم جديد
  async create({ school_id, name, username, email, phone, password_hash }) {
    const result = await pool.query(
      `
      INSERT INTO users (school_id, name, username, email, phone, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id, school_id, name, username, email, phone, status, created_at, token_version
      `,
      [school_id, name, username, email, phone, password_hash]
    );
    return result.rows[0];
  },

  // ✅ جلب مستخدم بواسطة الإيميل (مع اسم الدور + token_version + password)
  async getByEmail(email) {
    const query = `
      SELECT 
        u.id,
        u.name,
        u.username,
        u.email,
        u.phone,
        u.password_hash AS password,
        u.status,
        u.created_at,
        u.token_version,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN (
        SELECT user_id, MIN(role_id) AS role_id
        FROM user_roles
        GROUP BY user_id
      ) ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  },

  // ✅ للـ Auth: جلب بالمعرف وتسجيل الدخول
  async getByLoginAndSchoolSlug(slug, login) {
    const query = `
      SELECT
        u.id,
        u.school_id,
        s.slug AS school_slug,
        s.name_ar AS school_name_ar,
        s.name_en AS school_name_en,
        s.is_active AS school_is_active,
        s.logo_url, /* 👈 الشعار */
        u.name,
        u.username,
        u.email,
        u.phone,
        u.password_hash,
        u.status,
        u.created_at,
        u.token_version,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      JOIN schools s ON s.id = u.school_id
      LEFT JOIN (
        SELECT user_id, MIN(role_id) AS role_id
        FROM user_roles
        GROUP BY user_id
      ) ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE LOWER(s.slug) = LOWER($1)
        AND (
          LOWER(u.email) = LOWER($2)
          OR LOWER(u.username) = LOWER($2)
        )
      LIMIT 1
    `;
    const result = await pool.query(query, [slug, login]);
    return result.rows[0] || null;
  },

  // ✅ جلب كل المستخدمين (مع الدور) الخاصة بمدرسة محددة
  async getAll(school_id) {
    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.name,
        u.username,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r       ON ur.role_id = r.id
      WHERE u.school_id = $1
      ORDER BY u.id ASC
      `,
      [school_id]
    );
    return result.rows;
  },

  // ✅ جلب مستخدم بواسطة ID
 // ✅ جلب مستخدم بواسطة ID (تم إعادتها لتقبل id فقط لتعمل مع الـ Middleware)
  async getById(id) {
    const result = await pool.query(
      `
      SELECT
        u.id,
        u.school_id,
        s.slug AS school_slug,
        s.name_ar AS school_name_ar,
        s.name_en AS school_name_en,
        s.is_active AS school_is_active,
        u.name,
        u.username,
        u.email,
        u.phone,
        u.password_hash,
        u.status,
        u.created_at,
        u.token_version,
        r.id   AS role_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r       ON ur.role_id = r.id
      WHERE u.id = $1
      LIMIT 1
      `,
      [id]
    );
    return result.rows[0] || null;
  },

  // ✅ تحديث مستخدم (ديناميكي) — بدون password أو token_version
  async update(school_id, id, data) {
    const fields = [];
    const values = [];
    let index = 1;

    for (const key in data) {
      if (key === "password" || key === "token_version") continue;
      fields.push(`${key} = $${index}`);
      values.push(data[key]);
      index++;
    }

    if (fields.length === 0) return null;

    values.push(id);
    values.push(school_id);

    const result = await pool.query(
      `
      UPDATE users
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${index} AND school_id = $${index + 1}
      RETURNING 
        id, name, username, email, phone, status, updated_at, token_version
      `,
      values
    );

    return result.rows[0];
  },

  // ✅ تحديث كلمة المرور فقط
  async updatePassword(school_id, id, hashedPassword) {
    await pool.query(
      `
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      `,
      [hashedPassword, id, school_id]
    );
    return true;
  },

  // ✅ تحديث البريد الإلكتروني فقط
  async updateEmail(school_id, id, newEmail) {
    const result = await pool.query(
      `
      UPDATE users
      SET email = $1, updated_at = NOW()
      WHERE id = $2 AND school_id = $3
      RETURNING 
        id, name, username, email, phone, status, updated_at, token_version
      `,
      [newEmail, id, school_id]
    );
    return result.rows[0];
  },

  // ✅ حذف مستخدم
  async delete(school_id, id) {
    await pool.query(
      `DELETE FROM users WHERE id = $1 AND school_id = $2`,
      [id, school_id]
    );
    return true;
  },
};

export default UserModel;