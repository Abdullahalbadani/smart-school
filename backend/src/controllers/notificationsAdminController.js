// backend/src/controllers/notificationsAdminController.js
import { pool } from "../config/db.js";
import fs from "fs";
import {
  previewManualRecipients,
  sendManualNotification,
} from "../modules/notifications/notificationsAdminSendService.js";
import {
  listSentNotifications,
  getSentNotificationDetails,
} from "../modules/notifications/notificationsSentLogService.js";
import {
  lookupStages,
  lookupGrades,
  lookupSections,
  lookupStudents,
  lookupTeachers,
  lookupGuardians,
} from "../modules/notifications/notificationsAudienceLookupService.js";
import { createAttachmentsForNotification } from "../modules/notifications/notificationsAttachmentsService.js";
import { emitRealtimeToUsers } from "../modules/notifications/notificationCreateService.js";

/**
 * جلب اسم المرسل مع التأكد من انتمائه لنفس المدرسة
 */
async function getSenderDisplayName(userId, schoolId) {
  if (!userId || !schoolId) return null;

  const result = await pool.query(
    `SELECT name FROM users WHERE id = $1 AND school_id = $2 LIMIT 1`,
    [userId, schoolId]
  );

  return result.rows[0]?.name || null;
}

function toPositiveIntOrDefault(value, defaultValue) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : defaultValue;
}

function cleanupUploadedFiles(files = []) {
  for (const file of files || []) {
    try {
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (error) {
      console.warn("cleanupUploadedFiles warning:", error.message);
    }
  }
}


async function rollbackManualNotification({ notificationId, schoolId, senderUserId }) {
  if (!notificationId || !schoolId || !senderUserId) return;

  // notification_recipients and notification_attachments are deleted by FK CASCADE.
  await pool.query(
    `DELETE FROM notifications
     WHERE id = $1
       AND school_id = $2
       AND source = 'manual'
       AND sender_user_id = $3`,
    [notificationId, schoolId, senderUserId]
  );
}

function resolveErrorStatus(err, fallback = 400) {
  if (!err) return fallback;

  if (Number.isInteger(err.statusCode)) return err.statusCode;
  if (Number.isInteger(err.status)) return err.status;

  const msg = String(err.message || "").toLowerCase();

  if (msg.includes("غير مصرح") || msg.includes("unauthorized")) return 401;
  if (msg.includes("forbidden") || msg.includes("ممنوع")) return 403;
  if (msg.includes("not found") || msg.includes("غير موجود")) return 404;
  if (
    msg.includes("validation") ||
    msg.includes("invalid") ||
    msg.includes("required")
  )
    return 400;

  return fallback;
}

// 1️⃣ معاينة المستلمين قبل الإرسال (محمية بالمدرسة)
export async function previewRecipients(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const payload = req.body || {};

    // تمرير schoolId لضمان أن المعاينة لا تظهر مستخدمين من مدارس أخرى
    const result = await previewManualRecipients(payload, schoolId);

    return res.json({
      ok: true,
      message: "تمت معاينة المستلمين",
      data: result,
    });
  } catch (err) {
    console.error("previewRecipients error:", err);
    return res.status(resolveErrorStatus(err, 400)).json({
      ok: false,
      message: err.message || "فشل معاينة المستلمين",
    });
  }
}

// 2️⃣ إرسال إشعار يدوي (مع عزل المدرسة ودعم المرفقات)
export async function sendManual(req, res) {
  try {
    const senderUserId = req.user?.id;
    const schoolId = req.user?.school_id;

    if (!senderUserId || !schoolId) {
      return res.status(401).json({
        ok: false,
        message: "غير مصرح",
      });
    }

    const senderDisplayName = await getSenderDisplayName(
      senderUserId,
      schoolId
    );

    // أ) إرسال الإشعار الأساسي وتوزيعه
    const result = await sendManualNotification({
      app: req.app,
      senderUserId,
      senderDisplayName,
      schoolId, // 👈 حقن رقم المدرسة
      payload: req.body || {},
      deferRealtime: true,
    });

    // ب) معالجة المرفقات قبل Socket. إذا فشل حفظ أي مرفق نحذف الإشعار
    // اليدوي الذي أنشئناه حتى لا يبقى إشعار ناقص أو مضلل للمستلمين.
    if (result.request_id && !result.skipped) {
      const files = req.files || [];
      let links = [];

      try {
        if (req.body.links) {
          try {
            links =
              typeof req.body.links === "string"
                ? JSON.parse(req.body.links)
                : req.body.links;
          } catch {
            throw new Error("صيغة روابط المرفقات غير صحيحة");
          }
        }

        if (!Array.isArray(links)) {
          throw new Error("صيغة روابط المرفقات غير صحيحة");
        }

        if (files.length > 0 || links.length > 0) {
          await createAttachmentsForNotification({
            notificationId: result.request_id,
            files,
            links,
            schoolId,
          });
        }
      } catch (attachmentError) {
        await rollbackManualNotification({
          notificationId: result.request_id,
          schoolId,
          senderUserId,
        });
        throw attachmentError;
      }

      if (result.should_emit_realtime) {
        const realtime = emitRealtimeToUsers(
          req.app,
          result.send_result?.recipients || [],
          result.send_result?.notification,
          { allowRealtime: true }
        );
        result.realtime_sent = realtime.sent_users;
        if (result.send_result) result.send_result.realtime = realtime;
      }
    }

    if (result?.skipped) cleanupUploadedFiles(req.files || []);

    const statusCode = result?.skipped ? 200 : 201;

    return res.status(statusCode).json({
      ok: true,
      message: result?.skipped
        ? "لم يتم الإرسال (لا يوجد مستلمين أو مكرر)"
        : "تم إرسال الإشعار بنجاح",
      data: result,
    });
  } catch (err) {
    cleanupUploadedFiles(req.files || []);
    console.error("sendManual notification error:", err);
    return res.status(resolveErrorStatus(err, 400)).json({
      ok: false,
      message: err.message || "فشل إرسال الإشعار",
    });
  }
}

// 3️⃣ سجل الإشعارات المرسلة (محمية بالمدرسة)
export async function listSentLog(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const limit = toPositiveIntOrDefault(req.query.limit, 20);
    const offset = toPositiveIntOrDefault(req.query.offset, 0);

    const result = await listSentNotifications({
      schoolId, // 👈 عرض سجل المدرسة الحالية فقط
      q: req.query.q || "",
      category: req.query.category || "",
      priority: req.query.priority || "",
      limit,
      offset,
      senderUserId: null,
    });

    return res.json({
      ok: true,
      message: "تم جلب سجل الإشعارات المرسلة",
      data: result,
    });
  } catch (err) {
    console.error("listSentLog error:", err);
    return res.status(resolveErrorStatus(err, 500)).json({
      ok: false,
      message: err.message || "فشل جلب سجل الإشعارات المرسلة",
    });
  }
}

// =========================
// Lookups (محمية بالمدرسة 100%)
// =========================

// المراحل
export async function lookupStagesHandler(req, res) {
  try {
    const result = await lookupStages({
      schoolId: req.user?.school_id,
      q: req.query.q || "",
      limit: req.query.limit,
    });
    return res.json({ ok: true, message: "تم جلب المراحل", data: result });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// الصفوف
export async function lookupGradesHandler(req, res) {
  try {
    const result = await lookupGrades({
      schoolId: req.user?.school_id,
      stageId: req.query.stage_id,
      q: req.query.q || "",
      limit: req.query.limit,
    });
    return res.json({ ok: true, message: "تم جلب الصفوف", data: result });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// الشعب / الفصول
export async function lookupSectionsHandler(req, res) {
  try {
    const result = await lookupSections({
      schoolId: req.user?.school_id,
      stageId: req.query.stage_id,
      gradeId: req.query.grade_id,
      q: req.query.q || "",
      limit: req.query.limit,
    });
    return res.json({ ok: true, message: "تم جلب الشعب/الفصول", data: result });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// الطلاب
export async function lookupStudentsHandler(req, res) {
  try {
    const result = await lookupStudents({
      schoolId: req.user?.school_id,
      q: req.query.q || "",
      stageId: req.query.stage_id,
      gradeId: req.query.grade_id,
      sectionId: req.query.section_id,
      academicYearId: req.query.academic_year_id,
      term: req.query.term,
      limit: req.query.limit,
      useActiveAcademicYearDefault: req.query.include_all_years !== "1",
    });
    return res.json({ ok: true, message: "تم جلب الطلاب", data: result });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// المعلمون
export async function lookupTeachersHandler(req, res) {
  try {
    const result = await lookupTeachers({
      schoolId: req.user?.school_id,
      q: req.query.q || "",
      sectionId: req.query.section_id,
      academicYearId: req.query.academic_year_id,
      term: req.query.term,
      limit: req.query.limit,
      useActiveAcademicYearDefault: req.query.include_all_years !== "1",
    });
    return res.json({ ok: true, message: "تم جلب المعلمين", data: result });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// أولياء الأمور
export async function lookupGuardiansHandler(req, res) {
  try {
    const result = await lookupGuardians({
      schoolId: req.user?.school_id,
      q: req.query.q || "",
      studentId: req.query.student_id,
      stageId: req.query.stage_id,
      gradeId: req.query.grade_id,
      sectionId: req.query.section_id,
      academicYearId: req.query.academic_year_id,
      term: req.query.term,
      limit: req.query.limit,
      useActiveAcademicYearDefault: req.query.include_all_years !== "1",
    });
    return res.json({
      ok: true,
      message: "تم جلب أولياء الأمور",
      data: result,
    });
  } catch (err) {
    return res
      .status(resolveErrorStatus(err, 400))
      .json({ ok: false, message: err.message });
  }
}

// 4️⃣ تفاصيل إشعار مرسل (محمية بالمدرسة)
export async function sentLogDetails(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const id = req.params.id;

    const result = await getSentNotificationDetails(id, schoolId);
    if (!result) {
      return res.status(404).json({
        ok: false,
        message: "الإشعار غير موجود",
      });
    }

    return res.json({
      ok: true,
      message: "تم جلب تفاصيل الإشعار",
      data: result,
    });
  } catch (err) {
    console.error("sentLogDetails error:", err);
    return res.status(resolveErrorStatus(err, 400)).json({
      ok: false,
      message: err.message || "فشل جلب التفاصيل",
    });
  }
}
