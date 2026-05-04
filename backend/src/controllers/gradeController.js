import GradeModel from "../modules/gradeModel.js";
import { pool } from "../config/db.js";

export const getGrades = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const stageId = req.query.stage_id ? Number(req.query.stage_id) : null;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (req.query.stage_id && (!Number.isInteger(stageId) || stageId <= 0)) {
      return res.status(400).json({
        message: "قيمة stage_id غير صحيحة",
      });
    }

    if (stageId) {
      const stageCheck = await pool.query(
        `
        SELECT id
        FROM stages
        WHERE id = $1
          AND school_id = $2
          AND is_active = TRUE
        LIMIT 1
        `,
        [stageId, schoolId]
      );

      if (stageCheck.rowCount === 0) {
        return res.status(404).json({
          message: "المرحلة الدراسية غير موجودة داخل هذه المدرسة",
        });
      }
    }

    const grades = await GradeModel.getByStage(schoolId, stageId);

    return res.json(grades);
  } catch (error) {
    console.error("Error fetching grades:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء جلب الصفوف الدراسية",
    });
  }
};