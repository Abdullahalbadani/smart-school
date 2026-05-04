// backend/src/routes/parentNotificationsRoutes.js
import express from "express";
import {
  listChildren,
  childTeachers,
  getUnreadCount,
  listInbox,
  markOneRead,
  markAllRead,
  listOutbox,
  outboxRecipients,
  sendAdmins,
  sendChildren,
  sendTeachers,
} from "../controllers/parentNotificationsController.js";

// ✅ استيراد الميدل وير الخاص بالتوثيق لضمان وجود req.user.school_id
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * 🔒 حماية المسارات
 * تطبيق authMiddleware على جميع المسارات التالية لضمان عزل البيانات
 * بناءً على رقم المدرسة (school_id) الموجود في التوكن.
 */
router.use(authMiddleware);

// ==========================================
// 🔍 مساعدات الواجهة (Lookups)
// ==========================================

// جلب قائمة الأبناء المرتبطين بولي الأمر (في هذه المدرسة فقط)
router.get("/children", listChildren);

// جلب قائمة معلمين ابن محدد (للسنة الدراسية الحالية في هذه المدرسة)
router.get("/children/:studentId/teachers", childTeachers);

// ==========================================
// 📥 صندوق الوارد (Inbox)
// ==========================================

// عدد الإشعارات غير المقروءة لولي الأمر
router.get("/unread-count", getUnreadCount);

// قائمة الإشعارات المستلمة (مع دعم الفلترة والبحث)
router.get("/inbox", listInbox);

// تعليم إشعار واحد كمقروء
router.patch("/inbox/:id/read", markOneRead);

// تعليم جميع إشعارات مدرسة ولي الأمر كمقروءة
router.patch("/inbox/read-all", markAllRead);

// ==========================================
// 📤 صندوق الصادر (Outbox)
// ==========================================

// قائمة الإشعارات التي أرسلها ولي الأمر
router.get("/outbox", listOutbox);

// تفاصيل المستلمين لإشعار مرسل (لمعرفة من قرأ الرسالة)
router.get("/outbox/:id/recipients", outboxRecipients);

// ==========================================
// ✉️ عمليات الإرسال (Send)
// ==========================================

// إرسال رسالة إلى إدارة المدرسة
router.post("/send/admins", sendAdmins);

// إرسال رسالة إلى الأبناء (لحسابات الطلاب)
router.post("/send/children", sendChildren);

// إرسال رسالة إلى معلمي الأبناء
router.post("/send/teachers", sendTeachers);

export default router;