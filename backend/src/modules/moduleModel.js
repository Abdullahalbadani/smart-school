import { pool } from "../config/db.js";

// إنشاء وحدة جديدة
export const createModule = async (name, code) => {
  const result = await pool.query(
    `INSERT INTO modules (name, code) VALUES ($1, $2) RETURNING *`,
    [name, code]
  );
  return result.rows[0];
};

// جلب جميع الوحدات
export const getAllModules = async () => {
  const result = await pool.query(`SELECT * FROM modules ORDER BY id ASC`);
  return result.rows;
};

// جلب وحدة حسب ID
export const getModuleById = async (id) => {
  const result = await pool.query(
    `SELECT * FROM modules WHERE id = $1`,
    [id]
  );
  return result.rows[0];
};

// تحديث وحدة
export const updateModule = async (id, name, code) => {
  const result = await pool.query(
    `UPDATE modules SET name=$1, code=$2 WHERE id=$3 RETURNING *`,
    [name, code, id]
  );
  return result.rows[0];
};

// حذف وحدة
export const deleteModule = async (id) => {
  await pool.query(`DELETE FROM modules WHERE id = $1`, [id]);
  return true;
};
