// src/controllers/teacherDashboardController.js
import { pool } from "../config/db.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 1=Saturday, 2=Sunday, ..., 7=Friday
function todayId() {
  const d = new Date().getDay(); // 0=Sun..6=Sat
  if (d === 6) return 1; // Sat
  if (d === 0) return 2; // Sun
  if (d === 1) return 3; // Mon
  if (d === 2) return 4; // Tue
  if (d === 3) return 5; // Wed
  if (d === 4) return 6; // Thu
  if (d === 5) return 7; // Fri
  return 0;
}

/* =========================
   Column discovery + caching
========================= */
const _colsCache = new Map();

async function getColumns(table) {
  const key = `public.${table}`;
  if (_colsCache.has(key)) return _colsCache.get(key);

  const q = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
  `;
  const r = await pool.query(q, [table]);
  const set = new Set(r.rows.map((x) => x.column_name));
  _colsCache.set(key, set);
  return set;
}

async function pickColumn(table, candidates) {
  const set = await getColumns(table);
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

async function hasColumn(table, col) {
  const set = await getColumns(table);
  return set.has(col);
}

/* =========================
   Teacher lookup
========================= */
// ✅ إضافة schoolId لضمان جلب بيانات المعلم في المدرسة الصحيحة
async function getTeacherByUserId(userId, schoolId) {
  const tNameCol = await pickColumn("teachers", ["full_name", "name", "teacher_name"]);
  const uNameCol = await pickColumn("users", ["full_name", "name", "username", "email"]);

  const sql = `
    SELECT
      t.id AS teacher_id,
      COALESCE(
        ${tNameCol ? `t.${tNameCol}::text` : "NULL"},
        ${uNameCol ? `u.${uNameCol}::text` : "NULL"},
        u.username::text,
        u.email::text
      ) AS teacher_name
    FROM teachers t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.user_id = $1 AND t.school_id = $2
    LIMIT 1
  `;
  const r = await pool.query(sql, [userId, schoolId]);
  return r.rows[0] || null;
}

/* =========================
   HERO STATS
========================= */
export const getHero = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة

    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const teacher = await getTeacherByUserId(userId, schoolId);
    if (!teacher) return res.status(404).json({ message: "لم يتم العثور على بيانات المعلّم في هذه المدرسة" });

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    if (!academicYearId || !term) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const day = todayId();
    if (!day) {
      return res.json({ teacher_name: teacher.teacher_name, today_lessons: 0, current_sections: 0 });
    }

    const statusFilter = (await hasColumn("timetables", "status"))
      ? " AND tt.status = 'published' "
      : "";

    // ✅ إضافة حماية المدرسة لعدد حصص اليوم
    const todayQ = `
      SELECT COUNT(DISTINCT te.id) AS cnt
      FROM timetable_entries te
      JOIN timetables tt ON tt.id = te.timetable_id
      WHERE te.teacher_id = $1
        AND te.day_of_week = $2
        AND tt.academic_year_id = $3
        AND tt.term = $4
        AND tt.school_id = $5
        ${statusFilter}
    `;
    const todayR = await pool.query(todayQ, [teacher.teacher_id, day, academicYearId, term, schoolId]);

    // ✅ إضافة حماية المدرسة لعدد الشعب الحالية
    const sectionsQ = `
      SELECT COUNT(DISTINCT tt.section_id) AS cnt
      FROM timetable_entries te
      JOIN timetables tt ON tt.id = te.timetable_id
      WHERE te.teacher_id = $1
        AND tt.academic_year_id = $2
        AND tt.term = $3
        AND tt.section_id IS NOT NULL
        AND tt.school_id = $4
        ${statusFilter}
    `;
    const secR = await pool.query(sectionsQ, [teacher.teacher_id, academicYearId, term, schoolId]);

    return res.json({
      teacher_name: teacher.teacher_name,
      today_lessons: Number(todayR.rows[0]?.cnt || 0),
      current_sections: Number(secR.rows[0]?.cnt || 0),
    });
  } catch (e) {
    console.error("getHero error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر" });
  }
};

/* =========================
   NEXT LESSON
========================= */
export const getNextLesson = async (req, res) => {
  try {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const teacher = await getTeacherByUserId(userId, schoolId);
    if (!teacher) return res.status(404).json({ message: "لم يتم العثور على بيانات المعلّم" });

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    if (!academicYearId || !term) {
      return res.status(400).json({ message: "academicYearId و term مطلوبة" });
    }

    const day = todayId();
    if (!day) return res.json({});

    const pStart = await pickColumn("periods", ["start_time", "from_time", "starts_at"]);
    const pEnd = await pickColumn("periods", ["end_time", "to_time", "ends_at"]);
    const pSort = await pickColumn("periods", ["sort_order", "order_no", "sort"]);
    const subjectNameCol = await pickColumn("subjects", ["name", "title"]);
    const gradeNameCol = await pickColumn("grades", ["name", "title"]);
    const sectionNameCol = await pickColumn("sections", ["name", "title"]);

    if (!pStart) return res.json({});

    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const statusFilter = (await hasColumn("timetables", "status"))
      ? " AND tt.status = 'published' "
      : "";

    // ✅ الأساس في الاستعلام: عزل الجداول والحصص والمواد والمراحل حسب المدرسة
    const selectPart = `
      SELECT
        p.${pStart} AS start_time
        ${pEnd ? `, p.${pEnd} AS end_time` : ""}
        ${pSort ? `, p.${pSort} AS sort_order` : ""}
        , te.room AS room
        ${subjectNameCol ? `, s.${subjectNameCol} AS subject_name` : ""}
        ${
          gradeNameCol && sectionNameCol
            ? `, (g.${gradeNameCol} || ' (' || sec.${sectionNameCol} || ')') AS section_label`
            : ""
        }
      FROM timetable_entries te
      JOIN timetables tt ON tt.id = te.timetable_id
      JOIN periods p ON p.id = te.period_id
      LEFT JOIN subjects s ON s.id = te.subject_id
      LEFT JOIN grades g ON g.id = tt.grade_id
      LEFT JOIN sections sec ON sec.id = tt.section_id
      WHERE te.teacher_id = $1
        AND te.day_of_week = $2
        AND tt.academic_year_id = $3
        AND tt.term = $4
        AND tt.school_id = $6
        AND p.school_id = $6
        ${statusFilter}
    `;

    // 1) Current lesson
    if (pEnd) {
      const currentQ = `
        ${selectPart}
        AND p.${pStart} <= $5::time
        AND p.${pEnd}   >  $5::time
        ORDER BY p.${pStart} ASC
        LIMIT 1
      `;
      const cur = await pool.query(currentQ, [teacher.teacher_id, day, academicYearId, term, nowTime, schoolId]);
      if (cur.rows[0]) {
        const row = cur.rows[0];
        return res.json({
          start_time: row.start_time,
          end_time: row.end_time || null,
          sort_order: row.sort_order ?? null,
          room: row.room || null,
          subject_name: row.subject_name || null,
          section_label: row.section_label || null,
          mode: "current",
        });
      }
    }

    // 2) Next lesson
    const nextQ = `
      ${selectPart}
      AND p.${pStart} > $5::time
      ORDER BY p.${pStart} ASC
      LIMIT 1
    `;
    const r = await pool.query(nextQ, [teacher.teacher_id, day, academicYearId, term, nowTime, schoolId]);
    const row = r.rows[0];
    if (!row) return res.json({});

    return res.json({
      start_time: row.start_time,
      end_time: row.end_time || null,
      sort_order: row.sort_order ?? null,
      room: row.room || null,
      subject_name: row.subject_name || null,
      section_label: row.section_label || null,
      mode: "next",
    });
  } catch (e) {
    console.error("getNextLesson error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر" });
  }
};