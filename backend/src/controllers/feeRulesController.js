// src/controllers/feeRulesController.js
import { pool } from "../config/db.js";

// ✅ إضافة schoolId لجلب السنة الدراسية الخاصة بالمدرسة فقط
async function getActiveYearId(client, schoolId) {
  const r = await client.query(
    `SELECT id FROM academic_years 
     WHERE is_active=true AND school_id=$1 
     ORDER BY start_date DESC NULLS LAST, id DESC LIMIT 1`,
    [schoolId]
  );
  return r.rows[0]?.id || null;
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asBigInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeScope(s) {
  const x = String(s || "").trim().toUpperCase();
  const allowed = new Set(["DEFAULT", "STAGE", "GRADE", "SECTION", "STUDENT"]);
  return allowed.has(x) ? x : null;
}

// GET /api/admin/fee-rules?academic_year_id=
export async function listFeeRules(req, res) {
  const schoolId = req.user?.school_id; // ✅ Multi-tenant
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const client = await pool.connect();
  try {
    const yearId = req.query.academic_year_id ? asInt(req.query.academic_year_id) : await getActiveYearId(client, schoolId);
    if (!yearId) return res.status(400).json({ message: "لا توجد سنة دراسية نشطة لهذه المدرسة." });

    const q = `
      SELECT
        r.*,
        stg.name AS stage_name,
        gr.name AS grade_name,
        sc.name AS section_name,
        s.full_name AS student_name,
        s.student_code AS student_code
      FROM fee_rules r
      LEFT JOIN stages stg ON stg.id = r.stage_id
      LEFT JOIN grades gr ON gr.id = r.grade_id
      LEFT JOIN sections sc ON sc.id = r.section_id
      LEFT JOIN students s ON s.id = r.student_id AND s.school_id = r.school_id
      WHERE r.academic_year_id = $1 AND r.school_id = $2 -- ✅ فلترة المدرسة
      ORDER BY
        CASE r.scope
          WHEN 'STUDENT' THEN 1
          WHEN 'SECTION' THEN 2
          WHEN 'GRADE' THEN 3
          WHEN 'STAGE' THEN 4
          WHEN 'DEFAULT' THEN 5
          ELSE 9
        END,
        r.id DESC
    `;
    const r = await client.query(q, [yearId, schoolId]);
    return res.json({ academic_year_id: yearId, data: r.rows || [] });
  } catch (e) {
    console.error("listFeeRules error:", e);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}

// POST /api/admin/fee-rules
export async function createFeeRule(req, res) {
  const schoolId = req.user?.school_id; // ✅ Multi-tenant
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const client = await pool.connect();
  try {
    const scope = normalizeScope(req.body?.scope);
    const academicYearId = asInt(req.body?.academic_year_id);
    const annualAmount = asBigInt(req.body?.annual_amount);
    const installmentsCount = asInt(req.body?.installments_count);
    const firstDueDate = req.body?.first_due_date || null;
    const intervalMonths = asInt(req.body?.interval_months) || 1;

    if (!scope) return res.status(400).json({ message: "scope غير صحيح" });
    if (!academicYearId) return res.status(400).json({ message: "academic_year_id مطلوب" });
    if (!annualAmount || annualAmount <= 0) return res.status(400).json({ message: "annual_amount غير صحيح" });
    if (!installmentsCount || installmentsCount < 1) return res.status(400).json({ message: "installments_count غير صحيح" });
    if (!firstDueDate) return res.status(400).json({ message: "first_due_date مطلوب" });
    if (!intervalMonths || intervalMonths < 1) return res.status(400).json({ message: "interval_months غير صحيح" });

    const stageId = asInt(req.body?.stage_id);
    const gradeId = asInt(req.body?.grade_id);
    const sectionId = asInt(req.body?.section_id);
    const studentId = asInt(req.body?.student_id);

    if (scope === "STAGE" && !stageId) return res.status(400).json({ message: "stage_id مطلوب" });
    if (scope === "GRADE" && !gradeId) return res.status(400).json({ message: "grade_id مطلوب" });
    if (scope === "SECTION" && !sectionId) return res.status(400).json({ message: "section_id مطلوب" });
    if (scope === "STUDENT" && !studentId) return res.status(400).json({ message: "student_id مطلوب" });

    const ins = await client.query(
      `
      INSERT INTO fee_rules
        (school_id, academic_year_id, scope, stage_id, grade_id, section_id, student_id,
         annual_amount, installments_count, first_due_date, interval_months,
         reason_code, notes, is_active)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
      `,
      [
        schoolId, // ✅ إدخال هوية المدرسة
        academicYearId,
        scope,
        scope === "STAGE" ? stageId : null,
        scope === "GRADE" ? gradeId : null,
        scope === "SECTION" ? sectionId : null,
        scope === "STUDENT" ? studentId : null,
        annualAmount,
        installmentsCount,
        firstDueDate,
        intervalMonths,
        req.body?.reason_code || null,
        req.body?.notes || null,
        req.body?.is_active === false ? false : true,
      ]
    );

    return res.status(201).json(ins.rows[0]);
  } catch (e) {
    if (String(e.code) === "23505") {
      return res.status(409).json({ message: "توجد قاعدة مماثلة لنفس الهدف في هذه السنة في مدرستك." });
    }
    console.error("createFeeRule error:", e);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}

// PUT /api/admin/fee-rules/:id
export async function updateFeeRule(req, res) {
  const schoolId = req.user?.school_id; // ✅ Multi-tenant
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const id = asInt(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const client = await pool.connect();
  try {
    const scope = normalizeScope(req.body?.scope);
    const academicYearId = asInt(req.body?.academic_year_id);
    const annualAmount = asBigInt(req.body?.annual_amount);
    const installmentsCount = asInt(req.body?.installments_count);
    const firstDueDate = req.body?.first_due_date || null;
    const intervalMonths = asInt(req.body?.interval_months) || 1;

    if (!scope || !academicYearId || !annualAmount || annualAmount <= 0) {
        return res.status(400).json({ message: "بيانات غير مكتملة" });
    }

    const stageId = asInt(req.body?.stage_id);
    const gradeId = asInt(req.body?.grade_id);
    const sectionId = asInt(req.body?.section_id);
    const studentId = asInt(req.body?.student_id);

    const upd = await client.query(
      `
      UPDATE fee_rules SET
        academic_year_id=$1,
        scope=$2,
        stage_id=$3,
        grade_id=$4,
        section_id=$5,
        student_id=$6,
        annual_amount=$7,
        installments_count=$8,
        first_due_date=$9,
        interval_months=$10,
        reason_code=$11,
        notes=$12,
        is_active=$13,
        updated_at=NOW()
      WHERE id=$14 AND school_id=$15 -- ✅ حماية التعديل
      RETURNING *
      `,
      [
        academicYearId,
        scope,
        scope === "STAGE" ? stageId : null,
        scope === "GRADE" ? gradeId : null,
        scope === "SECTION" ? sectionId : null,
        scope === "STUDENT" ? studentId : null,
        annualAmount,
        installmentsCount,
        firstDueDate,
        intervalMonths,
        req.body?.reason_code || null,
        req.body?.notes || null,
        req.body?.is_active === false ? false : true,
        id,
        schoolId
      ]
    );

    if (upd.rowCount === 0) return res.status(404).json({ message: "Rule not found or unauthorized" });
    return res.json(upd.rows[0]);
  } catch (e) {
    if (String(e.code) === "23505") {
      return res.status(409).json({ message: "توجد قاعدة مماثلة لنفس الهدف في هذه السنة." });
    }
    console.error("updateFeeRule error:", e);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
}

// DELETE /api/admin/fee-rules/:id
export async function deleteFeeRule(req, res) {
  const schoolId = req.user?.school_id; // ✅ Multi-tenant
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const id = asInt(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  try {
    const del = await pool.query(`DELETE FROM fee_rules WHERE id=$1 AND school_id=$2 RETURNING id`, [id, schoolId]);
    if (!del.rowCount) return res.status(404).json({ message: "Rule not found or unauthorized" });
    return res.json({ message: "Deleted", id: del.rows[0].id });
  } catch (e) {
    console.error("deleteFeeRule error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

// GET /api/admin/fee-rules/students
export async function listStudentsFeesView(req, res) {
  const schoolId = req.user?.school_id; // ✅ Multi-tenant
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const offset = (page - 1) * limit;

    const academicYearId = asInt(req.query.academic_year_id);
    if (!academicYearId) return res.status(400).json({ message: "academic_year_id مطلوب" });

    const stageId = req.query.stage_id ? asInt(req.query.stage_id) : null;
    const gradeId = req.query.grade_id ? asInt(req.query.grade_id) : null;
    const sectionId = req.query.section_id ? asInt(req.query.section_id) : null;

    const q = String(req.query.q || "").trim();
    const qLike = q ? `%${q}%` : "";

    const hasException = String(req.query.has_exception || "").toLowerCase();
    const missingContract = String(req.query.missing_contract || "").toLowerCase();

    // ✅ تحديث جملة WHERE لتشمل المدرسة بشكل صريح كمتغير رقم 8
    const where = `
      WHERE se.academic_year_id = $1 
        AND se.school_id = $8 -- ✅ مدرسة الطالب (المتغير الثامن)
        AND ($2::int IS NULL OR se.stage_id = $2)
        AND ($3::int IS NULL OR se.grade_id = $3)
        AND ($4::int IS NULL OR se.section_id = $4)
        AND ($5::text = '' OR (s.full_name ILIKE $5 OR s.student_code ILIKE $5))
    `;

    // 💡 ترتيب الـ parameters: [Year, Stage, Grade, Section, Search, HasExc, MissCont, SchoolID, Limit, Offset]
    const baseParams = [academicYearId, stageId, gradeId, sectionId, qLike, hasException, missingContract, schoolId];

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM student_enrollments se
      JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
      LEFT JOIN fee_contracts fc ON fc.student_id = se.student_id AND fc.academic_year_id = se.academic_year_id AND fc.school_id = se.school_id
      LEFT JOIN fee_rules sr ON sr.academic_year_id = se.academic_year_id
        AND sr.scope='STUDENT' AND sr.student_id = se.student_id AND sr.is_active=true AND sr.school_id = se.school_id
      ${where}
      AND ($6::text = '' OR ($6='true' AND sr.id IS NOT NULL) OR ($6='false' AND sr.id IS NULL))
      AND ($7::text = '' OR ($7='true' AND fc.id IS NULL) OR ($7='false' AND fc.id IS NOT NULL))
    `;

    const totalRes = await pool.query(countSql, baseParams);
    const total = totalRes.rows?.[0]?.total ?? 0;

    const dataSql = `
      SELECT
        s.id AS student_id,
        s.student_code,
        s.full_name,
        se.stage_id, stg.name AS stage_name,
        se.grade_id, gr.name AS grade_name,
        se.section_id, sc.name AS section_name,
        (fc.id IS NOT NULL) AS has_contract,
        fc.id AS contract_id,
        (sr.id IS NOT NULL) AS has_student_exception,
        picked.scope AS applied_scope,
        picked.annual_amount,
        picked.installments_count,
        picked.first_due_date,
        picked.interval_months,
        picked.reason_code
      FROM student_enrollments se
      JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
      LEFT JOIN stages stg ON stg.id = se.stage_id
      LEFT JOIN grades gr ON gr.id = se.grade_id
      LEFT JOIN sections sc ON sc.id = se.section_id
      LEFT JOIN fee_contracts fc ON fc.student_id = se.student_id AND fc.academic_year_id = se.academic_year_id AND fc.school_id = se.school_id
      LEFT JOIN fee_rules sr ON sr.academic_year_id = se.academic_year_id
        AND sr.scope='STUDENT' AND sr.student_id = se.student_id AND sr.is_active=true AND sr.school_id = se.school_id

      LEFT JOIN LATERAL (
        SELECT r.*
        FROM fee_rules r
        WHERE r.academic_year_id = se.academic_year_id
          AND r.school_id = se.school_id -- ✅ قاعدة المدرسة فقط
          AND r.is_active = true
          AND (
            (r.scope='STUDENT' AND r.student_id = se.student_id) OR
            (r.scope='SECTION' AND r.section_id = se.section_id) OR
            (r.scope='GRADE'   AND r.grade_id   = se.grade_id) OR
            (r.scope='STAGE'   AND r.stage_id   = se.stage_id) OR
            (r.scope='DEFAULT')
          )
        ORDER BY CASE r.scope
          WHEN 'STUDENT' THEN 1
          WHEN 'SECTION' THEN 2
          WHEN 'GRADE' THEN 3
          WHEN 'STAGE' THEN 4
          WHEN 'DEFAULT' THEN 5
        END
        LIMIT 1
      ) picked ON TRUE

      ${where}
      AND ($6::text = '' OR ($6='true' AND sr.id IS NOT NULL) OR ($6='false' AND sr.id IS NULL))
      AND ($7::text = '' OR ($7='true' AND fc.id IS NULL) OR ($7='false' AND fc.id IS NOT NULL))

      ORDER BY s.full_name ASC
      LIMIT $9 OFFSET $10
    `;

    // $9 = limit, $10 = offset
    const dataRes = await pool.query(dataSql, [...baseParams, limit, offset]);

    return res.json({
      page, limit, total, pages: Math.ceil(total / limit),
      data: dataRes.rows || [],
    });
  } catch (e) {
    console.error("listStudentsFeesView error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}