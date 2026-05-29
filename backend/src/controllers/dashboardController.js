// src/controllers/dashboardController.js
import { pool } from "../config/db.js";

export const getDashboardStats = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    console.log(
      "🏫 Dashboard accessed by User ID:",
      req.user?.id,
      "| Valid School ID:",
      schoolId
    );

    if (!schoolId || isNaN(schoolId)) {
      return res.status(403).json({
        message: "غير مصرح أو school_id غير صالح",
      });
    }

    const activeYearRes = await pool.query(
      `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND is_active = true
      LIMIT 1
      `,
      [schoolId]
    );

    const activeYearId = activeYearRes.rows[0]?.id;
    const { yearId = activeYearId } = req.query;

    let studentsSql;
    let studentParams;

    if (yearId) {
      studentsSql = `
        SELECT COUNT(DISTINCT se.student_id)::int AS count
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id
        WHERE s.school_id = $1
          AND se.academic_year_id = $2
          AND se.status = 'enrolled'
      `;
      studentParams = [schoolId, yearId];
    } else {
      studentsSql = `
        SELECT COUNT(*)::int AS count
        FROM students
        WHERE school_id = $1
          AND status = 'active'
      `;
      studentParams = [schoolId];
    }

    const teachersSql = `
      SELECT COUNT(*)::int AS count
      FROM teachers
      WHERE school_id = $1
        AND COALESCE(is_active, true) = true
    `;

    const sectionsSql = `
      SELECT COUNT(*)::int AS count
      FROM sections
      WHERE school_id = $1
        AND COALESCE(is_active, true) = true
    `;

    const [studentsR, teachersR, sectionsR] = await Promise.all([
      pool.query(studentsSql, studentParams),
      pool.query(teachersSql, [schoolId]),
      pool.query(sectionsSql, [schoolId]),
    ]);

    return res.json({
      students: studentsR.rows[0]?.count ?? 0,
      teachers: teachersR.rows[0]?.count ?? 0,
      classes: sectionsR.rows[0]?.count ?? 0,
      activeYearId: yearId,
    });
  } catch (err) {
    console.error("getDashboardStats error:", err);
    return res.status(500).json({
      message: "خطأ في الخادم",
    });
  }
};

export const getAdminHomeDashboard = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId || isNaN(schoolId)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح أو school_id غير صالح",
      });
    }

    const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`);
    const today = todayResult.rows[0]?.today;

    const tableExists = async (tableName) => {
      try {
        const result = await pool.query(
          `SELECT to_regclass($1) IS NOT NULL AS exists`,
          [tableName]
        );

        return result.rows[0]?.exists === true;
      } catch {
        return false;
      }
    };

    const columnExists = async (tableName, columnName) => {
      try {
        const result = await pool.query(
          `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
          ) AS exists
          `,
          [tableName, columnName]
        );

        return result.rows[0]?.exists === true;
      } catch (error) {
        console.warn("dashboard columnExists warning:", error.message);
        return false;
      }
    };

    const safeCount = async (sql, params = []) => {
      try {
        const result = await pool.query(sql, params);
        return Number(result.rows[0]?.count || 0);
      } catch (error) {
        console.warn("dashboard safeCount warning:", error.message);
        return 0;
      }
    };

    const safeOne = async (sql, params = []) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows[0] || null;
      } catch (error) {
        console.warn("dashboard safeOne warning:", error.message);
        return null;
      }
    };

    const safeMany = async (sql, params = []) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows || [];
      } catch (error) {
        console.warn("dashboard safeMany warning:", error.message);
        return [];
      }
    };

    const school = await safeOne(
      `
      SELECT
        id,
        name_ar,
        name_en,
        slug,
        code,
        logo_url,
        subscription_status,
        subscription_plan,
        trial_ends_at,
        subscription_ends_at
      FROM schools
      WHERE id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    const activeYear = await safeOne(
      `
      SELECT
        id,
        name,
        start_date,
        end_date
      FROM academic_years
      WHERE school_id = $1
        AND is_active = true
      LIMIT 1
      `,
      [schoolId]
    );

    const activeYearId = activeYear?.id || null;

    let studentsCount = 0;

    if (activeYearId) {
      studentsCount = await safeCount(
        `
        SELECT COUNT(DISTINCT se.student_id)::int AS count
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id
        WHERE s.school_id = $1
          AND se.academic_year_id = $2
          AND se.status = 'enrolled'
        `,
        [schoolId, activeYearId]
      );
    } else {
      studentsCount = await safeCount(
        `
        SELECT COUNT(*)::int AS count
        FROM students
        WHERE school_id = $1
          AND COALESCE(status, 'active') = 'active'
        `,
        [schoolId]
      );
    }

    const teachersCount = await safeCount(
      `
      SELECT COUNT(*)::int AS count
      FROM teachers
      WHERE school_id = $1
        AND COALESCE(is_active, true) = true
      `,
      [schoolId]
    );

    const sectionsCount = await safeCount(
      `
      SELECT COUNT(*)::int AS count
      FROM sections
      WHERE school_id = $1
        AND COALESCE(is_active, true) = true
      `,
      [schoolId]
    );

    let gradesCount = 0;

    if (await tableExists("grades")) {
      gradesCount = await safeCount(
        `
        SELECT COUNT(*)::int AS count
        FROM grades
        WHERE school_id = $1
        `,
        [schoolId]
      );
    }

    const usersCount = await safeCount(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE school_id = $1
      `,
      [schoolId]
    );

    let guardiansCount = 0;

    if (
      (await tableExists("guardians")) &&
      (await columnExists("guardians", "school_id"))
    ) {
      guardiansCount = await safeCount(
        `
        SELECT COUNT(*)::int AS count
        FROM guardians
        WHERE school_id = $1
        `,
        [schoolId]
      );
    }

    // ===============================
    // Attendance Today
    // ===============================
    const attendanceStats = await safeOne(
      `
      WITH normalized AS (
        SELECT
          ae.student_id,

          BOOL_OR(
            LOWER(TRIM(COALESCE(ae.status, ''))) IN (
              'present',
              'p',
              'حاضر'
            )
          ) AS is_present,

          BOOL_OR(
            LOWER(TRIM(COALESCE(ae.status, ''))) IN (
              'absent',
              'a',
              'غياب',
              'غائب'
            )
          ) AS is_absent,

          BOOL_OR(
            LOWER(TRIM(COALESCE(ae.status, ''))) IN (
              'late',
              'l',
              'tardy',
              'متأخر'
            )
            OR COALESCE(ae.late_minutes, 0) > 0
          ) AS is_late

        FROM attendance_entries ae
        JOIN attendance_sessions ats
          ON ats.id = ae.session_id
        WHERE ats.school_id = $1
          AND ats.attendance_date = $2::date
        GROUP BY ae.student_id
      )
      SELECT
        COUNT(*) FILTER (WHERE is_present AND NOT is_late)::int AS present_students,
        COUNT(*) FILTER (WHERE is_absent)::int AS absent_students,
        COUNT(*) FILTER (WHERE is_late)::int AS late_students,
        COUNT(*)::int AS marked_students
      FROM normalized
      `,
      [schoolId, today]
    );

    const presentStudents = Number(attendanceStats?.present_students || 0);
    const absentStudents = Number(attendanceStats?.absent_students || 0);
    const lateStudents = Number(attendanceStats?.late_students || 0);
    const markedStudents = Number(attendanceStats?.marked_students || 0);

    const attendanceRate =
      markedStudents > 0
        ? Math.round(((presentStudents + lateStudents) / markedStudents) * 100)
        : 0;

    const attendanceToday = {
      date: today,
      present_students: presentStudents,
      absent_students: absentStudents,
      late_students: lateStudents,
      marked_students: markedStudents,
      attendance_rate: attendanceRate,
      configured: true,
      message:
        markedStudents > 0
          ? "تم تحميل بيانات الحضور من قاعدة البيانات"
          : "لا توجد سجلات حضور لهذا اليوم",
    };
    // ===============================
    // Sections Missing Attendance Today
    // ===============================
   const unrecordedSectionsToday = await safeOne(
  `
  WITH all_sections AS (
    SELECT
      s.id AS section_id,
      COALESCE(g.grade_name, g.name, 'صف غير محدد')::text AS grade_name,
      COALESCE(s.name, 'الشعبة ' || s.id)::text AS section_name,
      (
        COALESCE(g.grade_name, g.name, 'صف غير محدد')
        || ' - الشعبة '
        || COALESCE(s.name, s.id::text)
      )::text AS label
    FROM sections s
    LEFT JOIN grades g
      ON g.id = s.grade_id
     AND g.school_id = s.school_id
    WHERE s.school_id = $1
      AND COALESCE(s.is_active, true) = true
      AND COALESCE(g.is_active, true) = true
  ),

  recorded_sections AS (
    SELECT DISTINCT section_id
    FROM attendance_sessions
    WHERE school_id = $1
      AND attendance_date = $2::date
      AND section_id IS NOT NULL
  ),

  missing_sections AS (
    SELECT
      a.section_id,
      a.grade_name,
      a.section_name,
      a.label
    FROM all_sections a
    LEFT JOIN recorded_sections r
      ON r.section_id = a.section_id
    WHERE r.section_id IS NULL
  ),

  stats AS (
    SELECT
      (SELECT COUNT(*) FROM all_sections)::int AS total_sections,
      (SELECT COUNT(*) FROM recorded_sections)::int AS recorded_sections,
      (SELECT COUNT(*) FROM missing_sections)::int AS missing_sections
  )

  SELECT
    stats.total_sections,
    LEAST(stats.recorded_sections, stats.total_sections)::int AS recorded_sections,
    stats.missing_sections,

    CASE
      WHEN stats.total_sections = 0 THEN 0
      ELSE ROUND(
        (LEAST(stats.recorded_sections, stats.total_sections)::numeric / stats.total_sections) * 100
      )::int
    END AS completion_rate,

    COALESCE(
      (
        SELECT json_agg(row_to_json(x))
        FROM (
          SELECT
            section_id,
            grade_name,
            section_name,
            label
          FROM missing_sections
          ORDER BY grade_name, section_name
          LIMIT 5
        ) x
      ),
      '[]'::json
    ) AS missing_examples

  FROM stats
  `,
  [schoolId, today]
);

    const sectionsAttendanceStatus = {
      configured: true,
      total_sections: Number(unrecordedSectionsToday?.total_sections || 0),
      recorded_sections: Number(unrecordedSectionsToday?.recorded_sections || 0),
      missing_sections: Number(unrecordedSectionsToday?.missing_sections || 0),
      completion_rate: Number(unrecordedSectionsToday?.completion_rate || 0),
      missing_examples: unrecordedSectionsToday?.missing_examples || [],
    };
    // ===============================
    // School Pulse
    // ===============================
    const schoolPulse = await safeMany(
      `
      WITH section_attendance AS (
        SELECT
          ats.section_id,

          COUNT(DISTINCT ae.student_id) AS marked_students,

          COUNT(DISTINCT ae.student_id) FILTER (
            WHERE LOWER(TRIM(COALESCE(ae.status, ''))) IN ('present', 'p', 'حاضر')
          ) AS present_students,

          COUNT(DISTINCT ae.student_id) FILTER (
            WHERE LOWER(TRIM(COALESCE(ae.status, ''))) IN ('absent', 'a', 'غياب', 'غائب')
          ) AS absent_students,

          COUNT(DISTINCT ae.student_id) FILTER (
            WHERE LOWER(TRIM(COALESCE(ae.status, ''))) IN ('late', 'l', 'tardy', 'متأخر')
               OR COALESCE(ae.late_minutes, 0) > 0
          ) AS late_students

        FROM attendance_sessions ats
        JOIN attendance_entries ae
          ON ae.session_id = ats.id
        WHERE ats.school_id = $1
          AND ats.attendance_date = $2::date
        GROUP BY ats.section_id
      )
      SELECT
       s.id AS section_id,
COALESCE(g.grade_name, g.name, 'صف غير محدد')::text AS grade_name,
COALESCE(s.name, 'الشعبة ' || s.id)::text AS section_name,
(
  COALESCE(g.grade_name, g.name, 'صف غير محدد')
  || ' - الشعبة '
  || COALESCE(s.name, s.id::text)
)::text AS label,
        COALESCE(sa.marked_students, 0)::int AS marked_students,
        COALESCE(sa.present_students, 0)::int AS present_students,
        COALESCE(sa.absent_students, 0)::int AS absent_students,
        COALESCE(sa.late_students, 0)::int AS late_students,

        CASE
          WHEN COALESCE(sa.marked_students, 0) = 0 THEN 'no_data'
          WHEN COALESCE(sa.absent_students, 0)::numeric / NULLIF(sa.marked_students, 0) >= 0.15 THEN 'danger'
          WHEN COALESCE(sa.late_students, 0)::numeric / NULLIF(sa.marked_students, 0) >= 0.10 THEN 'warn'
          ELSE 'ok'
        END AS status

     FROM sections s
LEFT JOIN grades g
  ON g.id = s.grade_id
 AND g.school_id = s.school_id
LEFT JOIN section_attendance sa
  ON sa.section_id = s.id
WHERE s.school_id = $1
        AND COALESCE(s.is_active, true) = true
      ORDER BY s.id
      `,
      [schoolId, today]
    );

    // ===============================
    // Finance
    // ===============================
    const financeStats = await safeOne(
      `
      SELECT
        COALESCE(SUM(fi.amount), 0)::bigint AS total_required,

        COALESCE(SUM(COALESCE(fi.paid_amount, 0)), 0)::bigint AS total_paid,

        COALESCE(
          SUM(
            GREATEST(
              COALESCE(fi.amount, 0) - COALESCE(fi.paid_amount, 0),
              0
            )
          ),
          0
        )::bigint AS total_remaining,

        COUNT(
          DISTINCT CASE
            WHEN fi.due_date < CURRENT_DATE
             AND GREATEST(COALESCE(fi.amount, 0) - COALESCE(fi.paid_amount, 0), 0) > 0
            THEN fc.student_id
          END
        )::int AS overdue_students

      FROM fee_installments fi
      JOIN fee_contracts fc
        ON fc.id = COALESCE(fi.contract_id, fi.fee_contract_id)
      WHERE fi.school_id = $1
        AND fc.school_id = $1
        AND ($2::int IS NULL OR fc.academic_year_id = $2)
        AND LOWER(COALESCE(fc.status, 'active')) NOT IN (
          'cancelled',
          'canceled',
          'deleted',
          'inactive'
        )
      `,
      [schoolId, activeYearId]
    );

    const totalRequired = Number(financeStats?.total_required || 0);
    const totalPaid = Number(financeStats?.total_paid || 0);
    const totalRemaining = Number(financeStats?.total_remaining || 0);
    const overdueStudents = Number(financeStats?.overdue_students || 0);

    const paymentRate =
      totalRequired > 0 ? Math.round((totalPaid / totalRequired) * 100) : 0;

    const finance = {
      total_required: totalRequired,
      total_paid: totalPaid,
      total_remaining: totalRemaining,
      overdue_students: overdueStudents,
      payment_rate: paymentRate,
      configured: true,
      message: "تم تحميل بيانات الرسوم من قاعدة البيانات",
    };

    // ===============================
    // Pending Tasks
    // ===============================
    const studentPermissionRequests = await safeCount(
      `
      SELECT COUNT(*)::int AS count
      FROM permission_requests
      WHERE school_id = $1
        AND LOWER(COALESCE(status, 'pending')) IN (
          'pending',
          'waiting',
          'new',
          'under_review',
          'submitted'
        )
      `,
      [schoolId]
    );

    const teacherPermissionRequests = await safeCount(
      `
      SELECT COUNT(*)::int AS count
      FROM teacher_permission_requests
      WHERE school_id = $1
        AND LOWER(COALESCE(status, 'pending')) IN (
          'pending',
          'waiting',
          'new',
          'under_review',
          'submitted'
        )
      `,
      [schoolId]
    );

    let assessmentReopenRequests = 0;
const feeAdjustmentRequests = await safeCount(
  `
  SELECT COUNT(*)::int AS count
  FROM fee_adjustment_requests
  WHERE school_id = $1
    AND LOWER(COALESCE(status, 'pending')) = 'pending'
  `,
  [schoolId]
);
const studentTransferRequests = await safeCount(
  `
  SELECT COUNT(*)::int AS count
  FROM student_transfer_requests
  WHERE school_id = $1
    AND LOWER(COALESCE(status, 'pending')) = 'pending'
  `,
  [schoolId]
);
    if (
      (await tableExists("assessment_reopen_requests")) &&
      (await columnExists("assessment_reopen_requests", "school_id"))
    ) {
      assessmentReopenRequests = await safeCount(
        `
        SELECT COUNT(*)::int AS count
        FROM assessment_reopen_requests
        WHERE school_id = $1
          AND LOWER(COALESCE(status, 'pending')) IN (
            'pending',
            'waiting',
            'new',
            'under_review',
            'submitted'
          )
        `,
        [schoolId]
      );
    }

   const pendingTasks = {
  total:
   studentPermissionRequests +
    teacherPermissionRequests +
    assessmentReopenRequests +
    feeAdjustmentRequests +
    studentTransferRequests,

       permissions: studentPermissionRequests,
  teacher_permissions: teacherPermissionRequests,
  assessment_reopen_requests: assessmentReopenRequests,
  fee_adjustments: feeAdjustmentRequests,
  student_transfers: studentTransferRequests,

  parent_requests: studentPermissionRequests,
  teacher_requests: teacherPermissionRequests,
      items: [],
    };

    if (studentPermissionRequests > 0) {
      pendingTasks.items.push({
        type: "permission_requests",
        title: "طلبات أذونات الطلاب بانتظار الاعتماد",
        count: studentPermissionRequests,
      });
    }

    if (teacherPermissionRequests > 0) {
      pendingTasks.items.push({
        type: "teacher_permission_requests",
        title: "طلبات أذونات المعلمين بانتظار الاعتماد",
        count: teacherPermissionRequests,
      });
    }

    if (assessmentReopenRequests > 0) {
      pendingTasks.items.push({
        type: "assessment_reopen_requests",
        title: "طلبات إعادة فتح التقييم بانتظار الاعتماد",
        count: assessmentReopenRequests,
      });
    }
if (feeAdjustmentRequests > 0) {
  pendingTasks.items.push({
    type: "fee_adjustment_requests",
    title: "طلبات تعديل الرسوم بانتظار الاعتماد",
    count: feeAdjustmentRequests,
  });
}
if (studentTransferRequests > 0) {
  pendingTasks.items.push({
    type: "student_transfer_requests",
    title: "طلبات نقل الطلاب بانتظار الاعتماد",
    count: studentTransferRequests,
  });
}
    // ===============================
    // Recent Activities
    // ===============================
    const recentActivities = await safeMany(
      `
      SELECT
        id,
        action,
        entity_type,
        resource_type,
        description,
        created_at
      FROM activity_logs
      WHERE school_id = $1
        AND created_at::date = $2::date
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [schoolId, today]
    );

    return res.json({
      success: true,
      school,
      active_year: activeYear,
      summary: {
        students_count: studentsCount,
        teachers_count: teachersCount,
        grades_count: gradesCount,
        sections_count: sectionsCount,
        guardians_count: guardiansCount,
        users_count: usersCount,
      },
            sections_attendance_status: sectionsAttendanceStatus,
      attendance_today: attendanceToday,
      finance,
      pending_tasks: pendingTasks,
      recent_activities: recentActivities,
      school_pulse: schoolPulse,
    });
  } catch (err) {
    console.error("getAdminHomeDashboard error:", err);

    return res.status(500).json({
      success: false,
      message: "خطأ في جلب بيانات لوحة المدير",
    });
  }
};