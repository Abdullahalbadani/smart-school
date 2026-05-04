// src/controllers/studentFeesPortalController.js
import { pool } from "../config/db.js";

function buildAttachmentUrl(req, path) {
  if (!path) return null;
  const base = `${req.protocol}://${req.get("host")}`;
  return path.startsWith("uploads/") ? `${base}/${path}` : `${base}/${path}`;
}

// ✅ تعديل: جلب السنة الدراسية النشطة التابعة للمدرسة فقط
async function getActiveYear(schoolId) {
  const { rows } = await pool.query(
    `SELECT id, name FROM academic_years 
     WHERE is_active = true AND school_id = $1 
     ORDER BY start_date DESC LIMIT 1`,
    [schoolId]
  );
  return rows[0] || null;
}

export async function studentFeesOverview(req, res) {
  const userId = req.user?.id;
  const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة

  if (!userId || !schoolId) return res.status(401).json({ message: "Unauthorized" });

  // جلب إعدادات المدرسة (العملة وبادئة كود الطالب)
  const settingsRes = await pool.query(
    `SELECT ss.student_code_prefix, s.currency 
     FROM school_settings ss 
     JOIN schools s ON s.id = ss.school_id 
     WHERE ss.school_id = $1`,
    [schoolId]
  );
  const stdPrefix = settingsRes.rows[0]?.student_code_prefix || "";
  const currency = settingsRes.rows[0]?.currency || "YER";

  const year = await getActiveYear(schoolId);
  
  if (!year) {
    return res.json({
      year: { name: "لا توجد سنة نشطة" },
      student: { name: "—", studentCode: "—" },
      contract: null,
      summary: { totalAnnual: 0, paidConfirmed: 0, pendingTotal: 0, remaining: 0, credit: 0, nextDueDate: null, currency },
      installments: [],
      payments: []
    });
  }

  // البحث عن الطالب المرتبط بهذا الحساب مع التأكد من المدرسة ✅
  const st = await pool.query(
    `SELECT id, full_name, student_code FROM students WHERE user_id=$1 AND school_id=$2 LIMIT 1`, 
    [userId, schoolId]
  );
  
  if (!st.rows.length) {
    return res.json({
      year,
      student: { name: "غير مربوط بطالب", studentCode: "—" },
      contract: null,
      summary: { totalAnnual: 0, paidConfirmed: 0, pendingTotal: 0, remaining: 0, credit: 0, nextDueDate: null, currency },
      installments: [],
      payments: []
    });
  }

  const studentId = st.rows[0].id;
  const studentFullName = st.rows[0].full_name;
  const studentCodeFormatted = `${stdPrefix}${st.rows[0].student_code}`;

  // البحث عن عقد الرسوم التابع للمدرسة ✅
  const cRes = await pool.query(
    `SELECT id, annual_amount AS "annualAmount", installments_count AS "installmentsCount"
     FROM fee_contracts
     WHERE student_id=$1 AND academic_year_id=$2 AND school_id=$3
     ORDER BY id DESC
     LIMIT 1`,
    [studentId, year.id, schoolId]
  );
  const contract = cRes.rows[0] || null;

  if (!contract) {
    return res.json({
      year,
      student: { id: studentId, name: studentFullName, studentCode: studentCodeFormatted },
      contract: null,
      summary: { totalAnnual: 0, paidConfirmed: 0, pendingTotal: 0, remaining: 0, credit: 0, nextDueDate: null, currency },
      installments: [],
      payments: []
    });
  }

  // جلب الأقساط والدفعات مع حماية school_id ✅
  const [instRes, payRes] = await Promise.all([
    pool.query(
      `SELECT installment_no AS "installmentNo", due_date AS "dueDate", amount, paid_amount AS "paidAmount", status
       FROM fee_installments
       WHERE contract_id=$1 AND school_id=$2
       ORDER BY installment_no ASC`,
      [contract.id, schoolId]
    ),
    pool.query(
      `SELECT paid_at AS "paidAt", amount, method, provider, reference, status, receipt_number AS "receiptNo",
              attachment_path AS "attachmentPath"
       FROM fee_payments
       WHERE contract_id=$1 AND school_id=$2
       ORDER BY paid_at DESC
       LIMIT 200`,
      [contract.id, schoolId]
    )
  ]);

  const installments = instRes.rows || [];
  const payments = (payRes.rows || []).map(p => ({
    ...p,
    currency: currency,
    attachmentUrl: buildAttachmentUrl(req, p.attachmentPath)
  }));

  const paidConfirmed = payments.filter(p => p.status === "confirmed").reduce((s,p)=>s + Number(p.amount||0), 0);
  const pendingTotal = payments.filter(p => p.status === "pending").reduce((s,p)=>s + Number(p.amount||0), 0);

  const totalAnnual = Number(contract.annualAmount || 0);
  const remaining = Math.max(0, totalAnnual - paidConfirmed);
  const credit = Math.max(0, paidConfirmed - totalAnnual);

  const next = installments.find(x => x.status === "unpaid" || x.status === "partial");
  const nextDueDate = next ? next.dueDate : null;

  return res.json({
    year,
    student: { id: studentId, name: studentFullName, studentCode: studentCodeFormatted },
    contract,
    summary: { totalAnnual, paidConfirmed, pendingTotal, remaining, credit, nextDueDate, currency },
    installments,
    payments
  });
}