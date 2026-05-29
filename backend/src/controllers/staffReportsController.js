// backend/src/controllers/staffReportsController.js
import { pool } from "../config/db.js";

function getSchoolId(req) {
  return req.user?.school_id || req.user?.school?.id || null;
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toText(value) {
  return String(value || "").trim();
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function staffSourceCte() {
  return `
    staff_source AS (
      SELECT
        'employee'::text AS source_type,
        e.id::bigint AS staff_id,
        ('employee:' || e.id)::text AS profile_key,
        e.id::bigint AS employee_id,
        e.teacher_id::integer AS teacher_id,
        e.user_id::integer AS user_id,
        e.full_name::text AS full_name,
        e.phone::text AS phone,
        COALESCE(NULLIF(e.job_title, ''), CASE WHEN e.is_teacher THEN 'معلم' ELSE 'موظف إداري' END)::text AS job_title,
        e.notes::text AS notes,
        e.is_teacher::boolean AS is_teacher,
        e.is_active::boolean AS is_active,
        e.created_at AS created_at,
        e.updated_at AS updated_at,
        e.school_id::bigint AS school_id
      FROM employees e
      WHERE e.school_id = $1

      UNION ALL

      SELECT
        'teacher'::text AS source_type,
        t.id::bigint AS staff_id,
        ('teacher:' || t.id)::text AS profile_key,
        NULL::bigint AS employee_id,
        t.id::integer AS teacher_id,
        t.user_id::integer AS user_id,
        t.full_name::text AS full_name,
        t.phone::text AS phone,
        'معلم'::text AS job_title,
        NULL::text AS notes,
        true::boolean AS is_teacher,
        t.is_active::boolean AS is_active,
        t.created_at AS created_at,
        t.updated_at AS updated_at,
        t.school_id::bigint AS school_id
      FROM teachers t
      WHERE t.school_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM employees e
          WHERE e.school_id = t.school_id
            AND (
              e.teacher_id = t.id
              OR (
                e.user_id IS NOT NULL
                AND t.user_id IS NOT NULL
                AND e.user_id = t.user_id
              )
            )
        )
    )
  `;
}

function buildStaffReportQuery(req) {
  const schoolId = getSchoolId(req);
  const q = req.query || {};

  if (!schoolId) throw new Error("غير مصرح: لم يتم تحديد المدرسة.");

  const params = [schoolId];

  function addParam(value) {
    params.push(value);
    return `$${params.length}`;
  }

  const academicYearId = toPositiveInt(q.academic_year_id);

  const attendanceWhere = ["tad.school_id = $1"];

  if (academicYearId) {
    attendanceWhere.push(`tad.academic_year_id = ${addParam(academicYearId)}`);
  }

  const finalWhere = ["1=1"];

  const search = toText(q.q);
  if (search) {
    const p = addParam(`%${search}%`);
    finalWhere.push(`
      (
        full_name ILIKE ${p}
        OR COALESCE(phone, '') ILIKE ${p}
        OR COALESCE(job_title, '') ILIKE ${p}
        OR COALESCE(username, '') ILIKE ${p}
        OR COALESCE(email, '') ILIKE ${p}
        OR COALESCE(roles_names, '') ILIKE ${p}
      )
    `);
  }

  const employeeType = toText(q.employee_type);
  if (employeeType === "teacher") {
    finalWhere.push("is_teacher = true");
  } else if (employeeType === "admin") {
    finalWhere.push("is_teacher = false");
  }

  const isActive = toText(q.is_active);
  if (isActive === "true") {
    finalWhere.push("is_active = true");
  } else if (isActive === "false") {
    finalWhere.push("is_active = false");
  }

  const hasUser = toText(q.has_user);
  if (hasUser === "yes") {
    finalWhere.push("user_id IS NOT NULL");
  } else if (hasUser === "no") {
    finalWhere.push("user_id IS NULL");
  }

  const missingPhone = toText(q.missing_phone);
  if (missingPhone === "yes") {
    finalWhere.push("(phone IS NULL OR TRIM(phone) = '')");
  }

  const attendanceFlag = toText(q.attendance_flag);
  if (attendanceFlag === "has_absence") {
    finalWhere.push("absent_count > 0");
  } else if (attendanceFlag === "no_attendance") {
    finalWhere.push("attendance_records = 0");
  } else if (attendanceFlag === "has_attendance") {
    finalWhere.push("attendance_records > 0");
  }

  const cte = `
    WITH
    ${staffSourceCte()},

    role_summary AS (
      SELECT
        ur.user_id,
        STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles_names,
        COUNT(DISTINCT r.id)::integer AS roles_count
      FROM user_roles ur
      JOIN roles r
        ON r.id = ur.role_id
      WHERE ur.school_id = $1
        AND r.school_id = $1
      GROUP BY ur.user_id
    ),

    attendance_ranked AS (
      SELECT
        tae.teacher_id,
        tae.status,
        tae.method,
        tae.recorded_at,
        tad.attendance_date,
        ROW_NUMBER() OVER (
          PARTITION BY tae.teacher_id
          ORDER BY tad.attendance_date DESC, tae.recorded_at DESC, tae.id DESC
        ) AS rn
      FROM teacher_attendance_entries tae
      JOIN teacher_attendance_days tad
        ON tad.id = tae.day_id
      WHERE ${attendanceWhere.join("\n        AND ")}
    ),

    attendance_summary AS (
      SELECT
        teacher_id,
        COUNT(*)::integer AS attendance_records,
        COUNT(*) FILTER (WHERE status = 'present')::integer AS present_count,
        COUNT(*) FILTER (WHERE status = 'absent')::integer AS absent_count,
        MAX(attendance_date) AS last_attendance_date,
        MAX(attendance_date) FILTER (WHERE status = 'absent') AS last_absence_date
      FROM attendance_ranked
      GROUP BY teacher_id
    ),

    last_attendance AS (
      SELECT
        teacher_id,
        status AS last_attendance_status,
        method AS last_attendance_method,
        attendance_date AS last_attendance_day,
        recorded_at AS last_recorded_at
      FROM attendance_ranked
      WHERE rn = 1
    ),

    main_rows AS (
      SELECT
        ss.profile_key,
        ss.source_type,
        ss.staff_id,
        ss.employee_id,
        ss.teacher_id,
        ss.user_id,
        ss.full_name,
        ss.phone,
        ss.job_title,
        ss.notes,
        ss.is_teacher,
        ss.is_active,
        ss.created_at,
        ss.updated_at,

        u.name AS user_name,
        u.username,
        u.email,
        u.status AS user_status,

        COALESCE(rs.roles_names, '') AS roles_names,
        COALESCE(rs.roles_count, 0)::integer AS roles_count,

        COALESCE(att.attendance_records, 0)::integer AS attendance_records,
        COALESCE(att.present_count, 0)::integer AS present_count,
        COALESCE(att.absent_count, 0)::integer AS absent_count,
        att.last_attendance_date,
        att.last_absence_date,

        la.last_attendance_status,
        la.last_attendance_method,
        la.last_attendance_day,
        la.last_recorded_at,

        CASE
          WHEN COALESCE(att.attendance_records, 0) = 0 THEN NULL
          ELSE ROUND(
            (COALESCE(att.present_count, 0)::numeric / NULLIF(att.attendance_records, 0)::numeric) * 100,
            2
          )
        END AS attendance_rate,

        CASE WHEN ss.phone IS NULL OR TRIM(ss.phone) = '' THEN true ELSE false END AS missing_phone,
        CASE WHEN ss.user_id IS NULL THEN true ELSE false END AS missing_user_account,
        CASE WHEN ss.is_teacher = true AND ss.teacher_id IS NULL THEN true ELSE false END AS missing_teacher_link

      FROM staff_source ss

      LEFT JOIN users u
        ON u.id = ss.user_id
        AND u.school_id = ss.school_id

      LEFT JOIN role_summary rs
        ON rs.user_id = ss.user_id

      LEFT JOIN attendance_summary att
        ON att.teacher_id = ss.teacher_id

      LEFT JOIN last_attendance la
        ON la.teacher_id = ss.teacher_id
    )
  `;

  return {
    cte,
    whereSql: finalWhere.join("\n    AND "),
    params,
  };
}

export const StaffReportsController = {
  async summary(req, res) {
    try {
      const { cte, whereSql, params } = buildStaffReportQuery(req);

      const { rows } = await pool.query(
        `
        ${cte}
        SELECT
          COUNT(*)::integer AS total_employees,

          COUNT(*) FILTER (WHERE is_teacher = true)::integer AS teachers_count,
          COUNT(*) FILTER (WHERE is_teacher = false)::integer AS admins_count,

          COUNT(*) FILTER (WHERE is_active = true)::integer AS active_count,
          COUNT(*) FILTER (WHERE is_active = false)::integer AS inactive_count,

          COUNT(*) FILTER (WHERE missing_phone = true)::integer AS missing_phone_count,
          COUNT(*) FILTER (WHERE missing_user_account = true)::integer AS missing_user_account_count,
          COUNT(*) FILTER (WHERE missing_teacher_link = true)::integer AS missing_teacher_link_count,

          COUNT(*) FILTER (WHERE attendance_records > 0)::integer AS employees_with_attendance_count,
          COUNT(*) FILTER (WHERE attendance_records = 0)::integer AS employees_without_attendance_count,

          COALESCE(SUM(attendance_records), 0)::integer AS total_attendance_records,
          COALESCE(SUM(present_count), 0)::integer AS total_present_count,
          COALESCE(SUM(absent_count), 0)::integer AS total_absent_count,

          COUNT(*) FILTER (WHERE absent_count > 0)::integer AS employees_with_absence_count

        FROM main_rows
        WHERE ${whereSql}
        `,
        params
      );

      return res.json({
        success: true,
        data: rows[0] || {},
      });
    } catch (err) {
      console.error("staff report summary error:", err);

      return res.status(400).json({
        success: false,
        message: err.message || "تعذر تحميل ملخص تقرير الموظفين",
      });
    }
  },

  async list(req, res) {
    try {
      const { cte, whereSql, params } = buildStaffReportQuery(req);

      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = clampLimit(req.query.limit);
      const offset = (page - 1) * limit;

      const queryParams = [...params, limit, offset];
      const limitParam = `$${params.length + 1}`;
      const offsetParam = `$${params.length + 2}`;

      const { rows } = await pool.query(
        `
        ${cte}
        SELECT
          *,
          COUNT(*) OVER()::integer AS total_count
        FROM main_rows
        WHERE ${whereSql}
        ORDER BY
          is_teacher DESC,
          is_active DESC,
          full_name ASC,
          staff_id ASC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
        `,
        queryParams
      );

      const total = rows[0]?.total_count || 0;

      return res.json({
        success: true,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        data: rows.map(({ total_count, ...row }) => row),
      });
    } catch (err) {
      console.error("staff report list error:", err);

      return res.status(400).json({
        success: false,
        message: err.message || "تعذر تحميل تقرير الموظفين",
      });
    }
  },

  async profile(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = getSchoolId(req);
      const staffKey = toText(req.params.employeeId);
      const academicYearId = toPositiveInt(req.query.academic_year_id);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة.",
        });
      }

      if (!staffKey) {
        return res.status(400).json({
          success: false,
          message: "رقم الموظف غير صالح.",
        });
      }

      const { rows: staffRows } = await client.query(
        `
        WITH
        ${staffSourceCte()}
        SELECT
          ss.*,
          u.name AS user_name,
          u.username,
          u.email,
          u.status AS user_status
        FROM staff_source ss
        LEFT JOIN users u
          ON u.id = ss.user_id
          AND u.school_id = ss.school_id
        WHERE
          ss.profile_key = $2
          OR ss.staff_id::text = $2
          OR COALESCE(ss.employee_id::text, '') = $2
          OR COALESCE(ss.teacher_id::text, '') = $2
        ORDER BY
          CASE
            WHEN ss.profile_key = $2 THEN 0
            WHEN ss.source_type = 'employee' THEN 1
            ELSE 2
          END
        LIMIT 1
        `,
        [schoolId, staffKey]
      );

      const staff = staffRows[0];

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: "الموظف غير موجود.",
        });
      }

      let roles = [];

      if (staff.user_id) {
        const { rows } = await client.query(
          `
          SELECT
            r.id,
            r.name,
            r.description
          FROM user_roles ur
          JOIN roles r
            ON r.id = ur.role_id
          WHERE ur.school_id = $1
            AND r.school_id = $1
            AND ur.user_id = $2
          ORDER BY r.name ASC
          `,
          [schoolId, staff.user_id]
        );

        roles = rows;
      }

      let attendanceSummary = null;
      let recentAttendance = [];

      if (staff.teacher_id) {
        const params = [schoolId, staff.teacher_id];
        let yearFilter = "";

        if (academicYearId) {
          params.push(academicYearId);
          yearFilter = "AND tad.academic_year_id = $3";
        }

        const { rows: summaryRows } = await client.query(
          `
          SELECT
            COUNT(*)::integer AS attendance_records,
            COUNT(*) FILTER (WHERE tae.status = 'present')::integer AS present_count,
            COUNT(*) FILTER (WHERE tae.status = 'absent')::integer AS absent_count,
            MAX(tad.attendance_date) AS last_attendance_date,
            MAX(tad.attendance_date) FILTER (WHERE tae.status = 'absent') AS last_absence_date
          FROM teacher_attendance_entries tae
          JOIN teacher_attendance_days tad
            ON tad.id = tae.day_id
          WHERE tad.school_id = $1
            AND tae.teacher_id = $2
            ${yearFilter}
          `,
          params
        );

        attendanceSummary = summaryRows[0] || null;

        const { rows: attendanceRows } = await client.query(
          `
          SELECT
            tad.attendance_date,
            tad.academic_year_id,
            tae.status,
            tae.method,
            tae.notes,
            tae.recorded_at
          FROM teacher_attendance_entries tae
          JOIN teacher_attendance_days tad
            ON tad.id = tae.day_id
          WHERE tad.school_id = $1
            AND tae.teacher_id = $2
            ${yearFilter}
          ORDER BY tad.attendance_date DESC, tae.recorded_at DESC
          LIMIT 20
          `,
          params
        );

        recentAttendance = attendanceRows;
      }

      return res.json({
        success: true,
        data: {
          employee: staff,
          roles,
          attendance: attendanceSummary,
          recent_attendance: recentAttendance,
        },
      });
    } catch (err) {
      console.error("staff report profile error:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "تعذر تحميل ملف تقرير الموظف",
      });
    } finally {
      client.release();
    }
  },
};

export default StaffReportsController;