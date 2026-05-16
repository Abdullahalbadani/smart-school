import { pool } from "../config/db.js";

/* =========================
    Helpers (Common)
========================= */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// smallint range: -32768..32767
function toSmallInt(v, fallback = 1) {
  const n = toInt(v);
  if (!n) return fallback;
  if (n > 32767) return 32767;
  if (n < -32768) return -32768;
  return n;
}

/* =========================
    Column existence cache
========================= */
const _colCache = new Map();
async function columnExists(table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);

  const r = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name=$1
      AND column_name=$2
    LIMIT 1
    `,
    [table, column]
  );
  const ok = r.rowCount > 0;
  _colCache.set(key, ok);
  return ok;
}

/* =========================
    Helpers (PERIODS)
========================= */
// يرجّع أول رقم sort_order متاح (يسد الفراغات) - مع حماية المدرسة
async function getFirstFreePeriodSortOrder(schoolId, excludeId = null) {
  const r = await pool.query(
    `
    WITH mx AS (
      SELECT COALESCE(MAX(sort_order), 0) AS mx
      FROM periods
      WHERE school_id = $1 AND ($2::int IS NULL OR id <> $2::int)
    ),
    gs AS (
      SELECT generate_series(1, (SELECT mx + 1 FROM mx)) AS n
    )
    SELECT COALESCE(
      (
        SELECT MIN(gs.n)
        FROM gs
        WHERE NOT EXISTS (
          SELECT 1
          FROM periods p
          WHERE p.school_id = $1 AND p.sort_order = gs.n
            AND ($2::int IS NULL OR p.id <> $2::int)
        )
      ),
      1
    ) AS next
    `,
    [schoolId, excludeId]
  );
  return Number(r.rows[0]?.next ?? 1);
}

async function pickPeriodSortOrder(schoolId, desired, excludeId = null) {
  const d = toInt(desired);
  if (!d || d <= 0)
    return await getFirstFreePeriodSortOrder(schoolId, excludeId);

  const exists = await pool.query(
    `
    SELECT 1
    FROM periods
    WHERE sort_order = $1
      AND school_id = $2
      AND ($3::int IS NULL OR id <> $3::int)
    LIMIT 1
    `,
    [d, schoolId, excludeId]
  );

  if (exists.rowCount === 0) return d;
  return await getFirstFreePeriodSortOrder(schoolId, excludeId);
}

/* =========================
    Teachers Meta (for qualification UI)
========================= */
async function detectNameColumn(tableName) {
  const r = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name=$1
      AND column_name IN ('full_name','name')
    ORDER BY CASE WHEN column_name='full_name' THEN 1 ELSE 2 END
    LIMIT 1
    `,
    [tableName]
  );
  return r.rows[0]?.column_name || "name";
}

// ✅ يرجع: [{id, full_name, is_active}] حتى لو ما عندك teachers (fallback employees)
async function listTeachersMetaSafe(schoolId) {
  try {
    const ex = await pool.query(`
      SELECT
        to_regclass('public.teachers')  AS teachers_tbl,
        to_regclass('public.employees') AS employees_tbl
    `);

    const hasTeachers = !!ex.rows[0]?.teachers_tbl;
    const hasEmployees = !!ex.rows[0]?.employees_tbl;
    if (!hasTeachers) return [];

    // نحدد عمود الاسم + is_active في teachers
    const nameCol = await detectNameColumn("teachers"); // full_name أو name
    const tHasActive = await columnExists("teachers", "is_active");

    // لو عندك employees + teacher_id + is_teacher نفلتر "معلمين فقط"
    if (hasEmployees) {
      const eHasTeacherId = await columnExists("employees", "teacher_id");
      const eHasIsTeacher = await columnExists("employees", "is_teacher");

      if (eHasTeacherId && eHasIsTeacher) {
        const r = await pool.query(
          `
          SELECT
            t.id,
            t.${nameCol} AS full_name,
            ${tHasActive ? "t.is_active" : "true AS is_active"}
          FROM teachers t
          JOIN employees e ON e.teacher_id = t.id
          WHERE t.school_id = $1 AND COALESCE(e.is_teacher, false) = true
          ORDER BY t.${nameCol} ASC, t.id ASC
        `,
          [schoolId]
        );
        return r.rows;
      }
    }

    // fallback: لو ما عندك الربط/العمودين، نرجع teachers (لكن قد يظهر الكل)
    const r = await pool.query(
      `
      SELECT
        id,
        ${nameCol} AS full_name,
        ${tHasActive ? "is_active" : "true AS is_active"}
      FROM teachers
      WHERE school_id = $1
      ORDER BY ${nameCol} ASC, id ASC
    `,
      [schoolId]
    );
    return r.rows;
  } catch (e) {
    console.error("listTeachersMetaSafe error:", e.message);
    return [];
  }
}

/* =========================
    META
========================= */
export async function metaAll(schoolId) {
  const [years, stages, grades, sections, subjects, periods] =
    await Promise.all([
      pool.query(
        `SELECT id, name, start_date, end_date, is_active
       FROM academic_years
       WHERE school_id = $1
       ORDER BY id DESC`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, name, order_index, is_active
       FROM stages
       WHERE school_id = $1
       ORDER BY order_index, id`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, stage_id, name, order_index, is_active
       FROM grades
       WHERE school_id = $1
       ORDER BY stage_id, order_index, id`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, grade_id, name, capacity, is_active
       FROM sections
       WHERE school_id = $1
       ORDER BY grade_id, name`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, name, is_active
       FROM subjects
       WHERE school_id = $1
       ORDER BY name`,
        [schoolId]
      ),
      pool.query(
        `SELECT id, name, start_time, end_time, sort_order
       FROM periods
       WHERE school_id = $1
       ORDER BY sort_order, id`,
        [schoolId]
      ),
    ]);

  const teachers = await listTeachersMetaSafe(schoolId);

  return {
    years: years.rows,
    stages: stages.rows,
    grades: grades.rows,
    sections: sections.rows,
    subjects: subjects.rows,
    periods: periods.rows,
    teachers,
  };
}

/* ---------------- YEARS ---------------- */
export async function createYear(schoolId, { name, start_date, end_date }) {
  const r = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)
     VALUES ($1,$2,$3,$4,true)
     RETURNING id, name, start_date, end_date, is_active`,
    [schoolId, name, start_date, end_date]
  );
  return r.rows[0];
}

export async function updateYear(schoolId, id, { name, start_date, end_date }) {
  const r = await pool.query(
    `UPDATE academic_years
     SET name=$3, start_date=$4, end_date=$5, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, name, start_date, end_date, is_active`,
    [toInt(id), schoolId, name, start_date, end_date]
  );
  return r.rows[0] || null;
}

export async function toggleYear(schoolId, id) {
  const r = await pool.query(
    `UPDATE academic_years
     SET is_active = NOT is_active, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, is_active`,
    [toInt(id), schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- STAGES ---------------- */
export async function createStage(schoolId, { name, order_index }) {
  const idxInt = toInt(order_index) || 1;
  const idxSmall = toSmallInt(order_index, 1);

  const r = await pool.query(
    `
    INSERT INTO stages (school_id, name, order_index, order_no, is_active, created_at, updated_at)
    VALUES ($1, $2, $3::int, $4::smallint, true, now(), now())
    RETURNING id, name, order_index, is_active
    `,
    [schoolId, name, idxInt, idxSmall]
  );
  return r.rows[0];
}

export async function updateStage(schoolId, id, { name, order_index }) {
  const idxInt = toInt(order_index) || 1;
  const idxSmall = toSmallInt(order_index, 1);

  const r = await pool.query(
    `
    UPDATE stages
    SET name=$3,
        order_index=$4::int,
        order_no=$5::smallint,
        updated_at=now()
    WHERE id=$1 AND school_id=$2
    RETURNING id, name, order_index, is_active
    `,
    [toInt(id), schoolId, name, idxInt, idxSmall]
  );
  return r.rows[0] || null;
}

export async function toggleStage(schoolId, id) {
  const r = await pool.query(
    `UPDATE stages
     SET is_active = NOT is_active, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, is_active`,
    [toInt(id), schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- GRADES ---------------- */
export async function createGrade(schoolId, { stage_id, name, order_index }) {
  const stId = toInt(stage_id);
  const idxInt = toInt(order_index) || 1;
  const idxSmall = toSmallInt(order_index, 1);

  const r = await pool.query(
    `
    INSERT INTO grades (school_id, stage_id, name, order_index, order_no, is_active, created_at, updated_at)
    VALUES ($1, $2::int, $3, $4::int, $5::smallint, true, now(), now())
    RETURNING id, stage_id, name, order_index, is_active
    `,
    [schoolId, stId, name, idxInt, idxSmall]
  );
  return r.rows[0];
}

export async function updateGrade(
  schoolId,
  id,
  { stage_id, name, order_index }
) {
  const stId = toInt(stage_id);
  const idxInt = toInt(order_index) || 1;
  const idxSmall = toSmallInt(order_index, 1);

  const r = await pool.query(
    `
    UPDATE grades
    SET stage_id=$3::int,
        name=$4,
        order_index=$5::int,
        order_no=$6::smallint,
        updated_at=now()
    WHERE id=$1 AND school_id=$2
    RETURNING id, stage_id, name, order_index, is_active
    `,
    [toInt(id), schoolId, stId, name, idxInt, idxSmall]
  );
  return r.rows[0] || null;
}

export async function toggleGrade(schoolId, id) {
  const r = await pool.query(
    `UPDATE grades
     SET is_active = NOT is_active, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, is_active`,
    [toInt(id), schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- SECTIONS ---------------- */
export async function createSection(schoolId, { grade_id, name, capacity }) {
  const r = await pool.query(
    `INSERT INTO sections (school_id, grade_id, name, capacity, is_active, created_at, updated_at)
     VALUES ($1, $2::int,$3,$4,true,now(),now())
     RETURNING id, grade_id, name, capacity, is_active`,
    [schoolId, toInt(grade_id), name, capacity === "" ? null : toInt(capacity)]
  );
  return r.rows[0];
}

export async function updateSection(
  schoolId,
  id,
  { grade_id, name, capacity }
) {
  const r = await pool.query(
    `UPDATE sections
     SET grade_id=$3::int, name=$4, capacity=$5, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, grade_id, name, capacity, is_active`,
    [
      toInt(id),
      schoolId,
      toInt(grade_id),
      name,
      capacity === "" ? null : toInt(capacity),
    ]
  );
  return r.rows[0] || null;
}

export async function toggleSection(schoolId, id) {
  const r = await pool.query(
    `UPDATE sections
     SET is_active = NOT is_active, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, is_active`,
    [toInt(id), schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- SUBJECTS ---------------- */
export async function createSubject(schoolId, { name }) {
  const r = await pool.query(
    `INSERT INTO subjects (school_id, name, is_active, created_at, updated_at)
     VALUES ($1,$2,true,now(),now())
     RETURNING id, name, is_active`,
    [schoolId, name]
  );
  return r.rows[0];
}

export async function updateSubject(schoolId, id, { name }) {
  const r = await pool.query(
    `UPDATE subjects SET name=$3, updated_at=now() WHERE id=$1 AND school_id=$2
     RETURNING id, name, is_active`,
    [toInt(id), schoolId, name]
  );
  return r.rows[0] || null;
}

export async function toggleSubject(schoolId, id) {
  const r = await pool.query(
    `UPDATE subjects
     SET is_active = NOT is_active, updated_at=now()
     WHERE id=$1 AND school_id=$2
     RETURNING id, is_active`,
    [toInt(id), schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- PERIODS ---------------- */
export async function createPeriod(
  schoolId,
  { name, start_time, end_time, sort_order }
) {
  const so = await pickPeriodSortOrder(schoolId, sort_order, null);
  const periodsHasActive = await columnExists("periods", "is_active");

  const r = await pool.query(
    `
    INSERT INTO periods (school_id, name, start_time, end_time, sort_order${
      periodsHasActive ? ", is_active" : ""
    }, created_at, updated_at)
    VALUES ($1,$2,$3::time,$4::time,$5::int${
      periodsHasActive ? ", true" : ""
    },now(),now())
    RETURNING id, name, start_time, end_time, sort_order${
      periodsHasActive ? ", is_active" : ""
    }
    `,
    [schoolId, name, start_time, end_time, so]
  );

  return r.rows[0];
}

export async function updatePeriod(
  schoolId,
  id,
  { name, start_time, end_time, sort_order }
) {
  const pid = toInt(id);
  const hasSort = !(
    sort_order === undefined ||
    sort_order === null ||
    sort_order === ""
  );
  const so = hasSort
    ? await pickPeriodSortOrder(schoolId, sort_order, pid)
    : null;
  const periodsHasActive = await columnExists("periods", "is_active");

  const r = await pool.query(
    `
    UPDATE periods
    SET name = COALESCE($3, name),
        start_time = COALESCE($4::time, start_time),
        end_time = COALESCE($5::time, end_time),
        sort_order = COALESCE($6::int, sort_order),
        updated_at = now()
    WHERE id=$1 AND school_id=$2
    RETURNING id, name, start_time, end_time, sort_order${
      periodsHasActive ? ", is_active" : ""
    }
    `,
    [pid, schoolId, name ?? null, start_time ?? null, end_time ?? null, so]
  );

  return r.rows[0] || null;
}

export async function togglePeriod(schoolId, id) {
  const pid = toInt(id);
  const periodsHasActive = await columnExists("periods", "is_active");
  if (!periodsHasActive) {
    throw new Error(
      "جدول periods لا يحتوي عمود is_active. أضِف العمود أولًا ثم جرّب."
    );
  }

  const r = await pool.query(
    `
    UPDATE periods
    SET is_active = NOT is_active,
        updated_at = now()
    WHERE id=$1 AND school_id=$2
    RETURNING id, is_active
    `,
    [pid, schoolId]
  );
  return r.rows[0] || null;
}

/* ---------------- CURRICULUM (grade_subjects) ---------------- */
export async function getCurriculum(schoolId, gradeId) {
  const r = await pool.query(
    `SELECT subject_id
     FROM grade_subjects
     WHERE grade_id=$1 AND school_id=$2 AND is_active=true
     ORDER BY subject_id`,
    [toInt(gradeId), schoolId]
  );
  return r.rows.map((x) => x.subject_id);
}

export async function setCurriculum(schoolId, { grade_id, subject_ids }) {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE grade_subjects
       SET is_active=false, updated_at=now()
       WHERE grade_id=$1 AND school_id=$2`,
      [toInt(grade_id), schoolId]
    );

    if (Array.isArray(subject_ids) && subject_ids.length) {
      await pool.query(
        `
        INSERT INTO grade_subjects (school_id, grade_id, subject_id, is_active, created_at, updated_at)
        SELECT $1::int, $2::int, x::int, true, now(), now()
        FROM unnest($3::int[]) AS x
        ON CONFLICT (grade_id, subject_id)
        DO UPDATE SET is_active=true, updated_at=now()
        `,
        [schoolId, toInt(grade_id), subject_ids.map(toInt).filter(Boolean)]
      );
    }

    await pool.query("COMMIT");
    return true;
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

/* =========================
    Teacher Qualifications (teacher_subjects)
========================= */
export async function getTeacherSubjectTeachers(schoolId, subjectId) {
  const r = await pool.query(
    `
    SELECT teacher_id
    FROM teacher_subjects
    WHERE subject_id=$1::int AND school_id=$2 AND is_active=true
    ORDER BY teacher_id
    `,
    [toInt(subjectId), schoolId]
  );
  return r.rows.map((x) => x.teacher_id);
}

export async function setTeacherSubjectTeachers(
  schoolId,
  { subject_id, teacher_ids }
) {
  const sid = toInt(subject_id);
  const tids = (Array.isArray(teacher_ids) ? teacher_ids : [])
    .map(toInt)
    .filter(Boolean);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE teacher_subjects
       SET is_active=false, updated_at=now()
       WHERE subject_id=$1::int AND school_id=$2`,
      [sid, schoolId]
    );

    if (tids.length) {
      await pool.query(
        `
        INSERT INTO teacher_subjects (school_id, subject_id, teacher_id, is_active, created_at, updated_at)
        SELECT $1::int, $2::int, x::int, true, now(), now()
        FROM unnest($3::int[]) AS x
        ON CONFLICT (subject_id, teacher_id)
        DO UPDATE SET is_active=true, updated_at=now()
        `,
        [schoolId, sid, tids]
      );
    }

    await pool.query("COMMIT");
    return true;
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

/* ==========================================
    🆕 UPDATE SCHOOL PROFILE (هوية المدرسة)
========================================== */
export async function updateSchoolProfile(
  schoolId,
  { name_ar, name_en, phone, email, address, logo_url }
) {
  const r = await pool.query(
    `UPDATE schools 
     SET name_ar = COALESCE($2, name_ar),
         name_en = COALESCE($3, name_en),
         phone = COALESCE($4, phone),
         email = COALESCE($5, email),
         address = COALESCE($6, address),
         logo_url = COALESCE($7, logo_url),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, name_ar, name_en, phone, email, address, logo_url, slug`,
    [schoolId, name_ar, name_en, phone, email, address, logo_url]
  );
  return r.rows[0] || null;
}

// جلب الإعدادات الأكاديمية (التقويم والدرجات)
// جلب الإعدادات الأكاديمية (التقويم والدرجات)
export async function getAcademicSettings(schoolId) {
  const r = await pool.query(
    `
    SELECT
      week_start_day,
      working_days,
      monthly_exam_max_grade,
      midterm_exam_max_grade,
      midterm_muhassala_max_grade,
      midterm_max_grade,
      midterm_pass_mark,
      final_exam_max_grade,
      final_muhassala_max_grade,
      final_term_max_grade,
      grading_scale AS final_max_grade,
      pass_mark AS final_pass_mark,
      annual_failure_subjects_limit
    FROM school_settings
    WHERE school_id = $1
    `,
    [schoolId]
  );

  return r.rows[0] || {
    week_start_day: 6,
    working_days: ["sat", "sun", "mon", "tue", "wed"],

    monthly_exam_max_grade: 20,

    midterm_exam_max_grade: 30,
    midterm_muhassala_max_grade: 20,
    midterm_max_grade: 50,
    midterm_pass_mark: 20,

    final_exam_max_grade: 30,
    final_muhassala_max_grade: 20,
    final_term_max_grade: 50,
    final_max_grade: 100,
    final_pass_mark: 50,

    annual_failure_subjects_limit: 1,
  };
}
export async function updateAcademicSettings(schoolId, data) {
  const monthlyExamMax = toInt(data.monthly_exam_max) || 20;

  const midtermExamMax = toInt(data.midterm_exam_max) || 30;
  const midtermMuhassalaMax = toInt(data.midterm_muhassala_max) || 20;
  const midtermMax = midtermExamMax + midtermMuhassalaMax;

  const finalExamMax = toInt(data.final_exam_max) || 30;
  const finalMuhassalaMax = toInt(data.final_muhassala_max) || 20;
  const finalTermMax = finalExamMax + finalMuhassalaMax;

  const finalMax = midtermMax + finalTermMax;

  const midtermPass = toInt(data.midterm_pass) ?? 20;
  const finalPass = toInt(data.final_pass) ?? 50;

  const annualFailureSubjectsLimitRaw = toInt(data.annual_failure_subjects_limit);
  const annualFailureSubjectsLimit =
    annualFailureSubjectsLimitRaw && annualFailureSubjectsLimitRaw > 0
      ? annualFailureSubjectsLimitRaw
      : 1;

  const workingDays = Array.isArray(data.working_days)
    ? data.working_days
    : [];

  const workingDaysJson = JSON.stringify(workingDays);

  const r = await pool.query(
    `
    INSERT INTO school_settings (
      school_id,
      week_start_day,
      working_days,
      monthly_exam_max_grade,
      midterm_exam_max_grade,
      midterm_muhassala_max_grade,
      midterm_max_grade,
      midterm_pass_mark,
      final_exam_max_grade,
      final_muhassala_max_grade,
      final_term_max_grade,
      grading_scale,
      pass_mark,
      annual_failure_subjects_limit,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3::jsonb,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      NOW()
    )
    ON CONFLICT (school_id) DO UPDATE SET
      week_start_day = EXCLUDED.week_start_day,
      working_days = EXCLUDED.working_days,
      monthly_exam_max_grade = EXCLUDED.monthly_exam_max_grade,
      midterm_exam_max_grade = EXCLUDED.midterm_exam_max_grade,
      midterm_muhassala_max_grade = EXCLUDED.midterm_muhassala_max_grade,
      midterm_max_grade = EXCLUDED.midterm_max_grade,
      midterm_pass_mark = EXCLUDED.midterm_pass_mark,
      final_exam_max_grade = EXCLUDED.final_exam_max_grade,
      final_muhassala_max_grade = EXCLUDED.final_muhassala_max_grade,
      final_term_max_grade = EXCLUDED.final_term_max_grade,
      grading_scale = EXCLUDED.grading_scale,
      pass_mark = EXCLUDED.pass_mark,
      annual_failure_subjects_limit = EXCLUDED.annual_failure_subjects_limit,
      updated_at = NOW()
    RETURNING *
    `,
    [
      schoolId,
      data.week_start_day,
      workingDaysJson,

      monthlyExamMax,

      midtermExamMax,
      midtermMuhassalaMax,
      midtermMax,
      midtermPass,

      finalExamMax,
      finalMuhassalaMax,
      finalTermMax,
      String(finalMax),
      finalPass,

      annualFailureSubjectsLimit,
    ]
  );

  return r.rows[0];
}
// تحديث إعدادات المالية والنظام
// ✅ تحديث إعدادات المالية والنظام (تعديل نهائي)
// ✅ 1. تحديث إعدادات المالية والنظام
export async function updateFinanceSettings(schoolId, data) {
  // تحديث العملة والبادئة في جدول المدارس
  await pool.query(
    `UPDATE schools SET 
        currency = $2, 
        name_prefix = $3 
     WHERE id = $1`, 
    [schoolId, data.currency, data.student_prefix]
  );

  // تحديث اللغة وفاتورة الرسوم في جدول الإعدادات
  const r = await pool.query(
    `INSERT INTO school_settings (school_id, invoice_prefix, default_language, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (school_id) DO UPDATE SET
        invoice_prefix = EXCLUDED.invoice_prefix,
        default_language = EXCLUDED.default_language,
        updated_at = NOW()
     RETURNING *`,
    [schoolId, data.invoice_prefix, data.language]
  );

  return { ...r.rows[0], student_prefix: data.student_prefix };
}

// ✅ 2. دالة الجلب (هذه التي كانت ناقصة وتسبب اختفاء البادئة من المربع)
export async function getFinanceSettings(schoolId) {
  const r = await pool.query(
    `SELECT 
        s.currency, 
        s.name_prefix AS student_prefix, 
        ss.invoice_prefix, 
        ss.default_language AS language
     FROM schools s
     LEFT JOIN school_settings ss ON s.id = ss.school_id
     WHERE s.id = $1`,
    [schoolId]
  );
  // نرجع القيم المخزنة، وإذا كانت فارغة نرجع قيم افتراضية
  return r.rows[0] || { currency: 'YER', student_prefix: 'ST', invoice_prefix: '', language: 'ar' };
}

// جلب حالة البوابات
export async function getPortalsSettings(schoolId) {
  const r = await pool.query(
    `SELECT allow_parent_portal, allow_teacher_portal FROM school_settings WHERE school_id = $1`,
    [schoolId]
  );
  return r.rows[0] || null;
}

// تحديث حالة البوابات
export async function updatePortalsSettings(schoolId, data) {
  const r = await pool.query(
    `UPDATE school_settings SET 
        allow_teacher_portal = $2,
        allow_parent_portal = $3,
        updated_at = NOW()
     WHERE school_id = $1
     RETURNING allow_teacher_portal, allow_parent_portal`,
    [schoolId, data.teacher_portal, data.parent_portal]
  );
  return r.rows[0];
}
