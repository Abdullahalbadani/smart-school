import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { executeBackup, runPsqlRestore } from '../utils/backupExecutor.js';

// جلب إعدادات النسخ الاحتياطي الحالية
export async function getSettings(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const result = await pool.query(
      `SELECT * FROM backup_settings WHERE school_id = $1`,
      [schoolId]
    );

    let data = result.rows[0];
    if (!data) {
      // إرجاع الإعدادات الافتراضية في حال عدم وجودها
      data = {
        school_id: schoolId,
        auto_backup_enabled: false,
        auto_backup_frequency: 'daily',
        auto_backup_interval_hours: 24,
        auto_backup_time: '02:00:00',
        auto_backup_day: 0,
        backup_path: 'backups',
        keep_backups_count: 10,
        last_backup_at: null,
        last_backup_status: null,
        last_backup_path: null,
        last_backup_error: null
      };
    }
// 🟢 حماية هندسية: حذف التوكن السحابي لكي لا يتسرب إلى المتصفح عبر شبكة الـ Network
    if (data) {
      delete data.google_drive_refresh_token;
    }
    return res.json({ data });
  } catch (e) {
    console.error("getSettings error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// تحديث أو إنشاء إعدادات النسخ الاحتياطي
export async function updateSettings(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const {
      auto_backup_enabled,
      auto_backup_frequency,
      auto_backup_interval_hours,
      auto_backup_time,
      auto_backup_day,
      backup_path,
      keep_backups_count
    } = req.body;

    const query = `
      INSERT INTO backup_settings 
      (school_id, auto_backup_enabled, auto_backup_frequency, auto_backup_interval_hours, 
       auto_backup_time, auto_backup_day, backup_path, keep_backups_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (school_id) DO UPDATE 
      SET auto_backup_enabled = EXCLUDED.auto_backup_enabled,
          auto_backup_frequency = EXCLUDED.auto_backup_frequency,
          auto_backup_interval_hours = EXCLUDED.auto_backup_interval_hours,
          auto_backup_time = EXCLUDED.auto_backup_time,
          auto_backup_day = EXCLUDED.auto_backup_day,
          backup_path = EXCLUDED.backup_path,
          keep_backups_count = EXCLUDED.keep_backups_count,
          updated_at = NOW()
      RETURNING *;
    `;

    const result = await pool.query(query, [
      schoolId,
      Boolean(auto_backup_enabled),
      auto_backup_frequency || 'daily',
      parseInt(auto_backup_interval_hours || 24, 10),
      auto_backup_time || '02:00:00',
      parseInt(auto_backup_day || 0, 10),
      backup_path || 'backups',
      parseInt(keep_backups_count || 10, 10)
    ]);

    return res.json({
      message: "تم حفظ إعدادات النسخ الاحتياطي بنجاح ✅",
      data: result.rows[0]
    });
  } catch (e) {
    console.error("updateSettings error:", e);
    return res.status(400).json({ error: e.message });
  }
}

// جلب سجل النسخ الاحتياطي مع الترقيم
export async function getLogs(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const page = Math.max(1, parseInt(req.query.page || 1, 10));
    const limit = Math.max(1, parseInt(req.query.limit || 10, 10));
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM backup_logs WHERE school_id = $1`,
      [schoolId]
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const logsRes = await pool.query(
      `SELECT id, backup_type, backup_path, file_size, status, error_message, started_at, completed_at, created_by_name 
       FROM backup_logs 
       WHERE school_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, offset]
    );

    // تصفية المسارات من البيانات المرتجعة للفرونت اند لضمان أمن الخادم
    const sanitizedLogs = logsRes.rows.map(log => ({
      ...log,
      backup_path: path.basename(log.backup_path) // إظهار اسم الملف فقط
    }));

    return res.json({
      data: sanitizedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    console.error("getLogs error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// تشغيل النسخ الاحتياطي اليدوي الفوري
export async function runManualBackup(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = req.user?.id;
    const userName = req.user?.name || req.user?.username || 'مسؤول';
    
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    console.log(`[Backup Controller] User ${userName} (#${userId}) requested manual backup for school #${schoolId}`);
    
    const result = await executeBackup({
      schoolId,
      type: 'manual',
      userId,
      userName
    });

    return res.json({
      message: "تم إنشاء نسخة احتياطية يدوية بنجاح ✅",
      data: {
        id: result.logId,
        fileName: path.basename(result.path),
        size: result.size
      }
    });
  } catch (e) {
    console.error("runManualBackup error:", e);
    return res.status(500).json({ error: `فشل إنشاء النسخة الاحتياطية: ${e.message}` });
  }
}

// تحميل ملف النسخ الاحتياطي بشكل آمن وعزل المدارس
export async function downloadBackup(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const logId = req.params.id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    // التحقق من أن السجل ينتمي لنفس المدرسة
    const logRes = await pool.query(
      `SELECT * FROM backup_logs WHERE id = $1 AND school_id = $2`,
      [logId, schoolId]
    );

    if (logRes.rowCount === 0) {
      return res.status(404).json({ error: "الملف غير موجود أو لا تملك صلاحية الوصول إليه" });
    }

    const log = logRes.rows[0];
    if (log.status !== 'success' || !fs.existsSync(log.backup_path)) {
      return res.status(404).json({ error: "الملف غير متوفر على القرص أو تم حذفه" });
    }

    const fileName = path.basename(log.backup_path);
    return res.download(log.backup_path, fileName);
  } catch (e) {
    console.error("downloadBackup error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// حذف ملف وسجل النسخة الاحتياطية
export async function deleteBackup(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const logId = req.params.id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const logRes = await pool.query(
      `SELECT * FROM backup_logs WHERE id = $1 AND school_id = $2`,
      [logId, schoolId]
    );

    if (logRes.rowCount === 0) {
      return res.status(404).json({ error: "السجل غير موجود أو لا تملك الصلاحية لحذفه" });
    }

    const log = logRes.rows[0];

    // حذف الملف المادي من القرص إن وجد
    if (fs.existsSync(log.backup_path)) {
      try {
        fs.unlinkSync(log.backup_path);
        console.log(`[Backup Controller] Deleted file from disk: ${log.backup_path}`);
      } catch (e) {
        console.warn(`[Backup Controller] Could not delete physical file: ${log.backup_path}`, e.message);
      }
    }

    // حذف السجل من قاعدة البيانات
    await pool.query(`DELETE FROM backup_logs WHERE id = $1`, [logId]);

    return res.json({ message: "تم حذف ملف وسجل النسخة الاحتياطية بنجاح ✅" });
  } catch (e) {
    console.error("deleteBackup error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// تصفح المجلدات على السيرفر بشكل تفاعلي وآمن
export async function browseDirectories(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    let targetPath = req.query.path ? req.query.path.trim() : "";
    
    // إذا كان المسار فارغاً، نبدأ من مسار المشروع الحالي
    if (!targetPath) {
      targetPath = process.cwd();
    }

    targetPath = path.resolve(targetPath);

    // التأكد من وجود المجلد
    if (!fs.existsSync(targetPath)) {
      return res.status(400).json({ error: "المسار المحدد غير موجود" });
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "المسار المحدد ليس مجلداً" });
    }

    // قراءة المجلدات الفرعية
    let directories = [];
    try {
      const items = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          // تخطي المجلدات المخفية ومجلدات النظام الحساسة
          if (item.name.startsWith('.') || item.name.startsWith('$') || item.name === 'node_modules') {
            continue;
          }
          directories.push({
            name: item.name,
            path: path.join(targetPath, item.name)
          });
        }
      }
    } catch (readErr) {
      return res.status(403).json({ error: "لا تملك صلاحية قراءة هذا المجلد" });
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    // الحصول على الأقراص المتاحة (لـ Windows فقط)
    const drives = [];
    if (process.platform === 'win32') {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let i = 0; i < letters.length; i++) {
        const drive = `${letters[i]}:\\`;
        try {
          if (fs.existsSync(drive)) {
            drives.push(drive);
          }
        } catch (e) {}
      }
    }

    const parentPath = path.dirname(targetPath);

    return res.json({
      data: {
        currentPath: targetPath,
        parentPath: parentPath === targetPath ? null : parentPath, // إذا كنا في الجذر فليس هناك أب
        directories,
        drives
      }
    });
  } catch (e) {
    console.error("browseDirectories error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// استعادة نسخة احتياطية من ملف مرفوع
export async function restoreBackup(req, res) {
  let tempFilePath = null;
  try {
    const schoolId = req.user?.school_id;
    const userId = req.user?.id;
    const userName = req.user?.name || req.user?.username || 'مدير المدرسة';

    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    if (!req.file) {
      return res.status(400).json({ error: "الرجاء رفع ملف النسخة الاحتياطية (.sql)" });
    }

    // 🟢 استقبال خيار المدير المرسل من الواجهة
    const { restoreMode } = req.body; 
    tempFilePath = req.file.path;
    console.log(`[Restore] Request received from School #${schoolId} with Mode: ${restoreMode}`);

    // 🟢 إذا اختار المدير "الاستبدال والتطهير"، نحذف بيانات هذه المدرسة فقط من الجداول الأساسية قبل الاستعادة
   // 🟢 الحل الهندسي النهائي: مسح ديناميكي ذكي لكل الجداول بدون تسميتها وبدون أخطاء العلاقات
    if (restoreMode === 'clean') {
      console.log(`[Restore] Dynamic clean initiated for school #${schoolId}...`);
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // 🔥 1. السحر البرمجي: تعطيل كافة قيود المفاتيح الأجنبية والعلاقات لهذه الجلسة الحالية فقط
        // هذا يمنع حدوث أي خطأ RESTRICT أو Constraint مهما كانت الجداول معقدة ومترابطة
        await client.query("SET LOCAL session_replication_role = 'replica';");
        
        // 🔍 2. استعلام كتالوج النظام: جلب أسماء جميع الجداول التي تحتوي على عمود school_id تلقائياً
        // بفضل هذا الاستعلام، لو أضفت 100 جدول جديد مستقبلاً في مشروعك، سيتعرف عليها النظام فوراً وبدون تعديل كود!
        const tablesRes = await client.query(`
          SELECT table_name 
          FROM information_schema.columns 
          WHERE column_name = 'school_id' 
            AND table_schema = 'public';
        `);
        
        console.log(`[Restore] Found ${tablesRes.rowCount} tables tied to multi-tenancy. Cleaning...`);

        // 🧹 3. المرور على الجداول المكتشفة ديناميكياً وحذف بيانات المدرسة الحالية منها فقط
        for (const row of tablesRes.rows) {
          const tableName = row.table_name;
          
          // تنفيذ الحذف الآمن والمحصور بالمدرسة الحالية
          await client.query(`DELETE FROM "${tableName}" WHERE school_id = $1`, [schoolId]);
        }
        
        // 🔒 4. حفظ العملية وإعادة تفعيل كافة القيود والعلاقات تلقائياً فوراً كأن شيئاً لم يكن
        await client.query('COMMIT');
        console.log(`[Restore] Dynamic clean completed successfully for school #${schoolId}. System keys restored.`);
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }
    }
    // تشغيل عملية الاستعادة المادية للملف
    await runPsqlRestore(tempFilePath);

    // 🟢 إضافة هندسية: إصلاح عداد الـ id تلقائياً فور الاستعادة لضمان عدم حدوث تصادم في المفاتيح
    await pool.query(`SELECT setval(pg_get_serial_sequence('backup_logs', 'id'), COALESCE(MAX(id), 1)) FROM backup_logs;`);
    // تسجيل العملية في جدول الـ logs
    const completedAt = new Date();
    await pool.query(
      `INSERT INTO backup_logs 
       (school_id, backup_type, backup_path, file_size, status, started_at, completed_at, created_by, created_by_name)
       VALUES ($1, 'restore', $2, $3, 'success', NOW(), $4, $5, $6)`,
      [schoolId, 'uploaded_file', req.file.size, completedAt, userId || null, userName]
    );

    // حذف الملف المؤقت بعد إتمام العملية
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      tempFilePath = null;
    }

    return res.json({ 
      success: true, 
      message: "تم استعادة النسخة الاحتياطية لقاعدة البيانات بنجاح وبشكل كامل ✅" 
    });

  } catch (err) {
    console.error("[Restore] Database restore failed:", err);
    
    // تسجيل العملية كفاشلة في جدول الـ logs
    try {
      const schoolId = req.user?.school_id;
      const userId = req.user?.id;
      const userName = req.user?.name || req.user?.username || 'مدير المدرسة';
      if (schoolId) {
        await pool.query(
          `INSERT INTO backup_logs 
           (school_id, backup_type, backup_path, file_size, status, error_message, started_at, completed_at, created_by, created_by_name)
           VALUES ($1, 'restore', $2, $3, 'failed', $4, NOW(), NOW(), $5, $6)`,
          [schoolId, 'uploaded_file', req.file ? req.file.size : 0, err.message, userId || null, userName]
        );
      }
    } catch (logErr) {
      console.error("[Restore] Failed to log restore error:", logErr);
    }

    // تنظيف الملف المؤقت
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }

    return res.status(500).json({ error: `فشلت استعادة قاعدة البيانات: ${err.message}` });
  }
}
// 🟢 جلب حالة الاتصال بـ Google Drive للمدرسة (BYOD)
export async function getGoogleDriveStatus(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    // جلب التوكن فقط لفحص وجوده
    const result = await pool.query(
      `SELECT google_drive_refresh_token FROM backup_settings WHERE school_id = $1`,
      [schoolId]
    );

    const row = result.rows[0];
    const isConnected = !!(row && row.google_drive_refresh_token);

    return res.json({ 
      connected: isConnected,
      email: isConnected ? "حساب السحاب النشط للمدرسة" : null 
    });
  } catch (e) {
    console.error("getGoogleDriveStatus error:", e);
    return res.status(500).json({ error: e.message });
  }
}

// 🟢 إلغاء ربط حساب Google Drive وحذف التوكن والمجلد بأمان من الإعدادات
export async function disconnectGoogleDrive(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    // تصفير حقول قوقل درايف لقطع الاتصال والتزامن الخلفي
    await pool.query(
      `UPDATE backup_settings 
       SET google_drive_refresh_token = NULL, 
           google_drive_folder_id = NULL, 
           updated_at = NOW() 
       WHERE school_id = $1`,
      [schoolId]
    );

    return res.json({ message: "تم فصل حساب Google Drive وإلغاء التزامن السحابي بنجاح ✅" });
  } catch (e) {
    console.error("disconnectGoogleDrive error:", e);
    return res.status(500).json({ error: e.message });
  }
}
