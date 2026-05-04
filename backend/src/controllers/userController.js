// src/controllers/userController.js
import { pool } from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const UserController = {
  // ------------------------------------
  // إنشاء مستخدم جديد (مع الدور)
  // body: { full_name, username, email, phone, password, role_id }
  // ------------------------------------
  async create(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const { full_name, username, email, phone, password, role_id } = req.body;

      if (!full_name || !username || !email || !password || !role_id) {
        return res
          .status(400)
          .json({ message: "جميع الحقول مطلوبة بما فيها الدور (role_id)" });
      }

      await client.query("BEGIN");

      // 🛡️ فحص أمني: التأكد من أن الدور يتبع لنفس المدرسة
      const roleCheck = await client.query(
        "SELECT id FROM roles WHERE id=$1 AND school_id=$2", 
        [role_id, schoolId]
      );
      if (roleCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "الدور غير موجود أو لا يتبع لهذه المدرسة" });
      }

      // التأكد من عدم التكرار داخل نفس المدرسة
      const dup = await client.query(
        "SELECT id FROM users WHERE (email = $1 OR username = $2) AND school_id = $3",
        [email, username, schoolId]
      );
      if (dup.rows.length > 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ message: "البريد الإلكتروني أو اسم المستخدم موجود مسبقاً" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // إضافة المستخدم مع ربطه بالمدرسة
      const userRes = await client.query(
        `
        INSERT INTO users (school_id, name, username, email, phone, password_hash, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'active')
        RETURNING
          id,
          name      AS full_name,
          username,
          email,
          phone,
          status
      `,
        [schoolId, full_name, username, email, phone, hashedPassword]
      );

      const newUserId = userRes.rows[0].id;

      // ربط المستخدم بالدور
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
        [newUserId, role_id]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "تم إنشاء المستخدم وتعيين الدور بنجاح",
        data: userRes.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error creating user:", err);
      return res
        .status(500)
        .json({ message: "خطأ في السيرفر أثناء إنشاء المستخدم" });
    } finally {
      client.release();
    }
  },

  // ------------------------------------
  // جلب جميع المستخدمين (مع أدوارهم) الخاصة بالمدرسة
  // ------------------------------------
  async getAll(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const result = await pool.query(
        `
        SELECT
          u.id,
          u.name      AS full_name,
          u.username,
          u.email,
          u.phone,
          u.status,
          ur.role_id,
          r.name      AS role_name
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles      r  ON ur.role_id = r.id
        WHERE u.school_id = $1
        ORDER BY u.id ASC
      `,
        [schoolId]
      );

      return res.json(result.rows);
    } catch (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({ message: "خطأ في جلب المستخدمين" });
    }
  },

  // ------------------------------------
  // جلب مستخدم واحد
  // ------------------------------------
  async getOne(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const { id } = req.params;
      const result = await pool.query(
        `
        SELECT
          u.id,
          u.name      AS full_name,
          u.username,
          u.email,
          u.phone,
          u.status,
          ur.role_id,
          r.name      AS role_name
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        LEFT JOIN roles      r  ON ur.role_id = r.id
        WHERE u.id = $1 AND u.school_id = $2
      `,
        [id, schoolId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "المستخدم غير موجود" });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Error fetching user:", err);
      return res.status(500).json({ message: "خطأ في جلب المستخدم" });
    }
  },

  // ------------------------------------
  // تحديث مستخدم + الدور
  // ------------------------------------
  async update(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const userId = req.params.id;
      const { full_name, username, email, phone, password, role_id } = req.body;

      if (!full_name || !username || !email || !role_id) {
        return res
          .status(400)
          .json({ message: "الاسم والبريد واسم المستخدم والدور مطلوبة" });
      }

      await client.query("BEGIN");

      // 🛡️ فحص أمني: التأكد أن الدور والمستخدم يتبعان لنفس المدرسة
      const roleCheck = await client.query("SELECT id FROM roles WHERE id=$1 AND school_id=$2", [role_id, schoolId]);
      if (roleCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "الدور غير موجود أو لا يتبع لمدرستك" });
      }

      const userCheck = await client.query("SELECT id FROM users WHERE id=$1 AND school_id=$2", [userId, schoolId]);
      if (userCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "المستخدم غير موجود أو لا يتبع لمدرستك" });
      }

      if (password && password.trim() !== "") {
        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query(
          `
          UPDATE users
          SET name = $1, username = $2, email = $3, phone = $4, password_hash = $5
          WHERE id = $6 AND school_id = $7
        `,
          [full_name, username, email, phone, hashedPassword, userId, schoolId]
        );
      } else {
        await client.query(
          `
          UPDATE users
          SET name = $1, username = $2, email = $3, phone = $4
          WHERE id = $5 AND school_id = $6
        `,
          [full_name, username, email, phone, userId, schoolId]
        );
      }

      // تحديث الدور
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
        [userId, role_id]
      );

      await client.query("COMMIT");

      return res.json({ message: "تم تحديث المستخدم بنجاح" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error updating user:", err);
      return res.status(500).json({ message: "خطأ في التحديث" });
    } finally {
      client.release();
    }
  },

  // ------------------------------------
  // حذف مستخدم + الربط بالدور
  // ------------------------------------
  async delete(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const userId = req.params.id;

      await client.query("BEGIN");
      
      const userCheck = await client.query("SELECT id FROM users WHERE id=$1 AND school_id=$2", [userId, schoolId]);
      if (userCheck.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "المستخدم غير موجود أو لا يتبع لمدرستك" });
      }

      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [
        userId,
      ]);
      await client.query(`DELETE FROM users WHERE id = $1 AND school_id = $2`, [userId, schoolId]);
      await client.query("COMMIT");

      return res.json({ message: "تم حذف المستخدم" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error deleting user:", err);
      return res.status(500).json({ message: "خطأ في الحذف" });
    } finally {
      client.release();
    }
  },

  // ------------------------------------
  // صلاحيات القائمة للمستخدم الحالي
  // ------------------------------------
  async getMyMenuPermissions(req, res) {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      if (!token) {
        return res.status(401).json({ message: "Missing token" });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const userId = payload.id || payload.user_id;
      const schoolId = payload.school_id;

      if (!userId || !schoolId) {
        return res.status(401).json({ message: "Invalid token payload" });
      }

      const result = await pool.query(
        `
        SELECT DISTINCT p.code
        FROM users u
        JOIN user_roles       ur ON ur.user_id = u.id
        JOIN roles            r  ON r.id = ur.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions      p  ON p.id = rp.permission_id
        WHERE u.id = $1 AND u.school_id = $2
        ORDER BY p.code
      `,
        [userId, schoolId]
      );

      const permissions = result.rows.map((row) => row.code);
      return res.json({ permissions });
    } catch (err) {
      console.error("Error getting menu permissions:", err);

      if (
        err.name === "JsonWebTokenError" ||
        err.name === "TokenExpiredError"
      ) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      return res
        .status(500)
        .json({ message: "خطأ في جلب صلاحيات المستخدم" });
    }
  },
};