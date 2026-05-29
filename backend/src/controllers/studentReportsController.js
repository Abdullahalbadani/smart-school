// backend/src/controllers/studentReportsController.js
import { pool } from "../config/db.js";

function getSchoolId(req) {
  return req.user?.school_id || req.user?.school?.id || null;
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toText(value) {
  return String(value || "").trim();
}

function buildStudentReportQuery(req, options = {}) {
  const schoolId = getSchoolId(req);
  const q = req.query || {};

  const academicYearId = toPositiveInt(q.academic_year_id);
  if (!schoolId) throw new Error("غير مصرح: لم يتم تحديد المدرسة.");
  if (!academicYearId) throw new Error("اختر السنة الدراسية.");

  const params = [schoolId, academicYearId];

  function addParam(value) {
    params.push(value);
    return `$${params.length}`;
  }

  const enrollmentWhere = [
    "se.school_id = $1",
    "se.academic_year_id = $2",
    "se.status = 'enrolled'",
  ];

  const stageId = toPositiveInt(q.stage_id);
  const gradeId = toPositiveInt(q.grade_id);
  const sectionId = toPositiveInt(q.section_id);
  const term = toPositiveInt(q.term);

  if (stageId) enrollmentWhere.push(`se.stage_id = ${addParam(stageId)}`);
  if (gradeId) enrollmentWhere.push(`se.grade_id = ${addParam(gradeId)}`);
  if (sectionId) enrollmentWhere.push(`se.section_id = ${addParam(sectionId)}`);

  const attendanceWhere = [
    "ats.school_id = $1",
    "ats.academic_year_id = $2",
  ];

  if (term === 1 || term === 2) {
    attendanceWhere.push(`ats.term = ${addParam(term)}`);
  }

  const finalWhere = ["1=1"];

  const search = toText(q.q);
  if (search) {
    const p = addParam(`%${search}%`);
    finalWhere.push(`
      (
        full_name ILIKE ${p}
        OR student_code ILIKE ${p}
        OR COALESCE(guardian_name, '') ILIKE ${p}
        OR COALESCE(guardian_phone, '') ILIKE ${p}
      )
    `);
  }

  const gender = toText(q.gender);
  if (gender) {
    finalWhere.push(`gender = ${addParam(gender)}`);
  }

  const studentStatus = toText(q.status);
  if (studentStatus) {
    finalWhere.push(`student_status = ${addParam(studentStatus)}`);
  }

  const feeStatus = toText(q.fee_status);
  if (feeStatus) {
    finalWhere.push(`fee_status = ${addParam(feeStatus)}`);
  }

  const hasGuardian = toText(q.has_guardian);
  if (hasGuardian === "yes") {
    finalWhere.push(`guardian_id IS NOT NULL`);
  } else if (hasGuardian === "no") {
    finalWhere.push(`guardian_id IS NULL`);
  }

  const missingPhone = toText(q.missing_phone);
  if (missingPhone === "yes") {
    finalWhere.push(`
      (
        student_phone IS NULL
        OR TRIM(student_phone) = ''
        OR guardian_phone IS NULL
        OR TRIM(guardian_phone) = ''
      )
    `);
  }

  const hasCertificates = toText(q.has_certificates);
  if (hasCertificates === "yes") {
    finalWhere.push(`certificates_count > 0`);
  } else if (hasCertificates === "no") {
    finalWhere.push(`certificates_count = 0`);
  }

  const attendanceFlag = toText(q.attendance_flag);
  if (attendanceFlag === "has_absence") {
    finalWhere.push(`absent_count > 0`);
  } else if (attendanceFlag === "high_absence") {
    finalWhere.push(`absent_count >= 3`);
  } else if (attendanceFlag === "has_late") {
    finalWhere.push(`late_count > 0`);
  }

  const cte = `
    WITH current_enrollment AS (
      SELECT DISTINCT ON (se.student_id)
        se.id AS enrollment_id,
        se.student_id,
        se.academic_year_id,
        se.stage_id,
        se.grade_id,
        se.section_id,
        se.roll_number,
        se.status AS enrollment_status,
        se.created_at AS enrollment_created_at,
        se.term AS enrollment_term,
        st.name AS stage_name,
        COALESCE(g.grade_name, g.name) AS grade_name,
        sec.name AS section_name
      FROM student_enrollments se
      LEFT JOIN stages st ON st.id = se.stage_id
      LEFT JOIN grades g ON g.id = se.grade_id
      LEFT JOIN sections sec ON sec.id = se.section_id
      WHERE ${enrollmentWhere.join("\n        AND ")}
      ORDER BY
        se.student_id,
        se.created_at DESC NULLS LAST,
        se.id DESC
    ),

    primary_guardian AS (
      SELECT DISTINCT ON (sg.student_id)
        sg.student_id,
        g.id AS guardian_id,
        g.full_name AS guardian_name,
        g.phone AS guardian_phone,
        g.email AS guardian_email,
        g.address AS guardian_address,
        sg.relation,
        sg.is_primary
      FROM student_guardians sg
      JOIN guardians g ON g.id = sg.guardian_id
      WHERE sg.school_id = $1
        AND g.school_id = $1
      ORDER BY
        sg.student_id,
        sg.is_primary DESC NULLS LAST,
        sg.guardian_id ASC
    ),

    active_contract AS (
      SELECT DISTINCT ON (fc.student_id)
        fc.id,
        fc.student_id,
        fc.academic_year_id,
        fc.annual_amount::numeric AS annual_amount,
        COALESCE(fc.discount_amount, 0)::numeric AS discount_amount,
        fc.installments_count,
        fc.status,
        fc.created_at,
        fc.updated_at
      FROM fee_contracts fc
      WHERE fc.school_id = $1
        AND fc.academic_year_id = $2
      ORDER BY
        fc.student_id,
        CASE WHEN fc.status = 'active' THEN 0 ELSE 1 END,
        fc.updated_at DESC NULLS LAST,
        fc.id DESC
    ),

    fee_summary AS (
      SELECT
        ac.student_id,
        ac.id AS contract_id,
        ac.status AS contract_status,
        ac.annual_amount,
        ac.discount_amount,
        GREATEST(ac.annual_amount - ac.discount_amount, 0)::numeric AS total_due,
        COALESCE(SUM(fi.amount), 0)::numeric AS installments_total,
        COALESCE(SUM(fi.paid_amount), 0)::numeric AS paid_amount,
        COUNT(fi.id)::integer AS installments_count,
        COUNT(*) FILTER (WHERE fi.status = 'unpaid')::integer AS unpaid_installments,
        MIN(fi.due_date) FILTER (WHERE fi.status = 'unpaid') AS next_due_date
      FROM active_contract ac
      LEFT JOIN fee_installments fi
        ON fi.school_id = $1
        AND (
          fi.contract_id = ac.id
          OR fi.fee_contract_id = ac.id
        )
      GROUP BY
        ac.student_id,
        ac.id,
        ac.status,
        ac.annual_amount,
        ac.discount_amount
    ),

    attendance_summary AS (
      SELECT
        ae.student_id,
        COUNT(*)::integer AS attendance_records,
        COUNT(*) FILTER (WHERE ae.status = 'present')::integer AS present_count,
        COUNT(*) FILTER (WHERE ae.status = 'absent')::integer AS absent_count,
        COUNT(*) FILTER (WHERE ae.status = 'late')::integer AS late_count,
        COALESCE(SUM(ae.late_minutes), 0)::integer AS late_minutes,
        MAX(ats.attendance_date) FILTER (WHERE ae.status = 'absent') AS last_absence_date,
        MAX(ats.attendance_date) AS last_attendance_date
      FROM attendance_entries ae
      JOIN attendance_sessions ats ON ats.id = ae.session_id
      WHERE ${attendanceWhere.join("\n        AND ")}
      GROUP BY ae.student_id
    ),

    certificate_summary AS (
      SELECT
        sc.student_id,
        COUNT(*) FILTER (WHERE sc.status <> 'canceled')::integer AS certificates_count,
        COUNT(*) FILTER (WHERE sc.certificate_type = 'monthly' AND sc.status <> 'canceled')::integer AS monthly_certificates_count,
        COUNT(*) FILTER (WHERE sc.certificate_type = 'midterm' AND sc.status <> 'canceled')::integer AS midterm_certificates_count,
        COUNT(*) FILTER (WHERE sc.certificate_type = 'final' AND sc.status <> 'canceled')::integer AS final_certificates_count,
        COUNT(*) FILTER (WHERE sc.status = 'printed')::integer AS printed_certificates_count,
        MAX(sc.created_at) FILTER (WHERE sc.status <> 'canceled') AS last_certificate_at
      FROM student_certificates sc
      WHERE sc.school_id = $1
        AND sc.academic_year_id = $2
      GROUP BY sc.student_id
    ),

    transfer_ranked AS (
      SELECT
        tr.*,
        ROW_NUMBER() OVER (
          PARTITION BY tr.student_id
          ORDER BY tr.created_at DESC, tr.id DESC
        ) AS rn
      FROM student_transfer_requests tr
      WHERE tr.school_id = $1
        AND tr.academic_year_id = $2
    ),

    transfer_summary AS (
      SELECT
        tr.student_id,
        COUNT(*)::integer AS transfer_requests_count,
        COUNT(*) FILTER (WHERE tr.status = 'approved')::integer AS approved_transfers_count,
        MAX(tr.created_at) AS last_transfer_at
      FROM student_transfer_requests tr
      WHERE tr.school_id = $1
        AND tr.academic_year_id = $2
      GROUP BY tr.student_id
    ),

    last_transfer AS (
      SELECT
        tr.student_id,
        tr.id AS last_transfer_id,
        tr.status AS last_transfer_status,
        tr.reason AS last_transfer_reason,
        tr.created_at AS last_transfer_created_at,
        tr.decided_at AS last_transfer_decided_at,
        fs.name AS from_stage_name,
        COALESCE(fg.grade_name, fg.name) AS from_grade_name,
        fsec.name AS from_section_name,
        ts.name AS to_stage_name,
        COALESCE(tg.grade_name, tg.name) AS to_grade_name,
        tsec.name AS to_section_name
      FROM transfer_ranked tr
      LEFT JOIN stages fs ON fs.id = tr.from_stage_id
      LEFT JOIN grades fg ON fg.id = tr.from_grade_id
      LEFT JOIN sections fsec ON fsec.id = tr.from_section_id
      LEFT JOIN stages ts ON ts.id = tr.to_stage_id
      LEFT JOIN grades tg ON tg.id = tr.to_grade_id
      LEFT JOIN sections tsec ON tsec.id = tr.to_section_id
      WHERE tr.rn = 1
    ),

    main_rows AS (
      SELECT
        s.id AS student_id,
        s.student_code,
        s.full_name,
        s.gender,
        s.birth_date,
        s.birth_place,
        s.phone AS student_phone,
        s.address AS student_address,
        s.admission_date,
        s.status AS student_status,
        s.created_at AS student_created_at,

        ce.enrollment_id,
        ce.academic_year_id,
        ce.stage_id,
        ce.grade_id,
        ce.section_id,
        ce.stage_name,
        ce.grade_name,
        ce.section_name,
        ce.roll_number,
        ce.enrollment_status,

        pg.guardian_id,
        pg.guardian_name,
        pg.guardian_phone,
        pg.guardian_email,
        pg.relation AS guardian_relation,
        pg.is_primary AS guardian_is_primary,

        fs.contract_id,
        fs.contract_status,
        COALESCE(fs.annual_amount, 0)::numeric AS annual_amount,
        COALESCE(fs.discount_amount, 0)::numeric AS discount_amount,
        COALESCE(fs.total_due, 0)::numeric AS total_due,
        COALESCE(fs.paid_amount, 0)::numeric AS paid_amount,
        GREATEST(COALESCE(fs.total_due, 0) - COALESCE(fs.paid_amount, 0), 0)::numeric AS remaining_amount,
        COALESCE(fs.installments_count, 0)::integer AS installments_count,
        COALESCE(fs.unpaid_installments, 0)::integer AS unpaid_installments,
        fs.next_due_date,

        CASE
          WHEN fs.contract_id IS NULL THEN 'no_contract'
          WHEN GREATEST(COALESCE(fs.total_due, 0) - COALESCE(fs.paid_amount, 0), 0) <= 0 THEN 'paid'
          ELSE 'due'
        END AS fee_status,

        COALESCE(att.attendance_records, 0)::integer AS attendance_records,
        COALESCE(att.present_count, 0)::integer AS present_count,
        COALESCE(att.absent_count, 0)::integer AS absent_count,
        COALESCE(att.late_count, 0)::integer AS late_count,
        COALESCE(att.late_minutes, 0)::integer AS late_minutes,
        att.last_absence_date,
        att.last_attendance_date,

        CASE
          WHEN COALESCE(att.attendance_records, 0) = 0 THEN NULL
          ELSE ROUND(
            (
              (COALESCE(att.present_count, 0) + COALESCE(att.late_count, 0))::numeric
              / NULLIF(att.attendance_records, 0)::numeric
            ) * 100,
            2
          )
        END AS attendance_rate,

        COALESCE(cs.certificates_count, 0)::integer AS certificates_count,
        COALESCE(cs.monthly_certificates_count, 0)::integer AS monthly_certificates_count,
        COALESCE(cs.midterm_certificates_count, 0)::integer AS midterm_certificates_count,
        COALESCE(cs.final_certificates_count, 0)::integer AS final_certificates_count,
        COALESCE(cs.printed_certificates_count, 0)::integer AS printed_certificates_count,
        cs.last_certificate_at,

        COALESCE(ts.transfer_requests_count, 0)::integer AS transfer_requests_count,
        COALESCE(ts.approved_transfers_count, 0)::integer AS approved_transfers_count,
        ts.last_transfer_at,
        lt.last_transfer_status,
        lt.last_transfer_reason,
        lt.from_stage_name,
        lt.from_grade_name,
        lt.from_section_name,
        lt.to_stage_name,
        lt.to_grade_name,
        lt.to_section_name,

        CASE WHEN pg.guardian_id IS NULL THEN true ELSE false END AS missing_guardian,
        CASE
          WHEN s.phone IS NULL OR TRIM(s.phone) = '' THEN true
          ELSE false
        END AS missing_student_phone,
        CASE
          WHEN pg.guardian_id IS NULL THEN true
          WHEN pg.guardian_phone IS NULL OR TRIM(pg.guardian_phone) = '' THEN true
          ELSE false
        END AS missing_guardian_phone,
        CASE WHEN fs.contract_id IS NULL THEN true ELSE false END AS missing_fee_contract

      FROM current_enrollment ce
      JOIN students s ON s.id = ce.student_id
      LEFT JOIN primary_guardian pg ON pg.student_id = s.id
      LEFT JOIN fee_summary fs ON fs.student_id = s.id
      LEFT JOIN attendance_summary att ON att.student_id = s.id
      LEFT JOIN certificate_summary cs ON cs.student_id = s.id
      LEFT JOIN transfer_summary ts ON ts.student_id = s.id
      LEFT JOIN last_transfer lt ON lt.student_id = s.id
      WHERE s.school_id = $1
    )
  `;

  const whereSql = finalWhere.join("\n    AND ");

  return {
    cte,
    whereSql,
    params,
  };
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

export const StudentReportsController = {
  async summary(req, res) {
    try {
      const { cte, whereSql, params } = buildStudentReportQuery(req);

      const { rows } = await pool.query(
        `
        ${cte}
        SELECT
          COUNT(*)::integer AS total_students,

          COUNT(*) FILTER (WHERE gender = 'ذكر')::integer AS male_count,
          COUNT(*) FILTER (WHERE gender = 'أنثى')::integer AS female_count,

          COUNT(*) FILTER (WHERE missing_guardian = true)::integer AS missing_guardian_count,
          COUNT(*) FILTER (WHERE missing_student_phone = true)::integer AS missing_student_phone_count,
          COUNT(*) FILTER (WHERE missing_guardian_phone = true)::integer AS missing_guardian_phone_count,

          COUNT(*) FILTER (WHERE fee_status = 'no_contract')::integer AS no_contract_count,
          COUNT(*) FILTER (WHERE fee_status = 'paid')::integer AS paid_fees_count,
          COUNT(*) FILTER (WHERE fee_status = 'due')::integer AS due_fees_count,

          COALESCE(SUM(total_due), 0)::numeric AS total_due_amount,
          COALESCE(SUM(paid_amount), 0)::numeric AS total_paid_amount,
          COALESCE(SUM(remaining_amount), 0)::numeric AS total_remaining_amount,

          COALESCE(SUM(present_count), 0)::integer AS total_present_count,
          COALESCE(SUM(absent_count), 0)::integer AS total_absent_count,
          COALESCE(SUM(late_count), 0)::integer AS total_late_count,

          COUNT(*) FILTER (WHERE absent_count > 0)::integer AS students_with_absence_count,
          COUNT(*) FILTER (WHERE absent_count >= 3)::integer AS high_absence_count,

          COALESCE(SUM(certificates_count), 0)::integer AS total_certificates_count,
          COUNT(*) FILTER (WHERE certificates_count > 0)::integer AS students_with_certificates_count,

          COALESCE(SUM(transfer_requests_count), 0)::integer AS total_transfer_requests_count,
          COUNT(*) FILTER (WHERE transfer_requests_count > 0)::integer AS students_with_transfers_count

        FROM main_rows
        WHERE ${whereSql}
        `,
        params
      );

      return res.json({
        success: true,
        data: rows[0] || {},
      });
    } catch (err) {
      console.error("student report summary error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "تعذر تحميل ملخص تقرير الطلاب",
      });
    }
  },

  async list(req, res) {
    try {
      const { cte, whereSql, params } = buildStudentReportQuery(req);

      const page = Math.max(Number(req.query.page || 1), 1);
      const limit = clampLimit(req.query.limit);
      const offset = (page - 1) * limit;

      const limitParam = `$${params.length + 1}`;
      const offsetParam = `$${params.length + 2}`;

      const queryParams = [...params, limit, offset];

      const { rows } = await pool.query(
        `
        ${cte}
        SELECT
          *,
          COUNT(*) OVER()::integer AS total_count
        FROM main_rows
        WHERE ${whereSql}
        ORDER BY
          roll_number NULLS LAST,
          full_name ASC,
          student_id ASC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
        `,
        queryParams
      );

      const total = rows[0]?.total_count || 0;

      return res.json({
        success: true,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        data: rows.map(({ total_count, ...row }) => row),
      });
    } catch (err) {
      console.error("student report list error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "تعذر تحميل تقرير الطلاب",
      });
    }
  },

  async profile(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = getSchoolId(req);
      const studentId = toPositiveInt(req.params.studentId);
      const academicYearId = toPositiveInt(req.query.academic_year_id);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة.",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "رقم الطالب غير صالح.",
        });
      }

      if (!academicYearId) {
        return res.status(400).json({
          success: false,
          message: "اختر السنة الدراسية.",
        });
      }

      const { rows: studentRows } = await client.query(
        `
        SELECT
          s.*,
          se.id AS enrollment_id,
          se.academic_year_id,
          se.stage_id,
          se.grade_id,
          se.section_id,
          se.roll_number,
          se.status AS enrollment_status,
          st.name AS stage_name,
          COALESCE(g.grade_name, g.name) AS grade_name,
          sec.name AS section_name
        FROM students s
        LEFT JOIN LATERAL (
          SELECT *
          FROM student_enrollments se
          WHERE se.student_id = s.id
            AND se.school_id = $1
            AND se.academic_year_id = $3
          ORDER BY se.created_at DESC NULLS LAST, se.id DESC
          LIMIT 1
        ) se ON true
        LEFT JOIN stages st ON st.id = se.stage_id
        LEFT JOIN grades g ON g.id = se.grade_id
        LEFT JOIN sections sec ON sec.id = se.section_id
        WHERE s.school_id = $1
          AND s.id = $2
        LIMIT 1
        `,
        [schoolId, studentId, academicYearId]
      );

      if (!studentRows[0]) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود.",
        });
      }

      const { rows: guardians } = await client.query(
        `
        SELECT
          g.id,
          g.full_name,
          g.gender,
          g.phone,
          g.email,
          g.address,
          sg.relation,
          sg.is_primary
        FROM student_guardians sg
        JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.school_id = $1
          AND sg.student_id = $2
        ORDER BY sg.is_primary DESC NULLS LAST, g.full_name ASC
        `,
        [schoolId, studentId]
      );

      const { rows: feeRows } = await client.query(
        `
        SELECT
          fc.id AS contract_id,
          fc.status AS contract_status,
          fc.annual_amount::numeric,
          COALESCE(fc.discount_amount, 0)::numeric AS discount_amount,
          GREATEST(fc.annual_amount::numeric - COALESCE(fc.discount_amount, 0)::numeric, 0)::numeric AS total_due,
          COALESCE(SUM(fi.paid_amount), 0)::numeric AS paid_amount,
          GREATEST(
            GREATEST(fc.annual_amount::numeric - COALESCE(fc.discount_amount, 0)::numeric, 0)
            - COALESCE(SUM(fi.paid_amount), 0),
            0
          )::numeric AS remaining_amount,
          COUNT(fi.id)::integer AS installments_count,
          COUNT(*) FILTER (WHERE fi.status = 'unpaid')::integer AS unpaid_installments
        FROM fee_contracts fc
        LEFT JOIN fee_installments fi
          ON fi.school_id = $1
          AND (
            fi.contract_id = fc.id
            OR fi.fee_contract_id = fc.id
          )
        WHERE fc.school_id = $1
          AND fc.student_id = $2
          AND fc.academic_year_id = $3
        GROUP BY fc.id
        ORDER BY fc.updated_at DESC NULLS LAST, fc.id DESC
        LIMIT 1
        `,
        [schoolId, studentId, academicYearId]
      );

      const { rows: attendanceRows } = await client.query(
        `
        SELECT
          COUNT(*)::integer AS attendance_records,
          COUNT(*) FILTER (WHERE ae.status = 'present')::integer AS present_count,
          COUNT(*) FILTER (WHERE ae.status = 'absent')::integer AS absent_count,
          COUNT(*) FILTER (WHERE ae.status = 'late')::integer AS late_count,
          COALESCE(SUM(ae.late_minutes), 0)::integer AS late_minutes,
          MAX(ats.attendance_date) FILTER (WHERE ae.status = 'absent') AS last_absence_date,
          MAX(ats.attendance_date) AS last_attendance_date
        FROM attendance_entries ae
        JOIN attendance_sessions ats ON ats.id = ae.session_id
        WHERE ats.school_id = $1
          AND ats.academic_year_id = $3
          AND ae.student_id = $2
        `,
        [schoolId, studentId, academicYearId]
      );

      const { rows: certificates } = await client.query(
        `
        SELECT
          id,
          certificate_type,
          title,
          status,
          term,
          month,
          created_at AS issued_at,
          printed_at
        FROM student_certificates
        WHERE school_id = $1
          AND academic_year_id = $3
          AND student_id = $2
          AND status <> 'canceled'
        ORDER BY created_at DESC, id DESC
        `,
        [schoolId, studentId, academicYearId]
      );

      const { rows: transfers } = await client.query(
        `
        SELECT
          tr.id,
          tr.status,
          tr.reason,
          tr.admin_note,
          tr.created_at,
          tr.decided_at,
          fs.name AS from_stage_name,
          COALESCE(fg.grade_name, fg.name) AS from_grade_name,
          fsec.name AS from_section_name,
          ts.name AS to_stage_name,
          COALESCE(tg.grade_name, tg.name) AS to_grade_name,
          tsec.name AS to_section_name
        FROM student_transfer_requests tr
        LEFT JOIN stages fs ON fs.id = tr.from_stage_id
        LEFT JOIN grades fg ON fg.id = tr.from_grade_id
        LEFT JOIN sections fsec ON fsec.id = tr.from_section_id
        LEFT JOIN stages ts ON ts.id = tr.to_stage_id
        LEFT JOIN grades tg ON tg.id = tr.to_grade_id
        LEFT JOIN sections tsec ON tsec.id = tr.to_section_id
        WHERE tr.school_id = $1
          AND tr.student_id = $2
          AND tr.academic_year_id = $3
        ORDER BY tr.created_at DESC, tr.id DESC
        `,
        [schoolId, studentId, academicYearId]
      );

      return res.json({
        success: true,
        data: {
          student: studentRows[0],
          guardians,
          fees: feeRows[0] || null,
          attendance: attendanceRows[0] || null,
          certificates,
          transfers,
        },
      });
    } catch (err) {
      console.error("student report profile error:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "تعذر تحميل ملف تقرير الطالب",
      });
    } finally {
      client.release();
    }
  },
};

export default StudentReportsController;