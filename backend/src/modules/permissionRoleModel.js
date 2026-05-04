// src/modules/permissionRoleModel.js
import { pool } from "../config/db.js";

class PermissionRoleModel {
  // ربط صلاحية بدور معيّن (مع حماية المدرسة)
  static async assign(school_id, role_id, permission_id) {
    // 🛡️ التأكد أن الدور يتبع لنفس المدرسة قبل الربط
    const checkRole = await pool.query(
      `SELECT id FROM roles WHERE id = $1 AND school_id = $2`,
      [role_id, school_id]
    );

    if (checkRole.rowCount === 0) {
      throw new Error("Role not found or unauthorized");
    }

    const result = await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       RETURNING *`,
      [role_id, permission_id]
    );
    return result.rows[0];
  }

  // جميع العلاقات (للمدرسة فقط)
  static async getAll(school_id) {
    const result = await pool.query(
      `SELECT rp.* FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE r.school_id = $1
       ORDER BY rp.id ASC`,
      [school_id]
    );
    return result.rows;
  }

  // جميع العلاقات لدور معيّن (مع حماية المدرسة)
  static async getByRole(school_id, role_id) {
    const result = await pool.query(
      `SELECT rp.* FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE rp.role_id = $1 AND r.school_id = $2`,
      [role_id, school_id]
    );
    return result.rows;
  }

  // حذف علاقة (مع حماية المدرسة عبر الربط بجدول الأدوار)
  static async delete(school_id, id) {
    const result = await pool.query(
      `DELETE FROM role_permissions rp
       USING roles r
       WHERE rp.role_id = r.id 
         AND rp.id = $1 
         AND r.school_id = $2
       RETURNING rp.*`,
      [id, school_id]
    );
    return result.rows[0];
  }

  /**
   * ✅ هل الدور يملك صلاحية معيّنة (بالكود مثل "rbac.manage_users")؟
   */
  static async roleHasPermission(roleId, permissionCode) {
    const result = await pool.query(
      `
      SELECT 1
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
        AND p.code     = $2
      LIMIT 1
      `,
      [roleId, permissionCode]
    );

    return result.rows.length > 0;
  }

  /**
   * ✅ هل الدور يملك "أي" صلاحية من مجموعة أكواد؟
   */
  static async roleHasAnyPermission(roleId, codes = []) {
    if (!codes || codes.length === 0) return false;

    const result = await pool.query(
      `
      SELECT 1
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
        AND p.code = ANY($2::text[])
      LIMIT 1
      `,
      [roleId, codes]
    );

    return result.rows.length > 0;
  }

  /**
   * ✅ تجيب كل أكواد الصلاحيات لدور معيّن (للـ توكن / الـ middleware)
   * ترجع Array مثل:
   * ["rbac.manage_users", "admission.view_students", ...]
   */
  static async getPermissionCodesForRole(roleId) {
    const result = await pool.query(
      `
      SELECT p.code
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.code ASC
      `,
      [roleId]
    );

    return result.rows.map((row) => row.code);
  }
}

export default PermissionRoleModel;