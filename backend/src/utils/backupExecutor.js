import { exec, spawn } from 'child_process';
import { env as processEnv } from 'process';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from './googleDriveHelper.js';
// دالة تحليل متغيرات الاتصال بقاعدة البيانات
export function getDbConnectionParams() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      return {
        host: parsed.hostname,
        port: parsed.port || '5432',
        user: parsed.username,
        password: decodeURIComponent(parsed.password || ''),
        database: parsed.pathname.replace(/^\//, '')
      };
    } catch (e) {
      console.warn("Failed to parse DATABASE_URL, using individual variables", e.message);
    }
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '5432',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'school_system'
  };
}

// حل مسار الحفظ للمدرسة بشكل آمن
export function resolveBackupPath(configuredPath, schoolId) {
  let basePath = configuredPath ? configuredPath.trim() : 'backups';
  let resolved = path.isAbsolute(basePath)
    ? basePath
    : path.resolve(process.cwd(), basePath);
    
  // عزل ملفات كل مدرسة بوضعها في مجلد يحمل معرف المدرسة
  return path.join(resolved, `school_${schoolId}`);
}

// تنفيذ pg_dump والتقاط الناتج
export async function runPgDump(outputPath) {
  const params = getDbConnectionParams();
  
  // التأكد من وجود المجلد الأب للملف المخرج
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // محاولة تشغيل pg_dump المباشر
  const pgDumpCmd = `pg_dump -h "${params.host}" -p "${params.port}" -U "${params.user}" -d "${params.database}" -F p -b -v -f "${outputPath}"`;
  
  return new Promise((resolve, reject) => {
    const options = {
      env: {
        ...processEnv,
        PGPASSWORD: params.password
      }
    };
    
    console.log(`[Backup] Executing pg_dump on host: ${params.host}:${params.port}, db: ${params.database}`);
    exec(pgDumpCmd, options, (error, stdout, stderr) => {
      if (!error) {
        console.log(`[Backup] pg_dump completed successfully.`);
        return resolve({ stdout, stderr });
      }
      
      console.warn(`[Backup] Direct pg_dump failed: ${error.message}. Trying docker exec fallback...`);
      
      // التشغيل الاحتياطي عبر Docker في بيئة التطوير المحلية
      const containerName = 'smart-school-postgres';
      const fileStream = fs.createWriteStream(outputPath);
      
      const child = spawn('docker', [
        'exec',
        '-i',
        containerName,
        'pg_dump',
        '-U',
        params.user || 'postgres',
        '-d',
        params.database || 'school_system'
      ]);
      
      child.stdout.pipe(fileStream);
      
      let spawnError = '';
      child.stderr.on('data', (data) => {
        spawnError += data.toString();
      });
      
      child.on('error', (err) => {
        reject(new Error(`Docker backup failed: ${err.message}`));
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[Backup] Docker pg_dump completed successfully.`);
          resolve({ stdout: 'Docker backup complete', stderr: spawnError });
        } else {
          // في حال فشل كلتا الطريقتين نقوم بحذف الملف الفارغ الذي تم إنشاؤه
          if (fs.existsSync(outputPath)) {
            try { fs.unlinkSync(outputPath); } catch {}
          }
          reject(new Error(`Docker backup failed (code ${code}): ${spawnError}`));
        }
      });
    });
  });
}

// دالة تنظيف وتدوير الملفات القديمة (Retention policy)
export async function cleanOldBackups(schoolId, keepCount) {
  if (!keepCount || keepCount <= 0) return;
  
  try {
    // جلب جميع السجلات الناجحة للمدرسة مرتبة من الأقدم للأحدث
    const { rows } = await pool.query(
      `SELECT id, backup_path FROM backup_logs 
       WHERE school_id = $1 AND status = 'success' 
       ORDER BY created_at ASC`,
      [schoolId]
    );
    
    if (rows.length > keepCount) {
      const deleteCount = rows.length - keepCount;
      const toDelete = rows.slice(0, deleteCount);
      
      console.log(`[Backup] Cleanup: deleting ${deleteCount} old backups for school #${schoolId}`);
      
  for (const log of toDelete) {
        // حذف الملف من القرص المحلي
        if (fs.existsSync(log.backup_path)) {
          try {
            fs.unlinkSync(log.backup_path);
            console.log(`[Backup] Deleted file: ${log.backup_path}`);
          } catch (e) {
            console.warn(`[Backup] Could not delete file: ${log.backup_path}`, e.message);
          }
        }

        // 🟢 إضافة: حذف الملف من Google Drive الخاص بالمدرسة إذا كان مرفوعاً سحابياً
        if (log.google_drive_file_id) {
          try {
            // استدعاء دالة الحذف السحابية (ستمرر لها الـ Refresh Token ومعرف الملف)
            await deleteFromGoogleDrive(schoolId, log.google_drive_file_id);
            console.log(`[Backup] Deleted file from Google Drive: ${log.google_drive_file_id}`);
          } catch (gErr) {
            console.warn(`[Backup] Could not delete from Google Drive:`, gErr.message);
          }
        }
        
        // حذف السجل من قاعدة البيانات
        await pool.query(`DELETE FROM backup_logs WHERE id = $1`, [log.id]);
      }
    }
  } catch (err) {
    console.error(`[Backup] Retention cleanup failed for school #${schoolId}:`, err);
  }
}

// دالة تنفيذ النسخ الكامل (يدوي أو تلقائي) وتسجيله
export async function executeBackup({ schoolId, type, userId, userName }) {
  const startedAt = new Date();
  
  // 1. جلب إعدادات النسخ للمدرسة
  let settings = null;
  const setRes = await pool.query(
    `SELECT * FROM backup_settings WHERE school_id = $1`,
    [schoolId]
  );
  
  if (setRes.rowCount > 0) {
    settings = setRes.rows[0];
  } else {
    // إعدادات افتراضية إن لم توجد
    settings = {
      backup_path: 'backups',
      keep_backups_count: 10
    };
  }
  
  const targetDir = resolveBackupPath(settings.backup_path, schoolId);
  const subFolder = type === 'auto' ? 'auto' : 'manual';
  const finalDir = path.join(targetDir, subFolder);
  
  // اسم الملف: backup_type_school_id_date_time.sql
  const dateStr = startedAt.toISOString().slice(0, 10);
  const timeStr = startedAt.toTimeString().slice(0, 8).replace(/:/g, '-');
  const fileName = `backup_${type}_school_${schoolId}_${dateStr}_${timeStr}.sql`;
  const backupPath = path.join(finalDir, fileName);
  
  console.log(`[Backup] Starting ${type} backup for school #${schoolId} into: ${backupPath}`);
  
  // 2. إدخال سجل بدء العملية (الحالة running)
  const logRes = await pool.query(
    `INSERT INTO backup_logs 
     (school_id, backup_type, backup_path, status, started_at, created_by, created_by_name)
     VALUES ($1, $2, $3, 'running', $4, $5, $6) 
     RETURNING id`,
    [schoolId, type, backupPath, startedAt, userId || null, userName || (type === 'auto' ? 'النظام تلقائياً' : 'مجهول')]
  );
  const logId = logRes.rows[0].id;
try {
    // 3. تشغيل أخذ النسخة المحلية (التي وضعت إعداداتها بالواجهة)
    await runPgDump(backupPath);
    
    // 🟢 إضافة: رفع الملف تلقائياً إلى حساب Google Drive الخاص بالمدرسة (BYOD) إذا كانت رابطة حسابها
    let googleDriveFileId = null;
    try {
      if (settings.google_drive_refresh_token) {
        console.log(`[Backup] School has Google Drive linked. Triggering cloud upload...`);
        
        // استدعاء خدمة الرفع السحابي وتمرير المسار المحلي والتوكن الفريد للمدرسة
        const uploadResult = await uploadToGoogleDrive({
          schoolId,
          filePath: backupPath,
          fileName: fileName,
          refreshToken: settings.google_drive_refresh_token,
          folderId: settings.google_drive_folder_id
        });
        
        googleDriveFileId = uploadResult.fileId;
        console.log(`[Backup] Uploaded to Google Drive successfully. File ID: ${googleDriveFileId}`);
      }
    } catch (gErr) {
      console.warn(`[Backup] Google Drive upload failed or skipped: ${gErr.message}`);
    }
    
    // 4. احتساب الحجم وتحديث حالة السجل بالنجاح مع حفظ الـ file_id السحابي
    const completedAt = new Date();
    let fileSize = 0;
    if (fs.existsSync(backupPath)) {
      fileSize = fs.statSync(backupPath).size;
    }
    
    // حقن الـ google_drive_file_id داخل استعلام التحديث لتوثيق الرفع سحابياً
    await pool.query(
      `UPDATE backup_logs 
       SET status = 'success', file_size = $1, completed_at = $2, google_drive_file_id = $3 
       WHERE id = $4`,
      [fileSize, completedAt, googleDriveFileId, logId]
    );
    
    // تحديث الحالة في إعدادات المدرسة (مع دعم الإنشاء التلقائي إن لم يكن السجل موجوداً)
    await pool.query(
      `INSERT INTO backup_settings 
       (school_id, last_backup_at, last_backup_status, last_backup_path, last_backup_error, updated_at)
       VALUES ($1, $2, 'success', $3, NULL, NOW())
       ON CONFLICT (school_id) DO UPDATE 
       SET last_backup_at = EXCLUDED.last_backup_at,
           last_backup_status = EXCLUDED.last_backup_status,
           last_backup_path = EXCLUDED.last_backup_path,
           last_backup_error = EXCLUDED.last_backup_error,
           updated_at = NOW()`,
      [schoolId, completedAt, backupPath]
    );
    
    console.log(`[Backup] ${type} backup completed successfully for school #${schoolId}. File size: ${fileSize} bytes.`);
    
    // 5. تطبيق سياسة الحفاظ على الملفات وتدويرها
    await cleanOldBackups(schoolId, settings.keep_backups_count);
    
    return { logId, status: 'success', path: backupPath, size: fileSize };
  } catch (err) {
    const completedAt = new Date();
    console.error(`[Backup] ${type} backup failed for school #${schoolId}:`, err.message);
    
    // تحديث حالة السجل بالفشل
    await pool.query(
      `UPDATE backup_logs 
       SET status = 'failed', error_message = $1, completed_at = $2 
       WHERE id = $3`,
      [err.message, completedAt, logId]
    );
    
    // تحديث إعدادات المدرسة بالفشل
    await pool.query(
      `INSERT INTO backup_settings (school_id, last_backup_at, last_backup_status, last_backup_error, updated_at)
       VALUES ($1, $2, 'failed', $3, NOW())
       ON CONFLICT (school_id) DO UPDATE 
       SET last_backup_at = EXCLUDED.last_backup_at, last_backup_status = EXCLUDED.last_backup_status, 
           last_backup_error = EXCLUDED.last_backup_error, updated_at = NOW()`,
      [schoolId, completedAt, err.message]
    );
    
    throw err;
  }
}

// تنفيذ psql لاستعادة نسخة احتياطية
export async function runPsqlRestore(inputPath) {
  const params = getDbConnectionParams();
  
  if (!fs.existsSync(inputPath)) {
    throw new Error("ملف النسخة الاحتياطية غير موجود");
  }

  // محاولة تشغيل psql المباشر
  const psqlCmd = `psql -h "${params.host}" -p "${params.port}" -U "${params.user}" -d "${params.database}" -f "${inputPath}"`;
  
  return new Promise((resolve, reject) => {
    const options = {
      env: {
        ...processEnv,
        PGPASSWORD: params.password
      }
    };
    
    console.log(`[Restore] Executing psql restore on host: ${params.host}:${params.port}, db: ${params.database}`);
    exec(psqlCmd, options, (error, stdout, stderr) => {
      if (!error) {
        console.log(`[Restore] psql restore completed successfully.`);
        return resolve({ stdout, stderr });
      }
      
      console.warn(`[Restore] Direct psql restore failed: ${error.message}. Trying docker exec fallback...`);
      
      // التشغيل الاحتياطي عبر Docker
      const containerName = 'smart-school-postgres';
      const fileStream = fs.createReadStream(inputPath);
      
      const child = spawn('docker', [
        'exec',
        '-i',
        containerName,
        'psql',
        '-U',
        params.user || 'postgres',
        '-d',
        params.database || 'school_system'
      ]);
      
      fileStream.pipe(child.stdin);
      
      let spawnError = '';
      let spawnOutput = '';
      child.stdout.on('data', (data) => {
        spawnOutput += data.toString();
      });
      child.stderr.on('data', (data) => {
        spawnError += data.toString();
      });
      
      child.on('error', (err) => {
        reject(new Error(`Docker restore failed: ${err.message}`));
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[Restore] Docker psql restore completed successfully.`);
          resolve({ stdout: spawnOutput, stderr: spawnError });
        } else {
          reject(new Error(`Docker restore failed (code ${code}): ${spawnError}`));
        }
      });
    });
  });
}

