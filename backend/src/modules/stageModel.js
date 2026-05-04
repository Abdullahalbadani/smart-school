// src/modules/stageModel.js
import { pool } from "../config/db.js";

const StageModel = {
  async getAllActive(schoolId) {
    const result = await pool.query(
      `
      SELECT id, school_id, name, order_no, order_index, is_active, created_at, updated_at
      FROM stages
      WHERE school_id = $1
        AND is_active = TRUE
      ORDER BY order_index ASC, name ASC
      `,
      [schoolId]
    );

    return result.rows;
  },
};

export default StageModel;