// middleware/adminOnly.js
export default function adminOnly(req, res, next) {
  try {
    // authMiddleware يفترض أنه فك التوكن و حط البيانات هنا
    // و الـ token فيه: { id, role_id, role }
    if (!req.user) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    // 👈 عدّل الرقم 1 لو كان الـ role_id حق الأدمن غير 1
    if (req.user.role_id !== 1) {
      return res.status(403).json({
        message: "فقط حساب (المدير / admin) يمكنه إدارة المستخدمين والصلاحيات",
      });
    }

    next();
  } catch (err) {
    console.error("adminOnly error:", err);
    res.status(500).json({ message: "خطأ في التحقق من صلاحيات المدير" });
  }
}
