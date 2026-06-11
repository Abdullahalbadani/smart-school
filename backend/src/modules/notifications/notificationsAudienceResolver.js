// backend/src/modules/notifications/notificationsAudienceResolver.js
import { pool } from "../../config/db.js";

/* =========================
   Helpers
========================== */
function uniqInt(ids = []) {
  return [
    ...new Set(
      (ids || []).map(Number).filter((x) => Number.isInteger(x) && x > 0)
    ),
  ];
}

function toNullableInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNonNegativeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function normalizeRoleKeys(roleKeys = []) {
  const allowed = new Set(["admins", "teachers", "guardians", "students"]);
  return [
    ...new Set(
      (Array.isArray(roleKeys) ? roleKeys : [])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x) => allowed.has(x))
    ),
  ];
}

function normalizeRecipientMode(payload = {}) {
  const rawMode = String(payload?.recipient_mode || "").trim().toLowerCase();
  const hasTargets = Array.isArray(payload?.targets) && payload.targets.length > 0;

  if (hasTargets) {
    if (!rawMode) return "targets";
    if (["targets", "target", "builder", "target_builder", "target-builder"].includes(rawMode)) {
      return "targets";
    }
    if (["users", "roles", "scope", "all_school"].includes(rawMode)) {
      return rawMode;
    }
    return "targets";
  }

  if (!rawMode) return "roles";
  if (["users", "roles", "scope", "all_school"].includes(rawMode)) {
    return rawMode;
  }
  if (["targets", "target", "builder", "target_builder", "target-builder"].includes(rawMode)) {
    return "targets";
  }
  return rawMode; 
}

function normalizeTargets(targets = []) {
  return (Array.isArray(targets) ? targets : [])
    .filter((t) => t && typeof t === "object" && !Array.isArray(t))
    .map((t) => ({
      ...t,
      type: String(t.type || "").trim().toUpperCase(),
    }))
    .filter((t) => !!t.type);
}

function parseUserIdsText(text) {
  return uniqInt(
    String(text || "")
      .split(/[\s,،\n\r\t]+/g)
      .map((x) => Number(x))
      .filter((x) => Number.isInteger(x) && x > 0)
  );
}

/* =========================
   Base lookups (محمية بالمدرسة)
========================== */
async function getActiveAcademicYearId(schoolId) {
  const result = await pool.query(
    `SELECT id FROM academic_years WHERE is_active = true AND school_id = $1 ORDER BY id DESC LIMIT 1`,
    [schoolId]
  );
  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}

async function getAdminUserIds(schoolId) {
  const sql = `
    SELECT DISTINCT u.id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.school_id = u.school_id
    JOIN roles r ON r.id = ur.role_id AND r.school_id = u.school_id
    WHERE COALESCE(u.status, 'active') = 'active'
      AND u.school_id = $1
      AND (
        LOWER(COALESCE(r.name, '')) IN ('admin','administrator','super_admin','superadmin','school_admin','school-admin')
        OR COALESCE(r.name, '') ILIKE '%مدير%'
      )
  `;
  const result = await pool.query(sql, [schoolId]);
  return uniqInt(result.rows.map((r) => r.id));
}

async function getAllTeacherUserIds(schoolId) {
  const sql = `
    SELECT DISTINCT t.user_id
    FROM teachers t
    WHERE t.user_id IS NOT NULL 
      AND t.school_id = $1
      AND COALESCE(t.is_active, true) = true
  `;
  const result = await pool.query(sql, [schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

async function getAllGuardianUserIds(schoolId) {
  const sql = `
    SELECT DISTINCT g.user_id
    FROM guardians g
    WHERE g.user_id IS NOT NULL 
      AND g.school_id = $1
  `;
  const result = await pool.query(sql, [schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

async function getAllStudentUserIds(schoolId) {
  const sql = `
    SELECT DISTINCT s.user_id
    FROM students s
    WHERE s.user_id IS NOT NULL 
      AND s.school_id = $1
      AND COALESCE(s.status, 'active') = 'active'
  `;
  const result = await pool.query(sql, [schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

/* =========================
   Scoped lookups (existing + reusable)
========================== */
async function getUserIdsByEnrollmentScope({
  academicYearId = null,
  term = null,
  stageId = null,
  gradeId = null,
  sectionId = null,
  includeStudents = true,
  includeGuardians = true,
  schoolId,
}) {
  const ayId = toNullableInt(academicYearId) || (await getActiveAcademicYearId(schoolId));
  const tm = toNullableInt(term);
  const stg = toNullableInt(stageId);
  const grd = toNullableInt(gradeId);
  const sec = toNullableInt(sectionId);

  const params = [schoolId];
  const where = [`se.school_id = $1`];

  let i = 2;
  if (ayId) {
    where.push(`se.academic_year_id = $${i++}`);
    params.push(ayId);
  }
  if (tm) {
    where.push(`se.term = $${i++}`);
    params.push(tm);
  }
  if (stg) {
    where.push(`se.stage_id = $${i++}`);
    params.push(stg);
  }
  if (grd) {
    where.push(`se.grade_id = $${i++}`);
    params.push(grd);
  }
  if (sec) {
    where.push(`se.section_id = $${i++}`);
    params.push(sec);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const studentSql = includeStudents
    ? `
    SELECT DISTINCT s.user_id
    FROM student_enrollments se
    JOIN students s ON s.id = se.student_id
    ${whereSql}
      AND s.user_id IS NOT NULL
      AND s.school_id = $1
      AND COALESCE(s.status, 'active') = 'active'
  `
    : null;

  const guardianSql = includeGuardians
    ? `
    SELECT DISTINCT g.user_id
    FROM student_enrollments se
    JOIN student_guardians sg ON sg.student_id = se.student_id AND sg.school_id = $1
    JOIN guardians g ON g.id = sg.guardian_id
    ${whereSql}
      AND g.user_id IS NOT NULL
      AND g.school_id = $1
  `
    : null;

  const [studentsRes, guardiansRes] = await Promise.all([
    studentSql ? pool.query(studentSql, params) : Promise.resolve({ rows: [] }),
    guardianSql ? pool.query(guardianSql, params) : Promise.resolve({ rows: [] }),
  ]);

  return {
    academic_year_id: ayId,
    students: uniqInt(studentsRes.rows.map((r) => r.user_id)),
    guardians: uniqInt(guardiansRes.rows.map((r) => r.user_id)),
  };
}

async function getTeacherUserIdsByTeachingScope({
  academicYearId = null,
  term = null,
  stageId = null,
  gradeId = null,
  sectionId = null,
  includeTeachers = true,
  schoolId,
}) {
  if (!includeTeachers) return { academic_year_id: null, teachers: [] };

  const ayId = toNullableInt(academicYearId) || (await getActiveAcademicYearId(schoolId));
  const tm = toNullableInt(term);
  const stg = toNullableInt(stageId);
  const grd = toNullableInt(gradeId);
  const sec = toNullableInt(sectionId);

  const params = [schoolId];
  const condSst = [`sst.school_id = $1`, `t.school_id = $1`];
  const condSa = [`sa.school_id = $1`, `t.school_id = $1`];
  let i = 2;

  if (ayId) {
    condSst.push(`sst.academic_year_id = $${i}`);
    condSa.push(`sa.academic_year_id = $${i}`);
    params.push(ayId);
    i++;
  }
  if (tm) {
    condSst.push(`sst.term = $${i}`);
    condSa.push(`sa.term = $${i}`);
    params.push(tm);
    i++;
  }
  if (sec) {
    condSst.push(`sst.section_id = $${i}`);
    condSa.push(`sa.section_id = $${i}`);
    params.push(sec);
    i++;
  }
  if (grd) {
    condSst.push(`sec_sst.grade_id = $${i}`);
    condSa.push(`sec_sa.grade_id = $${i}`);
    params.push(grd);
    i++;
  }
  if (stg) {
    condSst.push(`g_sst.stage_id = $${i}`);
    condSa.push(`g_sa.stage_id = $${i}`);
    params.push(stg);
    i++;
  }

  const whereSst = `WHERE ${condSst.join(" AND ")}`;
  const whereSa = `WHERE ${condSa.join(" AND ")}`;

  const sql = `
    WITH sst_users AS (
      SELECT DISTINCT t.user_id
      FROM section_subject_teachers sst
      JOIN teachers t ON t.id = sst.teacher_id
      JOIN sections sec_sst ON sec_sst.id = sst.section_id AND sec_sst.school_id = $1
      JOIN grades g_sst ON g_sst.id = sec_sst.grade_id AND g_sst.school_id = $1
      ${whereSst}
        AND t.user_id IS NOT NULL
        AND COALESCE(t.is_active, true) = true
        AND COALESCE(sst.status, 'active') = 'active'
    ),
    advisor_users AS (
      SELECT DISTINCT t.user_id
      FROM section_advisors sa
      JOIN teachers t ON t.id = sa.teacher_id
      JOIN sections sec_sa ON sec_sa.id = sa.section_id AND sec_sa.school_id = $1
      JOIN grades g_sa ON g_sa.id = sec_sa.grade_id AND g_sa.school_id = $1
      ${whereSa}
        AND t.user_id IS NOT NULL
        AND COALESCE(t.is_active, true) = true
        AND COALESCE(sa.is_active, true) = true
    )
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM sst_users
      UNION
      SELECT user_id FROM advisor_users
    ) z
  `;

  const result = await pool.query(sql, params);

  return {
    academic_year_id: ayId,
    teachers: uniqInt(result.rows.map((r) => r.user_id)),
  };
}

/* =========================
   Entity-specific lookups (new)
========================== */
async function getStudentUserIdsByStudentIds(studentIds = [], schoolId) {
  const ids = uniqInt(studentIds);
  if (!ids.length) return [];

  const sql = `
    SELECT DISTINCT s.user_id
    FROM students s
    WHERE s.id = ANY($1::int[])
      AND s.school_id = $2
      AND s.user_id IS NOT NULL
      AND COALESCE(s.status, 'active') = 'active'
  `;
  const result = await pool.query(sql, [ids, schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

async function getGuardianUserIdsByStudentIds(studentIds = [], schoolId) {
  const ids = uniqInt(studentIds);
  if (!ids.length) return [];

  const sql = `
    SELECT DISTINCT g.user_id
    FROM student_guardians sg
    JOIN guardians g ON g.id = sg.guardian_id
    WHERE sg.student_id = ANY($1::int[])
      AND sg.school_id = $2
      AND g.school_id = $2
      AND g.user_id IS NOT NULL
  `;
  const result = await pool.query(sql, [ids, schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

async function getTeacherUserIdsByTeacherIds(teacherIds = [], schoolId) {
  const ids = uniqInt(teacherIds);
  if (!ids.length) return [];

  const sql = `
    SELECT DISTINCT t.user_id
    FROM teachers t
    WHERE t.id = ANY($1::int[])
      AND t.school_id = $2
      AND t.user_id IS NOT NULL
      AND COALESCE(t.is_active, true) = true
  `;
  const result = await pool.query(sql, [ids, schoolId]);
  return uniqInt(result.rows.map((r) => r.user_id));
}

async function validateDirectUserIds(userIds = [], schoolId) {
  const ids = uniqInt(userIds);
  if (!ids.length) return [];
  const sql = `SELECT id FROM users WHERE id = ANY($1::int[]) AND school_id = $2`;
  const result = await pool.query(sql, [ids, schoolId]);
  return uniqInt(result.rows.map((r) => r.id));
}

/* =========================
   Preview sample (optional but useful)
========================== */
async function getPreviewSampleRecipients(userIds = [], limit = 20, schoolId) {
  const ids = uniqInt(userIds).slice(0, Math.max(1, Math.min(100, toNonNegativeInt(limit, 20))));
  if (!ids.length) return [];

  const sql = `
    WITH input_ids AS (
      SELECT x.user_id, x.ord
      FROM unnest($1::int[]) WITH ORDINALITY AS x(user_id, ord)
    )
    SELECT
      i.user_id,
      COALESCE(u.name, CONCAT('User #', i.user_id::text)) AS full_name,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = i.user_id
            AND ur.school_id = $2
            AND r.school_id = $2
            AND (
              LOWER(COALESCE(r.name, '')) IN ('admin','administrator','super_admin','superadmin','school_admin','school-admin')
              OR COALESCE(r.name, '') ILIKE '%مدير%'
            )
        ) THEN 'admin'
        WHEN EXISTS (SELECT 1 FROM teachers t WHERE t.user_id = i.user_id AND t.school_id = $2) THEN 'teacher'
        WHEN EXISTS (SELECT 1 FROM guardians g WHERE g.user_id = i.user_id AND g.school_id = $2) THEN 'guardian'
        WHEN EXISTS (SELECT 1 FROM students s WHERE s.user_id = i.user_id AND s.school_id = $2) THEN 'student'
        ELSE 'user'
      END AS role_key
    FROM input_ids i
    LEFT JOIN users u ON u.id = i.user_id AND u.school_id = $2
    WHERE u.id IS NOT NULL
    ORDER BY i.ord
  `;

  const result = await pool.query(sql, [ids, schoolId]);

  return result.rows.map((r) => ({
    user_id: Number(r.user_id),
    full_name: r.full_name || null,
    role_key: r.role_key || "user",
  }));
}

/* =========================
   Aggregation model
========================== */
function createAudienceAccumulator(mode = "unknown") {
  return {
    mode,
    allSet: new Set(),
    directSet: new Set(),
    adminsSet: new Set(),
    teachersSet: new Set(),
    guardiansSet: new Set(),
    studentsSet: new Set(),
    raw_total_before_dedupe: 0,
    academicYearIds: new Set(),
    warnings: [],
    target_summaries: [],
  };
}

function addIdsToSet(setObj, ids = []) {
  const clean = uniqInt(ids);
  for (const id of clean) setObj.add(id);
  return clean.length;
}

function mergeGroupedRecipients(acc, grouped = {}, contextLabel = null) {
  if (!acc || !grouped) return;

  const direct = uniqInt(grouped.direct || []);
  const admins = uniqInt(grouped.admins || []);
  const teachers = uniqInt(grouped.teachers || []);
  const guardians = uniqInt(grouped.guardians || []);
  const students = uniqInt(grouped.students || []);

  acc.raw_total_before_dedupe +=
    direct.length + admins.length + teachers.length + guardians.length + students.length;

  addIdsToSet(acc.directSet, direct);
  addIdsToSet(acc.adminsSet, admins);
  addIdsToSet(acc.teachersSet, teachers);
  addIdsToSet(acc.guardiansSet, guardians);
  addIdsToSet(acc.studentsSet, students);

  for (const id of [...direct, ...admins, ...teachers, ...guardians, ...students]) {
    acc.allSet.add(id);
  }

  const ay = toNullableInt(grouped.academic_year_id);
  if (ay) acc.academicYearIds.add(ay);

  if (Array.isArray(grouped.warnings) && grouped.warnings.length) {
    for (const w of grouped.warnings) {
      acc.warnings.push(contextLabel ? `${contextLabel}: ${w}` : w);
    }
  }
}

function finalizeAudienceResult(acc, previewLimit = 20) {
  const recipients = [...acc.allSet];

  const breakdown = {
    mode: acc.mode,
    direct: acc.directSet.size,
    admins: acc.adminsSet.size,
    teachers: acc.teachersSet.size,
    guardians: acc.guardiansSet.size,
    students: acc.studentsSet.size,
    total_before_dedupe: acc.raw_total_before_dedupe,
    total_unique: recipients.length,
    duplicates_removed: Math.max(0, acc.raw_total_before_dedupe - recipients.length),
    deduped_count: Math.max(0, acc.raw_total_before_dedupe - recipients.length),
    academic_year_id:
      acc.academicYearIds.size === 1
        ? [...acc.academicYearIds][0]
        : null,
    academic_year_ids: [...acc.academicYearIds],
    targets_count: Array.isArray(acc.target_summaries) ? acc.target_summaries.length : 0,
  };

  return {
    recipient_user_ids: recipients,
    breakdown,
    warnings: [...new Set(acc.warnings.filter(Boolean))],
    _preview_limit: Math.max(5, Math.min(100, toNonNegativeInt(previewLimit, 20))),
  };
}

/* =========================
   Resolvers for legacy modes
========================== */
async function resolveLegacyUsersMode(payload, schoolId) {
  const validIds = await validateDirectUserIds(payload.recipient_user_ids, schoolId);
  return {
    direct: validIds,
    admins: [],
    teachers: [],
    guardians: [],
    students: [],
    academic_year_id: null,
    warnings: [],
  };
}

async function resolveLegacyAllSchoolMode(payload, schoolId) {
  const [admins, teachers, guardians, students] = await Promise.all([
    getAdminUserIds(schoolId),
    getAllTeacherUserIds(schoolId),
    getAllGuardianUserIds(schoolId),
    getAllStudentUserIds(schoolId),
  ]);

  return {
    direct: [],
    admins,
    teachers,
    guardians,
    students,
    academic_year_id: null,
    warnings: [],
  };
}

async function resolveLegacyRolesMode(payload, schoolId) {
  const roleKeys = normalizeRoleKeys(payload.role_keys);
  const tasks = [];

  if (roleKeys.includes("admins")) {
    tasks.push(getAdminUserIds(schoolId).then((v) => ({ key: "admins", ids: v })));
  }
  if (roleKeys.includes("teachers")) {
    tasks.push(getAllTeacherUserIds(schoolId).then((v) => ({ key: "teachers", ids: v })));
  }
  if (roleKeys.includes("guardians")) {
    tasks.push(getAllGuardianUserIds(schoolId).then((v) => ({ key: "guardians", ids: v })));
  }
  if (roleKeys.includes("students")) {
    tasks.push(getAllStudentUserIds(schoolId).then((v) => ({ key: "students", ids: v })));
  }

  const results = await Promise.all(tasks);

  const grouped = {
    direct: [],
    admins: [],
    teachers: [],
    guardians: [],
    students: [],
    academic_year_id: null,
    warnings: [],
  };

  for (const r of results) grouped[r.key] = uniqInt(r.ids);

  return grouped;
}

async function resolveLegacyScopeMode(payload, schoolId) {
  const scope = payload.scope || {};

  const includeAdmins = toBool(scope.include_admins, false);
  const includeTeachers = toBool(scope.include_teachers, false);
  const includeGuardians = toBool(scope.include_guardians, false);
  const includeStudents = toBool(scope.include_students, false);

  const [admins, scopeUsers, scopeTeachers] = await Promise.all([
    includeAdmins ? getAdminUserIds(schoolId) : Promise.resolve([]),
    getUserIdsByEnrollmentScope({
      academicYearId: scope.academic_year_id,
      term: scope.term,
      stageId: scope.stage_id,
      gradeId: scope.grade_id,
      sectionId: scope.section_id,
      includeStudents,
      includeGuardians,
      schoolId,
    }),
    getTeacherUserIdsByTeachingScope({
      academicYearId: scope.academic_year_id,
      term: scope.term,
      stageId: scope.stage_id,
      gradeId: scope.grade_id,
      sectionId: scope.section_id,
      includeTeachers,
      schoolId,
    }),
  ]);

  return {
    direct: [],
    admins,
    students: scopeUsers.students,
    guardians: scopeUsers.guardians,
    teachers: scopeTeachers.teachers,
    academic_year_id: scopeUsers.academic_year_id || scopeTeachers.academic_year_id || null,
    warnings: [],
  };
}

/* =========================
   Resolvers for target types (NEW)
========================== */
async function resolveTargetRule(rule = {}, schoolId) {
  const type = String(rule.type || "").trim().toUpperCase();

  if (!type) throw new Error("نوع الاستهداف غير محدد");

  switch (type) {
    case "USERS": {
      const rawIds = uniqInt([
        ...(Array.isArray(rule.user_ids) ? rule.user_ids : []),
        ...parseUserIdsText(rule.user_ids_text || ""),
      ]);
      const validIds = await validateDirectUserIds(rawIds, schoolId);

      return {
        direct: validIds,
        admins: [],
        teachers: [],
        guardians: [],
        students: [],
        academic_year_id: null,
        warnings: [],
      };
    }

    case "ROLE_GROUPS": {
      const roles = normalizeRoleKeys(rule.roles || rule.role_keys || []);
      return resolveLegacyRolesMode({ role_keys: roles }, schoolId);
    }

    case "ALL_SCHOOL": {
      const includeAdmins = toBool(rule.include_admins, true);
      const includeTeachers = toBool(rule.include_teachers, true);
      const includeGuardians = toBool(rule.include_guardians, true);
      const includeStudents = toBool(rule.include_students, true);

      const [admins, teachers, guardians, students] = await Promise.all([
        includeAdmins ? getAdminUserIds(schoolId) : Promise.resolve([]),
        includeTeachers ? getAllTeacherUserIds(schoolId) : Promise.resolve([]),
        includeGuardians ? getAllGuardianUserIds(schoolId) : Promise.resolve([]),
        includeStudents ? getAllStudentUserIds(schoolId) : Promise.resolve([]),
      ]);

      return {
        direct: [],
        admins,
        teachers,
        guardians,
        students,
        academic_year_id: null,
        warnings: [],
      };
    }

    case "GRADE":
    case "ALL_SECTIONS_OF_GRADE":
    case "SECTION":
    case "ACADEMIC_SCOPE": {
      const includeAdmins = type === "ACADEMIC_SCOPE" ? toBool(rule.include_admins, false) : false;
      const includeTeachers = toBool(rule.include_teachers, type === "SECTION" ? true : false);
      const includeGuardians = toBool(rule.include_guardians, true);
      const includeStudents = toBool(rule.include_students, true);

      const scopeLike = {
        academic_year_id: toNullableInt(rule.academic_year_id),
        term: toNullableInt(rule.term),
        stage_id: toNullableInt(rule.stage_id),
        grade_id: toNullableInt(rule.grade_id),
        section_id: toNullableInt(rule.section_id),
      };

      if (type === "GRADE" || type === "ALL_SECTIONS_OF_GRADE") {
        if (!scopeLike.grade_id) throw new Error(`target ${type}: grade_id مطلوب`);
        scopeLike.section_id = null;
      }

      if (type === "SECTION") {
        if (!scopeLike.section_id) throw new Error("target SECTION: section_id مطلوب");
      }

      if (type === "ACADEMIC_SCOPE") {
        const hasAnyScope = !!(scopeLike.academic_year_id || scopeLike.term || scopeLike.stage_id || scopeLike.grade_id || scopeLike.section_id);
        if (!hasAnyScope) {
          throw new Error("target ACADEMIC_SCOPE: يجب تحديد معيار نطاق واحد على الأقل");
        }
      }

      const [admins, scopeUsers, scopeTeachers] = await Promise.all([
        includeAdmins ? getAdminUserIds(schoolId) : Promise.resolve([]),
        getUserIdsByEnrollmentScope({
          ...scopeLike,
          includeStudents,
          includeGuardians,
          schoolId,
        }),
        getTeacherUserIdsByTeachingScope({
          ...scopeLike,
          includeTeachers,
          schoolId,
        }),
      ]);

      return {
        direct: [],
        admins,
        teachers: scopeTeachers.teachers,
        guardians: scopeUsers.guardians,
        students: scopeUsers.students,
        academic_year_id: scopeUsers.academic_year_id || scopeTeachers.academic_year_id || null,
        warnings: [],
      };
    }

    case "STUDENT": {
      const studentId = toNullableInt(rule.student_id);
      if (!studentId) throw new Error("target STUDENT: student_id مطلوب");

      const includeGuardiansAlso = toBool(rule.include_guardians_also, false);

      const [students, guardians] = await Promise.all([
        getStudentUserIdsByStudentIds([studentId], schoolId),
        includeGuardiansAlso ? getGuardianUserIdsByStudentIds([studentId], schoolId) : Promise.resolve([]),
      ]);

      return {
        direct: [],
        admins: [],
        teachers: [],
        guardians,
        students,
        academic_year_id: null,
        warnings: [],
      };
    }

    case "GUARDIAN_OF_STUDENT": {
      const studentId = toNullableInt(rule.student_id);
      if (!studentId) throw new Error("target GUARDIAN_OF_STUDENT: student_id مطلوب");

      const guardians = await getGuardianUserIdsByStudentIds([studentId], schoolId);
      const warnings = [];

      if (rule.guardian_relation) {
        warnings.push("تم تجاهل guardian_relation حاليًا");
      }

      return {
        direct: [],
        admins: [],
        teachers: [],
        guardians,
        students: [],
        academic_year_id: null,
        warnings,
      };
    }

    case "TEACHER": {
      const teacherId = toNullableInt(rule.teacher_id);
      if (!teacherId) throw new Error("target TEACHER: teacher_id مطلوب");

      const teachers = await getTeacherUserIdsByTeacherIds([teacherId], schoolId);

      return {
        direct: [],
        admins: [],
        teachers,
        guardians: [],
        students: [],
        academic_year_id: null,
        warnings: [],
      };
    }

    case "ALL_TEACHERS": {
      const hasScopedFilter = !!(toNullableInt(rule.academic_year_id) || toNullableInt(rule.term));
      let teachers = [];
      let academicYearId = null;

      if (hasScopedFilter) {
        const res = await getTeacherUserIdsByTeachingScope({
          academicYearId: rule.academic_year_id,
          term: rule.term,
          stageId: null,
          gradeId: null,
          sectionId: null,
          includeTeachers: true,
          schoolId,
        });
        teachers = res.teachers;
        academicYearId = res.academic_year_id || null;
      } else {
        teachers = await getAllTeacherUserIds(schoolId);
      }

      return {
        direct: [],
        admins: [],
        teachers,
        guardians: [],
        students: [],
        academic_year_id: academicYearId,
        warnings: [],
      };
    }

    case "TEACHERS_OF_SECTION": {
      const sectionId = toNullableInt(rule.section_id);
      if (!sectionId) throw new Error("target TEACHERS_OF_SECTION: section_id مطلوب");

      const res = await getTeacherUserIdsByTeachingScope({
        academicYearId: rule.academic_year_id,
        term: rule.term,
        stageId: null,
        gradeId: null,
        sectionId,
        includeTeachers: true,
        schoolId,
      });

      return {
        direct: [],
        admins: [],
        teachers: res.teachers,
        guardians: [],
        students: [],
        academic_year_id: res.academic_year_id || null,
        warnings: [],
      };
    }

    default:
      throw new Error(`نوع target غير مدعوم: ${type}`);
  }
}

/* =========================
   Main resolver
========================== */
export async function resolveManualAudienceRecipients(payload = {}) {
  // ✅ استخراج رقم المدرسة الممرر من Service الإرسال
  const schoolId = payload.schoolId;
  if (!schoolId) throw new Error("schoolId مطلوب لمعرفة المستهدفين");

  const mode = normalizeRecipientMode(payload);
  const previewLimit = Math.max(5, Math.min(100, toNonNegativeInt(payload.preview_limit, 20)));
  const acc = createAudienceAccumulator(mode);

  if (mode === "targets") {
    const targets = normalizeTargets(payload.targets);

    if (!targets.length) {
      throw new Error("أضف شرط استهداف واحدًا على الأقل");
    }

    for (let i = 0; i < targets.length; i++) {
      const rule = targets[i];
      const ruleNo = i + 1;
      const label = String(rule.label || "").trim();
      const contextLabel = label
        ? `الشرط #${ruleNo} (${label})`
        : `الشرط #${ruleNo} (${rule.type})`;

      const grouped = await resolveTargetRule(rule, schoolId); // 👈 حقن المدرسة
      mergeGroupedRecipients(acc, grouped, contextLabel);

      acc.target_summaries.push({
        index: ruleNo,
        type: rule.type,
        label: label || null,
      });
    }
  } else if (mode === "users") {
    const grouped = await resolveLegacyUsersMode(payload, schoolId); // 👈
    mergeGroupedRecipients(acc, grouped, "legacy: users");
  } else if (mode === "all_school") {
    const grouped = await resolveLegacyAllSchoolMode(payload, schoolId); // 👈
    mergeGroupedRecipients(acc, grouped, "legacy: all_school");
  } else if (mode === "roles") {
    const grouped = await resolveLegacyRolesMode(payload, schoolId); // 👈
    mergeGroupedRecipients(acc, grouped, "legacy: roles");
  } else if (mode === "scope") {
    const grouped = await resolveLegacyScopeMode(payload, schoolId); // 👈
    mergeGroupedRecipients(acc, grouped, "legacy: scope");
  } else {
    throw new Error("recipient_mode غير مدعوم");
  }

  const result = finalizeAudienceResult(acc, previewLimit);

  // عيّنة للمعاينة (محمية بالمدرسة)
  const sample = await getPreviewSampleRecipients(result.recipient_user_ids, result._preview_limit, schoolId);

  delete result._preview_limit;

  return {
    ...result,
    sample,
    targets_summary: acc.target_summaries,
  };
}