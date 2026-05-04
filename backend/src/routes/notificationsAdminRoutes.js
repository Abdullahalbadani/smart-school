// backend/src/routes/notificationsAdminRoutes.js
import express from "express";
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
import authMiddleware from "../middleware/authMiddleware.js"; // ✅ ضروري جداً لاستخراج school_id
import checkPermission from "../middleware/checkPermission.js"; // ✅ اختياري حسب نظامك
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = express.Router();

// --- إعدادات رفع الملفات (المرفقات) ---
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "notifications");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    // تسمية فريدة لمنع تداخل الملفات
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 25 * 1024 * 1024 }, // حد أقصى 25 ميجا
});

/**
 * 🔒 حماية جميع المسارات:
 * جميع هذه العمليات تتطلب أن يكون المستخدم مسجل دخول
 * لكي يتمكن النظام من معرفة مدرسة المستخدم (req.user.school_id)
 */

// ===== Lookups للواجهة (البحث المخصص للمدرسة) =====
router.get("/lookups/stages", authMiddleware, lookupStagesHandler);
router.get("/lookups/grades", authMiddleware, lookupGradesHandler);
router.get("/lookups/sections", authMiddleware, lookupSectionsHandler);
router.get("/lookups/students", authMiddleware, lookupStudentsHandler);
router.get("/lookups/teachers", authMiddleware, lookupTeachersHandler);
router.get("/lookups/guardians", authMiddleware, lookupGuardiansHandler);

// ===== عمليات الإرسال والمعاينة =====

// معاينة المستلمين (يتطلب صلاحية الإرسال)
router.post(
  "/preview-recipients", 
  authMiddleware, 
  // checkPermission?.("notifications.send"), // اختياري: تأكد أن الدالة مدعومة عندك
  previewRecipients
);

// إرسال إشعار يدوي مع المرفقات
router.post(
  "/send", 
  authMiddleware, 
  // checkPermission?.("notifications.send"), 
  upload.array("files", 10), // استقبال حتى 10 ملفات
  sendManual
);

// ===== سجلات الإرسال (Sent Log) =====

// قائمة الإشعارات المرسلة من قبل المدرسة
router.get(
  "/sent-log", 
  authMiddleware, 
  // checkPermission?.("notifications.sent_log.view"), 
  listSentLog
);

// تفاصيل إشعار مرسل محدد مع حالة القراءة
router.get(
  "/sent-log/:id", 
  authMiddleware, 
  // checkPermission?.("notifications.sent_log.view"), 
  sentLogDetails
);

export default router;