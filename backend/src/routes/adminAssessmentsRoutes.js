import express from 'express';
import authMiddleware from "../middleware/authMiddleware.js";
import { autoActivityLogger } from '../middleware/activityLogger.js';
import { 
    getAdminAssessments, 
    getAssessmentGrades, 
    bulkOverrideGrades ,
    getSubjectsByGradeId
} from '../controllers/adminAssessmentsController.js';

const router = express.Router();

// جميع المسارات هنا تحتاج إلى تسجيل دخول
router.use(authMiddleware);

// 1. جلب التقييمات بناءً على الشعبة والمادة (للقائمة المنسدلة)
router.get('/', getAdminAssessments);
router.get('/subjects-by-grade', getSubjectsByGradeId);
// 2. جلب درجات تقييم معين لطلاب شعبة معينة (لرسم الجدول)
router.get('/:assessment_id/grades', getAssessmentGrades);

// 3. اعتماد وتعديل الدرجات من قبل الإدارة (مع التسجيل الآلي في سجل التدقيق)
router.post('/:assessment_id/bulk-override', autoActivityLogger, bulkOverrideGrades);

export default router;