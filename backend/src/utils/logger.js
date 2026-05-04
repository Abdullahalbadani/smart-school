// src/utils/logger.js
import { pool } from '../config/db.js';

/**
 * المحرك الرئيسي لتسجيل النشاطات
 * يدعم تسجيل الـ IP، المتصفح، والقيم المتغيرة (Before/After)
 */
export const logActivity = async ({
  school_id,
  user_id,
  action,
  resource_type,
  resource_id = null,
  description = '',
  changes = null,
  req = null
}) => {
  try {
    if (!school_id) return; 

    let ip_address = null;
    let user_agent = null;

    if (req) {
      ip_address = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      user_agent = req.headers['user-agent'] || null;
    }

    const query = `
      INSERT INTO activity_logs 
      (school_id, user_id, action, resource_type, resource_id, description, changes, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const values = [
      school_id,
      user_id,
      action.toUpperCase(),
      resource_type,
      resource_id,
      description,
      changes ? JSON.stringify(changes) : null,
      ip_address,
      user_agent
    ];

    // تنفيذ الإدخال في الخلفية لضمان سرعة استجابة النظام للمستخدم
    pool.query(query, values).catch(err => {
      console.error("❌ DB Error Activity Logger:", err.message);
    });

  } catch (error) {
    console.error("❌ Activity Logger Exception:", error.message);
  }
};