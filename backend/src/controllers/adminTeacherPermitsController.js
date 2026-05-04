import { pool } from "../config/db.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isISODate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
}

// 1=Saturday..7=Fri
function schoolDayIdFromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3];
  const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const map = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
  return map[jsDay] || null;
}

// ✅ إضافة schoolId للمساعدة في أمان الحضور
async function applyPermitPresenceSafe(db, permit, schoolId) {
  // اختياري: نسجل presence بعذر بدون ما نلغي taught
  // ندخّل فقط إذا ما فيه سجل سابق لنفس (presence_date + timetable_entry_id)
  const date = String(permit.request_date).slice(0, 10);
  const teacherId = permit.teacher_id;
  const scope = String(permit.scope || "full_day");
  if (!isISODate(date) || !teacherId) return;

  let timetableEntryIds; // 🟢 تصحيح ESLint: no-useless-assignment

  if (scope === "slots") {
    const r = await db.query(
      `SELECT timetable_entry_id
       FROM teacher_permission_request_slots
       WHERE permission_request_id = $1`,
      [permit.id]
    );
    timetableEntryIds = r.rows.map((x) => x.timetable_entry_id).filter(Boolean);
  } else {
    const schoolDay = schoolDayIdFromISO(date);
    if (!schoolDay) return;

    // ✅ فلترة حسب المدرسة
    const r = await db.query(
      `SELECT id AS timetable_entry_id
       FROM timetable_entries
       WHERE teacher_id = $1 AND day_of_week = $2 AND school_id = $3`,
      [teacherId, schoolDay, schoolId]
    );
    timetableEntryIds = r.rows.map((x) => x.timetable_entry_id).filter(Boolean);
  }

  if (!timetableEntryIds?.length) return;

  for (const teId of timetableEntryIds) {
    // ✅ إدخال الحضور مع school_id
    await db.query(
      `INSERT INTO teacher_lesson_presence
        (school_id, presence_date, teacher_id, timetable_entry_id, status, permission_request_id, created_at)
       SELECT $1, $2, $3, $4, 'excused', $5, now()
       WHERE NOT EXISTS (
         SELECT 1 FROM teacher_lesson_presence p
         WHERE p.presence_date = $2 AND p.timetable_entry_id = $4 AND p.school_id = $1
       )`,
      [schoolId, date, teacherId, teId, permit.id]
    );
  }
}

export const AdminTeacherPermitsController = {
  // GET /api/admin/teacher-permits?status=&from=&to=&q=&count=1
  async list(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const status = String(req.query.status || "").toLowerCase();
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    const q = String(req.query.q || "").trim();
    const wantCount = String(req.query.count || "") === "1";

   const where = [];
    const params = [];

    // ✅ حماية المدرسة (نضيف القيمة أولاً، ثم نستخدم طول المصفوفة للترقيم)
    params.push(schoolId);
    where.push(`r.school_id = $${params.length}`);

    if (status) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (isISODate(from)) {
      params.push(from);
      where.push(`r.request_date >= $${params.length}`);
    }
    if (isISODate(to)) {
      params.push(to);
      where.push(`r.request_date <= $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`t.full_name ILIKE $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const client = await pool.connect();
    try {
      if (wantCount) {
        const r = await client.query(
          `SELECT
           r.id, r.teacher_id, t.full_name AS teacher_name,
           r.request_date, r.scope, r.status,
           r.reason_text, r.notes,
           r.requested_at, r.decided_at, r.decision_note,
           r.decided_by_user_id
         FROM teacher_permission_requests r
         LEFT JOIN teachers t ON t.id = r.teacher_id
         ${whereSql}
         ORDER BY r.requested_at DESC, r.id DESC
         LIMIT 500`,
          params
        );
        return res.json({ count: r.rows?.[0]?.count ?? 0 });
      }

      const r = await client.query(
        `SELECT
           r.id, r.teacher_id, t.full_name AS teacher_name,
           r.request_date, r.scope, r.status,
           r.reason_text, r.notes,
           r.requested_at, r.decided_at, r.decision_note,
           r.decided_by_user_id
         FROM teacher_permission_requests r
         JOIN teachers t ON t.id = r.teacher_id
         ${whereSql}
         ORDER BY r.requested_at DESC, r.id DESC
         LIMIT 500`,
        params
      );

      return res.json({ items: r.rows || [] });
    } catch (e) {
      console.error("permits list error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // GET /api/admin/teacher-permits/:id
  async getOne(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const client = await pool.connect();
    try {
      // ✅ جلب الطلب مع التأكد من المدرسة
      const r = await client.query(
        `SELECT r.*, t.full_name AS teacher_name
         FROM teacher_permission_requests r
         JOIN teachers t ON t.id = r.teacher_id
         WHERE r.id = $1 AND r.school_id = $2
         LIMIT 1`,
        [id, schoolId]
      );
      const permit = r.rows?.[0];
      if (!permit) return res.status(404).json({ message: "Not found" });

      // 🟢 الاستعلام المحدث لجلب كافة التفاصيل + بيانات معلم الاحتياط (مع school_id)
      const slotsR = await client.query(
        `SELECT
           s.id,
           s.timetable_entry_id,
           te.day_of_week,
           p.name AS period_name,
           p.start_time,
           p.end_time,
           sub.name AS subject_name,
           sec.name AS section_name,
           gr.name AS grade_name,
           stg.name AS stage_name,
           ls.status AS sub_status,            -- 🟢 جلب حالة رد المعلم (وافق/رفض)
           t_sub.full_name AS substitute_name  -- 🟢 جلب اسم المعلم البديل
         FROM teacher_permission_request_slots s
         JOIN timetable_entries te ON te.id = s.timetable_entry_id
         LEFT JOIN periods p ON p.id = te.period_id
         LEFT JOIN subjects sub ON sub.id = te.subject_id
         LEFT JOIN timetables tt ON tt.id = te.timetable_id
         LEFT JOIN sections sec ON sec.id = tt.section_id
         LEFT JOIN grades gr ON sec.grade_id = gr.id
         LEFT JOIN stages stg ON gr.stage_id = stg.id
         -- 🟢 الربط مع جدول الاحتياط
         LEFT JOIN lesson_substitutions ls 
                ON ls.timetable_entry_id = s.timetable_entry_id 
               AND ls.substitution_date = $2
               AND ls.school_id = $3
         LEFT JOIN teachers t_sub ON t_sub.id = ls.substitute_teacher_id
         WHERE s.permission_request_id = $1
         ORDER BY te.day_of_week ASC, te.period_id ASC`,
        [id, permit.request_date, schoolId]
      );

      const slots = slotsR.rows || [];

      // 🟢 نظام الرادار الذكي (مع school_id)
      for (let slot of slots) {
        const availableTeachersR = await client.query(
          `SELECT t.id, t.full_name 
           FROM teachers t
           WHERE t.is_active = true 
             AND t.school_id = $5
             AND t.id != $1
             AND t.id NOT IN (
                 SELECT te.teacher_id 
                 FROM timetable_entries te 
                 WHERE te.day_of_week = $2 AND te.period_id = $3 AND te.school_id = $5
             )
             AND t.id NOT IN (
                 SELECT ls.substitute_teacher_id 
                 FROM lesson_substitutions ls 
                 JOIN timetable_entries te2 ON ls.timetable_entry_id = te2.id
                 WHERE ls.substitution_date = $4 AND te2.period_id = $3 AND ls.status != 'rejected' AND ls.school_id = $5
             )
           ORDER BY t.full_name ASC`,
          [permit.teacher_id, slot.day_of_week, slot.period_id, permit.request_date, schoolId]
        );
        slot.available_teachers = availableTeachersR.rows;
      }

      return res.json({ 
        permit, 
        slots 
      });
    } catch (e) {
      console.error("getOne permit error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // PATCH /api/admin/teacher-permits/:id/decision  {status, decision_note}
  async decide(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = toInt(req.params.id);
    const status = String(req.body?.status || "").toLowerCase();
    const decisionNote = String(req.body?.decision_note || "").trim();
    const substitutes = req.body?.substitutes || []; 
    const userId = req.user?.id ?? null;

    if (!id) return res.status(400).json({ message: "Invalid id" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ✅ حماية عبر school_id
      const cur = await client.query(`SELECT * FROM teacher_permission_requests WHERE id=$1 AND school_id=$2 LIMIT 1`, [id, schoolId]);
      const permit = cur.rows?.[0];
      if (!permit) {
        await client.query("ROLLBACK"); return res.status(404).json({ message: "Not found" });
      }

      const currentStatus = String(permit.status).toLowerCase();
      if (currentStatus !== "pending" && currentStatus !== "approved") {
        await client.query("ROLLBACK"); return res.status(409).json({ message: "تم البت في هذا الطلب مسبقاً" });
      }

      let updatedPermit = permit;
      // 🟢 تصحيح ESLint: تم حذف safeDateStr لأنه غير مستخدم

      if (currentStatus === "pending") {
        const upd = await client.query(
          `UPDATE teacher_permission_requests
           SET status = $2, decided_at = now(), decided_by_user_id = $3, decision_note = $4, updated_at = now()
           WHERE id = $1 AND school_id = $5 RETURNING *`,
          [id, status, userId, decisionNote || null, schoolId]
        );
        updatedPermit = upd.rows[0];
        if (status === "approved") {
          await applyPermitPresenceSafe(client, updatedPermit, schoolId);
        }
      }

      // 🟢 تحديث الاحتياط (مسح المرفوض وإدخال الجديد) + المؤقت
      if (status === "approved" && substitutes.length > 0) {
        for (const sub of substitutes) {
          if (sub.substitute_id) {
            
            // 1. الإدخال في قاعدة البيانات (مع school_id)
            const insertResult = await client.query(
              `INSERT INTO lesson_substitutions 
               (school_id, substitution_date, timetable_entry_id, absent_teacher_id, substitute_teacher_id, assigned_by_user_id, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending_teacher')
               ON CONFLICT (school_id, substitution_date, timetable_entry_id) 
               DO UPDATE SET 
                  substitute_teacher_id = EXCLUDED.substitute_teacher_id,
                  status = 'pending_teacher'
               RETURNING id, substitute_teacher_id`, 
              [schoolId, permit.request_date, sub.entry_id, permit.teacher_id, sub.substitute_id, userId]
            );

            const substitutionId = insertResult.rows[0].id;
            const subTeacherId = insertResult.rows[0].substitute_teacher_id;
            const timeoutMs = (sub.timeout_minutes || 15) * 60 * 1000; 

            // 2. ⏱️ تشغيل المؤقت الذكي في الخلفية
            setTimeout(async () => {
              const timerClient = await pool.connect();
              try {
                // نتحقق: هل المعلم ما زال معلقاً؟ (مع school_id)
                const checkRes = await timerClient.query(`SELECT status FROM lesson_substitutions WHERE id = $1 AND school_id = $2`, [substitutionId, schoolId]);
                
                if (checkRes.rows.length > 0 && checkRes.rows[0].status === 'pending_teacher') {
                  // لقد انتهى الوقت ولم يرد! نحوله إلى 'expired'
                  await timerClient.query(`UPDATE lesson_substitutions SET status = 'expired' WHERE id = $1 AND school_id = $2`, [substitutionId, schoolId]);
                  
                  // نجلب اسم المعلم
                  const tRes = await timerClient.query(`SELECT full_name FROM teachers WHERE id = $1 AND school_id = $2`, [subTeacherId, schoolId]);
                  const tName = tRes.rows[0]?.full_name || "المعلم";

                  // 🚨 إطلاق صافرة الإنذار للإدارة ولشاشة المعلم
                  const io = req.app.get("io");
                  if (io) {
                    io.emit("substitute_rejected", { teacherName: `${tName} (تجاهل الطلب - انتهى الوقت ⏱️)` });
                    io.emit("refresh_admin_permits"); 
                    io.emit("refresh_substitutions"); 
                  }
                  console.log(`⏱️ [Auto-Escalation] انتهى وقت الأستاذ ${tName} (School: ${schoolId})`);
                }
              } catch (err) {
                console.error("Timer Error:", err);
              } finally {
                timerClient.release();
              }
            }, timeoutMs);
          }
        }
      }

      await client.query("COMMIT");

      const io = req.app.get("io");
      if (io && status === "approved" && substitutes.length > 0) {
        io.emit("refresh_substitutions"); 
      }

      return res.json({ permit: updatedPermit });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("decide permit error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // ==========================================
  // 🦅 نظام عين الصقر: جلب حصص الاحتياط المرفوضة والمنتهية وقتها
  // ==========================================
  async getRejectedSubsAlerts(req, res) {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT ls.id, ls.substitution_date, ls.status, p.name AS period_name, 
               t_absent.full_name AS absent_teacher, t_sub.full_name AS sub_teacher,
               sub.name AS subject_name, sec.name AS section_name, gr.name AS grade_name
        FROM lesson_substitutions ls
        JOIN timetable_entries te ON te.id = ls.timetable_entry_id
        LEFT JOIN periods p ON p.id = te.period_id
        LEFT JOIN teachers t_absent ON t_absent.id = ls.absent_teacher_id
        LEFT JOIN teachers t_sub ON t_sub.id = ls.substitute_teacher_id
        LEFT JOIN subjects sub ON sub.id = te.subject_id
        LEFT JOIN timetables tt ON tt.id = te.timetable_id
        LEFT JOIN sections sec ON sec.id = tt.section_id
        LEFT JOIN grades gr ON sec.grade_id = gr.id
        -- 🟢 السحر هنا: نبحث عن المرفوض والمنتهي للمدرسة فقط
        WHERE ls.status IN ('rejected', 'expired') AND ls.school_id = $1
        ORDER BY ls.substitution_date ASC
      `, [schoolId]);
      return res.json({ alerts: result.rows || [] });
    } catch (e) {
      console.error("Eagle Eye DB Error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  }
};