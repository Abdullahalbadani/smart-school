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
    if (!schoolId) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح: لم يتم تحديد المدرسة.",
      });
    }

    // Extraction of pagination parameters
    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 20);
    const offset = (page - 1) * limit;

    // Filters
    const filterDate = req.query.date || null; // Dashboard timeline single date filter
    const dateFrom = req.query.date_from || null;
    const dateTo = req.query.date_to || null;
    const filterAction = req.query.action || null;
    const filterModule = req.query.module || null;
    const filterUser = req.query.user || null; // user_name search query

    const values = [schoolId];
    let whereSql = `WHERE a.school_id = $1`;

    if (filterDate) {
      values.push(filterDate);
      whereSql += ` AND (a.event_date = $${values.length} OR DATE(a.created_at) = $${values.length})`;
    }

    if (dateFrom) {
      values.push(dateFrom);
      whereSql += ` AND (a.event_date >= $${values.length} OR DATE(a.created_at) >= $${values.length})`;
    }

    if (dateTo) {
      values.push(dateTo);
      whereSql += ` AND (a.event_date <= $${values.length} OR DATE(a.created_at) <= $${values.length})`;
    }

    if (filterAction) {
      values.push(filterAction.toUpperCase());
      whereSql += ` AND a.action = $${values.length}`;
    }

    if (filterModule) {
      values.push(filterModule);
      whereSql += ` AND a.module = $${values.length}`;
    }

    if (filterUser) {
      values.push(`%${filterUser}%`);
      whereSql += ` AND (a.user_name ILIKE $${values.length} OR u.name ILIKE $${values.length} OR u.username ILIKE $${values.length})`;
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*)::int AS count
      FROM activity_logs a
      LEFT JOIN users u
        ON u.id = a.user_id
       AND u.school_id = a.school_id
      ${whereSql}
    `;
    const countRes = await pool.query(countQuery, values);
    const totalCount = countRes.rows[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    // Fetch records
    const fetchValues = [...values];
    fetchValues.push(limit);
    const limitPlaceholder = `$${fetchValues.length}`;
    fetchValues.push(offset);
    const offsetPlaceholder = `$${fetchValues.length}`;

    const query = `
      SELECT
        a.id,
        a.school_id,
        a.user_id,
        a.action,
        a.action_label,
        a.module,
        a.table_name,
        a.record_id,
        COALESCE(a.old_data, '{}'::jsonb) AS old_data,
        COALESCE(a.new_data, '{}'::jsonb) AS new_data,
        COALESCE(a.changed_fields, '[]'::jsonb) AS changed_fields,
        a.description,
        a.reason,
        a.ip_address,
        a.user_agent,
        a.session_id,
        a.device_info,
        a.event_date,
        a.event_time,
        a.created_at,
        COALESCE(a.user_name, u.name, u.username, 'مستخدم غير معروف') AS user_name,
COALESCE(a.user_role, 'system') AS user_role,        u.username AS user_username
      FROM activity_logs a
      LEFT JOIN users u
        ON u.id = a.user_id
       AND u.school_id = a.school_id
      ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const { rows } = await pool.query(query, fetchValues);

    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        title: row.description || "حدث إداري",
        actor_name: row.user_name,
        display_text: row.description || `${row.user_name} نفّذ عملية ${row.action}`,
      })),
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        limit,
      }
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