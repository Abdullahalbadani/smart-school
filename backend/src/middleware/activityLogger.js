// backend/src/middleware/activityLogger.js
import { pool } from "../config/db.js";
import { cleanSensitiveData, logActivity } from "../utils/logger.js";

const TABLE_ALLOWLIST = new Set([
  "academic_years",
  "assessments",
  "assessment_reopen_requests",
  "attendance_sessions",
  "attendance_entries",
  "backup_logs",
  "backup_settings",
  "employees",
  "exam_timetables",
  "fee_adjustment_requests",
  "fee_contracts",
  "fee_payments",
  "fee_rules",
  "grades",
  "guardians",
  "modules",
  "monthly_work_approvals",
  "notifications",
  "periods",
  "permission_requests",
  "permissions",
  "role_permissions",
  "roles",
  "school_settings",
  "sections",
  "stages",
  "student_certificates",
  "student_enrollments",
  "student_monthly_certificates",
  "student_transfer_requests",
  "students",
  "subjects",
  "teacher_attendance_days",
  "teacher_attendance_entries",
  "teacher_permission_requests",
  "term_result_batches",
  "term_work_approvals",
  "timetables",
  "users",
]);

const TABLE_METADATA_CACHE = new Map();

const MODULE_LABELS = {
  Security: "الأمان وتسجيل الدخول",
  users: "المستخدمون",
  roles: "الأدوار والصلاحيات",
  permissions: "الصلاحيات",
  students: "الطلاب",
  guardians: "أولياء الأمور",
  employees: "الموظفون والمعلمون",
  "school-settings": "إعدادات المدرسة",
  "academic-years": "السنوات الدراسية",
  stages: "المراحل الدراسية",
  grades: "الصفوف الدراسية",
  sections: "الشعب الدراسية",
  subjects: "المواد الدراسية",
  periods: "الحصص الدراسية",
  curriculum: "الخطة الدراسية",
  "assign-teachers": "توزيع المعلمين",
  attendance: "الحضور والغياب",
  assessments: "الاختبارات والتقييمات",
  results: "النتائج الدراسية",
  fees: "الرسوم والمدفوعات",
  "fee-rules": "قواعد الرسوم",
  "fee-adjustments": "طلبات تعديل الرسوم",
  reports: "التقارير المدرسية",
  backups: "النسخ الاحتياطية",
  notifications: "الإشعارات والرسائل",
  timetables: "الجداول الدراسية",
  certificates: "الشهادات",
  transfers: "طلبات نقل الطلاب",
  permits: "الأذونات",
  learning: "الأنشطة التعليمية",
  system: "النظام",
};

const TARGET_NOUNS = {
  users: "المستخدم",
  roles: "الدور",
  permissions: "الصلاحية",
  students: "الطالب",
  guardians: "ولي الأمر",
  employees: "الموظف",
  "school-settings": "الإعداد",
  "academic-years": "السنة الدراسية",
  stages: "المرحلة",
  grades: "الصف",
  sections: "الشعبة",
  subjects: "المادة",
  periods: "الحصة",
  assessments: "التقييم",
  attendance: "سجل الحضور",
  fees: "السجل المالي",
  "fee-rules": "قاعدة الرسوم",
  "fee-adjustments": "طلب تعديل الرسوم",
  reports: "التقرير",
  backups: "النسخة الاحتياطية",
  notifications: "الإشعار",
  timetables: "الجدول",
  certificates: "الشهادة",
  transfers: "طلب النقل",
  permits: "الإذن",
  learning: "النشاط",
  system: "السجل",
};

function methodAction(method) {
  const normalized = String(method || "").toUpperCase();
  if (normalized === "POST") return "CREATE";
  if (normalized === "PUT" || normalized === "PATCH") return "UPDATE";
  if (normalized === "DELETE") return "DELETE";
  return "ACTIVITY";
}

function actionVerb(action) {
  const verbs = {
    VIEW: "استعرض",
    CREATE: "أضاف",
    UPDATE: "عدّل",
    DELETE: "حذف",
    APPROVE: "اعتمد",
    REJECT: "رفض",
    PUBLISH: "نشر",
    UNPUBLISH: "ألغى نشر",
    PRINT: "طبع",
    EXPORT: "صدّر",
    IMPORT: "استورد",
    ISSUE: "أصدر",
    CANCEL: "ألغى",
    LOCK: "أغلق",
    UNLOCK: "أعاد فتح",
    ACTIVATE: "فعّل",
    DEACTIVATE: "عطّل",
    RESTORE: "استعاد",
    DOWNLOAD: "نزّل",
    SEND: "أرسل",
    SUBMIT: "سلّم",
    TRANSFER: "نقل",
    RESET: "أعاد تعيين",
    DENY: "رفض الوصول إلى",
  };
  return verbs[action] || "نفّذ عملية على";
}

function routeRule(match, config = {}) {
  return { match, ...config };
}

const RULES = [
  // ضوضاء لا تفيد المدير في سجل التدقيق الرئيسي
  routeRule(/\/api\/admin\/school-reports\/.+\/preview\/?$/i, { skip: true }),
  routeRule(/\/api\/notifications\/admin\/preview-recipients\/?$/i, { skip: true }),
  routeRule(/\/api\/(?:notifications|teacher\/notifications|student\/notifications|parent\/notifications)\/inbox(?:\/read-all|\/\d+\/read)\/?$/i, { skip: true }),
  routeRule(/\/api\/ai(?:\/|$)/i, { skip: true }),

  // التقارير: لا نسجل المعاينة، لكن نسجل التصدير والطباعة
  routeRule(/\/api\/admin\/school-reports\/.+\/pdf\/?$/i, {
    action: "EXPORT",
    actionLabel: "تصدير تقرير PDF",
    eventKey: "REPORT_EXPORT_PDF",
    module: "reports",
    severity: "important",
    visibility: "dashboard",
  }),
  routeRule(/\/api\/admin\/school-reports\/.+\/print\/?$/i, {
    action: "PRINT",
    actionLabel: "طباعة تقرير",
    eventKey: "REPORT_PRINT",
    module: "reports",
    severity: "important",
    visibility: "dashboard",
  }),
  routeRule(/\/api\/teacher\/reports\/generate\/?$/i, {
    action: "EXPORT",
    actionLabel: "إنشاء تقرير معلم",
    eventKey: "TEACHER_REPORT_GENERATE",
    module: "reports",
    severity: "normal",
    visibility: "full_log",
  }),

  // النسخ الاحتياطية وربط Google Drive
  routeRule(/\/api\/admin\/backups\/settings\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل إعدادات النسخ الاحتياطي",
    eventKey: "BACKUP_SETTINGS_UPDATE",
    module: "backups",
    tableName: "backup_settings",
    severity: "sensitive",
  }),
  routeRule(/\/api\/admin\/backups\/google-drive-disconnect\/?$/i, {
    action: "DELETE",
    actionLabel: "إلغاء ربط Google Drive",
    eventKey: "GOOGLE_DRIVE_UNLINK",
    module: "backups",
    tableName: "backup_settings",
    severity: "sensitive",
  }),
  routeRule(/\/api\/admin\/backups\/run-manual\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء نسخة احتياطية يدوية",
    eventKey: "BACKUP_CREATE_MANUAL",
    module: "backups",
    tableName: "backup_logs",
    severity: "sensitive",
  }),
  routeRule(/\/api\/admin\/backups\/restore-from-file\/?$/i, {
    action: "RESTORE",
    actionLabel: "استعادة نسخة احتياطية من ملف",
    eventKey: "BACKUP_RESTORE_FILE",
    module: "backups",
    severity: "critical",
  }),
  routeRule(/\/api\/admin\/backups\/(\d+)\/restore\/?$/i, {
    action: "RESTORE",
    actionLabel: "استعادة نسخة احتياطية",
    eventKey: "BACKUP_RESTORE",
    module: "backups",
    tableName: "backup_logs",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/admin\/backups\/(\d+)\/?$/i, {
    methods: ["DELETE"],
    action: "DELETE",
    actionLabel: "حذف نسخة احتياطية",
    eventKey: "BACKUP_DELETE",
    module: "backups",
    tableName: "backup_logs",
    severity: "critical",
    idGroup: 1,
  }),

  // قرارات طلبات الصلاحيات الإدارية وطلبات الصلاحيات من البوابات
  routeRule(/\/api\/admin\/permissions\/(\d+)\/(decide|override)\/?$/i, {
    actionResolver: ({ match, body }) => {
      const decision = String(body?.decision || body?.status || match[2] || "").toLowerCase();
      return decision.includes("reject") || decision.includes("deny") ? "REJECT" : "APPROVE";
    },
    actionLabelResolver: ({ action }) => action === "REJECT" ? "رفض طلب صلاحية" : "اعتماد طلب صلاحية",
    eventKeyResolver: ({ action }) => `PERMISSION_REQUEST_${action}`,
    module: "permissions",
    tableName: "permission_requests",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/parent\/permissions\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب صلاحية",
    eventKey: "PERMISSION_REQUEST_CREATE",
    module: "permissions",
    tableName: "permission_requests",
    severity: "important",
  }),

  // المستخدمون والأدوار والصلاحيات
  routeRule(/\/api\/users(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة مستخدم", UPDATE: "تعديل مستخدم", DELETE: "حذف مستخدم" },
    eventKeyByAction: { CREATE: "USER_CREATE", UPDATE: "USER_UPDATE", DELETE: "USER_DELETE" },
    module: "users",
    tableName: "users",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/roles\/(\d+)\/permissions\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل صلاحيات دور",
    eventKey: "ROLE_PERMISSIONS_UPDATE",
    module: "roles",
    tableName: "roles",
    severity: "critical",
    idGroup: 1,
    snapshotKind: "role_permissions",
  }),
  routeRule(/\/api\/roles(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة دور", UPDATE: "تعديل دور", DELETE: "حذف دور" },
    eventKeyByAction: { CREATE: "ROLE_CREATE", UPDATE: "ROLE_UPDATE", DELETE: "ROLE_DELETE" },
    module: "roles",
    tableName: "roles",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/role-permissions\/assign\/?$/i, {
    action: "UPDATE",
    actionLabel: "إسناد صلاحيات إلى دور",
    eventKey: "ROLE_PERMISSIONS_ASSIGN",
    module: "roles",
    tableName: "role_permissions",
    severity: "critical",
  }),
  routeRule(/\/api\/role-permissions\/(\d+)\/?$/i, {
    methods: ["DELETE"],
    action: "DELETE",
    actionLabel: "إزالة صلاحية من دور",
    eventKey: "ROLE_PERMISSION_REMOVE",
    module: "roles",
    tableName: "role_permissions",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/permissions(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة صلاحية", UPDATE: "تعديل صلاحية", DELETE: "حذف صلاحية" },
    eventKeyByAction: { CREATE: "PERMISSION_CREATE", UPDATE: "PERMISSION_UPDATE", DELETE: "PERMISSION_DELETE" },
    module: "permissions",
    tableName: "permissions",
    severity: "critical",
    idGroup: 1,
  }),

  routeRule(/\/api\/modules(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة وحدة نظام", UPDATE: "تعديل وحدة نظام", DELETE: "حذف وحدة نظام" },
    eventKeyByAction: { CREATE: "MODULE_CREATE", UPDATE: "MODULE_UPDATE", DELETE: "MODULE_DELETE" },
    module: "system",
    tableName: "modules",
    severity: "sensitive",
    idGroup: 1,
  }),

  // الطلاب والموظفون
  routeRule(/\/api\/students\/register\/?$/i, {
    action: "CREATE",
    actionLabel: "تسجيل طالب جديد",
    eventKey: "STUDENT_CREATE",
    module: "students",
    tableName: "students",
    severity: "important",
  }),
  routeRule(/\/api\/students\/(\d+)\/?$/i, {
    actionByMethod: true,
    actionLabels: { UPDATE: "تعديل بيانات طالب", DELETE: "حذف طالب" },
    eventKeyByAction: { UPDATE: "STUDENT_UPDATE", DELETE: "STUDENT_DELETE" },
    module: "students",
    tableName: "students",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/employees\/(\d+)\/active\/?$/i, {
    actionFromBody: (body) => (body?.is_active === false || body?.is_active === "false" ? "DEACTIVATE" : "ACTIVATE"),
    actionLabels: { ACTIVATE: "تفعيل موظف", DEACTIVATE: "تعطيل موظف" },
    eventKeyByAction: { ACTIVATE: "EMPLOYEE_ACTIVATE", DEACTIVATE: "EMPLOYEE_DEACTIVATE" },
    module: "employees",
    tableName: "employees",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/employees(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة موظف", UPDATE: "تعديل بيانات موظف", DELETE: "حذف موظف" },
    eventKeyByAction: { CREATE: "EMPLOYEE_CREATE", UPDATE: "EMPLOYEE_UPDATE", DELETE: "EMPLOYEE_DELETE" },
    module: "employees",
    tableName: "employees",
    severity: "important",
    idGroup: 1,
  }),

  // إعدادات المدرسة والبنية الأكاديمية
  routeRule(/\/api\/admin\/school-settings\/(profile|academic|finance|portals)\/?$/i, {
    action: "UPDATE",
    actionLabelFromMatch: (match) => ({
      profile: "تعديل بيانات المدرسة",
      academic: "تعديل الإعدادات الأكاديمية",
      finance: "تعديل الإعدادات المالية",
      portals: "تعديل إعدادات البوابات",
    })[match[1]],
    eventKeyFromMatch: (match) => `SCHOOL_SETTINGS_${String(match[1]).toUpperCase()}_UPDATE`,
    module: "school-settings",
    tableName: "school_settings",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/school-settings\/(years|stages|grades|sections|subjects|periods)(?:\/(\d+))?(?:\/(toggle))?\/?$/i, {
    actionResolver: ({ method, match, body }) => {
      if (match[3] === "toggle") return body?.is_active === false || body?.is_active === "false" ? "DEACTIVATE" : "UPDATE";
      return methodAction(method);
    },
    actionLabelResolver: ({ action, match }) => {
      const nouns = { years: "سنة دراسية", stages: "مرحلة", grades: "صف", sections: "شعبة", subjects: "مادة", periods: "حصة" };
      const noun = nouns[match[1]] || "إعداد";
      if (match[3] === "toggle") return `تغيير حالة ${noun}`;
      if (action === "CREATE") return `إضافة ${noun}`;
      if (action === "UPDATE") return `تعديل ${noun}`;
      return `${actionVerb(action)} ${noun}`;
    },
    eventKeyResolver: ({ action, match }) => `SCHOOL_${String(match[1]).toUpperCase()}_${match[3] === "toggle" ? "TOGGLE" : action}`,
    moduleResolver: ({ match }) => ({ years: "academic-years", stages: "stages", grades: "grades", sections: "sections", subjects: "subjects", periods: "periods" })[match[1]],
    tableNameResolver: ({ match }) => ({ years: "academic_years", stages: "stages", grades: "grades", sections: "sections", subjects: "subjects", periods: "periods" })[match[1]],
    severity: "important",
    idGroup: 2,
  }),
  routeRule(/\/api\/admin\/school-settings\/curriculum\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل الخطة الدراسية",
    eventKey: "CURRICULUM_UPDATE",
    module: "curriculum",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/school-settings\/teacher-subjects\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل تأهيل المعلمين للمواد",
    eventKey: "TEACHER_SUBJECTS_UPDATE",
    module: "assign-teachers",
    severity: "important",
  }),
  routeRule(/\/api\/(academic-years|stages|grades|sections|periods)(?:\/(\d+))?(?:\/(activate))?\/?$/i, {
    actionResolver: ({ method, match }) => (match[3] === "activate" ? "ACTIVATE" : methodAction(method)),
    actionLabelResolver: ({ action, match }) => {
      const noun = { "academic-years": "سنة دراسية", stages: "مرحلة", grades: "صف", sections: "شعبة", periods: "حصة" }[match[1]] || "إعداد";
      return `${actionVerb(action)} ${noun}`;
    },
    eventKeyResolver: ({ action, match }) => `${String(match[1]).toUpperCase().replace(/-/g, "_")}_${action}`,
    moduleResolver: ({ match }) => match[1],
    tableNameResolver: ({ match }) => ({ "academic-years": "academic_years", stages: "stages", grades: "grades", sections: "sections", periods: "periods" })[match[1]],
    severity: "important",
    idGroup: 2,
  }),
  routeRule(/\/api\/admin\/assign-teachers\/section\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل توزيع المعلمين على شعبة",
    eventKey: "TEACHER_ASSIGNMENT_UPDATE",
    module: "assign-teachers",
    severity: "important",
  }),

  // الرسوم والمدفوعات
  routeRule(/\/api\/admin\/fee-rules(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إضافة قاعدة رسوم", UPDATE: "تعديل قاعدة رسوم", DELETE: "حذف قاعدة رسوم" },
    eventKeyByAction: { CREATE: "FEE_RULE_CREATE", UPDATE: "FEE_RULE_UPDATE", DELETE: "FEE_RULE_DELETE" },
    module: "fee-rules",
    tableName: "fee_rules",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/fees\/contracts(?:\/(\d+))?\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "إنشاء عقد رسوم", UPDATE: "تعديل عقد رسوم" },
    eventKeyByAction: { CREATE: "FEE_CONTRACT_CREATE", UPDATE: "FEE_CONTRACT_UPDATE" },
    module: "fees",
    tableName: "fee_contracts",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/fees\/payments\/?$/i, {
    action: "CREATE",
    actionLabel: "تسجيل دفعة مالية",
    eventKey: "PAYMENT_CREATE",
    module: "fees",
    tableName: "fee_payments",
    severity: "sensitive",
  }),
  routeRule(/\/api\/fees\/payments\/(\d+)\/confirm\/?$/i, {
    action: "APPROVE",
    actionLabel: "اعتماد دفعة مالية",
    eventKey: "PAYMENT_CONFIRM",
    module: "fees",
    tableName: "fee_payments",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/admin\/fee-adjustment-requests\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب تعديل رسوم",
    eventKey: "FEE_ADJUSTMENT_REQUEST_CREATE",
    module: "fee-adjustments",
    tableName: "fee_adjustment_requests",
    severity: "sensitive",
  }),
  routeRule(/\/api\/admin\/fee-adjustment-requests\/(\d+)\/(approve|reject)\/?$/i, {
    actionResolver: ({ match }) => (match[2] === "approve" ? "APPROVE" : "REJECT"),
    actionLabelResolver: ({ match }) => (match[2] === "approve" ? "اعتماد طلب تعديل رسوم" : "رفض طلب تعديل رسوم"),
    eventKeyResolver: ({ match }) => `FEE_ADJUSTMENT_${String(match[2]).toUpperCase()}`,
    module: "fee-adjustments",
    tableName: "fee_adjustment_requests",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/fees\/requests\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب رسوم",
    eventKey: "FEE_REQUEST_CREATE",
    module: "fees",
    severity: "important",
  }),
  routeRule(/\/api\/fees\/requests\/(\d+)\/(approve|reject)\/?$/i, {
    actionResolver: ({ match }) => (match[2] === "approve" ? "APPROVE" : "REJECT"),
    actionLabelResolver: ({ match }) => (match[2] === "approve" ? "اعتماد طلب رسوم" : "رفض طلب رسوم"),
    eventKeyResolver: ({ match }) => `FEE_REQUEST_${String(match[2]).toUpperCase()}`,
    module: "fees",
    severity: "sensitive",
    idGroup: 1,
  }),

  routeRule(/\/api\/parent\/fees\/payment-request\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب إثبات دفعة",
    eventKey: "PARENT_PAYMENT_REQUEST_CREATE",
    module: "fees",
    severity: "important",
  }),

  // نقل الطلاب
  routeRule(/\/api\/admin\/student-transfer-requests\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب نقل طالب",
    eventKey: "STUDENT_TRANSFER_REQUEST_CREATE",
    module: "transfers",
    tableName: "student_transfer_requests",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/student-transfer-requests\/(\d+)\/(approve|reject)\/?$/i, {
    actionResolver: ({ match }) => (match[2] === "approve" ? "TRANSFER" : "REJECT"),
    actionLabelResolver: ({ match }) => (match[2] === "approve" ? "اعتماد نقل طالب" : "رفض نقل طالب"),
    eventKeyResolver: ({ match }) => `STUDENT_TRANSFER_${String(match[2]).toUpperCase()}`,
    module: "transfers",
    tableName: "student_transfer_requests",
    severity: "sensitive",
    idGroup: 1,
  }),

  // حضور الطلاب والمعلمين
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/(?:sessions(?:\/start)?|start|day\/open)\/?$/i, {
    action: "CREATE",
    actionLabel: "فتح جلسة حضور",
    eventKey: "ATTENDANCE_SESSION_CREATE",
    module: "attendance",
    tableName: "attendance_sessions",
    severity: "important",
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/(?:entries|sessions\/\d+\/entries|sessions\/\d+\/attendance|\d+\/attendance)\/?$/i, {
    action: "UPDATE",
    actionLabel: "تسجيل أو تعديل كشف الحضور",
    eventKey: "ATTENDANCE_ENTRIES_SAVE",
    module: "attendance",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/teacher-attendance\/entries\/(\d+)\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل حضور موظف أو معلم",
    eventKey: "TEACHER_ATTENDANCE_ENTRY_UPDATE",
    module: "attendance",
    tableName: "teacher_attendance_entries",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/.+\/(lock|unlock|end)\/?$/i, {
    actionResolver: ({ match }) => ({ lock: "LOCK", unlock: "UNLOCK", end: "LOCK" })[match[1]],
    actionLabelResolver: ({ match }) => ({ lock: "إغلاق كشف حضور", unlock: "إعادة فتح كشف حضور", end: "إنهاء جلسة حضور" })[match[1]],
    eventKeyResolver: ({ match }) => `ATTENDANCE_${String(match[1]).toUpperCase()}`,
    module: "attendance",
    severity: "important",
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/(?:scan|sessions\/\d+\/scan|\d+\/scan)\/?$/i, {
    action: "UPDATE",
    actionLabel: "تسجيل حضور بواسطة المسح",
    eventKey: "ATTENDANCE_SCAN",
    module: "attendance",
    severity: "normal",
    visibility: "full_log",
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/.+(?:entries|attendance)\/?$/i, {
    action: "UPDATE",
    actionLabel: "تسجيل أو تعديل كشف الحضور",
    eventKey: "ATTENDANCE_ENTRIES_SAVE",
    module: "attendance",
    severity: "important",
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/.+(?:scan)\/?$/i, {
    action: "UPDATE",
    actionLabel: "تسجيل حضور بواسطة المسح",
    eventKey: "ATTENDANCE_SCAN",
    module: "attendance",
    severity: "normal",
    visibility: "full_log",
  }),
  routeRule(/\/api\/(?:teacher\/attendance|teacher\/sessions|admin\/teacher-attendance)\/.+\/?$/i, {
    actionByMethod: true,
    actionLabels: { CREATE: "فتح جلسة حضور", UPDATE: "تعديل سجل حضور" },
    eventKeyByAction: { CREATE: "ATTENDANCE_SESSION_CREATE", UPDATE: "ATTENDANCE_UPDATE" },
    module: "attendance",
    severity: "important",
  }),

  // الاختبارات والدرجات والنتائج
  routeRule(/\/api\/admin-assessments\/(\d+)\/bulk-override\/?$/i, {
    action: "UPDATE",
    actionLabel: "تعديل درجات تقييم بواسطة الإدارة",
    eventKey: "ASSESSMENT_GRADES_OVERRIDE",
    module: "assessments",
    tableName: "assessments",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/teacher\/assessments\/(\d+)\/(publish|close)\/?$/i, {
    actionResolver: ({ match }) => (match[2] === "publish" ? "PUBLISH" : "LOCK"),
    actionLabelResolver: ({ match }) => (match[2] === "publish" ? "نشر تقييم" : "إغلاق تقييم"),
    eventKeyResolver: ({ match }) => `ASSESSMENT_${String(match[2]).toUpperCase()}`,
    module: "assessments",
    tableName: "assessments",
    severity: "sensitive",
    idGroup: 1,
  }),
  routeRule(/\/api\/teacher\/assessments\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء تقييم",
    eventKey: "ASSESSMENT_CREATE",
    module: "assessments",
    tableName: "assessments",
    severity: "important",
  }),
  routeRule(/\/api\/teacher\/grades\/entry\/save\/?$/i, {
    action: "UPDATE",
    actionLabel: "حفظ درجات الطلاب",
    eventKey: "GRADES_SAVE",
    module: "assessments",
    severity: "sensitive",
  }),
  routeRule(/\/api\/teacher\/grades\/entry\/publish\/?$/i, {
    action: "PUBLISH",
    actionLabel: "نشر درجات الطلاب",
    eventKey: "GRADES_PUBLISH",
    module: "assessments",
    severity: "critical",
  }),
  routeRule(/\/api\/teacher\/grades\/muhassala\/submit\/?$/i, {
    action: "SUBMIT",
    actionLabel: "تسليم محصلة الدرجات",
    eventKey: "GRADES_MUHASSALA_SUBMIT",
    module: "assessments",
    severity: "critical",
  }),
  routeRule(/\/api\/teacher\/grades\/reopen-requests\/?$/i, {
    action: "CREATE",
    actionLabel: "طلب إعادة فتح درجات",
    eventKey: "GRADES_REOPEN_REQUEST_CREATE",
    module: "assessments",
    tableName: "assessment_reopen_requests",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/assessment-reopen-requests\/(\d+)\/(approve|reject)\/?$/i, {
    actionResolver: ({ match }) => (match[2] === "approve" ? "APPROVE" : "REJECT"),
    actionLabelResolver: ({ match }) => (match[2] === "approve" ? "اعتماد إعادة فتح تقييم" : "رفض إعادة فتح تقييم"),
    eventKeyResolver: ({ match }) => `ASSESSMENT_REOPEN_${String(match[2]).toUpperCase()}`,
    module: "assessments",
    tableName: "assessment_reopen_requests",
    severity: "critical",
    idGroup: 1,
  }),
  routeRule(/\/api\/admin\/term-results\/(calculate|approve|publish|unpublish)\/?$/i, {
    actionResolver: ({ match }) => ({ calculate: "UPDATE", approve: "APPROVE", publish: "PUBLISH", unpublish: "UNPUBLISH" })[match[1]],
    actionLabelResolver: ({ match }) => ({ calculate: "احتساب النتائج", approve: "اعتماد النتائج", publish: "نشر النتائج", unpublish: "إلغاء نشر النتائج" })[match[1]],
    eventKeyResolver: ({ match }) => `TERM_RESULTS_${String(match[1]).toUpperCase()}`,
    module: "results",
    severity: "critical",
  }),
  routeRule(/\/api\/admin\/control\/.+\/(approve|return)\/?$/i, {
    actionResolver: ({ match }) => (match[1] === "approve" ? "APPROVE" : "REJECT"),
    actionLabelResolver: ({ match }) => (match[1] === "approve" ? "اعتماد أعمال دراسية" : "إعادة أعمال دراسية للتعديل"),
    eventKeyResolver: ({ match }) => `TERM_WORK_${String(match[1]).toUpperCase()}`,
    module: "results",
    severity: "critical",
  }),

  // الجداول الدراسية والاختبارات
  routeRule(/\/api\/(?:exam-)?timetables\/get-or-create\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء أو فتح جدول دراسي",
    eventKey: "TIMETABLE_GET_OR_CREATE",
    module: "timetables",
    severity: "important",
  }),
  routeRule(/\/api\/(?:exam-)?timetables\/(\d+)\/(publish|unpublish|copy-from|entries|overrides(?:\/publish-week)?)\/?$/i, {
    actionResolver: ({ method, match }) => {
      if (match[2] === "publish" || match[2] === "overrides/publish-week") return "PUBLISH";
      if (match[2] === "unpublish") return "UNPUBLISH";
      if (match[2] === "copy-from") return "CREATE";
      return methodAction(method);
    },
    actionLabelResolver: ({ action, match }) => ({
      publish: "نشر جدول دراسي",
      unpublish: "إلغاء نشر جدول دراسي",
      "copy-from": "نسخ جدول دراسي",
      entries: action === "DELETE" ? "حذف حصص من جدول" : "تعديل حصص جدول",
      overrides: action === "DELETE" ? "حذف تعديل أسبوعي للجدول" : "تعديل استثناءات الجدول",
      "overrides/publish-week": "نشر تعديلات أسبوعية للجدول",
    })[match[2]] || "تعديل جدول دراسي",
    eventKeyResolver: ({ action, match }) => {
      const operation = String(match[2]).toUpperCase().replace(/\W+/g, "_");
      return operation === action ? `TIMETABLE_${operation}` : `TIMETABLE_${operation}_${action}`;
    },
    module: "timetables",
    tableName: "timetables",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/(?:exam-)?timetables\/(\d+)\/?$/i, {
    methods: ["DELETE"],
    action: "DELETE",
    actionLabel: "حذف جدول دراسي",
    eventKey: "TIMETABLE_DELETE",
    module: "timetables",
    tableName: "timetables",
    severity: "critical",
    idGroup: 1,
  }),

  // الشهادات والإشعارات والأذونات
  routeRule(/\/api\/admin\/monthly-certificates(?:\/(\d+))?(?:\/printed)?\/?$/i, {
    actionResolver: ({ method, path }) => (path.endsWith("/printed") ? "PRINT" : methodAction(method) === "CREATE" ? "ISSUE" : methodAction(method)),
    actionLabelResolver: ({ action }) => ({ ISSUE: "إصدار شهادة شهرية", PRINT: "طباعة شهادة شهرية", DELETE: "حذف شهادة شهرية" })[action] || "تعديل شهادة شهرية",
    eventKeyResolver: ({ action }) => `MONTHLY_CERTIFICATE_${action}`,
    module: "certificates",
    tableName: "student_certificates",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/admin\/certificates\/[^/]+(?:\/(\d+))?(?:\/printed)?\/?$/i, {
    actionResolver: ({ method, path }) => (path.endsWith("/printed") ? "PRINT" : methodAction(method) === "CREATE" ? "ISSUE" : methodAction(method)),
    actionLabelResolver: ({ action }) => ({ ISSUE: "إصدار شهادة", PRINT: "طباعة شهادة", DELETE: "حذف شهادة" })[action] || "تعديل شهادة",
    eventKeyResolver: ({ action }) => `CERTIFICATE_${action}`,
    module: "certificates",
    tableName: "student_certificates",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/notifications\/admin\/send\/?$/i, {
    action: "SEND",
    actionLabel: "إرسال إشعار إداري",
    eventKey: "NOTIFICATION_ADMIN_SEND",
    module: "notifications",
    tableName: "notifications",
    severity: "important",
  }),
  routeRule(/\/api\/(?:notifications\/admin|teacher\/notifications|student\/notifications|parent\/notifications)\/send\/.+\/?$/i, {
    action: "SEND",
    actionLabel: "إرسال إشعار أو رسالة",
    eventKey: "NOTIFICATION_SEND",
    module: "notifications",
    tableName: "notifications",
    severity: "important",
  }),
  routeRule(/\/api\/admin\/teacher-permits\/(\d+)\/decision\/?$/i, {
    actionFromBody: (body) => (String(body?.decision || body?.status || "").toLowerCase().includes("reject") ? "REJECT" : "APPROVE"),
    actionLabels: { APPROVE: "اعتماد إذن معلم", REJECT: "رفض إذن معلم" },
    eventKeyByAction: { APPROVE: "TEACHER_PERMIT_APPROVE", REJECT: "TEACHER_PERMIT_REJECT" },
    module: "permits",
    tableName: "teacher_permission_requests",
    severity: "important",
    idGroup: 1,
  }),
  routeRule(/\/api\/teacher\/permits\/?$/i, {
    action: "CREATE",
    actionLabel: "إنشاء طلب إذن",
    eventKey: "TEACHER_PERMIT_CREATE",
    module: "permits",
    tableName: "teacher_permission_requests",
    severity: "normal",
  }),

  routeRule(/\/api\/teacher\/permits\/substitutions\/(\d+)\/respond\/?$/i, {
    actionFromBody: (body) => String(body?.response || body?.status || "").toLowerCase().includes("reject") ? "REJECT" : "APPROVE",
    actionLabels: { APPROVE: "قبول تغطية حصة بديلة", REJECT: "رفض تغطية حصة بديلة" },
    eventKeyByAction: { APPROVE: "LESSON_SUBSTITUTION_APPROVE", REJECT: "LESSON_SUBSTITUTION_REJECT" },
    module: "permits",
    severity: "important",
    idGroup: 1,
  }),

  // تعديلات الحساب الحساسة
  routeRule(/\/api\/profile\/password\/?$/i, {
    action: "RESET",
    actionLabel: "تغيير كلمة المرور",
    eventKey: "PASSWORD_CHANGE",
    module: "Security",
    tableName: "users",
    severity: "critical",
  }),
  routeRule(/\/api\/profile\/email\/?$/i, {
    action: "UPDATE",
    actionLabel: "تغيير البريد الإلكتروني",
    eventKey: "EMAIL_CHANGE",
    module: "Security",
    tableName: "users",
    severity: "sensitive",
  }),

  // عمليات ذات قيمة إدارية عامة
  routeRule(/\/api\/continuing-students\/register\/?$/i, {
    action: "IMPORT",
    actionLabel: "ترحيل الطلاب المستمرين",
    eventKey: "CONTINUING_STUDENTS_REGISTER",
    module: "students",
    severity: "important",
  }),
  routeRule(/\/api\/student\/learning\/activities\/(\d+)\/submit\/?$/i, {
    action: "SUBMIT",
    actionLabel: "تسليم نشاط تعليمي",
    eventKey: "LEARNING_ACTIVITY_SUBMIT",
    module: "learning",
    severity: "normal",
    visibility: "full_log",
    idGroup: 1,
  }),
];

function getPath(req) {
  return String(req.originalUrl || req.url || req.path || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function isAllowedMethod(rule, method) {
  return !rule.methods || rule.methods.includes(String(method || "").toUpperCase());
}

function resolveRule(req) {
  const path = getPath(req);
  const method = String(req.method || "").toUpperCase();

  for (const rule of RULES) {
    const match = path.match(rule.match);
    if (!match || !isAllowedMethod(rule, method)) continue;

    if (rule.skip) return { skip: true, path, method, match };

    const context = { req, path, method, match, body: req.body || {} };
    const action =
      (typeof rule.actionResolver === "function" && rule.actionResolver(context)) ||
      (typeof rule.actionFromBody === "function" && rule.actionFromBody(req.body || {})) ||
      (rule.actionByMethod ? methodAction(method) : rule.action) ||
      methodAction(method);

    const actionLabel =
      (typeof rule.actionLabelResolver === "function" && rule.actionLabelResolver({ ...context, action })) ||
      (typeof rule.actionLabelFromMatch === "function" && rule.actionLabelFromMatch(match)) ||
      rule.actionLabels?.[action] ||
      rule.actionLabel ||
      `${actionVerb(action)} سجل`;

    const eventKey =
      (typeof rule.eventKeyResolver === "function" && rule.eventKeyResolver({ ...context, action })) ||
      (typeof rule.eventKeyFromMatch === "function" && rule.eventKeyFromMatch(match)) ||
      rule.eventKeyByAction?.[action] ||
      rule.eventKey ||
      `GENERIC_${action}`;

    const module =
      (typeof rule.moduleResolver === "function" && rule.moduleResolver(context)) ||
      rule.module ||
      "system";
    const tableName =
      (typeof rule.tableNameResolver === "function" && rule.tableNameResolver(context)) ||
      rule.tableName ||
      null;

    return {
      ...rule,
      skip: false,
      path,
      method,
      match,
      action,
      actionLabel,
      eventKey,
      module,
      moduleLabel: MODULE_LABELS[module] || module,
      tableName,
      severity: rule.severity || "normal",
      visibility: rule.visibility || "dashboard",
    };
  }

  // أي طلب كتابة لم يطابق قاعدة محددة يُسجل كحدث عام بدل تجاهله.
  const fallbackModule = inferFallbackModule(path);
  const fallbackAction = methodAction(method);
  return {
    skip: false,
    path,
    method,
    match: null,
    action: fallbackAction,
    actionLabel: `${actionVerb(fallbackAction)} سجل`,
    eventKey: `GENERIC_${fallbackAction}`,
    module: fallbackModule,
    moduleLabel: MODULE_LABELS[fallbackModule] || fallbackModule,
    tableName: null,
    severity: "normal",
    visibility: "full_log",
  };
}

function inferFallbackModule(path) {
  const ignored = new Set(["api", "admin", "teacher", "student", "parent"]);
  const parts = String(path || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !ignored.has(part.toLowerCase()))
    .filter((part) => !/^\d+$/.test(part));
  return parts[0] || "system";
}

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function findIdDeep(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;

  for (const key of keys) {
    const found = positiveId(value[key]);
    if (found) return found;
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== "object") continue;
    const found = findIdDeep(nested, keys, depth + 1);
    if (found) return found;
  }

  return null;
}

function extractRuleRecordId(rule, req, responseBody = null) {
  if (rule?.idGroup && rule.match?.[rule.idGroup]) {
    const id = positiveId(rule.match[rule.idGroup]);
    if (id) return id;
  }

  const paramId =
    positiveId(req.params?.id) ||
    positiveId(req.params?.studentId) ||
    positiveId(req.params?.employeeId) ||
    positiveId(req.params?.assessment_id) ||
    positiveId(req.params?.recipientRowId);
  if (paramId) return paramId;

  const responseId = findIdDeep(responseBody, [
    "id",
    "student_id",
    "employee_id",
    "user_id",
    "role_id",
    "payment_id",
    "contract_id",
    "request_id",
    "logId",
  ]);
  if (responseId) return responseId;

  return findIdDeep(req.body, [
    "id",
    "student_id",
    "employee_id",
    "user_id",
    "role_id",
    "payment_id",
    "contract_id",
    "request_id",
  ]);
}

function findLabelDeep(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;
  const keys = [
    "full_name",
    "name",
    "name_ar",
    "title",
    "username",
    "student_name",
    "employee_name",
    "teacher_name",
    "school_name",
    "student_code",
    "fileName",
  ];

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== "object") continue;
    const found = findLabelDeep(nested, depth + 1);
    if (found) return found;
  }

  return null;
}

async function getTableMetadata(tableName) {
  if (!tableName || !TABLE_ALLOWLIST.has(tableName)) return null;
  if (TABLE_METADATA_CACHE.has(tableName)) return TABLE_METADATA_CACHE.get(tableName);

  try {
    const result = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
      `,
      [tableName]
    );

    if (!result.rows.length) {
      TABLE_METADATA_CACHE.set(tableName, null);
      return null;
    }

    const columns = new Set(result.rows.map((row) => row.column_name));
    const metadata = {
      hasId: columns.has("id"),
      hasSchoolId: columns.has("school_id"),
    };
    TABLE_METADATA_CACHE.set(tableName, metadata);
    return metadata;
  } catch (error) {
    console.warn(`[Activity Logger] Could not inspect table ${tableName}:`, error.message);
    return null;
  }
}

async function snapshotRecord(tableName, recordId, schoolId) {
  const id = positiveId(recordId);
  const sid = positiveId(schoolId);
  if (!id || !tableName || !TABLE_ALLOWLIST.has(tableName)) return null;

  const metadata = await getTableMetadata(tableName);
  if (!metadata?.hasId) return null;

  try {
    const query = metadata.hasSchoolId && sid
      ? `SELECT * FROM "${tableName}" WHERE id = $1 AND school_id = $2 LIMIT 1`
      : `SELECT * FROM "${tableName}" WHERE id = $1 LIMIT 1`;
    const params = metadata.hasSchoolId && sid ? [id, sid] : [id];
    const result = await pool.query(query, params);
    return result.rows[0] ? cleanSensitiveData(result.rows[0]) : null;
  } catch (error) {
    console.warn(`[Activity Logger] Snapshot failed for ${tableName}#${id}:`, error.message);
    return null;
  }
}

async function snapshotRolePermissions(roleId, schoolId) {
  const id = positiveId(roleId);
  const sid = positiveId(schoolId);
  if (!id || !sid) return null;

  try {
    const result = await pool.query(
      `
        SELECT
          rp.permission_id,
          p.code,
          p.name
        FROM role_permissions rp
        INNER JOIN roles r ON r.id = rp.role_id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
          AND r.school_id = $2
        ORDER BY rp.permission_id
      `,
      [id, sid]
    );
    return { permissions: result.rows };
  } catch (error) {
    console.warn("[Activity Logger] Role permissions snapshot failed:", error.message);
    return null;
  }
}

async function snapshotForRule(rule, recordId, schoolId) {
  if (rule.snapshotKind === "role_permissions") return snapshotRolePermissions(recordId, schoolId);
  return snapshotRecord(rule.tableName, recordId, schoolId);
}

function safeRequestDetails(req) {
  return cleanSensitiveData({
    params: req.params || {},
    query: req.query || {},
    body: req.body || {},
  });
}

function captureResponseBody(res) {
  if (res.locals.__auditResponseCaptureInstalled) return;
  res.locals.__auditResponseCaptureInstalled = true;

  const originalJson = res.json.bind(res);
  res.json = function auditJson(body) {
    res.locals.auditResponseBody = cleanSensitiveData(body);
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function auditSend(body) {
    if (res.locals.auditResponseBody === undefined) {
      res.locals.auditResponseBody = cleanSensitiveData(body);
    }
    return originalSend(body);
  };
}

function targetLabelFrom(rule, sources) {
  for (const source of sources) {
    const label = findLabelDeep(source);
    if (label) return label;
  }
  return null;
}

function buildDescription({ rule, actorName, targetLabel, recordId, success }) {
  const noun = TARGET_NOUNS[rule.module] || "السجل";
  const targetText = targetLabel
    ? ` ${noun} (${targetLabel})`
    : recordId
      ? ` ${noun} رقم ${recordId}`
      : ` ${noun}`;

  if (!success) return `فشلت محاولة ${rule.actionLabel} بواسطة ${actorName}${targetText}`;
  return `${actorName} ${actionVerb(rule.action)}${targetText}`;
}

/**
 * مسجل آلي دلالي:
 * - يلتقط عمليات الكتابة المهمة بعد المصادقة.
 * - يميز المعاينة عن التصدير والطباعة.
 * - يحفظ وصفًا عربيًا، والسجل المتأثر، والبيانات قبل وبعد متى أمكن.
 * - يمنع كلمات المرور والتوكنات من الوصول إلى جدول activity_logs.
 */
export const autoActivityLogger = async (req, res, next) => {
  const method = String(req.method || "").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

  // بعض المسارات في app.js مركبة تحت /api أكثر من مرة. نثبت مسجلًا واحدًا فقط لكل طلب
  // حتى لا تتكرر نفس العملية في سجل التدقيق عند انتقال Express بين أكثر من Router.
  if (req.__autoActivityLoggerInstalled) return next();
  req.__autoActivityLoggerInstalled = true;

  const rule = resolveRule(req);
  if (rule.skip) return next();

  captureResponseBody(res);

  const schoolId = req.user?.school_id || req.user?.school?.id || req.schoolId || req.school_id || null;
  const initialRecordId = extractRuleRecordId(rule, req);
  let before = null;

  try {
    // ليست كل طلبات POST عمليات إنشاء. بعض المسارات تستخدم POST لاعتماد سجل موجود
    // أو نشره أو قفله؛ لذلك نلتقط حالته السابقة متى كان رقم السجل معروفًا وكانت
    // العملية دلاليًا تعدل سجلًا قائمًا.
    const postCreatesNewRecord = ["CREATE", "ISSUE", "IMPORT", "SEND", "SUBMIT", "EXPORT"].includes(rule.action);
    if (initialRecordId && (method !== "POST" || rule.snapshotKind || !postCreatesNewRecord)) {
      before = await snapshotForRule(rule, initialRecordId, schoolId);
    }
  } catch (error) {
    console.warn("[Activity Logger] Could not capture previous state:", error.message);
  }

  res.on("finish", async () => {
    try {
      if (res.locals.skipAutoLog || req.auditLogged) return;
      if (!req.user?.id || !schoolId) return;

      const success = res.statusCode >= 200 && res.statusCode < 300;
      const responseBody = res.locals.auditResponseBody;
      const recordId = extractRuleRecordId(rule, req, responseBody) || initialRecordId;
      let after = null;

      if (success && rule.action !== "DELETE" && recordId) {
        after = await snapshotForRule(rule, recordId, schoolId);
      }

      if (!after && success && rule.action !== "DELETE") {
        after = cleanSensitiveData(req.body || {});
      }

      const actorName = req.user?.name || req.user?.full_name || req.user?.username || "مستخدم";
      const targetLabel = targetLabelFrom(rule, [after, before, responseBody, req.body]);
      const description = buildDescription({ rule, actorName, targetLabel, recordId, success });

      await logActivity({
        req,
        action: rule.action,
        action_label: rule.actionLabel,
        event_key: rule.eventKey,
        module: rule.module,
        module_label: rule.moduleLabel,
        table_name: rule.tableName,
        record_id: recordId,
        resource_type: rule.tableName || rule.module,
        resource_id: recordId,
        entity_type: rule.tableName || rule.module,
        entity_id: recordId,
        description,
        reason: req.body?.reason || req.body?.admin_note || null,
        old_data: before,
        new_data: after,
        changes: { before, after },
        details: {
          source: "auto-semantic",
          target_label: targetLabel,
          request: safeRequestDetails(req),
          response: cleanSensitiveData(responseBody),
        },
        metadata: {
          severity: rule.severity,
          result: success ? "success" : "failure",
          visibility: rule.visibility,
        },
        path: req.originalUrl || req.url,
        method: req.method,
        status_code: res.statusCode,
      });
    } catch (error) {
      console.warn("autoActivityLogger warning:", error.message);
    }
  });

  return next();
};

// مخصص للاختبارات الساكنة والتحقق من تغطية المسارات دون تنفيذ طلبات فعلية.
export function classifyActivityRequest(req) {
  return resolveRule(req);
}

export default autoActivityLogger;
