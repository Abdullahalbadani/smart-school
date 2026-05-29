// src/controllers/feeAdjustmentRequestsController.js
import { pool } from "../config/db.js";

function normalizeStatus(status) {
  const value = String(status || "pending").trim().toLowerCase();

  if (["pending", "approved", "rejected", "all"].includes(value)) {
    return value;
  }

  return "pending";
}

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function toPositiveAmount(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) return null;

  return Math.round(n);
}

export const FeeAdjustmentRequestsController = {
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
          r.student_id,
          r.contract_id,
          r.request_type,
          r.amount,
          r.reason,
          r.status,
          r.admin_note,
          r.requested_by_user_id,
          r.decided_by_user_id,
          r.decided_at,
          r.created_at,
          r.updated_at,

          s.full_name AS student_name,
          s.student_code,

          fc.annual_amount,
          fc.discount_amount,
          fc.status AS contract_status,

          COALESCE(requester.username, requester.email, 'مستخدم') AS requested_by_name,
          COALESCE(decider.username, decider.email, '—') AS decided_by_name

        FROM fee_adjustment_requests r

        JOIN students s
          ON s.id = r.student_id
         AND s.school_id = r.school_id

        JOIN fee_contracts fc
          ON fc.id = r.contract_id
         AND fc.school_id = r.school_id
         AND fc.student_id = r.student_id

        LEFT JOIN users requester
          ON requester.id = r.requested_by_user_id

        LEFT JOIN users decider
          ON decider.id = r.decided_by_user_id

        WHERE r.school_id = $1
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
      console.error("list fee adjustment requests error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في جلب طلبات تعديل الرسوم",
      });
    }
  },

  async create(req, res) {
    try {
      const schoolId = req.user?.school_id;
      const userId = pickUserId(req);

      const studentId = Number(req.body?.student_id);
      const contractId = Number(req.body?.contract_id);
      const amount = toPositiveAmount(req.body?.amount);
      const reason = String(req.body?.reason || "").trim();

      if (!schoolId || !userId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح",
        });
      }

      if (!Number.isInteger(studentId) || studentId <= 0) {
        return res.status(400).json({
          success: false,
          message: "رقم الطالب غير صالح",
        });
      }

      if (!Number.isInteger(contractId) || contractId <= 0) {
        return res.status(400).json({
          success: false,
          message: "رقم عقد الرسوم غير صالح",
        });
      }

      if (!amount) {
        return res.status(400).json({
          success: false,
          message: "مبلغ الخصم غير صالح",
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: "سبب الخصم مطلوب",
        });
      }

      const contractCheck = await pool.query(
        `
        SELECT
          id,
          school_id,
          student_id,
          annual_amount,
          discount_amount,
          status
        FROM fee_contracts
        WHERE id = $1
          AND school_id = $2
          AND student_id = $3
        LIMIT 1
        `,
        [contractId, schoolId, studentId]
      );

      const contract = contractCheck.rows[0];

      if (!contract) {
        return res.status(404).json({
          success: false,
          message: "عقد الرسوم غير موجود أو لا يتبع لهذه المدرسة",
        });
      }

      const remainingResult = await pool.query(
        `
        SELECT
          COALESCE(
            SUM(
              GREATEST(
                COALESCE(amount, 0) - COALESCE(paid_amount, 0),
                0
              )
            ),
            0
          )::bigint AS remaining_amount
        FROM fee_installments
        WHERE school_id = $1
          AND (
            contract_id = $2
            OR fee_contract_id = $2
          )
        `,
        [schoolId, contractId]
      );

      const remainingAmount = Number(remainingResult.rows[0]?.remaining_amount || 0);

      if (amount > remainingAmount) {
        return res.status(400).json({
          success: false,
          message: `مبلغ الخصم أكبر من المتبقي على الطالب. المتبقي الحالي هو ${remainingAmount}`,
        });
      }

      const exists = await pool.query(
        `
        SELECT id
        FROM fee_adjustment_requests
        WHERE school_id = $1
          AND contract_id = $2
          AND status = 'pending'
        LIMIT 1
        `,
        [schoolId, contractId]
      );

      if (exists.rows.length) {
        return res.status(409).json({
          success: false,
          message: "يوجد طلب تعديل رسوم معلق لهذا العقد بالفعل",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO fee_adjustment_requests
          (
            school_id,
            student_id,
            contract_id,
            request_type,
            amount,
            reason,
            status,
            requested_by_user_id,
            created_at,
            updated_at
          )
        VALUES
          (
            $1,
            $2,
            $3,
            'discount',
            $4,
            $5,
            'pending',
            $6,
            NOW(),
            NOW()
          )
        RETURNING *
        `,
        [schoolId, studentId, contractId, amount, reason, userId]
      );

      return res.status(201).json({
        success: true,
        message: "تم إرسال طلب تعديل الرسوم إلى المدير",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("create fee adjustment request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في إنشاء طلب تعديل الرسوم",
      });
    }
  },

  async approve(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      const adminUserId = pickUserId(req);
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
          r.*,
          fc.annual_amount,
          fc.discount_amount
        FROM fee_adjustment_requests r
        JOIN fee_contracts fc
          ON fc.id = r.contract_id
         AND fc.school_id = r.school_id
         AND fc.student_id = r.student_id
        WHERE r.id = $1
          AND r.school_id = $2
        FOR UPDATE
        `,
        [requestId, schoolId]
      );

      const request = requestResult.rows[0];

      if (!request) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "طلب تعديل الرسوم غير موجود",
        });
      }

      if (String(request.status || "").toLowerCase() !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "تم اتخاذ قرار على هذا الطلب مسبقًا",
        });
      }

      const discountAmount = Number(request.amount || 0);

      const installmentsResult = await client.query(
        `
        SELECT
          id,
          amount,
          paid_amount,
          due_date
        FROM fee_installments
        WHERE school_id = $1
          AND (
            contract_id = $2
            OR fee_contract_id = $2
          )
        ORDER BY
          due_date DESC NULLS LAST,
          id DESC
        FOR UPDATE
        `,
        [schoolId, request.contract_id]
      );

      let remainingDiscount = discountAmount;

      for (const installment of installmentsResult.rows) {
        if (remainingDiscount <= 0) break;

        const currentAmount = Number(installment.amount || 0);
        const paidAmount = Number(installment.paid_amount || 0);
        const remainingInInstallment = Math.max(currentAmount - paidAmount, 0);

        if (remainingInInstallment <= 0) continue;

        const applied = Math.min(remainingDiscount, remainingInInstallment);
        const newAmount = currentAmount - applied;

        await client.query(
          `
          UPDATE fee_installments
          SET
            amount = $1,
            updated_at = NOW()
          WHERE id = $2
            AND school_id = $3
          `,
          [newAmount, installment.id, schoolId]
        );

        remainingDiscount -= applied;
      }

      if (remainingDiscount > 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message: "لا يمكن تطبيق الخصم لأن المتبقي على الأقساط أقل من مبلغ الخصم",
        });
      }

      await client.query(
        `
        UPDATE fee_contracts
        SET
          discount_amount = COALESCE(discount_amount, 0) + $1,
          updated_at = NOW()
        WHERE id = $2
          AND school_id = $3
        `,
        [discountAmount, request.contract_id, schoolId]
      );

      const updatedRequest = await client.query(
        `
        UPDATE fee_adjustment_requests
        SET
          status = 'approved',
          admin_note = NULLIF($2, ''),
          decided_by_user_id = $3,
          decided_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND school_id = $4
        RETURNING *
        `,
        [requestId, adminNote, adminUserId, schoolId]
      );

      await client.query("COMMIT");

      const io = req.app?.get?.("io");

      if (io) {
        io.to(`school_${schoolId}`).emit("fee_adjustment_request_updated", {
          id: requestId,
          status: "approved",
          contract_id: request.contract_id,
          student_id: request.student_id,
        });
      }

      return res.json({
        success: true,
        message: "تم قبول طلب تعديل الرسوم وتطبيق الخصم",
        data: updatedRequest.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("approve fee adjustment request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في قبول طلب تعديل الرسوم",
      });
    } finally {
      client.release();
    }
  },

  async reject(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = req.user?.school_id;
      const adminUserId = pickUserId(req);
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
        SELECT *
        FROM fee_adjustment_requests
        WHERE id = $1
          AND school_id = $2
        FOR UPDATE
        `,
        [requestId, schoolId]
      );

      const request = requestResult.rows[0];

      if (!request) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "طلب تعديل الرسوم غير موجود",
        });
      }

      if (String(request.status || "").toLowerCase() !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "تم اتخاذ قرار على هذا الطلب مسبقًا",
        });
      }

      const updatedRequest = await client.query(
        `
        UPDATE fee_adjustment_requests
        SET
          status = 'rejected',
          admin_note = NULLIF($2, ''),
          decided_by_user_id = $3,
          decided_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND school_id = $4
        RETURNING *
        `,
        [requestId, adminNote, adminUserId, schoolId]
      );

      await client.query("COMMIT");

      const io = req.app?.get?.("io");

      if (io) {
        io.to(`school_${schoolId}`).emit("fee_adjustment_request_updated", {
          id: requestId,
          status: "rejected",
          contract_id: request.contract_id,
          student_id: request.student_id,
        });
      }

      return res.json({
        success: true,
        message: "تم رفض طلب تعديل الرسوم",
        data: updatedRequest.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("reject fee adjustment request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في رفض طلب تعديل الرسوم",
      });
    } finally {
      client.release();
    }
  },
};