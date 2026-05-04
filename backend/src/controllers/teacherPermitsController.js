import { pool } from "../config/db.js";
import { NotificationAutoService } from "../modules/notifications/index.js";
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
async function getTeacherIdByUserId(db, userId) {
  const r = await db.query(`SELECT id FROM teachers WHERE user_id = $1 LIMIT 1`, [userId]);
  return r.rows?.[0]?.id ?? null;
}

async function columnExists(db, tableName, columnName) {
  const r = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  return !!r.rows?.[0];
}

export const TeacherPermitsController = {
  // GET /api/teacher/permits
  async listMyPermits(req, res) {
    const userId = req.user?.id;
    const client = await pool.connect();
    try {
      const teacherId = await getTeacherIdByUserId(client, userId);
      if (!teacherId) return res.status(404).json({ message: "Teacher not found" });

      const r = await client.query(
        `SELECT *
         FROM teacher_permission_requests
         WHERE teacher_id = $1
         ORDER BY requested_at DESC, id DESC
         LIMIT 200`,
        [teacherId]
      );

      return res.json({ items: r.rows || [] });
    } catch (e) {
      console.error("listMyPermits error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // GET /api/teacher/permits/available-slots?date=YYYY-MM-DD
  async availableSlots(req, res) {
    const userId = req.user?.id;
    const date = String(req.query?.date || "").slice(0, 10);
    if (!isISODate(date)) return res.status(400).json({ message: "Invalid date" });

    // 1=Sat,2=Sun,3=Mon..7=Fri (UTC-safe)
    const jsDay = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
    const mapToSchoolDay = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
    const dayOfWeek = mapToSchoolDay[jsDay] || 0;

    const client = await pool.connect();
    try {
      const teacherId = await getTeacherIdByUserId(client, userId);
      if (!teacherId) return res.status(404).json({ message: "Teacher not found" });

      // ✅ نتحقق من وجود الأعمدة حتى ما يطيح الاستعلام
      const hasTimetableId = await columnExists(client, "timetable_entries", "timetable_id");
      const hasSectionIdOnEntries = await columnExists(client, "timetable_entries", "section_id");

      let sql = "";
      if (hasSectionIdOnEntries) {
        // حالة نادرة: section_id موجود مباشرة على entries
        sql = `
          SELECT
            te.id AS timetable_entry_id,
            p.name AS period_name,
            p.sort_order AS period_sort_order,
            p.start_time,
            p.end_time,
            sub.name AS subject_name,
            sec.name AS section_name
          FROM timetable_entries te
          LEFT JOIN periods p ON p.id = te.period_id
          LEFT JOIN subjects sub ON sub.id = te.subject_id
          LEFT JOIN sections sec ON sec.id = te.section_id
          WHERE te.teacher_id = $1 AND te.day_of_week = $2
          ORDER BY p.sort_order NULLS LAST, te.id DESC
        `;
      } else if (hasTimetableId) {
        // ✅ الأكثر شيوعًا: entries -> timetables -> sections
        sql = `
          SELECT
            te.id AS timetable_entry_id,
            p.name AS period_name,
            p.sort_order AS period_sort_order,
            p.start_time,
            p.end_time,
            sub.name AS subject_name,
            sec.name AS section_name
          FROM timetable_entries te
          LEFT JOIN periods p ON p.id = te.period_id
          LEFT JOIN subjects sub ON sub.id = te.subject_id
          LEFT JOIN timetables tt ON tt.id = te.timetable_id
          LEFT JOIN sections sec ON sec.id = tt.section_id
          WHERE te.teacher_id = $1 AND te.day_of_week = $2
          ORDER BY p.sort_order NULLS LAST, te.id DESC
        `;
      } else {
        // ✅ fallback: بدون section_name (حتى ما يطيح)
        sql = `
          SELECT
            te.id AS timetable_entry_id,
            p.name AS period_name,
            p.sort_order AS period_sort_order,
            p.start_time,
            p.end_time,
            sub.name AS subject_name,
            NULL::text AS section_name
          FROM timetable_entries te
          LEFT JOIN periods p ON p.id = te.period_id
          LEFT JOIN subjects sub ON sub.id = te.subject_id
          WHERE te.teacher_id = $1 AND te.day_of_week = $2
          ORDER BY p.sort_order NULLS LAST, te.id DESC
        `;
      }

      const r = await client.query(sql, [teacherId, dayOfWeek]);
      return res.json({ slots: r.rows || [] });
    } catch (e) {
      console.error("availableSlots error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // POST /api/teacher/permits
  // body: { request_date, scope:'full_day'|'slots', timetable_entry_ids? أو slots?, reason_text?, notes? }
  // POST /api/teacher/permits
  // body: { request_date, scope:'full_day'|'slots', timetable_entry_ids? أو slots?, reason_text?, notes? }
// POST /api/teacher/permits
  // body: { request_date, scope:'full_day'|'slots', timetable_entry_ids? أو slots?, reason_text?, notes? }
  async createPermit(req, res) {
    const userId = req.user?.id;
    const requestDate = String(req.body?.request_date || "").slice(0, 10);
    
    const scope = String(req.body?.scope || "full_day");
    const reasonText = String(req.body?.reason_text || "").trim();
    const notes = String(req.body?.notes || "").trim();

    const timetableEntryIds = Array.isArray(req.body?.timetable_entry_ids)
      ? req.body.timetable_entry_ids.map(toInt).filter(Boolean)
      : Array.isArray(req.body?.slots)
      ? req.body.slots.map(toInt).filter(Boolean)
      : [];

    if (!isISODate(requestDate)) return res.status(400).json({ message: "Invalid request_date" });
    if (!["full_day", "slots"].includes(scope)) return res.status(400).json({ message: "Invalid scope" });
    if (scope === "slots" && timetableEntryIds.length === 0)
      return res.status(400).json({ message: "timetable_entry_ids required for slots scope" });

    const client = await pool.connect();
    try {
      const teacherId = await getTeacherIdByUserId(client, userId);
      if (!teacherId) {
        return res.status(404).json({ message: "Teacher not found" });
      }

      // ==========================================
      // 🟢 الحارس الأول: فحص الطلبات السابقة في نفس اليوم
      // ==========================================
// ==========================================
      // 🟢 الحارس الأول: فحص الطلبات السابقة في نفس اليوم
      // ==========================================
      const checkExisting = await client.query(
        `SELECT id, status FROM teacher_permission_requests WHERE teacher_id = $1 AND request_date = $2 LIMIT 1`,
        [teacherId, requestDate]
      );

      let existingId = null;
      let existingStatus = null;

      if (checkExisting.rowCount > 0) {
        existingId = checkExisting.rows[0].id;
        existingStatus = checkExisting.rows[0].status;

        // ❌ نطرده فقط إذا كان الطلب منتهياً (مقبول أو مرفوض)
        if (existingStatus === 'approved') {
          return res.status(400).json({ message: "لقد تمت الموافقة على إذن لك في هذا اليوم مسبقاً، ولا يمكنك تعديله أو تقديم طلب جديد." });
        }
        if (existingStatus === 'rejected') {
          return res.status(400).json({ message: "لقد تم رفض إذنك في هذا اليوم من قبل الإدارة، ولا يُسمح بتقديم طلب آخر." });
        }
        
        // ✅ إذا كان (pending)، سيتجاهل هذا الشرط وينزل للأسفل لكي يقوم بتحديث الطلب بنجاح!
      }

      // ==========================================
      // 🟢 الحارس الثاني: فحص إذا كان اليوم فارغاً (عطلة أو لا يوجد حصص)
      // ==========================================
      const schoolDay = schoolDayIdFromISO(requestDate);
      if (!schoolDay) {
        return res.status(400).json({ message: "التاريخ المحدد يوافق يوم عطلة، لا حاجة لتقديم إذن غياب." });
      }

      const checkSchedule = await client.query(
        `SELECT 1 FROM timetable_entries WHERE teacher_id = $1 AND day_of_week = $2 LIMIT 1`,
        [teacherId, schoolDay]
      );

      if (checkSchedule.rowCount === 0) {
        return res.status(400).json({ message: "لا يمكنك تقديم إذن غياب لأنه ليس لديك أي حصص في هذا اليوم أصلاً." });
      }
      // ==========================================

      await client.query("BEGIN");

      let permit;
      let isUpdated = false;

      // 🔄 إذا كان عنده طلب "معلق"، نقوم بتحديثه بدلاً من إنشاء واحد جديد
      if (existingStatus === 'pending') {
        const upd = await client.query(
          `UPDATE teacher_permission_requests
           SET scope = $2, reason_text = $3, notes = $4, requested_at = now()
           WHERE id = $1
           RETURNING *`,
          [existingId, scope, reasonText || null, notes || null]
        );
        permit = upd.rows[0];
        isUpdated = true;

        // نحذف الحصص القديمة المرتبطة بهذا الطلب تمهيداً لوضع الحصص الجديدة
        await client.query(`DELETE FROM teacher_permission_request_slots WHERE permission_request_id = $1`, [existingId]);

      } else {
        // 🆕 إذا لم يكن لديه أي طلب مسبق (طلب جديد تماماً)
        const ins = await client.query(
          `INSERT INTO teacher_permission_requests
            (teacher_id, request_date, scope, status, reason_text, notes, requested_at)
           VALUES ($1, $2, $3, 'pending', $4, $5, now())
           RETURNING *`,
          [teacherId, requestDate, scope, reasonText || null, notes || null]
        );
        permit = ins.rows[0];
      }

      // 💉 إدخال الحصص الجديدة في جدول التفاصيل (تعمل في حالة التحديث والإنشاء)
      if (scope === "slots" && timetableEntryIds.length > 0) {
        for (const teId of timetableEntryIds) {
          await client.query(
            `INSERT INTO teacher_permission_request_slots (permission_request_id, timetable_entry_id)
             VALUES ($1, $2)`,
            [permit.id, teId]
          );
        }
      }
await client.query("COMMIT");

// ✅ إشعار فقط إذا كان الطلب "جديد" (INSERT) وليس تحديث طلب pending قديم
if (!isUpdated && permit?.id) {
  try {
    await NotificationAutoService.notifyTeacherPermissionRequestCreated({
      app: req.app,
      teacherPermissionRequestId: permit.id,
    });
  } catch (notifyErr) {
    console.error("Auto notification error (teacher permission request created):", notifyErr);
    // لا نرمي الخطأ حتى لا يفشل إنشاء الطلب
  }
}

return res.json({ permit, updated: isUpdated });

    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("createPermit error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },
  // ==========================================
  // 🟢 دوال حصص الاحتياط (Substitute Teacher)
  // ==========================================

  // 1. جلب طلبات الاحتياط المعلقة التي تخص هذا المعلم
  async getPendingSubstitutions(req, res) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const client = await pool.connect();
    try {
      const teacherId = await getTeacherIdByUserId(client, userId);
      if (!teacherId) return res.status(404).json({ message: "Teacher not found" });

      const result = await client.query(
        `SELECT 
            ls.id AS substitution_id,
            ls.substitution_date,
            t_absent.full_name AS absent_teacher_name,
            p.name AS period_name,
            p.start_time,
            p.end_time,
            sub.name AS subject_name,
            sec.name AS section_name,
            gr.name AS grade_name,
            stg.name AS stage_name
         FROM lesson_substitutions ls
         JOIN teachers t_absent ON t_absent.id = ls.absent_teacher_id
         JOIN timetable_entries te ON te.id = ls.timetable_entry_id
         LEFT JOIN periods p ON p.id = te.period_id
         LEFT JOIN subjects sub ON sub.id = te.subject_id
         LEFT JOIN timetables tt ON tt.id = te.timetable_id
         LEFT JOIN sections sec ON sec.id = tt.section_id
         LEFT JOIN grades gr ON sec.grade_id = gr.id
         LEFT JOIN stages stg ON gr.stage_id = stg.id
         WHERE ls.substitute_teacher_id = $1 
           AND ls.status = 'pending_teacher' -- نجلب فقط الطلبات التي تنتظر رده
         ORDER BY ls.substitution_date ASC, te.period_id ASC`,
        [teacherId]
      );

      return res.json({ items: result.rows || [] });
    } catch (e) {
      console.error("Error fetching pending substitutions:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  },

  // 2. دالة لاستقبال رد المعلم (موافق أو أعتذر)
// 2. دالة لاستقبال رد المعلم (موافق أو أعتذر)
  async respondToSubstitution(req, res) {
    const userId = req.user?.id;
    const subId = parseInt(req.params.id);
    const { response } = req.body; // 'accepted' أو 'rejected'

    if (!['accepted', 'rejected'].includes(response)) {
      return res.status(400).json({ message: "رد غير صالح" });
    }

    const client = await pool.connect();
    try {
      const teacherId = await getTeacherIdByUserId(client, userId);
      if (!teacherId) return res.status(404).json({ message: "Teacher not found" });

      const result = await client.query(
        `UPDATE lesson_substitutions
         SET status = $1
         WHERE id = $2 AND substitute_teacher_id = $3 AND status = 'pending_teacher'
         RETURNING *`,
        [response, subId, teacherId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "الطلب غير موجود أو تمت الإجابة عليه مسبقاً" });
      }

      // ⚡ السحر الحي (الاتجاه العكسي): إخبار الإدارة فوراً برد المعلم لتعمل عين الصقر!
    // =====================================
      // ⚡ السحر الحي المطور (إشارات ذكية منفصلة)
      // =====================================
      const io = req.app.get("io");
      if (io) {
        // نجلب اسم المعلم لكي نعرضه في الإشعار للإدارة
        const tRes = await client.query(`SELECT full_name FROM teachers WHERE id = $1`, [teacherId]);
        const teacherName = tRes.rows[0]?.full_name || "المعلم";

        if (response === 'rejected') {
          // 🚨 إشارة الرفض: تطلق إنذار وتحدث (عين الصقر)
          io.emit("substitute_rejected", { teacherName });
          io.emit("refresh_eagle_eye"); 
        } else if (response === 'accepted') {
          // ✅ إشارة القبول: تطلق إشعار نجاح للإدارة
          io.emit("substitute_accepted", { teacherName });
        }
        
        // 🔄 في كلتا الحالتين، نخبر الإدارة بتحديث قائمة الأذونات لترى التغيير الجديد
        io.emit("refresh_admin_permits");
      }
      // =====================================

      return res.json({ message: "تم تسجيل الرد بنجاح", status: response });
    } catch (e) {
      console.error("Error responding to substitution:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      client.release();
    }
  }
};
