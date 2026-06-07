import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import {
  executeBackup,
  runPsqlRestore
} from '../utils/backupExecutor.js';
import { deleteFromGoogleDrive } from '../utils/googleDriveHelper.js';

const DEFAULT_BACKUP_ROOT = path.resolve(
  process.env.BACKUP_STORAGE_ROOT ||
  path.join(process.cwd(), 'backups')
);

const ALLOW_ALL_SERVER_PATHS = /^(?:1|true|yes)$/i.test(
  String(
    process.env.BACKUP_ALLOW_ALL_SERVER_PATHS ||
    ''
  ).trim()
);

const MAX_RESTORE_FILE_SIZE_BYTES =
  Math.max(
    1,
    Number.parseInt(
      process.env.MAX_RESTORE_FILE_SIZE_MB || '2048',
      10
    )
  ) *
  1024 *
  1024;

function uniqueResolvedPaths(paths) {
  return [
    ...new Set(
      paths
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => path.resolve(value))
    )
  ];
}

function getAllowedBackupRoots() {
  const configuredRoots = String(
    process.env.BACKUP_ALLOWED_ROOTS || ''
  )
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const roots = uniqueResolvedPaths([
    DEFAULT_BACKUP_ROOT,
    ...configuredRoots
  ]);

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
  }

  return roots;
}

function listWindowsDrives() {
  if (process.platform !== 'win32') {
    return [];
  }

  const drives = [];

  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:\\`;

    try {
      if (fs.existsSync(drive)) {
        drives.push(drive);
      }
    } catch {
      // Ignore inaccessible drives.
    }
  }

  return drives;
}

function getBrowseRoots() {
  if (ALLOW_ALL_SERVER_PATHS) {
    if (process.platform === 'win32') {
      return listWindowsDrives();
    }

    return ['/'];
  }

  return getAllowedBackupRoots();
}

function getAuthenticatedSchoolId(req) {
  const rawSchoolId =
    req.user?.school_id ??
    req.user?.schoolId;

  const schoolId = Number(rawSchoolId);

  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    return null;
  }

  return schoolId;
}

function getAuthenticatedUserId(req) {
  const userId = Number(req.user?.id);

  return Number.isSafeInteger(userId) && userId > 0
    ? userId
    : null;
}

function getAuthenticatedUserName(req) {
  return (
    req.user?.name ||
    req.user?.username ||
    'مدير المدرسة'
  );
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off', ''].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return fallback;
}

function parseIntegerInRange(
  value,
  fallback,
  min,
  max,
  fieldName
) {
  const number = Number.parseInt(value, 10);
  const resolved = Number.isInteger(number)
    ? number
    : fallback;

  if (
    !Number.isInteger(resolved) ||
    resolved < min ||
    resolved > max
  ) {
    throw new Error(
      `${fieldName} يجب أن يكون بين ${min} و ${max}`
    );
  }

  return resolved;
}

function normalizeTime(value) {
  const time = String(value || '02:00:00').trim();

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error('وقت النسخ الاحتياطي غير صالح');
  }

  return time.length === 5
    ? `${time}:00`
    : time;
}

function isPathInside(basePath, targetPath) {
  const relative = path.relative(
    path.resolve(basePath),
    path.resolve(targetPath)
  );

  return (
    relative === '' ||
    (
      !relative.startsWith('..') &&
      !path.isAbsolute(relative)
    )
  );
}

function isAllowedServerPath(targetPath) {
  if (ALLOW_ALL_SERVER_PATHS) {
    return true;
  }

  return getAllowedBackupRoots().some((root) =>
    isPathInside(root, targetPath)
  );
}

function resolveAllowedBackupDirectory(requestedPath) {
  const input = String(requestedPath || '').trim();

  const resolved = path.resolve(
    input || DEFAULT_BACKUP_ROOT
  );

  if (!isAllowedServerPath(resolved)) {
    throw new Error(
      'المسار المحدد خارج مجلدات النسخ الاحتياطي المسموح بها'
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('المجلد المحدد غير موجود');
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('المسار المحدد ليس مجلدًا');
  }

  return resolved;
}

function resolveAllowedSqlFile(requestedPath) {
  const input = String(requestedPath || '').trim();

  if (!input) {
    throw new Error('لم يتم اختيار ملف النسخة الاحتياطية');
  }

  const resolved = path.resolve(input);

  if (!isAllowedServerPath(resolved)) {
    throw new Error(
      'ملف النسخة خارج مجلدات النسخ الاحتياطي المسموح بها'
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود');
  }

  const stat = fs.statSync(resolved);

  if (!stat.isFile()) {
    throw new Error('المسار المحدد ليس ملفًا');
  }

  if (path.extname(resolved).toLowerCase() !== '.sql') {
    throw new Error('يجب اختيار ملف SQL فقط');
  }

  if (stat.size <= 0) {
    throw new Error('ملف النسخة الاحتياطية فارغ');
  }

  if (stat.size > MAX_RESTORE_FILE_SIZE_BYTES) {
    throw new Error('حجم ملف النسخة الاحتياطية أكبر من الحد المسموح');
  }

  return resolved;
}

function getSafeParentPath(targetPath) {
  const parentPath = path.dirname(targetPath);

  if (parentPath === targetPath) {
    return null;
  }

  return isAllowedServerPath(parentPath)
    ? parentPath
    : null;
}

function isOtherSchoolFolder(folderName, schoolId) {
  const match = /^school_(\d+)$/i.exec(
    String(folderName || '')
  );

  return Boolean(
    match &&
    Number(match[1]) !== Number(schoolId)
  );
}

function readDirectoryEntries(
  targetPath,
  schoolId,
  includeSqlFiles = false
) {
  const directories = [];
  const files = [];

  const items = fs.readdirSync(targetPath, {
    withFileTypes: true
  });

  for (const item of items) {
    if (
      item.name.startsWith('.') ||
      item.name.startsWith('$') ||
      item.name === 'node_modules'
    ) {
      continue;
    }

    if (
      item.isDirectory() &&
      !isOtherSchoolFolder(item.name, schoolId)
    ) {
      directories.push({
        name: item.name,
        path: path.join(targetPath, item.name)
      });

      continue;
    }

    if (
      includeSqlFiles &&
      item.isFile() &&
      path.extname(item.name).toLowerCase() === '.sql'
    ) {
      const filePath = path.join(targetPath, item.name);
      const stat = fs.statSync(filePath);

      files.push({
        name: item.name,
        path: filePath,
        size: stat.size,
        modified_at: stat.mtime
      });
    }
  }

  directories.sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  files.sort((a, b) =>
    b.modified_at - a.modified_at
  );

  return {
    directories,
    files
  };
}

function sanitizeSettings(row, schoolId) {
  const data = row
    ? { ...row }
    : {
        school_id: schoolId,
        auto_backup_enabled: false,
        auto_backup_frequency: 'daily',
        auto_backup_interval_hours: 24,
        auto_backup_time: '02:00:00',
        auto_backup_day: 0,
        backup_path: DEFAULT_BACKUP_ROOT,
        keep_backups_count: 10,
        last_backup_at: null,
        last_backup_status: null,
        last_backup_path: null,
        last_backup_error: null
      };

  delete data.google_drive_refresh_token;

  return data;
}

async function findSuccessfulBackupForSchool(
  backupLogId,
  schoolId
) {
  const result = await pool.query(
    `
      SELECT
        id,
        school_id,
        backup_type,
        backup_path,
        file_size,
        status,
        google_drive_file_id,
        created_at
      FROM backup_logs
      WHERE id = $1
        AND school_id = $2
        AND status = 'success'
        AND backup_type IN ('manual', 'auto')
      LIMIT 1
    `,
    [backupLogId, schoolId]
  );

  return result.rows[0] || null;
}

async function hasRunningBackup(schoolId) {
  const result = await pool.query(
    `
      SELECT 1
      FROM backup_logs
      WHERE school_id = $1
        AND status = 'running'
        AND started_at >= NOW() - INTERVAL '6 hours'
      LIMIT 1
    `,
    [schoolId]
  );

  return result.rowCount > 0;
}

// جلب إعدادات النسخ الاحتياطي الحالية
export async function getSettings(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const result = await pool.query(
      `
        SELECT *
        FROM backup_settings
        WHERE school_id = $1
      `,
      [schoolId]
    );

    return res.json({
      data: sanitizeSettings(
        result.rows[0],
        schoolId
      )
    });
  } catch (error) {
    console.error('getSettings error:', error);

    return res.status(500).json({
      error: error.message
    });
  }
}

// تحديث أو إنشاء إعدادات النسخ الاحتياطي
export async function updateSettings(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const allowedFrequencies = new Set([
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'custom'
    ]);

    const frequency = String(
      req.body.auto_backup_frequency || 'daily'
    )
      .trim()
      .toLowerCase();

    if (!allowedFrequencies.has(frequency)) {
      return res.status(400).json({
        error: 'تكرار النسخ الاحتياطي غير صالح'
      });
    }

    const enabled = parseBoolean(
      req.body.auto_backup_enabled,
      false
    );

    const intervalHours = parseIntegerInRange(
      req.body.auto_backup_interval_hours,
      24,
      1,
      8760,
      'الفاصل الزمني'
    );

    const dayOfWeek = parseIntegerInRange(
      req.body.auto_backup_day,
      0,
      0,
      6,
      'يوم النسخ الأسبوعي'
    );

    const keepCount = parseIntegerInRange(
      req.body.keep_backups_count,
      10,
      1,
      100,
      'عدد النسخ المحتفظ بها'
    );

    const backupTime = normalizeTime(
      req.body.auto_backup_time
    );

    const backupPath = resolveAllowedBackupDirectory(
      req.body.backup_path
    );

    const result = await pool.query(
      `
        INSERT INTO backup_settings (
          school_id,
          auto_backup_enabled,
          auto_backup_frequency,
          auto_backup_interval_hours,
          auto_backup_time,
          auto_backup_day,
          backup_path,
          keep_backups_count,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, NOW()
        )
        ON CONFLICT (school_id) DO UPDATE
        SET
          auto_backup_enabled =
            EXCLUDED.auto_backup_enabled,
          auto_backup_frequency =
            EXCLUDED.auto_backup_frequency,
          auto_backup_interval_hours =
            EXCLUDED.auto_backup_interval_hours,
          auto_backup_time =
            EXCLUDED.auto_backup_time,
          auto_backup_day =
            EXCLUDED.auto_backup_day,
          backup_path =
            EXCLUDED.backup_path,
          keep_backups_count =
            EXCLUDED.keep_backups_count,
          updated_at = NOW()
        RETURNING *
      `,
      [
        schoolId,
        enabled,
        frequency,
        intervalHours,
        backupTime,
        dayOfWeek,
        backupPath,
        keepCount
      ]
    );

    return res.json({
      message:
        'تم حفظ إعدادات النسخ الاحتياطي بنجاح ✅',
      data: sanitizeSettings(
        result.rows[0],
        schoolId
      )
    });
  } catch (error) {
    console.error('updateSettings error:', error);

    return res.status(400).json({
      error: error.message
    });
  }
}

// جلب سجل النسخ الاحتياطي مع الترقيم
export async function getLogs(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const page = Math.max(
      1,
      Number.parseInt(req.query.page || '1', 10)
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query.limit || '10', 10)
      )
    );

    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `
        SELECT COUNT(*)
        FROM backup_logs
        WHERE school_id = $1
      `,
      [schoolId]
    );

    const total = Number.parseInt(
      countResult.rows[0].count,
      10
    );

    const logsResult = await pool.query(
      `
        SELECT
          id,
          backup_type,
          backup_path,
          file_size,
          status,
          error_message,
          started_at,
          completed_at,
          created_by_name,
          google_drive_file_id
        FROM backup_logs
        WHERE school_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
      `,
      [schoolId, limit, offset]
    );

    const logs = logsResult.rows.map((log) => ({
      ...log,
      backup_path: log.backup_path
        ? path.basename(log.backup_path)
        : null,
      has_cloud_copy: Boolean(
        log.google_drive_file_id
      ),
      google_drive_file_id: undefined
    }));

    return res.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('getLogs error:', error);

    return res.status(500).json({
      error: error.message
    });
  }
}

// تشغيل النسخ الاحتياطي اليدوي الفوري
export async function runManualBackup(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const userId = getAuthenticatedUserId(req);
    const userName = getAuthenticatedUserName(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    if (await hasRunningBackup(schoolId)) {
      return res.status(409).json({
        error:
          'توجد عملية نسخ احتياطي قيد التنفيذ لهذه المدرسة'
      });
    }

    console.log(
      `[Backup Controller] ${userName} requested manual backup for school #${schoolId}`
    );

    const result = await executeBackup({
      schoolId,
      type: 'manual',
      userId,
      userName
    });

    return res.json({
      message:
        'تم إنشاء نسخة احتياطية يدوية بنجاح ✅',
      data: {
        id: result.logId,
        fileName: path.basename(result.path),
        size: result.size
      }
    });
  } catch (error) {
    console.error('runManualBackup error:', error);

    return res.status(500).json({
      error:
        `فشل إنشاء النسخة الاحتياطية: ${error.message}`
    });
  }
}

// تحميل ملف النسخ الاحتياطي بأمان
export async function downloadBackup(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const backupLogId = Number(req.params.id);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    if (
      !Number.isSafeInteger(backupLogId) ||
      backupLogId <= 0
    ) {
      return res.status(400).json({
        error: 'رقم النسخة الاحتياطية غير صالح'
      });
    }

    const backup = await findSuccessfulBackupForSchool(
      backupLogId,
      schoolId
    );

    if (!backup) {
      return res.status(404).json({
        error:
          'الملف غير موجود أو لا تملك صلاحية الوصول إليه'
      });
    }

    const resolvedPath = path.resolve(
      backup.backup_path
    );

    if (!isAllowedServerPath(resolvedPath)) {
      return res.status(403).json({
        error: 'مسار الملف غير مسموح به'
      });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({
        error:
          'الملف غير متوفر على القرص أو تم حذفه'
      });
    }

    return res.download(
      resolvedPath,
      path.basename(resolvedPath)
    );
  } catch (error) {
    console.error('downloadBackup error:', error);

    return res.status(500).json({
      error: error.message
    });
  }
}

// حذف ملف وسجل النسخة الاحتياطية
export async function deleteBackup(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const backupLogId = Number(req.params.id);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    if (
      !Number.isSafeInteger(backupLogId) ||
      backupLogId <= 0
    ) {
      return res.status(400).json({
        error: 'رقم النسخة الاحتياطية غير صالح'
      });
    }

    const result = await pool.query(
      `
        SELECT
          id,
          school_id,
          backup_path,
          google_drive_file_id
        FROM backup_logs
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
      `,
      [backupLogId, schoolId]
    );

    const backup = result.rows[0];

    if (!backup) {
      return res.status(404).json({
        error:
          'السجل غير موجود أو لا تملك صلاحية حذفه'
      });
    }

    if (backup.backup_path) {
      const resolvedPath = path.resolve(
        backup.backup_path
      );

      if (
        isAllowedServerPath(resolvedPath) &&
        fs.existsSync(resolvedPath)
      ) {
        try {
          fs.unlinkSync(resolvedPath);
        } catch (error) {
          console.warn(
            '[Backup Controller] Could not delete local file:',
            error.message
          );
        }
      }
    }

    if (backup.google_drive_file_id) {
      try {
        await deleteFromGoogleDrive(
          schoolId,
          backup.google_drive_file_id
        );
      } catch (error) {
        console.warn(
          '[Backup Controller] Could not delete cloud file:',
          error.message
        );
      }
    }

    await pool.query(
      `
        DELETE FROM backup_logs
        WHERE id = $1
          AND school_id = $2
      `,
      [backupLogId, schoolId]
    );

    return res.json({
      message:
        'تم حذف ملف وسجل النسخة الاحتياطية بنجاح ✅'
    });
  } catch (error) {
    console.error('deleteBackup error:', error);

    return res.status(500).json({
      error: error.message
    });
  }
}

// تصفح مجلدات الخادم المسموح بها لاختيار مكان الحفظ
export async function browseDirectories(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const targetPath = resolveAllowedBackupDirectory(
      req.query.path
    );

    const { directories } = readDirectoryEntries(
      targetPath,
      schoolId,
      false
    );

    return res.json({
      data: {
        currentPath: targetPath,
        parentPath: getSafeParentPath(targetPath),
        directories,
        files: [],
        roots: getBrowseRoots(),
        drives: getBrowseRoots(),
        unrestricted: ALLOW_ALL_SERVER_PATHS
      }
    });
  } catch (error) {
    console.error('browseDirectories error:', error);

    return res.status(400).json({
      error: error.message
    });
  }
}

// تصفح المجلدات وملفات SQL لاختيار نسخة للاستعادة
export async function browseRestoreFiles(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const targetPath = resolveAllowedBackupDirectory(
      req.query.path
    );

    const { directories, files } =
      readDirectoryEntries(
        targetPath,
        schoolId,
        true
      );

    return res.json({
      data: {
        currentPath: targetPath,
        parentPath: getSafeParentPath(targetPath),
        directories,
        files,
        roots: getBrowseRoots(),
        drives: getBrowseRoots(),
        unrestricted: ALLOW_ALL_SERVER_PATHS
      }
    });
  } catch (error) {
    console.error('browseRestoreFiles error:', error);

    return res.status(400).json({
      error: error.message
    });
  }
}

async function performSchoolRestore({
  schoolId,
  userId,
  userName,
  sourcePath,
  sourceLabel,
  sourceSize
}) {
  if (await hasRunningBackup(schoolId)) {
    throw new Error(
      'توجد عملية نسخ احتياطي أخرى قيد التنفيذ لهذه المدرسة'
    );
  }

  console.log(
    `[Restore] Creating safety backup before restoring school #${schoolId}...`
  );

  const safetyBackup = await executeBackup({
    schoolId,
    type: 'manual',
    userId,
    userName:
      `نسخة أمان قبل الاستعادة - ${userName}`
  });

  console.log(
    `[Restore] Restoring ${sourceLabel} for school #${schoolId}...`
  );

  // runPsqlRestore يتحقق من أن رأس الملف يحمل رقم المدرسة نفسها.
  await runPsqlRestore(
    sourcePath,
    schoolId
  );

  const completedAt = new Date();

  await pool.query(
    `
      INSERT INTO backup_logs (
        school_id,
        backup_type,
        backup_path,
        file_size,
        status,
        started_at,
        completed_at,
        created_by,
        created_by_name
      )
      VALUES (
        $1,
        'restore',
        $2,
        $3,
        'success',
        NOW(),
        $4,
        $5,
        $6
      )
    `,
    [
      schoolId,
      sourceLabel,
      sourceSize || 0,
      completedAt,
      userId,
      userName
    ]
  );

  return {
    safetyBackupId: safetyBackup.logId
  };
}

async function logRestoreFailure(
  req,
  error,
  sourceLabel = 'restore_failed'
) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const userId = getAuthenticatedUserId(req);
    const userName = getAuthenticatedUserName(req);

    if (!schoolId) return;

    await pool.query(
      `
        INSERT INTO backup_logs (
          school_id,
          backup_type,
          backup_path,
          file_size,
          status,
          error_message,
          started_at,
          completed_at,
          created_by,
          created_by_name
        )
        VALUES (
          $1,
          'restore',
          $2,
          0,
          'failed',
          $3,
          NOW(),
          NOW(),
          $4,
          $5
        )
      `,
      [
        schoolId,
        sourceLabel,
        error.message,
        userId,
        userName
      ]
    );
  } catch (logError) {
    console.error(
      '[Restore] Failed to log restore error:',
      logError
    );
  }
}

// استعادة نسخة محفوظة سابقًا من سجل المدرسة
export async function restoreBackup(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const userId = getAuthenticatedUserId(req);
    const userName = getAuthenticatedUserName(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const backupLogId = Number(
      req.params.id ??
      req.body.backupLogId ??
      req.body.id
    );

    if (
      !Number.isSafeInteger(backupLogId) ||
      backupLogId <= 0
    ) {
      return res.status(400).json({
        error:
          'اختر نسخة احتياطية محفوظة من سجل النسخ لاستعادتها'
      });
    }

    const backup = await findSuccessfulBackupForSchool(
      backupLogId,
      schoolId
    );

    if (!backup) {
      return res.status(404).json({
        error:
          'النسخة غير موجودة أو لا تخص المدرسة الحالية'
      });
    }

    const sourcePath = resolveAllowedSqlFile(
      backup.backup_path
    );

    const result = await performSchoolRestore({
      schoolId,
      userId,
      userName,
      sourcePath,
      sourceLabel:
        `restored_from_log_${backupLogId}`,
      sourceSize: backup.file_size
    });

    return res.json({
      success: true,
      message:
        'تمت استعادة نسخة المدرسة بنجاح ✅',
      data: {
        restoredBackupId: backupLogId,
        safetyBackupId: result.safetyBackupId
      }
    });
  } catch (error) {
    console.error(
      '[Restore] Database restore failed:',
      error
    );

    await logRestoreFailure(req, error);

    return res.status(500).json({
      error:
        `فشلت استعادة نسخة المدرسة: ${error.message}`
    });
  }
}

// استعادة ملف SQL موجود داخل أحد مجلدات الخادم المسموح بها
export async function restoreBackupFromFile(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);
    const userId = getAuthenticatedUserId(req);
    const userName = getAuthenticatedUserName(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const sourcePath = resolveAllowedSqlFile(
      req.body.filePath
    );

    const sourceStat = fs.statSync(sourcePath);

    const result = await performSchoolRestore({
      schoolId,
      userId,
      userName,
      sourcePath,
      sourceLabel:
        `restored_from_file_${path.basename(sourcePath)}`,
      sourceSize: sourceStat.size
    });

    return res.json({
      success: true,
      message:
        'تمت استعادة نسخة المدرسة من الملف المحدد بنجاح ✅',
      data: {
        fileName: path.basename(sourcePath),
        safetyBackupId: result.safetyBackupId
      }
    });
  } catch (error) {
    console.error(
      '[Restore From File] Database restore failed:',
      error
    );

    await logRestoreFailure(
      req,
      error,
      'restore_from_file_failed'
    );

    return res.status(500).json({
      error:
        `فشلت استعادة نسخة المدرسة من الملف: ${error.message}`
    });
  }
}

// جلب حالة الاتصال بـ Google Drive للمدرسة
export async function getGoogleDriveStatus(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    const result = await pool.query(
      `
        SELECT google_drive_refresh_token
        FROM backup_settings
        WHERE school_id = $1
      `,
      [schoolId]
    );

    const isConnected = Boolean(
      result.rows[0]?.google_drive_refresh_token
    );

    return res.json({
      connected: isConnected,
      email: isConnected
        ? 'حساب السحاب النشط للمدرسة'
        : null
    });
  } catch (error) {
    console.error(
      'getGoogleDriveStatus error:',
      error
    );

    return res.status(500).json({
      error: error.message
    });
  }
}

// إلغاء ربط Google Drive
export async function disconnectGoogleDrive(req, res) {
  try {
    const schoolId = getAuthenticatedSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({
        error: 'غير مصرح'
      });
    }

    await pool.query(
      `
        UPDATE backup_settings
        SET
          google_drive_refresh_token = NULL,
          google_drive_folder_id = NULL,
          updated_at = NOW()
        WHERE school_id = $1
      `,
      [schoolId]
    );

    return res.json({
      message:
        'تم فصل حساب Google Drive وإلغاء التزامن السحابي بنجاح ✅'
    });
  } catch (error) {
    console.error(
      'disconnectGoogleDrive error:',
      error
    );

    return res.status(500).json({
      error: error.message
    });
  }
}
