// src/controllers/studentTransferRequestsController.js
import { pool } from "../config/db.js";

function normalizeStatus(status) {
  const value = String(status || "pending").trim().toLowerCase();
  if (["pending", "approved", "rejected", "all"].includes(value)) return value;
  return "pending";
}

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const StudentTransferRequestsController = {
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
          r.academic_year_id,
          r.term,

          r.from_stage_id,
          r.from_grade_id,
          r.from_section_id,
          r.to_stage_id,
          r.to_grade_id,
          r.to_section_id,

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

          ay.name AS academic_year_name,

          COALESCE(from_g.grade_name, from_g.name, 'صف غير محدد') AS from_grade_name,
          COALESCE(from_sec.name, 'بدون شعبة') AS from_section_name,

          COALESCE(to_g.grade_name, to_g.name, 'صف غير محدد') AS to_grade_name,
          COALESCE(to_sec.name, 'بدون شعبة') AS to_section_name,

          (
            COALESCE(from_g.grade_name, from_g.name, 'صف غير محدد')
            || ' - الشعبة '
            || COALESCE(from_sec.name, 'بدون شعبة')
          ) AS from_class_label,

          (
            COALESCE(to_g.grade_name, to_g.name, 'صف غير محدد')
            || ' - الشعبة '
            || COALESCE(to_sec.name, 'بدون شعبة')
          ) AS to_class_label,

          COALESCE(requester.username, requester.email, 'مستخدم') AS requested_by_name,
          COALESCE(decider.username, decider.email, '—') AS decided_by_name

        FROM student_transfer_requests r

        JOIN students s
          ON s.id = r.student_id
         AND s.school_id = r.school_id

        JOIN academic_years ay
          ON ay.id = r.academic_year_id
         AND ay.school_id = r.school_id

        JOIN grades from_g
          ON from_g.id = r.from_grade_id
         AND from_g.school_id = r.school_id

        LEFT JOIN sections from_sec
          ON from_sec.id = r.from_section_id
         AND from_sec.school_id = r.school_id

        JOIN grades to_g
          ON to_g.id = r.to_grade_id
         AND to_g.school_id = r.school_id

        LEFT JOIN sections to_sec
          ON to_sec.id = r.to_section_id
         AND to_sec.school_id = r.school_id

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
      console.error("list student transfer requests error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في جلب طلبات نقل الطلاب",
      });
    }
  },

  async create(req, res) {
    try {
      const schoolId = req.user?.school_id;
      const userId = pickUserId(req);

      const studentId = toInt(req.body?.student_id);
      const toStageId = toInt(req.body?.to_stage_id);
      const toGradeId = toInt(req.body?.to_grade_id);
      const toSectionId = req.body?.to_section_id ? toInt(req.body?.to_section_id) : null;
      const reason = String(req.body?.reason || "").trim();

      const requestedTerm = req.body?.term ? toInt(req.body?.term) : null;
      const requestedYearId = req.body?.academic_year_id
        ? toInt(req.body?.academic_year_id)
        : null;

      if (!schoolId || !userId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "رقم الطالب غير صالح",
        });
      }

      if (!toStageId || !toGradeId) {
        return res.status(400).json({
          success: false,
          message: "اختر المرحلة والصف المراد النقل إليه",
        });
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: "سبب النقل مطلوب",
        });
      }

      const activeYearResult = await pool.query(
        `
        SELECT id
        FROM academic_years
        WHERE school_id = $1
          AND is_active = true
        LIMIT 1
        `,
        [schoolId]
      );

      const activeYearId = requestedYearId || activeYearResult.rows[0]?.id;

      if (!activeYearId) {
        return res.status(400).json({
          success: false,
          message: "لا توجد سنة دراسية نشطة",
        });
      }

      const studentCheck = await pool.query(
        `
        SELECT id
        FROM students
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [studentId, schoolId]
      );

      if (!studentCheck.rows[0]) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود أو لا يتبع مدرستك",
        });
      }

      const enrollmentParams = [schoolId, studentId, activeYearId];
      let enrollmentTermSql = "";

      if (requestedTerm) {
        enrollmentParams.push(requestedTerm);
        enrollmentTermSql = `AND se.term = $4`;
      }

      const enrollmentResult = await pool.query(
        `
        SELECT
          se.id,
          se.student_id,
          se.academic_year_id,
          se.stage_id,
          se.grade_id,
          se.section_id,
          se.term,
          se.status
        FROM student_enrollments se
        WHERE se.school_id = $1
          AND se.student_id = $2
          AND se.academic_year_id = $3
          ${enrollmentTermSql}
          AND se.status = 'enrolled'
        ORDER BY se.term DESC, se.id DESC
        LIMIT 1
        `,
        enrollmentParams
      );

      const enrollment = enrollmentResult.rows[0];

      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: "لا يوجد قيد دراسي نشط لهذا الطالب في السنة الحالية",
        });
      }

      const targetGradeResult = await pool.query(
        `
        SELECT id, stage_id
        FROM grades
        WHERE id = $1
          AND school_id = $2
          AND stage_id = $3
          AND COALESCE(is_active, true) = true
        LIMIT 1
        `,
        [toGradeId, schoolId, toStageId]
      );

      if (!targetGradeResult.rows[0]) {
        return res.status(400).json({
          success: false,
          message: "الصف الهدف غير صحيح أو لا يتبع المرحلة المختارة",
        });
      }

      if (toSectionId) {
        const targetSectionResult = await pool.query(
          `
          SELECT id
          FROM sections
          WHERE id = $1
            AND school_id = $2
            AND grade_id = $3
            AND COALESCE(is_active, true) = true
          LIMIT 1
          `,
          [toSectionId, schoolId, toGradeId]
        );

        if (!targetSectionResult.rows[0]) {
          return res.status(400).json({
            success: false,
            message: "الشعبة الهدف غير صحيحة أو لا تتبع الصف المختار",
          });
        }
      }

      const sameStage = Number(enrollment.stage_id) === toStageId;
      const sameGrade = Number(enrollment.grade_id) === toGradeId;
      const sameSection =
        String(enrollment.section_id || "") === String(toSectionId || "");

      if (sameStage && sameGrade && sameSection) {
        return res.status(400).json({
          success: false,
          message: "الطالب موجود بالفعل في نفس الصف والشعبة",
        });
      }

      const exists = await pool.query(
        `
        SELECT id
        FROM student_transfer_requests
        WHERE school_id = $1
          AND student_id = $2
          AND academic_year_id = $3
          AND term = $4
          AND status = 'pending'
        LIMIT 1
        `,
        [schoolId, studentId, enrollment.academic_year_id, enrollment.term]
      );

      if (exists.rows.length) {
        return res.status(409).json({
          success: false,
          message: "يوجد طلب نقل معلق لهذا الطالب بالفعل",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO student_transfer_requests
          (
            school_id,
            student_id,
            academic_year_id,
            term,

            from_stage_id,
            from_grade_id,
            from_section_id,

            to_stage_id,
            to_grade_id,
            to_section_id,

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
            $4,

            $5,
            $6,
            $7,

            $8,
            $9,
            $10,

            $11,
            'pending',
            $12,
            NOW(),
            NOW()
          )
        RETURNING *
        `,
        [
          schoolId,
          studentId,
          enrollment.academic_year_id,
          enrollment.term,

          enrollment.stage_id,
          enrollment.grade_id,
          enrollment.section_id,

          toStageId,
          toGradeId,
          toSectionId,

          reason,
          userId,
        ]
      );

      return res.status(201).json({
        success: true,
        message: "تم إرسال طلب نقل الطالب إلى المدير",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("create student transfer request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في إنشاء طلب نقل الطالب",
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
        SELECT *
        FROM student_transfer_requests
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
          message: "طلب النقل غير موجود",
        });
      }

      if (String(request.status || "").toLowerCase() !== "pending") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "تم اتخاذ قرار على هذا الطلب مسبقًا",
        });
      }

      const updateEnrollment = await client.query(
        `
        UPDATE student_enrollments
        SET
          stage_id = $1,
          grade_id = $2,
          section_id = $3
        WHERE school_id = $4
          AND student_id = $5
          AND academic_year_id = $6
          AND term = $7
          AND status = 'enrolled'
          AND stage_id = $8
          AND grade_id = $9
          AND section_id IS NOT DISTINCT FROM $10
        RETURNING *
        `,
        [
          request.to_stage_id,
          request.to_grade_id,
          request.to_section_id,

          schoolId,
          request.student_id,
          request.academic_year_id,
          request.term,

          request.from_stage_id,
          request.from_grade_id,
          request.from_section_id,
        ]
      );

      if (!updateEnrollment.rows.length) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message:
            "تعذر تطبيق النقل لأن قيد الطالب تغير بعد إنشاء الطلب. أنشئ طلب نقل جديد.",
        });
      }

      const updatedRequest = await client.query(
        `
        UPDATE student_transfer_requests
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
        io.to(`school_${schoolId}`).emit("student_transfer_request_updated", {
          id: requestId,
          status: "approved",
          student_id: request.student_id,
        });
      }

      return res.json({
        success: true,
        message: "تم قبول طلب النقل وتحديث قيد الطالب",
        data: updatedRequest.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("approve student transfer request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في قبول طلب نقل الطالب",
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
        FROM student_transfer_requests
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
          message: "طلب النقل غير موجود",
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
        UPDATE student_transfer_requests
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
        io.to(`school_${schoolId}`).emit("student_transfer_request_updated", {
          id: requestId,
          status: "rejected",
          student_id: request.student_id,
        });
      }

      return res.json({
        success: true,
        message: "تم رفض طلب نقل الطالب",
        data: updatedRequest.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("reject student transfer request error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في رفض طلب نقل الطالب",
      });
    } finally {
      client.release();
    }
  },
};