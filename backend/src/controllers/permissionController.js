import { PermissionModel } from "../modules/permissionModel.js";

export const PermissionController = {
  // إنشاء صلاحية
  async createPermission(req, res) {
    try {
      const { module_id, name, code } = req.body;

      if (!module_id || !name || !code) {
        return res.status(400).json({ error: "جميع الحقول مطلوبة" });
      }

      const permission = await PermissionModel.create(module_id, name, code);
      res.status(201).json(permission);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  },

  // جلب كل الصلاحيات
  async getPermissions(req, res) {
    try {
      const permissions = await PermissionModel.getAll();
      res.json(permissions);
    } catch (err) {
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  },

  // جلب صلاحية واحدة
  async getPermission(req, res) {
    try {
      const { id } = req.params;
      const permission = await PermissionModel.getById(id);

      if (!permission) {
        return res.status(404).json({ error: "الصلاحية غير موجودة" });
      }

      res.json(permission);
    } catch (err) {
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  },

  // تعديل الصلاحية
  async updatePermission(req, res) {
    try {
      const { id } = req.params;
      const { name, code } = req.body;

      const permission = await PermissionModel.update(id, name, code);
      res.json(permission);
    } catch (err) {
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  },

  // حذف صلاحية
  async deletePermission(req, res) {
    try {
      const { id } = req.params;

      await PermissionModel.remove(id);
      res.json({ message: "تم حذف الصلاحية" });
    } catch (err) {
      res.status(500).json({ error: "خطأ في السيرفر" });
    }
  }
};
