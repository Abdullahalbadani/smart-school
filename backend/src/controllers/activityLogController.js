// backend/src/controllers/activityLogController.js
import { pool } from "../config/db.js";

function toPositiveInt(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

export const getRecentActivities = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const filterDate = req.query.date || null;
    const limit = toPositiveInt(req.query.limit, 20);

    if (!schoolId) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح: لم يتم تحديد المدرسة.",
      });
    }

    const values = [schoolId];
    let whereSql = `WHERE a.school_id = $1`;

    if (filterDate) {
      values.push(filterDate);
      whereSql += ` AND DATE(a.created_at) = $${values.length}`;
    }

    values.push(limit);

    const query = `
      SELECT
        a.id,
        a.school_id,
        a.user_id,

        a.action,
        a.entity_type,
        a.entity_id,
        a.resource_type,
        a.resource_id,

        a.description,
        COALESCE(a.details, '{}'::jsonb) AS details,
        COALESCE(a.metadata, '{}'::jsonb) AS metadata,
        COALESCE(a.changes, '{}'::jsonb) AS changes,

        a.path,
        a.method,
        a.status_code,
        a.user_agent,

        a.created_at,

        COALESCE(u.name, u.username, 'مستخدم غير معروف') AS user_name,
        u.username AS user_username

      FROM activity_logs a
      LEFT JOIN users u
        ON u.id = a.user_id
       AND u.school_id = a.school_id

      ${whereSql}

      ORDER BY a.created_at DESC
      LIMIT $${values.length}
    `;

    const { rows } = await pool.query(query, values);

    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        title: row.description || "حدث إداري",
        actor_name: row.user_name,
        display_text: row.description || `${row.user_name} نفّذ عملية ${row.action}`,
      })),
    });
  } catch (error) {
    console.error("Error fetching activities:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب سجل النشاطات",
    });
  }
};

export default {
  getRecentActivities,
};