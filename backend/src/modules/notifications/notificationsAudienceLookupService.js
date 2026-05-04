// backend/src/modules/notifications/notificationsAudienceLookupService.js
import { pool } from "../../config/db.js";

/* =========================
   Helpers
========================= */
function toNullableInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function clampLimit(v, min = 1, max = 50, fallback = 20) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeQ(q) {
  return String(q || "").trim();
}

function uniqInt(ids = []) {
  return [...new Set((ids || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
}

function assertSafeIdentifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(name || ""))) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return name;
}

const labelColumnCache = new Map();
const tableColumnsCache = new Map();

async function getTableColumns(tableName) {
  const key = String(tableName);
  if (tableColumnsCache.has(key)) return tableColumnsCache.get(key);

  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    `,
    [key]
  );

  const cols = new Set(result.rows.map((r) => r.column_name));
  tableColumnsCache.set(key, cols);
  return cols;
}

async function resolvePreferredLabelColumn(tableName, candidates = []) {
  const key = `${tableName}:${candidates.join(",")}`;
  if (labelColumnCache.has(key)) return labelColumnCache.get(key);

  const cols = await getTableColumns(tableName);
  const found = candidates.find((c) => cols.has(c)) || null;
  labelColumnCache.set(key, found);
  return found;
}

function buildLabelExpr({ alias, idCol = "id", labelCol, fallbackPrefix }) {
  assertSafeIdentifier(alias);
  assertSafeIdentifier(idCol);

  if (labelCol) {
    assertSafeIdentifier(labelCol);
    return `COALESCE(NULLIF(TRIM(${alias}.${labelCol}::text), ''), '${fallbackPrefix} #' || ${alias}.${idCol}::text)`;
  }

  return `'${fallbackPrefix} #' || ${alias}.${idCol}::text`;
}

// ✅ تعديل لجلب السنة الدراسية النشطة للمدرسة المحددة فقط
async function getActiveAcademicYearId(schoolId) {
  const result = await pool.query(
    `SELECT id FROM academic_years WHERE is_active = true AND school_id = $1 ORDER BY id DESC LIMIT 1`,
    [schoolId]
  );
  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}

function pushQSearch(where, params, q, expressions = []) {
  const qq = normalizeQ(q);
  if (!qq) return;

  const idx = params.length + 1;
  const like = `%${qq}%`;
  const orParts = expressions.filter(Boolean).map((e) => `${e} ILIKE $${idx}`);

  if (!orParts.length) return;

  where.push(`(${orParts.join(" OR ")})`);
  params.push(like);
}

/* =========================
   Dynamic label columns
========================= */
async function getLabelColumns() {
  const [stageLabelCol, gradeLabelCol, sectionLabelCol] = await Promise.all([
    resolvePreferredLabelColumn("stages", ["name", "title", "stage_name", "label", "arabic_name"]),
    resolvePreferredLabelColumn("grades", ["name", "title", "grade_name", "label", "arabic_name"]),
    resolvePreferredLabelColumn("sections", ["name", "title", "section_name", "label", "arabic_name", "code"]),
  ]);

  return { stageLabelCol, gradeLabelCol, sectionLabelCol };
}

/* =========================
   Lookups: Stages / Grades / Sections
========================= */
export async function lookupStages({ q = "", limit = 20, schoolId } = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 100, 20);

  const { stageLabelCol } = await getLabelColumns();
  const stageNameExpr = buildLabelExpr({
    alias: "st",
    labelCol: stageLabelCol,
    fallbackPrefix: "Stage",
  });

  const params = [schoolId];
  const where = [`st.school_id = $1`];

  pushQSearch(where, params, q, [stageNameExpr, `st.id::text`]);

  params.push(limit);

  const sql = `
    SELECT
      st.id,
      ${stageNameExpr} AS name
    FROM stages st
    WHERE ${where.join(" AND ")}
    ORDER BY st.id ASC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      label: r.name,
    })),
  };
}

export async function lookupGrades({
  stageId = null,
  q = "",
  limit = 50,
  schoolId,
} = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 200, 50);

  const { stageLabelCol, gradeLabelCol } = await getLabelColumns();

  const stageNameExpr = buildLabelExpr({
    alias: "st",
    labelCol: stageLabelCol,
    fallbackPrefix: "Stage",
  });

  const gradeNameExpr = buildLabelExpr({
    alias: "g",
    labelCol: gradeLabelCol,
    fallbackPrefix: "Grade",
  });

  const params = [schoolId];
  const where = [`g.school_id = $1`];

  const stageIdInt = toNullableInt(stageId);
  if (stageIdInt) {
    where.push(`g.stage_id = $${params.length + 1}`);
    params.push(stageIdInt);
  }

  pushQSearch(where, params, q, [gradeNameExpr, `g.id::text`, stageNameExpr]);

  params.push(limit);

  const sql = `
    SELECT
      g.id,
      g.stage_id,
      ${gradeNameExpr} AS name,
      ${stageNameExpr} AS stage_name
    FROM grades g
    LEFT JOIN stages st ON st.id = g.stage_id AND st.school_id = $1
    WHERE ${where.join(" AND ")}
    ORDER BY g.id ASC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      label: r.name,
      stage_id: r.stage_id ? Number(r.stage_id) : null,
      stage_name: r.stage_name || null,
    })),
  };
}

export async function lookupSections({
  stageId = null,
  gradeId = null,
  q = "",
  limit = 80,
  schoolId,
} = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 300, 80);

  const { stageLabelCol, gradeLabelCol, sectionLabelCol } = await getLabelColumns();

  const stageNameExpr = buildLabelExpr({
    alias: "st",
    labelCol: stageLabelCol,
    fallbackPrefix: "Stage",
  });

  const gradeNameExpr = buildLabelExpr({
    alias: "g",
    labelCol: gradeLabelCol,
    fallbackPrefix: "Grade",
  });

  const sectionNameExpr = buildLabelExpr({
    alias: "sec",
    labelCol: sectionLabelCol,
    fallbackPrefix: "Section",
  });

  const params = [schoolId];
  const where = [`sec.school_id = $1`];

  const stageIdInt = toNullableInt(stageId);
  const gradeIdInt = toNullableInt(gradeId);

  if (stageIdInt) {
    where.push(`g.stage_id = $${params.length + 1}`);
    params.push(stageIdInt);
  }

  if (gradeIdInt) {
    where.push(`sec.grade_id = $${params.length + 1}`);
    params.push(gradeIdInt);
  }

  pushQSearch(where, params, q, [sectionNameExpr, `sec.id::text`, gradeNameExpr, stageNameExpr]);

  params.push(limit);

  const sql = `
    SELECT
      sec.id,
      sec.grade_id,
      g.stage_id,
      ${sectionNameExpr} AS name,
      ${gradeNameExpr} AS grade_name,
      ${stageNameExpr} AS stage_name
    FROM sections sec
    LEFT JOIN grades g ON g.id = sec.grade_id AND g.school_id = $1
    LEFT JOIN stages st ON st.id = g.stage_id AND st.school_id = $1
    WHERE ${where.join(" AND ")}
    ORDER BY sec.id ASC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      label: r.name,
      grade_id: r.grade_id ? Number(r.grade_id) : null,
      grade_name: r.grade_name || null,
      stage_id: r.stage_id ? Number(r.stage_id) : null,
      stage_name: r.stage_name || null,
    })),
  };
}

/* =========================
   Lookup: Students
========================= */
export async function lookupStudents({
  q = "",
  stageId = null,
  gradeId = null,
  sectionId = null,
  academicYearId = null,
  term = null,
  limit = 20,
  useActiveAcademicYearDefault = true,
  schoolId,
} = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 100, 20);

  const { stageLabelCol, gradeLabelCol, sectionLabelCol } = await getLabelColumns();

  const stageNameExpr = buildLabelExpr({
    alias: "st",
    labelCol: stageLabelCol,
    fallbackPrefix: "Stage",
  });

  const gradeNameExpr = buildLabelExpr({
    alias: "g",
    labelCol: gradeLabelCol,
    fallbackPrefix: "Grade",
  });

  const sectionNameExpr = buildLabelExpr({
    alias: "sec",
    labelCol: sectionLabelCol,
    fallbackPrefix: "Section",
  });

  let ayId = toNullableInt(academicYearId);
  if (!ayId && toBool(useActiveAcademicYearDefault, true)) {
    ayId = await getActiveAcademicYearId(schoolId);
  }

  const params = [schoolId];
  const where = [`s.school_id = $1`];

  const stageIdInt = toNullableInt(stageId);
  const gradeIdInt = toNullableInt(gradeId);
  const sectionIdInt = toNullableInt(sectionId);
  const termInt = toNullableInt(term);

  if (ayId) {
    where.push(`se.academic_year_id = $${params.length + 1}`);
    params.push(ayId);
  }

  if (termInt) {
    where.push(`se.term = $${params.length + 1}`);
    params.push(termInt);
  }

  if (stageIdInt) {
    where.push(`COALESCE(se.stage_id, g.stage_id) = $${params.length + 1}`);
    params.push(stageIdInt);
  }

  if (gradeIdInt) {
    where.push(`se.grade_id = $${params.length + 1}`);
    params.push(gradeIdInt);
  }

  if (sectionIdInt) {
    where.push(`se.section_id = $${params.length + 1}`);
    params.push(sectionIdInt);
  }

  // البحث بالاسم أو ids
  const qq = normalizeQ(q);
  if (qq) {
    const idx = params.length + 1;
    params.push(`%${qq}%`);
    where.push(`
      (
        COALESCE(u.name, '') ILIKE $${idx}
        OR s.id::text ILIKE $${idx}
        OR COALESCE(s.user_id, 0)::text ILIKE $${idx}
      )
    `);
  }

  params.push(limit);

  const sql = `
    SELECT DISTINCT ON (s.id)
      s.id AS student_id,
      s.user_id,
      COALESCE(NULLIF(TRIM(u.name), ''), 'طالب #' || s.id::text) AS full_name,

      se.academic_year_id,
      se.term,
      COALESCE(se.stage_id, g.stage_id) AS stage_id,
      se.grade_id,
      se.section_id,

      ${stageNameExpr} AS stage_name,
      ${gradeNameExpr} AS grade_name,
      ${sectionNameExpr} AS section_name
    FROM students s
    LEFT JOIN users u ON u.id = s.user_id AND u.school_id = $1
    LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = $1
    LEFT JOIN grades g ON g.id = COALESCE(se.grade_id, NULL) AND g.school_id = $1
    LEFT JOIN sections sec ON sec.id = COALESCE(se.section_id, NULL) AND sec.school_id = $1
    LEFT JOIN stages st ON st.id = COALESCE(se.stage_id, g.stage_id) AND st.school_id = $1
    WHERE COALESCE(s.status, 'active') = 'active'
      ${where.length ? `AND ${where.join(" AND ")}` : ""}
    ORDER BY
      s.id,
      COALESCE(se.academic_year_id, 0) DESC,
      COALESCE(se.term, 0) DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.student_id), 
      student_id: Number(r.student_id),
      user_id: r.user_id ? Number(r.user_id) : null,
      name: r.full_name,
      label: r.full_name,
      academic_year_id: r.academic_year_id ? Number(r.academic_year_id) : null,
      term: r.term ? Number(r.term) : null,
      stage_id: r.stage_id ? Number(r.stage_id) : null,
      stage_name: r.stage_name || null,
      grade_id: r.grade_id ? Number(r.grade_id) : null,
      grade_name: r.grade_name || null,
      section_id: r.section_id ? Number(r.section_id) : null,
      section_name: r.section_name || null,
    })),
    meta: {
      academic_year_id_used: ayId || null,
    },
  };
}

/* =========================
   Lookup: Teachers
========================= */
export async function lookupTeachers({
  q = "",
  sectionId = null,
  academicYearId = null,
  term = null,
  limit = 20,
  useActiveAcademicYearDefault = true,
  schoolId,
} = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 100, 20);

  const sectionIdInt = toNullableInt(sectionId);
  const termInt = toNullableInt(term);

  let ayId = toNullableInt(academicYearId);
  if (!ayId && toBool(useActiveAcademicYearDefault, true)) {
    ayId = await getActiveAcademicYearId(schoolId);
  }

  const params = [schoolId];
  const where = [`t.school_id = $1`, `COALESCE(t.is_active, true) = true`, `t.user_id IS NOT NULL`];

  const qq = normalizeQ(q);
  if (qq) {
    where.push(`(
      COALESCE(u.name, '') ILIKE $${params.length + 1}
      OR t.id::text ILIKE $${params.length + 1}
      OR COALESCE(t.user_id, 0)::text ILIKE $${params.length + 1}
    )`);
    params.push(`%${qq}%`);
  }

  let sql = "";

  if (sectionIdInt) {
    const filterSst = [`sst.school_id = $1`];
    const filterSa = [`sa.school_id = $1`];

    filterSst.push(`sst.section_id = $${params.length + 1}`);
    filterSa.push(`sa.section_id = $${params.length + 1}`);
    params.push(sectionIdInt);

    if (ayId) {
      filterSst.push(`sst.academic_year_id = $${params.length + 1}`);
      filterSa.push(`sa.academic_year_id = $${params.length + 1}`);
      params.push(ayId);
    }

    if (termInt) {
      filterSst.push(`sst.term = $${params.length + 1}`);
      filterSa.push(`sa.term = $${params.length + 1}`);
      params.push(termInt);
    }

    params.push(limit);

    sql = `
      WITH scoped_teacher_ids AS (
        SELECT DISTINCT sst.teacher_id
        FROM section_subject_teachers sst
        WHERE COALESCE(sst.status, 'active') = 'active'
          AND ${filterSst.join(" AND ")}

        UNION

        SELECT DISTINCT sa.teacher_id
        FROM section_advisors sa
        WHERE COALESCE(sa.is_active, true) = true
          AND ${filterSa.join(" AND ")}
      )
      SELECT
        t.id AS teacher_id,
        t.user_id,
        COALESCE(NULLIF(TRIM(u.name), ''), 'معلم #' || t.id::text) AS full_name
      FROM scoped_teacher_ids x
      JOIN teachers t ON t.id = x.teacher_id
      LEFT JOIN users u ON u.id = t.user_id AND u.school_id = $1
      WHERE ${where.join(" AND ")}
      ORDER BY full_name ASC, t.id ASC
      LIMIT $${params.length}
    `;
  } else {
    params.push(limit);

    sql = `
      SELECT
        t.id AS teacher_id,
        t.user_id,
        COALESCE(NULLIF(TRIM(u.name), ''), 'معلم #' || t.id::text) AS full_name
      FROM teachers t
      LEFT JOIN users u ON u.id = t.user_id AND u.school_id = $1
      WHERE ${where.join(" AND ")}
      ORDER BY full_name ASC, t.id ASC
      LIMIT $${params.length}
    `;
  }

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.teacher_id), 
      teacher_id: Number(r.teacher_id),
      user_id: r.user_id ? Number(r.user_id) : null,
      name: r.full_name,
      label: r.full_name,
    })),
    meta: {
      academic_year_id_used: ayId || null,
      section_id: sectionIdInt || null,
      term: termInt || null,
    },
  };
}

/* =========================
   Lookup: Guardians
========================= */
export async function lookupGuardians({
  q = "",
  studentId = null,
  stageId = null,
  gradeId = null,
  sectionId = null,
  academicYearId = null,
  term = null,
  limit = 20,
  useActiveAcademicYearDefault = true,
  schoolId,
} = {}) {
  if (!schoolId) throw new Error("schoolId مطلوب للبحث");
  limit = clampLimit(limit, 1, 100, 20);

  const studentIdInt = toNullableInt(studentId);
  const stageIdInt = toNullableInt(stageId);
  const gradeIdInt = toNullableInt(gradeId);
  const sectionIdInt = toNullableInt(sectionId);
  const termInt = toNullableInt(term);

  let ayId = toNullableInt(academicYearId);
  if (!ayId && toBool(useActiveAcademicYearDefault, true)) {
    ayId = await getActiveAcademicYearId(schoolId);
  }

  const params = [schoolId];
  const where = [`g.school_id = $1`, `g.user_id IS NOT NULL`];

  let fromSql = `
    FROM guardians g
    LEFT JOIN users u ON u.id = g.user_id AND u.school_id = $1
    LEFT JOIN student_guardians sg ON sg.guardian_id = g.id AND sg.school_id = $1
    LEFT JOIN students s ON s.id = sg.student_id AND s.school_id = $1
    LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = $1
    LEFT JOIN users su ON su.id = s.user_id AND su.school_id = $1
  `;

  if (studentIdInt) {
    where.push(`sg.student_id = $${params.length + 1}`);
    params.push(studentIdInt);
  }

  if (ayId) {
    where.push(`se.academic_year_id = $${params.length + 1}`);
    params.push(ayId);
  }

  if (termInt) {
    where.push(`se.term = $${params.length + 1}`);
    params.push(termInt);
  }

  if (stageIdInt) {
    where.push(`se.stage_id = $${params.length + 1}`);
    params.push(stageIdInt);
  }

  if (gradeIdInt) {
    where.push(`se.grade_id = $${params.length + 1}`);
    params.push(gradeIdInt);
  }

  if (sectionIdInt) {
    where.push(`se.section_id = $${params.length + 1}`);
    params.push(sectionIdInt);
  }

  const qq = normalizeQ(q);
  if (qq) {
    where.push(`(
      COALESCE(u.name, '') ILIKE $${params.length + 1}
      OR g.id::text ILIKE $${params.length + 1}
      OR COALESCE(g.user_id, 0)::text ILIKE $${params.length + 1}
      OR COALESCE(su.name, '') ILIKE $${params.length + 1}
    )`);
    params.push(`%${qq}%`);
  }

  params.push(limit);

  const sql = `
    SELECT DISTINCT ON (g.id)
      g.id AS guardian_id,
      g.user_id,
      COALESCE(NULLIF(TRIM(u.name), ''), 'ولي أمر #' || g.id::text) AS full_name,
      sg.student_id,
      sg.relation,
      sg.is_primary
    ${fromSql}
    WHERE ${where.join(" AND ")}
    ORDER BY g.id, COALESCE(sg.is_primary, false) DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(sql, params);

  return {
    items: result.rows.map((r) => ({
      id: Number(r.guardian_id), 
      guardian_id: Number(r.guardian_id),
      user_id: r.user_id ? Number(r.user_id) : null,
      name: r.full_name,
      label: r.full_name,
      student_id: r.student_id ? Number(r.student_id) : null,
      relation: r.relation || null,
      is_primary: !!r.is_primary,
    })),
    meta: {
      academic_year_id_used: ayId || null,
      student_id: studentIdInt || null,
    },
  };
}