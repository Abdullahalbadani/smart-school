// src/modules/sectionModel.js
import { pool } from "../config/db.js";

const SectionModel = {
  async getByGrade(schoolId, gradeId = null) {
    const params = [schoolId];
    let where = `
      WHERE sec.school_id = $1
        AND sec.is_active = TRUE
    `;

    if (gradeId) {
      params.push(gradeId);
      where += ` AND sec.grade_id = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT
        sec.id,
        sec.school_id,
        sec.name,
        sec.grade_id,
        sec.capacity,
        sec.is_active,
        sec.created_at,
        sec.updated_at,
        g.name AS grade_name
      FROM sections sec
      JOIN grades g
        ON g.id = sec.grade_id
       AND g.school_id = sec.school_id
      ${where}
      ORDER BY sec.name ASC
      `,
      params
    );

    return result.rows;
  },
};

export default SectionModel;