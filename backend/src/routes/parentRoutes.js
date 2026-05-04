import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { ParentsController } from "../controllers/parentsController.js";
import { getChildActivities } from "../controllers/parentLearningController.js"; 

const router = express.Router();

// 🔒 حماية جميع المسارات (يجب أن يكون المستخدم مسجلاً)
router.use(authMiddleware);

// ==========================================
// ✅ مسارات الإدارة (للبحث عن أولياء الأمور)
// ==========================================
router.get("/search", ParentsController.search);
router.get("/", ParentsController.list);
router.get("/:id", ParentsController.getById);

// ==========================================
// ✅ مسارات بوابة ولي الأمر (Parent Portal)
// ==========================================
// المسار الخاص بمهام وأنشطة الابن
router.get("/children/:childId/activities", getChildActivities);

export default router;