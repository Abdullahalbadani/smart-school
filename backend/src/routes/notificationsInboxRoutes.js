// backend/src/routes/notificationsInboxRoutes.js
import { Router } from "express";
import {
  listInbox,
  unreadCount,
  markRead,
  markAllRead,
} from "../controllers/notificationsInboxController.js";

const router = Router();

/**
 * 🔒 صندوق الوارد للمستخدمين (Inbox)
 * ملاحظة: authMiddleware مضاف في app.js عند الربط، 
 * وهو المسؤول عن حقن req.user.school_id لضمان عزل البيانات بين المدارس.
 */

// 1️⃣ جلب قائمة الإشعارات (مع الفلترة والبحث والمرفقات)
// GET /api/notifications/inbox?filter=unread&q=search_term
router.get("/inbox", listInbox);

// 2️⃣ جلب عدد الإشعارات غير المقروءة فقط (لإظهار التنبيهات في الواجهة)
// GET /api/notifications/inbox/unread-count
router.get("/inbox/unread-count", unreadCount);

// 3️⃣ تعليم إشعار محدد كمقروء (باستخدام معرف سجل الاستلام)
// PATCH /api/notifications/inbox/123/read
router.patch("/inbox/:recipientRowId/read", markRead);

// 4️⃣ تعليم جميع إشعارات المستخدم في المدرسة الحالية كمقروءة
// PATCH /api/notifications/inbox/read-all
router.patch("/inbox/read-all", markAllRead);

export default router;