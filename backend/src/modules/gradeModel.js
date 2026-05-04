// src/modules/gradeModel.js
import { pool } from "../config/db.js";

const GradeModel = {
  async getByStage(schoolId, stageId = null) {
    const params = [schoolId];
    let where = `
      WHERE g.school_id = $1
        AND g.is_active = TRUE
    `;

    if (stageId) {
      params.push(stageId);
      where += ` AND g.stage_id = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        g.id,
        g.school_id,
        g.name,
        g.grade_name,
        g.stage_id,
        s.name AS stage_name,
        g.order_no,
        g.order_index,
        g.is_active,
        g.created_at,
        g.updated_at
      FROM grades g
      JOIN stages s
        ON s.id = g.stage_id
       AND s.school_id = g.school_id
      ${where}
      ORDER BY g.order_index ASC, g.name ASC
      `,
      params
    );

    return result.rows;
  },
};

export default GradeModel;