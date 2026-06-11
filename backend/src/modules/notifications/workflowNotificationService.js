// backend/src/modules/notifications/workflowNotificationService.js
// Notification-only hooks for existing workflows. The business transactions stay
// in their original controllers; these helpers run after a successful commit.
import { pool } from "../../config/db.js";
import { createSystemNotification } from "./notificationCreateService.js";
import {
  getAdminUserIds,
  getGuardianUserIdsByStudentId,
  getStudentAudienceUserIds,
  getUserIdsByPermissionCodes,
  mergeUserIds,
} from "./notificationTargetsResolvers.js";

function int(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(value, fallback = "—") {
  return String(value ?? "").trim() || fallback;
}

function money(value) {
  const n = Number(value || 0);
  try {
    return `${n.toLocaleString("ar-EG")} ر.س`;
  } catch {
    return `${n} ر.س`;
  }
}

function decisionAr(status) {
  const s = String(status || "").trim().toLowerCase();
  if (["approved", "accepted"].includes(s)) return "الموافقة";
  if (["rejected", "refused"].includes(s)) return "الرفض";
  if (s === "expired") return "انتهاء المهلة";
  return text(status, "تحديث الحالة");
}

async function adminAndAuthorizedUserIds({ schoolId, permissionCodes = [] }) {
  const [adminIds, authorizedIds] = await Promise.all([
    getAdminUserIds({ schoolId }),
    getUserIdsByPermissionCodes({ schoolId, codes: permissionCodes }),
  ]);
  return mergeUserIds(adminIds, authorizedIds);
}

async function send({
  app,
  schoolId,
  category,
  priority = "important",
  title,
  body,
  relatedType,
  relatedId,
  meta = {},
  recipientUserIds,
  dedupeWindowSeconds = 120,
}) {
  return createSystemNotification({
    app,
    schoolId,
    category,
    priority,
    title,
    body,
    relatedType,
    relatedId,
    meta,
    recipientUserIds,
    dedupeWindowSeconds,
  });
}

export async function notifyAssessmentReopenRequestCreated({ app, schoolId, requestId }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.reason, r.requested_by_user_id,
            COALESCE(a.title, 'التقييم') AS assessment_title,
            COALESCE(u.name, u.username, u.email, 'المعلم') AS requester_name
     FROM assessment_reopen_requests r
     JOIN assessments a ON a.id = r.assessment_id AND a.school_id = r.school_id
     LEFT JOIN users u ON u.id = r.requested_by_user_id AND u.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };

  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["assessments.reopen.approve", "grades.manage", "results.manage"],
  });

  return send({
    app,
    schoolId: sid,
    category: "assessments",
    priority: "important",
    title: "طلب إعادة فتح تقييم جديد",
    body:
      `طلب ${text(row.requester_name, "المعلم")} إعادة فتح تقييم «${text(row.assessment_title, "التقييم")}».` +
      (row.reason ? `\nالسبب: ${row.reason}` : ""),
    relatedType: "assessment_reopen_request",
    relatedId: rid,
    meta: { related_label: `طلب إعادة فتح تقييم رقم ${rid}`, action_url: "/frontend/admin/index.html" },
    recipientUserIds: recipients,
  });
}

export async function notifyAssessmentReopenRequestDecision({ app, schoolId, requestId, status }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.admin_note, r.requested_by_user_id,
            COALESCE(a.title, 'التقييم') AS assessment_title
     FROM assessment_reopen_requests r
     JOIN assessments a ON a.id = r.assessment_id AND a.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row?.requested_by_user_id) return { success: true, skipped: true, reason: "recipient_not_found" };
  const finalStatus = status || row.status;
  const label = decisionAr(finalStatus);

  return send({
    app,
    schoolId: sid,
    category: "assessments",
    priority: String(finalStatus).toLowerCase() === "rejected" ? "important" : "normal",
    title: `تم ${label} على طلب إعادة فتح التقييم`,
    body:
      `تم ${label} على طلب إعادة فتح تقييم «${text(row.assessment_title, "التقييم")}».` +
      (row.admin_note ? `\nملاحظة الإدارة: ${row.admin_note}` : ""),
    relatedType: "assessment_reopen_request",
    relatedId: rid,
    meta: { related_label: `طلب إعادة فتح تقييم رقم ${rid}`, request_status: String(finalStatus || "") },
    recipientUserIds: [row.requested_by_user_id],
  });
}

export async function notifyFeeAdjustmentRequestCreated({ app, schoolId, requestId }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.amount, r.reason,
            COALESCE(s.full_name, 'الطالب') AS student_name,
            COALESCE(u.name, u.username, u.email, 'مستخدم') AS requester_name
     FROM fee_adjustment_requests r
     JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
     LEFT JOIN users u ON u.id = r.requested_by_user_id AND u.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };

  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["fees.adjustment.approve", "fees.manage", "finance.manage"],
  });

  return send({
    app,
    schoolId: sid,
    category: "finance",
    priority: "important",
    title: "طلب تعديل رسوم جديد",
    body:
      `يوجد طلب خصم رسوم جديد للطالب ${text(row.student_name, "الطالب")} بقيمة ${money(row.amount)}.` +
      `\nمقدم الطلب: ${text(row.requester_name, "مستخدم")}` +
      (row.reason ? `\nالسبب: ${row.reason}` : ""),
    relatedType: "fee_adjustment_request",
    relatedId: rid,
    meta: { related_label: `طلب تعديل رسوم رقم ${rid}`, amount: Number(row.amount || 0) },
    recipientUserIds: recipients,
  });
}

export async function notifyFeeAdjustmentRequestDecision({ app, schoolId, requestId, status }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.amount, r.admin_note, r.requested_by_user_id, r.student_id,
            COALESCE(s.full_name, 'الطالب') AS student_name
     FROM fee_adjustment_requests r
     JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };
  const finalStatus = status || row.status;
  const approved = String(finalStatus).toLowerCase() === "approved";
  const label = decisionAr(finalStatus);

  const guardianIds = approved
    ? await getGuardianUserIdsByStudentId({ studentId: row.student_id, schoolId: sid })
    : [];
  const recipients = mergeUserIds(row.requested_by_user_id ? [row.requested_by_user_id] : [], guardianIds);

  return send({
    app,
    schoolId: sid,
    category: "finance",
    priority: approved ? "normal" : "important",
    title: `تم ${label} على طلب تعديل الرسوم`,
    body:
      `تم ${label} على طلب تعديل رسوم الطالب ${text(row.student_name, "الطالب")} بقيمة ${money(row.amount)}.` +
      (row.admin_note ? `\nملاحظة الإدارة: ${row.admin_note}` : ""),
    relatedType: "fee_adjustment_request",
    relatedId: rid,
    meta: { related_label: `طلب تعديل رسوم رقم ${rid}`, request_status: String(finalStatus || ""), amount: Number(row.amount || 0) },
    recipientUserIds: recipients,
  });
}

export async function notifyStudentTransferRequestCreated({ app, schoolId, requestId }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.reason,
            COALESCE(s.full_name, 'الطالب') AS student_name,
            COALESCE(fg.grade_name, fg.name, 'الصف الحالي') AS from_grade,
            COALESCE(fs.name, 'بدون شعبة') AS from_section,
            COALESCE(tg.grade_name, tg.name, 'الصف الهدف') AS to_grade,
            COALESCE(ts.name, 'بدون شعبة') AS to_section
     FROM student_transfer_requests r
     JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
     LEFT JOIN grades fg ON fg.id = r.from_grade_id AND fg.school_id = r.school_id
     LEFT JOIN sections fs ON fs.id = r.from_section_id AND fs.school_id = r.school_id
     LEFT JOIN grades tg ON tg.id = r.to_grade_id AND tg.school_id = r.school_id
     LEFT JOIN sections ts ON ts.id = r.to_section_id AND ts.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };

  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["students.transfer.approve", "students.manage", "admission.manage"],
  });

  return send({
    app,
    schoolId: sid,
    category: "students",
    priority: "important",
    title: "طلب نقل طالب جديد",
    body:
      `يوجد طلب جديد لنقل الطالب ${text(row.student_name, "الطالب")}.` +
      `\nمن: ${text(row.from_grade)} - ${text(row.from_section)}` +
      `\nإلى: ${text(row.to_grade)} - ${text(row.to_section)}` +
      (row.reason ? `\nالسبب: ${row.reason}` : ""),
    relatedType: "student_transfer_request",
    relatedId: rid,
    meta: { related_label: `طلب نقل طالب رقم ${rid}` },
    recipientUserIds: recipients,
  });
}

export async function notifyStudentTransferRequestDecision({ app, schoolId, requestId, status }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.admin_note, r.student_id, r.requested_by_user_id,
            COALESCE(s.full_name, 'الطالب') AS student_name,
            COALESCE(tg.grade_name, tg.name, 'الصف الهدف') AS to_grade,
            COALESCE(ts.name, 'بدون شعبة') AS to_section
     FROM student_transfer_requests r
     JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
     LEFT JOIN grades tg ON tg.id = r.to_grade_id AND tg.school_id = r.school_id
     LEFT JOIN sections ts ON ts.id = r.to_section_id AND ts.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };
  const finalStatus = status || row.status;
  const label = decisionAr(finalStatus);
  const studentAudience = await getStudentAudienceUserIds({ studentId: row.student_id, schoolId: sid, includeStudent: true });
  const recipients = mergeUserIds(studentAudience, row.requested_by_user_id ? [row.requested_by_user_id] : []);

  return send({
    app,
    schoolId: sid,
    category: "students",
    priority: "important",
    title: `تم ${label} على طلب نقل الطالب`,
    body:
      `تم ${label} على طلب نقل الطالب ${text(row.student_name, "الطالب")} إلى ${text(row.to_grade)} - ${text(row.to_section)}.` +
      (row.admin_note ? `\nملاحظة الإدارة: ${row.admin_note}` : ""),
    relatedType: "student_transfer_request",
    relatedId: rid,
    meta: { related_label: `طلب نقل طالب رقم ${rid}`, request_status: String(finalStatus || "") },
    recipientUserIds: recipients,
  });
}

export async function notifyTeacherPermissionDecision({ app, schoolId, requestId, status }) {
  const sid = int(schoolId);
  const rid = int(requestId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.request_date, r.decision_note,
            t.user_id AS teacher_user_id, COALESCE(t.full_name, 'المعلم') AS teacher_name
     FROM teacher_permission_requests r
     JOIN teachers t ON t.id = r.teacher_id AND t.school_id = r.school_id
     WHERE r.id = $1 AND r.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row?.teacher_user_id) return { success: true, skipped: true, reason: "recipient_not_found" };
  const finalStatus = status || row.status;
  const label = decisionAr(finalStatus);

  return send({
    app,
    schoolId: sid,
    category: "permits",
    priority: String(finalStatus).toLowerCase() === "rejected" ? "important" : "normal",
    title: `تم ${label} على طلب الإذن`,
    body:
      `تم ${label} على طلب إذنك بتاريخ ${text(row.request_date)}.` +
      (row.decision_note ? `\nملاحظة الإدارة: ${row.decision_note}` : ""),
    relatedType: "teacher_permission_request",
    relatedId: rid,
    meta: { related_label: `طلب إذن معلم رقم ${rid}`, request_status: String(finalStatus || "") },
    recipientUserIds: [row.teacher_user_id],
  });
}

export async function notifySubstitutionAssigned({ app, schoolId, substitutionId }) {
  const sid = int(schoolId);
  const rid = int(substitutionId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT ls.id, ls.substitution_date, st.user_id AS substitute_user_id,
            COALESCE(at.full_name, 'المعلم') AS absent_teacher_name,
            COALESCE(p.name, 'الحصة') AS period_name,
            COALESCE(sub.name, 'المادة') AS subject_name,
            COALESCE(sec.name, 'الشعبة') AS section_name
     FROM lesson_substitutions ls
     JOIN teachers st ON st.id = ls.substitute_teacher_id AND st.school_id = ls.school_id
     LEFT JOIN teachers at ON at.id = ls.absent_teacher_id AND at.school_id = ls.school_id
     LEFT JOIN timetable_entries te ON te.id = ls.timetable_entry_id AND te.school_id = ls.school_id
     LEFT JOIN periods p ON p.id = te.period_id AND p.school_id = ls.school_id
     LEFT JOIN subjects sub ON sub.id = te.subject_id AND sub.school_id = ls.school_id
     LEFT JOIN timetables tt ON tt.id = te.timetable_id AND tt.school_id = ls.school_id
     LEFT JOIN sections sec ON sec.id = tt.section_id AND sec.school_id = ls.school_id
     WHERE ls.id = $1 AND ls.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row?.substitute_user_id) return { success: true, skipped: true, reason: "recipient_not_found" };

  return send({
    app,
    schoolId: sid,
    category: "timetables",
    priority: "important",
    title: "طلب تغطية حصة بديلة",
    body:
      `يوجد طلب لتغطية حصة بديلة بتاريخ ${text(row.substitution_date)}.` +
      `\nالمعلم الغائب: ${text(row.absent_teacher_name)}` +
      `\nالحصة: ${text(row.period_name)}` +
      `\nالمادة: ${text(row.subject_name)}` +
      `\nالشعبة: ${text(row.section_name)}`,
    relatedType: "lesson_substitution",
    relatedId: rid,
    meta: { related_label: `طلب تغطية حصة رقم ${rid}` },
    recipientUserIds: [row.substitute_user_id],
  });
}

export async function notifySubstitutionResponse({ app, schoolId, substitutionId, status }) {
  const sid = int(schoolId);
  const rid = int(substitutionId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT ls.id, ls.status, ls.substitution_date,
            COALESCE(t.full_name, 'المعلم') AS substitute_teacher_name
     FROM lesson_substitutions ls
     LEFT JOIN teachers t ON t.id = ls.substitute_teacher_id AND t.school_id = ls.school_id
     WHERE ls.id = $1 AND ls.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "request_not_found" };
  const finalStatus = status || row.status;
  const label = decisionAr(finalStatus);
  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["teacher_permits.manage", "timetables.manage"],
  });

  return send({
    app,
    schoolId: sid,
    category: "timetables",
    priority: ["rejected", "expired"].includes(String(finalStatus).toLowerCase()) ? "urgent" : "normal",
    title: `تم ${label} على طلب تغطية الحصة`,
    body: `تم ${label} من المعلم ${text(row.substitute_teacher_name)} على طلب تغطية الحصة بتاريخ ${text(row.substitution_date)}.`,
    relatedType: "lesson_substitution",
    relatedId: rid,
    meta: { related_label: `طلب تغطية حصة رقم ${rid}`, request_status: String(finalStatus || "") },
    recipientUserIds: recipients,
  });
}

export async function notifyBackupFailure({ app, schoolId, errorMessage = "" }) {
  const sid = int(schoolId);
  if (!sid) return { success: true, skipped: true, reason: "invalid_input" };

  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["backups.manage", "backup.manage", "system.backups.manage"],
  });

  return send({
    app,
    schoolId: sid,
    category: "backups",
    priority: "urgent",
    title: "فشل النسخ الاحتياطي التلقائي",
    body:
      "تعذر إنشاء النسخة الاحتياطية التلقائية للمدرسة. يرجى مراجعة إعدادات النسخ الاحتياطي أو التواصل مع الدعم الفني." +
      (errorMessage ? `\nالتفاصيل المختصرة: ${text(errorMessage).slice(0, 300)}` : ""),
    relatedType: "backup_auto_failure",
    relatedId: null,
    meta: { related_label: "فشل نسخة احتياطية تلقائية" },
    recipientUserIds: recipients,
    dedupeWindowSeconds: 3600,
  });
}



export async function notifyRepeatedLoginFailures({
  app,
  schoolId,
  userId = null,
  loginValue = "",
  reason = "",
  threshold = 5,
  windowMinutes = 15,
}) {
  const sid = int(schoolId);
  if (!sid) return { success: true, skipped: true, reason: "invalid_input" };

  const uid = int(userId);
  const login = text(loginValue, "حساب غير معروف").slice(0, 160);
  const attemptsThreshold = Math.max(3, Math.min(20, Number(threshold) || 5));
  const minutes = Math.max(5, Math.min(120, Number(windowMinutes) || 15));

  const params = [sid, minutes];
  let accountFilter = "";

  if (uid) {
    params.push(uid);
    accountFilter = `AND al.record_id = $${params.length}`;
  } else {
    params.push(login.toLowerCase());
    accountFilter = `AND LOWER(COALESCE(al.new_data->>'username', '')) = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS attempts_count
     FROM activity_logs al
     WHERE al.school_id = $1
       AND COALESCE(al.metadata->>'event_key', '') = 'LOGIN_FAILED'
       AND al.created_at >= NOW() - make_interval(mins => $2::int)
       ${accountFilter}`,
    params
  );

  const attemptsCount = Number(rows[0]?.attempts_count || 0);
  if (attemptsCount < attemptsThreshold) {
    return { success: true, skipped: true, reason: "threshold_not_reached" };
  }

  const recipients = await adminAndAuthorizedUserIds({
    schoolId: sid,
    permissionCodes: ["security.manage", "users.manage", "rbac.manage_users"],
  });

  return send({
    app,
    schoolId: sid,
    category: "security",
    priority: "urgent",
    title: "تنبيه أمني: محاولات دخول فاشلة متكررة",
    body:
      `تم رصد محاولات دخول فاشلة متكررة للحساب (${login}) خلال ${minutes} دقيقة. ` +
      `يرجى مراجعة سجل الأحداث واتخاذ الإجراء المناسب.` +
      (reason ? `\nآخر سبب مسجل: ${text(reason).slice(0, 220)}` : ""),
    relatedType: "security_login_failure",
    relatedId: uid,
    meta: {
      related_label: `محاولات دخول فاشلة للحساب ${login}`,
      login_value: login,
      attempts_count: attemptsCount,
      threshold: attemptsThreshold,
      window_minutes: minutes,
    },
    recipientUserIds: recipients,
    dedupeWindowSeconds: minutes * 60,
  });
}

function idsFromRows(rows = []) {
  return mergeUserIds((rows || []).map((row) => row.user_id));
}

function termAr(term) {
  const n = Number(term);
  if (n === 1) return "الفصل الأول";
  if (n === 2) return "الفصل الثاني";
  return "الفصل الدراسي";
}

function examTypeAr(type, month = null) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "monthly") return month ? `الاختبار الشهري للشهر ${month}` : "الاختبار الشهري";
  if (normalized === "midyear") return "اختبارات منتصف العام";
  if (normalized === "final") return "الاختبارات النهائية";
  return "الاختبارات";
}

async function getAcademicScopeAudienceUserIds({
  schoolId,
  academicYearId,
  term = null,
  gradeId = null,
  sectionId = null,
  includeStudents = true,
  includeGuardians = true,
}) {
  const sid = int(schoolId);
  const yearId = int(academicYearId);
  if (!sid || !yearId) return [];

  const params = [sid, yearId];
  const conditions = [
    "se.school_id = $1",
    "se.academic_year_id = $2",
    "COALESCE(se.status, 'enrolled') = 'enrolled'",
  ];

  if (term != null && Number(term) > 0) {
    params.push(Number(term));
    conditions.push(`se.term = $${params.length}`);
  }
  if (gradeId) {
    params.push(Number(gradeId));
    conditions.push(`se.grade_id = $${params.length}`);
  }
  if (sectionId) {
    params.push(Number(sectionId));
    conditions.push(`se.section_id = $${params.length}`);
  }

  const scopedWhere = conditions.join(" AND ");
  const unions = [];

  if (includeStudents) {
    unions.push(`
      SELECT s.user_id
      FROM student_enrollments se
      JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
      WHERE ${scopedWhere}
        AND s.user_id IS NOT NULL
    `);
  }

  if (includeGuardians) {
    unions.push(`
      SELECT g.user_id
      FROM student_enrollments se
      JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
      JOIN student_guardians sg ON sg.student_id = s.id AND sg.school_id = s.school_id
      JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id
      WHERE ${scopedWhere}
        AND g.user_id IS NOT NULL
    `);
  }

  if (!unions.length) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT audience.user_id
     FROM (${unions.join(" UNION ")}) audience
     WHERE audience.user_id IS NOT NULL`,
    params
  );

  return idsFromRows(rows);
}

async function getTermResultAudienceUserIds({ schoolId, batchId }) {
  const sid = int(schoolId);
  const rid = int(batchId);
  if (!sid || !rid) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT audience.user_id
     FROM (
       SELECT s.user_id
       FROM term_result_students trs
       JOIN students s ON s.id = trs.student_id AND s.school_id = trs.school_id
       WHERE trs.batch_id = $1 AND trs.school_id = $2 AND s.user_id IS NOT NULL
       UNION
       SELECT g.user_id
       FROM term_result_students trs
       JOIN students s ON s.id = trs.student_id AND s.school_id = trs.school_id
       JOIN student_guardians sg ON sg.student_id = s.id AND sg.school_id = s.school_id
       JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = sg.school_id
       WHERE trs.batch_id = $1 AND trs.school_id = $2 AND g.user_id IS NOT NULL
     ) audience
     WHERE audience.user_id IS NOT NULL`,
    [rid, sid]
  );

  return idsFromRows(rows);
}

export async function notifyTermResultsPublication({ app, schoolId, batchId, published = true }) {
  const sid = int(schoolId);
  const rid = int(batchId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT b.id, b.term, b.grade_id, b.section_id,
            COALESCE(g.grade_name, g.name, 'الصف') AS grade_name,
            COALESCE(sec.name, 'الشعبة') AS section_name
     FROM term_result_batches b
     JOIN grades g ON g.id = b.grade_id AND g.school_id = b.school_id
     JOIN sections sec ON sec.id = b.section_id AND sec.school_id = b.school_id
     WHERE b.id = $1 AND b.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "batch_not_found" };

  const recipients = await getTermResultAudienceUserIds({ schoolId: sid, batchId: rid });
  const termLabel = termAr(row.term);

  return send({
    app,
    schoolId: sid,
    category: "results",
    priority: "important",
    title: published ? "تم نشر نتائج الفصل الدراسي" : "تم إيقاف عرض نتائج الفصل الدراسي مؤقتًا",
    body: published
      ? `تم نشر نتائج ${termLabel} للصف ${text(row.grade_name)} - ${text(row.section_name)}. يمكنك الدخول إلى بوابة النتائج للاطلاع على النتيجة.`
      : `تم إيقاف عرض نتائج ${termLabel} للصف ${text(row.grade_name)} - ${text(row.section_name)} مؤقتًا لإجراء مراجعة إدارية.`,
    relatedType: "term_result_batch",
    relatedId: rid,
    meta: {
      related_label: `نتائج ${termLabel} - ${text(row.grade_name)} - ${text(row.section_name)}`,
      publication_status: published ? "published" : "unpublished",
    },
    recipientUserIds: recipients,
    dedupeWindowSeconds: 300,
  });
}

export async function notifyAssessmentPublished({ app, schoolId, assessmentId }) {
  const sid = int(schoolId);
  const rid = int(assessmentId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.type, a.due_at,
            ta.academic_year_id, ta.term, ta.section_id,
            COALESCE(sub.name, 'المادة') AS subject_name,
            COALESCE(sec.name, 'الشعبة') AS section_name
     FROM assessments a
     JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id AND ta.school_id = a.school_id
     JOIN subjects sub ON sub.id = ta.subject_id AND sub.school_id = a.school_id
     JOIN sections sec ON sec.id = ta.section_id AND sec.school_id = a.school_id
     WHERE a.id = $1 AND a.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "assessment_not_found" };

  const recipients = await getAcademicScopeAudienceUserIds({
    schoolId: sid,
    academicYearId: row.academic_year_id,
    term: row.term,
    sectionId: row.section_id,
    includeStudents: true,
    includeGuardians: false,
  });

  const dueText = row.due_at ? `\nآخر موعد: ${new Date(row.due_at).toLocaleString("ar-EG")}` : "";
  const isExam = String(row.type || "").toLowerCase() === "exam";

  return send({
    app,
    schoolId: sid,
    category: "learning",
    priority: isExam ? "important" : "normal",
    title: isExam ? "تم نشر اختبار جديد" : "تم نشر تقييم أو واجب جديد",
    body: `تم نشر «${text(row.title, "تقييم جديد")}» في مادة ${text(row.subject_name)} للشعبة ${text(row.section_name)}.${dueText}`,
    relatedType: "assessment",
    relatedId: rid,
    meta: {
      related_label: text(row.title, `التقييم رقم ${rid}`),
      action_url: "/frontend/student/index.html",
      assessment_type: String(row.type || ""),
    },
    recipientUserIds: recipients,
    dedupeWindowSeconds: 300,
  });
}

export async function notifyWeeklyTimetablePublication({ app, schoolId, timetableId, published = true }) {
  const sid = int(schoolId);
  const rid = int(timetableId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT tt.id, tt.academic_year_id, tt.term, tt.section_id,
            COALESCE(g.grade_name, g.name, 'الصف') AS grade_name,
            COALESCE(sec.name, 'الشعبة') AS section_name
     FROM timetables tt
     JOIN grades g ON g.id = tt.grade_id AND g.school_id = tt.school_id
     JOIN sections sec ON sec.id = tt.section_id AND sec.school_id = tt.school_id
     WHERE tt.id = $1 AND tt.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "timetable_not_found" };

  const [studentGuardianIds, teacherRows] = await Promise.all([
    getAcademicScopeAudienceUserIds({
      schoolId: sid,
      academicYearId: row.academic_year_id,
      term: row.term,
      sectionId: row.section_id,
      includeStudents: true,
      includeGuardians: true,
    }),
    pool.query(
      `SELECT DISTINCT teacher_users.user_id
       FROM (
         SELECT t.user_id
         FROM timetable_entries te
         JOIN teachers t ON t.id = te.teacher_id AND t.school_id = te.school_id
         WHERE te.timetable_id = $1
           AND te.school_id = $2
           AND t.user_id IS NOT NULL
         UNION
         SELECT t.user_id
         FROM timetable_overrides tov
         JOIN teachers t ON t.id = tov.teacher_id AND t.school_id = tov.school_id
         WHERE tov.timetable_id = $1
           AND tov.school_id = $2
           AND tov.teacher_id IS NOT NULL
           AND t.user_id IS NOT NULL
       ) teacher_users`,
      [rid, sid]
    ),
  ]);
  const recipients = mergeUserIds(studentGuardianIds, idsFromRows(teacherRows.rows));

  return send({
    app,
    schoolId: sid,
    category: "timetables",
    priority: "important",
    title: published ? "تم نشر جدول الحصص" : "تم إيقاف نشر جدول الحصص مؤقتًا",
    body: published
      ? `تم نشر جدول الحصص للصف ${text(row.grade_name)} - ${text(row.section_name)} (${termAr(row.term)}).`
      : `تم إيقاف عرض جدول الحصص للصف ${text(row.grade_name)} - ${text(row.section_name)} مؤقتًا لإجراء تعديل.`,
    relatedType: "timetable",
    relatedId: rid,
    meta: {
      related_label: `جدول ${text(row.grade_name)} - ${text(row.section_name)}`,
      publication_status: published ? "published" : "unpublished",
    },
    recipientUserIds: recipients,
    dedupeWindowSeconds: 300,
  });
}

export async function notifyExamTimetablePublication({ app, schoolId, timetableId, published = true }) {
  const sid = int(schoolId);
  const rid = int(timetableId);
  if (!sid || !rid) return { success: true, skipped: true, reason: "invalid_input" };

  const { rows } = await pool.query(
    `SELECT et.id, et.academic_year_id, et.grade_id, et.section_id, et.scope, et.exam_type, et.month,
            COALESCE(g.grade_name, g.name, 'الصف') AS grade_name,
            COALESCE(sec.name, 'جميع الشعب') AS section_name
     FROM exam_timetables et
     JOIN grades g ON g.id = et.grade_id AND g.school_id = et.school_id
     LEFT JOIN sections sec ON sec.id = et.section_id AND sec.school_id = et.school_id
     WHERE et.id = $1 AND et.school_id = $2
     LIMIT 1`,
    [rid, sid]
  );
  const row = rows[0];
  if (!row) return { success: true, skipped: true, reason: "exam_timetable_not_found" };

  const recipients = await getAcademicScopeAudienceUserIds({
    schoolId: sid,
    academicYearId: row.academic_year_id,
    gradeId: row.grade_id,
    sectionId: String(row.scope) === "section" ? row.section_id : null,
    includeStudents: true,
    includeGuardians: true,
  });
  const examLabel = examTypeAr(row.exam_type, row.month);

  return send({
    app,
    schoolId: sid,
    category: "exams",
    priority: "important",
    title: published ? "تم نشر جدول الاختبارات" : "تم إيقاف نشر جدول الاختبارات مؤقتًا",
    body: published
      ? `تم نشر جدول ${examLabel} للصف ${text(row.grade_name)} - ${text(row.section_name)}.`
      : `تم إيقاف عرض جدول ${examLabel} للصف ${text(row.grade_name)} - ${text(row.section_name)} مؤقتًا لإجراء تعديل.`,
    relatedType: "exam_timetable",
    relatedId: rid,
    meta: {
      related_label: `${examLabel} - ${text(row.grade_name)} - ${text(row.section_name)}`,
      publication_status: published ? "published" : "unpublished",
    },
    recipientUserIds: recipients,
    dedupeWindowSeconds: 300,
  });
}

export default {
  notifyAssessmentReopenRequestCreated,
  notifyAssessmentReopenRequestDecision,
  notifyFeeAdjustmentRequestCreated,
  notifyFeeAdjustmentRequestDecision,
  notifyStudentTransferRequestCreated,
  notifyStudentTransferRequestDecision,
  notifyTeacherPermissionDecision,
  notifySubstitutionAssigned,
  notifySubstitutionResponse,
  notifyBackupFailure,
  notifyRepeatedLoginFailures,
  notifyTermResultsPublication,
  notifyAssessmentPublished,
  notifyWeeklyTimetablePublication,
  notifyExamTimetablePublication,
};
