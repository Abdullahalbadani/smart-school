// src/services/fees/ensureFeeContract.js

export async function ensureFeeContractForEnrollmentTx(client, {
  studentId,
  academicYearId,
  stageId,
  gradeId,
  sectionId,
  schoolId, // ✅ أضفنا schoolId هنا ليكون متاحاً للدالة
}) {
  // 1) التأكد من وجود العقد مسبقاً (مع فلترة المدرسة)
  const exists = await client.query(
    `SELECT id FROM fee_contracts WHERE student_id=$1 AND academic_year_id=$2 AND school_id=$3 LIMIT 1`,
    [studentId, academicYearId, schoolId]
  );
  if (exists.rowCount) {
    return { contractId: exists.rows[0].id, created: false };
  }

  // 2) اختيار قاعدة الرسوم المناسبة (مع فلترة المدرسة)
  const ruleRes = await client.query(
    `
    SELECT r.*
    FROM fee_rules r
    WHERE r.academic_year_id = $1
      AND r.school_id = $6         -- ✅ فلترة حسب المدرسة
      AND r.is_active = true
      AND (
        (r.scope='STUDENT' AND r.student_id = $2) OR
        (r.scope='SECTION' AND r.section_id = $3) OR
        (r.scope='GRADE'   AND r.grade_id   = $4) OR
        (r.scope='STAGE'   AND r.stage_id   = $5) OR
        (r.scope='DEFAULT')
      )
    ORDER BY CASE r.scope
      WHEN 'STUDENT' THEN 1
      WHEN 'SECTION' THEN 2
      WHEN 'GRADE'   THEN 3
      WHEN 'STAGE'   THEN 4
      WHEN 'DEFAULT' THEN 5
    END
    LIMIT 1
    `,
    [academicYearId, studentId, sectionId, gradeId, stageId, schoolId]
  );

  const rule = ruleRes.rows[0];
  if (!rule) {
    const err = new Error("NO_FEE_RULE");
    err.status = 400;
    err.userMessage = "لا توجد إعدادات رسوم لهذه السنة. أضف قاعدة DEFAULT أولاً من إعدادات الرسوم.";
    throw err;
  }

  // 3) إنشاء عقد الرسوم (مع إضافة school_id)
  const cRes = await client.query(
    `
    INSERT INTO fee_contracts (school_id, student_id, academic_year_id, annual_amount, installments_count, first_due_date)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id, annual_amount, installments_count, first_due_date
    `,
    [schoolId, studentId, academicYearId, rule.annual_amount, rule.installments_count, rule.first_due_date]
  );
  const contract = cRes.rows[0];

  // 4) إنشاء الأقساط تلقائياً (مع إضافة school_id)
  await client.query(
    `
    INSERT INTO fee_installments (school_id, contract_id, installment_no, due_date, amount, paid_amount, status)
    SELECT
      $1::bigint AS school_id,      -- ✅ إدراج رقم المدرسة لكل قسط
      $2::bigint AS contract_id,
      gs.i AS installment_no,
      ($3::date + (gs.i - 1) * ($6::int * INTERVAL '1 month'))::date AS due_date,
      (
        ($4::bigint / NULLIF($5::int,0))
        + CASE WHEN gs.i = $5::int THEN ($4::bigint % NULLIF($5::int,0)) ELSE 0 END
      )::bigint AS amount,
      0 AS paid_amount,
      'unpaid' AS status
    FROM generate_series(1, $5::int) AS gs(i)
    `,
    [schoolId, contract.id, contract.first_due_date, contract.annual_amount, contract.installments_count, rule.interval_months || 1]
  );

  return { contractId: contract.id, created: true };
}