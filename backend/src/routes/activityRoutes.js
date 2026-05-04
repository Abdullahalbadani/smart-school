import express from 'express';
import { getRecentActivities } from '../controllers/activityLogController.js';

// ✅ الاستدعاء الصحيح بناءً على نظامك
import authMiddleware from '../middleware/authMiddleware.js'; 

const router = express.Router();

// مسار محمي يجلب أحدث النشاطات للمدرسة
router.get('/activities/recent', authMiddleware, getRecentActivities);

export default router;