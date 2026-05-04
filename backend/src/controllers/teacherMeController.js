import { pool } from "../config/db.js";
import crypto from "crypto";

async function tableExists(db, tableName) {
  const r = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!r.rows?.[0]?.reg;
}

// ✅ تم التعديل: البحث عن المعلم داخل نطاق مدرسته الحالية فقط
async function getTeacherIdByUserId(db, userId, schoolId) {
  const r = await db.query(
    `SELECT id FROM teachers WHERE user_id = $1 AND school_id = $2 LIMIT 1`, 
    [userId, schoolId]
  );
  return r.rows?.[0]?.id ?? null;
}

async function columnExists(db, table, col) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return !!r.rows?.[0];
}

function makeToken() {
  const raw = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `TT-${raw}`;
}

function hashToken(token) {
  const secret = process.env.TEACHER_TOKEN_SECRET || "dev-teacher-token-secret";
  return crypto.createHmac("sha256", secret).update(String(token)).digest("hex");
}

export const TeacherMeController = {
  // GET /api/teacher/me/card
  async card(req, res) {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة
    const client = await pool.connect();

    try {
      const teacherId = await getTeacherIdByUserId(client, userId, schoolId);
      if (!teacherId) return res.status(404).json({ message: "المعلم غير موجود في هذه المدرسة" });

      const codeCols = ["card_uid", "barcode_uid", "barcode", "card_code", "code"];
      let codeCol = null;
      for (const c of codeCols) {
        if (await columnExists(client, "teachers", c)) {
          codeCol = c;
          break;
        }
      }

      const activeCols = ["is_active", "active"];
      let activeCol = null;
      for (const c of activeCols) {
        if (await columnExists(client, "teachers", c)) {
          activeCol = c;
          break;
        }
      }

      // ✅ تأمين الاستعلام بالـ school_id
      const sql = `
        SELECT
          id,
          ${codeCol ? `${codeCol}::text` : `('T-' || id)::text`} AS card_uid,
          ${activeCol ? `${activeCol}::boolean` : `true`} AS is_active
        FROM teachers
        WHERE id = $1 AND school_id = $2
        LIMIT 1
      `;
      const r = await client.query(sql, [teacherId, schoolId]);
      return res.json(r.rows?.[0] || { card_uid: `T-${teacherId}`, is_active: true });
    } catch (e) {
      console.error("TeacherMeController.card error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // ✅ GET /api/teacher/me/token
  async token(req, res) {
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة
    const client = await pool.connect();

    try {
      const teacherId = await getTeacherIdByUserId(client, userId, schoolId);
      if (!teacherId) return res.status(404).json({ message: "المعلم غير موجود" });

      const ok = await tableExists(client, "teacher_barcode_tokens");
      if (!ok) {
        return res.status(500).json({
          message: "جدول teacher_barcode_tokens غير موجود. يرجى مراجعة قاعدة البيانات.",
        });
      }

      const token = makeToken();
      const tokenHash = hashToken(token);

      const validForSeconds = 300; // 5 دقائق
      const expires = new Date(Date.now() + (validForSeconds + 10) * 1000);

      // ✅ تخزين الـ school_id مع التوكن لضمان أن جهاز الباركود الخاص بالمدرسة هو فقط من يقبله
      await client.query(
        `
        INSERT INTO teacher_barcode_tokens (school_id, teacher_id, token_hash, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (teacher_id)
        DO UPDATE SET token_hash = EXCLUDED.token_hash,
                      expires_at = EXCLUDED.expires_at,
                      school_id = EXCLUDED.school_id,
                      updated_at = now()
        `,
        [schoolId, teacherId, tokenHash, expires.toISOString()]
      );

      return res.json({
        token,
        valid_for_seconds: validForSeconds,
        refresh_after_seconds: 240,
        expires_at: expires.toISOString(),
      });
    } catch (e) {
      console.error("TeacherMeController.token error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },
};