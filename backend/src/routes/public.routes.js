import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { registerSchool } from '../controllers/public.controller.js';

const router = Router();

// إعداد مكان واسم حفظ الشعار (الصور)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // ⚠️ تأكد أن لديك مجلد باسم "uploads" في المسار الرئيسي لمشروعك (بجانب src)
    cb(null, 'uploads/'); 
  },
  filename: function (req, file, cb) {
    // إعطاء الصورة اسماً فريداً: logo-16987654321-random.jpg
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// ✅ إضافة upload.single('logo') لكي يتمكن السيرفر من قراءة الصورة
// كلمة 'logo' يجب أن تطابق نفس الاسم الذي أرسلناه من الـ FormData في المتصفح
router.post('/register-school', upload.single('logo'), registerSchool);

export default router;