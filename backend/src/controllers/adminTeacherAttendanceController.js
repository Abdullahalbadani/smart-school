// src/controllers/adminTeacherAttendanceController.js
import { pool } from "../config/db.js";
import crypto from "crypto";

/* =========================
   Helpers
========================= */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
}
function normalizeCode(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

// 1=Saturday,2=Sunday,3=Mon,...7=Fri (UTC-safe for YYYY-MM-DD)
function schoolDayIdFromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3];
  const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const map = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
  return map[jsDay] || null;
}

async function tableExists(db, tableName) {
  const r = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!r.rows?.[0]?.reg;
}

async function columnExists(db, table, col) {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return !!r.rows?.[0];
}

function hashToken(token) {
  const secret = process.env.TEACHER_TOKEN_SECRET || "dev-teacher-token-secret";
  return crypto.createHmac("sha256", secret).update(String(token)).digest("hex");
}

// ✅ إضافة school_id
async function getActiveAcademicYearId(db, schoolId) {
  const r = await db.query(
    `SELECT id FROM academic_years WHERE is_active = true AND school_id = $1 ORDER BY id DESC LIMIT 1`,
    [schoolId]
  );
  return r.rows?.[0]?.id ?? null;
}

// ✅ إضافة school_id
async function getDayByDate(db, date, academicYearId, schoolId) {
  const r = await db.query(
    `SELECT *
     FROM teacher_attendance_days
     WHERE attendance_date = $1
       AND (academic_year_id IS NOT DISTINCT FROM $2)
       AND school_id = $3
     LIMIT 1`,
    [date, academicYearId, schoolId]
  );
  return r.rows?.[0] || null;
}

// ✅ إضافة school_id
async function ensureDay(db, date, academicYearId, createdByUserId, schoolId) {
  let day = await getDayByDate(db, date, academicYearId, schoolId);
  if (day) return day;

  const ins = await db.query(
    `INSERT INTO teacher_attendance_days (school_id, attendance_date, academic_year_id, created_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [schoolId, date, academicYearId, createdByUserId || null]
  );
  return ins.rows[0];
}

// ✅ حماية الإحصائيات لتعمل داخل نفس المدرسة فقط
async function computeTeachersSummary(db, date, dayId, schoolDayId, schoolId) {
  const q = `
    WITH lessons AS (
      SELECT te.teacher_id, COUNT(*)::int AS total_lessons
      FROM timetable_entries te
      WHERE te.day_of_week = $2 AND te.school_id = $4
      GROUP BY te.teacher_id
    ),
    taught AS (
      SELECT s.teacher_id, COUNT(*)::int AS taught_count
      FROM attendance_sessions s
      WHERE s.attendance_date = $1 AND s.school_id = $4
        AND s.teacher_id IS NOT NULL
      GROUP BY s.teacher_id
    ),
    slots_count AS (
      SELECT permission_request_id, COUNT(*)::int AS slot_count
      FROM teacher_permission_request_slots
      GROUP BY permission_request_id
    ),
    excused AS (
      SELECT r.teacher_id,
             SUM(
               CASE
                 WHEN r.scope = 'full_day' THEN COALESCE(l.total_lessons, 0)
                 ELSE COALESCE(sc.slot_count, 0)
               END
             )::int AS excused_count
      FROM teacher_permission_requests r
      JOIN lessons l ON l.teacher_id = r.teacher_id
      LEFT JOIN slots_count sc ON sc.permission_request_id = r.id
      WHERE r.request_date = $1 AND r.school_id = $4
        AND r.status = 'approved'
      GROUP BY r.teacher_id
    )
    SELECT
      t.id AS teacher_id,
      t.full_name,
      t.is_active,

      e.id AS entry_id,
      e.status,
      e.method,
      e.recorded_at,

      l.total_lessons AS today_lessons,
      COALESCE(th.taught_count, 0) AS taught_count,
      COALESCE(ex.excused_count, 0) AS excused_count,
      GREATEST(l.total_lessons - COALESCE(th.taught_count, 0) - COALESCE(ex.excused_count, 0), 0)::int AS missed_count

    FROM teachers t
    LEFT JOIN lessons l ON l.teacher_id = t.id
    LEFT JOIN teacher_attendance_entries e
      ON e.day_id = $3 AND e.teacher_id = t.id AND e.school_id = $4
    LEFT JOIN taught th ON th.teacher_id = t.id
    LEFT JOIN excused ex ON ex.teacher_id = t.id

    WHERE t.is_active = true AND t.school_id = $4
    ORDER BY t.full_name ASC
  `;
  const r = await db.query(q, [date, schoolDayId, dayId, schoolId]);
  return r.rows || [];
}

// ✅ إضافة school_id
async function pendingPermitsCount(db, schoolId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM teacher_permission_requests
     WHERE status = 'pending' AND school_id = $1`,
    [schoolId]
  );
  return r.rows?.[0]?.c ?? 0;
}

/* =========================
   Resolve teacher from code:
   - TT-xxxxx token (teacher_barcode_tokens)
   - T-123 direct id
   - teacher_cards.card_uid
========================= */
// ✅ إضافة school_id لمنع مسح باركود لمعلم من مدرسة أخرى
async function resolveTeacherFromCode(db, rawCode, schoolId) {
  // ===== 1️⃣ تحقق من TT token =====
  if (rawCode.startsWith("TT-")) {
    const clean = String(rawCode).trim(); // لا تغيّر أي شيء
    const tokenHash = hashToken(clean);

    const tok = await db.query(
      `SELECT tok.teacher_id
       FROM teacher_barcode_tokens tok
       JOIN teachers t ON t.id = tok.teacher_id
       WHERE tok.token_hash = $1
         AND tok.expires_at > NOW()
         AND t.school_id = $2
       LIMIT 1`,
      [tokenHash, schoolId]
    );

    if (tok.rows[0]) {
      return {
        type: "token",
        teacherId: tok.rows[0].teacher_id,
        cardId: null,
        scannedValue: clean,
      };
    }
    return null;
  }

  const raw = String(rawCode || "").trim();
  const compact = normalizeCode(raw); // قوي للبطاقات

  // 1) Direct teacher id: T-123 / T123
  const mId = /^T(\d+)$/.exec(compact);
  if (mId) {
    const tId = Number(mId[1]);
    const chk = await db.query(`SELECT id FROM teachers WHERE id=$1 AND school_id=$2 LIMIT 1`, [tId, schoolId]);
    if(chk.rowCount) {
      return {
        type: "teacher_id",
        teacherId: tId,
        cardId: null,
        scannedValue: raw,
      };
    }
  }

  // 2) Token: TT-xxxxx (أو TTxxxxx)
  const candidate1 = raw.toUpperCase().replace(/\s+/g, ""); // يحافظ على "-"
  const candidate2 = compact; // بدون رموز
  const hashes = [hashToken(candidate1), hashToken(candidate2)];

  const tokR = await db.query(
    `
    SELECT tok.teacher_id
    FROM teacher_barcode_tokens tok
    JOIN teachers t ON t.id = tok.teacher_id
    WHERE tok.token_hash = ANY($1::text[])
      AND tok.expires_at > NOW()
      AND t.school_id = $2
    ORDER BY tok.expires_at DESC
    LIMIT 1
    `,
    [hashes, schoolId]
  );

  const tok = tokR.rows?.[0];
  if (tok?.teacher_id) {
    return {
      type: "token",
      teacherId: tok.teacher_id,
      cardId: null,
      scannedValue: raw,
    };
  }

  // 3) Card UID
  const cardR = await db.query(
    `
    SELECT tc.id, tc.teacher_id, tc.card_uid
    FROM teacher_cards tc
    JOIN teachers t ON t.id = tc.teacher_id
    WHERE tc.is_active = true
      AND UPPER(regexp_replace(tc.card_uid, '[^A-Za-z0-9]+', '', 'g')) = $1
      AND t.school_id = $2
    LIMIT 1
    `,
    [compact, schoolId]
  );

  const card = cardR.rows?.[0] || null;
  if (!card?.teacher_id) return null;

  return {
    type: "card",
    teacherId: card.teacher_id,
    cardId: card.id,
    scannedValue: card.card_uid,
  };
}

/* =========================
   Controller
========================= */
export const AdminTeacherAttendanceController = {
  // GET /api/admin/teacher-attendance/day?date=YYYY-MM-DD
  async daySummary(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const date = String(req.query.date || "").slice(0, 10);
    if (!isISODate(date)) return res.status(400).json({ message: "Invalid date" });

    const client = await pool.connect();
    try {
      const ayId = await getActiveAcademicYearId(client, schoolId);
      const day = await getDayByDate(client, date, ayId, schoolId);
      const dayId = day?.id ?? null;

      const schoolDay = schoolDayIdFromISO(date);
      if (!schoolDay) return res.status(400).json({ message: "Invalid date day mapping" });

      const teachers = await computeTeachersSummary(client, date, dayId, schoolDay, schoolId);
      const pending = await pendingPermitsCount(client, schoolId);

      return res.json({
        day: day
          ? {
              id: day.id,
              attendance_date: day.attendance_date,
              academic_year_id: day.academic_year_id,
              is_locked: day.is_locked,
              locked_at: day.locked_at,
              locked_by_user_id: day.locked_by_user_id,
            }
          : null,
        teachers,
        pending_permits: pending,
      });
    } catch (e) {
      console.error("daySummary error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // POST /api/admin/teacher-attendance/day/open {date}
  async openDay(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const date = String(req.body?.date || "").slice(0, 10);
    if (!isISODate(date)) return res.status(400).json({ message: "Invalid date" });

    const userId = req.user?.id ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ayId = await getActiveAcademicYearId(client, schoolId);
      const day = await ensureDay(client, date, ayId, userId, schoolId);
      await client.query("COMMIT");
      return res.json({ day });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("openDay error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  async lockDay(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid day id" });
    const userId = req.user?.id ?? null;

    const client = await pool.connect();
    try {
      const r = await client.query(
        `UPDATE teacher_attendance_days
         SET is_locked = true,
             locked_by_user_id = $2,
             locked_at = now(),
             updated_at = now()
         WHERE id = $1 AND school_id = $3
         RETURNING *`,
        [id, userId, schoolId]
      );
      const day = r.rows?.[0];
      if (!day) return res.status(404).json({ message: "Day not found or unauthorized" });
      return res.json({ day });
    } catch (e) {
      console.error("lockDay error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  async unlockDay(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid day id" });

    const client = await pool.connect();
    try {
      const r = await client.query(
        `UPDATE teacher_attendance_days
         SET is_locked = false,
             locked_by_user_id = NULL,
             locked_at = NULL,
             updated_at = now()
         WHERE id = $1 AND school_id = $2
         RETURNING *`,
        [id, schoolId]
      );
      const day = r.rows?.[0];
      if (!day) return res.status(404).json({ message: "Day not found or unauthorized" });
      return res.json({ day });
    } catch (e) {
      console.error("unlockDay error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // ✅ POST /api/admin/teacher-attendance/scan {date, code}
  async scan(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const date = String(req.body?.date || "").slice(0, 10);
    const rawCode = String(req.body?.code || "");
    if (!isISODate(date)) return res.status(400).json({ message: "Invalid date" });

    const normalized = normalizeCode(rawCode);
    if (!normalized) return res.status(400).json({ message: "Empty code" });

    const userId = req.user?.id ?? null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const ayId = await getActiveAcademicYearId(client, schoolId);
      const day = await ensureDay(client, date, ayId, userId, schoolId);

      if (day.is_locked) {
        const err = new Error("Day is locked");
        err.status = 409;
        throw err;
      }

      // سجل scan event دائماً (مع school_id)
      let scanEventId = null;
      const hasScanEvents = await tableExists(client, "teacher_attendance_scan_events");
      if (hasScanEvents) {
        const se = await client.query(
          `INSERT INTO teacher_attendance_scan_events
             (school_id, day_id, raw_code, normalized_code, source, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'scanner', $5)
           RETURNING id`,
          [schoolId, day.id, rawCode, normalized, userId]
        );
        scanEventId = se.rows?.[0]?.id ?? null;
      }

      // ✅ resolve teacher
      const resolved = await resolveTeacherFromCode(client, rawCode, schoolId);
      if (!resolved?.teacherId) {
        await client.query("COMMIT");
        return res.status(404).json({
          message: "Code not recognized or expired for this school",
          scan_event_id: scanEventId,
        });
      }

      // teacher info
      const teacherR = await client.query(
        `SELECT id, full_name, is_active
         FROM teachers
         WHERE id = $1 AND school_id = $2
         LIMIT 1`,
        [resolved.teacherId, schoolId]
      );
      const teacher = teacherR.rows?.[0];
      if (!teacher) {
        await client.query("COMMIT");
        return res.status(404).json({ message: "Teacher not found", scan_event_id: scanEventId });
      }

      // upsert entry
      const hasScannedUid = await columnExists(client, "teacher_attendance_entries", "scanned_card_uid");
      const hasScannedId = await columnExists(client, "teacher_attendance_entries", "scanned_card_id");

      const existing = await client.query(
        `SELECT id
         FROM teacher_attendance_entries
         WHERE day_id = $1 AND teacher_id = $2 AND school_id = $3
         LIMIT 1`,
        [day.id, teacher.id, schoolId]
      );

      let entry;
      if (existing.rows.length) {
        const params = [existing.rows[0].id, userId, schoolId];
        const sets = [
          `status = 'present'`,
          `method = 'scan'`,
          `recorded_by_user_id = $2`,
          `recorded_at = now()`,
          `updated_at = now()`,
        ];

        if (hasScannedUid) {
          params.push(resolved.scannedValue);
          sets.push(`scanned_card_uid = $${params.length}`);
        }
        if (hasScannedId) {
          params.push(resolved.cardId);
          sets.push(`scanned_card_id = $${params.length}`);
        }

        const q = `UPDATE teacher_attendance_entries
                   SET ${sets.join(", ")}
                   WHERE id = $1 AND school_id = $3
                   RETURNING *`;
        entry = (await client.query(q, params)).rows[0];
      } else {
        const cols = ["school_id", "day_id", "teacher_id", "status", "method", "recorded_by_user_id", "recorded_at"];
        const vals = ["$1", "$2", "$3", "'present'", "'scan'", "$4", "now()"];
        const params = [schoolId, day.id, teacher.id, userId];

        if (hasScannedUid) {
          cols.push("scanned_card_uid");
          params.push(resolved.scannedValue);
          vals.push(`$${params.length}`);
        }
        if (hasScannedId) {
          cols.push("scanned_card_id");
          params.push(resolved.cardId);
          vals.push(`$${params.length}`);
        }

        const q = `INSERT INTO teacher_attendance_entries (${cols.join(", ")})
                   VALUES (${vals.join(", ")})
                   RETURNING *`;
        entry = (await client.query(q, params)).rows[0];
      }

      // اربط scan_event بالمعلم/البطاقة
      if (scanEventId) {
        const hasTeacherIdCol = await columnExists(client, "teacher_attendance_scan_events", "teacher_id");
        const hasCardIdCol = await columnExists(client, "teacher_attendance_scan_events", "card_id");

        if (hasTeacherIdCol || hasCardIdCol) {
          const sets = [];
          const params = [scanEventId, schoolId];
          if (hasTeacherIdCol) {
            params.push(teacher.id);
            sets.push(`teacher_id = $${params.length}`);
          }
          if (hasCardIdCol) {
            params.push(resolved.cardId);
            sets.push(`card_id = $${params.length}`);
          }
          if (sets.length) {
            await client.query(`UPDATE teacher_attendance_scan_events SET ${sets.join(", ")} WHERE id = $1 AND school_id = $2`, params);
          }
        }
      }

      await client.query("COMMIT");
      return res.json({
        day: { id: day.id, attendance_date: day.attendance_date, is_locked: day.is_locked },
        teacher,
        entry,
        status: entry.status,
        scan_event_id: scanEventId,
        code_type: resolved.type,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const status = e?.status || 500;
      console.error("scan error:", e);
      return res.status(status).json({ message: e?.message || "Server error" });
    } finally {
      client.release();
    }
  },

  // POST /api/admin/teacher-attendance/entries {date, teacher_id, status, method}
  async createEntry(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const date = String(req.body?.date || "").slice(0, 10);
    const teacherId = toInt(req.body?.teacher_id);
    const status = String(req.body?.status || "").toLowerCase();
    const method = String(req.body?.method || "manual").toLowerCase();

    if (!isISODate(date)) return res.status(400).json({ message: "Invalid date" });
    if (!teacherId) return res.status(400).json({ message: "Invalid teacher_id" });
    if (!["present", "absent", "late", "excused"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const userId = req.user?.id ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ayId = await getActiveAcademicYearId(client, schoolId);
      const day = await ensureDay(client, date, ayId, userId, schoolId);

      if (day.is_locked) {
        const err = new Error("Day is locked");
        err.status = 409;
        throw err;
      }

      const existing = await client.query(
        `SELECT id FROM teacher_attendance_entries WHERE day_id=$1 AND teacher_id=$2 AND school_id=$3 LIMIT 1`,
        [day.id, teacherId, schoolId]
      );

      let entry;
      if (existing.rows.length) {
        entry = (
          await client.query(
            `UPDATE teacher_attendance_entries
             SET status=$2, method=$3, recorded_by_user_id=$4, recorded_at=now(), updated_at=now()
             WHERE id=$1 AND school_id=$5
             RETURNING *`,
            [existing.rows[0].id, status, method, userId, schoolId]
          )
        ).rows[0];
      } else {
        entry = (
          await client.query(
            `INSERT INTO teacher_attendance_entries (school_id, day_id, teacher_id, status, method, recorded_by_user_id, recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,now())
             RETURNING *`,
            [schoolId, day.id, teacherId, status, method, userId]
          )
        ).rows[0];
      }

      await client.query("COMMIT");
      return res.json({ day, entry });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const statusCode = e?.status || 500;
      console.error("createEntry error:", e);
      return res.status(statusCode).json({ message: e?.message || "Server error" });
    } finally {
      client.release();
    }
  },

  // PATCH /api/admin/teacher-attendance/entries/:id {status, method, reason?}
  async updateEntry(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const entryId = toInt(req.params.id);
    const newStatus = String(req.body?.status || "").toLowerCase();
    const method = String(req.body?.method || "manual").toLowerCase();
    const reason = String(req.body?.reason || "").trim();

    if (!entryId) return res.status(400).json({ message: "Invalid entry id" });
    if (newStatus && !["present", "absent", "late", "excused"].includes(newStatus))
      return res.status(400).json({ message: "Invalid status" });

    const userId = req.user?.id ?? null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cur = await client.query(
        `SELECT e.*, d.is_locked
         FROM teacher_attendance_entries e
         JOIN teacher_attendance_days d ON d.id = e.day_id
         WHERE e.id = $1 AND e.school_id = $2
         LIMIT 1`,
        [entryId, schoolId]
      );
      const entry = cur.rows?.[0];
      if (!entry) return res.status(404).json({ message: "Entry not found" });

      if (entry.is_locked) {
        const err = new Error("Day is locked");
        err.status = 409;
        throw err;
      }

      const oldStatus = String(entry.status || "");

      const updated = (
        await client.query(
          `UPDATE teacher_attendance_entries
           SET status = COALESCE($2, status),
               method = COALESCE($3, method),
               updated_at = now()
           WHERE id = $1 AND school_id = $4
           RETURNING *`,
          [entryId, newStatus || null, method || null, schoolId]
        )
      ).rows[0];

      // سجل تصحيح لو تغيرت الحالة
      const hasCorrections = await tableExists(client, "teacher_attendance_corrections");
      if (hasCorrections && newStatus && oldStatus !== newStatus) {
        await client.query(
          `INSERT INTO teacher_attendance_corrections
            (school_id, entry_id, day_id, teacher_id, old_status, new_status, reason, corrected_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [schoolId, entryId, entry.day_id, entry.teacher_id, oldStatus, newStatus, reason || null, userId]
        );
      }

      await client.query("COMMIT");
      return res.json({ entry: updated });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const statusCode = e?.status || 500;
      console.error("updateEntry error:", e);
      return res.status(statusCode).json({ message: e?.message || "Server error" });
    } finally {
      client.release();
    }
  },
};