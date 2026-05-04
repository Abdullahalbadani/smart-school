import { registerSchoolService } from '../services/public/registerSchool.service.js';

export async function registerSchool(req, res, next) {
  try {
    // req.body يحتوي على كل الحقول النصية (الاسم، الايميل، الخ..)
    const payload = req.body;

    // ✅ إذا قام المستخدم برفع صورة، سيقوم multer بوضعها في req.file
    if (req.file) {
      // نأخذ مسار الصورة ونضيفه إلى المتغيرات لكي يحفظه السيرفس في قاعدة البيانات
      payload.logoUrl = `/uploads/${req.file.filename}`;
    }

    const result = await registerSchoolService(payload);

    return res.status(201).json({
      success: true,
      message: 'School registered successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}