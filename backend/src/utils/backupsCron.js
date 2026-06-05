import cron from 'node-cron';
import { pool } from '../config/db.js';
import { executeBackup } from './backupExecutor.js';

// حساب الوقت المستحق للتكرار المختار بدقة عالية بالدقائق
export function getMostRecentTargetTime(freq, timeStr, dayOfWeek, customHours) {
  const now = new Date();
  const [h, m, s] = (timeStr || '02:00:00').split(':').map(Number);
  
  if (freq === 'hourly') {
    // نرجع للخلف 60 دقيقة كاملة وبشكل طبيعي لأن الفحص أصبح دقيقاً بالدقائق
    return new Date(now.getTime() - 60 * 60 * 1000);
  }
  
  if (freq === 'custom') {
    const hours = customHours || 24;
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
  }
  
  if (freq === 'daily') {
    const target = new Date(now);
    target.setHours(h, m, s || 0, 0);
    if (now < target) {
      target.setDate(target.getDate() - 1);
    }
    return target;
  }
  
  if (freq === 'weekly') {
    const target = new Date(now);
    target.setHours(h, m, s || 0, 0);
    const currentDay = target.getDay();
    let diff = currentDay - (dayOfWeek || 0);
    if (diff < 0) {
      diff += 7;
    }
    target.setDate(target.getDate() - diff);
    if (now < target) {
      target.setDate(target.getDate() - 7);
    }
    return target;
  }
  
  if (freq === 'monthly') {
    const target = new Date(now);
    target.setDate(1);
    target.setHours(h, m, s || 0, 0);
    if (now < target) {
      target.setMonth(target.getMonth() - 1);
    }
    return target;
  }
  
  return null;
}

export function startBackupsCronJob() {
  console.log("⚙️ [Backup Cron] Initializing automatic backups scheduler (Minute-by-Minute)...");
  
  // 🔥 التعديل الجوهري: تشغيل الجدولة كل دقيقة (* * * * *) بدلاً من رأس كل ساعة
  // هذا يجعل النظام يطلق النسخة الاحتياطية في نفس الدقيقة المحددة من السيلكت بالواجهة تماماً
  cron.schedule('* * * * *', async () => {
    try {
      // 1. جلب المدارس التي تم تفعيل النسخ التلقائي لها
      const { rows } = await pool.query(
        `SELECT * FROM backup_settings WHERE auto_backup_enabled = true`
      );
      
      for (const setting of rows) {
        const freq = setting.auto_backup_frequency;
        const timeStr = setting.auto_backup_time;
        const dayOfWeek = setting.auto_backup_day;
        const customHours = setting.auto_backup_interval_hours;
        const lastBackupAt = setting.last_backup_at;
        
        const target = getMostRecentTargetTime(freq, timeStr, dayOfWeek, customHours);
        
        // التحقق إن كان النسخ مستحقاً بالدقيقة والثانية
        const isOverdue = target && (!lastBackupAt || new Date(lastBackupAt) < target);
        
        if (isOverdue) {
          console.log(`⏳ [Backup Cron] School #${setting.school_id} backup is due right now. Running backup...`);
          try {
            await executeBackup({
              schoolId: setting.school_id,
              type: 'auto',
              userName: 'النظام تلقائياً'
            });
          } catch (backupError) {
            console.error(`❌ [Backup Cron] Automatic backup failed for school #${setting.school_id}:`, backupError.message);
          }
        }
      }
    } catch (err) {
      console.error("❌ [Backup Cron] Error during minute backup check:", err);
    }
  });
}