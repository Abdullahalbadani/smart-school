import cron from "node-cron";
import { pool } from "../config/db.js";

let isRunning = false;

export async function expireEndedSubscriptions({ source = "manual" } = {}) {
  if (isRunning) {
    return {
      success: true,
      skipped: true,
      message: "فحص الاشتراكات يعمل حاليًا",
    };
  }

  isRunning = true;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const expiredTrialsResult = await client.query(`
      UPDATE schools
      SET
        is_active = false,
        subscription_status = 'expired',
        updated_at = NOW()
      WHERE is_active = true
        AND subscription_status = 'trial'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at <= NOW()
      RETURNING
        id,
        name_ar,
        name_en,
        slug,
        subscription_status,
        subscription_plan,
        trial_ends_at,
        subscription_ends_at
    `);

    const expiredSubscriptionsResult = await client.query(`
      UPDATE schools
      SET
        is_active = false,
        subscription_status = 'expired',
        updated_at = NOW()
      WHERE is_active = true
        AND subscription_status = 'active'
        AND COALESCE(subscription_plan, '') <> 'lifetime'
        AND subscription_ends_at IS NOT NULL
        AND subscription_ends_at <= NOW()
      RETURNING
        id,
        name_ar,
        name_en,
        slug,
        subscription_status,
        subscription_plan,
        trial_ends_at,
        subscription_ends_at
    `);

    const expiredSchools = [
      ...expiredTrialsResult.rows.map((school) => ({
        ...school,
        expired_type: "trial",
      })),
      ...expiredSubscriptionsResult.rows.map((school) => ({
        ...school,
        expired_type: "subscription",
      })),
    ];

    for (const school of expiredSchools) {
      await client.query(
        `
        INSERT INTO platform_activity_logs
        (
          platform_admin_id,
          action,
          entity_type,
          entity_id,
          description,
          metadata,
          created_at
        )
        VALUES
        (
          NULL,
          $1,
          'school',
          $2,
          $3,
          $4,
          NOW()
        )
        `,
        [
          school.expired_type === "trial"
            ? "auto_expire_trial"
            : "auto_expire_subscription",
          school.id,
          school.expired_type === "trial"
            ? `تم إيقاف المدرسة تلقائيًا بسبب انتهاء التجربة: ${school.name_ar || school.name_en || school.slug}`
            : `تم إيقاف المدرسة تلقائيًا بسبب انتهاء الاشتراك: ${school.name_ar || school.name_en || school.slug}`,
          JSON.stringify({
            source,
            school_id: school.id,
            slug: school.slug,
            expired_type: school.expired_type,
            subscription_plan: school.subscription_plan,
            trial_ends_at: school.trial_ends_at,
            subscription_ends_at: school.subscription_ends_at,
          }),
        ]
      );
    }

    await client.query("COMMIT");

    return {
      success: true,
      expired_trials: expiredTrialsResult.rowCount,
      expired_subscriptions: expiredSubscriptionsResult.rowCount,
      total_expired: expiredSchools.length,
      schools: expiredSchools,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("expireEndedSubscriptions error:", error);
    throw error;
  } finally {
    client.release();
    isRunning = false;
  }
}

export function startSubscriptionsCronJob() {
  const cronExpression = process.env.SUBSCRIPTIONS_CRON || "10 0 * * *";
  const timezone = process.env.TZ || "Asia/Aden";

  cron.schedule(
    cronExpression,
    async () => {
      try {
        console.log("[Subscriptions Cron] Checking ended subscriptions...");

        const result = await expireEndedSubscriptions({
          source: "cron",
        });

        console.log(
          `[Subscriptions Cron] Done. Expired: ${result.total_expired}`
        );
      } catch (error) {
        console.error("[Subscriptions Cron] Failed:", error.message);
      }
    },
    {
      timezone,
    }
  );

  console.log(
    `Subscriptions Cron Job Scheduled: ${cronExpression} (${timezone})`
  );
}