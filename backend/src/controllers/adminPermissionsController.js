// backend/src/controllers/adminPermissionsController.js
import { pool } from "../config/db.js";
import { NotificationAutoService } from "../modules/notifications/index.js";

const pickUserId = (req) =>
  req?.user?.id ?? req?.user?.user_id ?? req?.user?.userId ?? null;

// GET /api/admin/permissions?date=YYYY-MM-DD&status=PENDING
export async function listPermissions(req, res) {
  try {
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const date = String(req.query.date || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();

    const where = ["pr.school_id = $1"]; // ✅ جلب طلبات هذه المدرسة فقط
    const vals = [schoolId];
    let i = 2;

    if (date) {
      where.push(`pr.request_date = $${i++}`);
      vals.push(date);
    }
    if (status) {
      where.push(`pr.status = $${i++}`);
      vals.push(status);
    }

    const sql = `
      SELECT
        pr.id, pr.student_id, pr.parent_user_id, pr.request_date, pr.type,
        pr.time_from, pr.time_to, pr.reason_text, pr.attachment_url,
        pr.status, pr.decided_by_user_id, pr.decided_at, pr.decision_note,
        pr.created_at,
        s.full_name AS student_name
      FROM permission_requests pr
      LEFT JOIN students s ON s.id = pr.student_id
      WHERE ${where.join(" AND ")}
      ORDER BY pr.created_at DESC
      LIMIT 200
    `;

    const r = await pool.query(sql, vals);
    return res.json({ data: r.rows });
  } catch (e) {
    console.error("listPermissions error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

// POST /api/admin/permissions/:id/decide { action: "APPROVE"|"REJECT", note?: "" }
export async function decidePermission(req, res) {
  try {
    const adminId = pickUserId(req);
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!adminId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = Number(req.params.id || 0);
    const action = String(req.body?.action || "").toUpperCase();
    const note = req.body?.note ?? null;

    if (!id) return res.status(400).json({ message: "id غير صحيح" });
    if (action !== "APPROVE" && action !== "REJECT") {
      return res.status(400).json({ message: "action يجب أن يكون APPROVE أو REJECT" });
    }

    const newStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";

    // ✅ التحديث يتم فقط للطلبات التابعة لنفس المدرسة
    const r = await pool.query(
      `UPDATE permission_requests
       SET status=$2, decided_by_user_id=$3, decided_at=now(), decision_note=$4, updated_at=now()
       WHERE id=$1 AND school_id=$5
       RETURNING id, student_id, parent_user_id, request_date, type, status, decision_note`,
      [id, newStatus, adminId, note, schoolId]
    );

    if (!r.rowCount) return res.status(404).json({ message: "الطلب غير موجود أو لا تملك صلاحية تعديله" });

    const updatedRequest = r.rows[0];

    // ✅ إشعار تلقائي بعد القرار (قبول/رفض) - لا يفشل العملية الأساسية إذا تعطل
    try {
      await NotificationAutoService.notifyPermissionRequestDecision({
        app: req.app,
        permissionRequestId: updatedRequest.id,
        includeStudent: true,
        includeAdmins: false,
      });
    } catch (notifyErr) {
      console.error("Auto notification error (permission decision):", notifyErr);
    }

    return res.json({ data: updatedRequest });
  } catch (e) {
    console.error("decidePermission error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

// POST /api/admin/permissions/:id/override { status: "PENDING"|"APPROVED"|"REJECTED", note?: "" }
export async function overridePermission(req, res) {
  try {
    const adminId = pickUserId(req);
    const schoolId = req.user?.school_id; // ✅ Multi-tenant
    if (!adminId || !schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = Number(req.params.id || 0);
    const status = String(req.body?.status || "").toUpperCase();
    const note = req.body?.note ?? null;

    if (!id) return res.status(400).json({ message: "id غير صحيح" });
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "status غير صحيح" });
    }

    // ✅ التحديث يتم فقط للطلبات التابعة لنفس المدرسة
    const r = await pool.query(
      `UPDATE permission_requests
       SET status=$2, decided_by_user_id=$3, decided_at=now(), decision_note=$4, updated_at=now()
       WHERE id=$1 AND school_id=$5
       RETURNING id, student_id, parent_user_id, request_date, type, status, decision_note`,
      [id, status, adminId, note, schoolId]
    );

    if (!r.rowCount) return res.status(404).json({ message: "الطلب غير موجود أو لا تملك صلاحية تعديله" });

    const updatedRequest = r.rows[0];

    // ✅ إشعار فقط إذا كانت النتيجة قرار نهائي (قبول/رفض)
    if (["APPROVED", "REJECTED"].includes(String(updatedRequest.status || "").toUpperCase())) {
      try {
        await NotificationAutoService.notifyPermissionRequestDecision({
          app: req.app,
          permissionRequestId: updatedRequest.id,
          includeStudent: true,
          includeAdmins: false,
        });
      } catch (notifyErr) {
        console.error("Auto notification error (permission override decision):", notifyErr);
      }
    }

    return res.json({ data: updatedRequest });
  } catch (e) {
    console.error("overridePermission error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}