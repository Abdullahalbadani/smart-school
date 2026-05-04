import { Router } from "express";
import multer from "multer";
import path from "path";
import authMiddleware from "../middleware/authMiddleware.js";

import {
  meta,
  profileUpdate,
  academicGet, // ✅ أضف هذا الاستيراد
  academicUpdate, // ✅ أضف هذا الاستيراد
  financeUpdate,
  portalsGet,
  portalsUpdate,
  yearsCreate,
  yearsUpdate,
  yearsToggle,
  stagesCreate,
  stagesUpdate,
  stagesToggle,
  gradesCreate,
  gradesUpdate,
  gradesToggle,
  sectionsCreate,
  sectionsUpdate,
  sectionsToggle,
  subjectsCreate,
  subjectsUpdate,
  financeGet,
  subjectsToggle,
  periodsCreate,
  periodsUpdate,
  periodsToggle,
  curriculumGet,
  curriculumSet,
  teacherSubjectGet,
  teacherSubjectSet,
} from "../controllers/schoolSettingsController.js";

const router = Router();

// --- إعداد multer لرفع الشعارات ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "school_" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

router.use(authMiddleware);

router.get("/meta", meta);
router.get('/finance', financeGet);
// ✅ الملف الشخصي للمدرسة
router.post("/profile", upload.single("logo"), profileUpdate);

// ✅ الإعدادات الأكاديمية (الجديدة)
router.get("/academic", academicGet);
router.post("/academic", academicUpdate);

router.post("/finance", financeUpdate);

router.get("/portals", portalsGet);
router.post("/portals", portalsUpdate);
// السنوات الدراسية
router.post("/years", yearsCreate);
router.patch("/years/:id", yearsUpdate);
router.patch("/years/:id/toggle", yearsToggle);

// المراحل
router.post("/stages", stagesCreate);
router.patch("/stages/:id", stagesUpdate);
router.patch("/stages/:id/toggle", stagesToggle);

// الصفوف
router.post("/grades", gradesCreate);
router.patch("/grades/:id", gradesUpdate);
router.patch("/grades/:id/toggle", gradesToggle);

// الشعب
router.post("/sections", sectionsCreate);
router.patch("/sections/:id", sectionsUpdate);
router.patch("/sections/:id/toggle", sectionsToggle);

// المواد
router.post("/subjects", subjectsCreate);
router.patch("/subjects/:id", subjectsUpdate);
router.patch("/subjects/:id/toggle", subjectsToggle);

// الفترات (الحصص)
router.post("/periods", periodsCreate);
router.patch("/periods/:id", periodsUpdate);
router.patch("/periods/:id/toggle", periodsToggle);

// منهج الصفوف
router.get("/curriculum", curriculumGet);
router.post("/curriculum", curriculumSet);

// تأهيل المدرسين
router.get("/teacher-subjects", teacherSubjectGet);
router.post("/teacher-subjects", teacherSubjectSet);

export default router;
