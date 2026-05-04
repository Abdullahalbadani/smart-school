// backend/src/controllers/parentPermissionsController.js
// ESM

import { pool } from "../config/db.js";
import { NotificationAutoService } from "../modules/notifications/index.js";

/* ===================== helpers ===================== */
const pickUserId = (req) =>
  req?.user?.id ?? req?.user?.user_id ?? req?.user?.userId ?? null;

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s || ""));

function normType(t) {
  const x = String(t || "").trim().toUpperCase();
  if (x === "ABSENCE" || x === "LATE" || x === "EARLY_LEAVE") return x;
  return "";
}

// ✅ تم الإصلاح: تحقق ملكية الطالب مع حماية school_id
async function parentOwnsStudent(parentUserId, studentId, schoolId) {
  try {
    const r = await pool.query(
      `
      SELECT 1
      FROM guardians g
      JOIN student_guardians sg ON sg.guardian_id = g.id
      WHERE g.user_id = $1
        AND sg.student_id = $2
        AND g.school_id = $3
        AND sg.school_id = $3
      LIMIT 1
      `,
      [parentUserId, studentId, schoolId]
    );

    return !!r.rowCount;
  } catch (e) {
    if (e && e.code === "42P01") {
      console.error("Missing table for parent-student relation:", e.message);
      return false;
    }
    throw e;
  }
}

/* ===================== Controllers ===================== */

// GET /api/parent/permissions?studentId=2&date=2026-01-28
export async function getPermissionForDay(req, res) {
  try {
    const parentUserId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!parentUserId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const studentId = Number(req.query.studentId || 0);
    const date = String(req.query.date || "").trim();

    if (!studentId) return res.status(400).json({ message: "studentId مطلوب" });
    if (!isISODate(date)) return res.status(400).json({ message: "date بصيغة YYYY-MM-DD مطلوب" });

    const ok = await parentOwnsStudent(parentUserId, studentId, schoolId);
    if (!ok) return res.status(403).json({ message: "لا تملك صلاحية لهذا الطالب أو لا يتبع لمدرستك" });

    // ✅ إضافة school_id للاستعلام
    const r = await pool.query(
      `SELECT id, student_id, parent_user_id, request_date, type, time_from, time_to,
              reason_text, attachment_url, status, decided_by_user_id, decided_at, decision_note,
              created_at, updated_at
       FROM permission_requests
       WHERE student_id=$1 AND parent_user_id=$2 AND request_date=$3 AND school_id=$4
       LIMIT 1`,
      [studentId, parentUserId, date, schoolId]
    );

    return res.json({ data: r.rows[0] || null });
  } catch (e) {
    console.error("getPermissionForDay error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

// POST /api/parent/permissions
export async function createPermission(req, res) {
  console.log("🔥 createPermission CALLED");
  try {
    const parentUserId = pickUserId(req);
    const schoolId = req.user?.school_id;
    if (!parentUserId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const body = req.body || {};
    const studentId = Number(body.studentId ?? body.student_id ?? 0);
    const date = String(body.date ?? body.request_date ?? "").trim();
    const type = normType(body.type);
    const timeFrom = body.timeFrom ?? body.time_from ?? null;
    const timeTo = body.timeTo ?? body.time_to ?? null;
    const reasonText = body.reasonText ?? body.reason_text ?? null;
    const attachmentUrl = body.attachmentUrl ?? body.attachment_url ?? null;

    if (!studentId) return res.status(400).json({ message: "studentId مطلوب" });
    if (!isISODate(date)) return res.status(400).json({ message: "date بصيغة YYYY-MM-DD مطلوب" });
    if (!type) return res.status(400).json({ message: "type يجب أن يكون ABSENCE أو LATE أو EARLY_LEAVE" });

    // تحقق من الأوقات حسب النوع
    if (type === "ABSENCE") {
      // لازم null
    } else if (type === "LATE") {
      if (!timeFrom || !isTime(timeFrom)) {
        return res.status(400).json({ message: "timeFrom مطلوب للتأخر وبصيغة HH:MM" });
      }
    } else if (type === "EARLY_LEAVE") {
      if (!timeTo || !isTime(timeTo)) {
        return res.status(400).json({ message: "timeTo مطلوب للانصراف المبكر وبصيغة HH:MM" });
      }
    }

    const ok = await parentOwnsStudent(parentUserId, studentId, schoolId);
    if (!ok) return res.status(403).json({ message: "لا تملك صلاحية لهذا الطالب أو لا يتبع لمدرستك" });

    // ✅ إضافة school_id للإدخال
    const q = `
      INSERT INTO permission_requests
        (school_id, student_id, parent_user_id, request_date, type, time_from, time_to, reason_text, attachment_url)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, school_id, student_id, parent_user_id, request_date, type, time_from, time_to,
                reason_text, attachment_url, status, created_at
    `;

    const r = await pool.query(q, [
      schoolId,
      studentId,
      parentUserId,
      date,
      type,
      type === "LATE" ? timeFrom : null,
      type === "EARLY_LEAVE" ? timeTo : null,
      reasonText,
      attachmentUrl,
    ]);

    const newRequest = r.rows[0];

    // ✅ إشعار تلقائي بعد إنشاء طلب الاستئذان (لا يفشل العملية الأساسية لو تعطل)
    try {
      await NotificationAutoService.notifyPermissionRequestCreated({
        app: req.app,
        permissionRequestId: newRequest.id,
      });
    } catch (notifyErr) {
      console.error("Auto notification error (permission request created):", notifyErr);
    }

    return res.status(201).json({ data: newRequest });

  } catch (e) {
    // Unique violation: إذن واحد باليوم للطالب
    if (e && e.code === "23505") {
      return res.status(409).json({ message: "يوجد إذن مسجل لهذا الطالب في هذا اليوم بالفعل" });
    }
    // FK violation (student not exists)
    if (e && e.code === "23503") {
      return res.status(400).json({ message: "studentId غير موجود" });
    }
    console.error("createPermission error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}