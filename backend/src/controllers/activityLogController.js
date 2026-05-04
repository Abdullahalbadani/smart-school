import { pool } from '../config/db.js';

export const getRecentActivities = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const filterDate = req.query.date; // 👈 استلام التاريخ من الواجهة

    // الاستعلام الأساسي
    let query = `
      SELECT 
        a.id, 
        a.action, 
        a.resource_type, 
        a.description, 
        a.created_at, 
        u.name AS user_name
      FROM activity_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.school_id = $1
    `;
    
    const values = [schoolId];

    // 👈 إذا تم تحديد تاريخ، نضيف شرط تصفية باليوم
    if (filterDate) {
      query += ` AND DATE(a.created_at) = $2 `;
      values.push(filterDate);
    }

    // جلب أحدث 20 عملية في هذا اليوم فقط
    query += ` ORDER BY a.created_at DESC LIMIT 20 `;

    const { rows } = await pool.query(query, values);

    res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error fetching activities:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب سجل النشاطات" });
  }
};