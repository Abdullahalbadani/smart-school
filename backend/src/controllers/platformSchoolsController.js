import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
function normalizeInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function logPlatformAction(req, action, entityType, entityId, description, metadata = {}) {
  try {
    await pool.query(
      `
      INSERT INTO platform_activity_logs
      (platform_admin_id, action, entity_type, entity_id, description, metadata, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        req.platformAdmin?.id || null,
        action,
        entityType,
        entityId,
        description,
        JSON.stringify(metadata),
        req.ip,
        req.headers["user-agent"] || null,
      ]
    );
  } catch (error) {
    console.error("platform log error:", error.message);
  }
}

export async function getPlatformDashboard(req, res) {
  try {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_schools,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_schools,
        COUNT(*) FILTER (WHERE is_active = false)::int AS inactive_schools,
        COUNT(*) FILTER (WHERE subscription_status = 'trial')::int AS trial_schools,
        COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS subscribed_schools,
        COUNT(*) FILTER (WHERE subscription_status = 'suspended')::int AS suspended_schools,
        COUNT(*) FILTER (WHERE subscription_status = 'expired')::int AS expired_schools,
        COUNT(*) FILTER (WHERE subscription_status = 'cancelled')::int AS cancelled_schools
      FROM schools
    `);

    const totalsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM students) AS total_students,
        (SELECT COUNT(*)::int FROM teachers) AS total_teachers,
        (SELECT COUNT(*)::int FROM users) AS total_users
    `);

    const latestSchoolsResult = await pool.query(`
      SELECT
        id, name_ar, name_en, slug, code, phone, email,
        subscription_status, subscription_plan, is_active,
        trial_ends_at, subscription_ends_at, created_at
      FROM schools
      ORDER BY created_at DESC
      LIMIT 10
    `);

    return res.json({
      success: true,
      stats: {
        ...statsResult.rows[0],
        ...totalsResult.rows[0],
      },
      latest_schools: latestSchoolsResult.rows,
    });
  } catch (error) {
    console.error("getPlatformDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب إحصائيات النظام",
    });
  }
}

export async function listSchools(req, res) {
  try {
    const {
      q = "",
      status = "",
      page = 1,
      limit = 20,
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const perPage = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const offset = (currentPage - 1) * perPage;

    const conditions = [];
    const params = [];

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`
        (
          name_ar ILIKE $${params.length}
          OR name_en ILIKE $${params.length}
          OR slug ILIKE $${params.length}
          OR code ILIKE $${params.length}
          OR email ILIKE $${params.length}
          OR phone ILIKE $${params.length}
        )
      `);
    }

    if (status.trim()) {
      params.push(status.trim());
      conditions.push(`subscription_status = $${params.length}`);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM schools ${whereSql}`,
      params
    );

    params.push(perPage);
    params.push(offset);

    const schoolsResult = await pool.query(
      `
      SELECT
        s.id,
        s.name_ar,
        s.name_en,
        s.slug,
        s.code,
        s.logo_url,
        s.phone,
        s.email,
        s.city,
        s.subscription_status,
        s.subscription_plan,
        s.is_active,
        s.trial_started_at,
        s.trial_ends_at,
        s.subscription_starts_at,
        s.subscription_ends_at,
        s.suspended_at,
        s.suspended_reason,
        s.cancelled_at,
        s.created_at,
        (
          SELECT COUNT(*)::int
          FROM students st
          WHERE st.school_id = s.id
        ) AS students_count,
        (
          SELECT COUNT(*)::int
          FROM teachers t
          WHERE t.school_id = s.id
        ) AS teachers_count,
        (
          SELECT COUNT(*)::int
          FROM users u
          WHERE u.school_id = s.id
        ) AS users_count
      FROM schools s
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    return res.json({
      success: true,
      page: currentPage,
      limit: perPage,
      total: countResult.rows[0].total,
      data: schoolsResult.rows,
    });
  } catch (error) {
    console.error("listSchools error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المدارس",
    });
  }
}

export async function getSchoolDetails(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    const result = await pool.query(
      `
      SELECT
        s.*,
        (
          SELECT COUNT(*)::int
          FROM students st
          WHERE st.school_id = s.id
        ) AS students_count,
        (
          SELECT COUNT(*)::int
          FROM teachers t
          WHERE t.school_id = s.id
        ) AS teachers_count,
        (
          SELECT COUNT(*)::int
          FROM users u
          WHERE u.school_id = s.id
        ) AS users_count
      FROM schools s
      WHERE s.id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    return res.json({
      success: true,
      school: result.rows[0],
    });
  } catch (error) {
    console.error("getSchoolDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب بيانات المدرسة",
    });
  }
}

export async function activateTrial(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);
    const days = Number(req.body.days || 3);

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    if (!Number.isInteger(days) || days <= 0 || days > 365) {
      return res.status(400).json({
        success: false,
        message: "مدة التجربة يجب أن تكون بين 1 و 365 يوم",
      });
    }

    const result = await pool.query(
      `
      UPDATE schools
      SET
        is_active = true,
        subscription_status = 'trial',
        subscription_plan = 'trial',
        trial_started_at = COALESCE(trial_started_at, NOW()),
        trial_ends_at = NOW() + ($2 || ' days')::interval,
        subscription_starts_at = NULL,
        subscription_ends_at = NULL,
        suspended_at = NULL,
        suspended_reason = NULL,
        cancelled_at = NULL,
        last_activated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [schoolId, days]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    await logPlatformAction(
      req,
      "activate_trial",
      "school",
      schoolId,
      `تم تفعيل تجربة لمدة ${days} يوم`,
      { days }
    );

    return res.json({
      success: true,
      message: `تم تفعيل التجربة لمدة ${days} يوم`,
      school: result.rows[0],
    });
  } catch (error) {
    console.error("activateTrial error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تفعيل التجربة",
    });
  }
}

export async function activateSubscription(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);
    const { plan = "monthly", days } = req.body;

    const allowedPlans = ["monthly", "yearly", "lifetime", "custom"];

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    if (!allowedPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: "نوع الاشتراك غير صحيح",
      });
    }

    let durationDays = null;

    if (plan === "monthly") durationDays = 30;
    if (plan === "yearly") durationDays = 365;
    if (plan === "custom") durationDays = Number(days);

    if (plan === "custom" && (!Number.isInteger(durationDays) || durationDays <= 0)) {
      return res.status(400).json({
        success: false,
        message: "مدة الاشتراك المخصص مطلوبة",
      });
    }

    const endsAtSql =
      plan === "lifetime"
        ? "NULL"
        : "NOW() + ($3 || ' days')::interval";

    const params =
      plan === "lifetime"
        ? [schoolId, plan]
        : [schoolId, plan, durationDays];

    const result = await pool.query(
      `
      UPDATE schools
      SET
        is_active = true,
        subscription_status = 'active',
        subscription_plan = $2,
        subscription_starts_at = NOW(),
        subscription_ends_at = ${endsAtSql},
        suspended_at = NULL,
        suspended_reason = NULL,
        cancelled_at = NULL,
        last_activated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      params
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    await logPlatformAction(
      req,
      "activate_subscription",
      "school",
      schoolId,
      `تم تفعيل اشتراك ${plan}`,
      { plan, durationDays }
    );

    return res.json({
      success: true,
      message: "تم تفعيل الاشتراك بنجاح",
      school: result.rows[0],
    });
  } catch (error) {
    console.error("activateSubscription error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تفعيل الاشتراك",
    });
  }
}

export async function suspendSchool(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);
    const { reason = "" } = req.body;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    const result = await pool.query(
      `
      UPDATE schools
      SET
        is_active = false,
        subscription_status = 'suspended',
        suspended_at = NOW(),
        suspended_reason = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [schoolId, reason]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    await logPlatformAction(
      req,
      "suspend_school",
      "school",
      schoolId,
      "تم إيقاف المدرسة",
      { reason }
    );

    return res.json({
      success: true,
      message: "تم إيقاف المدرسة",
      school: result.rows[0],
    });
  } catch (error) {
    console.error("suspendSchool error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إيقاف المدرسة",
    });
  }
}

export async function reactivateSchool(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    const result = await pool.query(
      `
      UPDATE schools
      SET
        is_active = true,
        subscription_status = CASE
          WHEN subscription_plan = 'trial' THEN 'trial'
          ELSE 'active'
        END,
        suspended_at = NULL,
        suspended_reason = NULL,
        cancelled_at = NULL,
        last_activated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [schoolId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    await logPlatformAction(
      req,
      "reactivate_school",
      "school",
      schoolId,
      "تم إعادة فتح المدرسة"
    );

    return res.json({
      success: true,
      message: "تم فتح المدرسة بنجاح",
      school: result.rows[0],
    });
  } catch (error) {
    console.error("reactivateSchool error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء فتح المدرسة",
    });
  }
}
export async function impersonateSchoolAdmin(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "JWT_SECRET غير مضبوط في ملف البيئة",
      });
    }

    const schoolResult = await pool.query(
      `
      SELECT
        id,
        name_ar,
        name_en,
        slug,
        logo_url,
        is_active,
        subscription_status
      FROM schools
      WHERE id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    const school = schoolResult.rows[0];

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    if (
      !school.is_active ||
      ["suspended", "expired", "cancelled"].includes(
        String(school.subscription_status || "").toLowerCase()
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "لا يمكن الدخول كمدير لأن المدرسة غير مفعلة أو اشتراكها موقوف",
      });
    }

    const adminResult = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.username,
        u.phone,
        u.status,
        COALESCE(u.token_version, 0) AS token_version,
        u.school_id,

        s.slug AS school_slug,
        s.name_ar AS school_name_ar,
        s.name_en AS school_name_en,
        s.logo_url,

        r.id AS role_id,
        r.name AS role_name
      FROM users u
      JOIN schools s
        ON s.id = u.school_id
      JOIN user_roles ur
        ON ur.user_id = u.id
       AND ur.school_id = u.school_id
      JOIN roles r
        ON r.id = ur.role_id
       AND r.school_id = u.school_id
      WHERE u.school_id = $1
        AND COALESCE(u.status, 'active') = 'active'
        AND LOWER(r.name) IN ('school_admin', 'admin')
      ORDER BY
        CASE
          WHEN LOWER(r.name) = 'school_admin' THEN 1
          WHEN LOWER(r.name) = 'admin' THEN 2
          ELSE 3
        END,
        u.id ASC
      LIMIT 1
      `,
      [schoolId]
    );

    const adminUser = adminResult.rows[0];

    if (!adminUser) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على حساب مدير لهذه المدرسة",
      });
    }

    const permissionsResult = await pool.query(
      `
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp
        ON rp.permission_id = p.id
      WHERE rp.role_id = $1
      ORDER BY p.code
      `,
      [adminUser.role_id]
    );

    const permissions = permissionsResult.rows.map((row) => row.code);

    const tokenVersion = Number(adminUser.token_version || 0);

    const token = jwt.sign(
      {
        id: adminUser.id,
        tokenVersion,
        permissions,
        impersonation: true,
        impersonated_by_platform_admin_id: req.platformAdmin.id,
        impersonated_school_id: schoolId,
      },
      jwtSecret,
      {
        expiresIn: "1h",
      }
    );

    const user = {
      id: adminUser.id,
      school_id: adminUser.school_id,

      name: adminUser.name || adminUser.username,
      email: adminUser.email,
      username: adminUser.username,
      phone: adminUser.phone,

      role: "admin",
      role_name: "admin",
      role_key: "admin",
      role_id: adminUser.role_id,

      permissions,

      school_slug: adminUser.school_slug,
      school_name_ar: adminUser.school_name_ar,
      school_name_en: adminUser.school_name_en,
      logo_url: adminUser.logo_url,

      is_impersonated: true,
      impersonated_by_platform_admin_id: req.platformAdmin.id,
    };

    await logPlatformAction(
      req,
      "impersonate_school_admin",
      "school",
      schoolId,
      `تم الدخول كمدير مدرسة: ${school.name_ar || school.name_en || school.slug}`,
      {
        school_id: schoolId,
        school_slug: school.slug,
        target_user_id: adminUser.id,
        target_role_id: adminUser.role_id,
      }
    );

    return res.json({
      success: true,
      message: "تم تجهيز الدخول كمدير المدرسة",
      token,
      user,
      school: {
        id: school.id,
        slug: school.slug,
        name_ar: school.name_ar,
        name_en: school.name_en,
        logo_url: school.logo_url,
      },
      redirect_url: "/frontend/admin/index.html",
      expires_in: "1h",
    });
  } catch (error) {
    console.error("impersonateSchoolAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء الدخول كمدير المدرسة",
    });
  }
}export async function getSchoolFullDetails(req, res) {
  try {
    const schoolId = normalizeInteger(req.params.id);

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: "رقم المدرسة غير صحيح",
      });
    }

    const schoolResult = await pool.query(
      `
      SELECT
        s.*,

        (SELECT COUNT(*)::int FROM students st WHERE st.school_id = s.id) AS students_count,
        (SELECT COUNT(*)::int FROM teachers t WHERE t.school_id = s.id) AS teachers_count,
        (SELECT COUNT(*)::int FROM users u WHERE u.school_id = s.id) AS users_count,
        (SELECT COUNT(*)::int FROM guardians g WHERE g.school_id = s.id) AS guardians_count,
        (SELECT COUNT(*)::int FROM sections sec WHERE sec.school_id = s.id) AS sections_count,
        (SELECT COUNT(*)::int FROM subjects sub WHERE sub.school_id = s.id) AS subjects_count

      FROM schools s
      WHERE s.id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    const school = schoolResult.rows[0];

    if (!school) {
      return res.status(404).json({
        success: false,
        message: "المدرسة غير موجودة",
      });
    }

    const adminsResult = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.username,
        u.phone,
        u.status,
        r.name AS role_name,
        u.created_at
      FROM users u
      JOIN user_roles ur
        ON ur.user_id = u.id
       AND ur.school_id = u.school_id
      JOIN roles r
        ON r.id = ur.role_id
       AND r.school_id = u.school_id
      WHERE u.school_id = $1
        AND LOWER(r.name) IN ('school_admin', 'admin')
      ORDER BY u.id ASC
      LIMIT 5
      `,
      [schoolId]
    );

    const logsResult = await pool.query(
      `
      SELECT
        l.id,
        l.action,
        l.entity_type,
        l.entity_id,
        l.description,
        l.metadata,
        l.created_at,
        a.name AS platform_admin_name,
        a.email AS platform_admin_email
      FROM platform_activity_logs l
      LEFT JOIN platform_admins a
        ON a.id = l.platform_admin_id
      WHERE l.entity_type = 'school'
        AND l.entity_id = $1
      ORDER BY l.created_at DESC
      LIMIT 15
      `,
      [schoolId]
    );

    return res.json({
      success: true,
      school,
      admins: adminsResult.rows,
      logs: logsResult.rows,
    });
  } catch (error) {
    console.error("getSchoolFullDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب تفاصيل المدرسة",
    });
  }
}

export async function listPlatformActivityLogs(req, res) {
  try {
    const { q = "", action = "", page = 1, limit = 30 } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const perPage = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const offset = (currentPage - 1) * perPage;

    const conditions = [];
    const params = [];

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`
        (
          l.description ILIKE $${params.length}
          OR l.action ILIKE $${params.length}
          OR s.name_ar ILIKE $${params.length}
          OR s.name_en ILIKE $${params.length}
          OR s.slug ILIKE $${params.length}
          OR a.email ILIKE $${params.length}
          OR a.name ILIKE $${params.length}
        )
      `);
    }

    if (action.trim()) {
      params.push(action.trim());
      conditions.push(`l.action = $${params.length}`);
    }

    const whereSql = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM platform_activity_logs l
      LEFT JOIN schools s
        ON s.id = l.entity_id
       AND l.entity_type = 'school'
      LEFT JOIN platform_admins a
        ON a.id = l.platform_admin_id
      ${whereSql}
      `,
      params
    );

    params.push(perPage);
    params.push(offset);

    const logsResult = await pool.query(
      `
      SELECT
        l.id,
        l.action,
        l.entity_type,
        l.entity_id,
        l.description,
        l.metadata,
        l.ip_address,
        l.user_agent,
        l.created_at,

        a.name AS platform_admin_name,
        a.email AS platform_admin_email,

        s.name_ar AS school_name_ar,
        s.name_en AS school_name_en,
        s.slug AS school_slug
      FROM platform_activity_logs l
      LEFT JOIN platform_admins a
        ON a.id = l.platform_admin_id
      LEFT JOIN schools s
        ON s.id = l.entity_id
       AND l.entity_type = 'school'
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

    return res.json({
      success: true,
      page: currentPage,
      limit: perPage,
      total: countResult.rows[0].total,
      data: logsResult.rows,
    });
  } catch (error) {
    console.error("listPlatformActivityLogs error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب سجل العمليات",
    });
  }
}

export async function getSubscriptionAlerts(req, res) {
  try {
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 60);

    const result = await pool.query(
      `
      SELECT
        id,
        name_ar,
        name_en,
        slug,
        code,
        email,
        phone,
        is_active,
        subscription_status,
        subscription_plan,
        trial_ends_at,
        subscription_ends_at,
        CASE
          WHEN subscription_status = 'trial'
               AND trial_ends_at IS NOT NULL
            THEN CEIL(EXTRACT(EPOCH FROM (trial_ends_at - NOW())) / 86400)::int

          WHEN subscription_status = 'active'
               AND subscription_plan <> 'lifetime'
               AND subscription_ends_at IS NOT NULL
            THEN CEIL(EXTRACT(EPOCH FROM (subscription_ends_at - NOW())) / 86400)::int

          ELSE NULL
        END AS remaining_days,
        CASE
          WHEN subscription_status = 'trial' THEN 'trial'
          WHEN subscription_status = 'active' THEN 'subscription'
          ELSE 'unknown'
        END AS alert_type
      FROM schools
      WHERE is_active = true
        AND (
          (
            subscription_status = 'trial'
            AND trial_ends_at IS NOT NULL
            AND trial_ends_at > NOW()
            AND trial_ends_at <= NOW() + ($1 || ' days')::interval
          )
          OR
          (
            subscription_status = 'active'
            AND COALESCE(subscription_plan, '') <> 'lifetime'
            AND subscription_ends_at IS NOT NULL
            AND subscription_ends_at > NOW()
            AND subscription_ends_at <= NOW() + ($1 || ' days')::interval
          )
        )
      ORDER BY remaining_days ASC, name_ar ASC
      `,
      [days]
    );

    return res.json({
      success: true,
      days,
      total: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error("getSubscriptionAlerts error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب تنبيهات الاشتراكات",
    });
  }
}