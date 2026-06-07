import { pool } from "../config/db.js";

function normalizeRow(row) {
  return {
    id: row.id != null ? String(row.id) : "",
    full_name: String(row.full_name ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
  };
}

/*
  Normalize common Arabic variations:
  - Alef with hamza / madda -> plain alef
  - Alef maqsura -> ya
  - Ta marbuta -> ha
  - Remove diacritics and tatweel
*/
function normalizedArabicSql(expression) {
  return `
    translate(
      regexp_replace(
        COALESCE(${expression}, ''),
        '[\u064B-\u065F\u0640]',
        '',
        'g'
      ),
      '\u0623\u0625\u0622\u0649\u0629',
      '\u0627\u0627\u0627\u064A\u0647'
    )
  `;
}

async function findParents({ schoolId, q, limit = 10, offset = 0 }) {
  const like = `%${String(q || "").trim()}%`;

  const result = await pool.query(
    `
    SELECT id, full_name, phone, email
    FROM guardians
    WHERE school_id = $1
      AND (
        ${normalizedArabicSql("full_name")}
          ILIKE ${normalizedArabicSql("$2::text")}
        OR COALESCE(phone::text, '') ILIKE $2
        OR COALESCE(email, '') ILIKE $2
      )
    ORDER BY full_name ASC
    LIMIT $3 OFFSET $4
    `,
    [schoolId, like, limit, offset]
  );

  return result.rows.map(normalizeRow);
}

export const ParentsController = {
  // GET /api/parents/search?q=...
  async search(req, res) {
    try {
      const schoolId = req.user?.school_id;

      if (!schoolId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const q = String(req.query.q || req.query.search || "").trim();
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "10", 10) || 10, 1),
        50
      );

      if (!q || q.length < 2) {
        return res.json([]);
      }

      const rows = await findParents({
        schoolId,
        q,
        limit,
        offset: 0,
      });

      return res.json(rows);
    } catch (error) {
      console.error("ParentsController.search error:", error);
      return res.status(500).json({ message: "Parent search failed" });
    }
  },

  // GET /api/parents?search=...
  async list(req, res) {
    try {
      const schoolId = req.user?.school_id;

      if (!schoolId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const q = String(req.query.q || req.query.search || "").trim();

      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10) || 50, 1),
        200
      );

      const offset = Math.max(
        parseInt(req.query.offset || "0", 10) || 0,
        0
      );

      if (q) {
        const rows = await findParents({
          schoolId,
          q,
          limit,
          offset,
        });

        return res.json(rows);
      }

      const result = await pool.query(
        `
        SELECT id, full_name, phone, email
        FROM guardians
        WHERE school_id = $1
        ORDER BY id DESC
        LIMIT $2 OFFSET $3
        `,
        [schoolId, limit, offset]
      );

      return res.json(result.rows.map(normalizeRow));
    } catch (error) {
      console.error("ParentsController.list error:", error);
      return res.status(500).json({ message: "Parents list failed" });
    }
  },

  // GET /api/parents/:id
  async getById(req, res) {
    try {
      const schoolId = req.user?.school_id;

      if (!schoolId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const result = await pool.query(
        `
        SELECT id, full_name, phone, email
        FROM guardians
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [id, schoolId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ message: "Parent not found" });
      }

      return res.json(normalizeRow(result.rows[0]));
    } catch (error) {
      console.error("ParentsController.getById error:", error);
      return res.status(500).json({ message: "Parent lookup failed" });
    }
  },
};

export default ParentsController;
