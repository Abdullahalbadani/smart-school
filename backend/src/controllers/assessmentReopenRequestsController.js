// src/controllers/assessmentReopenRequestsController.js
import { pool } from "../config/db.js";

function normalizeStatus(status) {
  const value = String(status || "pending").trim().toLowerCase();

  if (["pending", "approved", "rejected", "all"].includes(value)) {
    return value;
  }

  return "pending";
}

function normalizeHours(value) {
  const n = Number(value || 24);

  if (!Number.isFinite(n) || n <= 0) return 24;
  if (n > 168) return 168; // أقصى مدة أسبوع

  return Math.round(n);
}

export const AssessmentReopenRequestsController = {
  async list(req, res) {
    try {
      const schoolId = req.user?.school_id;
      const status = normalizeStatus(req.query.status);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح",
        });
      }

      const result = await pool.query(
        `
        SELECT
          r.id,
          r.school_id,
          r.assessment_id,
          r.requested_by_user_id,
          r.reason,
          r.status,
          r.admin_note,
          r.decided_by_user_id,
          r.decided_at,
          r.created_at,
COALESCE(requester.username, requester.email, 'مستخدم') AS requested_by_name,
COALESCE(decider.username, decider.email, '—') AS decided_by_name,
          a.title AS assessment_title,
          a.title_short AS assessment_title_short,
          a.type AS assessment_type,
          a.mode AS assessment_mode,
          a.exam_kind,
          a.aggregate_kind,
          a.status AS assessment_status,
          a.due_at,
          a.closed_at,

          ta.id AS teacher_assignment_id,
          ta.term,
          ta.stage_id,
          ta.grade_id,
          ta.section_id,
          ta.subject_id,

          COALESCE(g.grade_name, g.name, 'صف غير محدد') AS grade_name,
          COALESCE(sec.name, 'شعبة غير محددة') AS section_name,

          (
            COALESCE(g.grade_name, g.name, 'صف غير محدد')
            || ' - الشعبة '
            || COALESCE(sec.name, 'غير محددة')
          ) AS class_label

        FROM assessment_reopen_requests r

        JOIN assessments a
          ON a.id = r.assessment_id

        LEFT JOIN teacher_assignments ta
          ON ta.id = a.teacher_assignment_id

        LEFT JOIN grades g
          ON g.id = ta.grade_id
         AND g.school_id = a.school_id

        LEFT JOIN sections sec
          ON sec.id = ta.section_id
         AND sec.school_id = a.school_id

        LEFT JOIN users requester
          ON requester.id = r.requested_by_user_id

        LEFT JOIN users decider
          ON decider.id = r.decided_by_user_id

        WHERE r.school_id = $1
          AND a.school_id = $1
          AND (
            $2 = 'all'
            OR LOWER(COALESCE(r.status, 'pending')) = $2
          )

        ORDER BY
          CASE
            WHEN LOWER(COALESCE(r.status, 'pending')) = 'pending' THEN 0
            ELSE 1
          END,
          r.created_at DESC
        `,
        [schoolId, status]
      );

      return res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("list assessment reopen requests error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في جلب طلبات إعادة فتح التقييم",
      });
    }
  },

  async approve(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      const adminUserId = req.user?.id;
      const requestId = Number(req.params.id);
      const adminNote = String(req.body?.admin_note || "").trim();
      const reopenHours = normalizeHours(req.body?.reopen_hours);

      if (!schoolId || !adminUserId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح",
        });
      }

      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          message: "رقم الطلب غير صالح",
        });
      }

      await client.query("BEGIN");

      const requestResult = await client.query(
        `
        SELECT
          r.id,
          r.school_id,
          r.assessment_id,
          r.requested_by_user_id,
          r.status,
          a.school_id AS assessment_school_id,
          a.title,
          a.status AS assessment_status
        FROM assessment_reopen_requests r
        JOIN assessments a
          ON a.id = r.assessment_id
        WHERE r.id = $1
          AND r.school_id = $2
          AND a.school_id = $2
        FOR UPDATE
        `,
        [requestId, schoolId]
      );

      const request = requestResult.rows[0];

      if (!request) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "طلب إعادة الفتح غير موجود",
        });
      }

      if (String(request.status || "").toLowerCase() !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "تم اتخاذ قرار على هذا الطلب مسبقًا",
        });
      }

      const updatedRequestResult = await client.query(
        `
        UPDATE assessment_reopen_requests
        SET
          status = 'approved',
          admin_note = NULLIF($2, ''),
          decided_by_user_id = $3,
          decided_at = NOW()
        WHERE id = $1
          AND school_id = $4
        RETURNING *
        `,
        [requestId, adminNote, adminUserId, schoolId]
      );

     await client.query(
  `
  UPDATE assessments
  SET
    status = 'active',
    closed_at = NULL,
    due_at = NOW() + ($2::int * INTERVAL '1 hour'),
    updated_at = NOW()
  WHERE id = $1
    AND school_id = $3
  `,
  [request.assessment_id, reopenHours, schoolId]
);

await client.query(
  `
  UPDATE assessment_grades
  SET
    is_published = false,
    published_at = NULL,
    updated_at = NOW()
  WHERE assessment_id = $1
    AND school_id = $2
  `,
  [request.assessment_id, schoolId]
);

      await client.query("COMMIT");

      const io = req.app?.get?.("io");

      if (io) {
        io.to(`school_${schoolId}`).emit("assessment_reopen_request_updated", {
          id: requestId,
          status: "approved",
          assessment_id: request.assessment_id,
        });

        io.to(`user_${request.requested_by_user_id}`).emit(
          "assessment_reopen_request_updated",
          {
            id: requestId,
            status: "approved",
            assessment_id: request.assessment_id,
          }
        );
      }

      return res.json({
        success: true,
        message: "تم قبول طلب إعادة فتح التقييم بنجاح",
        data: updatedRequestResult.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("approve assessment reopen request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في قبول طلب إعادة فتح التقييم",
      });
    } finally {
      client.release();
    }
  },

  async reject(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      const adminUserId = req.user?.id;
      const requestId = Number(req.params.id);
      const adminNote = String(req.body?.admin_note || "").trim();

      if (!schoolId || !adminUserId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح",
        });
      }

      if (!Number.isInteger(requestId) || requestId <= 0) {
        return res.status(400).json({
          success: false,
          message: "رقم الطلب غير صالح",
        });
      }

      await client.query("BEGIN");

      const requestResult = await client.query(
        `
        SELECT
          r.id,
          r.school_id,
          r.assessment_id,
          r.requested_by_user_id,
          r.status,
          a.school_id AS assessment_school_id
        FROM assessment_reopen_requests r
        JOIN assessments a
          ON a.id = r.assessment_id
        WHERE r.id = $1
          AND r.school_id = $2
          AND a.school_id = $2
        FOR UPDATE
        `,
        [requestId, schoolId]
      );

      const request = requestResult.rows[0];

      if (!request) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "طلب إعادة الفتح غير موجود",
        });
      }

      if (String(request.status || "").toLowerCase() !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "تم اتخاذ قرار على هذا الطلب مسبقًا",
        });
      }

      const updatedRequestResult = await client.query(
        `
        UPDATE assessment_reopen_requests
        SET
          status = 'rejected',
          admin_note = NULLIF($2, ''),
          decided_by_user_id = $3,
          decided_at = NOW()
        WHERE id = $1
          AND school_id = $4
        RETURNING *
        `,
        [requestId, adminNote, adminUserId, schoolId]
      );

      await client.query("COMMIT");

      const io = req.app?.get?.("io");

      if (io) {
        io.to(`school_${schoolId}`).emit("assessment_reopen_request_updated", {
          id: requestId,
          status: "rejected",
          assessment_id: request.assessment_id,
        });

        io.to(`user_${request.requested_by_user_id}`).emit(
          "assessment_reopen_request_updated",
          {
            id: requestId,
            status: "rejected",
            assessment_id: request.assessment_id,
          }
        );
      }

      return res.json({
        success: true,
        message: "تم رفض طلب إعادة فتح التقييم",
        data: updatedRequestResult.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("reject assessment reopen request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في رفض طلب إعادة فتح التقييم",
      });
    } finally {
      client.release();
    }
  },
};