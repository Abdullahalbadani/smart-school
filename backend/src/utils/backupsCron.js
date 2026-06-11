import cron from 'node-cron';
import { pool } from '../config/db.js';
import { executeBackup } from './backupExecutor.js';
import WorkflowNotifications from '../modules/notifications/workflowNotificationService.js';

const CRON_TIMEZONE =
  process.env.BACKUP_CRON_TIMEZONE ||
  process.env.TZ ||
  'Asia/Aden';

// حماية إضافية داخل نسخة التطبيق الحالية
const runningSchoolBackups = new Set();

function toPositiveNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
}

function parseBackupTime(timeStr) {
  const [rawHours, rawMinutes, rawSeconds] = String(
    timeStr || '02:00:00'
  )
    .split(':')
    .map(Number);

  return {
    hours:
      Number.isInteger(rawHours) &&
      rawHours >= 0 &&
      rawHours <= 23
        ? rawHours
        : 2,

    minutes:
      Number.isInteger(rawMinutes) &&
      rawMinutes >= 0 &&
      rawMinutes <= 59
        ? rawMinutes
        : 0,

    seconds:
      Number.isInteger(rawSeconds) &&
      rawSeconds >= 0 &&
      rawSeconds <= 59
        ? rawSeconds
        : 0
  };
}

// حساب آخر موعد مستحق حسب إعدادات المدرسة
export function getMostRecentTargetTime(
  frequency,
  timeStr,
  dayOfWeek,
  customHours,
  now = new Date()
) {
  const { hours, minutes, seconds } =
    parseBackupTime(timeStr);

  if (frequency === 'hourly') {
    return new Date(now.getTime() - 60 * 60 * 1000);
  }

  if (frequency === 'custom') {
    const intervalHours =
      toPositiveNumber(customHours, 24);

    return new Date(
      now.getTime() - intervalHours * 60 * 60 * 1000
    );
  }

  if (frequency === 'daily') {
    const target = new Date(now);

    target.setHours(hours, minutes, seconds, 0);

    if (now < target) {
      target.setDate(target.getDate() - 1);
    }

    return target;
  }

  if (frequency === 'weekly') {
    const target = new Date(now);
    const targetDay = Number.isInteger(Number(dayOfWeek))
      ? Number(dayOfWeek)
      : 0;

    target.setHours(hours, minutes, seconds, 0);

    let difference = target.getDay() - targetDay;

    if (difference < 0) {
      difference += 7;
    }

    target.setDate(target.getDate() - difference);

    if (now < target) {
      target.setDate(target.getDate() - 7);
    }

    return target;
  }

  if (frequency === 'monthly') {
    const target = new Date(now);

    target.setDate(1);
    target.setHours(hours, minutes, seconds, 0);

    if (now < target) {
      target.setMonth(target.getMonth() - 1);
    }

    return target;
  }

  return null;
}

async function hasRecentRunningBackup(schoolId) {
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

async function runSchoolBackupIfDue(setting, app = null) {
  const schoolId = Number(setting.school_id);

  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    console.error(
      '[Backup Cron] Skipping invalid school_id:',
      setting.school_id
    );

    return;
  }

  const target = getMostRecentTargetTime(
    setting.auto_backup_frequency,
    setting.auto_backup_time,
    setting.auto_backup_day,
    setting.auto_backup_interval_hours
  );

  if (!target) {
    console.warn(
      `[Backup Cron] Unsupported frequency for school #${schoolId}:`,
      setting.auto_backup_frequency
    );

    return;
  }

  const lastBackupAt = setting.last_backup_at
    ? new Date(setting.last_backup_at)
    : null;

  const isOverdue =
    !lastBackupAt ||
    Number.isNaN(lastBackupAt.getTime()) ||
    lastBackupAt < target;

  if (!isOverdue) {
    return;
  }

  if (runningSchoolBackups.has(schoolId)) {
    console.log(
      `[Backup Cron] School #${schoolId} is already running in this process. Skipping.`
    );

    return;
  }

  if (await hasRecentRunningBackup(schoolId)) {
    console.log(
      `[Backup Cron] School #${schoolId} already has a running backup. Skipping.`
    );

    return;
  }

  runningSchoolBackups.add(schoolId);

  try {
    console.log(
      `[Backup Cron] School #${schoolId} backup is due. Running automatic backup...`
    );

    await executeBackup({
      schoolId,
      type: 'auto',
      userId: null,
      userName: 'النظام تلقائياً'
    });

    console.log(
      `[Backup Cron] Automatic backup completed for school #${schoolId}.`
    );
  } catch (error) {
    console.error(
      `[Backup Cron] Automatic backup failed for school #${schoolId}:`,
      error.message
    );

    try {
      await WorkflowNotifications.notifyBackupFailure({
        app,
        schoolId,
        errorMessage: error.message,
      });
    } catch (notifyErr) {
      console.error(`[Backup Cron] Failed to notify school #${schoolId}:`, notifyErr.message);
    }
  } finally {
    runningSchoolBackups.delete(schoolId);
  }
}

export function startBackupsCronJob(app = null) {
  console.log(
    `[Backup Cron] Scheduler initialized. Timezone: ${CRON_TIMEZONE}`
  );

  return cron.schedule(
    '* * * * *',
    async () => {
      try {
        const { rows: settings } = await pool.query(
          `
            SELECT
              school_id,
              auto_backup_enabled,
              auto_backup_frequency,
              auto_backup_time,
              auto_backup_day,
              auto_backup_interval_hours,
              last_backup_at,
              last_backup_status
            FROM backup_settings
            WHERE auto_backup_enabled = TRUE
            ORDER BY school_id
          `
        );

        // التنفيذ متسلسل لتجنب ضغط مفاجئ على قاعدة البيانات
        for (const setting of settings) {
          await runSchoolBackupIfDue(setting, app);
        }
      } catch (error) {
        console.error(
          '[Backup Cron] Error during automatic backup check:',
          error
        );
      }
    },
    {
      name: 'school-automatic-backups',
      timezone: CRON_TIMEZONE,
      noOverlap: true
    }
  );
}
