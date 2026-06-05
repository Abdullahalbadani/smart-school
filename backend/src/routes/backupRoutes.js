import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";
import multer from "multer";
import {
  getSettings,
  updateSettings,
  getLogs,
  runManualBackup,
  downloadBackup,
  deleteBackup,
  browseDirectories,
  restoreBackup,
  getGoogleDriveStatus,      // 🟢 إضافة استيراد دالة الحالة
  disconnectGoogleDrive      // 🟢 إضافة استيراد دالة فصل الحساب
} from "../controllers/backupController.js";
const upload = multer({ dest: "uploads/temp/" });
const router = Router();

// تأمين كافة مسارات النسخ الاحتياطي بصلاحيات إدارية كاملة للمدرسة
router.use(authMiddleware);

router.get("/settings", getSettings);
router.post("/settings", updateSettings);
// 🟢 مسارات إدارة التزامن السحابي مع قوقل درايف (BYOD)
router.get("/google-drive-status", getGoogleDriveStatus);
router.post("/google-drive-disconnect", disconnectGoogleDrive);
router.get("/logs", getLogs);
router.post("/run-manual", runManualBackup);
router.get("/download/:id", downloadBackup);
router.get("/browse-directories", browseDirectories);
router.post("/restore", upload.single("backupFile"), restoreBackup);
router.delete("/:id", deleteBackup);

export default router;

