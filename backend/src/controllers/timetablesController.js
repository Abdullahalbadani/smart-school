// src/controllers/timetablesController.js
import { pool } from "../config/db.js";
import WorkflowNotifications from "../modules/notifications/workflowNotificationService.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normRoom(s) {
  const t = String(s || "").trim();
  return t ? t.toLowerCase() : null;
}

function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function addDaysISO(isoDate, days) {
  const d = new Date(String(isoDate).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 1=السبت ... 7=الجمعة
function isoDateToDayId(isoDate) {
  const d = new Date(String(isoDate).slice(0, 10) + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=الأحد ... 6=السبت
  if (dow === 6) return 1; // السبت
  return dow + 2; // الأحد=2 ... الجمعة=7
}
async function getDefaultOverrideExamTotal(client, schoolId, examKind) {
  const kind = String(examKind || "monthly").trim();

  if (kind !== "monthly") {
    return null;
  }

  const r = await client.query(
    `
    SELECT monthly_exam_max_grade
    FROM school_settings
    WHERE school_id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  return toInt(r.rows[0]?.monthly_exam_max_grade);
}
function arabicDayNameFromId(dayId) {
  const map = {
    1: "السبت",
    2: "الأحد",
    3: "الاثنين",
    4: "الثلاثاء",
    5: "الأربعاء",
    6: "الخميس",
    7: "الجمعة",
  };
  return map[Number(dayId)] || "غير معروف";
}

// ✅ فلترة status في section_subject_teachers بشكل مرن
function isSstStatusOkSql(alias = "sst") {
  return `(${alias}.status IS NULL OR (${alias}.status::text) NOT IN ('inactive','disabled','deleted'))`;
}

function decorateConflictRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    day_name:
      row.day_name ||
      arabicDayNameFromId(row.day_of_week || (row.date ? isoDateToDayId(row.date) : null)),
    period_name: row.period_name || (row.period_id ? `الحصة ${row.period_id}` : "حصة غير معروفة"),
  }));
}

function buildValuesSqlAndParams(clean) {
  const valuesSql = clean
    .map(
      (_, i) =>
        `($${i * 5 + 1}::smallint, $${i * 5 + 2}::int, $${i * 5 + 3}::int, $${i * 5 + 4}::text, $${i * 5 + 5}::text)`
    )
    .join(",");

  const params = [];
  clean.forEach((x) => {
    params.push(x.day, x.periodId, x.teacherId, x.room, x.room_norm);
  });

  return { valuesSql, params };
}

function buildOverrideValuesSqlAndParams(clean) {
  const valuesSql = clean
    .map(
      (_, i) =>
        `($${i * 5 + 1}::date, $${i * 5 + 2}::int, $${i * 5 + 3}::int, $${i * 5 + 4}::text, $${i * 5 + 5}::text)`
    )
    .join(",");

  const params = [];
  clean.forEach((x) => {
    params.push(x.date, x.periodId, x.teacherId, x.room, x.room_norm);
  });

  return { valuesSql, params };
}

async function ensureTeacherAssignedForSection(client, tt, subjectId, teacherId, schoolId) {
  const allowedQ = await client.query(
    `
    SELECT 1
    FROM section_subject_teachers sst
    JOIN teacher_subjects ts
      ON ts.teacher_id = sst.teacher_id
     AND ts.subject_id = sst.subject_id
     AND ts.is_active = true
    JOIN teachers t ON t.id = sst.teacher_id
    WHERE sst.school_id = $1::int
      AND sst.academic_year_id = $2::int
      AND sst.term = $3::int
      AND sst.section_id = $4::int
      AND sst.subject_id = $5::int
      AND sst.teacher_id = $6::int
      AND t.is_active = true
      AND ${isSstStatusOkSql("sst")}
    LIMIT 1
    `,
    [schoolId, tt.academic_year_id, tt.term, tt.section_id, subjectId, teacherId]
  );

  return allowedQ.rows.length > 0;
}

async function runConflictsCheck(client, tt, clean, schoolId) {
  if (!clean.length) return { teacher: [], room: [] };

  const { valuesSql, params } = buildValuesSqlAndParams(clean);

  // تعارض معلم مع جداول منشورة أخرى
  const teacherConf = await client.query(
    `
    WITH inp(day_of_week, period_id, teacher_id, room, room_norm) AS (VALUES ${valuesSql})
    SELECT DISTINCT
           inp.day_of_week,
           inp.period_id,
           inp.teacher_id,
           t2.full_name AS teacher_name,
           te2.subject_id,
           s2.name AS subject_name,
           tt2.stage_id,
           st.name AS stage_name,
           tt2.grade_id,
           gr.name AS grade_name,
           tt2.section_id,
           sc.name AS section_name,
           tt2.id AS other_timetable_id,
           p2.name AS period_name
    FROM inp
    JOIN timetable_entries te2
      ON te2.teacher_id = inp.teacher_id
     AND te2.day_of_week = inp.day_of_week
     AND te2.period_id = inp.period_id
    JOIN timetables tt2 ON tt2.id = te2.timetable_id
    JOIN teachers t2 ON t2.id = te2.teacher_id
    LEFT JOIN subjects s2 ON s2.id = te2.subject_id
    LEFT JOIN stages st ON st.id = tt2.stage_id
    LEFT JOIN grades gr ON gr.id = tt2.grade_id
    LEFT JOIN sections sc ON sc.id = tt2.section_id
    LEFT JOIN periods p2 ON p2.id = te2.period_id
    WHERE tt2.school_id = $${params.length + 1}
      AND tt2.academic_year_id = $${params.length + 2}
      AND tt2.term = $${params.length + 3}
      AND tt2.status = 'published'
      AND tt2.id <> $${params.length + 4}
    LIMIT 50
    `,
    [...params, schoolId, tt.academic_year_id, tt.term, tt.id]
  );

  if (teacherConf.rows.length) {
    return { teacher: decorateConflictRows(teacherConf.rows), room: [] };
  }

  // تعارض قاعة مع جداول منشورة أخرى
  const roomConf = await client.query(
    `
    WITH inp(day_of_week, period_id, teacher_id, room, room_norm) AS (VALUES ${valuesSql})
    SELECT DISTINCT
           inp.day_of_week,
           inp.period_id,
           inp.room,
           te2.room AS other_room,
           te2.teacher_id,
           t2.full_name AS teacher_name,
           te2.subject_id,
           s2.name AS subject_name,
           tt2.stage_id,
           st.name AS stage_name,
           tt2.grade_id,
           gr.name AS grade_name,
           tt2.section_id,
           sc.name AS section_name,
           tt2.id AS other_timetable_id,
           p2.name AS period_name
    FROM inp
    JOIN timetable_entries te2
      ON lower(coalesce(te2.room,'')) = lower(coalesce(inp.room,''))
     AND te2.day_of_week = inp.day_of_week
     AND te2.period_id = inp.period_id
    JOIN timetables tt2 ON tt2.id = te2.timetable_id
    LEFT JOIN teachers t2 ON t2.id = te2.teacher_id
    LEFT JOIN subjects s2 ON s2.id = te2.subject_id
    LEFT JOIN stages st ON st.id = tt2.stage_id
    LEFT JOIN grades gr ON gr.id = tt2.grade_id
    LEFT JOIN sections sc ON sc.id = tt2.section_id
    LEFT JOIN periods p2 ON p2.id = te2.period_id
    WHERE inp.room_norm IS NOT NULL
      AND tt2.school_id = $${params.length + 1}
      AND tt2.academic_year_id = $${params.length + 2}
      AND tt2.term = $${params.length + 3}
      AND tt2.status = 'published'
      AND tt2.id <> $${params.length + 4}
    LIMIT 50
    `,
    [...params, schoolId, tt.academic_year_id, tt.term, tt.id]
  );

  return { teacher: [], room: decorateConflictRows(roomConf.rows) };
}

async function runOverridesConflictsCheck(client, tt, clean, schoolId) {
  if (!clean.length) return { teacher: [], room: [] };

  const { valuesSql, params } = buildOverrideValuesSqlAndParams(clean);

  // تعارض معلم ضد overrides منشورة أخرى
  const teacherConf = await client.query(
    `
    WITH inp(date, period_id, teacher_id, room, room_norm) AS (VALUES ${valuesSql})
    SELECT DISTINCT
           inp.date,
           o2.day_of_week,
           inp.period_id,
           inp.teacher_id,
           t2.full_name AS teacher_name,
           o2.subject_id,
           s2.name AS subject_name,
           tt2.stage_id,
           st.name AS stage_name,
           tt2.grade_id,
           gr.name AS grade_name,
           tt2.section_id,
           sc.name AS section_name,
           o2.timetable_id AS other_timetable_id,
           p2.name AS period_name
    FROM inp
    JOIN timetable_overrides o2
      ON o2.teacher_id = inp.teacher_id
     AND o2.date = inp.date
     AND o2.period_id = inp.period_id
    JOIN timetables tt2 ON tt2.id = o2.timetable_id
    JOIN teachers t2 ON t2.id = o2.teacher_id
    LEFT JOIN subjects s2 ON s2.id = o2.subject_id
    LEFT JOIN stages st ON st.id = tt2.stage_id
    LEFT JOIN grades gr ON gr.id = tt2.grade_id
    LEFT JOIN sections sc ON sc.id = tt2.section_id
    LEFT JOIN periods p2 ON p2.id = o2.period_id
    WHERE tt2.school_id = $${params.length + 1}
      AND tt2.academic_year_id = $${params.length + 2}
      AND tt2.term = $${params.length + 3}
      AND tt2.status = 'published'
      AND tt2.id <> $${params.length + 4}
    LIMIT 50
    `,
    [...params, schoolId, tt.academic_year_id, tt.term, tt.id]
  );

  if (teacherConf.rows.length) {
    return { teacher: decorateConflictRows(teacherConf.rows), room: [] };
  }

  // تعارض قاعة ضد overrides منشورة أخرى
  const roomConf = await client.query(
    `
    WITH inp(date, period_id, teacher_id, room, room_norm) AS (VALUES ${valuesSql})
    SELECT DISTINCT
           inp.date,
           o2.day_of_week,
           inp.period_id,
           inp.room,
           o2.room AS other_room,
           o2.teacher_id,
           t2.full_name AS teacher_name,
           o2.subject_id,
           s2.name AS subject_name,
           tt2.stage_id,
           st.name AS stage_name,
           tt2.grade_id,
           gr.name AS grade_name,
           tt2.section_id,
           sc.name AS section_name,
           o2.timetable_id AS other_timetable_id,
           p2.name AS period_name
    FROM inp
    JOIN timetable_overrides o2
      ON lower(coalesce(o2.room,'')) = lower(coalesce(inp.room,''))
     AND o2.date = inp.date
     AND o2.period_id = inp.period_id
    JOIN timetables tt2 ON tt2.id = o2.timetable_id
    LEFT JOIN teachers t2 ON t2.id = o2.teacher_id
    LEFT JOIN subjects s2 ON s2.id = o2.subject_id
    LEFT JOIN stages st ON st.id = tt2.stage_id
    LEFT JOIN grades gr ON gr.id = tt2.grade_id
    LEFT JOIN sections sc ON sc.id = tt2.section_id
    LEFT JOIN periods p2 ON p2.id = o2.period_id
    WHERE inp.room_norm IS NOT NULL
      AND tt2.school_id = $${params.length + 1}
      AND tt2.academic_year_id = $${params.length + 2}
      AND tt2.term = $${params.length + 3}
      AND tt2.status = 'published'
      AND tt2.id <> $${params.length + 4}
    LIMIT 50
    `,
    [...params, schoolId, tt.academic_year_id, tt.term, tt.id]
  );

  return { teacher: [], room: decorateConflictRows(roomConf.rows) };
}

export const TimetablesController = {
  // =========================================================
  // GET /api/timetables/check-teacher-conflict
  // =========================================================
  async checkTeacherConflict(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const teacherId = toInt(req.query.teacherId);
      const academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      const periodId = toInt(req.query.periodId);
      const dayId = toInt(req.query.dayId);
      const date = String(req.query.date || "").trim();
      const excludeTimetableId = toInt(req.query.excludeTimetableId);

      if (!teacherId) {
        return res.status(400).json({ message: "teacherId مطلوب" });
      }
      if (!academicYearId) {
        return res.status(400).json({ message: "academicYearId مطلوب" });
      }
      if (!periodId) {
        return res.status(400).json({ message: "periodId مطلوب" });
      }

      // 1) لو يوجد تاريخ: افحص overrides أولاً
      if (date) {
        if (!isValidISODate(date)) {
          return res.status(400).json({ message: "date غير صحيح" });
        }

        const overQ = await pool.query(
          `
          SELECT
            o.date,
            o.day_of_week,
            o.period_id,
            o.teacher_id,
            t.full_name AS teacher_name,
            o.subject_id,
            s.name AS subject_name,
            tt.stage_id,
            st.name AS stage_name,
            tt.grade_id,
            gr.name AS grade_name,
            tt.section_id,
            sc.name AS section_name,
            tt.id AS other_timetable_id,
            p.name AS period_name
          FROM timetable_overrides o
          JOIN timetables tt ON tt.id = o.timetable_id
          JOIN teachers t ON t.id = o.teacher_id
          LEFT JOIN subjects s ON s.id = o.subject_id
          LEFT JOIN stages st ON st.id = tt.stage_id
          LEFT JOIN grades gr ON gr.id = tt.grade_id
          LEFT JOIN sections sc ON sc.id = tt.section_id
          LEFT JOIN periods p ON p.id = o.period_id
          WHERE tt.school_id = $1
            AND o.teacher_id = $2
            AND o.date = $3::date
            AND o.period_id = $4
            AND tt.academic_year_id = $5
            AND tt.term = $6
            AND tt.status = 'published'
            AND ($7::int IS NULL OR tt.id <> $7)
          LIMIT 1
          `,
          [schoolId, teacherId, date, periodId, academicYearId, term, excludeTimetableId]
        );

        if (overQ.rows.length) {
          const row = overQ.rows[0];
          const dayName = arabicDayNameFromId(row.day_of_week);

          return res.json({
            data: {
              hasConflict: true,
              date: row.date,
              day_of_week: row.day_of_week,
              day_name: dayName,
              period_id: row.period_id,
              period_name: row.period_name || `الحصة ${row.period_id}`,
              teacher_id: row.teacher_id,
              teacher_name: row.teacher_name,
              subject_id: row.subject_id,
              subject_name: row.subject_name,
              stage_id: row.stage_id,
              stage_name: row.stage_name,
              grade_id: row.grade_id,
              grade_name: row.grade_name,
              section_id: row.section_id,
              section_name: row.section_name,
              other_timetable_id: row.other_timetable_id,
              message: `${row.teacher_name || "هذا المعلم"} لديه حصة بالفعل في ${row.stage_name || "مرحلة"} / ${row.grade_name || "صف"} / ${row.section_name || "شعبة"} — ${dayName} / ${row.period_name || `الحصة ${row.period_id}`} بتاريخ ${String(row.date).slice(0, 10)}.`,
            },
          });
        }

        // 2) إذا لا يوجد override: افحص القالب الأسبوعي
        const effectiveDayId = dayId || isoDateToDayId(date);

        const tplQ = await pool.query(
          `
          SELECT
            te.day_of_week,
            te.period_id,
            te.teacher_id,
            t.full_name AS teacher_name,
            te.subject_id,
            s.name AS subject_name,
            tt.stage_id,
            st.name AS stage_name,
            tt.grade_id,
            gr.name AS grade_name,
            tt.section_id,
            sc.name AS section_name,
            tt.id AS other_timetable_id,
            p.name AS period_name
          FROM timetable_entries te
          JOIN timetables tt ON tt.id = te.timetable_id
          JOIN teachers t ON t.id = te.teacher_id
          LEFT JOIN subjects s ON s.id = te.subject_id
          LEFT JOIN stages st ON st.id = tt.stage_id
          LEFT JOIN grades gr ON gr.id = tt.grade_id
          LEFT JOIN sections sc ON sc.id = tt.section_id
          LEFT JOIN periods p ON p.id = te.period_id
          WHERE tt.school_id = $1
            AND te.teacher_id = $2
            AND te.day_of_week = $3
            AND te.period_id = $4
            AND tt.academic_year_id = $5
            AND tt.term = $6
            AND tt.status = 'published'
            AND ($7::int IS NULL OR tt.id <> $7)
          LIMIT 1
          `,
          [schoolId, teacherId, effectiveDayId, periodId, academicYearId, term, excludeTimetableId]
        );

        if (tplQ.rows.length) {
          const row = tplQ.rows[0];
          const dayName = arabicDayNameFromId(row.day_of_week);

          return res.json({
            data: {
              hasConflict: true,
              date,
              day_of_week: row.day_of_week,
              day_name: dayName,
              period_id: row.period_id,
              period_name: row.period_name || `الحصة ${row.period_id}`,
              teacher_id: row.teacher_id,
              teacher_name: row.teacher_name,
              subject_id: row.subject_id,
              subject_name: row.subject_name,
              stage_id: row.stage_id,
              stage_name: row.stage_name,
              grade_id: row.grade_id,
              grade_name: row.grade_name,
              section_id: row.section_id,
              section_name: row.section_name,
              other_timetable_id: row.other_timetable_id,
              message: `${row.teacher_name || "هذا المعلم"} لديه حصة بالفعل في ${row.stage_name || "مرحلة"} / ${row.grade_name || "صف"} / ${row.section_name || "شعبة"} — ${dayName} / ${row.period_name || `الحصة ${row.period_id}`}.`,
            },
          });
        }

        return res.json({ data: { hasConflict: false } });
      }

      // 3) فحص القالب فقط إذا لم يرسل تاريخ
      if (!dayId) {
        return res.status(400).json({ message: "dayId مطلوب عند عدم إرسال date" });
      }

      const q = await pool.query(
        `
        SELECT
          te.day_of_week,
          te.period_id,
          te.teacher_id,
          t.full_name AS teacher_name,
          te.subject_id,
          s.name AS subject_name,
          tt.stage_id,
          st.name AS stage_name,
          tt.grade_id,
          gr.name AS grade_name,
          tt.section_id,
          sc.name AS section_name,
          tt.id AS other_timetable_id,
          p.name AS period_name
        FROM timetable_entries te
        JOIN timetables tt ON tt.id = te.timetable_id
        JOIN teachers t ON t.id = te.teacher_id
        LEFT JOIN subjects s ON s.id = te.subject_id
        LEFT JOIN stages st ON st.id = tt.stage_id
        LEFT JOIN grades gr ON gr.id = tt.grade_id
        LEFT JOIN sections sc ON sc.id = tt.section_id
        LEFT JOIN periods p ON p.id = te.period_id
        WHERE tt.school_id = $1
          AND te.teacher_id = $2
          AND te.day_of_week = $3
          AND te.period_id = $4
          AND tt.academic_year_id = $5
          AND tt.term = $6
          AND tt.status = 'published'
          AND ($7::int IS NULL OR tt.id <> $7)
        LIMIT 1
        `,
        [schoolId, teacherId, dayId, periodId, academicYearId, term, excludeTimetableId]
      );

      if (q.rows.length) {
        const row = q.rows[0];
        const dayName = arabicDayNameFromId(row.day_of_week);

        return res.json({
          data: {
            hasConflict: true,
            day_of_week: row.day_of_week,
            day_name: dayName,
            period_id: row.period_id,
            period_name: row.period_name || `الحصة ${row.period_id}`,
            teacher_id: row.teacher_id,
            teacher_name: row.teacher_name,
            subject_id: row.subject_id,
            subject_name: row.subject_name,
            stage_id: row.stage_id,
            stage_name: row.stage_name,
            grade_id: row.grade_id,
            grade_name: row.grade_name,
            section_id: row.section_id,
            section_name: row.section_name,
            other_timetable_id: row.other_timetable_id,
            message: `${row.teacher_name || "هذا المعلم"} لديه حصة بالفعل في ${row.stage_name || "مرحلة"} / ${row.grade_name || "صف"} / ${row.section_name || "شعبة"} — ${dayName} / ${row.period_name || `الحصة ${row.period_id}`}.`,
          },
        });
      }

      return res.json({ data: { hasConflict: false } });
    } catch (e) {
      console.error("checkTeacherConflict error:", e);
      return res.status(500).json({ message: "خطأ في فحص تعارض المعلم" });
    }
  },

  // ============================================================
  // GET /api/timetables/teachers?subjectId=..&academicYearId=..&term=..&sectionId=..
  // ============================================================
  async teachersBySubject(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const subjectId = toInt(req.query.subjectId);
      const academicYearId = toInt(req.query.academicYearId);
      const sectionId = toInt(req.query.sectionId);
      const term = toInt(req.query.term) || 1;

      if (!subjectId) return res.json({ data: [] });

      if (academicYearId && sectionId) {
        const r = await pool.query(
          `
          SELECT DISTINCT t.id, t.full_name AS name
          FROM section_subject_teachers sst
          JOIN teachers t ON t.id = sst.teacher_id
          JOIN teacher_subjects ts
            ON ts.teacher_id = sst.teacher_id
           AND ts.subject_id = sst.subject_id
           AND ts.is_active = true
          WHERE sst.school_id = $1::int
            AND sst.academic_year_id = $2::int
            AND sst.term = $3::int
            AND sst.section_id = $4::int
            AND sst.subject_id = $5::int
            AND t.is_active = true
            AND ${isSstStatusOkSql("sst")}
          ORDER BY t.full_name, t.id
          `,
          [schoolId, academicYearId, term, sectionId, subjectId]
        );

        return res.json({ data: r.rows, mode: "assigned" });
      }

      const r2 = await pool.query(
        `
        SELECT t.id, t.full_name AS name
        FROM teacher_subjects ts
        JOIN teachers t ON t.id = ts.teacher_id
        WHERE ts.school_id = $1::int
          AND ts.subject_id = $2::int
          AND ts.is_active = true
          AND t.is_active = true
        ORDER BY t.full_name, t.id
        `,
        [schoolId, subjectId]
      );

      return res.json({ data: r2.rows, mode: "qualified_only" });
    } catch (e) {
      console.error("teachersBySubject error:", e);
      return res.status(500).json({ message: "خطأ في تحميل معلمي المادة" });
    }
  },

  // =========================
  // GET /api/timetables/meta
  // =========================
  async meta(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const [years, stages, grades, sections, subjects, teachers, periods] =
        await Promise.all([
          pool.query("SELECT id, name FROM academic_years WHERE school_id = $1 ORDER BY id DESC", [schoolId]),
          pool.query("SELECT id, name FROM stages WHERE school_id = $1 ORDER BY id", [schoolId]),
          pool.query("SELECT id, stage_id, name FROM grades WHERE school_id = $1 ORDER BY stage_id, id", [schoolId]),
          pool.query("SELECT id, grade_id, name FROM sections WHERE school_id = $1 ORDER BY grade_id, id", [schoolId]),
          pool.query("SELECT id, name FROM subjects WHERE school_id = $1 AND is_active=true ORDER BY name", [schoolId]),
          pool.query("SELECT id, full_name AS name FROM teachers WHERE school_id = $1 AND is_active=true ORDER BY full_name", [schoolId]),
          pool.query("SELECT id, name, start_time, end_time, sort_order FROM periods WHERE school_id = $1 ORDER BY sort_order", [schoolId]),
        ]);

      const days = [
        { id: 1, name: "السبت" },
        { id: 2, name: "الأحد" },
        { id: 3, name: "الاثنين" },
        { id: 4, name: "الثلاثاء" },
        { id: 5, name: "الأربعاء" },
        { id: 6, name: "الخميس" },
        { id: 7, name: "الجمعة" },
      ];

      return res.json({
        data: {
          years: years.rows,
          stages: stages.rows,
          grades: grades.rows,
          sections: sections.rows,
          subjects: subjects.rows,
          teachers: teachers.rows,
          periods: periods.rows,
          days,
        },
      });
    } catch (e) {
      console.error("timetables meta error:", e);
      return res.status(500).json({ message: "خطأ في تحميل بيانات الجدول" });
    }
  },

  // =========================
  // GET /api/timetables/list
  // =========================
  async list(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const academicYearId = toInt(req.query.academicYearId);
      const term = toInt(req.query.term) || 1;
      const stageId = toInt(req.query.stageId);
      const gradeId = toInt(req.query.gradeId);
      const sectionId = toInt(req.query.sectionId);

      if (!academicYearId) {
        return res.status(400).json({ message: "academicYearId مطلوب" });
      }

      const wh = ["tt.school_id = $1", "tt.academic_year_id = $2", "tt.term = $3"];
      const params = [schoolId, academicYearId, term];
      let idx = 4;

      if (stageId) {
        wh.push(`tt.stage_id = $${idx++}`);
        params.push(stageId);
      }
      if (gradeId) {
        wh.push(`tt.grade_id = $${idx++}`);
        params.push(gradeId);
      }
      if (sectionId) {
        wh.push(`tt.section_id = $${idx++}`);
        params.push(sectionId);
      }

      const q = `
        SELECT
          tt.id, tt.academic_year_id, ay.name AS year_name,
          tt.term,
          tt.stage_id, st.name AS stage_name,
          tt.grade_id, gr.name AS grade_name,
          tt.section_id, sc.name AS section_name,
          tt.status,
          (SELECT COUNT(*)::int FROM timetable_entries te WHERE te.timetable_id = tt.id) AS entries_count,
          tt.updated_at
        FROM timetables tt
        JOIN academic_years ay ON ay.id = tt.academic_year_id
        JOIN stages st ON st.id = tt.stage_id
        JOIN grades gr ON gr.id = tt.grade_id
        JOIN sections sc ON sc.id = tt.section_id
        WHERE ${wh.join(" AND ")}
        ORDER BY tt.id DESC
        LIMIT 300
      `;

      const rows = await pool.query(q, params);
      return res.json({ data: rows.rows });
    } catch (e) {
      console.error("timetables list error:", e);
      return res.status(500).json({ message: "خطأ في جلب قائمة الجداول" });
    }
  },

  // ==================================
  // POST /api/timetables/get-or-create
  // ==================================
  async getOrCreate(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const academicYearId = toInt(req.body.academicYearId);
      const stageId = toInt(req.body.stageId);
      const gradeId = toInt(req.body.gradeId);
      const sectionId = toInt(req.body.sectionId);
      const term = toInt(req.body.term) || 1;

      if (!academicYearId || !stageId || !gradeId || !sectionId) {
        return res.status(400).json({ message: "بيانات ناقصة" });
      }

      const found = await pool.query(
        `
        SELECT * FROM timetables
        WHERE school_id=$1 AND academic_year_id=$2 AND stage_id=$3 AND grade_id=$4 AND section_id=$5 AND term=$6
        `,
        [schoolId, academicYearId, stageId, gradeId, sectionId, term]
      );

      if (found.rows.length) {
        return res.json({ data: found.rows[0] });
      }

      const created = await pool.query(
        `
        INSERT INTO timetables (school_id, academic_year_id, stage_id, grade_id, section_id, term, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
        RETURNING *
        `,
        [schoolId, academicYearId, stageId, gradeId, sectionId, term, req.user?.id || null]
      );

      return res.json({ data: created.rows[0] });
    } catch (e) {
      console.error("getOrCreate error:", e);
      return res.status(500).json({ message: "خطأ في إنشاء/جلب جدول الشعبة" });
    }
  },

  // =====================
  // GET /api/timetables/:id
  // =====================
  async getById(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const id = toInt(req.params.id);
      if (!id) return res.status(400).json({ message: "id غير صحيح" });

      const tt = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [id, schoolId]);
      if (!tt.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود أو لا ينتمي لمدرستك" });
      }

      const entries = await pool.query(
        `
        SELECT te.id, te.day_of_week, te.period_id, te.room, te.notes,
               te.subject_id, s.name AS subject_name,
               te.teacher_id, t.full_name AS teacher_name
        FROM timetable_entries te
        JOIN subjects s ON s.id = te.subject_id
LEFT JOIN teachers t ON t.id = te.teacher_id
        WHERE te.timetable_id=$1
        ORDER BY te.day_of_week, te.period_id
        `,
        [id]
      );

      const weekStart = String(req.query.weekStart || "").trim();
      let overrides = [];

      if (weekStart && isValidISODate(weekStart)) {
        const weekEnd = addDaysISO(weekStart, 6);

        const oQ = await pool.query(
          `
          SELECT o.id, o.timetable_id, o.date, o.day_of_week, o.period_id, o.type,
                 o.subject_id, s.name AS subject_name,
                 o.teacher_id, t.full_name AS teacher_name,
                 o.room, o.notes,
                 o.exam_title, o.exam_kind, o.exam_total
          FROM timetable_overrides o
          LEFT JOIN subjects s ON s.id = o.subject_id
          LEFT JOIN teachers t ON t.id = o.teacher_id
          WHERE o.timetable_id = $1
            AND o.date BETWEEN $2::date AND $3::date
          ORDER BY o.date, o.period_id
          `,
          [id, weekStart, weekEnd]
        );

        overrides = oQ.rows;
      }

      return res.json({
        data: { timetable: tt.rows[0], entries: entries.rows, overrides },
      });
    } catch (e) {
      console.error("getById error:", e);
      return res.status(500).json({ message: "خطأ في جلب الجدول" });
    }
  },

  // =========================
  // PUT /api/timetables/:id/entries
  // (Bulk Replace)
  // =========================
 // =========================
  // PUT /api/timetables/:id/entries
  // (Bulk Replace)
  // =========================
  async saveEntries(req, res) {
    const client = await pool.connect();
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      const entries = Array.isArray(req.body.entries) ? req.body.entries : [];

      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }

      const ttQ = await client.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const tt = ttQ.rows[0];
      if (tt.status === "published") {
        return res.status(400).json({ message: "لا يمكن تعديل جدول منشور، اجعله مسودة أولاً." });
      }

      const clean = [];
      const cellSet = new Set();

      for (const e of entries) {
        const day = toInt(e.dayId ?? e.day_of_week);
        const periodId = toInt(e.periodId);
        const subjectId = toInt(e.subjectId);
        const teacherId = toInt(e.teacherId);
        const room = String(e.room || "").trim() || null;
        const notes = String(e.notes || "").trim() || null;

if (!day || !periodId || !subjectId) continue;
        const cellKey = `${day}-${periodId}`;
        if (cellSet.has(cellKey)) {
          return res.status(400).json({
            message: `تكرار في نفس الخلية (اليوم ${day} - الحصة ${periodId})`,
          });
        }
        cellSet.add(cellKey);

        clean.push({
          day,
          periodId,
          subjectId,
          teacherId,
          room,
          room_norm: normRoom(room),
          notes,
        });
      }

      if (clean.length) {
        const subjectIds = Array.from(new Set(clean.map((x) => x.subjectId))).filter(Boolean);

        const allowedQ = await client.query(
          `
          SELECT sst.subject_id, sst.teacher_id
          FROM section_subject_teachers sst
          JOIN teacher_subjects ts
            ON ts.teacher_id = sst.teacher_id
           AND ts.subject_id = sst.subject_id
           AND ts.is_active = true
          JOIN teachers t ON t.id = sst.teacher_id
          WHERE sst.school_id = $1::int
            AND sst.academic_year_id = $2::int
            AND sst.term = $3::int
            AND sst.section_id = $4::int
            AND sst.subject_id = ANY($5::int[])
            AND t.is_active = true
            AND ${isSstStatusOkSql("sst")}
          `,
          [schoolId, tt.academic_year_id, tt.term, tt.section_id, subjectIds]
        );

        const allowedMap = new Map();
        for (const row of allowedQ.rows) {
          const sid = Number(row.subject_id);
          const tid = Number(row.teacher_id);
          if (!allowedMap.has(sid)) allowedMap.set(sid, new Set());
          allowedMap.get(sid).add(tid);
        }
for (const x of clean) {
  // الخلية المنسوخة قد تحتوي المادة فقط مؤقتًا.
  // نسمح بحفظها كمسودة حتى يختار المدير معلمًا بديلًا.
  if (!x.teacherId) continue;

  const allowedTeachers = allowedMap.get(x.subjectId);

          if (!allowedTeachers || allowedTeachers.size === 0) {
            return res.status(400).json({
              message: "لا يوجد مدرس مُعيّن لهذه المادة. اذهب إلى (تعيين المدرسين) ثم جرّب.",
              details: { subjectId: x.subjectId }
            });
          }

          if (!allowedTeachers.has(x.teacherId)) {
            return res.status(400).json({
              message: "المعلم المختار غير مُعيّن لهذه المادة في هذه الشعبة.",
              details: { subjectId: x.subjectId, teacherId: x.teacherId }
            });
          }
        }
      }

      const conflicts = await runConflictsCheck(client, tt, clean, schoolId);
      if (conflicts.teacher.length) {
        return res.status(409).json({
          message: "يوجد تعارض معلم في نفس الوقت مع جدول منشور لشعبة أخرى.",
          conflicts: conflicts.teacher,
        });
      }
      if (conflicts.room.length) {
        return res.status(409).json({
          message: "يوجد تعارض قاعة في نفس الوقت مع جدول منشور لشعبة أخرى.",
          conflicts: conflicts.room,
        });
      }

      await client.query("BEGIN");
      
      // ⚠️ هذا هو السطر الذي يحميك من خطأ (Duplicate Key)
      await client.query("DELETE FROM timetable_entries WHERE timetable_id=$1", [timetableId]);

      // ⚠️ هذا هو الـ INSERT المصحح الذي يحتوي على school_id و $8
      for (const x of clean) {
        await client.query(
          `
          INSERT INTO timetable_entries
            (timetable_id, day_of_week, period_id, subject_id, teacher_id, room, notes, school_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `,
          [timetableId, x.day, x.periodId, x.subjectId, x.teacherId, x.room, x.notes, schoolId]
        );
      }

      await client.query("UPDATE timetables SET updated_at=now() WHERE id=$1", [timetableId]);
      await client.query("COMMIT");

      return res.json({ message: "تم حفظ المسودة بنجاح" });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed in saveEntries:", rollbackError);
      }
      console.error("saveEntries error:", e);
      return res.status(500).json({ message: "خطأ في حفظ الجدول" });
    } finally {
      client.release();
    }
  },

  // =========================
  // PUT /api/timetables/:id/publish
  // =========================
  async publish(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }

      const ttQ = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }
const unresolvedEntriesQ = await pool.query(
  `
  SELECT COUNT(*)::int AS c
  FROM timetable_entries
  WHERE timetable_id = $1
    AND teacher_id IS NULL
  `,
  [timetableId]
);

const unresolvedCount = Number(unresolvedEntriesQ.rows[0]?.c || 0);

if (unresolvedCount > 0) {
  return res.status(400).json({
    message:
      `لا يمكن نشر الجدول قبل تحديد معلم بديل لـ ${unresolvedCount} حصة منسوخة.`,
    code: "UNASSIGNED_TEACHERS",
    unresolved_count: unresolvedCount,
  });
}
      const countEntriesQ = await pool.query(
        "SELECT COUNT(*)::int AS c FROM timetable_entries WHERE timetable_id=$1",
        [timetableId]
      );
      const countOverridesQ = await pool.query(
        "SELECT COUNT(*)::int AS c FROM timetable_overrides WHERE timetable_id=$1",
        [timetableId]
      );

      const total = Number(countEntriesQ.rows[0]?.c || 0) + Number(countOverridesQ.rows[0]?.c || 0);
      if (!total) {
        return res.status(400).json({ message: "لا يمكن نشر جدول فارغ." });
      }

  await pool.query(
  `
  UPDATE timetables
  SET status = 'published',
      updated_at = now()
  WHERE id = $1
    AND school_id = $2
  `,
  [timetableId, schoolId]
);

await pool.query(
  `
  UPDATE timetable_overrides
  SET status = 'published',
      updated_at = now()
  WHERE timetable_id = $1
    AND school_id = $2
  `,
  [timetableId, schoolId]
);

      try {
        await WorkflowNotifications.notifyWeeklyTimetablePublication({
          app: req.app,
          schoolId,
          timetableId,
          published: true,
        });
      } catch (notifyErr) {
        console.error("Notification error (weekly timetable published):", notifyErr);
      }

      return res.json({ message: "تم نشر الجدول" });
    } catch (e) {
      console.error("publish error:", e);
      return res.status(500).json({ message: "خطأ في نشر الجدول" });
    }
  },

  // =========================
  // PUT /api/timetables/:id/unpublish
  // =========================
  async unpublish(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }

      const ttQ = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) return res.status(404).json({ message: "الجدول غير موجود" });

  await pool.query(
  `
  UPDATE timetables
  SET status = 'draft',
      updated_at = now()
  WHERE id = $1
    AND school_id = $2
  `,
  [timetableId, schoolId]
);

await pool.query(
  `
  UPDATE timetable_overrides
  SET status = 'draft',
      updated_at = now()
  WHERE timetable_id = $1
    AND school_id = $2
  `,
  [timetableId, schoolId]
);

      try {
        await WorkflowNotifications.notifyWeeklyTimetablePublication({
          app: req.app,
          schoolId,
          timetableId,
          published: false,
        });
      } catch (notifyErr) {
        console.error("Notification error (weekly timetable unpublished):", notifyErr);
      }

      return res.json({ message: "تم إرجاع الجدول إلى مسودة" });
    } catch (e) {
      console.error("unpublish error:", e);
      return res.status(500).json({ message: "خطأ" });
    }
  },

  // =========================
  // DELETE /api/timetables/:id/entries
  // =========================
  async clearEntries(req, res) {
    const client = await pool.connect();
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }

      const ttQ = await client.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const tt = ttQ.rows[0];
      if (tt.status === "published") {
        return res.status(400).json({ message: "لا يمكن تفريغ جدول منشور، اجعله مسودة أولاً." });
      }

      await client.query("BEGIN");
      await client.query("DELETE FROM timetable_entries WHERE timetable_id=$1", [timetableId]);
      await client.query("DELETE FROM timetable_overrides WHERE timetable_id=$1", [timetableId]);
      await client.query("UPDATE timetables SET updated_at=now() WHERE id=$1", [timetableId]);
      await client.query("COMMIT");

      return res.json({ message: "تم تفريغ الجدول" });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed in clearEntries:", rollbackError);
      }
      console.error("clearEntries error:", e);
      return res.status(500).json({ message: "خطأ في تفريغ الجدول" });
    } finally {
      client.release();
    }
  },

  // =========================
  // DELETE /api/timetables/:id
  // =========================
  async remove(req, res) {
    const client = await pool.connect();
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const id = toInt(req.params.id);
      if (!id) {
        return res.status(400).json({ message: "id غير صحيح" });
      }

      const ttQ = await client.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [id, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const tt = ttQ.rows[0];
      if (tt.status === "published") {
        return res.status(400).json({ message: "لا يمكن حذف جدول منشور. ألغِ النشر أولاً." });
      }

      await client.query("BEGIN");
      await client.query("DELETE FROM timetable_entries WHERE timetable_id=$1", [id]);
      await client.query("DELETE FROM timetable_overrides WHERE timetable_id=$1", [id]);
      await client.query("DELETE FROM timetables WHERE id=$1", [id]);
      await client.query("COMMIT");

      return res.json({ message: "تم حذف الجدول" });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed in remove:", rollbackError);
      }
      console.error("timetables remove error:", e);
      return res.status(500).json({ message: "خطأ في حذف الجدول" });
    } finally {
      client.release();
    }
  },

  // =========================
  // POST /api/timetables/:id/copy-from
  // =========================
 async copyFrom(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const targetId = toInt(req.params.id);
    const fromTimetableId = toInt(req.body?.fromTimetableId);

    // smart:
    // يحاول نسخ المادة والمعلم، وإذا تعارض المعلم ينسخ المادة فقط.
    //
    // subjects_only:
    // ينسخ المواد فقط دائمًا ويترك اختيار المعلمين للمدير.
    const mode = String(req.body?.mode || "smart").trim();

    if (!targetId) {
      return res.status(400).json({ message: "target id غير صحيح" });
    }

    if (!fromTimetableId) {
      return res.status(400).json({ message: "fromTimetableId مطلوب" });
    }

    if (!["smart", "subjects_only"].includes(mode)) {
      return res.status(400).json({ message: "وضع النسخ غير صحيح" });
    }

    if (Number(targetId) === Number(fromTimetableId)) {
      return res.status(400).json({
        message: "لا يمكن نسخ الجدول إلى نفسه.",
      });
    }

    const tgtQ = await client.query(
      `
      SELECT *
      FROM timetables
      WHERE id = $1
        AND school_id = $2
      `,
      [targetId, schoolId]
    );

    if (!tgtQ.rows.length) {
      return res.status(404).json({ message: "الجدول الهدف غير موجود" });
    }

    const ttTarget = tgtQ.rows[0];

    if (ttTarget.status === "published") {
      return res.status(400).json({
        message: "لا يمكن النسخ إلى جدول منشور. ألغِ النشر أولاً.",
      });
    }

    const srcQ = await client.query(
      `
      SELECT *
      FROM timetables
      WHERE id = $1
        AND school_id = $2
      `,
      [fromTimetableId, schoolId]
    );

    if (!srcQ.rows.length) {
      return res.status(404).json({ message: "الجدول المصدر غير موجود" });
    }

    const srcEntriesQ = await client.query(
      `
      SELECT
        day_of_week,
        period_id,
        subject_id,
        teacher_id,
        room,
        notes
      FROM timetable_entries
      WHERE timetable_id = $1
      ORDER BY day_of_week, period_id
      `,
      [fromTimetableId]
    );

    const sourceEntries = srcEntriesQ.rows
      .map((entry) => ({
        day: toInt(entry.day_of_week),
        periodId: toInt(entry.period_id),
        subjectId: toInt(entry.subject_id),
        teacherId: toInt(entry.teacher_id),
        room: String(entry.room || "").trim() || null,
        notes: String(entry.notes || "").trim() || null,
      }))
      .filter((entry) => {
        return entry.day && entry.periodId && entry.subjectId;
      });

    const preparedEntries = [];
    const unresolvedEntries = [];
    const clearedRooms = [];

    for (const sourceEntry of sourceEntries) {
      let teacherId =
        mode === "subjects_only"
          ? null
          : sourceEntry.teacherId;

      let room =
        mode === "subjects_only"
          ? null
          : sourceEntry.room;

      let unresolvedReason =
        mode === "subjects_only"
          ? "materials_only"
          : null;

      // 1. التأكد أن المعلم مرتبط أصلًا بهذه المادة في الشعبة الهدف.
      if (teacherId) {
        const isAssigned = await ensureTeacherAssignedForSection(
          client,
          ttTarget,
          sourceEntry.subjectId,
          teacherId,
          schoolId
        );

        if (!isAssigned) {
          teacherId = null;
          room = null;
          unresolvedReason = "teacher_not_assigned";
        }
      }

      // 2. فحص تعارض المعلم مع الجداول المنشورة.
      if (teacherId) {
        const teacherConflicts = await runConflictsCheck(
          client,
          ttTarget,
          [
            {
              day: sourceEntry.day,
              periodId: sourceEntry.periodId,
              teacherId,
              room: null,
              room_norm: null,
            },
          ],
          schoolId
        );

        if (teacherConflicts.teacher.length) {
          teacherId = null;
          room = null;
          unresolvedReason = "teacher_conflict";
        }
      }

      // 3. فحص القاعة بصورة مستقلة.
      // إذا كانت القاعة مستخدمة، ننسخ الحصة دون القاعة ولا نوقف النسخ.
      if (room) {
        const roomConflicts = await runConflictsCheck(
          client,
          ttTarget,
          [
            {
              day: sourceEntry.day,
              periodId: sourceEntry.periodId,
              teacherId: null,
              room,
              room_norm: normRoom(room),
            },
          ],
          schoolId
        );

        if (roomConflicts.room.length) {
          clearedRooms.push({
            day: sourceEntry.day,
            periodId: sourceEntry.periodId,
            room,
          });

          room = null;
        }
      }

      preparedEntries.push({
        day: sourceEntry.day,
        periodId: sourceEntry.periodId,
        subjectId: sourceEntry.subjectId,
        teacherId,
        room,
        notes: sourceEntry.notes,
      });

      if (!teacherId) {
        unresolvedEntries.push({
          day: sourceEntry.day,
          periodId: sourceEntry.periodId,
          subjectId: sourceEntry.subjectId,
          reason: unresolvedReason || "teacher_required",
        });
      }
    }

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM timetable_entries
      WHERE timetable_id = $1
      `,
      [targetId]
    );

    await client.query(
      `
      DELETE FROM timetable_overrides
      WHERE timetable_id = $1
      `,
      [targetId]
    );

    for (const entry of preparedEntries) {
      await client.query(
        `
        INSERT INTO timetable_entries (
          timetable_id,
          day_of_week,
          period_id,
          subject_id,
          teacher_id,
          room,
          notes,
          school_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          targetId,
          entry.day,
          entry.periodId,
          entry.subjectId,
          entry.teacherId,
          entry.room,
          entry.notes,
          schoolId,
        ]
      );
    }

    await client.query(
      `
      UPDATE timetables
      SET updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      `,
      [targetId, schoolId]
    );

    await client.query("COMMIT");

    return res.json({
      message:
        unresolvedEntries.length > 0
          ? "تم نسخ الجدول كمسودة. توجد حصص تحتاج إلى اختيار معلمين بدلاء."
          : "تم نسخ الجدول بنجاح.",
      data: {
        fromTimetableId,
        targetId,
        mode,
        copied_entries_count: preparedEntries.length,
        unresolved_entries_count: unresolvedEntries.length,
        unresolved_entries: unresolvedEntries,
        cleared_rooms_count: clearedRooms.length,
        cleared_rooms: clearedRooms,
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in copyFrom:", rollbackError);
    }

    console.error("copyFrom error:", e);

    return res.status(500).json({
      message: "خطأ في نسخ الجدول",
    });
  } finally {
    client.release();
  }
},
  // =========================================================
  // GET /api/timetables/:id/overrides?weekStart=YYYY-MM-DD
  // =========================================================
  async listOverrides(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      const weekStart = String(req.query.weekStart || "").trim();

      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }
      if (!weekStart || !isValidISODate(weekStart)) {
        return res.status(400).json({ message: "weekStart مطلوب وبصيغة صحيحة" });
      }

      const ttQ = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const weekEnd = addDaysISO(weekStart, 6);

      const r = await pool.query(
        `
        SELECT o.id, o.timetable_id, o.date, o.day_of_week, o.period_id, o.type,
               o.subject_id, s.name AS subject_name,
               o.teacher_id, t.full_name AS teacher_name,
               o.room, o.notes,
               o.exam_title, o.exam_kind, o.exam_total
        FROM timetable_overrides o
        LEFT JOIN subjects s ON s.id = o.subject_id
        LEFT JOIN teachers t ON t.id = o.teacher_id
        WHERE o.timetable_id = $1
          AND o.date BETWEEN $2::date AND $3::date
        ORDER BY o.date, o.period_id
        `,
        [timetableId, weekStart, weekEnd]
      );

      return res.json({ data: r.rows, range: { weekStart, weekEnd } });
    } catch (e) {
      console.error("listOverrides error:", e);
      return res.status(500).json({ message: "خطأ في جلب الاستثناءات" });
    }
  },

  // =========================================================
  // PUT /api/timetables/:id/overrides
  // body: { override: {...} }
  // =========================================================
 async upsertOverride(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const timetableId = toInt(req.params.id);
    const o = req.body?.override || req.body;

    if (!timetableId) {
      return res.status(400).json({ message: "id غير صحيح" });
    }

    const date = String(o?.date || "").trim();
    const periodId = toInt(o?.periodId ?? o?.period_id);
    const type = String(o?.type || "lesson").trim();
    const subjectId = toInt(o?.subjectId ?? o?.subject_id);
    const teacherId = toInt(o?.teacherId ?? o?.teacher_id);
    const room = String(o?.room || "").trim() || null;
    const notes = String(o?.notes || "").trim() || null;

 const exam_title = String(o?.examTitle || o?.exam_title || "").trim() || null;
const exam_kind = String(o?.examKind || o?.exam_kind || "monthly").trim() || "monthly";
const exam_total = o?.examTotal ?? o?.exam_total;
const hasExamTotalInput =
  exam_total !== null && exam_total !== undefined && String(exam_total).trim() !== "";

const examTotalInt = hasExamTotalInput ? toInt(exam_total) : null;
let finalExamTotalInt = null;

    if (!date || !isValidISODate(date)) {
      return res.status(400).json({ message: "date مطلوب وبصيغة صحيحة" });
    }

    if (!periodId) {
      return res.status(400).json({ message: "periodId مطلوب" });
    }

    if (!["lesson", "exam", "cancel"].includes(type)) {
      return res.status(400).json({ message: "type غير صحيح" });
    }
if (type === "exam") {
  if (hasExamTotalInput && (!examTotalInt || examTotalInt <= 0)) {
    return res.status(400).json({
      message: "درجة الاختبار يجب أن تكون رقمًا أكبر من صفر.",
    });
  }

  finalExamTotalInt = examTotalInt;

  if (!finalExamTotalInt) {
    finalExamTotalInt = await getDefaultOverrideExamTotal(client, schoolId, exam_kind);
  }

  if (!finalExamTotalInt || finalExamTotalInt <= 0) {
    return res.status(400).json({
      message: "يجب تحديد درجة الاختبار الشهري من جدول الإدارة أو ضبط درجة الشهري الافتراضية من إعدادات المدرسة.",
    });
  }
}
    const ttQ = await client.query(
      "SELECT * FROM timetables WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    if (!ttQ.rows.length) {
      return res.status(404).json({ message: "الجدول غير موجود" });
    }

    const tt = ttQ.rows[0];

    if (tt.status === "published") {
      return res.status(400).json({
        message: "لا يمكن تعديل جدول منشور، اجعله مسودة أولاً.",
      });
    }

    const dayId = toInt(o?.dayId ?? o?.day_of_week) || isoDateToDayId(date);

    if (type !== "cancel") {
      if (!subjectId || !teacherId) {
        return res.status(400).json({ message: "subjectId و teacherId مطلوبين" });
      }

      const isAssigned = await ensureTeacherAssignedForSection(
        client,
        tt,
        subjectId,
        teacherId,
        schoolId
      );

      if (!isAssigned) {
        return res.status(400).json({
          message: "المعلم غير مُعيّن لهذه المادة في هذه الشعبة/السنة/الترم.",
          details: {
            subjectId,
            teacherId,
            sectionId: tt.section_id,
            term: tt.term,
            academicYearId: tt.academic_year_id,
          },
        });
      }
    }

    const cleanForTemplate = [];

    if (type !== "cancel" && dayId) {
      cleanForTemplate.push({
        day: dayId,
        periodId,
        teacherId,
        room,
        room_norm: normRoom(room),
      });
    }

    if (cleanForTemplate.length) {
      const conflicts = await runConflictsCheck(client, tt, cleanForTemplate, schoolId);

      if (conflicts.teacher.length) {
        return res.status(409).json({
          message: "يوجد تعارض معلم (مع جدول منشور لشعبة أخرى).",
          conflicts: conflicts.teacher,
        });
      }

      if (conflicts.room.length) {
        return res.status(409).json({
          message: "يوجد تعارض قاعة (مع جدول منشور لشعبة أخرى).",
          conflicts: conflicts.room,
        });
      }
    }

    const cleanForOverrides = [];

    if (type !== "cancel") {
      cleanForOverrides.push({
        date,
        periodId,
        teacherId,
        room,
        room_norm: normRoom(room),
      });
    }

    if (cleanForOverrides.length) {
      const oc = await runOverridesConflictsCheck(client, tt, cleanForOverrides, schoolId);

      if (oc.teacher.length) {
        return res.status(409).json({
          message: "يوجد تعارض معلم (اختبار/استثناء بتاريخ).",
          conflicts: oc.teacher,
        });
      }

      if (oc.room.length) {
        return res.status(409).json({
          message: "يوجد تعارض قاعة (اختبار/استثناء بتاريخ).",
          conflicts: oc.room,
        });
      }
    }

    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO timetable_overrides (
        timetable_id,
        date,
        day_of_week,
        period_id,
        type,
        subject_id,
        teacher_id,
        room,
        notes,
        exam_title,
        exam_kind,
        exam_total,
        status,
        school_id,
        created_at,
        updated_at
      )
      VALUES (
        $1::int,
        $2::date,
        $3::smallint,
        $4::int,
        $5::text,
        $6::int,
        $7::int,
        $8::text,
        $9::text,
        $10::text,
        $11::text,
        $12::int,
        'draft',
        $13::bigint,
        now(),
        now()
      )
      ON CONFLICT (timetable_id, date, period_id)
      DO UPDATE SET
        day_of_week = EXCLUDED.day_of_week,
        type = EXCLUDED.type,
        subject_id = EXCLUDED.subject_id,
        teacher_id = EXCLUDED.teacher_id,
        room = EXCLUDED.room,
        notes = EXCLUDED.notes,
        exam_title = EXCLUDED.exam_title,
        exam_kind = EXCLUDED.exam_kind,
        exam_total = EXCLUDED.exam_total,
        school_id = EXCLUDED.school_id,
        updated_at = now()
      `,
      [
        timetableId,
        date,
        dayId,
        periodId,
        type,
        type === "cancel" ? null : subjectId,
        type === "cancel" ? null : teacherId,
        room,
        notes,
        type === "exam" ? exam_title : null,
        type === "exam" ? exam_kind || "monthly" : null,
type === "exam" ? finalExamTotalInt : null,
        schoolId,
      ]
    );

    await client.query(
      `
      UPDATE timetables
      SET updated_at = now()
      WHERE id = $1
        AND school_id = $2
      `,
      [timetableId, schoolId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "تم حفظ الاستثناء",
      data: {
        timetableId,
        date,
        periodId,
        type,
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in upsertOverride:", rollbackError);
    }

    console.error("upsertOverride error:", e);
    return res.status(500).json({ message: "خطأ في حفظ الاستثناء" });
  } finally {
    client.release();
  }
},

  // =========================================================
  // DELETE /api/timetables/:id/overrides?date=YYYY-MM-DD&periodId=#
  // =========================================================
  async deleteOverride(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      const date = String(req.query.date || "").trim();
      const periodId = toInt(req.query.periodId);

      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }
      if (!date || !periodId) {
        return res.status(400).json({ message: "date و periodId مطلوبين" });
      }

      const ttQ = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const tt = ttQ.rows[0];
      if (tt.status === "published") {
        return res.status(400).json({
          message: "لا يمكن تعديل جدول منشور، اجعله مسودة أولاً.",
        });
      }

      await pool.query(
        `DELETE FROM timetable_overrides WHERE timetable_id=$1 AND date=$2::date AND period_id=$3`,
        [timetableId, date, periodId]
      );

      await pool.query("UPDATE timetables SET updated_at=now() WHERE id=$1", [timetableId]);

      return res.json({ message: "تم حذف الاستثناء" });
    } catch (e) {
      console.error("deleteOverride error:", e);
      return res.status(500).json({ message: "خطأ في حذف الاستثناء" });
    }
  },

  // =========================================================
  // PUT /api/timetables/:id/overrides/publish-week
  // =========================================================
  async publishWeekOverrides(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      const weekStart = String(req.body?.weekStart || req.query.weekStart || "").trim();

      if (!timetableId) {
        return res.status(400).json({ message: "id غير صحيح" });
      }
      if (!weekStart || !isValidISODate(weekStart)) {
        return res.status(400).json({ message: "weekStart مطلوب وبصيغة صحيحة" });
      }

      const ttQ = await pool.query("SELECT * FROM timetables WHERE id=$1 AND school_id=$2", [timetableId, schoolId]);
      if (!ttQ.rows.length) {
        return res.status(404).json({ message: "الجدول غير موجود" });
      }

      const tt = ttQ.rows[0];
      if (tt.status === "published") {
        return res.status(400).json({
          message: "لا يمكن تعديل جدول منشور، اجعله مسودة أولاً.",
        });
      }

      const weekEnd = addDaysISO(weekStart, 6);

 await pool.query(
  `
  UPDATE timetable_overrides
  SET
    status = 'published',
    updated_at = now()
  WHERE timetable_id = $1
    AND school_id = $2
    AND date BETWEEN $3::date AND $4::date
  `,
  [timetableId, schoolId, weekStart, weekEnd]
);

      await pool.query("UPDATE timetables SET updated_at=now() WHERE id=$1", [timetableId]);

      return res.json({
        message: "تم تحديث/تأكيد استثناءات الأسبوع",
        range: { weekStart, weekEnd },
      });
    } catch (e) {
      console.error("publishWeekOverrides error:", e);
      return res.status(500).json({ message: "خطأ في نشر/تأكيد استثناءات الأسبوع" });
    }
  },
};

export default TimetablesController;