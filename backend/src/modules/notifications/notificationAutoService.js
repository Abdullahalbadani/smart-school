// backend/src/modules/notifications/notificationAutoService.js
import { pool }  from "../../config/db.js";
import { createSystemNotification } from "./notificationCreateService.js";
import {
  resolveRecipientsForStudentAttendance,
  resolveRecipientsForPermissionDecision,
  resolveRecipientsForPermissionRequestCreated,
  resolveRecipientsForTeacherPermissionRequest,
  getAdminUserIds,
  getUserIdsByPermissionCodes,
  mergeUserIds,
} from "./notificationTargetsResolvers.js";
import {
  buildStudentAttendanceTemplate,
  buildPermissionRequestCreatedTemplate,
  buildPermissionRequestDecisionTemplate,
  buildAttendanceSessionLockedTemplate,
  buildTeacherPermissionRequestCreatedTemplate,
} from "./notificationTemplates.js";

function isStatusWorthNotifying(status) {
  const s = String(status || "").toLowerCase();
  return [
    "absent", "late", "excused",
    "غائب", "غياب", "متأخر", "بعذر"
  ].includes(s);
}

/**
 * إشعار تلقائي عند تسجيل/تحديث سجل حضور طالب
 * event: attendance_entries.id
 */
export async function notifyStudentAttendanceByEntryId({
  app,
  attendanceEntryId,
  includeStudent = true,
  includeAdmins = false,
  dedupeWindowSeconds = 120,
}) {
  // ✅ أضفنا سحب school_id لضمان عزل الإشعار
  const sql = `
    SELECT
      ae.id AS attendance_entry_id,
      ae.status,
      ae.late_minutes,
      ae.note,
      ae.student_id,
      COALESCE(ae.school_id, s.school_id) AS school_id,

      s.full_name AS student_name,
      s.user_id AS student_user_id,

      "as".id AS attendance_session_id,
      "as".attendance_date,
      "as".section_id,
      "as".subject_id,
      "as".teacher_id,
      "as".period_id,

      sec.name AS section_name,
      subj.name AS subject_name,
      p.name AS period_name,
      t.full_name AS teacher_name
    FROM attendance_entries ae
    JOIN students s ON s.id = ae.student_id AND s.school_id = ae.school_id
    JOIN attendance_sessions "as" ON "as".id = ae.session_id AND "as".school_id = ae.school_id
    LEFT JOIN sections sec ON sec.id = "as".section_id AND sec.school_id = "as".school_id
    LEFT JOIN subjects subj ON subj.id = "as".subject_id AND subj.school_id = "as".school_id
    LEFT JOIN periods p ON p.id = "as".period_id AND p.school_id = "as".school_id
    LEFT JOIN teachers t ON t.id = "as".teacher_id AND t.school_id = "as".school_id
    WHERE ae.id = $1
    LIMIT 1
  `;

  const result = await pool.query(sql, [attendanceEntryId]);
  const row = result.rows[0];
  if (!row) return { success: false, skipped: true, reason: "attendance_entry_not_found" };

  if (!isStatusWorthNotifying(row.status)) {
    return { success: true, skipped: true, reason: "status_not_notified" };
  }

  // ✅ نمرر schoolId للمستلمين لضمان عدم جلب مدراء مدرسة أخرى
  const recipients = await resolveRecipientsForStudentAttendance({
    studentId: row.student_id,
    schoolId: row.school_id, 
    includeAdmins,
    includeStudent,
  });

  const tpl = buildStudentAttendanceTemplate({
    attendanceEntryId: row.attendance_entry_id,
    status: row.status,
    lateMinutes: row.late_minutes,
    note: row.note,
    studentName: row.student_name,
    subjectName: row.subject_name,
    sectionName: row.section_name,
    periodName: row.period_name,
    teacherName: row.teacher_name,
    attendanceDate: row.attendance_date,
    schoolId: row.school_id,
  });

  return createSystemNotification({
    app,
    schoolId: row.school_id, // ✅ إجباري الآن للـ Multi-Tenant
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title,
    body: tpl.body,
    relatedType: "attendance_entry",
    relatedId: row.attendance_entry_id,
    meta: tpl.meta,
    recipientUserIds: recipients,
    dedupeWindowSeconds,
  });
}

/**
 * إشعار تلقائي عند إنشاء طلب استئذان طالب (permission_requests)
 */
export async function notifyPermissionRequestCreated({
  app,
  permissionRequestId,
  includeAdmins = true,
  dedupeWindowSeconds = 120,
}) {
  const sql = `
    SELECT
      pr.id AS permission_request_id,
      pr.student_id,
      pr.parent_user_id,
      pr.request_date,
      pr.type,
      pr.status,
      pr.reason_text,
      COALESCE(pr.school_id, s.school_id) AS school_id,

      s.full_name AS student_name,
      pu.name AS parent_name
    FROM permission_requests pr
    JOIN students s ON s.id = pr.student_id AND s.school_id = pr.school_id
    LEFT JOIN users pu ON pu.id = pr.parent_user_id AND pu.school_id = pr.school_id
    WHERE pr.id = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [permissionRequestId]);
  const row = result.rows[0];
  if (!row) return { success: false, skipped: true, reason: "permission_request_not_found" };

  const recipients = await resolveRecipientsForPermissionRequestCreated({
    permissionRequestId,
    schoolId: row.school_id, // ✅
    includeAdmins,
  });

  const tpl = buildPermissionRequestCreatedTemplate({
    permissionRequestId: row.permission_request_id,
    studentName: row.student_name,
    parentName: row.parent_name,
    requestDate: row.request_date,
    type: row.type,
    status: row.status,
    reasonText: row.reason_text,
    schoolId: row.school_id,
  });

  return createSystemNotification({
    app,
    schoolId: row.school_id, // ✅
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title,
    body: tpl.body,
    relatedType: "permission_request",
    relatedId: row.permission_request_id,
    meta: tpl.meta,
    recipientUserIds: recipients,
    dedupeWindowSeconds,
  });
}

/**
 * إشعار تلقائي عند تغيير حالة طلب استئذان الطالب (قبول/رفض)
 */
export async function notifyPermissionRequestDecision({
  app,
  permissionRequestId,
  includeStudent = true,
  includeAdmins = false,
  dedupeWindowSeconds = 120,
}) {
  const sql = `
    SELECT
      pr.id AS permission_request_id,
      pr.student_id,
      pr.parent_user_id,
      pr.request_date,
      pr.type,
      pr.status,
      pr.decision_note,
      COALESCE(pr.school_id, s.school_id) AS school_id,

      s.full_name AS student_name
    FROM permission_requests pr
    JOIN students s ON s.id = pr.student_id AND s.school_id = pr.school_id
    WHERE pr.id = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [permissionRequestId]);
  const row = result.rows[0];
  if (!row) return { success: false, skipped: true, reason: "permission_request_not_found" };

  const recipients = await resolveRecipientsForPermissionDecision({
    studentId: row.student_id,
    parentUserId: row.parent_user_id,
    schoolId: row.school_id, // ✅
    includeStudent,
    includeAdmins,
  });

  const tpl = buildPermissionRequestDecisionTemplate({
    permissionRequestId: row.permission_request_id,
    studentName: row.student_name,
    status: row.status,
    requestDate: row.request_date,
    decisionNote: row.decision_note,
    schoolId: row.school_id,
  });

  return createSystemNotification({
    app,
    schoolId: row.school_id, // ✅
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title,
    body: tpl.body,
    relatedType: "permission_request",
    relatedId: row.permission_request_id,
    meta: tpl.meta,
    recipientUserIds: recipients,
    dedupeWindowSeconds,
  });
}

/**
 * إشعار تلقائي عند إغلاق جلسة حضور (attendance_sessions.is_locked = true)
 */
export async function notifyAttendanceSessionLocked({
  app,
  attendanceSessionId,
  dedupeWindowSeconds = 120,
}) {
  const sql = `
    SELECT
      "as".id AS attendance_session_id,
      "as".attendance_date,
      "as".is_locked,
      "as".section_id,
      "as".subject_id,
      "as".teacher_id,
      "as".period_id,
      "as".school_id,

      (
        SELECT COUNT(*)::int
        FROM attendance_entries ae
        WHERE ae.school_id = "as".school_id
          AND ae.session_id = "as".id
      ) AS students_count,
      (
        SELECT COUNT(*)::int
        FROM attendance_entries ae
        WHERE ae.school_id = "as".school_id
          AND ae.session_id = "as".id
          AND LOWER(COALESCE(ae.status, '')) = 'present'
      ) AS present_count,
      (
        SELECT COUNT(*)::int
        FROM attendance_entries ae
        WHERE ae.school_id = "as".school_id
          AND ae.session_id = "as".id
          AND LOWER(COALESCE(ae.status, '')) = 'absent'
      ) AS absent_count,
      (
        SELECT COUNT(*)::int
        FROM attendance_entries ae
        WHERE ae.school_id = "as".school_id
          AND ae.session_id = "as".id
          AND LOWER(COALESCE(ae.status, '')) = 'late'
      ) AS late_count,
      (
        SELECT COUNT(*)::int
        FROM attendance_entries ae
        WHERE ae.school_id = "as".school_id
          AND ae.session_id = "as".id
          AND LOWER(COALESCE(ae.status, '')) = 'excused'
      ) AS excused_count,

      sec.name AS section_name,
      subj.name AS subject_name,
      p.name AS period_name,
      t.full_name AS teacher_name
    FROM attendance_sessions "as"
    LEFT JOIN sections sec ON sec.id = "as".section_id AND sec.school_id = "as".school_id
    LEFT JOIN subjects subj ON subj.id = "as".subject_id AND subj.school_id = "as".school_id
    LEFT JOIN periods p ON p.id = "as".period_id AND p.school_id = "as".school_id
    LEFT JOIN teachers t ON t.id = "as".teacher_id AND t.school_id = "as".school_id
    WHERE "as".id = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [attendanceSessionId]);
  const row = result.rows[0];
  if (!row) return { success: false, skipped: true, reason: "attendance_session_not_found" };

  if (!row.is_locked) {
    return { success: true, skipped: true, reason: "session_not_locked" };
  }

  // يصل الملخص إلى المدير، وإلى الموظف المخول بإدارة الحضور إن وُجد.
  const [adminUserIds, attendanceAuthorizedIds] = await Promise.all([
    getAdminUserIds({ schoolId: row.school_id }),
    getUserIdsByPermissionCodes({
      schoolId: row.school_id,
      codes: ["attendance.manage", "attendance.approve", "students.attendance.manage"],
    }),
  ]);
  const recipients = mergeUserIds(adminUserIds, attendanceAuthorizedIds);
  
  const tpl = buildAttendanceSessionLockedTemplate({
    attendanceSessionId: row.attendance_session_id,
    attendanceDate: row.attendance_date,
    sectionName: row.section_name,
    subjectName: row.subject_name,
    periodName: row.period_name,
    teacherName: row.teacher_name,
    studentsCount: row.students_count,
    presentCount: row.present_count,
    absentCount: row.absent_count,
    lateCount: row.late_count,
    excusedCount: row.excused_count,
    schoolId: row.school_id,
  });

  return createSystemNotification({
    app,
    schoolId: row.school_id, // ✅
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title,
    body: tpl.body,
    relatedType: "attendance_session",
    relatedId: row.attendance_session_id,
    meta: tpl.meta,
    recipientUserIds: recipients,
    dedupeWindowSeconds,
  });
}

/**
 * إشعار تلقائي عند إنشاء طلب تصريح/استئذان معلم
 */
export async function notifyTeacherPermissionRequestCreated({
  app,
  teacherPermissionRequestId,
  dedupeWindowSeconds = 120,
}) {
  const sql = `
    SELECT
      tpr.id AS teacher_permission_request_id,
      tpr.teacher_id,
      tpr.request_date,
      tpr.scope,
      tpr.status,
      tpr.reason_text,
      COALESCE(tpr.school_id, t.school_id) AS school_id,

      t.full_name AS teacher_name
    FROM teacher_permission_requests tpr
    JOIN teachers t ON t.id = tpr.teacher_id AND t.school_id = tpr.school_id
    WHERE tpr.id = $1
    LIMIT 1
  `;
  const result = await pool.query(sql, [teacherPermissionRequestId]);
  const row = result.rows[0];
  if (!row) return { success: false, skipped: true, reason: "teacher_permission_request_not_found" };

  const recipients = await resolveRecipientsForTeacherPermissionRequest({ 
    schoolId: row.school_id, // ✅
    includeAdmins: true 
  });
  
  const tpl = buildTeacherPermissionRequestCreatedTemplate({
    teacherPermissionRequestId: row.teacher_permission_request_id,
    teacherName: row.teacher_name,
    requestDate: row.request_date,
    scope: row.scope,
    status: row.status,
    reasonText: row.reason_text,
    schoolId: row.school_id,
  });

  return createSystemNotification({
    app,
    schoolId: row.school_id, // ✅
    category: tpl.category,
    priority: tpl.priority,
    title: tpl.title,
    body: tpl.body,
    relatedType: "teacher_permission_request",
    relatedId: row.teacher_permission_request_id,
    meta: tpl.meta,
    recipientUserIds: recipients,
    dedupeWindowSeconds,
  });
}

const NotificationAutoService = {
  notifyStudentAttendanceByEntryId,
  notifyPermissionRequestCreated,
  notifyPermissionRequestDecision,
  notifyAttendanceSessionLocked,
  notifyTeacherPermissionRequestCreated,
};

export default NotificationAutoService;