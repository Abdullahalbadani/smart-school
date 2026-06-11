// src/middleware/checkPermission.js
import PermissionRoleModel from "../modules/permissionRoleModel.js";
import { logAudit } from "../utils/auditLogger.js";

export default function checkPermission(permissionCode) {
  return async function (req, res, next) {
    try {
      const user = req.user; // يجي من authMiddleware

      // لوج للتشخيص
      console.log("==== checkPermission ====");
      console.log("required permission:", permissionCode);
      console.log("user from token:", user);

      if (!user) {
        return res
          .status(401)
          .json({ message: "غير مصرح: لم يتم العثور على بيانات المستخدم" });
      }

      const roleName = String(user.role || user.role_name || "").toLowerCase();

      // ✅ الأدمـن / سوبر أدمن له كل الصلاحيات
      if (
        roleName === "admin" ||
        roleName === "superadmin"
      ) {
        console.log("-> bypass as admin");
        return next();
      }

      let hasPermission = false;

      // 1️⃣ نحاول أولاً من user.permissions لو موجودة
      if (Array.isArray(user.permissions)) {
        console.log("user.permissions:", user.permissions);
        if (user.permissions.includes(permissionCode)) {
          console.log("-> allowed via user.permissions");
          hasPermission = true;
        } else {
          console.log("-> not found in user.permissions, will check DB");
        }
      } else {
        console.log("user.permissions is not an array, will check DB");
      }

      // 2️⃣ لو لسه ما تأكدنا → نفحص من قاعدة البيانات دائمًا
      if (!hasPermission) {
        const dbHas = await PermissionRoleModel.roleHasPermission(
          user.role_id,
          permissionCode
        );
        console.log("-> hasPermission from DB?", dbHas);
        hasPermission = dbHas;
      }

      // 3️⃣ النتيجة النهائية
      if (!hasPermission) {
        await logAudit({
          req,
          action: "DENY",
          actionLabel: "رفض الوصول لعدم امتلاك الصلاحية",
          module: "Security",
          moduleLabel: "الأمان والصلاحيات",
          tableName: "permissions",
          description: `تم رفض وصول المستخدم ${user.name || user.username || user.id} لعدم امتلاك الصلاحية (${permissionCode})`,
          details: {
            required_permission: permissionCode,
            requested_path: req.originalUrl || req.url,
            requested_method: req.method,
          },
          metadata: {
            severity: "sensitive",
            result: "failure",
          },
          eventKey: "ACCESS_DENIED_PERMISSION",
          statusCode: 403,
        });

        return res
          .status(403)
          .json({ message: "ليس لديك صلاحية لتنفيذ هذا الإجراء" });
      }

      return next();
    } catch (err) {
      console.error("checkPermission error:", err);
      return res
        .status(500)
        .json({ message: "خطأ في التحقق من صلاحيات المستخدم" });
    }
  };
}
