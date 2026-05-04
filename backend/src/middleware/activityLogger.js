// src/middleware/activityLogger.js
import { logActivity } from '../utils/logger.js';
import { pool } from '../config/db.js';

export const autoActivityLogger = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();

  const bodyClone = { ...req.body };

  res.on('finish', async () => {
    // 👈 إذا تم التسجيل يدوياً في الكنترولر، نتوقف هنا لمنع التكرار
    if (res.locals.skipAutoLog) return;

    if (res.statusCode >= 200 && res.statusCode < 300) {
      let action = req.method === 'POST' ? 'CREATE' : (req.method === 'DELETE' ? 'DELETE' : 'UPDATE');
      const pathParts = req.path.split('/');
      const resourceType = pathParts[pathParts.length - 1] || 'system';
      const resourceId = req.params?.id || bodyClone.id || null;

      let realName = '';
      try {
        if (resourceId) {
          const table = resourceType === 'students' ? 'students' : (resourceType.includes('role') ? 'roles' : 'users');
          const { rows } = await pool.query(`SELECT name_ar, name FROM ${table} WHERE id = $1`, [resourceId]);
          if (rows.length > 0) realName = rows[0].name_ar || rows[0].name;
        }
      } catch (e) {}

      let identifier = realName || bodyClone.name_ar || `سجل رقم ${resourceId}`;
      let description = `${action === 'CREATE' ? 'إضافة' : (action === 'DELETE' ? 'حذف' : 'تحديث')} ( ${identifier} )`;

      if (req.user) {
        logActivity({
          school_id: req.user.school_id,
          user_id: req.user.id,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          description
        });
      }
    }
  });
  next();
};