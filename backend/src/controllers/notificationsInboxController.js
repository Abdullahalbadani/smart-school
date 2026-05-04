// backend/src/controllers/notificationsInboxController.js
import {
  getInboxList,
  getInboxUnreadCount,
  markRecipientRowAsRead,
  markAllInboxAsRead,
} from "../modules/notifications/notificationsInboxService.js";
import { NotificationAutoService } from "../modules/notifications/index.js";
import { getAttachmentsForNotificationIds } from "../modules/notifications/notificationsAttachmentsService.js";

function getCurrentUserId(req) {
  // ✅ استخراج المعرف من التوكن الموثق
  return req.user?.id || req.user?.userId || req.auth?.userId || null;
}

// 1️⃣ عرض قائمة الإشعارات (صندوق الوارد)
export async function listInbox(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = req.user?.school_id; // 👈 استخراج المدرسة من التوكن

    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    // جلب الإشعارات الخاصة بالمستخدم والمدرسة المحددة
    const data = await getInboxList({
      userId,
      schoolId, // 👈 تمرير إجباري
      filter: req.query.filter || "all",
      q: req.query.q || "",
      limit: req.query.limit || 20,
      offset: req.query.offset || 0,
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    const ids = items.map((x) => Number(x.id)).filter((x) => x > 0);

    // ✅ جلب المرفقات مع التأكد من أنها تنتمي لنفس المدرسة
    const attMap = await getAttachmentsForNotificationIds(ids, schoolId); 
    
    for (const it of items) {
      it.attachments = attMap.get(Number(it.id)) || [];
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error("listInbox error:", err);
    return res.status(500).json({ success: false, message: "فشل جلب صندوق الوارد" });
  }
}

// 2️⃣ عدد الإشعارات غير المقروءة
export async function unreadCount(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    // جلب العدد مع حماية المدرسة
    const data = await getInboxUnreadCount({ userId, schoolId });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("unreadCount error:", err);
    return res.status(500).json({ success: false, message: "فشل جلب عدد غير المقروء" });
  }
}

// 3️⃣ تعليم إشعار محدد كمقروء
export async function markRead(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    const recipientRowId = Number(req.params.recipientRowId);
    if (!recipientRowId) {
      return res.status(400).json({ success: false, message: "معرّف غير صالح" });
    }

    // التحديث مع التأكد من ملكية الإشعار للمستخدم والمدرسة
    const data = await markRecipientRowAsRead({ userId, schoolId, recipientRowId });

    if (!data) {
      return res.status(404).json({ success: false, message: "الإشعار غير موجود أو لا يخصك" });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error("markRead error:", err);
    return res.status(500).json({ success: false, message: "فشل تعليم الإشعار كمقروء" });
  }
}

// 4️⃣ تعليم كل الإشعارات كمقروءة
export async function markAllRead(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = req.user?.school_id;

    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    // تحديث الكل ضمن نطاق المدرسة فقط
    const data = await markAllInboxAsRead({ userId, schoolId });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("markAllRead error:", err);
    return res.status(500).json({ success: false, message: "فشل تعليم الكل كمقروء" });
  }
}