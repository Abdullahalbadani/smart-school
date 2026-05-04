// src/controllers/metaController.js
import { pool } from "../config/db.js";

/**
 * GET /api/academic-years
 */
export async function getAcademicYears(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const q = `
      SELECT
        id,
        name,
        start_date AS "startDate",
        end_date   AS "endDate",
        is_active  AS "isActive"
      FROM academic_years
      WHERE school_id = $1
      ORDER BY start_date DESC
    `;

    const { rows } = await pool.query(q, [schoolId]);
    return res.json(rows);
  } catch (e) {
    console.error("getAcademicYears failed:", e);
    return res.status(500).json({ message: "getAcademicYears failed", error: e.message });
  }
}

/**
 * GET /api/grades
 * اختياري: يدعم ?stageId=
 */
export async function getGrades(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const stageId = req.query.stageId ? parseInt(req.query.stageId, 10) : null;

    if (req.query.stageId && (!Number.isInteger(stageId) || stageId <= 0)) {
      return res.status(400).json({ message: "stageId غير صحيح" });
    }

    const params = [schoolId];
    let where = `
      WHERE school_id = $1
        AND is_active = TRUE
    `;

    if (stageId) {
      params.push(stageId);
      where += ` AND stage_id = $${params.length}`;
    }

    const q = `
      SELECT
        id,
        stage_id AS "stageId",
        name,
        order_index AS "orderIndex",
        is_active AS "isActive"
      FROM grades
      ${where}
      ORDER BY order_index ASC, id ASC
    `;

    const { rows } = await pool.query(q, params);
    return res.json(rows);
  } catch (e) {
    console.error("getGrades failed:", e);
    return res.status(500).json({ message: "getGrades failed", error: e.message });
  }
}

/**
 * GET /api/classes?gradeId=...
 * ملاحظة: classes = sections
 */
export async function getClasses(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const gradeId = parseInt(req.query.gradeId || "0", 10);
    if (!gradeId) return res.json([]);

    const gradeCheck = await pool.query(
      `
      SELECT id
      FROM grades
      WHERE id = $1
        AND school_id = $2
        AND is_active = TRUE
      LIMIT 1
      `,
      [gradeId, schoolId]
    );

    if (gradeCheck.rowCount === 0) {
      return res.json([]);
    }

    const q = `
      SELECT id, name
      FROM sections
      WHERE school_id = $1
        AND grade_id = $2
        AND is_active = TRUE
      ORDER BY name ASC, id ASC
    `;

    const { rows } = await pool.query(q, [schoolId, gradeId]);
    return res.json(rows);
  } catch (e) {
    console.error("getClasses failed:", e);
    return res.status(500).json({ message: "getClasses failed", error: e.message });
  }
}

/**
 * GET /api/students/search?q=&yearId=&gradeId=&classId=
 */
export async function searchStudents(req, res) {
  const schoolId = req.user?.school_id;

  if (!schoolId) {
    return res.status(401).json({ message: "غير مصرح" });
  }

  const qText = (req.query.q || "").trim();
  const yearId = parseInt(req.query.yearId || "0", 10);
  const gradeId = req.query.gradeId ? parseInt(req.query.gradeId, 10) : null;
  const classId = req.query.classId ? parseInt(req.query.classId, 10) : null;

  if (!yearId) {
    return res.status(400).json({ message: "yearId required" });
  }

  try {
    const yearCheck = await pool.query(
      `
      SELECT id
      FROM academic_years
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [yearId, schoolId]
    );

    if (yearCheck.rowCount === 0) {
      return res.status(400).json({ message: "السنة الدراسية غير صحيحة داخل هذه المدرسة" });
    }

    if (gradeId !== null) {
      const gradeCheck = await pool.query(
        `
        SELECT id
        FROM grades
        WHERE id = $1
          AND school_id = $2
          AND is_active = TRUE
        LIMIT 1
        `,
        [gradeId, schoolId]
      );

      if (gradeCheck.rowCount === 0) {
        return res.status(400).json({ message: "الصف الدراسي غير صحيح داخل هذه المدرسة" });
      }
    }

    if (classId !== null) {
      const classCheck = await pool.query(
        `
        SELECT id
        FROM sections
        WHERE id = $1
          AND school_id = $2
          AND is_active = TRUE
        LIMIT 1
        `,
        [classId, schoolId]
      );

      if (classCheck.rowCount === 0) {
        return res.status(400).json({ message: "الشعبة الدراسية غير صحيحة داخل هذه المدرسة" });
      }
    }

    const params = [schoolId, yearId];
    const where = [
      `s.school_id = $1`,
      `se.school_id = $1`,
      `se.academic_year_id = $2`,
    ];

    if (gradeId !== null) {
      params.push(gradeId);
      where.push(`se.grade_id = $${params.length}`);
    }

    if (classId !== null) {
      params.push(classId);
      where.push(`se.section_id = $${params.length}`);
    }

    if (qText) {
      params.push(`%${qText}%`);
      const p = `$${params.length}`;
      where.push(`
        (
          s.full_name ILIKE ${p}
          OR s.student_code ILIKE ${p}
          OR s.id::text ILIKE ${p}
          OR COALESCE(gd.full_name,'') ILIKE ${p}
          OR COALESCE(gd.phone,'') ILIKE ${p}
        )
      `);
    }

    const sql = `
      SELECT
        s.id,
        s.full_name AS "name",
        s.student_code AS "studentCode",
        se.grade_id AS "gradeId",
        gr.name AS "gradeName",
        se.section_id AS "classId",
        sc.name AS "className",
        COALESCE(gd.full_name,'') AS "guardianName",
        COALESCE(gd.phone,'') AS "guardianPhone"

      FROM student_enrollments se
      JOIN students s
        ON s.id = se.student_id
       AND s.school_id = se.school_id

      LEFT JOIN grades gr
        ON gr.id = se.grade_id
       AND gr.school_id = se.school_id

      LEFT JOIN sections sc
        ON sc.id = se.section_id
       AND sc.school_id = se.school_id

      LEFT JOIN student_guardians sg
        ON sg.student_id = s.id
       AND sg.school_id = s.school_id
       AND sg.is_primary = TRUE

      LEFT JOIN guardians gd
        ON gd.id = sg.guardian_id
       AND gd.school_id = sg.school_id

      WHERE ${where.join(" AND ")}

      ORDER BY s.full_name ASC
      LIMIT 100
    `;

    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    console.error("searchStudents failed:", e);
    return res.status(500).json({ message: "searchStudents failed", error: e.message });
  }
}