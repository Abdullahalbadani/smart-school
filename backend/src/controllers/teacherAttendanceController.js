// src/controllers/teacherAttendanceController.js
import { pool } from "../config/db.js";
import { NotificationAutoService } from "../modules/notifications/index.js";

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

function getSchoolId(req) {
  return toInt(req.user?.school_id);
}

function isValidTerm(t) {
  const n = toInt(t);
  return n === 1 || n === 2;
}

function isValidISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
}

function isValidStatus(s) {
  return ["present", "absent", "late", "excused"].includes(String(s || ""));
}

// 1=Saturday,2=Sunday,3=Mon,...7=Fri
function schoolDayIdFromISO(iso) {
  const dStr = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return null;

  const d = new Date(dStr + "T00:00:00Z");
  const jsDay = d.getUTCDay();
  const mapToSchoolDay = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
  return mapToSchoolDay[jsDay] || null;
}

async function getTeacherIdByUserId(userId, schoolId) {
  const r = await pool.query(
    `
    SELECT id
    FROM teachers
    WHERE user_id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [userId, schoolId]
  );
  return r.rows[0]?.id || null;
}

async function assertTeacher(req) {
  const schoolId = getSchoolId(req);
  if (!schoolId) return null;

  const teacherIdFromToken = toInt(req.user?.teacher_id);
  if (teacherIdFromToken) {
    const r = await pool.query(
      `
      SELECT id
      FROM teachers
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [teacherIdFromToken, schoolId]
    );
    if (r.rows[0]?.id) return r.rows[0].id;
  }

  const userId = req.user?.id;
  if (!userId) return null;

  return getTeacherIdByUserId(userId, schoolId);
}

/**
 * أحياناً الفرونت يرسل sort_order بدل periods.id
 */
async function resolvePeriodId(client, schoolId, incomingPid) {
  const pid = toInt(incomingPid);
  if (!pid) return { periodId: null, sortOrder: null };

  let r = await client.query(
    `SELECT id, sort_order FROM periods WHERE school_id = $1 AND id = $2 LIMIT 1`,
    [schoolId, pid]
  );
  if (r.rowCount) {
    return { periodId: r.rows[0].id, sortOrder: r.rows[0].sort_order };
  }

  r = await client.query(
    `SELECT id, sort_order FROM periods WHERE school_id = $1 AND sort_order = $2 LIMIT 1`,
    [schoolId, pid]
  );
  if (r.rowCount) {
    return { periodId: r.rows[0].id, sortOrder: r.rows[0].sort_order };
  }

  return { periodId: null, sortOrder: null };
}

/* =========================
   Optional columns
========================= */

const __colCache = Object.create(null);

async function tableHasColumn(client, tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (key in __colCache) return __colCache[key];

  const r = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );

  __colCache[key] = !!r.rowCount;
  return __colCache[key];
}

/* =========================
   PERMITS
========================= */

async function getTableColumnsSet(db, tableName) {
  const r = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    `,
    [tableName]
  );
  const set = new Set();
  (r.rows || []).forEach((x) => set.add(String(x.column_name)));
  return set;
}

function pickCol(colsSet, candidates) {
  for (const c of candidates) {
    if (colsSet.has(c)) return c;
  }
  return null;
}

async function pickPermitsTable(db) {
  const candidates = [
    "permission_requests",
    "student_permissions",
    "student_permits",
    "permits",
    "absence_requests",
    "excuse_requests",
    "student_excuses",
    "excuses",
  ];
  for (const t of candidates) {
    if (await tableExists(db, t)) return t;
  }
  return null;
}

async function queryPermitsRows({
  schoolId,
  teacherId,
  ay,
  term,
  statusOverride = null,
  typeOverride = null,
  q = {},
}) {
  const permitsTable = await pickPermitsTable(pool);
  if (!permitsTable) return [];

  const cols = await getTableColumnsSet(pool, permitsTable);

  const cSchool = pickCol(cols, ["school_id"]);
  const cStudent = pickCol(cols, ["student_id"]);
  const cDate = pickCol(cols, ["request_date", "permit_date", "date", "absence_date", "from_date", "start_date"]);
  const cStatus = pickCol(cols, ["status", "request_status", "approval_status", "state"]);
  const cType = pickCol(cols, ["type", "request_type", "permit_type", "kind"]);
  const cReason = pickCol(cols, ["reason_id", "attendance_reason_id"]);
  const cLate = pickCol(cols, ["late_minutes", "delay_minutes", "minutes"]);
  const cNote = pickCol(cols, ["note", "notes", "comment", "description", "reason_text"]);
  const cCreated = pickCol(cols, ["created_at", "createdon", "created_date", "created"]);
  const cSubject = pickCol(cols, ["subject_id", "lesson_subject_id", "subject"]);

  if (!cStudent) {
    throw new Error(`permits table "${permitsTable}" missing student_id column`);
  }

  const params = [schoolId, ay, term, teacherId];

  const where = [];

  if (cSchool) {
    where.push(`pr.${cSchool} = $1`);
  }

  const from = String(q.from || "").slice(0, 10);
  const to = String(q.to || "").slice(0, 10);
  const date = String(q.date || "").slice(0, 10);

  const d1 = from || date;
  const d2 = to || date;

  if (cDate && d1 && isValidISODate(d1) && d2 && isValidISODate(d2)) {
    params.push(d1, d2);
    where.push(`pr.${cDate}::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  const status = statusOverride || String(q.status || "").trim();
  if (status && cStatus) {
    params.push(status);
    where.push(`LOWER(pr.${cStatus}::text) = LOWER($${params.length})`);
  }

  const type = typeOverride || String(q.type || "").trim();
  if (type && cType) {
    params.push(type);
    where.push(`LOWER(pr.${cType}::text) = LOWER($${params.length})`);
  }

  const search = String(q.search || "").trim();
  if (search) {
    params.push(`%${search}%`);
    where.push(`(s.full_name ILIKE $${params.length} OR s.student_code ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `AND ${where.join(" AND ")}` : "";

  const selDate = cDate ? `pr.${cDate}::date AS date` : `NULL::date AS date`;
  const selStatus = cStatus ? `pr.${cStatus}::text AS status` : `NULL::text AS status`;
  const selType = cType ? `pr.${cType}::text AS type` : `NULL::text AS type`;
  const selReason = cReason ? `pr.${cReason}::int AS reason_id` : `NULL::int AS reason_id`;
  const selLate = cLate ? `pr.${cLate}::int AS late_minutes` : `NULL::int AS late_minutes`;
  const selNote = cNote ? `pr.${cNote}::text AS note` : `NULL::text AS note`;
  const selCreated = cCreated ? `pr.${cCreated} AS created_at` : `NULL::timestamptz AS created_at`;
  const selSubject = cSubject ? `pr.${cSubject}::int AS subject_id` : `NULL::int AS subject_id`;

  const joinReason = cReason
    ? `LEFT JOIN attendance_reasons ar ON ar.id = pr.${cReason} AND ar.school_id = $1`
    : `LEFT JOIN attendance_reasons ar ON 1=0`;

  const orderBy = cCreated ? `pr.${cCreated} DESC NULLS LAST, pr.id DESC` : `pr.id DESC`;

  const sql = `
    WITH my_sections AS (
      SELECT DISTINCT t.section_id
      FROM timetables t
      JOIN timetable_entries te
        ON te.timetable_id = t.id
       AND te.school_id = t.school_id
      WHERE t.school_id = $1
        AND t.academic_year_id = $2
        AND t.term = $3
        AND t.status = 'published'
        AND te.teacher_id = $4
        AND te.school_id = $1
    )
    SELECT
      pr.id,
      pr.${cStudent}::int AS student_id,
      s.student_code,
      s.full_name AS student_name,
      ${selDate},
      ${selType},
      ${selStatus},
      ${selReason},
      ar.name AS reason_name,
      ${selLate},
      ${selNote},
      ${selSubject},
      ${selCreated}
    FROM ${permitsTable} pr
    JOIN students s
      ON s.id = pr.${cStudent}
     AND s.school_id = $1
    JOIN student_enrollments se
      ON se.student_id = s.id
     AND se.school_id = s.school_id
     AND se.academic_year_id = $2
    JOIN my_sections ms ON ms.section_id = se.section_id
    ${joinReason}
    WHERE 1=1
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT 500
  `;

  const r = await pool.query(sql, params);
  return r.rows || [];
}

// GET /teacher/attendance/permits
export async function permitsList(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const ay = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    if (!ay || !isValidTerm(term)) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const rows = await queryPermitsRows({
      schoolId,
      teacherId,
      ay,
      term,
      q: req.query,
    });

    return res.json({ data: { rows } });
  } catch (e) {
    console.error("permitsList error:", e);
    return res.status(500).json({ message: "فشل تحميل الأذونات" });
  }
}

// GET /teacher/attendance/approved
export async function permitsApproved(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const ay = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    if (!ay || !isValidTerm(term)) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const rows = await queryPermitsRows({
      schoolId,
      teacherId,
      ay,
      term,
      statusOverride: "approved",
      q: req.query,
    });

    return res.json({ data: { rows } });
  } catch (e) {
    console.error("permitsApproved error:", e);
    return res.status(500).json({ message: "فشل تحميل الأذونات المعتمدة" });
  }
}

export async function permitsExcuses(req, res) {
  return permitsList(req, res);
}

export async function permitsMap(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const ay = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    if (!ay || !isValidTerm(term)) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const rows = await queryPermitsRows({
      schoolId,
      teacherId,
      ay,
      term,
      q: req.query,
    });

    const map = {};
    for (const x of rows) {
      const sid = String(x.student_id || "");
      if (!sid) continue;
      if (!map[sid]) map[sid] = x;
    }

    return res.json({ data: { map } });
  } catch (e) {
    console.error("permitsMap error:", e);
    return res.status(500).json({ message: "فشل تحميل خريطة الأذونات" });
  }
}

async function buildSessionsSelect(clientOrPool, alias = "ses", withLessonNote = false) {
  const hasStarted = await tableHasColumn(clientOrPool, "attendance_sessions", "started_at");
  const hasEnded = await tableHasColumn(clientOrPool, "attendance_sessions", "ended_at");
  const hasNote = withLessonNote
    ? await tableHasColumn(clientOrPool, "attendance_sessions", "lesson_note")
    : false;

  return `
    ${alias}.id,
    ${alias}.school_id,
    ${alias}.academic_year_id,
    ${alias}.term,
    ${alias}.attendance_date,
    ${alias}.period_id,
    p.sort_order AS lesson,
    ${alias}.section_id,
    ${alias}.subject_id,
    ${alias}.teacher_id,
    ${alias}.is_locked,
    ${hasStarted ? `${alias}.started_at` : `NULL::timestamptz AS started_at`},
    ${hasEnded ? `${alias}.ended_at` : `NULL::timestamptz AS ended_at`}
    ${withLessonNote ? `, ${hasNote ? `${alias}.lesson_note` : `NULL::text AS lesson_note`}` : ""}
  `;
}

async function trySetStartedAt(client, schoolId, sessionId) {
  const ok = await tableHasColumn(client, "attendance_sessions", "started_at");
  if (!ok) return;
  await client.query(
    `UPDATE attendance_sessions SET started_at = COALESCE(started_at, NOW()) WHERE school_id = $1 AND id = $2`,
    [schoolId, sessionId]
  );
}

async function trySetEndedAt(client, schoolId, sessionId) {
  const ok = await tableHasColumn(client, "attendance_sessions", "ended_at");
  if (!ok) return;
  await client.query(
    `UPDATE attendance_sessions SET ended_at = COALESCE(ended_at, NOW()) WHERE school_id = $1 AND id = $2`,
    [schoolId, sessionId]
  );
}

async function trySetLessonNote(client, schoolId, sessionId, noteVal) {
  const ok = await tableHasColumn(client, "attendance_sessions", "lesson_note");
  if (!ok) return false;
  await client.query(
    `UPDATE attendance_sessions SET lesson_note = $3 WHERE school_id = $1 AND id = $2`,
    [schoolId, sessionId, noteVal]
  );
  return true;
}

/* =========================
   META
========================= */

export async function sessionSlots(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    const dateVal = String(req.query.date || "").slice(0, 10);
    const sectionId = toInt(req.query.sectionId);
    const subjectId =
      req.query.subjectId == null || req.query.subjectId === ""
        ? null
        : toInt(req.query.subjectId);

    if (!academicYearId || !isValidTerm(term) || !isValidISODate(dateVal) || !sectionId) {
      return res.status(400).json({
        message: "academicYearId, term, date, sectionId مطلوبة",
      });
    }

    const hasStarted = await tableHasColumn(pool, "attendance_sessions", "started_at");
    const hasEnded = await tableHasColumn(pool, "attendance_sessions", "ended_at");

    const params = [schoolId, teacherId, academicYearId, term, dateVal, sectionId];
    let whereSubject = "";
    if (subjectId) {
      params.push(subjectId);
      whereSubject = ` AND ses.subject_id = $${params.length} `;
    }

    const q = `
      SELECT DISTINCT ON (ses.period_id)
        ses.id,
        ses.period_id,
        p.sort_order AS lesson,
        ses.subject_id,
        ses.is_locked,
        ${hasStarted ? "ses.started_at" : "NULL::timestamptz AS started_at"},
        ${hasEnded ? "ses.ended_at" : "NULL::timestamptz AS ended_at"}
      FROM attendance_sessions ses
      LEFT JOIN periods p
        ON p.id = ses.period_id
       AND p.school_id = ses.school_id
      WHERE ses.school_id = $1
        AND ses.teacher_id = $2
        AND ses.academic_year_id = $3
        AND ses.term = $4
        AND ses.attendance_date = $5
        AND ses.section_id = $6
        ${whereSubject}
      ORDER BY ses.period_id, ses.is_locked DESC, ses.id DESC
    `;

    const r = await pool.query(q, params);
    return res.json({ data: { slots: r.rows } });
  } catch (e) {
    console.error("sessionSlots error:", e);
    return res.status(500).json({ message: "فشل تحميل جلسات اليوم" });
  }
}

export async function meta(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const [yearsQ, periodsQ, reasonsQ] = await Promise.all([
      pool.query(
        `SELECT id, school_id, name
         FROM academic_years
         WHERE school_id = $1
         ORDER BY id DESC`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, name, start_time, end_time, sort_order
         FROM periods
         WHERE school_id = $1
         ORDER BY sort_order ASC`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, name
         FROM attendance_reasons
         WHERE school_id = $1
           AND is_active = TRUE
         ORDER BY id ASC`,
        [schoolId]
      ),
    ]);

    return res.json({
      data: {
        years: yearsQ.rows,
        periods: periodsQ.rows,
        reasons: reasonsQ.rows,
      },
    });
  } catch (e) {
    console.error("attendance meta error:", e);
    return res.status(500).json({ message: "خطأ في meta" });
  }
}

/* =========================
   SCOPES
========================= */
export async function scopes(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);

    if (!academicYearId || !isValidTerm(term)) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const q = `
      SELECT DISTINCT
        t.stage_id,
        st.name AS stage_name,

        t.grade_id,
        g.name AS grade_name,
        g.order_index AS grade_order,

        t.section_id,
        sec.name AS section_name,

        te.subject_id,
        sub.name AS subject_name

      FROM timetables t
      JOIN timetable_entries te
        ON te.timetable_id = t.id
       AND te.school_id = t.school_id
      JOIN stages st
        ON st.id = t.stage_id
       AND st.school_id = t.school_id
      JOIN grades g
        ON g.id = t.grade_id
       AND g.school_id = t.school_id
      JOIN sections sec
        ON sec.id = t.section_id
       AND sec.school_id = t.school_id
      JOIN subjects sub
        ON sub.id = te.subject_id
       AND sub.school_id = te.school_id
      WHERE t.school_id = $1
        AND t.academic_year_id = $2
        AND t.term = $3
        AND te.teacher_id = $4
      ORDER BY stage_name, grade_order, section_name, subject_name
    `;

    const r = await pool.query(q, [schoolId, academicYearId, term, teacherId]);
    return res.json({ data: { scopes: r.rows } });
  } catch (e) {
    console.error("attendance scopes error:", e);
    return res.status(500).json({ message: "فشل تحميل نطاق المعلم" });
  }
}

/* =========================
   REASONS
========================= */
export async function reasons(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const r = await pool.query(
      `SELECT id, name
       FROM attendance_reasons
       WHERE school_id = $1
         AND is_active = TRUE
       ORDER BY id ASC`,
      [schoolId]
    );
    return res.json({ data: r.rows });
  } catch (e) {
    console.error("attendance reasons error:", e);
    return res.status(500).json({ message: "فشل تحميل الأسباب" });
  }
}

/* =========================
   SESSIONS
========================= */

export async function createSession(req, res) {
  const client = await pool.connect();
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const body = req.body || {};
    const ay = toInt(body.academicYearId ?? body.academic_year_id);
    const term = toInt(body.term);

    const dateVal = String(body.date || body.attendance_date || "").slice(0, 10);
    if (!ay || !isValidTerm(term) || !isValidISODate(dateVal)) {
      return res.status(400).json({
        message: "academicYearId و term و date مطلوبة بصيغة صحيحة",
      });
    }

    const dayId = schoolDayIdFromISO(dateVal);
    if (!dayId) {
      return res.status(400).json({ message: "تاريخ غير صالح لتحديد يوم الأسبوع" });
    }

    const sectionId = toInt(body.sectionId ?? body.section_id);
    if (!sectionId) {
      return res.status(400).json({ message: "sectionId مطلوبة" });
    }

    const pidRaw = toInt(body.periodId ?? body.period_id ?? body.lesson);
    if (!pidRaw) {
      return res.status(400).json({ message: "periodId مطلوبة" });
    }

    let subjectId = toInt(body.subjectId ?? body.subject_id) || null;
    let timetableEntryId = toInt(body.timetableEntryId ?? body.timetable_entry_id ?? null);

    const startNow = body.startNow !== false;
    const lessonNoteRaw = body.lessonNote ?? body.lesson_note ?? body.note ?? null;
    const lessonNote = lessonNoteRaw == null ? null : String(lessonNoteRaw).trim() || null;

    await client.query("BEGIN");

    const resolved = await resolvePeriodId(client, schoolId, pidRaw);
    const periodIdResolved = resolved.periodId;
    if (!periodIdResolved) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "رقم/معرّف الحصة غير صحيح (periodId).",
      });
    }

    let hit = null;

    if (timetableEntryId) {
      const q = `
        SELECT
          t.stage_id,
          t.grade_id,
          te.id AS timetable_entry_id,
          te.subject_id,
          te.period_id
        FROM timetable_entries te
        JOIN timetables t
          ON t.id = te.timetable_id
         AND t.school_id = te.school_id
        WHERE te.school_id = $1
          AND te.id = $2
          AND te.teacher_id = $3
          AND t.academic_year_id = $4
          AND t.term = $5
          AND t.section_id = $6
          AND te.day_of_week = $7
        LIMIT 1
      `;
      const r = await client.query(q, [
        schoolId,
        timetableEntryId,
        teacherId,
        ay,
        term,
        sectionId,
        dayId,
      ]);
      if (r.rowCount) hit = r.rows[0];
      else timetableEntryId = null;
    }

    if (!hit && subjectId) {
      const q = `
        SELECT
          t.stage_id,
          t.grade_id,
          te.id AS timetable_entry_id,
          te.subject_id,
          te.period_id
        FROM timetables t
        JOIN timetable_entries te
          ON te.timetable_id = t.id
         AND te.school_id = t.school_id
        LEFT JOIN periods p
          ON p.id = te.period_id
         AND p.school_id = t.school_id
        WHERE t.school_id = $1
          AND t.academic_year_id = $2
          AND t.term = $3
          AND t.section_id = $4
          AND te.teacher_id = $5
          AND te.subject_id = $6
          AND te.day_of_week = $7
          AND (
            te.period_id = $8
            OR p.sort_order = $9
            OR te.period_id IN (SELECT id FROM periods WHERE school_id = $1 AND sort_order = $9)
          )
        LIMIT 1
      `;
      const r = await client.query(q, [
        schoolId,
        ay,
        term,
        sectionId,
        teacherId,
        subjectId,
        dayId,
        periodIdResolved,
        pidRaw,
      ]);
      if (r.rowCount) hit = r.rows[0];
    }

    if (!hit) {
      const q = `
        SELECT
          t.stage_id,
          t.grade_id,
          te.id AS timetable_entry_id,
          te.subject_id,
          te.period_id
        FROM timetables t
        JOIN timetable_entries te
          ON te.timetable_id = t.id
         AND te.school_id = t.school_id
        LEFT JOIN periods p
          ON p.id = te.period_id
         AND p.school_id = t.school_id
        WHERE t.school_id = $1
          AND t.academic_year_id = $2
          AND t.term = $3
          AND t.section_id = $4
          AND te.teacher_id = $5
          AND te.day_of_week = $6
          AND (
            te.period_id = $7
            OR p.sort_order = $8
            OR te.period_id IN (SELECT id FROM periods WHERE school_id = $1 AND sort_order = $8)
          )
        LIMIT 1
      `;
      const r = await client.query(q, [
        schoolId,
        ay,
        term,
        sectionId,
        teacherId,
        dayId,
        periodIdResolved,
        pidRaw,
      ]);
      if (r.rowCount) hit = r.rows[0];
    }

    if (!hit) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "لا يمكنك بدء جلسة خارج نطاق حصصك." });
    }

    const stageId = toInt(hit.stage_id);
    const gradeId = toInt(hit.grade_id);
    const timetableEntryIdFinal = toInt(hit.timetable_entry_id);
    const subjectIdFinal = toInt(hit.subject_id);
    const periodIdFromTT = toInt(hit.period_id);

    if (!stageId || !gradeId || !subjectIdFinal) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "تعذر تحديد (stage/grade/subject) من الجدول.",
      });
    }

    subjectId = subjectIdFinal;
    const periodIdFinal = periodIdFromTT || periodIdResolved;

    const upsertQ = `
      INSERT INTO attendance_sessions
        (school_id, academic_year_id, term, attendance_date, period_id, section_id, subject_id, teacher_id, is_locked)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)
      ON CONFLICT (school_id, teacher_id, academic_year_id, term, attendance_date, period_id, section_id)
      DO UPDATE SET
        subject_id = CASE
          WHEN attendance_sessions.is_locked THEN attendance_sessions.subject_id
          ELSE EXCLUDED.subject_id
        END
      RETURNING id, is_locked, subject_id, period_id
    `;

    const up = await client.query(upsertQ, [
      schoolId,
      ay,
      term,
      dateVal,
      periodIdFinal,
      sectionId,
      subjectId,
      teacherId,
    ]);

    const sessionId = up.rows[0].id;
    const isLocked = !!up.rows[0].is_locked;

    if (isLocked) {
      await client.query("COMMIT");
      return res.json({
        message: "هذه الحصة منتهية ومعتمدة بالفعل — لا يمكن بدءها مرة أخرى.",
        data: {
          sessionId,
          isLocked: true,
          alreadyLocked: true,
          periodId: periodIdFinal,
          date: dateVal,
          sectionId,
          subjectId,
          timetableEntryId: timetableEntryIdFinal,
          stageId,
          gradeId,
        },
      });
    }

    if (startNow) await trySetStartedAt(client, schoolId, sessionId);
    if (lessonNote != null) await trySetLessonNote(client, schoolId, sessionId, lessonNote);

    const hasStageCol = await tableHasColumn(client, "student_enrollments", "stage_id");
    const hasGradeCol = await tableHasColumn(client, "student_enrollments", "grade_id");

  const seedParams = [schoolId, sessionId, ay, sectionId];

let seedWhere = `
  se.school_id::bigint = $1::bigint
  AND se.academic_year_id = $3
  AND se.section_id = $4
`;

if (hasStageCol && stageId) {
  seedParams.push(stageId);
  seedWhere += ` AND se.stage_id = $${seedParams.length}`;
}

if (hasGradeCol && gradeId) {
  seedParams.push(gradeId);
  seedWhere += ` AND se.grade_id = $${seedParams.length}`;
}

const seedQ = `
  INSERT INTO attendance_entries (
    school_id,
    session_id,
    student_id,
    status
  )
  SELECT
    $1::bigint,
    $2::bigint,
    se.student_id::integer,
    'present'
  FROM student_enrollments se
  WHERE ${seedWhere}
  ON CONFLICT (school_id, session_id, student_id) DO NOTHING
`;

await client.query(seedQ, seedParams);
   const countR = await client.query(
  `
  SELECT COUNT(*)::int AS cnt
  FROM attendance_entries
  WHERE school_id = $1::bigint
    AND session_id = $2::bigint
  `,
  [schoolId, sessionId]
);

    await client.query("COMMIT");

    return res.json({
      data: {
        sessionId,
        isLocked: false,
        studentsCount: countR.rows[0]?.cnt ?? 0,
        stageId,
        gradeId,
        periodId: periodIdFinal,
        periodRaw: pidRaw,
        subjectId,
        timetableEntryId: timetableEntryIdFinal,
        _debug: {
          dayId,
          resolvedPeriodSortOrder: resolved.sortOrder ?? null,
          pidResolved: periodIdResolved,
        },
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed in createSession:", rollbackErr);
    }
    console.error("createSession error:", e);
    return res.status(500).json({ message: "خطأ أثناء إنشاء جلسة الحضور" });
  } finally {
    client.release();
  }
}

export async function endAndLockSession(req, res) {
  return lockSession(req, res);
}

export async function getSession(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const r = await pool.query(
      `
      SELECT
        id,
        school_id,
        academic_year_id,
        term,
        attendance_date,
        period_id,
        section_id,
        subject_id,
        teacher_id,
        is_locked
      FROM attendance_sessions
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      LIMIT 1
      `,
      [schoolId, id, teacherId]
    );

    const session = r.rows[0];
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    return res.json({ data: { session } });
  } catch (e) {
    console.error("getSession error:", e);
    return res.status(500).json({ message: "فشل تحميل الجلسة" });
  }
}

export async function updateSession(req, res) {
  const client = await pool.connect();
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const body = req.body || {};
    const noteRaw = body.note ?? body.lessonNote ?? body.notes ?? null;
    const noteVal = noteRaw == null ? null : String(noteRaw).trim();

    await client.query("BEGIN");

    const chk = await client.query(
      `
      SELECT id, is_locked
      FROM attendance_sessions
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      LIMIT 1
      `,
      [schoolId, id, teacherId]
    );

    if (!chk.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    const isLocked = !!chk.rows[0].is_locked;
    if (isLocked) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "الجلسة معتمدة ولا يمكن تعديلها" });
    }

    let updatedNote = false;
    if (noteVal != null) {
      updatedNote = await trySetLessonNote(client, schoolId, id, noteVal || null);
    }

    if (body.startNow === true) {
      await trySetStartedAt(client, schoolId, id);
    }

    if (body.endNow === true || body.ended === true) {
      await client.query(
        `
        UPDATE attendance_sessions
        SET is_locked = TRUE
        WHERE school_id = $1
          AND id = $2
          AND teacher_id = $3
        `,
        [schoolId, id, teacherId]
      );
      await trySetEndedAt(client, schoolId, id);
    }

    await client.query("COMMIT");
    return res.json({ data: { ok: true, updatedNote } });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed in updateSession:", rollbackErr);
    }
    console.error("updateSession error:", e);
    return res.status(500).json({ message: "فشل تحديث الجلسة" });
  } finally {
    client.release();
  }
}

async function applyAdminPermitsToSessionEntries(db, schoolId, sessionId) {
  const sql = `
    WITH sess AS (
      SELECT id, school_id, attendance_date
      FROM attendance_sessions
      WHERE id = $1
        AND school_id = $2
    ),
    perm AS (
      SELECT DISTINCT ON (pr.student_id)
        pr.student_id,
        LOWER(pr.type) AS ptype,
        pr.reason_text AS perm_note,
        pr.status,
        pr.created_at
      FROM permission_requests pr
      JOIN sess s ON true
      JOIN attendance_entries ae
        ON ae.school_id = s.school_id
       AND ae.session_id = s.id
       AND ae.student_id = pr.student_id
      JOIN students stu
        ON stu.id = pr.student_id
       AND stu.school_id = s.school_id
      WHERE pr.school_id = s.school_id
        AND LOWER(pr.status) IN ('approved','accepted','مقبول','معتمد')
        AND pr.request_date = s.attendance_date
      ORDER BY pr.student_id, pr.created_at DESC
    )
    UPDATE attendance_entries ae
    SET
      status = CASE
        WHEN perm.ptype LIKE '%late%' AND ae.status = 'present'
          THEN 'late'
        WHEN perm.ptype LIKE '%absence%'
          THEN 'excused'
        ELSE ae.status
      END,
      note = CASE
        WHEN (ae.note IS NULL OR ae.note = '')
         AND perm.perm_note IS NOT NULL
          THEN '[إذن إلكتروني] ' || perm.perm_note
        ELSE ae.note
      END
    FROM perm
    WHERE ae.school_id = $2
      AND ae.session_id = $1
      AND perm.student_id = ae.student_id;
  `;

  await db.query(sql, [sessionId, schoolId]);
}

export async function lockSession(req, res) {
  const client = await pool.connect();
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    await client.query("BEGIN");

    const sessR = await client.query(
      `
      SELECT id, teacher_id, is_locked, attendance_date
      FROM attendance_sessions
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      LIMIT 1
      `,
      [schoolId, id, teacherId]
    );

    if (!sessR.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    const session = sessR.rows[0];

    if (session.is_locked) {
      await client.query("COMMIT");
      return res.json({ data: { ok: true, alreadyLocked: true } });
    }

    await applyAdminPermitsToSessionEntries(client, schoolId, id);

    await client.query(
      `
      UPDATE attendance_sessions
      SET is_locked = TRUE, locked_at = NOW(), locked_by = $4
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      `,
      [schoolId, id, teacherId, toInt(req.user?.id) || null]
    );

    await trySetEndedAt(client, schoolId, id);

    await client.query("COMMIT");

    try {
      await NotificationAutoService.notifyAttendanceSessionLocked({
        app: req.app,
        attendanceSessionId: id,
      });
    } catch (notifyErr) {
      console.error("Auto notification error (session locked):", notifyErr);
    }

    return res.json({ data: { ok: true } });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed in lockSession:", rollbackErr);
    }
    console.error("lockSession error:", e);
    return res.status(500).json({ message: "فشل اعتماد الجلسة" });
  } finally {
    client.release();
  }
}

export async function unlockSession(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const r = await pool.query(
      `
      UPDATE attendance_sessions
      SET is_locked = FALSE
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      RETURNING id
      `,
      [schoolId, id, teacherId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    return res.json({ data: { ok: true } });
  } catch (e) {
    console.error("unlockSession error:", e);
    return res.status(500).json({ message: "فشل فك الاعتماد" });
  }
}

export async function endSession(req, res) {
  return endAndLockSession(req, res);
}

/* =========================
   ENTRIES
========================= */

async function getLatestCorrectionsMap(dbOrPool, schoolId, sessionId) {
  try {
    const existsR = await dbOrPool.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name='attendance_entry_corrections'
      LIMIT 1
      `
    );
    if (!existsR.rowCount) return new Map();

    const r = await dbOrPool.query(
      `
      SELECT DISTINCT ON (student_id)
        student_id,
        corrected_status,
        corrected_reason_id,
        corrected_late_minutes,
        corrected_note,
        correction_reason,
        corrected_by_user_id,
        created_at
      FROM attendance_entry_corrections
      WHERE school_id = $1
        AND session_id = $2
      ORDER BY student_id, created_at DESC
      `,
      [schoolId, sessionId]
    );

    const m = new Map();
    (r.rows || []).forEach((row) => {
      m.set(String(row.student_id), row);
    });
    return m;
  } catch (e) {
    console.warn("getLatestCorrectionsMap skipped:", e.message || e);
    return new Map();
  }
}

export async function listEntries(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const sessCols = await buildSessionsSelect(pool, "ses", false);
    const sessR = await pool.query(
      `
      SELECT ${sessCols}
      FROM attendance_sessions ses
      LEFT JOIN periods p
        ON p.id = ses.period_id
       AND p.school_id = ses.school_id
      WHERE ses.school_id = $1
        AND ses.id = $2
        AND ses.teacher_id = $3
      LIMIT 1
      `,
      [schoolId, id, teacherId]
    );

    const session = sessR.rows[0];
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    const r = await pool.query(
      `
      SELECT
        s.id,
        s.student_code AS code,
        s.full_name AS name,
        ae.status,
        ae.note,
        ae.reason_id AS "reasonId",
        ae.late_minutes AS "lateMinutes"
      FROM attendance_entries ae
      JOIN students s
        ON s.id = ae.student_id
       AND s.school_id = ae.school_id
      WHERE ae.school_id = $1
        AND ae.session_id = $2
      ORDER BY s.full_name ASC
      `,
      [schoolId, id]
    );

    const corrMap = await getLatestCorrectionsMap(pool, schoolId, id);

    let permitsMap = new Map();
    try {
      const rawDate = new Date(session.attendance_date);
      const localDate = new Date(rawDate.getTime() - rawDate.getTimezoneOffset() * 60000);
      const dateStr = localDate.toISOString().split("T")[0];

      if (dateStr) {
        const permitsRows = await queryPermitsRows({
          schoolId,
          teacherId,
          ay: session.academic_year_id,
          term: session.term,
          statusOverride: null,
          q: { date: dateStr },
        });

        permitsRows.forEach((p) => {
          const pRaw = new Date(p.date);
          const pLocal = new Date(pRaw.getTime() - pRaw.getTimezoneOffset() * 60000);
          const pDateStr = pLocal.toISOString().split("T")[0];

          if (pDateStr === dateStr) {
            permitsMap.set(String(p.student_id), {
              id: p.id,
              type: p.type,
              statusKey: p.status,
              reasonName: p.reason_name,
              lateMinutes: p.late_minutes,
              note: p.note,
            });
          }
        });
      }
    } catch (e) {
      console.warn("Permits fetch error:", e);
    }

    const students = (r.rows || []).map((s) => {
      const sidStr = String(s.id);
      const c = corrMap.get(sidStr);
      const p = permitsMap.get(sidStr);

      let finalStudent = { ...s };

      if (c) {
        finalStudent = {
          ...finalStudent,
          status: c.corrected_status || s.status,
          reasonId: c.corrected_reason_id ?? s.reasonId,
          lateMinutes: c.corrected_late_minutes ?? s.lateMinutes,
          note: c.corrected_note ?? s.note,
          isCorrected: true,
          correctionReason: c.correction_reason,
        };
      }

      if (p) {
        finalStudent.permit = p;

        const st = String(p.statusKey || p.status || "").toUpperCase().trim();
        const tp = String(p.type || "").toUpperCase().trim();

        if (!finalStudent.isCorrected) {
          if (st === "REJECTED") {
            finalStudent.status = "absent";
            finalStudent.reasonId = null;
            finalStudent.lateMinutes = null;
            if (!finalStudent.note) finalStudent.note = "(إذن مرفوض)";
          } else if (st === "APPROVED") {
            if (tp === "LATE") {
              finalStudent.status = "late";
              if (!finalStudent.note) finalStudent.note = "(إذن تأخر مقبول)";
            } else {
              finalStudent.status = "excused";
              finalStudent.reasonId = null;
              finalStudent.lateMinutes = null;
              if (!finalStudent.note) finalStudent.note = "(إذن مقبول)";
            }
          }
        }
      }

      return finalStudent;
    });

    let scope = null;
    try {
      const scR = await pool.query(
        `
        SELECT
          MIN(se.stage_id)::int AS stage_id,
          MIN(st.name) AS stage_name,
          MIN(se.grade_id)::int AS grade_id,
          MIN(g.name) AS grade_name
        FROM attendance_entries ae
        JOIN student_enrollments se
          ON se.student_id = ae.student_id
         AND se.school_id = ae.school_id
         AND se.academic_year_id = $3
        LEFT JOIN stages st
          ON st.id = se.stage_id
         AND st.school_id = se.school_id
        LEFT JOIN grades g
          ON g.id = se.grade_id
         AND g.school_id = se.school_id
        WHERE ae.school_id = $1
          AND ae.session_id = $2
        `,
        [schoolId, id, session.academic_year_id]
      );

      if (scR.rows[0]?.stage_id) {
        scope = {
          stage_id: scR.rows[0].stage_id,
          stage_name: scR.rows[0].stage_name,
          grade_id: scR.rows[0].grade_id,
          grade_name: scR.rows[0].grade_name,
        };
      }
    } catch (scopeErr) {
        console.warn("Scope fetch error:", scopeErr);
    }

    return res.json({
      data: {
        session: { ...session, scope },
        students,
      },
    });
  } catch (e) {
    console.error("listEntries error:", e);
    return res.status(500).json({ message: "فشل تحميل الطلاب" });
  }
}

export async function saveEntries(req, res) {
  const client = await pool.connect();
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries) return res.status(400).json({ message: "entries مطلوبة" });

    await client.query("BEGIN");

    const sessR = await client.query(
      `
      SELECT id, is_locked, attendance_date
      FROM attendance_sessions
      WHERE school_id = $1
        AND id = $2
        AND teacher_id = $3
      LIMIT 1
      `,
      [schoolId, id, teacherId]
    );

    const session = sessR.rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    const correctionReasonRaw =
      req.body?.correctionReason ??
      req.body?.correction_reason ??
      req.body?.reason ??
      null;

    const correctionReason =
      correctionReasonRaw == null ? "" : String(correctionReasonRaw).trim();

    const isCorrectionMode = !!session.is_locked && !!correctionReason;

    if (session.is_locked && !isCorrectionMode) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "الجلسة معتمدة ولا يمكن تعديلها" });
    }

    if (isCorrectionMode) {
      const okTable = await tableExists(client, "attendance_entry_corrections");
      if (!okTable) {
        await client.query("ROLLBACK");
        return res.status(500).json({
          message:
            "ميزة التصحيح غير مفعلة لأن جدول attendance_entry_corrections غير موجود. نفّذ سكربت إنشاء الجدول في قاعدة البيانات أولاً.",
        });
      }

      const correctedByUserId = toInt(req.user?.id) || null;

      if (entries.length > 5) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "التصحيح مسموح لعدد قليل من الطلاب في كل مرة.",
        });
      }

      let saved = 0;

      for (const e of entries) {
        const studentId = toInt(e.studentId);
        const status = String(e.status || "present");
        const note = (e.note == null ? "" : String(e.note)).trim();

        const reasonId =
          e.reasonId == null || e.reasonId === "" ? null : toInt(e.reasonId);
        const lateMinutes =
          e.lateMinutes == null || e.lateMinutes === ""
            ? null
            : toInt(e.lateMinutes);

        if (!studentId) continue;

        if (!isValidStatus(status)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ message: "حالة حضور غير صحيحة" });
        }

        if (status === "late" && (lateMinutes == null || lateMinutes < 1)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "أدخل دقائق التأخر عند اختيار (متأخر).",
          });
        }

        const ins = await client.query(
          `
          INSERT INTO attendance_entry_corrections
            (school_id, session_id, student_id, corrected_status, corrected_reason_id, corrected_late_minutes, corrected_note,
             correction_reason, corrected_by_user_id)
          SELECT
            $1,$2,$3,$4,$5,$6,$7,$8,$9
          WHERE EXISTS (
            SELECT 1
            FROM attendance_entries
            WHERE school_id = $1
              AND session_id = $2
              AND student_id = $3
          )
          RETURNING id
          `,
          [
            schoolId,
            id,
            studentId,
            status,
            reasonId,
            lateMinutes,
            note || null,
            correctionReason,
            correctedByUserId,
          ]
        );

        if (ins.rowCount) saved++;
      }

      await client.query("COMMIT");
      return res.json({ data: { ok: true, corrected: true, saved } });
    }

    for (const e of entries) {
      const studentId = toInt(e.studentId);
      const status = String(e.status || "present");
      const note = (e.note == null ? "" : String(e.note)).trim();

      const reasonId =
        e.reasonId == null || e.reasonId === "" ? null : toInt(e.reasonId);
      const lateMinutes =
        e.lateMinutes == null || e.lateMinutes === ""
          ? null
          : toInt(e.lateMinutes);

      if (!studentId) continue;

      if (!isValidStatus(status)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "حالة حضور غير صحيحة" });
      }

      if (status === "late" && (lateMinutes == null || lateMinutes < 1)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "أدخل دقائق التأخر عند اختيار (متأخر).",
        });
      }

      await client.query(
        `
        UPDATE attendance_entries
        SET
          status = $1,
          note = $2,
          reason_id = $3,
          late_minutes = $4
        WHERE school_id = $5
          AND session_id = $6
          AND student_id = $7
        `,
        [status, note || null, reasonId, lateMinutes, schoolId, id, studentId]
      );
    }

    if (req.body?.lock === true) {
      await applyAdminPermitsToSessionEntries(client, schoolId, id);

      await client.query(
        `
        UPDATE attendance_sessions
        SET is_locked = TRUE, locked_at = NOW(), locked_by = $4
        WHERE school_id = $1
          AND id = $2
          AND teacher_id = $3
        `,
        [schoolId, id, teacherId, toInt(req.user?.id) || null]
      );

      await trySetEndedAt(client, schoolId, id);
    }

    await client.query("COMMIT");

    if (req.body?.lock === true) {
      try {
        await NotificationAutoService.notifyAttendanceSessionLocked({
          app: req.app,
          attendanceSessionId: id,
        });
      } catch (notifyErr) {
        console.error(
          "Auto notification error (session locked via saveEntries):",
          notifyErr
        );
      }
    }

    return res.json({ data: { ok: true } });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
        console.error("Rollback failed in saveEntries:", rollbackErr);
    }
    console.error("saveEntries error:", e);
    return res.status(500).json({ message: "فشل حفظ الحضور" });
  } finally {
    client.release();
  }
}

/* =========================
   HISTORY
========================= */

export async function historySearch(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const q = String(req.query.search || "").trim();
    if (!q) return res.json({ data: { rows: [] } });

    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    const status = String(req.query.status || "").trim();

    const params = [schoolId, teacherId, `%${q}%`];
    let idx = 4;

    let where = `
      WHERE ses.school_id = $1
        AND ses.teacher_id = $2
        AND (s.full_name ILIKE $3 OR s.student_code ILIKE $3)
    `;

    if (from && isValidISODate(from)) {
      where += ` AND ses.attendance_date >= $${idx++}`;
      params.push(from);
    }
    if (to && isValidISODate(to)) {
      where += ` AND ses.attendance_date <= $${idx++}`;
      params.push(to);
    }
    if (status && isValidStatus(status)) {
      where += ` AND ae.status = $${idx++}`;
      params.push(status);
    }

    const sql = `
      SELECT
        s.full_name AS student_name,
        s.student_code,
        ses.attendance_date,
        p.sort_order AS lesson,
        sub.name AS subject_name,
        ae.status,
        ae.late_minutes,
        ar.name AS reason_name,
        ae.note
      FROM attendance_entries ae
      JOIN attendance_sessions ses
        ON ses.id = ae.session_id
       AND ses.school_id = ae.school_id
      JOIN students s
        ON s.id = ae.student_id
       AND s.school_id = ae.school_id
      JOIN periods p
        ON p.id = ses.period_id
       AND p.school_id = ses.school_id
      JOIN subjects sub
        ON sub.id = ses.subject_id
       AND sub.school_id = ses.school_id
      LEFT JOIN attendance_reasons ar
        ON ar.id = ae.reason_id
       AND ar.school_id = ae.school_id
      ${where}
      ORDER BY ses.attendance_date DESC, p.sort_order DESC
      LIMIT 200
    `;

    const r = await pool.query(sql, params);
    return res.json({ data: { rows: r.rows } });
  } catch (e) {
    console.error("attendance history error:", e);
    return res.status(500).json({ message: "فشل كشف الغياب" });
  }
}

/* =========================
   REPORTS
========================= */

export async function reportAggregate(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const ay = toInt(
      req.query.academicYearId ?? req.query.academic_year_id ?? req.query.yearId
    );
    const term = toInt(req.query.term);

    const stageId =
      req.query.stageId == null || req.query.stageId === ""
        ? null
        : toInt(req.query.stageId ?? req.query.stage_id);

    const gradeId =
      req.query.gradeId == null || req.query.gradeId === ""
        ? null
        : toInt(req.query.gradeId ?? req.query.grade_id);

    const sectionId =
      req.query.sectionId == null || req.query.sectionId === ""
        ? null
        : toInt(req.query.sectionId ?? req.query.section_id);

    const subjectId =
      req.query.subjectId == null || req.query.subjectId === ""
        ? null
        : toInt(req.query.subjectId ?? req.query.subject_id);

    const from = String(
      req.query.from ?? req.query.dateFrom ?? req.query.startDate ?? ""
    ).slice(0, 10);
    const to = String(
      req.query.to ?? req.query.dateTo ?? req.query.endDate ?? ""
    ).slice(0, 10);

    const statusRaw = String(req.query.status ?? "").trim().toLowerCase();
    const statusFilter = isValidStatus(statusRaw) ? statusRaw : null;

    if (!ay || !isValidTerm(term)) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }
    if (!from || !to || !isValidISODate(from) || !isValidISODate(to)) {
      return res.status(400).json({ message: "from و to مطلوبة بصيغة YYYY-MM-DD" });
    }

    const hasCorr = await tableExists(pool, "attendance_entry_corrections");
    const corrJoin = hasCorr
      ? `
        LEFT JOIN (
          SELECT DISTINCT ON (session_id, student_id)
            session_id, student_id, corrected_status
          FROM attendance_entry_corrections
          WHERE school_id = $1
          ORDER BY session_id, student_id, created_at DESC
        ) cor ON cor.session_id = ae.session_id AND cor.student_id = ae.student_id
      `
      : "";

    const statusExpr = hasCorr
      ? "COALESCE(cor.corrected_status, ae.status)"
      : "ae.status";

    const params = [schoolId, teacherId, ay, term, from, to];
    let where = `
      WHERE ses.school_id = $1
        AND ses.teacher_id = $2
        AND ses.academic_year_id = $3
        AND ses.term = $4
        AND ses.attendance_date >= $5
        AND ses.attendance_date <= $6
    `;

    if (sectionId) {
      params.push(sectionId);
      where += ` AND ses.section_id = $${params.length} `;
    }
    if (subjectId) {
      params.push(subjectId);
      where += ` AND ses.subject_id = $${params.length} `;
    }
    if (stageId) {
      params.push(stageId);
      where += ` AND se.stage_id = $${params.length} `;
    }
    if (gradeId) {
      params.push(gradeId);
      where += ` AND se.grade_id = $${params.length} `;
    }

    let having = "";
    if (statusFilter) {
      params.push(statusFilter);
      having = `HAVING SUM(CASE WHEN ${statusExpr} = $${params.length} THEN 1 ELSE 0 END) > 0`;
    }

    const sql = `
      SELECT
        s.id,
        s.student_code AS code,
        s.full_name AS name,
        SUM(CASE WHEN ${statusExpr} = 'present' THEN 1 ELSE 0 END)::int AS present,
        SUM(CASE WHEN ${statusExpr} = 'absent' THEN 1 ELSE 0 END)::int AS absent,
        SUM(CASE WHEN ${statusExpr} = 'late' THEN 1 ELSE 0 END)::int AS late,
        SUM(CASE WHEN ${statusExpr} = 'excused' THEN 1 ELSE 0 END)::int AS excused,
        COUNT(*)::int AS total,
        ROUND(
          (
            SUM(CASE WHEN ${statusExpr} IN ('present','excused') THEN 1 ELSE 0 END)::numeric
            / NULLIF(COUNT(*), 0)
          ) * 100,
          1
        ) AS percentage
      FROM attendance_entries ae
      JOIN attendance_sessions ses
        ON ses.id = ae.session_id
       AND ses.school_id = ae.school_id
      JOIN students s
        ON s.id = ae.student_id
       AND s.school_id = ae.school_id
      JOIN student_enrollments se
        ON se.student_id = ae.student_id
       AND se.school_id = ae.school_id
       AND se.academic_year_id = ses.academic_year_id
       AND se.section_id = ses.section_id
      ${corrJoin}
      ${where}
      GROUP BY s.id, s.student_code, s.full_name
      ${having}
      ORDER BY s.full_name ASC
    `;

    const r = await pool.query(sql, params);

    const summary = (r.rows || []).reduce(
      (acc, row) => {
        acc.students += 1;
        acc.present += Number(row.present || 0);
        acc.absent += Number(row.absent || 0);
        acc.late += Number(row.late || 0);
        acc.excused += Number(row.excused || 0);
        acc.total += Number(row.total || 0);
        return acc;
      },
      { students: 0, present: 0, absent: 0, late: 0, excused: 0, total: 0 }
    );

    return res.json({ data: { rows: r.rows, summary } });
  } catch (e) {
    console.error("reportAggregate error:", e);
    return res.status(500).json({ message: "فشل توليد تقرير الغياب" });
  }
}

/* =========================
   QR SCAN
========================= */

const __STU_COL_CACHE = new Map();
async function getStudentsCols(db) {
  if (__STU_COL_CACHE.has("students")) return __STU_COL_CACHE.get("students");
  const set = await getTableColumnsSet(db, "students");
  __STU_COL_CACHE.set("students", set);
  return set;
}

function b64urlToJson(part) {
  const s = String(part || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(part || "").length / 4) * 4, "=");

  return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
}

function parseScanToken(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;

  const jwt = t.startsWith("SS:") ? t.slice(3).trim() : t;
  const pieces = jwt.split(".");
  if (pieces.length < 2) return null;

  try {
    const payload = b64urlToJson(pieces[1]);

    const studentId =
      Number(payload.studentId) ||
      Number(payload.student_id) ||
      Number(payload.sid) ||
      null;

    const userId =
      Number(payload.userId) ||
      Number(payload.user_id) ||
      Number(payload.id) ||
      Number(payload.sub) ||
      null;

    if (studentId && studentId > 0) return { studentId };
    if (userId && userId > 0) return { userId };

    return null;
  } catch {
    return null;
  }
}

async function getSessionForTeacher(db, schoolId, sessionId, teacherId) {
  const r = await db.query(
    `
    SELECT id, school_id, teacher_id, academic_year_id, term, attendance_date, section_id, subject_id, is_locked
    FROM attendance_sessions
    WHERE school_id = $1
      AND id = $2
      AND teacher_id = $3
    LIMIT 1
    `,
    [schoolId, sessionId, teacherId]
  );
  return r.rows[0] || null;
}

async function studentBelongsToSessionScope(db, studentId, session) {
  const hasEnroll = await tableExists(db, "student_enrollments");
  if (hasEnroll) {
    const q = `
      SELECT 1
      FROM student_enrollments se
      WHERE se.school_id = $1
        AND se.student_id = $2
        AND se.academic_year_id = $3
        AND se.section_id = $4
      LIMIT 1
    `;
    const r = await db.query(q, [
      session.school_id,
      studentId,
      session.academic_year_id,
      session.section_id,
    ]);
    return !!r.rowCount;
  }

  const cols = await getStudentsCols(db);
  const secCol = pickCol(cols, ["section_id", "current_section_id"]);
  if (!secCol) return true;

  const r2 = await db.query(
    `SELECT 1 FROM students WHERE school_id = $1 AND id = $2 AND ${secCol} = $3 LIMIT 1`,
    [session.school_id, studentId, session.section_id]
  );
  return !!r2.rowCount;
}

export async function scanMarkPresentByToken(req, res) {
  const client = await pool.connect();
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await assertTeacher(req);
    if (!schoolId || !teacherId) {
      return res.status(403).json({ message: "حسابك ليس معلّمًا" });
    }

    const sessionId = toInt(req.params.id);
    if (!sessionId) {
      return res.status(400).json({ message: "session id غير صحيح" });
    }

    const token = String(req.body?.token || "").trim();
    const parsed = parseScanToken(token);
    if (!parsed) {
      return res.status(400).json({ message: "QR غير صالح" });
    }

    await client.query("BEGIN");

    const session = await getSessionForTeacher(client, schoolId, sessionId, teacherId);
    if (!session) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    if (session.is_locked) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "الجلسة مقفلة ولا يمكن التسجيل" });
    }

    let studentId = parsed.studentId || null;

    if (!studentId && parsed.userId) {
      const rr = await client.query(
        `
        SELECT id
        FROM students
        WHERE school_id = $1
          AND user_id = $2
        LIMIT 1
        `,
        [schoolId, parsed.userId]
      );
      studentId = rr.rows[0]?.id || null;
    }

    if (!studentId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "QR غير صالح" });
    }

    const okScope = await studentBelongsToSessionScope(client, studentId, session);
    if (!okScope) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "هذا الطالب ليس ضمن شعبة الجلسة الحالية" });
    }

    const entryUpsertR = await client.query(
      `
      INSERT INTO attendance_entries (school_id, session_id, student_id, status, note)
      VALUES ($1, $2, $3, 'present', '[QR] تم تسجيل الحضور عبر المسح')
      ON CONFLICT (school_id, session_id, student_id)
      DO UPDATE SET
        status = 'present',
        note = CASE
          WHEN attendance_entries.note IS NULL OR attendance_entries.note = ''
            THEN '[QR] تم تسجيل الحضور عبر المسح'
          ELSE attendance_entries.note
        END
      RETURNING id
      `,
      [schoolId, sessionId, studentId]
    );

    const savedEntry = entryUpsertR.rows[0];

    const stuCols = await getStudentsCols(client);
    const nameCol = pickCol(stuCols, ["full_name", "name", "student_name"]);
    const codeCol = pickCol(stuCols, [
      "student_code",
      "code",
      "student_no",
      "student_number",
      "number",
    ]);

    const selName = nameCol ? `s.${nameCol}::text AS full_name` : `'طالب'::text AS full_name`;
    const selCode = codeCol ? `s.${codeCol}::text AS student_code` : `NULL::text AS student_code`;

    const stuR = await client.query(
      `
      SELECT s.id, ${selName}, ${selCode}
      FROM students s
      WHERE s.school_id = $1
        AND s.id = $2
      LIMIT 1
      `,
      [schoolId, studentId]
    );

    await client.query("COMMIT");

    try {
      await NotificationAutoService.notifyStudentAttendanceByEntryId({
        app: req.app,
        attendanceEntryId: savedEntry.id,
        includeStudent: false,
        includeAdmins: true,
      });
    } catch (notifyErr) {
      console.error("Auto notification error (attendance scan):", notifyErr);
    }

    const stu = stuR.rows[0] || {
      id: studentId,
      full_name: "طالب",
      student_code: null,
    };

    return res.json({
      message: "تم تسجيل الحضور بنجاح",
      student: {
        id: stu.id,
        full_name: stu.full_name,
        student_code: stu.student_code,
      },
      session: { id: sessionId },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed in scanMarkPresentByToken:", rollbackErr);
    }
    console.error("scanMarkPresentByToken error:", e);
    return res.status(500).json({ message: "فشل تسجيل الحضور بالمسح" });
  } finally {
    client.release();
  }
}

export const TeacherAttendanceController = {
  meta,
  scopes,
  reasons,
  createSession,
  getSession,
  updateSession,
  lockSession,
  unlockSession,
  endSession,
  endAndLockSession,
  listEntries,
  saveEntries,
  historySearch,
  sessionSlots,
  reportAggregate,
  permitsList,
  permitsApproved,
  permitsExcuses,
  permitsMap,
  scanMarkPresentByToken,
};