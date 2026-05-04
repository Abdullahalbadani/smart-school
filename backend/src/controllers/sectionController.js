import SectionModel from "../modules/sectionModel.js";
import { pool } from "../config/db.js";

export const getSections = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (req.query.grade_id && (!Number.isInteger(gradeId) || gradeId <= 0)) {
      return res.status(400).json({
        message: "قيمة grade_id غير صحيحة",
      });
    }

    if (gradeId) {
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
        return res.status(404).json({
          message: "الصف الدراسي غير موجود داخل هذه المدرسة",
        });
      }
    }

    const sections = await SectionModel.getByGrade(schoolId, gradeId);

    return res.json(sections);
  } catch (error) {
    console.error("Error fetching sections:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء جلب الشعب الدراسية",
    });
  }
};