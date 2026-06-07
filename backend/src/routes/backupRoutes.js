import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getSettings,
  updateSettings,
  getLogs,
  runManualBackup,
  downloadBackup,
  deleteBackup,
  browseDirectories,
  browseRestoreFiles,
  restoreBackup,
  restoreBackupFromFile,
  getGoogleDriveStatus,
  disconnectGoogleDrive
} from "../controllers/backupController.js";

const router = Router();

// جميع المسارات تتطلب تسجيل الدخول.
// يفضّل إضافة middleware صلاحية إدارية مناسب لمشروعك هنا أيضًا.
router.use(authMiddleware);

// إعدادات النسخ الاحتياطي
router.get("/settings", getSettings);
router.post("/settings", updateSettings);

// Google Drive
router.get("/google-drive-status", getGoogleDriveStatus);
router.post("/google-drive-disconnect", disconnectGoogleDrive);

// السجلات والنسخ اليدوي
router.get("/logs", getLogs);
router.post("/run-manual", runManualBackup);

// تنزيل نسخة محفوظة
router.get("/download/:id", downloadBackup);

// تصفح مجلدات الحفظ وملفات الاستعادة
router.get("/browse-directories", browseDirectories);
router.get("/browse-restore-files", browseRestoreFiles);

// استعادة نسخة من السجل أو من ملف موجود على الخادم
router.post("/:id/restore", restoreBackup);
router.post("/restore-from-file", restoreBackupFromFile);

// حذف ملف وسجل نسخة
router.delete("/:id", deleteBackup);

export default router;
