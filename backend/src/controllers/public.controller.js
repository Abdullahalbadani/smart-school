import { registerSchoolService } from '../services/public/registerSchool.service.js';
import { logAudit } from '../utils/auditLogger.js';

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

    await logAudit({
      req,
      action: 'CREATE',
      actionLabel: 'تسجيل مدرسة جديدة',
      module: 'school-settings',
      moduleLabel: 'إعدادات المدرسة',
      tableName: 'schools',
      recordId: result.school?.id,
      description: `تم تسجيل المدرسة (${result.school?.name_ar || result.school?.slug || result.school?.id}) وإنشاء حساب مديرها`,
      newData: {
        school_id: result.school?.id,
        name_ar: result.school?.name_ar,
        slug: result.school?.slug,
        admin_user_id: result.admin?.id,
      },
      metadata: { severity: 'sensitive', result: 'success' },
      eventKey: 'SCHOOL_REGISTER_PUBLIC',
      statusCode: 201,
      schoolIdFallback: result.school?.id,
      userIdFallback: result.admin?.id,
      userNameFallback: payload.adminName || payload.adminUsername || 'مدير المدرسة',
      userRoleFallback: 'school_admin',
    });

    return res.status(201).json({
      success: true,
      message: 'School registered successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}