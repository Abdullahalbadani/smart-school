// backend/src/routes/notificationsInboxRoutes.js
import { Router } from "express";
import {
  listInbox,
  unreadCount,
  markRead,
  markAllRead,
  viewAttachment,
  downloadAttachment,
} from "../controllers/notificationsInboxController.js";

const router = Router();

router.get("/inbox", listInbox);
router.get("/inbox/unread-count", unreadCount);

// Static route must be registered before /:recipientRowId/read.
router.patch("/inbox/read-all", markAllRead);
router.patch("/inbox/:recipientRowId/read", markRead);

router.get("/attachments/:attachmentId/view", viewAttachment);
router.get("/attachments/:attachmentId/download", downloadAttachment);

export default router;
