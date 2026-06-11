// backend/src/routes/notificationsAdminRoutes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  previewRecipients,
  sendManual,
  listSentLog,
  sentLogDetails,
  lookupStagesHandler,
  lookupGradesHandler,
  lookupSectionsHandler,
  lookupStudentsHandler,
  lookupTeachersHandler,
  lookupGuardiansHandler,
} from "../controllers/notificationsAdminController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireNotificationsAdminAccess } from "../middleware/notificationsAdminAccess.js";

const router = express.Router();
const UPLOAD_DIR = path.join(process.cwd(), "storage", "private", "notifications");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".txt", ".csv", ".docx", ".xlsx", ".pptx",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 12);
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return callback(new Error("نوع المرفق غير مسموح. استخدم PDF أو صورة أو ملف Office حديث أو TXT أو CSV"));
    }
    return callback(null, true);
  },
});

// The router stays protected even if mounted elsewhere in the future.
router.use(authMiddleware);

const requireSendAccess = requireNotificationsAdminAccess("send");
const requireSentLogAccess = requireNotificationsAdminAccess("sentLog");

router.get("/lookups/stages", requireSendAccess, lookupStagesHandler);
router.get("/lookups/grades", requireSendAccess, lookupGradesHandler);
router.get("/lookups/sections", requireSendAccess, lookupSectionsHandler);
router.get("/lookups/students", requireSendAccess, lookupStudentsHandler);
router.get("/lookups/teachers", requireSendAccess, lookupTeachersHandler);
router.get("/lookups/guardians", requireSendAccess, lookupGuardiansHandler);

router.post("/preview-recipients", requireSendAccess, previewRecipients);
router.post("/send", requireSendAccess, upload.array("files", 10), sendManual);

router.get("/sent-log", requireSentLogAccess, listSentLog);
router.get("/sent-log/:id", requireSentLogAccess, sentLogDetails);

export default router;
