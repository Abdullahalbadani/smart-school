// src/controllers/dashboardController.js
import { pool } from "../config/db.js";

export const getDashboardStats = async (req, res) => {
  try {
    // 🔒 الأمان أولاً: نأخذ رقم المدرسة من التوكن الموثق فقط!
    // لا نثق بما يرسله المتصفح لتجنب أي تداخل بين المدارس بسبب الذاكرة المؤقتة
    const schoolId = req.user?.school_id;

    console.log("🏫 Dashboard accessed by User ID:", req.user?.id, "| Valid School ID:", schoolId); 

    if (!schoolId || isNaN(schoolId)) {
      return res.status(403).json({ message: "غير مصرح أو school_id غير صالح" });
    }

    const activeYearRes = await pool.query(
      `SELECT id FROM academic_years WHERE school_id = $1 AND is_active = true LIMIT 1`,
      [schoolId]
    );

    const activeYearId = activeYearRes.rows[0]?.id;
    const { yearId = activeYearId } = req.query;

    let studentsSql;
    let studentParams;

    if (yearId) {
      studentsSql = `
        SELECT COUNT(DISTINCT se.student_id)::int AS count 
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id
        WHERE s.school_id = $1 
        AND se.academic_year_id = $2 
        AND se.status = 'enrolled'
      `;
      studentParams = [schoolId, yearId];
    } else {
      studentsSql = `
        SELECT COUNT(*)::int AS count 
        FROM students 
        WHERE school_id = $1 AND status = 'active'
      `;
      studentParams = [schoolId];
    }

    const teachersSql = `
      SELECT COUNT(*)::int AS count 
      FROM teachers 
      WHERE school_id = $1 AND COALESCE(is_active, true) = true
    `;

    const sectionsSql = `
      SELECT COUNT(*)::int AS count 
      FROM sections 
      WHERE school_id = $1 AND COALESCE(is_active, true) = true
    `;

    const [studentsR, teachersR, sectionsR] = await Promise.all([
      pool.query(studentsSql, studentParams),
      pool.query(teachersSql, [schoolId]),
      pool.query(sectionsSql, [schoolId])
    ]);

    res.json({
      students: studentsR.rows[0]?.count ?? 0,
      teachers: teachersR.rows[0]?.count ?? 0,
      classes: sectionsR.rows[0]?.count ?? 0,
      activeYearId: yearId
    });

  } catch (err) {
    console.error("getDashboardStats error:", err);
    res.status(500).json({ message: "خطأ في الخادم" });
  }
};