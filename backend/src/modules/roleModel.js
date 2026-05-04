// src/modules/roleModel.js
import { pool } from "../config/db.js";

const Role = {
  // ➕ إنشاء دور جديد
  async createRole(schoolId, name, description) {
    const result = await pool.query(
      "INSERT INTO roles (school_id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description",
      [schoolId, name, description]
    );
    return result.rows[0];
  },

  // 📄 جلب كل الأدوار
  async getAllRoles(schoolId) {
    const result = await pool.query(
      "SELECT id, name, description FROM roles WHERE school_id = $1 ORDER BY id ASC",
      [schoolId]
    );
    return result.rows;
  },

  // 📌 جلب دور واحد
  async getRoleById(schoolId, id) {
    const result = await pool.query(
      "SELECT id, name, description FROM roles WHERE id = $1 AND school_id = $2",
      [id, schoolId]
    );
    return result.rows[0];
  },

  // ✏️ تحديث دور
  async updateRole(schoolId, id, name, description) {
    const result = await pool.query(
      "UPDATE roles SET name = $1, description = $2 WHERE id = $3 AND school_id = $4 RETURNING id, name, description",
      [name, description, id, schoolId]
    );
    return result.rows[0];
  },

  // 🗑 حذف دور
  async deleteRole(schoolId, id) {
    const result = await pool.query(
      "DELETE FROM roles WHERE id = $1 AND school_id = $2 RETURNING id, name, description",
      [id, schoolId]
    );
    return result.rows[0];
  },

  // 🔗 جلب IDs الصلاحيات المرتبطة بدور معيّن
  async getRolePermissionIds(schoolId, roleId) {
    // نربط مع جدول roles لضمان أن الدور يتبع لنفس المدرسة
    const result = await pool.query(
      `SELECT rp.permission_id 
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE rp.role_id = $1 AND r.school_id = $2`,
      [roleId, schoolId]
    );
    return result.rows.map((r) => r.permission_id);
  },

  // 🔗 تحديث صلاحيات الدور (يحذف القديمة ويضيف الجديدة داخل ترانزاكشن)
  async setRolePermissions(schoolId, roleId, permissionIds = []) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 🛡️ فحص أمني: التأكد من أن الدور يتبع للمدرسة فعلاً قبل المساس بصلاحياته
      const checkRole = await client.query(
        "SELECT id FROM roles WHERE id = $1 AND school_id = $2 FOR UPDATE",
        [roleId, schoolId]
      );
      if (checkRole.rowCount === 0) {
        throw new Error("Role not found or unauthorized");
      }

      // حذف كل الصلاحيات القديمة
      await client.query(
        "DELETE FROM role_permissions WHERE role_id = $1",
        [roleId]
      );

      // إضافة الجديدة (لو فيه)
      for (const permId of permissionIds) {
        await client.query(
          "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)",
          [roleId, permId]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // ✅ دالة إضافية لجلب كل الصلاحيات من النظام لتعمل دالة (منح الجميع) بنجاح
  async getAllPermissionIds() {
    const result = await pool.query("SELECT id FROM permissions");
    return result.rows.map((r) => r.id);
  }
};

export default Role;