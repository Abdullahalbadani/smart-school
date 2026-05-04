// src/controllers/roleController.js
import Role from "../modules/roleModel.js";
import { pool } from "../config/db.js"; // ✅ لإجبار المستخدمين على تسجيل الخروج

// ➕ إنشاء دور
export const createRole = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "اسم الدور مطلوب" });
    }

    const newRole = await Role.createRole(schoolId, name, description || "");
    return res.status(201).json(newRole);
  } catch (error) {
    console.error("Error creating role:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// 📄 جلب كل الأدوار
export const getRoles = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const roles = await Role.getAllRoles(schoolId);
    return res.json(roles);
  } catch (error) {
    console.error("Error fetching roles:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// 📌 جلب دور واحد
export const getRole = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const role = await Role.getRoleById(schoolId, req.params.id);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }
    return res.json(role);
  } catch (error) {
    console.error("Error fetching role:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ✏️ تحديث دور
export const updateRole = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const { name, description } = req.body;

    const updated = await Role.updateRole(
      schoolId,
      req.params.id,
      name,
      description || ""
    );

    if (!updated) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.json(updated);
  } catch (error) {
    console.error("Error updating role:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// 🗑 حذف دور
export const deleteRole = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const deleted = await Role.deleteRole(schoolId, req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.json(deleted);
  } catch (error) {
    console.error("Error deleting role:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// 🔗 جلب صلاحيات الدور
export const getRolePermissions = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const roleId = req.params.id;

    const role = await Role.getRoleById(schoolId, roleId);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    const permissions = await Role.getRolePermissionIds(schoolId, roleId);
    return res.json({ permissions });
  } catch (error) {
    console.error("Error fetching role permissions:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// 🔗 تحديث صلاحيات الدور ✅✅✅
// 🔗 تحديث صلاحيات الدور ✅
export const updateRolePermissions = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const roleId = Number(req.params.id);

    const role = await Role.getRoleById(schoolId, roleId);
    if (!role) {
      return res.status(404).json({ message: "Role not found" });
    }

    const permissions = Array.isArray(req.body.permissions)
      ? req.body.permissions.map(Number)
      : [];

    // 1. حفظ الصلاحيات في جدول role_permissions (عبر الموديل)
    await Role.setRolePermissions(schoolId, roleId, permissions);

    // 2. تحديث token_version للمستخدمين المرتبطين بهذا الدور فقط
    // نستخدم Join مع جدول user_roles لأن عمود role_id موجود هناك وليس في جدول users
    await pool.query(
      `
      UPDATE users u
      SET token_version = COALESCE(u.token_version, 0) + 1
      FROM user_roles ur
      WHERE ur.user_id = u.id
        AND ur.role_id = $1
        AND u.school_id = $2
      `,
      [roleId, schoolId]
    );

    return res.json({
      success: true,
      message: "تم تحديث الصلاحيات وإجبار المستخدمين على تسجيل الدخول بنجاح ✅",
    });
  } catch (error) {
    console.error("Error updating role permissions:", error);
    return res.status(500).json({ message: "حدث خطأ في السيرفر" });
  }
};

// ✅ منح جميع الصلاحيات للدور ✅
export const grantAllPermissions = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const roleId = Number(req.params.id);
    if (!roleId) return res.status(400).json({ message: "Role ID غير صالح" });

    const role = await Role.getRoleById(schoolId, roleId);
    if (!role) return res.status(404).json({ message: "الدور غير موجود" });

    // 1. جلب كل الصلاحيات
    const allPermissions = await Role.getAllPermissionIds();

    // 2. ربط الدور بكل الصلاحيات (عبر الموديل)
    await Role.setRolePermissions(schoolId, roleId, allPermissions);

    // 3. تحديث token_version للمستخدمين المرتبطين بهذا الدور (الاستعلام الصحيح)
    await pool.query(
      `
      UPDATE users u
      SET token_version = COALESCE(u.token_version, 0) + 1
      FROM user_roles ur
      WHERE ur.user_id = u.id
        AND ur.role_id = $1
        AND u.school_id = $2
      `,
      [roleId, schoolId]
    );

    return res.json({
      success: true,
      message: "✅ تم منح جميع الصلاحيات وتم تسجيل خروج المستخدمين بنجاح",
      permissions_count: allPermissions.length,
    });
  } catch (error) {
    console.error("grantAllPermissions error:", error);
    return res.status(500).json({ message: "خطأ أثناء منح الصلاحيات" });
  }
};