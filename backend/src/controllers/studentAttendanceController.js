// backend/src/controllers/studentAttendanceController.js
import { pool } from "../config/db.js";

/* =========================
   Helpers
========================= */

async function tableExists(db, tableName) {
  const r = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!r.rows?.[0]?.reg;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidTerm(t) {
  const n = toInt(t);
  return n === 1 || n === 2;
}

function isValidISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
}

function isoToDateParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, da: +m[3] };
}

function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// أسبوع المدرسة: السبت -> الجمعة
function getSchoolWeekStartISO(endISO) {
  const p = isoToDateParts(endISO);
  if (!p) return null;
  const d = new Date(p.y, p.mo, p.da);

  // JS: 0=Sun..6=Sat
  const jsDay = d.getDay();
  // نريد السبت كبداية أسبوع
  const diffToSat = (jsDay + 1) % 7; // Sat(6)->0, Sun(0)->1 ... Fri(5)->6
  d.setDate(d.getDate() - diffToSat);
  return dateToISO(d);
}

function monthRangeISO(baseISO) {
  const p = isoToDateParts(baseISO);
  if (!p) return null;
  const d0 = new Date(p.y, p.mo, 1);
  const d1 = new Date(p.y, p.mo + 1, 0);
  return { from: dateToISO(d0), to: dateToISO(d1) };
}

function buildTodayMessage(counts, permit) {
  // counts محسوبة بالحِصص
  const total = (counts.present || 0) + (counts.absent || 0) + (counts.late || 0) + (counts.excused || 0);

  if (!counts.hasRecords || total === 0) {
    if (permit?.exists) {
      if (permit.status === "PENDING") return "اليوم: يوجد إذن لكن بانتظار قرار الإدارة — ولم يتم تسجيل الحضور بعد.";
      if (permit.status === "APPROVED") return "اليوم: لديك إذن مقبول — وقد لا يتم تسجيل الحضور للحصص.";
      if (permit.status === "REJECTED") return "اليوم: تم رفض الإذن — لم يتم تسجيل الحضور بعد.";
      return "اليوم: لديك إذن — لم يتم تسجيل الحضور بعد.";
    }
    return "اليوم: لا يوجد تسجيل حضور لك حتى الآن.";
  }

  // لو عنده غياب حصص
  if ((counts.absent || 0) > 0) {
    if (permit?.exists && permit.status === "APPROVED" && permit.type === "ABSENCE") {
      return "اليوم: تم تسجيل غياب لكن لديك إذن غياب مقبول.";
    }
    return "تنبيه: لديك غياب اليوم في بعض الحصص.";
  }

  if ((counts.late || 0) > 0) return "اليوم: تم تسجيل حضورك لكن لديك تأخر في بعض الحصص.";
  if ((counts.excused || 0) > 0) return "اليوم: تم تسجيل حضور بعذر في بعض الحصص.";
  return "ممتاز 👌 تم تسجيل حضورك اليوم.";
}

/* =========================
   Resolve studentId by user
   (best-effort حتى لو اختلف عمود الربط)
========================= */

const __COL_CACHE = new Map(); // table -> {col: true}
async function getTableColumns(db, tableName) {
  if (__COL_CACHE.has(tableName)) return __COL_CACHE.get(tableName);

  const r = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
  `,
    [tableName]
  );
  const map = Object.create(null);
  for (const row of r.rows || []) map[row.column_name] = true;
  __COL_CACHE.set(tableName, map);
  return map;
}

async function pickExistingColumn(db, tableName, candidates) {
  const cols = await getTableColumns(db, tableName);
  for (const c of candidates) if (cols[c]) return c;
  return null;
}

async function resolveStudentIdByUser(db, userId, schoolId) {
  const hasStudents = await tableExists(db, "students");
  if (!hasStudents) return null;

  const userCol = await pickExistingColumn(db, "students", ["user_id", "student_user_id", "account_user_id"]);
  if (!userCol) return null;

  // ✅ التعديل: إضافة school_id لضمان جلب الطالب من مدرسته فقط
  const q = `SELECT id FROM students WHERE ${userCol} = $1 AND school_id = $2 LIMIT 1`;
  const r = await db.query(q, [userId, schoolId]);
  return r.rowCount ? r.rows[0].id : null;
}

/* =========================
   Queries
   attendance_sessions.attendance_date
   permission_requests.request_date
========================= */

async function getPermitForDay(db, studentId, isoDate, schoolId) {
  const hasPerm = await tableExists(db, "permission_requests");
  if (!hasPerm) return { exists: false, status: null, type: null };

  const q = `
    SELECT id, status, type
    FROM permission_requests
    WHERE student_id = $1
      AND request_date = $2::date
      AND school_id = $3
    ORDER BY id DESC
    LIMIT 1
  `;
  const r = await db.query(q, [studentId, isoDate, schoolId]);
  if (!r.rowCount) return { exists: false, status: null, type: null };

  return {
    exists: true,
    status: r.rows[0].status,
    type: r.rows[0].type,
  };
}

async function getCountsForDay(db, studentId, isoDate, term, yearId, schoolId) {
  const hasSessions = await tableExists(db, "attendance_sessions");
  const hasEntries = await tableExists(db, "attendance_entries");
  if (!hasSessions || !hasEntries) {
    return { present: 0, absent: 0, late: 0, excused: 0, total_rows: 0, hasRecords: false };
  }

  const params = [studentId, isoDate, term, schoolId];
  let yearFilter = "";
  if (yearId) {
    params.push(yearId);
    yearFilter = ` AND s.academic_year_id = $5 `;
  }

  const q = `
    SELECT
      COALESCE(SUM(CASE WHEN ae.status = 'present' THEN 1 ELSE 0 END),0)::int AS present,
      COALESCE(SUM(CASE WHEN ae.status = 'absent' THEN 1 ELSE 0 END),0)::int  AS absent,
      COALESCE(SUM(CASE WHEN ae.status = 'late' THEN 1 ELSE 0 END),0)::int    AS late,
      COALESCE(SUM(CASE WHEN ae.status = 'excused' THEN 1 ELSE 0 END),0)::int AS excused,
      COUNT(ae.id)::int AS total_rows
    FROM attendance_entries ae
    JOIN attendance_sessions s ON s.id = ae.session_id
    WHERE ae.student_id = $1
      AND s.attendance_date = $2::date
      AND s.term = $3
      AND ae.school_id = $4
      AND s.school_id = $4
      ${yearFilter}
  `;

  const r = await db.query(q, params);
  const row = r.rows?.[0] || {};
  return {
    present: row.present || 0,
    absent: row.absent || 0,
    late: row.late || 0,
    excused: row.excused || 0,
    total_rows: row.total_rows || 0,
    hasRecords: (row.total_rows || 0) > 0,
  };
}

async function getCountsByDateRange(db, studentId, fromISO, toISO, term, yearId, schoolId) {
  const out = new Map();

  const hasSessions = await tableExists(db, "attendance_sessions");
  const hasEntries = await tableExists(db, "attendance_entries");
  if (!hasSessions || !hasEntries) return out;

  const params = [studentId, fromISO, toISO, term, schoolId];
  let yearFilter = "";
  if (yearId) {
    params.push(yearId);
    yearFilter = ` AND s.academic_year_id = $6 `;
  }

  const q = `
    SELECT
      s.attendance_date::date AS day,
      COALESCE(SUM(CASE WHEN ae.status = 'present' THEN 1 ELSE 0 END),0)::int AS present,
      COALESCE(SUM(CASE WHEN ae.status = 'absent' THEN 1 ELSE 0 END),0)::int  AS absent,
      COALESCE(SUM(CASE WHEN ae.status = 'late' THEN 1 ELSE 0 END),0)::int    AS late,
      COALESCE(SUM(CASE WHEN ae.status = 'excused' THEN 1 ELSE 0 END),0)::int AS excused,
      COUNT(ae.id)::int AS total_rows
    FROM attendance_entries ae
    JOIN attendance_sessions s ON s.id = ae.session_id
    WHERE ae.student_id = $1
      AND s.attendance_date::date BETWEEN $2::date AND $3::date
      AND s.term = $4
      AND ae.school_id = $5
      AND s.school_id = $5
      ${yearFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const r = await db.query(q, params);
  for (const row of r.rows || []) {
    const iso = dateToISO(new Date(row.day));
    out.set(iso, {
      present: row.present || 0,
      absent: row.absent || 0,
      late: row.late || 0,
      excused: row.excused || 0,
      total_rows: row.total_rows || 0,
      hasRecords: (row.total_rows || 0) > 0,
    });
  }

  return out;
}

async function getPermitsByDateRange(db, studentId, fromISO, toISO, schoolId) {
  const out = new Map();
  const hasPerm = await tableExists(db, "permission_requests");
  if (!hasPerm) return out;

  const q = `
    SELECT DISTINCT ON (request_date::date)
      request_date::date AS day,
      id, status, type
    FROM permission_requests
    WHERE student_id = $1
      AND request_date::date BETWEEN $2::date AND $3::date
      AND school_id = $4
    ORDER BY request_date::date ASC, id DESC
  `;

  const r = await db.query(q, [studentId, fromISO, toISO, schoolId]);
  for (const row of r.rows || []) {
    const iso = dateToISO(new Date(row.day));
    out.set(iso, { exists: true, status: row.status, type: row.type });
  }

  return out;
}

async function resolveDefaultYearId(db, schoolId) {
  const hasYears = await tableExists(db, "academic_years");
  if (!hasYears) return null;

  // الأفضل: is_active
  const cols = await getTableColumns(db, "academic_years");
  if (cols.is_active) {
    const r = await db.query(`SELECT id FROM academic_years WHERE is_active = true AND school_id = $1 ORDER BY id DESC LIMIT 1`, [schoolId]);
    if (r.rowCount) return r.rows[0].id;
  }

  // fallback: latest
  const r2 = await db.query(`SELECT id FROM academic_years WHERE school_id = $1 ORDER BY id DESC LIMIT 1`, [schoolId]);
  return r2.rowCount ? r2.rows[0].id : null;
}

/* =========================
   Controller
========================= */

export const StudentAttendanceController = {
  // GET /api/student/attendance/today?date=YYYY-MM-DD&term=1&yearId=1
  async today(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    const date = String(req.query.date || "");
    const term = toInt(req.query.term);
    let yearId = toInt(req.query.yearId);

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });
    if (!isValidISODate(date)) return res.status(400).json({ error: "date لازم YYYY-MM-DD" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      if (!yearId) yearId = await resolveDefaultYearId(db, schoolId);

      const studentId = await resolveStudentIdByUser(db, userId, schoolId);
      if (!studentId) return res.status(404).json({ error: "لم يتم العثور على الطالب المرتبط بهذا الحساب" });

      const counts = await getCountsForDay(db, studentId, date, term, yearId, schoolId);
      const permit = await getPermitForDay(db, studentId, date, schoolId);

      const message = buildTodayMessage(counts, permit);

      return res.json({
        studentId,
        date,
        term,
        yearId: yearId || null,

        counts,
        permit,

        // flat للتوافق
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,
        sessions_total: counts.total_rows,

        message,
      });
    } catch (e) {
      console.error("student today error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير اليوم" });
    }
  },

  // GET /api/student/attendance/week?end=YYYY-MM-DD&term=1&yearId=1
  async week(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    const end = String(req.query.end || "");
    const term = toInt(req.query.term);
    let yearId = toInt(req.query.yearId);

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });
    if (!isValidISODate(end)) return res.status(400).json({ error: "end لازم YYYY-MM-DD" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      if (!yearId) yearId = await resolveDefaultYearId(db, schoolId);

      const studentId = await resolveStudentIdByUser(db, userId, schoolId);
      if (!studentId) return res.status(404).json({ error: "لم يتم العثور على الطالب المرتبط بهذا الحساب" });

      const startISO = getSchoolWeekStartISO(end);
      if (!startISO) return res.status(400).json({ error: "end غير صالح" });

      const startParts = isoToDateParts(startISO);
      const startDate = new Date(startParts.y, startParts.mo, startParts.da);
      const weekEndISO = dateToISO(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6));

      const countsMap = await getCountsByDateRange(db, studentId, startISO, end, term, yearId, schoolId);
      const permitsMap = await getPermitsByDateRange(db, studentId, startISO, end, schoolId);

      const days = [];
      const totals = { present: 0, absent: 0, late: 0, excused: 0, sessions_total: 0, permit_days: 0 };

      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const iso = dateToISO(d);

        const isFuture = iso > end;
        if (isFuture) {
          days.push({
            date: iso,
            isFuture: true,
            present: null,
            absent: null,
            late: null,
            excused: null,
            sessions_total: null,
            permit: { exists: false, status: null, type: null },
            hasRecords: false,
          });
          continue;
        }

        const counts = countsMap.get(iso) || { present: 0, absent: 0, late: 0, excused: 0, total_rows: 0, hasRecords: false };
        const permit = permitsMap.get(iso) || { exists: false, status: null, type: null };

        totals.present += counts.present;
        totals.absent += counts.absent;
        totals.late += counts.late;
        totals.excused += counts.excused;
        totals.sessions_total += counts.total_rows;
        if (permit.exists) totals.permit_days += 1;

        days.push({
          date: iso,
          isFuture: false,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          excused: counts.excused,
          sessions_total: counts.total_rows,
          permit,
          hasRecords: counts.hasRecords,
        });
      }

      return res.json({
        studentId,
        term,
        yearId: yearId || null,
        startDate: startISO,
        endDate: end,
        weekEndDate: weekEndISO,
        days,
        totals,
        note: "الحضور محسوب بالحِصص. الأذونات على مستوى اليوم (يوم فيه إذن = 1).",
      });
    } catch (e) {
      console.error("student week error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير الأسبوع" });
    }
  },

  // GET /api/student/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD&term=1&yearId=1
  async range(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const term = toInt(req.query.term);
    let yearId = toInt(req.query.yearId);

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });
    if (!isValidISODate(from)) return res.status(400).json({ error: "from لازم YYYY-MM-DD" });
    if (!isValidISODate(to)) return res.status(400).json({ error: "to لازم YYYY-MM-DD" });
    if (from > to) return res.status(400).json({ error: "from لازم <= to" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      if (!yearId) yearId = await resolveDefaultYearId(db, schoolId);

      const studentId = await resolveStudentIdByUser(db, userId, schoolId);
      if (!studentId) return res.status(404).json({ error: "لم يتم العثور على الطالب المرتبط بهذا الحساب" });

      const countsMap = await getCountsByDateRange(db, studentId, from, to, term, yearId, schoolId);
      const permitsMap = await getPermitsByDateRange(db, studentId, from, to, schoolId);

      const fp = isoToDateParts(from);
      const tp = isoToDateParts(to);
      const d0 = new Date(fp.y, fp.mo, fp.da);
      const d1 = new Date(tp.y, tp.mo, tp.da);

      const days = [];
      const totals = { present: 0, absent: 0, late: 0, excused: 0, sessions_total: 0, permit_days: 0 };

      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        const iso = dateToISO(d);
        const counts = countsMap.get(iso) || { present: 0, absent: 0, late: 0, excused: 0, total_rows: 0, hasRecords: false };
        const permit = permitsMap.get(iso) || { exists: false, status: null, type: null };

        totals.present += counts.present;
        totals.absent += counts.absent;
        totals.late += counts.late;
        totals.excused += counts.excused;
        totals.sessions_total += counts.total_rows;
        if (permit.exists) totals.permit_days += 1;

        days.push({
          date: iso,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          excused: counts.excused,
          sessions_total: counts.total_rows,
          permit,
          hasRecords: counts.hasRecords,
        });
      }

      return res.json({
        studentId,
        term,
        yearId: yearId || null,
        from,
        to,
        days,
        totals,
        note: "الحضور محسوب بالحِصص. الأذونات على مستوى اليوم (يوم فيه إذن = 1).",
      });
    } catch (e) {
      console.error("student range error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير النطاق" });
    }
  },

  // GET /api/student/attendance/stats?term=1&yearId=1
  async stats(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    const term = toInt(req.query.term);
    let yearId = toInt(req.query.yearId);

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });
    if (term && !isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      if (!yearId) yearId = await resolveDefaultYearId(db, schoolId);

      const studentId = await resolveStudentIdByUser(db, userId, schoolId);
      if (!studentId) return res.status(404).json({ error: "لم يتم العثور على الطالب المرتبط بهذا الحساب" });

      const hasSessions = await tableExists(db, "attendance_sessions");
      const hasEntries = await tableExists(db, "attendance_entries");
      if (!hasSessions || !hasEntries) {
        return res.json({ studentId, yearId: yearId || null, term: term || null, attendanceRate: 0, totals: {} });
      }

      const params = [studentId, schoolId];
      let where = `WHERE ae.student_id = $1 AND ae.school_id = $2 AND s.school_id = $2`;

      if (yearId) {
        params.push(yearId);
        where += ` AND s.academic_year_id = $${params.length}`;
      }
      if (term) {
        params.push(term);
        where += ` AND s.term = $${params.length}`;
      }

      const q = `
        SELECT
          COALESCE(SUM(CASE WHEN ae.status = 'present' THEN 1 ELSE 0 END),0)::int AS present,
          COALESCE(SUM(CASE WHEN ae.status = 'absent' THEN 1 ELSE 0 END),0)::int  AS absent,
          COALESCE(SUM(CASE WHEN ae.status = 'late' THEN 1 ELSE 0 END),0)::int    AS late,
          COALESCE(SUM(CASE WHEN ae.status = 'excused' THEN 1 ELSE 0 END),0)::int AS excused,
          COUNT(ae.id)::int AS total
        FROM attendance_entries ae
        JOIN attendance_sessions s ON s.id = ae.session_id
        ${where}
      `;

      const r = await db.query(q, params);
      const row = r.rows?.[0] || { present: 0, absent: 0, late: 0, excused: 0, total: 0 };

      const total = row.total || 0;

      // تعريف “حضور” للطالب: present + late + excused / total
      const attended = (row.present || 0) + (row.late || 0) + (row.excused || 0);
      const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

      return res.json({
        studentId,
        yearId: yearId || null,
        term: term || null,
        attendanceRate: rate,
        totals: {
          present: row.present || 0,
          absent: row.absent || 0,
          late: row.late || 0,
          excused: row.excused || 0,
          total: total,
        },
      });
    } catch (e) {
      console.error("student stats error:", e);
      return res.status(500).json({ error: "خطأ داخلي في إحصائيات الحضور" });
    }
  },
};