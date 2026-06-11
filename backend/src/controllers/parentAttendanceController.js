// backend/src/controllers/parentAttendanceController.js
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
  const diffToSat = (jsDay + 1) % 7; // Sat(6)->0, Sun(0)->1, Mon(1)->2 ... Fri(5)->6
  d.setDate(d.getDate() - diffToSat);
  return dateToISO(d);
}

function buildBanner(permit, counts) {
  // permit: { exists, status, type, perm_count }
  if (permit?.exists) {
    if (permit.status === "PENDING") return "يوجد إذن لليوم — بانتظار قرار الإدارة.";
    if (permit.status === "APPROVED") {
      if (permit.type === "ABSENCE") return "إذن غياب (يوم كامل) مقبول من الإدارة.";
      if (permit.type === "LATE") return "إذن تأخر (يوم كامل) مقبول من الإدارة.";
      if (permit.type === "EARLY_LEAVE") return "إذن انصراف مبكر (يوم كامل) مقبول من الإدارة.";
      return "الإذن مقبول من الإدارة.";
    }
    if (permit.status === "REJECTED") return "تم رفض الإذن من الإدارة.";
    return "يوجد إذن لليوم.";
  }

  const total =
    (counts.present || 0) +
    (counts.absent || 0) +
    (counts.late || 0) +
    (counts.excused || 0);

  if (!counts.hasRecords || total === 0) return "لا يوجد تسجيل حضور لليوم حتى الآن.";
  return "تم تسجيل حضور اليوم.";
}

/* =========================
   AuthZ: Parent -> Student link (best-effort)
   (يدعم وجود guardians + جدول ربط، وإن لم يوجد لا يكسر النظام)
========================= */

// ✅ إضافة school_id للتأكد من انتماء الطالب للمدرسة
// التحقق الآمن من ارتباط ولي الأمر بالطالب داخل المدرسة الحالية
async function canParentAccessStudent(db, userId, studentId, schoolId) {
  if (!userId || !studentId || !schoolId) {
    return false;
  }

  // الطالب يجب أن ينتمي إلى مدرسة المستخدم الحالية.
  const studentCheck = await db.query(
    `
    SELECT 1
    FROM students
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [studentId, schoolId]
  );

  if (!studentCheck.rowCount) {
    return false;
  }

  const hasGuardians = await tableExists(db, "guardians");

  // لا نسمح بالوصول إذا كانت بنية الربط غير موجودة.
  if (!hasGuardians) {
    console.warn("canParentAccessStudent: guardians table not found");
    return false;
  }

  const linkTables = [
    "guardian_students",
    "student_guardians",
    "parent_students",
  ];

  let foundExistingLinkTable = false;

  for (const linkTable of linkTables) {
    const exists = await tableExists(db, linkTable);

    if (!exists) {
      continue;
    }

    foundExistingLinkTable = true;

    try {
      const result = await db.query(
        `
        SELECT 1
        FROM guardians g
        JOIN ${linkTable} gs
          ON gs.guardian_id = g.id
        JOIN students s
          ON s.id = gs.student_id
        WHERE g.user_id = $1
          AND gs.student_id = $2
          AND s.school_id = $3
        LIMIT 1
        `,
        [userId, studentId, schoolId]
      );

      // لا نتوقف عند أول جدول فارغ.
      // نستمر حتى نجد علاقة صحيحة في أي جدول ربط موجود.
      if (result.rowCount > 0) {
        return true;
      }
    } catch (error) {
      // لا نمنح صلاحية عند حدوث خطأ.
      // قد يكون أحد الجداول القديمة مختلف البنية، لذلك نجرب الجدول التالي.
      console.warn(
        `canParentAccessStudent skipped ${linkTable}:`,
        error.message
      );
    }
  }

  if (!foundExistingLinkTable) {
    console.warn(
      "canParentAccessStudent: no supported parent-student link table found"
    );
  }

  return false;
}

/* =========================
   Queries (Attendance + Permits)
   ✅ مطابق 100% لأعمدتك مع حماية school_id
========================= */

async function getPermitForDay(db, studentId, isoDate, schoolId) {
  const hasPerm = await tableExists(db, "permission_requests");
  if (!hasPerm) return { exists: false, perm_count: 0, status: null, type: null };

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
  if (!r.rowCount) return { exists: false, perm_count: 0, status: null, type: null };

  const row = r.rows[0];
  return {
    exists: true,
    perm_count: 1, // ✅ إذن اليوم = 1 (ليس بعدد الحصص)
    status: row.status,
    type: row.type,
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
    total_rows: row.total_rows || 0, // ✅ عدد الحصص المسجلة لليوم
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
      AND S.school_id = $5
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

  // ✅ آخر إذن لكل يوم داخل النطاق
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
    out.set(iso, {
      exists: true,
      perm_count: 1,
      status: row.status,
      type: row.type,
    });
  }

  return out;
}

/* =========================
   Controller
========================= */

export const ParentAttendanceController = {
  // GET /api/parent/attendance/today?studentId&date&term&yearId
  async today(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ Multi-tenant

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });

    const studentId = toInt(req.query.studentId);
    const date = String(req.query.date || "");
    const term = toInt(req.query.term);
    const yearId = toInt(req.query.yearId);

    if (!studentId) return res.status(400).json({ error: "studentId مطلوب" });
    if (!isValidISODate(date)) return res.status(400).json({ error: "date لازم YYYY-MM-DD" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      const ok = await canParentAccessStudent(db, userId, studentId, schoolId);
      if (!ok) return res.status(403).json({ error: "لا تملك صلاحية عرض هذا الطالب" });

      const counts = await getCountsForDay(db, studentId, date, term, yearId, schoolId);
      const permit = await getPermitForDay(db, studentId, date, schoolId);
      const banner = buildBanner(permit, counts);

      return res.json({
        studentId,
        date,
        term,
        yearId: yearId || null,

        // flat
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,

        // ✅ إذن اليوم (يوم كامل)
        perm_count: permit.perm_count,

        // ✅ عدد الحصص المسجلة (عشان “حاضر 3” تكون مفهومة)
        sessions_total: counts.total_rows,

        // structured
        counts,
        permit,
        hasRecords: counts.hasRecords,
        banner,
      });
    } catch (e) {
      console.error("parent today error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير اليوم" });
    }
  },

  // GET /api/parent/attendance/week?studentId&end&term&yearId
  async week(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ Multi-tenant

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });

    const studentId = toInt(req.query.studentId);
    const end = String(req.query.end || "");
    const term = toInt(req.query.term);
    const yearId = toInt(req.query.yearId);

    if (!studentId) return res.status(400).json({ error: "studentId مطلوب" });
    if (!isValidISODate(end)) return res.status(400).json({ error: "end لازم YYYY-MM-DD" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });

    try {
      const ok = await canParentAccessStudent(db, userId, studentId, schoolId);
      if (!ok) return res.status(403).json({ error: "لا تملك صلاحية عرض هذا الطالب" });

      const startISO = getSchoolWeekStartISO(end);
      if (!startISO) return res.status(400).json({ error: "end غير صالح" });

      const startParts = isoToDateParts(startISO);
      const startDate = new Date(startParts.y, startParts.mo, startParts.da);
      const weekEndISO = dateToISO(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6));

      // ✅ نسحب بيانات السبت→اليوم دفعة واحدة
      const countsMap = await getCountsByDateRange(db, studentId, startISO, end, term, yearId, schoolId);
      const permitsMap = await getPermitsByDateRange(db, studentId, startISO, end, schoolId);

      const days = [];
      const totals = { present: 0, absent: 0, late: 0, excused: 0, perm_count: 0, sessions_total: 0 };

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
            perm_count: null,
            sessions_total: null,
            permit: { exists: false, perm_count: 0, status: null, type: null },
            hasRecords: false,
          });
          continue;
        }

        const counts =
          countsMap.get(iso) || { present: 0, absent: 0, late: 0, excused: 0, total_rows: 0, hasRecords: false };
        const permit =
          permitsMap.get(iso) || { exists: false, perm_count: 0, status: null, type: null };

        totals.present += counts.present;
        totals.absent += counts.absent;
        totals.late += counts.late;
        totals.excused += counts.excused;

        totals.perm_count += permit.perm_count;
        totals.sessions_total += counts.total_rows;

        days.push({
          date: iso,
          isFuture: false,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          excused: counts.excused,
          perm_count: permit.perm_count,
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
        note: "الحضور محسوب بالحِصص. الأذونات محسوبة بالأيام (إذن يوم كامل = 1).",
      });
    } catch (e) {
      console.error("parent week error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير الأسبوع" });
    }
  },

  // (اختياري) GET /api/parent/attendance/range?studentId&from&to&term&yearId
  async range(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ Multi-tenant

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });

    const studentId = toInt(req.query.studentId);
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const term = toInt(req.query.term);
    const yearId = toInt(req.query.yearId);

    if (!studentId) return res.status(400).json({ error: "studentId مطلوب" });
    if (!isValidISODate(from)) return res.status(400).json({ error: "from لازم YYYY-MM-DD" });
    if (!isValidISODate(to)) return res.status(400).json({ error: "to لازم YYYY-MM-DD" });
    if (!isValidTerm(term)) return res.status(400).json({ error: "term لازم 1 أو 2" });
    if (from > to) return res.status(400).json({ error: "from لازم <= to" });

    try {
      const ok = await canParentAccessStudent(db, userId, studentId, schoolId);
      if (!ok) return res.status(403).json({ error: "لا تملك صلاحية عرض هذا الطالب" });

      const countsMap = await getCountsByDateRange(db, studentId, from, to, term, yearId, schoolId);
      const permitsMap = await getPermitsByDateRange(db, studentId, from, to, schoolId);

      const fp = isoToDateParts(from);
      const tp = isoToDateParts(to);
      const d0 = new Date(fp.y, fp.mo, fp.da);
      const d1 = new Date(tp.y, tp.mo, tp.da);

      const days = [];
      const totals = { present: 0, absent: 0, late: 0, excused: 0, perm_count: 0, sessions_total: 0 };

      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        const iso = dateToISO(d);

        const counts =
          countsMap.get(iso) || { present: 0, absent: 0, late: 0, excused: 0, total_rows: 0, hasRecords: false };
        const permit =
          permitsMap.get(iso) || { exists: false, perm_count: 0, status: null, type: null };

        totals.present += counts.present;
        totals.absent += counts.absent;
        totals.late += counts.late;
        totals.excused += counts.excused;
        totals.perm_count += permit.perm_count;
        totals.sessions_total += counts.total_rows;

        days.push({
          date: iso,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          excused: counts.excused,
          perm_count: permit.perm_count,
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
        note: "الحضور محسوب بالحِصص. الأذونات محسوبة بالأيام (إذن يوم كامل = 1).",
      });
    } catch (e) {
      console.error("parent range error:", e);
      return res.status(500).json({ error: "خطأ داخلي في تقرير النطاق" });
    }
  },
};