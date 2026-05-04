// backend/src/modules/notifications/notificationsAdminSendService.js
import { createNotification } from "./notificationCreateService.js";
import { resolveManualAudienceRecipients } from "./notificationsAudienceResolver.js";

/* =========================
   Helpers
========================== */
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toTrimmedString(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function toOptionalTrimmedString(v) {
  const s = String(v ?? "").trim();
  return s || null;
}

function toPositiveIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toNonNegativeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function sanitizeCategory(v) {
  // لا نمنع الفئات المخصصة، فقط ننظفها
  return toTrimmedString(v, "general");
}

function sanitizePriority(v) {
  const p = String(v || "normal").trim().toLowerCase();
  return ["normal", "important", "urgent"].includes(p) ? p : "normal";
}

function sanitizeMeta(v) {
  return isPlainObject(v) ? { ...v } : {};
}

function sanitizeTargets(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => isPlainObject(t) && toOptionalTrimmedString(t.type));
}

/**
 * توحيد شكل الـ payload:
 * - يدعم الجديد: dedupe_seconds / targets[]
 * - ويدعم القديم: dedupe_window_seconds / recipient_mode
 */
function normalizeManualPayload(payload = {}) {
  const raw = isPlainObject(payload) ? payload : {};

  const dedupeWindowSeconds = toNonNegativeInt(
    raw.dedupe_seconds ?? raw.dedupe_window_seconds,
    0
  );

  const normalized = {
    // نسخة البنية (للواجهة الجديدة)
    payload_version: toPositiveIntOrNull(raw.payload_version) || 1,

    // الحقول الأساسية
    title: toTrimmedString(raw.title, ""),
    body: toTrimmedString(raw.body, ""),
    category: sanitizeCategory(raw.category),
    priority: sanitizePriority(raw.priority),

    // منع التكرار (نرسل الاثنين للتوافق)
    dedupe_seconds: dedupeWindowSeconds,
    dedupe_window_seconds: dedupeWindowSeconds,

    // خيارات إضافية
    allow_realtime:
      raw.allow_realtime === undefined ? true : !!raw.allow_realtime,
    preview_limit: (() => {
      const n = Number(raw.preview_limit);
      if (!Number.isInteger(n)) return 20;
      return Math.max(5, Math.min(100, n));
    })(),

    // الربط الاختياري
    related_type: toOptionalTrimmedString(raw.related_type),
    related_id: toPositiveIntOrNull(raw.related_id),

    // Meta
    meta: sanitizeMeta(raw.meta),

    // الصيغة الجديدة
    targets: sanitizeTargets(raw.targets),

    // الصيغة القديمة (تبقى كما هي للتوافق)
    recipient_mode: toOptionalTrimmedString(raw.recipient_mode),
    role_keys: Array.isArray(raw.role_keys) ? raw.role_keys : [],
    recipient_user_ids: Array.isArray(raw.recipient_user_ids)
      ? raw.recipient_user_ids
          .map((x) => Number(x))
          .filter((x) => Number.isInteger(x) && x > 0)
      : [],
    scope: isPlainObject(raw.scope) ? { ...raw.scope } : null,
  };

  // لو الواجهة الجديدة أرسلت targets[] فقط بدون recipient_mode
  if (!normalized.recipient_mode && normalized.targets.length) {
    normalized.recipient_mode = "targets";
    normalized.payload_version = normalized.payload_version || 2;
  }

  return normalized;
}

function validatePreviewPayload(payload) {
  // في المعاينة لا نلزم body، لكن نلزم وجود طريقة استهداف
  const hasNewTargets = Array.isArray(payload.targets) && payload.targets.length > 0;

  const hasLegacyTargeting =
    !!payload.recipient_mode ||
    (Array.isArray(payload.role_keys) && payload.role_keys.length > 0) ||
    (Array.isArray(payload.recipient_user_ids) && payload.recipient_user_ids.length > 0) ||
    !!payload.scope;

  if (!hasNewTargets && !hasLegacyTargeting) {
    throw new Error("أضف شرط استهداف واحدًا على الأقل");
  }
}

function validateSendPayload(payload) {
  if (!payload.title) {
    throw new Error("عنوان الإشعار مطلوب");
  }

  if (!payload.body) {
    throw new Error("محتوى الإشعار مطلوب");
  }

  validatePreviewPayload(payload);
}

function extractSendResultSummary(sendResult = {}) {
  const sr = isPlainObject(sendResult) ? sendResult : {};

  return {
    request_id: sr.request_id || sr.operation_id || sr.id || null,
    created_rows:
      sr.created_rows ??
      sr.created_count ??
      sr.inserted_count ??
      sr.recipients_created ??
      0,
    realtime_sent:
      sr.realtime_sent ??
      sr.realtime_sent_count ??
      sr.socket_sent ??
      0,
    skipped: !!sr.skipped,
    reason: sr.reason || null,
  };
}

/* =========================
   Preview
========================== */
// ✅ إضافة schoolId لضمان معاينة مستخدمي نفس المدرسة فقط
export async function previewManualRecipients(payload = {}, schoolId) {
  if (!schoolId) throw new Error("schoolId is required for preview");

  const normalizedPayload = normalizeManualPayload(payload);
  normalizedPayload.schoolId = schoolId; // 👈 تمرير المدرسة للمستهدفين

  validatePreviewPayload(normalizedPayload);

  // ملاحظة: resolver سيحتاج دعم recipient_mode = "targets" + targets[] 
  const audience = await resolveManualAudienceRecipients(normalizedPayload);

  // نرجّع النتيجة كما هي مع بعض metadata المفيدة
  return {
    ...audience,
    payload_version: normalizedPayload.payload_version,
    used_targeting_mode:
      normalizedPayload.recipient_mode ||
      (normalizedPayload.targets.length ? "targets" : "unknown"),
  };
}

/* =========================
   Send
========================== */
// ✅ إضافة schoolId كمعامل أساسي لضمان إرسال الإشعار للمدرسة الصحيحة
export async function sendManualNotification({
  app,
  senderUserId,
  senderDisplayName = null,
  payload = {},
  schoolId, // 👈 NEW
}) {
  if (!schoolId) throw new Error("schoolId is required for sending notification");

  const normalizedPayload = normalizeManualPayload(payload);
  normalizedPayload.schoolId = schoolId; // 👈 حقن المدرسة للبحث عن المستلمين

  validateSendPayload(normalizedPayload);

  // البحث عن المستلمين في نفس المدرسة فقط
  const audience = await resolveManualAudienceRecipients(normalizedPayload);

  const recipientUserIds = Array.isArray(audience?.recipient_user_ids)
    ? audience.recipient_user_ids
    : [];

  if (!recipientUserIds.length) {
    return {
      success: true,
      skipped: true,
      reason: "no_recipients",

      // مهم للواجهة
      audience,
      preview: audience,

      // نتائج مسطحة (حتى الواجهة لا تحتاج تغوص داخل send_result)
      request_id: null,
      created_rows: 0,
      realtime_sent: 0,

      send_result: null,
      payload_version: normalizedPayload.payload_version,
    };
  }

  const notificationMeta = {
    ...normalizedPayload.meta,
    payload_version: normalizedPayload.payload_version,
    targeting_mode:
      normalizedPayload.recipient_mode ||
      (normalizedPayload.targets.length ? "targets" : "legacy"),
    targets_count: normalizedPayload.targets.length,
    audience_breakdown: audience?.breakdown || null,
  };

  // ✅ استخدام createNotification الآمنة التي تتطلب schoolId
  const sendResult = await createNotification({
    app,
    schoolId, // 👈 التمرير الإجباري
    source: "manual",
    category: normalizedPayload.category,
    priority: normalizedPayload.priority,
    title: normalizedPayload.title,
    body: normalizedPayload.body,

    senderUserId: Number(senderUserId),
    senderDisplayName: senderDisplayName || null,

    relatedType: normalizedPayload.related_type,
    relatedId: normalizedPayload.related_id,

    meta: notificationMeta,

    recipientUserIds,
    dedupeWindowSeconds: normalizedPayload.dedupe_window_seconds,

    // إن كانت createNotification تدعم realtime flag فسيستفيد، وإن لم تدعم فلن يضر
    allowRealtime: !!normalizedPayload.allow_realtime,
  });

  const summary = extractSendResultSummary(sendResult);

  return {
    success: true,
    skipped: !!summary.skipped,
    reason: summary.reason,

    // مهم جدًا للواجهة الحالية
    audience,
    preview: audience,

    // نتائج مسطحة للسهولة
    request_id: summary.request_id,
    created_rows: summary.created_rows,
    realtime_sent: summary.realtime_sent,

    // النتيجة الأصلية (للاستفادة الكاملة)
    send_result: sendResult,

    payload_version: normalizedPayload.payload_version,
  };
}