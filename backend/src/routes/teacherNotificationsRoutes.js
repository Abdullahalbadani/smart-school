// backend/src/routes/teacherNotificationsRoutes.js
import express from "express";
import {
  getUnreadCount,
  listInbox,
  markOneRead,
  markAllRead,
  listOutbox,
  outboxRecipients,
} from "../controllers/teacherNotificationsController.js";

// ✅ استيراد الميدل وير الخاص بالتوثيق (تأكد من المسار الصحيح في مشروعك)
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// تطبيق الحماية على جميع المسارات لضمان استخراج req.user.school_id
router.use(authMiddleware);

// عداد غير المقروء (وارد المعلم)
router.get("/unread-count", getUnreadCount);

// الوارد
router.get("/inbox", listInbox);

// تعليم كل الوارد كمقروء (يُفضل وضعه قبل المسارات الديناميكية :id)
router.patch("/inbox/read-all", markAllRead);

// تعليم إشعار واحد مقروء (بواسطة الـ id)
router.patch("/inbox/:id/read", markOneRead);

// الصادر (الذي أرسله المعلم)
router.get("/outbox", listOutbox);

// تفاصيل المستلمين (من قرأ/لم يقرأ)
router.get("/outbox/:id/recipients", outboxRecipients);

export default router;