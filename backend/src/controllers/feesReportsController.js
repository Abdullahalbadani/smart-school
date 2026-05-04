// داخل feesController.js (أسفل الملف مثلاً)
import { pool } from "../config/db.js";

export async function reportCollections(req, res) {
  try {
    // ✅ حماية وعزل: جلب معرف المدرسة
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const yearId = parseInt(req.query.yearId || "0", 10);
    const gradeId = parseInt(req.query.gradeId || "0", 10);
    const classId = parseInt(req.query.classId || "0", 10);
    const from = req.query.from || null;
    const to = req.query.to || null;
    const method = req.query.method || null;

    if (!yearId) return res.status(400).json({ message: "yearId required" });

    // ✅ جلب الإعدادات المالية والأكواد للمدرسة
    const settingsRes = await pool.query(
      `SELECT ss.invoice_prefix, ss.student_code_prefix, s.currency 
       FROM school_settings ss 
       JOIN schools s ON s.id = ss.school_id 
       WHERE ss.school_id = $1`,
      [schoolId]
    );
    const settings = settingsRes.rows[0] || {};
    const invPrefix = settings.invoice_prefix || "";
    const stdPrefix = settings.student_code_prefix || "";
    const currency = settings.currency || "YER";

    const params = [];
    const where = [];

    // ✅ فلترة المدرسة أولاً لضمان العزل التام
    params.push(schoolId);
    where.push(`p.school_id = $${params.length}`);
    where.push(`c.school_id = $${params.length}`);
    where.push(`s.school_id = $${params.length}`);

    // year filter via contract
    params.push(yearId);
    const pYear = `$${params.length}`;

    where.push(`p.status = 'confirmed'`);
    where.push(`c.academic_year_id = ${pYear}`);

    if (from) { params.push(from); where.push(`p.paid_at::date >= $${params.length}`); }
    if (to) { params.push(to); where.push(`p.paid_at::date <= $${params.length}`); }
    if (method) { params.push(method); where.push(`p.method = $${params.length}`); }

    if (gradeId) { params.push(gradeId); where.push(`se.grade_id = $${params.length}`); }
    if (classId) { params.push(classId); where.push(`se.section_id = $${params.length}`); }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    // 1) rows
    const rowsSql = `
      SELECT
        p.paid_at AS "paidAt",
        p.amount,
        p.method,
        p.provider,
        p.reference,
        p.receipt_number AS "receiptNo",

        s.full_name AS "studentName",
        s.student_code AS "studentCode",
        gr.name AS "gradeName",
        sc.name AS "className"
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = p.contract_id
      JOIN students s ON s.id = p.student_id

      LEFT JOIN student_enrollments se
        ON se.student_id = s.id
       AND se.academic_year_id = c.academic_year_id
       AND se.status = 'enrolled'

      LEFT JOIN grades gr ON gr.id = se.grade_id
      LEFT JOIN sections sc ON sc.id = se.section_id

      ${whereSql}
      ORDER BY p.paid_at DESC
      LIMIT 500
    `;
    const rowsRes = await pool.query(rowsSql, params);
    let rows = rowsRes.rows || [];

    // ✅ تطبيق بوادئ الأكواد والفواتير والعملة على النتائج
    rows = rows.map(r => ({
      ...r,
      receiptNo: r.receiptNo ? `${invPrefix}${r.receiptNo}` : null,
      studentCode: r.studentCode ? `${stdPrefix}${r.studentCode}` : null,
      currency: currency
    }));

    // 2) breakdown by method
    const byMethodSql = `
      SELECT p.method, COUNT(*)::int AS count, COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = p.contract_id
      JOIN students s ON s.id = p.student_id
      LEFT JOIN student_enrollments se
        ON se.student_id = s.id
       AND se.academic_year_id = c.academic_year_id
       AND se.status='enrolled'
      ${whereSql}
      GROUP BY p.method
      ORDER BY total DESC
    `;
    const byMethod = (await pool.query(byMethodSql, params)).rows || [];

    // 3) top grades
    const byGradeSql = `
      SELECT COALESCE(gr.name,'—') AS "gradeName", COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = p.contract_id
      JOIN students s ON s.id = p.student_id
      LEFT JOIN student_enrollments se
        ON se.student_id=s.id AND se.academic_year_id=c.academic_year_id AND se.status='enrolled'
      LEFT JOIN grades gr ON gr.id=se.grade_id
      LEFT JOIN sections sc ON sc.id=se.section_id
      ${whereSql}
      GROUP BY gr.name
      ORDER BY total DESC
      LIMIT 5
    `;
    const byGrade = (await pool.query(byGradeSql, params)).rows || [];

    // 4) top sections
    const bySectionSql = `
      SELECT COALESCE(sc.name,'—') AS "className", COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = p.contract_id
      JOIN students s ON s.id = p.student_id
      LEFT JOIN student_enrollments se
        ON se.student_id=s.id AND se.academic_year_id=c.academic_year_id AND se.status='enrolled'
      LEFT JOIN grades gr ON gr.id=se.grade_id
      LEFT JOIN sections sc ON sc.id=se.section_id
      ${whereSql}
      GROUP BY sc.name
      ORDER BY total DESC
      LIMIT 5
    `;
    const bySection = (await pool.query(bySectionSql, params)).rows || [];

    const totalCollected = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const paymentsCount = rows.length;

    const topMethod = byMethod[0]?.method ? `أكثر طريقة: ${byMethod[0].method}` : "—";
    const rangeHint = (from || to) ? `الفترة: ${from || "—"} → ${to || "—"}` : "كل الفترات";

    return res.json({
      kpis: {
        totalCollected,
        paymentsCount,
        totalOutstanding: 0,
        studentsOutstanding: 0,
        hint1: topMethod,
        hint2: rangeHint,
        hint3: "Confirmed فقط",
        hint4: "—",
        currency: currency // إرسال العملة للواجهة
      },
      breakdowns: { byMethod, byGrade, bySection },
      rows,
    });
  } catch (e) {
    console.error("reportCollections Error:", e);
    return res.status(500).json({ message: "حدث خطأ داخلي" });
  }
}

export async function reportOutstanding(req, res) {
  try {
    // ✅ حماية وعزل: جلب معرف المدرسة
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const yearId = parseInt(req.query.yearId || "0", 10);
    const gradeId = parseInt(req.query.gradeId || "0", 10);
    const classId = parseInt(req.query.classId || "0", 10);

    if (!yearId) return res.status(400).json({ message: "yearId required" });

    // ✅ جلب الإعدادات المالية للمدرسة
    const settingsRes = await pool.query(
      `SELECT ss.student_code_prefix, s.currency 
       FROM school_settings ss 
       JOIN schools s ON s.id = ss.school_id 
       WHERE ss.school_id = $1`,
      [schoolId]
    );
    const stdPrefix = settingsRes.rows[0]?.student_code_prefix || "";
    const currency = settingsRes.rows[0]?.currency || "YER";

    // إعداد البارامترات: 1 = schoolId, 2 = yearId
    const params = [schoolId, yearId];
    const extra = [];

    if (gradeId) { params.push(gradeId); extra.push(`se.grade_id = $${params.length}`); }
    if (classId) { params.push(classId); extra.push(`se.section_id = $${params.length}`); }

    const extraWhere = extra.length ? `AND ${extra.join(" AND ")}` : "";

    // per-student rows (detailed)
    const rowsSql = `
      SELECT
      s.id AS "studentId",
        s.full_name AS "studentName",
        s.student_code AS "studentCode",
        gr.name AS "gradeName",
        sc.name AS "className",
        
        c.annual_amount AS "annualAmount",
        COALESCE(SUM(p.amount) FILTER (WHERE p.status='confirmed'), 0)::bigint AS "paidTotal",
        GREATEST(c.annual_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status='confirmed'), 0), 0)::bigint AS "remaining",

        (
          SELECT MIN(fi.due_date)
          FROM fee_installments fi
          WHERE fi.contract_id = c.id AND fi.status IN ('unpaid','partial')
        ) AS "nextDueDate"
      FROM fee_contracts c
      JOIN students s ON s.id = c.student_id
      LEFT JOIN fee_payments p ON p.contract_id = c.id

      LEFT JOIN student_enrollments se
        ON se.student_id = s.id
       AND se.academic_year_id = c.academic_year_id
       AND se.status = 'enrolled'

      LEFT JOIN grades gr ON gr.id = se.grade_id
      LEFT JOIN sections sc ON sc.id = se.section_id

      WHERE c.school_id = $1 
        AND c.academic_year_id = $2
        AND c.status = 'active'
        ${extraWhere}

      GROUP BY c.id, s.id, gr.name, sc.name
      HAVING GREATEST(c.annual_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status='confirmed'), 0), 0) > 0
      ORDER BY "remaining" DESC, "studentName" ASC
      LIMIT 500
    `;
    const rowsRes = await pool.query(rowsSql, params);
    let rows = rowsRes.rows || [];

    // ✅ تطبيق بادئة كود الطالب والعملة
    rows = rows.map(r => ({
      ...r,
      studentCode: r.studentCode ? `${stdPrefix}${r.studentCode}` : null,
      currency: currency
    }));

    // breakdown by grade
    const byGradeSql = `
      WITH per AS (${rowsSql})
      SELECT
        COALESCE("gradeName",'—') AS "gradeName",
        COUNT(*)::int AS "studentsCount",
        COALESCE(SUM("remaining"),0)::bigint AS "totalOutstanding"
      FROM per
      GROUP BY "gradeName"
      ORDER BY "totalOutstanding" DESC
      LIMIT 10
    `;
    const byGrade = (await pool.query(byGradeSql, params)).rows || [];

    // breakdown by section
    const bySectionSql = `
      WITH per AS (${rowsSql})
      SELECT
        COALESCE("className",'—') AS "className",
        COUNT(*)::int AS "studentsCount",
        COALESCE(SUM("remaining"),0)::bigint AS "totalOutstanding"
      FROM per
      GROUP BY "className"
      ORDER BY "totalOutstanding" DESC
      LIMIT 10
    `;
    const bySection = (await pool.query(bySectionSql, params)).rows || [];

    const topStudents = rows.slice(0, 10).map(r => ({
      studentName: r.studentName,
      remaining: r.remaining
    }));

    const totalOutstanding = rows.reduce((s, r) => s + Number(r.remaining || 0), 0);
    const studentsOutstanding = rows.length;

    return res.json({
      kpis: {
        totalCollected: 0,
        paymentsCount: 0,
        totalOutstanding,
        studentsOutstanding,
        hint1: "Confirmed فقط",
        hint2: "—",
        hint3: "متأخرات = إجمالي سنوي - مدفوع",
        hint4: `عدد الطلاب: ${studentsOutstanding}`,
        currency: currency // إرسال العملة للواجهة
      },
      breakdowns: { byGrade, bySection, topStudents },
      rows,
    });
  } catch (e) {
    console.error("reportOutstanding Error:", e);
    return res.status(500).json({ message: "حدث خطأ داخلي" });
  }
}