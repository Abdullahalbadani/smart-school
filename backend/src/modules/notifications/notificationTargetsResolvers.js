// backend/src/modules/notifications/notificationTargetsResolvers.js
import { pool } from "../../config/db.js";

function uniqIds(ids = []) {
  return [...new Set(
    ids.map(Number).filter((x) => Number.isInteger(x) && x > 0)
  )];
}

export async function getAdminUserIds({ schoolId }) {
  if (!schoolId) return [];
  // يعتمد على roles.name + school_id
  const sql = `
    SELECT DISTINCT u.id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id AND ur.school_id = u.school_id
    JOIN roles r ON r.id = ur.role_id AND r.school_id = u.school_id
    WHERE u.status = 'active'
      AND u.school_id = $1
      AND (
        LOWER(COALESCE(r.name, '')) IN ('admin', 'administrator', 'super_admin', 'superadmin', 'school_admin', 'school-admin')
        OR COALESCE(r.name, '') ILIKE '%مدير%'
      )
  `;
  const result = await pool.query(sql, [schoolId]);
  return uniqIds(result.rows.map((r) => r.id));
}


export async function getUserIdsByPermissionCodes({ schoolId, codes = [] } = {}) {
  const cleanCodes = [...new Set((Array.isArray(codes) ? codes : [])
    .map((code) => String(code || "").trim())
    .filter(Boolean))];

  if (!schoolId || !cleanCodes.length) return [];

  const sql = `
    SELECT DISTINCT u.id
    FROM users u
    JOIN user_roles ur
      ON ur.user_id = u.id
     AND ur.school_id = u.school_id
    JOIN roles r
      ON r.id = ur.role_id
     AND r.school_id = u.school_id
    JOIN role_permissions rp
      ON rp.role_id = r.id
     AND rp.school_id = u.school_id
    JOIN permissions p
      ON p.id = rp.permission_id
    WHERE u.school_id = $1
      AND COALESCE(u.status, 'active') = 'active'
      AND p.code = ANY($2::text[])
  `;

  const result = await pool.query(sql, [schoolId, cleanCodes]);
  return uniqIds(result.rows.map((row) => row.id));
}

export async function getStudentAudienceUserIds({ studentId, schoolId, includeStudent = true } = {}) {
  const [guardianUserIds, studentUserId] = await Promise.all([
    getGuardianUserIdsByStudentId({ studentId, schoolId }),
    includeStudent ? getStudentUserId({ studentId, schoolId }) : Promise.resolve(null),
  ]);

  return mergeUserIds(guardianUserIds, studentUserId ? [studentUserId] : []);
}

export async function getStudentUserId({ studentId, schoolId }) {
  if (!studentId || !schoolId) return null;
  const sql = `
    SELECT user_id
    FROM students
    WHERE id = $1 AND school_id = $2
    LIMIT 1
  `;
  const result = await pool.query(sql, [studentId, schoolId]);
  const userId = result.rows[0]?.user_id;
  return Number.isInteger(Number(userId)) ? Number(userId) : null;
}

export async function getGuardianUserIdsByStudentId({ studentId, schoolId }) {
  if (!studentId || !schoolId) return [];
  const sql = `
    SELECT DISTINCT g.user_id AS user_id
    FROM student_guardians sg
    JOIN guardians g ON g.id = sg.guardian_id
    WHERE sg.student_id = $1
      AND sg.school_id = $2
      AND g.school_id = $2
      AND g.user_id IS NOT NULL
  `;
  const result = await pool.query(sql, [studentId, schoolId]);
  return uniqIds(result.rows.map((r) => r.user_id));
}

export async function getTeacherUserIdByTeacherId({ teacherId, schoolId }) {
  if (!teacherId || !schoolId) return null;
  const sql = `
    SELECT user_id
    FROM teachers
    WHERE id = $1 AND school_id = $2
    LIMIT 1
  `;
  const result = await pool.query(sql, [teacherId, schoolId]);
  const userId = result.rows[0]?.user_id;
  return Number.isInteger(Number(userId)) ? Number(userId) : null;
}

export async function getTeacherUserIdsByPermissionRequestRecipients({ permissionRequestId, schoolId }) {
  if (!permissionRequestId || !schoolId) return [];
  const sql = `
    SELECT DISTINCT t.user_id
    FROM permission_request_recipients prr
    JOIN teachers t ON t.id = prr.teacher_id
    WHERE prr.request_id = $1
      AND prr.school_id = $2
      AND t.school_id = $2
      AND t.user_id IS NOT NULL
  `;
  const result = await pool.query(sql, [permissionRequestId, schoolId]);
  return uniqIds(result.rows.map((r) => r.user_id));
}

export async function getTeacherUserIdsByStudentCurrentEnrollment({ studentId, schoolId }) {
  if (!studentId || !schoolId) return [];
  // يجلب معلمي الطالب بناءً على آخر قيد student_enrollments لنفس المدرسة
  const sql = `
    WITH latest_enrollment AS (
      SELECT se.*
      FROM student_enrollments se
      WHERE se.student_id = $1 AND se.school_id = $2
      ORDER BY se.id DESC
      LIMIT 1
    )
    SELECT DISTINCT t.user_id
    FROM latest_enrollment le
    JOIN section_subject_teachers sst
      ON sst.section_id = le.section_id
     AND sst.academic_year_id = le.academic_year_id
     AND sst.school_id = le.school_id
     AND COALESCE(sst.status, 'active') = 'active'
    JOIN teachers t ON t.id = sst.teacher_id AND t.school_id = le.school_id
    WHERE t.user_id IS NOT NULL AND t.school_id = $2
  `;
  const result = await pool.query(sql, [studentId, schoolId]);
  return uniqIds(result.rows.map((r) => r.user_id));
}

export function mergeUserIds(...lists) {
  return uniqIds(lists.flat().filter(Boolean));
}

/**
 * مستلمين حدث حضور طالب (الإدارة + أولياء الأمر + الطالب اختياري) - محمي بالمدرسة
 */
export async function resolveRecipientsForStudentAttendance({
  studentId,
  schoolId,
  includeAdmins = false,
  includeStudent = true,
}) {
  const [guardianUserIds, adminUserIds, studentUserId] = await Promise.all([
    getGuardianUserIdsByStudentId({ studentId, schoolId }),
    includeAdmins ? getAdminUserIds({ schoolId }) : Promise.resolve([]),
    includeStudent ? getStudentUserId({ studentId, schoolId }) : Promise.resolve(null),
  ]);

  return mergeUserIds(
    guardianUserIds,
    adminUserIds,
    studentUserId ? [studentUserId] : []
  );
}

/**
 * مستلمين قرار استئذان طالب (ولي الأمر + الطالب + الإدارة اختياري) - محمي بالمدرسة
 */
export async function resolveRecipientsForPermissionDecision({
  studentId,
  schoolId,
  parentUserId = null,
  includeStudent = true,
  includeAdmins = false,
}) {
  const [studentUserId, adminUserIds] = await Promise.all([
    includeStudent ? getStudentUserId({ studentId, schoolId }) : Promise.resolve(null),
    includeAdmins ? getAdminUserIds({ schoolId }) : Promise.resolve([]),
  ]);

  return mergeUserIds(
    parentUserId ? [parentUserId] : [],
    studentUserId ? [studentUserId] : [],
    adminUserIds
  );
}

/**
 * مستلمين إنشاء طلب استئذان طالب (الإدارة + المعلمون المستلمون) - محمي بالمدرسة
 */
export async function resolveRecipientsForPermissionRequestCreated({
  permissionRequestId,
  schoolId,
  includeAdmins = true,
}) {
  const [teacherRecipientUserIds, adminUserIds] = await Promise.all([
    getTeacherUserIdsByPermissionRequestRecipients({ permissionRequestId, schoolId }),
    includeAdmins ? getAdminUserIds({ schoolId }) : Promise.resolve([]),
  ]);

  return mergeUserIds(teacherRecipientUserIds, adminUserIds);
}

/**
 * مستلمين طلب تصريح/استئذان معلم (الإدارة) - محمي بالمدرسة
 */
export async function resolveRecipientsForTeacherPermissionRequest({ schoolId, includeAdmins = true } = {}) {
  const [adminUserIds, authorizedUserIds] = await Promise.all([
    includeAdmins ? getAdminUserIds({ schoolId }) : Promise.resolve([]),
    getUserIdsByPermissionCodes({
      schoolId,
      codes: ["teacher_permits.manage", "attendance.manage", "timetables.manage"],
    }),
  ]);
  return mergeUserIds(adminUserIds, authorizedUserIds);
}