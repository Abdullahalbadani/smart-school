// backend/src/modules/notifications/notificationTemplates.js

function normalizeText(v, fallback = "—") {
  return String(v ?? "").trim() || fallback;
}

function arStudentAttendanceStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["absent", "غياب", "غائب"].includes(s)) return "غياب";
  if (["late", "متأخر", "تأخير"].includes(s)) return "تأخر";
  if (["present", "حاضر"].includes(s)) return "حضور";
  if (["excused", "بعذر"].includes(s)) return "بعذر";
  return normalizeText(status, "غير محدد");
}

function permissionStatusAr(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "PENDING") return "قيد المراجعة";
  if (["APPROVED", "ACCEPTED"].includes(s)) return "مقبول";
  if (["REJECTED", "REFUSED"].includes(s)) return "مرفوض";
  return normalizeText(status, "غير محدد");
}

export function buildStudentAttendanceTemplate(ctx) {
  const statusAr = arStudentAttendanceStatus(ctx.status);
  const studentName = normalizeText(ctx.studentName, "طالب");
  const subjectName = normalizeText(ctx.subjectName);
  const sectionName = normalizeText(ctx.sectionName);
  const periodName = normalizeText(ctx.periodName);
  const teacherName = normalizeText(ctx.teacherName);
  const attendanceDate = normalizeText(ctx.attendanceDate);

  let priority = "normal";
  if (statusAr === "غياب") priority = "urgent";
  else if (statusAr === "تأخر") priority = "important";

  const title =
    statusAr === "تأخر"
      ? `تأخر الطالب ${studentName}`
      : `تم تسجيل ${statusAr} للطالب ${studentName}`;

  const extraLate =
    statusAr === "تأخر" && Number(ctx.lateMinutes) > 0
      ? `\nمدة التأخر: ${Number(ctx.lateMinutes)} دقيقة`
      : "";

  const body =
    `تم تسجيل ${statusAr} للطالب ${studentName}.` +
    `\nالتاريخ: ${attendanceDate}` +
    `\nالحصة: ${periodName}` +
    `\nالمادة: ${subjectName}` +
    `\nالفصل: ${sectionName}` +
    `\nالمعلم: ${teacherName}` +
    extraLate +
    (ctx.note ? `\nملاحظة: ${ctx.note}` : "");

  return {
    category: "attendance",
    priority,
    title,
    body,
    meta: {
      related_label: `سجل حضور رقم ${ctx.attendanceEntryId}`,
      attendance_status: String(ctx.status || ""),
      school_id: ctx.schoolId || null, // ✅ متاح للتحقق في الواجهة
    },
  };
}

export function buildPermissionRequestCreatedTemplate(ctx) {
  const studentName = normalizeText(ctx.studentName, "الطالب");
  const requestDate = normalizeText(ctx.requestDate);
  const type = normalizeText(ctx.type, "استئذان");
  const parentName = normalizeText(ctx.parentName, "ولي الأمر");

  return {
    category: "permits",
    priority: "important",
    title: `طلب استئذان جديد للطالب ${studentName}`,
    body:
      `تم إنشاء طلب ${type} جديد للطالب ${studentName}.` +
      `\nمقدم الطلب: ${parentName}` +
      `\nتاريخ الطلب: ${requestDate}` +
      (ctx.reasonText ? `\nالسبب: ${ctx.reasonText}` : ""),
    meta: {
      related_label: `طلب استئذان رقم ${ctx.permissionRequestId}`,
      request_type: String(ctx.type || ""),
      request_status: String(ctx.status || "PENDING"),
      school_id: ctx.schoolId || null,
    },
  };
}

export function buildPermissionRequestDecisionTemplate(ctx) {
  const studentName = normalizeText(ctx.studentName, "الطالب");
  const statusAr = permissionStatusAr(ctx.status);
  const requestDate = normalizeText(ctx.requestDate);

  const priority = ["مرفوض"].includes(statusAr)
    ? "important"
    : ["مقبول"].includes(statusAr)
    ? "normal"
    : "important";

  return {
    category: "permits",
    priority,
    title: `تم تحديث حالة طلب الاستئذان (${statusAr})`,
    body:
      `تم تحديث حالة طلب الاستئذان الخاص بالطالب ${studentName}.` +
      `\nالحالة الجديدة: ${statusAr}` +
      `\nتاريخ الطلب: ${requestDate}` +
      (ctx.decisionNote ? `\nملاحظة القرار: ${ctx.decisionNote}` : ""),
    meta: {
      related_label: `طلب استئذان رقم ${ctx.permissionRequestId}`,
      request_status: String(ctx.status || ""),
      school_id: ctx.schoolId || null,
    },
  };
}

export function buildAttendanceSessionLockedTemplate(ctx) {
  const sectionName = normalizeText(ctx.sectionName);
  const subjectName = normalizeText(ctx.subjectName);
  const attendanceDate = normalizeText(ctx.attendanceDate);
  const periodName = normalizeText(ctx.periodName);
  const teacherName = normalizeText(ctx.teacherName);

  const studentsCount = Number(ctx.studentsCount || 0);
  const presentCount = Number(ctx.presentCount || 0);
  const absentCount = Number(ctx.absentCount || 0);
  const lateCount = Number(ctx.lateCount || 0);
  const excusedCount = Number(ctx.excusedCount || 0);

  const priority = absentCount > 0 || lateCount > 0 ? "important" : "normal";

  return {
    category: "admin",
    priority,
    title: "تم اعتماد كشف حضور",
    body:
      `تم اعتماد كشف الحضور بنجاح.` +
      `\nالتاريخ: ${attendanceDate}` +
      `\nالفصل: ${sectionName}` +
      `\nالمادة: ${subjectName}` +
      `\nالحصة: ${periodName}` +
      `\nالمعلم: ${teacherName}` +
      `\nإجمالي الطلاب: ${studentsCount}` +
      `\nحاضر: ${presentCount} · غائب: ${absentCount} · متأخر: ${lateCount} · بعذر: ${excusedCount}`,
    meta: {
      related_label: `جلسة حضور رقم ${ctx.attendanceSessionId}`,
      school_id: ctx.schoolId || null,
      students_count: studentsCount,
      present_count: presentCount,
      absent_count: absentCount,
      late_count: lateCount,
      excused_count: excusedCount,
    },
  };
}

export function buildTeacherPermissionRequestCreatedTemplate(ctx) {
  const teacherName = normalizeText(ctx.teacherName, "معلم");
  const requestDate = normalizeText(ctx.requestDate);
  const scope = normalizeText(ctx.scope, "full_day");

  return {
    category: "permits",
    priority: "important",
    title: `طلب تصريح/استئذان جديد من المعلم ${teacherName}`,
    body:
      `تم تقديم طلب تصريح/استئذان جديد من المعلم ${teacherName}.` +
      `\nتاريخ الطلب: ${requestDate}` +
      `\nالنطاق: ${scope}` +
      (ctx.reasonText ? `\nالسبب: ${ctx.reasonText}` : ""),
    meta: {
      related_label: `طلب معلم رقم ${ctx.teacherPermissionRequestId}`,
      request_scope: scope,
      request_status: String(ctx.status || "pending"),
      school_id: ctx.schoolId || null,
    },
  };
}