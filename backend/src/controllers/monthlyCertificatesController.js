import { pool } from "../config/db.js";

function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parsePositiveInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${fieldName} غير صحيح.`);
  }
  return n;
}

function parseTerm(value) {
  const n = Number(value);
  if (![1, 2].includes(n)) {
    throw badRequest("الفصل الدراسي غير صحيح.");
  }
  return n;
}

function parseMonth(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw badRequest("الشهر غير صحيح.");
  }
  return n;
}

function parseStudentIds(value) {
  const arr = Array.isArray(value) ? value : [];
  const ids = arr
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);

  const unique = Array.from(new Set(ids));

  if (!unique.length) {
    throw badRequest("اختر طالبًا واحدًا على الأقل.");
  }

  return unique;
}

export async function listEligibleStudents(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const academicYearId = parsePositiveInt(req.query.academic_year_id, "السنة الدراسية");
    const term = parseTerm(req.query.term);
    const month = parseMonth(req.query.month);
    const stageId = parsePositiveInt(req.query.stage_id, "المرحلة");
    const gradeId = parsePositiveInt(req.query.grade_id, "الصف");
    const sectionId = parsePositiveInt(req.query.section_id, "الشعبة");

    const { rows } = await pool.query(
      `
      SELECT
        se.student_id,
        s.full_name,
        s.student_code,
        se.roll_number,
        cert.id AS certificate_id,
        cert.issued_at,
        cert.printed_at
      FROM student_enrollments se
      JOIN students s
        ON s.id = se.student_id
       AND s.school_id = se.school_id
      LEFT JOIN student_monthly_certificates cert
        ON cert.school_id = se.school_id
       AND cert.academic_year_id = se.academic_year_id
       AND cert.term = se.term
       AND cert.month = $7
       AND cert.student_id = se.student_id
      WHERE se.school_id = $1
        AND se.academic_year_id = $2
        AND se.term = $3
        AND se.stage_id = $4
        AND se.grade_id = $5
        AND se.section_id = $6
        AND COALESCE(se.status, 'enrolled') = 'enrolled'
      ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
      `,
      [schoolId, academicYearId, term, stageId, gradeId, sectionId, month]
    );

    return res.json({
      items: rows.map((row) => ({
        student_id: row.student_id,
        full_name: row.full_name,
        student_code: row.student_code,
        roll_number: row.roll_number,
        certificate_id: row.certificate_id,
        already_issued: !!row.certificate_id,
        issued_at: row.issued_at || null,
        printed_at: row.printed_at || null,
      })),
    });
  } catch (e) {
    console.error("listEligibleStudents error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function createMonthlyCertificates(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const academicYearId = parsePositiveInt(req.body.academic_year_id, "السنة الدراسية");
    const term = parseTerm(req.body.term);
    const month = parseMonth(req.body.month);
    const stageId = parsePositiveInt(req.body.stage_id, "المرحلة");
    const gradeId = parsePositiveInt(req.body.grade_id, "الصف");
    const sectionId = parsePositiveInt(req.body.section_id, "الشعبة");
    const studentIds = parseStudentIds(req.body.student_ids);

    await client.query("BEGIN");

    const eligibleQ = await client.query(
      `
      SELECT se.student_id
      FROM student_enrollments se
      JOIN students s
        ON s.id = se.student_id
       AND s.school_id = se.school_id
      WHERE se.school_id = $1
        AND se.academic_year_id = $2
        AND se.term = $3
        AND se.stage_id = $4
        AND se.grade_id = $5
        AND se.section_id = $6
        AND COALESCE(se.status, 'enrolled') = 'enrolled'
        AND se.student_id = ANY($7::bigint[])
      `,
      [schoolId, academicYearId, term, stageId, gradeId, sectionId, studentIds]
    );

    const eligibleIds = new Set(eligibleQ.rows.map((r) => Number(r.student_id)));

    for (const id of studentIds) {
      if (!eligibleIds.has(id)) {
        throw badRequest(`الطالب رقم ${id} ليس ضمن الشعبة المحددة أو لا يتبع لهذه المدرسة.`);
      }
    }

    const insertQ = await client.query(
      `
      INSERT INTO student_monthly_certificates
        (school_id, academic_year_id, term, month, student_id, issued_by, issued_at, created_at, updated_at)
      SELECT
        $1,
        $2,
        $3,
        $4,
        x.student_id,
        $5,
        NOW(),
        NOW(),
        NOW()
      FROM unnest($6::bigint[]) AS x(student_id)
      ON CONFLICT (school_id, academic_year_id, term, month, student_id)
      DO NOTHING
      RETURNING id, student_id, issued_at
      `,
      [schoolId, academicYearId, term, month, userId, studentIds]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "تم حفظ الشهادات الشهرية بنجاح.",
      created_count: insertQ.rows.length,
      skipped_count: studentIds.length - insertQ.rows.length,
      items: insertQ.rows,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("createMonthlyCertificates error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  } finally {
    client.release();
  }
}

export async function listMonthlyCertificates(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const academicYearId = parsePositiveInt(req.query.academic_year_id, "السنة الدراسية");
    const term = parseTerm(req.query.term);
    const month = parseMonth(req.query.month);

    const stageId = req.query.stage_id ? Number(req.query.stage_id) : null;
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : null;
    const sectionId = req.query.section_id ? Number(req.query.section_id) : null;

    const { rows } = await pool.query(
      `
      SELECT
        cert.id,
        cert.academic_year_id,
        cert.term,
        cert.month,
        cert.student_id,
        cert.issued_at,
        cert.printed_at,
        s.full_name,
        s.student_code,
        se.roll_number,
        st.name AS stage_name,
        COALESCE(g.grade_name, g.name) AS grade_name,
        sec.name AS section_name
      FROM student_monthly_certificates cert
      JOIN students s
        ON s.id = cert.student_id
       AND s.school_id = cert.school_id
      LEFT JOIN student_enrollments se
        ON se.student_id = cert.student_id
       AND se.school_id = cert.school_id
       AND se.academic_year_id = cert.academic_year_id
       AND se.term = cert.term
      LEFT JOIN stages st ON st.id = se.stage_id
      LEFT JOIN grades g ON g.id = se.grade_id
      LEFT JOIN sections sec ON sec.id = se.section_id
      WHERE cert.school_id = $1
        AND cert.academic_year_id = $2
        AND cert.term = $3
        AND cert.month = $4
        AND ($5::bigint IS NULL OR se.stage_id = $5)
        AND ($6::bigint IS NULL OR se.grade_id = $6)
        AND ($7::bigint IS NULL OR se.section_id = $7)
      ORDER BY COALESCE(se.roll_number, 999999), s.full_name ASC
      `,
      [schoolId, academicYearId, term, month, stageId, gradeId, sectionId]
    );

    return res.json({ items: rows });
  } catch (e) {
    console.error("listMonthlyCertificates error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function markCertificatePrinted(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const id = parsePositiveInt(req.params.id, "معرف الشهادة");

    const { rows } = await pool.query(
      `
      UPDATE student_monthly_certificates
      SET printed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      RETURNING id, printed_at
      `,
      [id, schoolId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "الشهادة غير موجودة." });
    }

    return res.json({
      message: "تم تحديث حالة الطباعة.",
      item: rows[0],
    });
  } catch (e) {
    console.error("markCertificatePrinted error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}

export async function deleteMonthlyCertificate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const id = parsePositiveInt(req.params.id, "معرف الشهادة");

    const { rowCount } = await pool.query(
      `
      DELETE FROM student_monthly_certificates
      WHERE id = $1
        AND school_id = $2
      `,
      [id, schoolId]
    );

    if (!rowCount) {
      return res.status(404).json({ message: "الشهادة غير موجودة." });
    }

    return res.status(204).send();
  } catch (e) {
    console.error("deleteMonthlyCertificate error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}export async function getMonthlyCertificatesMeta(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const userId = pickUserId(req);

    if (!schoolId || !userId) {
      return res.status(401).json({ message: "غير مصرح." });
    }

    const { rows } = await pool.query(
      `
      SELECT
        to_jsonb(s) AS school,
        to_jsonb(ss) AS settings
      FROM schools s
      LEFT JOIN school_settings ss
        ON ss.school_id = s.id
      WHERE s.id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    return res.json({
      school: rows[0]?.school || {},
      settings: rows[0]?.settings || {},
    });
  } catch (e) {
    console.error("getMonthlyCertificatesMeta error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في السيرفر",
    });
  }
}