import PermissionRoleModel from "../modules/permissionRoleModel.js";

export const PermissionRoleController = {
  // ربط صلاحية بدور
  async assign(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

      const { role_id, permission_id } = req.body;

      if (!role_id || !permission_id) {
        return res.status(400).json({ error: "role_id و permission_id مطلوبين" });
      }

      const data = await PermissionRoleModel.assign(schoolId, role_id, permission_id);

      res.status(201).json({
        message: "تم ربط الصلاحية بالدور بنجاح",
        data,
      });
    } catch (err) {
      console.error(err);
      if (err.message === "Role not found or unauthorized") {
        return res.status(403).json({ error: "الدور غير موجود أو لا يتبع لمدرستك" });
      }
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  },

  // جلب كل العلاقات
  async getAll(req, res) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const data = await PermissionRoleModel.getAll(schoolId);
    res.json(data);
  },

  // جلب حسب الدور
  async getByRole(req, res) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const { role_id } = req.params;
    const data = await PermissionRoleModel.getByRole(schoolId, role_id);
    res.json(data);
  },

  // حذف علاقة
  async delete(req, res) {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const { id } = req.params;
    const deleted = await PermissionRoleModel.delete(schoolId, id);

    if (!deleted) {
      return res.status(404).json({ error: "العنصر غير موجود أو لا تملك صلاحية حذفه" });
    }

    res.json({ message: "تم الحذف بنجاح", deleted });
  },
};