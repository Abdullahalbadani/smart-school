import { pool } from "../config/db.js";

export const PermissionModel = {
  // إنشاء صلاحية جديدة
  async create(module_id, name, code) {
    const result = await pool.query(
      `INSERT INTO permissions (module_id, name, code)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [module_id, name, code]
    );
    return result.rows[0];
  },

  // جلب كل الصلاحيات
  async getAll() {
    const result = await pool.query(`SELECT * FROM permissions ORDER BY id ASC`);
    return result.rows;
  },

  // جلب صلاحية واحدة
  async getById(id) {
    const result = await pool.query(
      `SELECT * FROM permissions WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  },

  // تعديل صلاحية
  async update(id, name, code) {
    const result = await pool.query(
      `UPDATE permissions
       SET name = $1, code = $2
       WHERE id = $3
       RETURNING *`,
      [name, code, id]
    );
    return result.rows[0];
  },

  // حذف صلاحية
  async remove(id) {
    await pool.query(`DELETE FROM permissions WHERE id = $1`, [id]);
    return true;
  }
};
