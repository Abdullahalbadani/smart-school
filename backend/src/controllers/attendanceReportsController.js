// controllers/attendanceReportsController.js
import { pool } from "../config/db.js";

const ALLOWED_STU_SORT = new Map([
  ["name_asc", "student_name ASC"],
  ["name_desc", "student_name DESC"],
  ["absent_desc", "total_absent DESC, student_name ASC"],
  ["late_desc", "total_late DESC, student_name ASC"],
  ["excused_desc", "total_excused DESC, student_name ASC"],
  ["pct_desc", "attendance_percent DESC, student_name ASC"],
  ["pct_asc", "attendance_percent ASC, student_name ASC"],
]);

const ALLOWED_TCH_SORT = new Map([
  ["name_asc", "t.full_name ASC"],
  ["name_desc", "t.full_name DESC"],
  ["late_desc", "late_minutes DESC, t.full_name ASC"],
  ["absent_desc", "total_absent DESC, t.full_name ASC"],
  ["subs_desc", "subs_count DESC, t.full_name ASC"],
  ["permits_desc", "permits_count DESC, t.full_name ASC"],
]);

const toInt = (v, def = null) => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : v;
};

const monthToRange = (month) => {
  if (!month) return { from: null, to: null };
  const m = String(month);
  if (!/^\d{4}-\d{2}$/.test(m)) return { from: null, to: null };
  const [y, mm] = m.split("-").map((x) => parseInt(x, 10));
  const from = new Date(y, mm - 1, 1);
  const to = new Date(y, mm, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: fmt(from), to: fmt(to) };
};

const normalizeRows = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return [];
};

const attendanceReportsController = {
  // =========================================================
  // 1) تقارير الطلاب
  // =========================================================
  async getStudentsAttendanceReport(req, res) {
    try {
      const schoolId = req.user?.school_id; // ✅ Multi-tenant
      if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح" });

      const year_id = toInt(req.query.year_id);
      const term_id = toInt(req.query.term_id);
      const stage_id = toInt(req.query.stage_id);
      const grade_id = toInt(req.query.grade_id);
      const section_id = toInt(req.query.section_id);

      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);
      const search = (req.query.search || "").trim();
      
      const statusRaw = (req.query.status || "").trim();
      const methodRaw = (req.query.method || "").trim();
      const validStatuses = ['present', 'absent', 'late', 'excused'];
      const status = validStatuses.includes(statusRaw) ? statusRaw : null;
      const method = ['scan', 'manual'].includes(methodRaw) ? methodRaw : null;

      const sortKey = (req.query.sort || "name_asc").trim();
      const sortSql = ALLOWED_STU_SORT.get(sortKey) || ALLOWED_STU_SORT.get("name_asc");

      const page = clamp(toInt(req.query.page, 1), 1, 999999);
      const limit = clamp(toInt(req.query.limit, 25), 5, 300);
      const offset = (page - 1) * limit;

      const params = [schoolId]; // $1
      const whereEnroll = [`se.school_id = $1`, `s.school_id = $1`];
      const whereSess = [`ses.school_id = $1`];

      // Enrollment filters
      if (year_id) { params.push(year_id); whereEnroll.push(`se.academic_year_id = $${params.length}`); }
      if (term_id) { params.push(term_id); whereEnroll.push(`se.term = $${params.length}`); }
      if (stage_id) { params.push(stage_id); whereEnroll.push(`se.stage_id = $${params.length}`); }
      if (grade_id) { params.push(grade_id); whereEnroll.push(`se.grade_id = $${params.length}`); }
      if (section_id) { params.push(section_id); whereEnroll.push(`se.section_id = $${params.length}`); }

      // ✅ فلترة قائمة الطلاب
      if (status || method) {
        let subConds = ["ae_sub.student_id = s.id", "ae_sub.school_id = $1", "ses_sub.school_id = $1"];
        if (status) subConds.push(`ae_sub.status = '${status}'`);
        if (method === "scan") subConds.push(`ae_sub.note ILIKE '%[QR]%'`);
        if (method === "manual") subConds.push(`(ae_sub.note NOT ILIKE '%[QR]%' OR ae_sub.note IS NULL)`);
        
        if (from) subConds.push(`ses_sub.attendance_date >= '${from}'::date`);
        if (to) subConds.push(`ses_sub.attendance_date <= '${to}'::date`);

        whereEnroll.push(`EXISTS (
          SELECT 1 FROM attendance_entries ae_sub
          JOIN attendance_sessions ses_sub ON ses_sub.id = ae_sub.session_id
          WHERE ${subConds.join(" AND ")}
        )`);
      }

      if (search) {
        params.push(`%${search}%`);
        whereEnroll.push(`(s.full_name ILIKE $${params.length} OR s.student_code::text ILIKE $${params.length})`);
      }

      // ✅ إصلاح: Session filters (استخدام المصفوفة الصحيحة whereSess)
      if (year_id) { params.push(year_id); whereSess.push(`ses.academic_year_id = $${params.length}`); }
      if (term_id) { params.push(term_id); whereSess.push(`ses.term = $${params.length}`); }
      if (stage_id) { params.push(stage_id); whereSess.push(`ses.stage_id = $${params.length}`); }
      if (grade_id) { params.push(grade_id); whereSess.push(`ses.grade_id = $${params.length}`); }
      if (section_id) { params.push(section_id); whereSess.push(`ses.section_id = $${params.length}`); }
      if (from) { params.push(from); whereSess.push(`ses.attendance_date >= $${params.length}::date`); }
      if (to) { params.push(to); whereSess.push(`ses.attendance_date <= $${params.length}::date`); }

      let aeFilter = " AND ae.school_id = $1";
      if (status) aeFilter += ` AND ae.status = '${status}'`;
      if (method === "scan") aeFilter += ` AND ae.note ILIKE '%[QR]%'`;
      if (method === "manual") aeFilter += ` AND (ae.note NOT ILIKE '%[QR]%' OR ae.note IS NULL)`;

      const whereEnrollSql = whereEnroll.length ? `WHERE ${whereEnroll.join(" AND ")}` : "";
      const whereSessSql = whereSess.length ? `WHERE ${whereSess.join(" AND ")}` : "";

      const sql = `
        WITH filtered_students AS (
          SELECT s.id AS student_id, s.full_name AS student_name, s.student_code, se.grade_id, se.section_id
          FROM students s
          JOIN student_enrollments se ON se.student_id = s.id
          ${whereEnrollSql}
        ),
        filtered_sessions AS (
          SELECT ses.id, ses.attendance_date
          FROM attendance_sessions ses
          ${whereSessSql}
        ),
        agg AS (
          SELECT
            fs.student_id,
            COUNT(DISTINCT fse.id) AS total_sessions,
            COUNT(ae.id) FILTER (WHERE ae.status = 'present' AND fse.id IS NOT NULL) AS present_count,
            COUNT(ae.id) FILTER (WHERE ae.status = 'absent' AND fse.id IS NOT NULL) AS total_absent,
            COUNT(ae.id) FILTER (WHERE ae.status = 'late' AND fse.id IS NOT NULL) AS total_late,
            COUNT(ae.id) FILTER (WHERE ae.status = 'excused' AND fse.id IS NOT NULL) AS total_excused,
            MAX(fse.attendance_date) FILTER (WHERE ae.status IN ('absent','late','excused') AND fse.id IS NOT NULL) AS last_event_date
          FROM filtered_students fs
          LEFT JOIN attendance_entries ae ON ae.student_id = fs.student_id ${aeFilter}
          LEFT JOIN filtered_sessions fse ON fse.id = ae.session_id
          GROUP BY fs.student_id
        )
        SELECT
          fs.student_id, fs.student_name, fs.student_code,
          CONCAT(g.name, ' - ', sec.name) AS grade_section,
          COALESCE(agg.total_sessions, 0) AS total_sessions,
          COALESCE(agg.present_count, 0) AS present_count,
          COALESCE(agg.total_absent, 0) AS total_absent,
          COALESCE(agg.total_late, 0) AS total_late,
          COALESCE(agg.total_excused, 0) AS total_excused,
          CASE
            WHEN COALESCE(agg.total_sessions, 0) = 0 THEN 0
            ELSE ROUND(((COALESCE(agg.present_count,0) + COALESCE(agg.total_excused,0))::numeric / agg.total_sessions::numeric) * 100, 2)
          END AS attendance_percent,
          COALESCE(TO_CHAR(agg.last_event_date, 'YYYY-MM-DD'), NULL) AS last_event_date
        FROM filtered_students fs
        JOIN grades g ON g.id = fs.grade_id
        JOIN sections sec ON sec.id = fs.section_id
        LEFT JOIN agg ON agg.student_id = fs.student_id
        ORDER BY ${sortSql}
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)};
      `;

      const sumSql = `
        WITH filtered_students AS (
          SELECT s.id AS student_id FROM students s JOIN student_enrollments se ON se.student_id = s.id ${whereEnrollSql}
        ),
        filtered_sessions AS (
          SELECT ses.id FROM attendance_sessions ses ${whereSessSql}
        )
        SELECT
          COUNT(DISTINCT fs.student_id) AS students,
          COUNT(DISTINCT fse.id) AS total_sessions,
          COUNT(ae.id) FILTER (WHERE ae.status = 'present' AND fse.id IS NOT NULL) AS present,
          COUNT(ae.id) FILTER (WHERE ae.status = 'absent' AND fse.id IS NOT NULL) AS absent,
          COUNT(ae.id) FILTER (WHERE ae.status = 'late' AND fse.id IS NOT NULL) AS late,
          COUNT(ae.id) FILTER (WHERE ae.status = 'excused' AND fse.id IS NOT NULL) AS excused,
          CASE
            WHEN COUNT(DISTINCT fse.id) = 0 THEN 0
            ELSE ROUND(((COUNT(ae.id) FILTER (WHERE ae.status='present' AND fse.id IS NOT NULL) + COUNT(ae.id) FILTER (WHERE ae.status='excused' AND fse.id IS NOT NULL))::numeric / COUNT(DISTINCT fse.id)::numeric) * 100, 2)
          END AS avg_attendance_percent
        FROM filtered_students fs
        LEFT JOIN attendance_entries ae ON ae.student_id = fs.student_id ${aeFilter}
        LEFT JOIN filtered_sessions fse ON fse.id = ae.session_id;
      `;

      const [rowsResult, sumResult] = await Promise.all([
        pool.query(sql, params),
        pool.query(sumSql, params.slice(0, params.length - 2)),
      ]);

      res.json({ success: true, rows: rowsResult.rows, summary: sumResult.rows?.[0] || null, page, limit });
    } catch (err) {
      console.error("❌ Error Fetching Students Report:", err);
      res.status(500).json({ success: false, message: "حدث خطأ أثناء استخراج تقرير الطلاب" });
    }
  },

  // =========================================================
  // 2) تفاصيل الطالب
  // =========================================================
  async getStudentAttendanceDetails(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح" });

    const studentId = toInt(req.params.id);
    if (!studentId) return res.status(400).json({ success: false, message: "student id غير صحيح" });

    try {
      const year_id = toInt(req.query.year_id);
      const term_id = toInt(req.query.term_id);
      const from = parseDate(req.query.from);
      const to = parseDate(req.query.to);

      const params = [studentId, schoolId]; // $1, $2
      const whereSess = [`ses.school_id = $2`, `ae.school_id = $2`];

      if (year_id) { params.push(year_id); whereSess.push(`ses.academic_year_id = $${params.length}`); }
      if (term_id) { params.push(term_id); whereSess.push(`ses.term = $${params.length}`); }
      if (from) { params.push(from); whereSess.push(`ses.attendance_date >= $${params.length}::date`); }
      if (to) { params.push(to); whereSess.push(`ses.attendance_date <= $${params.length}::date`); }

      const whereSessSql = whereSess.length ? `AND ${whereSess.join(" AND ")}` : "";

      const kpiSql = `
        WITH filtered AS (
          SELECT ae.*
          FROM attendance_entries ae
          JOIN attendance_sessions ses ON ses.id = ae.session_id
          WHERE ae.student_id = $1
          ${whereSessSql}
        )
        SELECT
          COUNT(*) FILTER (WHERE status='present') AS present_count,
          COUNT(*) FILTER (WHERE status='absent') AS total_absent,
          COUNT(*) FILTER (WHERE status='late') AS total_late,
          COUNT(*) FILTER (WHERE status='excused') AS total_excused,
          COUNT(*) AS total_sessions
        FROM filtered;
      `;

      const logsSql = `
        SELECT
          TO_CHAR(ses.attendance_date, 'YYYY-MM-DD') AS date,
          ae.status,
          CASE
            WHEN ae.status = 'present' THEN 'حاضر'
            WHEN ae.status = 'absent' THEN 'غائب'
            WHEN ae.status = 'late' THEN 'متأخر'
            WHEN ae.status = 'excused' THEN 'بعذر'
            ELSE ae.status
          END AS status_ar,
          ar.name AS reason_name,
          ae.late_minutes,
          ae.note AS notes
        FROM attendance_entries ae
        JOIN attendance_sessions ses ON ses.id = ae.session_id
        LEFT JOIN attendance_reasons ar ON ar.id = ae.reason_id
        WHERE ae.student_id = $1
        ${whereSessSql}
        ORDER BY ses.attendance_date DESC, ae.id DESC
        LIMIT 200;
      `;

      const chartSql = `
        SELECT
          TO_CHAR(date_trunc('month', ses.attendance_date), 'YYYY-MM') AS month,
          COUNT(*) AS count
        FROM attendance_entries ae
        JOIN attendance_sessions ses ON ses.id = ae.session_id
        WHERE ae.student_id = $1
          AND ae.status = 'absent'
          ${whereSessSql}
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 12;
      `;

      const [kpiResult, logsResult, chartResult] = await Promise.all([
        pool.query(kpiSql, params),
        pool.query(logsSql, params),
        pool.query(chartSql, params),
      ]);

      const chartLabels = chartResult.rows.map((r) => r.month);
      const chartData = chartResult.rows.map((r) => Number(r.count) || 0);

      res.json({
        success: true,
        kpis: kpiResult.rows?.[0] || {
          present_count: 0,
          total_absent: 0,
          total_late: 0,
          total_excused: 0,
          total_sessions: 0,
        },
        logs: logsResult.rows || [],
        chartData: { labels: chartLabels, data: chartData },
      });
    } catch (err) {
      console.error("❌ Error Fetching Student Details:", err);
      res.status(500).json({ success: false, message: "حدث خطأ أثناء استخراج تفاصيل الطالب" });
    }
  },

  // =========================================================
  // 3) تقارير المعلمين (الاستعلام النهائي المطابق للبيانات الفعلية)
  // =========================================================
  async getTeachersAttendanceReport(req, res) {
    try {
      const schoolId = req.user?.school_id; // ✅ Multi-tenant
      if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح" });

      const year_id = toInt(req.query.year_id);
      const month = (req.query.month || "").trim();
      const rangeFromTo = month ? monthToRange(month) : { from: null, to: null };
      const from = parseDate(req.query.from) || rangeFromTo.from;
      const to = parseDate(req.query.to) || rangeFromTo.to;

      const teacher_id = toInt(req.query.teacher_id);
      const search = (req.query.search || "").trim();
      const status = (req.query.status || "").trim();
      const method = (req.query.method || "").trim();
      const lockedRaw = (req.query.locked || "").trim();
      const locked = lockedRaw === "true" ? "true" : (lockedRaw === "false" ? "false" : null);

      const sortKey = (req.query.sort || "name_asc").trim();
      const sortSql = ALLOWED_TCH_SORT.get(sortKey) || ALLOWED_TCH_SORT.get("name_asc");

      const page = clamp(toInt(req.query.page, 1), 1, 999999);
      const limit = clamp(toInt(req.query.limit, 25), 5, 300);
      const offset = (page - 1) * limit;

      const params = [schoolId]; // $1
      const whereTeacher = [`t.school_id = $1`];
      const whereAttend = [`tae.school_id = $1`];

      if (teacher_id) { params.push(teacher_id); whereTeacher.push(`t.id = $${params.length}`); }
      if (search) { params.push(`%${search}%`); whereTeacher.push(`t.full_name ILIKE $${params.length}`); }

      if (from) { params.push(from); whereAttend.push(`tae.recorded_at::date >= $${params.length}::date`); }
      if (to) { params.push(to); whereAttend.push(`tae.recorded_at::date <= $${params.length}::date`); }

      // ✅ فلترة المعلمين مع سحب `is_locked` من جدول `teacher_attendance_days` (tad)
      if (status || method || locked) {
        let subConds = ["tae_sub.teacher_id = t.id", "tae_sub.school_id = $1"];
        let subJoin = "";

        if (status) subConds.push(`tae_sub.status = '${status}'`);
        if (method) subConds.push(`tae_sub.method = '${method}'`);
        
        if (locked) {
          subJoin = `JOIN teacher_attendance_days tad_sub ON tad_sub.id = tae_sub.day_id`;
          subConds.push(`tad_sub.is_locked = ${locked}`);
          subConds.push(`tad_sub.school_id = $1`);
        }

        if (from) subConds.push(`tae_sub.recorded_at::date >= '${from}'::date`);
        if (to) subConds.push(`tae_sub.recorded_at::date <= '${to}'::date`);
        
        whereTeacher.push(`EXISTS (
          SELECT 1 FROM teacher_attendance_entries tae_sub
          ${subJoin}
          WHERE ${subConds.join(" AND ")}
        )`);
      }

      let taeFilter = " AND tae.school_id = $1";
      if (status) taeFilter += ` AND tae.status = '${status}'`;
      if (method) taeFilter += ` AND tae.method = '${method}'`;
      if (locked) taeFilter += ` AND tad.is_locked = ${locked}`;

      // يتم دائماً عمل JOIN لجدول الأيام لأن is_locked موجود بداخله
      const baseSql = `
        WITH teacher_stats AS (
          SELECT
            tae.teacher_id,
            COUNT(tae.id) FILTER (WHERE tae.status IN ('present', 'absent', 'late')) AS total_days,
            COUNT(tae.id) FILTER (WHERE tae.status = 'present') AS present_days,
            COUNT(tae.id) FILTER (WHERE tae.status = 'absent') AS total_absent,
            COUNT(tae.id) FILTER (WHERE tae.status = 'late') AS late_days,
            MAX(tae.recorded_at) FILTER (WHERE tae.status IN ('present', 'absent', 'late')) AS last_event_date
          FROM teacher_attendance_entries tae
          JOIN teacher_attendance_days tad ON tad.id = tae.day_id AND tad.school_id = $1
          WHERE 1=1
            ${year_id ? `AND tad.academic_year_id = ${year_id}` : ""}
            ${whereAttend.length ? "AND " + whereAttend.join(" AND ") : ""}
            ${taeFilter}
          GROUP BY tae.teacher_id
        )
        SELECT
          t.id AS teacher_id,
          t.full_name AS teacher_name,
          COALESCE(ts.total_days, 0) AS total_days,
          COALESCE(ts.present_days, 0) AS present_days,
          COALESCE(ts.total_absent, 0) AS total_absent,
          COALESCE(ts.late_days, 0) AS late_days,
          CASE
            WHEN COALESCE(ts.total_days, 0) = 0 THEN 0
            ELSE ROUND((COALESCE(ts.present_days, 0)::numeric / ts.total_days::numeric) * 100, 2)
          END AS presence_percent,
          TO_CHAR(ts.last_event_date, 'YYYY-MM-DD HH12:MI AM') AS last_event_date,
          (
            SELECT tae2.method 
            FROM teacher_attendance_entries tae2 
            WHERE tae2.teacher_id = t.id AND tae2.school_id = $1 AND tae2.method IS NOT NULL AND tae2.method != ''
            ORDER BY tae2.recorded_at DESC LIMIT 1
          ) AS method,
          (
            SELECT tad2.is_locked 
            FROM teacher_attendance_entries tae2 
            JOIN teacher_attendance_days tad2 ON tad2.id = tae2.day_id AND tad2.school_id = $1
            WHERE tae2.teacher_id = t.id AND tae2.school_id = $1 AND tad2.is_locked IS NOT NULL
            ORDER BY tae2.recorded_at DESC LIMIT 1
          ) AS is_locked
        FROM teachers t
        LEFT JOIN teacher_stats ts ON ts.teacher_id = t.id
        ${whereTeacher.length ? "WHERE " + whereTeacher.join(" AND ") : ""}
        ORDER BY ${sortSql}
        LIMIT $L OFFSET $O;
      `;

      const limitPos = params.push(limit);
      const offsetPos = params.push(offset);
      const sql = baseSql.replace(/\$L/g, `$${limitPos}`).replace(/\$O/g, `$${offsetPos}`);

      const result = await pool.query(sql, params);
      res.json({ success: true, rows: result.rows, page, limit });
    } catch (err) {
      console.error("❌ Error Fetching Teachers Report:", err);
      res.status(500).json({ success: false, message: "حدث خطأ أثناء استخراج تقرير المعلمين" });
    }
  },

  // =========================================================
  // 4) تفاصيل المعلم
  // =========================================================
  async getTeacherAttendanceDetails(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح" });

    const teacherId = toInt(req.params.id);
    if (!teacherId) return res.status(400).json({ success: false, message: "teacher id غير صحيح" });

    try {
      const year_id = toInt(req.query.year_id);
      const month = (req.query.month || "").trim();
      const range = month ? monthToRange(month) : { from: null, to: null };
      const from = parseDate(req.query.from) || range.from;
      const to = parseDate(req.query.to) || range.to;

      const params = [teacherId, schoolId]; // $1, $2
      const whereAttend = [`tae.school_id = $2`];
      const wherePermits = [`tpr.school_id = $2`];
      const whereSubs = [`ls.school_id = $2`];

      let yearJoin = "";
      let yearCond = "";
      if (year_id) {
        params.push(year_id);
        yearJoin = "JOIN teacher_attendance_days tad ON tad.id = tae.day_id";
        yearCond = `AND tad.academic_year_id = $${params.length} AND tad.school_id = $2`;
      }

      if (from) {
        params.push(from);
        whereAttend.push(`tae.recorded_at::date >= $${params.length}::date`);
        wherePermits.push(`tpr.request_date >= $${params.length}::date`);
        whereSubs.push(`ls.created_at::date >= $${params.length}::date`);
      }
      if (to) {
        params.push(to);
        whereAttend.push(`tae.recorded_at::date <= $${params.length}::date`);
        wherePermits.push(`tpr.request_date <= $${params.length}::date`);
        whereSubs.push(`ls.created_at::date <= $${params.length}::date`);
      }

      const kpiSql = `
        SELECT
          COALESCE((
            SELECT COUNT(*)
            FROM teacher_attendance_entries tae
            ${yearJoin}
            WHERE tae.teacher_id = $1
              AND tae.status = 'late'
              ${yearCond}
              ${whereAttend.length ? "AND " + whereAttend.join(" AND ") : ""}
          ), 0) AS late_minutes,

          COALESCE((
            SELECT COUNT(*)
            FROM teacher_attendance_entries tae
            ${yearJoin}
            WHERE tae.teacher_id = $1
              AND tae.status = 'absent'
              ${yearCond}
              ${whereAttend.length ? "AND " + whereAttend.join(" AND ") : ""}
          ), 0) AS total_absent,

          COALESCE((
            SELECT COUNT(*)
            FROM lesson_substitutions ls
            WHERE ls.substitute_teacher_id = $1
              AND ls.status IN ('accepted','approved')
              ${whereSubs.length ? "AND " + whereSubs.join(" AND ") : ""}
          ), 0) AS subs_count,

          COALESCE((
            SELECT COUNT(*)
            FROM teacher_permission_requests tpr
            WHERE tpr.teacher_id = $1
              AND tpr.status IN ('approved','APPROVED')
              ${wherePermits.length ? "AND " + wherePermits.join(" AND ") : ""}
          ), 0) AS permits_count
      `;

      const logsSql = `
        SELECT date, type, details
        FROM (
          SELECT
            tae.recorded_at::date AS date,
            CASE
              WHEN tae.status = 'late' THEN 'تأخير'
              WHEN tae.status = 'absent' THEN 'غياب'
              WHEN tae.status = 'present' THEN 'حضور'
              ELSE tae.status
            END AS type,
            COALESCE(tae.notes, tae.method, '') AS details
          FROM teacher_attendance_entries tae
          ${yearJoin}
          WHERE tae.teacher_id = $1
            AND tae.status IN ('late','absent','present')
            ${yearCond}
            ${whereAttend.length ? "AND " + whereAttend.join(" AND ") : ""}

          UNION ALL

          SELECT
            tpr.request_date AS date,
            'إذن رسمي (مقبول)' AS type,
            COALESCE(tpr.reason_text, tpr.notes, '') AS details
          FROM teacher_permission_requests tpr
          WHERE tpr.teacher_id = $1
            AND tpr.status IN ('approved','APPROVED')
            ${wherePermits.length ? "AND " + wherePermits.join(" AND ") : ""}

          UNION ALL

          SELECT
            ls.created_at::date AS date,
            'حصة احتياط' AS type,
            'تم التعويض' AS details
          FROM lesson_substitutions ls
          WHERE ls.substitute_teacher_id = $1
            AND ls.status IN ('accepted','approved')
            ${whereSubs.length ? "AND " + whereSubs.join(" AND ") : ""}
        ) x
        ORDER BY date DESC
        LIMIT 300;
      `;

      const [kpiResult, logsResult] = await Promise.all([
        pool.query(kpiSql, params),
        pool.query(logsSql, params),
      ]);

      res.json({
        success: true,
        kpis: kpiResult.rows?.[0] || { late_minutes: 0, total_absent: 0, subs_count: 0, permits_count: 0 },
        logs: logsResult.rows || [],
      });
    } catch (err) {
      console.error("❌ Error Fetching Teacher Details:", err);
      res.status(500).json({ success: false, message: "حدث خطأ أثناء استخراج تفاصيل المعلم" });
    }
  },
};

export default attendanceReportsController;