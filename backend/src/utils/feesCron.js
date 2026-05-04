import cron from "node-cron";
import { pool } from "../config/db.js";

// هذه الدالة ستبحث عن الأقساط وترسل الإشعارات لكل المدارس بشكل معزول
async function checkAndSendFeesNotifications(io) {
  try {
    console.log("[CRON] Starting daily fees check for all schools...");

    // استعلام ذكي يجلب الأقساط غير المدفوعة لكل المدارس
    // ويربط كل قسط بالسنة الدراسية النشطة الخاصة بمدرسته
    const query = `
      SELECT 
        fi.id AS installment_id, fi.installment_no, fi.due_date, fi.amount, fi.paid_amount, 
        (fi.amount - COALESCE(fi.paid_amount, 0)) AS remaining_amount,
        (fi.due_date - CURRENT_DATE) AS days_diff,
        s.id AS student_id, s.full_name AS student_name,
        g.user_id AS parent_user_id,
        fc.school_id -- 👈 جلب معرف المدرسة لتوجيه الإشعار بشكل صحيح
      FROM fee_installments fi
      JOIN fee_contracts fc ON fi.contract_id = fc.id
      JOIN academic_years ay ON fc.academic_year_id = ay.id AND ay.is_active = true -- 👈 جلب السنة النشطة الخاصة بكل مدرسة فقط
      JOIN students s ON fc.student_id = s.id
      JOIN student_guardians sg ON s.id = sg.student_id AND sg.is_primary = true
      JOIN guardians g ON sg.guardian_id = g.id
      WHERE fi.status IN ('unpaid', 'partial')
        AND (fi.due_date - CURRENT_DATE) IN (3, 0, -3, -7)
    `;

    const { rows } = await pool.query(query);

    if (rows.length === 0) {
      console.log("[CRON] No fees notifications needed today.");
      return;
    }

    for (const row of rows) {
      let title = "";
      let body = "";
      let priority = "normal";

      // تحديد نص الرسالة بناءً على حالة الأيام
      if (row.days_diff === 3) {
        title = "تذكير باقتراب موعد قسط دراسي";
        body = `نود تذكيركم بأن القسط رقم ${row.installment_no} للطالب ${row.student_name} بمبلغ ${row.remaining_amount.toLocaleString()} يستحق الدفع بعد 3 أيام.`;
      } else if (row.days_diff === 0) {
        title = "موعد استحقاق قسط دراسي";
        body = `اليوم هو موعد سداد القسط رقم ${row.installment_no} للطالب ${row.student_name}. يرجى السداد لتجنب تراكم الرسوم.`;
        priority = "high";
      } else if (row.days_diff === -3) {
        title = "تنبيه: تأخر في سداد رسوم دراسية";
        body = `لقد تجاوزتم موعد سداد القسط رقم ${row.installment_no} للطالب ${row.student_name} بـ 3 أيام. نرجو المبادرة بالسداد.`;
        priority = "high";
      } else if (row.days_diff === -7) {
        title = "تحذير هام: تأخر السداد لأكثر من أسبوع";
        body = `نلفت انتباهكم لتأخر سداد القسط رقم ${row.installment_no} للطالب ${row.student_name} لمدة أسبوع. يرجى مراجعة إدارة المدرسة بأقرب وقت.`;
        priority = "critical";
      }

      // 1. إدخال الإشعار في قاعدة البيانات مع ربطه بالمدرسة (school_id)
      const nRes = await pool.query(
        `INSERT INTO notifications 
          (school_id, sender_user_id, sender_display_name, title, body, source, category, priority, related_type, related_id) 
         VALUES ($1, NULL, 'النظام المالي', $2, $3, 'system', 'finance', $4, 'fee_installment', $5) 
         RETURNING id, created_at`,
        [row.school_id, title, body, priority, row.installment_id] // 👈 تمرير school_id كأول متغير
      );

      const notifId = nRes.rows[0].id;

      // 2. ربط الإشعار بولي الأمر
      await pool.query(
        `INSERT INTO notification_recipients (notification_id, recipient_user_id, is_read) 
         VALUES ($1, $2, false)`,
        [notifId, row.parent_user_id]
      );

      // 3. إرسال الإشعار اللحظي (إذا كان ولي الأمر متصلاً الآن)
      if (io) {
        io.to(`user_${row.parent_user_id}`).emit("notification:new", {
          id: notifId,
          school_id: row.school_id, // 👈 إضافة المدرسة في الـ Socket.IO للشفافية
          title,
          body,
          category: "finance",
          priority,
          source: "system",
          created_at: nRes.rows[0].created_at
        });
      }
    }

    console.log(`[CRON] Processed ${rows.length} fees notifications across multiple schools.`);
  } catch (error) {
    console.error("[CRON] Error in fees cron job:", error);
  }
}

// تشغيل المهمة يومياً الساعة 8:00 صباحاً
export function startFeesCronJob(io) {
  // التعبير '0 8 * * *' يعني: الدقيقة 0، الساعة 8 صباحاً، كل يوم
  cron.schedule("0 8 * * *", () => {
    checkAndSendFeesNotifications(io);
  });
  console.log("Fees Cron Job Scheduled: Runs daily at 08:00 AM");
}