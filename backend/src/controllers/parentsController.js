// src/controllers/parentsController.js
import { pool } from "../config/db.js";

/**
 * يحاول الاستعلام على عدة جداول محتملة (parents/guardians)
 * تم تعديلها لدعم تمرير المتغيرات بشكل ديناميكي.
 */
const TABLES = ["guardians", "parents"]; // قدمنا guardians لأنه غالباً هو المعتمد لديك في النظام

async function queryFirstWorking(sqlBuilder, params = []) {
  let lastErr = null;
  for (const table of TABLES) {
    try {
      const sql = sqlBuilder(table);
      const r = await pool.query(sql, params);
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function normalizeRow(row) {
  return {
    id: row.id != null ? String(row.id) : "",
    full_name: (row.full_name ?? row.name ?? "").toString(),
    phone: (row.phone ?? row.mobile ?? "").toString(),
    email: (row.email ?? "").toString(),
  };
}

export const ParentsController = {
  // GET /api/parents/search?q=...&limit=10
  async search(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const q = String(req.query.q || req.query.search || "").trim();
      const limit = Math.min(parseInt(req.query.limit || "10", 10) || 10, 50);

      if (!q || q.length < 2) {
        return res.json([]); // لا نرجع خطأ، فقط نتائج فاضية
      }

      const like = `%${q}%`;

      const result = await queryFirstWorking(
        (table) => `
          SELECT id, full_name, phone, email
          FROM ${table}
          WHERE school_id = $3 -- ✅ حماية المدرسة
            AND (
              COALESCE(full_name,'') ILIKE $1
              OR COALESCE(phone::text,'') ILIKE $1
              OR COALESCE(email,'') ILIKE $1
            )
          ORDER BY full_name ASC
          LIMIT $2
        `,
        [like, limit, schoolId]
      );

      return res.json(result.rows.map(normalizeRow));
    } catch (err) {
      console.error("ParentsController.search error:", err);
      return res.status(500).json({ message: "فشل البحث عن ولي الأمر" });
    }
  },

  // GET /api/parents?search=...
  async list(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const q = String(req.query.q || req.query.search || "").trim();
      const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);

      const params = [schoolId]; // $1
      let where = "WHERE school_id = $1"; // ✅ حماية المدرسة

      if (q) {
        params.push(`%${q}%`); // $2
        where += ` AND (COALESCE(full_name,'') ILIKE $2 OR COALESCE(phone::text,'') ILIKE $2 OR COALESCE(email,'') ILIKE $2)`;
      }

      params.push(limit, offset); // $3, $4 (إذا كان فيه بحث) أو $2, $3 (بدون بحث)

      const result = await queryFirstWorking(
        (table) => `
          SELECT id, full_name, phone, email
          FROM ${table}
          ${where}
          ORDER BY id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );

      return res.json(result.rows.map(normalizeRow));
    } catch (err) {
      console.error("ParentsController.list error:", err);
      return res.status(500).json({ message: "فشل جلب أولياء الأمور" });
    }
  },

  // GET /api/parents/:id
  async getById(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "ID غير صحيح" });
      }

      const result = await queryFirstWorking(
        (table) => `
          SELECT id, full_name, phone, email
          FROM ${table}
          WHERE id = $1 AND school_id = $2 -- ✅ حماية المدرسة
          LIMIT 1
        `,
        [id, schoolId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "ولي الأمر غير موجود أو لا يتبع لمدرستك" });
      }

      return res.json(normalizeRow(result.rows[0]));
    } catch (err) {
      console.error("ParentsController.getById error:", err);
      return res.status(500).json({ message: "فشل جلب ولي الأمر" });
    }
  },
};

export default ParentsController;