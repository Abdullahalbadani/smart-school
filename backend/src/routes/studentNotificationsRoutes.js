// backend/src/routes/studentNotificationsRoutes.js
import express from "express";
import {
  unreadCount,
  listInbox,
  markOneRead,
  markAllRead,
  listOutbox,
  outboxRecipients,
  listMyTeachers,
  sendAdmins,
  sendTeachers,
} from "../controllers/studentNotificationsController.js";

// ✅ استيراد الميدل وير لضمان استخراج req.user.school_id
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * 🔒 حماية المسارات (Student Portal)
 * تم تطبيق authMiddleware لضمان أن الطالب لا يصل إلا لبيانات مدرسته فقط.
 */
router.use(authMiddleware);

// ==========================================
// 📥 صندوق الوارد (Inbox)
// ==========================================

// عدد الإشعارات غير المقروءة للطالب (لإظهار التنبيه الأحمر)
router.get("/unread-count", unreadCount);

// قائمة الإشعارات المستلمة (تحديثات الغياب، النتائج، إلخ)
router.get("/inbox", listInbox);

// تعليم جميع إشعارات المدرسة الحالية كمقروءة
router.patch("/inbox/read-all", markAllRead);

// تعليم إشعار واحد محدد كمقروء
router.patch("/inbox/:id/read", markOneRead);

// ==========================================
// 📤 صندوق الصادر (Outbox)
// ==========================================

// قائمة الإشعارات التي أرسلها الطالب (للمعلمين أو الإدارة)
router.get("/outbox", listOutbox);

// تفاصيل المستلمين لإشعار مرسل (لمعرفة هل قرأ المعلم الرسالة؟)
router.get("/outbox/:id/recipients", outboxRecipients);

// ==========================================
// 🔍 مساعدات البحث (Lookups)
// ==========================================

// جلب قائمة المعلمين الذين يدرسون هذا الطالب حالياً في هذه المدرسة
router.get("/teachers", listMyTeachers);

// ==========================================
// ✉️ عمليات الإرسال (Messaging)
// ==========================================

// إرسال رسالة/تظلم إلى إدارة المدرسة
router.post("/send/admins", sendAdmins);

// إرسال رسالة إلى معلم محدد أو جميع معلمي الطالب
router.post("/send/teachers", sendTeachers);

export default router;