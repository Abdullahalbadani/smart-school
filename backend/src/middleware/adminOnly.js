// middleware/adminOnly.js
import { logAudit } from "../utils/auditLogger.js";

export default async function adminOnly(req, res, next) {
  try {
    // authMiddleware يفترض أنه فك التوكن ووضع البيانات هنا
    if (!req.user) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    // الإبقاء على منطق المشروع الحالي كما هو: role_id رقم 1 هو المدير.
    if (req.user.role_id !== 1) {
      await logAudit({
        req,
        action: "DENY",
        actionLabel: "رفض الوصول إلى وظيفة إدارية",
        module: "Security",
        moduleLabel: "الأمان والصلاحيات",
        tableName: "users",
        recordId: req.user.id,
        description: `تم رفض وصول المستخدم ${req.user.name || req.user.username || req.user.id} إلى وظيفة مخصصة للمدير`,
        details: {
          requested_path: req.originalUrl || req.url,
          requested_method: req.method,
        },
        metadata: {
          severity: "sensitive",
          result: "failure",
        },
        eventKey: "ACCESS_DENIED_ADMIN_ONLY",
        statusCode: 403,
      });

      return res.status(403).json({
        message: "فقط حساب (المدير / admin) يمكنه إدارة المستخدمين والصلاحيات",
      });
    }

    return next();
  } catch (err) {
    console.error("adminOnly error:", err);
    return res.status(500).json({ message: "خطأ في التحقق من صلاحيات المدير" });
  }
}
