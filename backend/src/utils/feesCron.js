// src/utils/feesCron.js
import cron from "node-cron";
import { pool } from "../config/db.js";
import { createSystemNotification } from "../modules/notifications/notificationCreateService.js";

function formatAmount(value) {
  return Number(value || 0).toLocaleString("ar-EG");
}

function buildInstallmentReminder(row) {
  const daysDiff = Number(row.days_diff);
  const installmentNo = row.installment_no;
  const studentName = row.student_name || `طالب #${row.student_id}`;
  const remaining = formatAmount(row.remaining_amount);

  if (daysDiff === 3) {
    return {
      priority: "normal",
      title: "تذكير باقتراب موعد قسط دراسي",
      body: `نود تذكيركم بأن القسط رقم ${installmentNo} للطالب ${studentName} بمبلغ ${remaining} يستحق الدفع بعد 3 أيام.`,
    };
  }

  if (daysDiff === 0) {
    return {
      priority: "important",
      title: "موعد استحقاق قسط دراسي",
      body: `اليوم هو موعد سداد القسط رقم ${installmentNo} للطالب ${studentName}. يرجى السداد لتجنب تراكم الرسوم.`,
    };
  }

  if (daysDiff === -3) {
    return {
      priority: "important",
      title: "تنبيه: تأخر في سداد رسوم دراسية",
      body: `تجاوز موعد سداد القسط رقم ${installmentNo} للطالب ${studentName} بثلاثة أيام. نرجو المبادرة بالسداد.`,
    };
  }

  if (daysDiff === -7) {
    return {
      priority: "urgent",
      title: "تحذير مهم: تأخر السداد لأكثر من أسبوع",
      body: `تأخر سداد القسط رقم ${installmentNo} للطالب ${studentName} لمدة أسبوع. يرجى مراجعة إدارة المدرسة في أقرب وقت.`,
    };
  }

  return null;
}

/**
 * Sends guardian fee reminders for all schools while preserving tenant isolation.
 * Exported for a controlled smoke test without waiting for the cron schedule.
 */
export async function checkAndSendFeesNotifications(app) {
  try {
    console.log("[CRON] Starting daily fees notification check...");

    const { rows } = await pool.query(
      `SELECT
         fi.id AS installment_id,
         fi.installment_no,
         fi.due_date,
         fi.amount,
         fi.paid_amount,
         (fi.amount - COALESCE(fi.paid_amount, 0)) AS remaining_amount,
         (fi.due_date - CURRENT_DATE) AS days_diff,
         s.id AS student_id,
         s.full_name AS student_name,
         g.user_id AS parent_user_id,
         fc.school_id
       FROM fee_installments fi
       JOIN fee_contracts fc
         ON fc.id = fi.contract_id
        AND fc.school_id = fi.school_id
       JOIN academic_years ay
         ON ay.id = fc.academic_year_id
        AND ay.school_id = fc.school_id
        AND ay.is_active = true
       JOIN students s
         ON s.id = fc.student_id
        AND s.school_id = fc.school_id
       JOIN student_guardians sg
         ON sg.student_id = s.id
        AND sg.school_id = s.school_id
        AND sg.is_primary = true
       JOIN guardians g
         ON g.id = sg.guardian_id
        AND g.school_id = sg.school_id
       WHERE fi.status IN ('unpaid', 'partial')
         AND g.user_id IS NOT NULL
         AND (fi.due_date - CURRENT_DATE) IN (3, 0, -3, -7)`,
      []
    );

    let sentCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const template = buildInstallmentReminder(row);
      if (!template) continue;

      const result = await createSystemNotification({
        app,
        schoolId: row.school_id,
        category: "finance",
        priority: template.priority,
        title: template.title,
        body: template.body,
        relatedType: "fee_installment",
        relatedId: row.installment_id,
        meta: {
          related_label: `قسط رقم ${row.installment_no}`,
          installment_id: Number(row.installment_id),
          installment_no: Number(row.installment_no),
          student_id: Number(row.student_id),
          student_name: row.student_name,
          remaining_amount: Number(row.remaining_amount || 0),
          due_date: row.due_date,
          days_diff: Number(row.days_diff),
        },
        recipientUserIds: [row.parent_user_id],
        // Prevent duplicate reminders if the process restarts and the job is re-run the same day.
        dedupeWindowSeconds: 23 * 60 * 60,
      });

      if (result.skipped) skippedCount += 1;
      else sentCount += 1;
    }

    console.log(
      `[CRON] Fees notifications completed. Sent=${sentCount}, skipped=${skippedCount}, candidates=${rows.length}`
    );
  } catch (error) {
    console.error("[CRON] Error in fees notifications job:", error);
  }
}

export function startFeesCronJob(app) {
  cron.schedule("0 8 * * *", () => {
    checkAndSendFeesNotifications(app);
  });
  console.log("Fees Cron Job Scheduled: Runs daily at 08:00 AM");
}
