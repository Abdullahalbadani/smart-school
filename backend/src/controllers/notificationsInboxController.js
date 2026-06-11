// backend/src/controllers/notificationsInboxController.js
import path from "path";
import {
  getInboxList,
  getInboxUnreadCount,
  markRecipientRowAsRead,
  markAllInboxAsRead,
} from "../modules/notifications/notificationsInboxService.js";
import {
  getAttachmentsForNotificationIds,
  getAttachmentForServing,
} from "../modules/notifications/notificationsAttachmentsService.js";

function getCurrentUserId(req) {
  return req.user?.id || req.user?.userId || req.auth?.userId || null;
}

function getCurrentSchoolId(req) {
  return req.user?.school_id || null;
}

function emitUnreadRefresh(req, userId) {
  const io = req.app?.get?.("io");
  if (!io || !userId) return;
  io.to(`user_${Number(userId)}`).emit("notification:unread-count:refresh");
}

export async function listInbox(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = getCurrentSchoolId(req);
    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    const data = await getInboxList({
      userId,
      schoolId,
      filter: req.query.filter || "all",
      q: req.query.q || "",
      limit: req.query.limit || 20,
      offset: req.query.offset || 0,
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    const notificationIds = items.map((item) => Number(item.id)).filter((id) => id > 0);
    const attachmentsMap = await getAttachmentsForNotificationIds(notificationIds, schoolId);

    for (const item of items) {
      item.attachments = attachmentsMap.get(Number(item.id)) || [];
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error("listInbox error:", error);
    return res.status(500).json({ success: false, message: "فشل جلب صندوق الوارد" });
  }
}

export async function unreadCount(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = getCurrentSchoolId(req);
    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    const data = await getInboxUnreadCount({ userId, schoolId });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("unreadCount error:", error);
    return res.status(500).json({ success: false, message: "فشل جلب عدد غير المقروء" });
  }
}

export async function markRead(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = getCurrentSchoolId(req);
    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    const recipientRowId = Number(req.params.recipientRowId);
    if (!Number.isInteger(recipientRowId) || recipientRowId <= 0) {
      return res.status(400).json({ success: false, message: "معرّف غير صالح" });
    }

    const data = await markRecipientRowAsRead({ userId, schoolId, recipientRowId });
    if (!data) {
      return res.status(404).json({ success: false, message: "الإشعار غير موجود أو لا يخصك" });
    }

    emitUnreadRefresh(req, userId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("markRead error:", error);
    return res.status(500).json({ success: false, message: "فشل تعليم الإشعار كمقروء" });
  }
}

export async function markAllRead(req, res) {
  try {
    const userId = getCurrentUserId(req);
    const schoolId = getCurrentSchoolId(req);
    if (!userId || !schoolId) {
      return res.status(401).json({ success: false, message: "غير مصرح" });
    }

    const data = await markAllInboxAsRead({ userId, schoolId });
    emitUnreadRefresh(req, userId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("markAllRead error:", error);
    return res.status(500).json({ success: false, message: "فشل تعليم الكل كمقروء" });
  }
}

async function resolveAttachment(req, res) {
  const attachmentId = Number(req.params.attachmentId);
  const userId = Number(getCurrentUserId(req));
  const schoolId = Number(getCurrentSchoolId(req));

  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    res.status(400).json({ success: false, message: "معرّف المرفق غير صالح" });
    return null;
  }

  const attachment = await getAttachmentForServing({ attachmentId, userId, schoolId });
  if (!attachment) {
    res.status(404).json({ success: false, message: "المرفق غير موجود" });
    return null;
  }
  if (attachment._forbidden) {
    res.status(403).json({ success: false, message: "ليس لديك صلاحية لفتح هذا المرفق" });
    return null;
  }
  if (attachment._missing) {
    res.status(404).json({ success: false, message: "ملف المرفق غير موجود على الخادم" });
    return null;
  }

  return attachment;
}

export async function viewAttachment(req, res) {
  try {
    const attachment = await resolveAttachment(req, res);
    if (!attachment) return;

    if (attachment._isLink) return res.redirect(302, attachment.link_url);

    const fileName = attachment.original_name || path.basename(attachment._absPath);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.sendFile(attachment._absPath);
  } catch (error) {
    console.error("viewAttachment error:", error);
    return res.status(500).json({ success: false, message: "تعذر فتح المرفق" });
  }
}

export async function downloadAttachment(req, res) {
  try {
    const attachment = await resolveAttachment(req, res);
    if (!attachment) return;

    if (attachment._isLink) return res.redirect(302, attachment.link_url);

    const fileName = attachment.original_name || path.basename(attachment._absPath);
    return res.download(attachment._absPath, fileName);
  } catch (error) {
    console.error("downloadAttachment error:", error);
    return res.status(500).json({ success: false, message: "تعذر تنزيل المرفق" });
  }
}
