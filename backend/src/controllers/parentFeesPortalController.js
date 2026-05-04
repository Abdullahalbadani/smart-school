import { pool } from "../config/db.js";
import { genReceiptNumber } from "../utils/receipt.js";

// ===================== Helpers =====================
function buildAttachmentUrl(req, path) {
  if (!path) return null;
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/${path}`;
}

async function getActiveYear(schoolId) {
  const { rows } = await pool.query(
    `SELECT id, name
     FROM academic_years
     WHERE is_active = true AND school_id = $1
     ORDER BY start_date DESC
     LIMIT 1`,
    [schoolId]
  );
  return rows[0] || null;
}

async function getGuardianIdByUser(userId, schoolId) {
  const { rows } = await pool.query(
    `SELECT id FROM guardians WHERE user_id=$1 AND school_id=$2 LIMIT 1`,
    [userId, schoolId]
  );
  return rows[0]?.id || null;
}

async function assertGuardianOwnsStudent(guardianId, studentId, schoolId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM student_guardians
     WHERE guardian_id=$1 AND student_id=$2 AND school_id=$3
     LIMIT 1`,
    [guardianId, studentId, schoolId]
  );
  return !!rows.length;
}

async function getAdminUserIds(schoolId) {
  // ✅ الطريقة الأساسية: users.role_id + roles (مع حماية المدرسة)
  try {
    const { rows } = await pool.query(`
      SELECT u.id
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE LOWER(r.name) IN ('admin','administrator')
        AND COALESCE(u.status,'active')='active'
        AND u.school_id = $1
    `, [schoolId]);

    const ids = (rows || []).map(r => Number(r.id)).filter(Boolean);
    if (ids.length) return ids;
  } catch (e) {
    console.warn("getAdminUserIds(role_id) failed:", e.message);
  }

  // ✅ fallback: username=admin (مع حماية المدرسة)
  try {
    const { rows } = await pool.query(`
      SELECT id
      FROM users
      WHERE LOWER(COALESCE(username,''))='admin'
        AND COALESCE(status,'active')='active'
        AND school_id = $1
    `, [schoolId]);
    return (rows || []).map(r => Number(r.id)).filter(Boolean);
  } catch (e) {
    console.warn("getAdminUserIds(username) failed:", e.message);
  }

  return [];
}

// ===================== Controllers =====================

export async function parentFeesOverview(req, res) {
  const userId = req.user?.id;
  const schoolId = req.user?.school_id;
  if (!userId || !schoolId) return res.status(401).json({ message: "Unauthorized" });

  const studentId = parseInt(req.query.studentId || "0", 10);
  if (!studentId) return res.status(400).json({ message: "studentId required" });

  const guardianId = await getGuardianIdByUser(userId, schoolId);
  if (!guardianId) return res.status(403).json({ message: "Not a guardian account" });

  const ok = await assertGuardianOwnsStudent(guardianId, studentId, schoolId);
  if (!ok) return res.status(403).json({ message: "Not allowed for this student" });

  const year = await getActiveYear(schoolId);
  if (!year) return res.status(404).json({ message: "No active academic year" });

  // ✅ جلب إعدادات المدرسة للعملة والبادئات
  const settingsRes = await pool.query(
    `SELECT ss.invoice_prefix, ss.student_code_prefix, s.currency 
     FROM school_settings ss 
     JOIN schools s ON s.id = ss.school_id 
     WHERE ss.school_id = $1`,
    [schoolId]
  );
  const invPrefix = settingsRes.rows[0]?.invoice_prefix || "";
  const stdPrefix = settingsRes.rows[0]?.student_code_prefix || "";
  const currency = settingsRes.rows[0]?.currency || "YER";

  const st = await pool.query(
    `SELECT id, full_name, student_code
     FROM students
     WHERE id=$1 AND school_id=$2 LIMIT 1`,
    [studentId, schoolId]
  );
  if (!st.rows.length) return res.status(404).json({ message: "Student not found" });

  const cRes = await pool.query(
    `SELECT id, annual_amount AS "annualAmount", installments_count AS "installmentsCount"
     FROM fee_contracts
     WHERE student_id=$1 AND academic_year_id=$2 AND school_id=$3
     LIMIT 1`,
    [studentId, year.id, schoolId]
  );

  const contract = cRes.rows[0] || null;

  if (!contract) {
    return res.json({
      year,
      student: { id: studentId, name: st.rows[0].full_name, studentCode: `${stdPrefix}${st.rows[0].student_code}` },
      contract: null,
      summary: { totalAnnual: 0, paidConfirmed: 0, pendingTotal: 0, remaining: 0, credit: 0, nextDueDate: null, currency },
      installments: [],
      payments: []
    });
  }

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
    receiptNo: p.receiptNo ? (p.receiptNo.startsWith("PR-") ? p.receiptNo : `${invPrefix}${p.receiptNo}`) : null,
    currency: currency,
    attachmentUrl: buildAttachmentUrl(req, p.attachmentPath)
  }));

  const paidConfirmed = payments.filter(p => p.status === "confirmed").reduce((s,p)=>s + Number(p.amount||0), 0);
  const pendingTotal  = payments.filter(p => p.status === "pending").reduce((s,p)=>s + Number(p.amount||0), 0);

  const totalAnnual = Number(contract.annualAmount || 0);
  const remaining = Math.max(0, totalAnnual - paidConfirmed);
  const credit = Math.max(0, paidConfirmed - totalAnnual);

  const next = installments.find(x => x.status === "unpaid" || x.status === "partial");
  const nextDueDate = next ? next.dueDate : null;

  return res.json({
    year,
    student: { id: studentId, name: st.rows[0].full_name, studentCode: `${stdPrefix}${st.rows[0].student_code}` },
    contract,
    summary: { totalAnnual, paidConfirmed, pendingTotal, remaining, credit, nextDueDate, currency },
    installments,
    payments
  });
}

export async function parentPaymentRequest(req, res) {
  const userId = req.user?.id;
  const schoolId = req.user?.school_id;
  if (!userId || !schoolId) return res.status(401).json({ message: "Unauthorized" });

  const studentId = parseInt(req.body?.studentId || "0", 10);
  const amount = Number(req.body?.amount);
  const method = req.body?.method;
  const provider = req.body?.provider || null;
  const reference = req.body?.reference || null;
  const note = req.body?.note || null;

  if (!studentId) return res.status(400).json({ message: "studentId required" });
  if (!amount || amount <= 0) return res.status(400).json({ message: "amount invalid" });
  if (!method) return res.status(400).json({ message: "method required" });

  const guardianId = await getGuardianIdByUser(userId, schoolId);
  if (!guardianId) return res.status(403).json({ message: "Not a guardian account" });

  const ok = await assertGuardianOwnsStudent(guardianId, studentId, schoolId);
  if (!ok) return res.status(403).json({ message: "Not allowed for this student" });

  const year = await getActiveYear(schoolId);
  if (!year) return res.status(404).json({ message: "No active academic year" });

  // جلب العقد وحساب إجمالي المبالغ لفحص سقف الدفع
  const cRes = await pool.query(
    `SELECT id, annual_amount AS "annualAmount" 
     FROM fee_contracts 
     WHERE student_id=$1 AND academic_year_id=$2 AND school_id=$3 LIMIT 1`,
    [studentId, year.id, schoolId]
  );
  
  const contract = cRes.rows[0];
  if (!contract) return res.status(404).json({ message: "No fee contract for this student in active year" });
  
  const contractId = contract.id;
  const totalAnnual = Number(contract.annualAmount || 0);

  // جلب إجمالي المدفوعات التي هي إما "مؤكدة" أو "قيد المراجعة"
  const payRes = await pool.query(
    `SELECT SUM(amount) AS total_paid
     FROM fee_payments
     WHERE contract_id=$1 AND school_id=$2 AND status IN ('confirmed', 'pending')`,
    [contractId, schoolId]
  );
  
  const totalPaidAndPending = Number(payRes.rows[0]?.total_paid || 0);
  const remainingBalance = Math.max(0, totalAnnual - totalPaidAndPending);

  // منع ولي الأمر من دفع مبلغ يتجاوز المتبقي
  if (amount > remainingBalance) {
    return res.status(400).json({ 
      message: `المبلغ المطلوب دفعه (${amount.toLocaleString()}) يتجاوز الرسوم المتبقية (${remainingBalance.toLocaleString()}).` 
    });
  }

  if (!contractId) return res.status(404).json({ message: "No fee contract for this student in active year" });

  const attachment = req.file || null;
  const attachmentPath = attachment ? attachment.path : null;
  const attachmentMime = attachment ? attachment.mimetype : null;

  const status = "pending"; // ✅ ولي الأمر: دائمًا Pending

  let receiptNo = "PR-" + genReceiptNumber();
  let inserted = null;

  for (let i = 0; i < 5; i++) {
    try {
      const ins = await pool.query(
        `INSERT INTO fee_payments
          (school_id, contract_id, student_id, amount, method, provider, reference, note,
           attachment_path, attachment_mime, status, receipt_number, paid_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         RETURNING id, receipt_number AS "receiptNo", paid_at AS "paidAt"`,
        [schoolId, contractId, studentId, amount, method, provider, reference, note, attachmentPath, attachmentMime, status, receiptNo]
      );
      inserted = ins.rows[0];
      break;
    } catch (e) {
      if (e.code === "23505") {
        receiptNo = "PR-" + genReceiptNumber();
        continue;
      }
      throw e;
    }
  }

  if (!inserted) return res.status(500).json({ message: "Failed to create payment request" });

  // ✅ إشعار مالي للأدمن
  try {
    const adminIds = await getAdminUserIds(schoolId);

    if (adminIds.length) {
      const st = await pool.query(`SELECT full_name FROM students WHERE id=$1 AND school_id=$2 LIMIT 1`, [studentId, schoolId]);
      const studentName = st.rows[0]?.full_name || `طالب #${studentId}`;

      const title = "حوالة رسوم جديدة (ولي أمر)";
      const body =
        `${studentName} — مبلغ: ${amount.toLocaleString("en-US")} — طريقة: ${method}` +
        `${provider ? " — الجهة: " + provider : ""}` +
        `${reference ? " — المرجع: " + reference : ""}` +
        ` — إيصال: ${inserted.receiptNo} (قيد المراجعة)`;

      const meta = {
        studentId,
        contractId,
        paymentId: inserted.id,
        amount,
        method,
        provider,
        reference,
        receiptNo: inserted.receiptNo,
        status: "pending",
      };

      const nRes = await pool.query(
        `
        INSERT INTO notifications
          (school_id, sender_user_id, sender_display_name, title, body, source, category, priority, related_type, related_id, meta)
        VALUES
          ($1, $2, (SELECT name FROM users WHERE id=$2), $3, $4, 'system', 'finance', 'important', 'fee_payment', $5, $6)
        RETURNING id, created_at
        `,
        [schoolId, userId, title, body, inserted.id, JSON.stringify(meta)]
      );

      const notifId = nRes.rows[0].id;

      const params = [notifId];
      const values = adminIds.map((uid, i) => {
        params.push(uid);
        return `($1, $${i + 2}, false)`;
      });

      await pool.query(
        `
        INSERT INTO notification_recipients (notification_id, recipient_user_id, is_read)
        VALUES ${values.join(",")}
        `,
        params
      );

      const io = req.app.get("io");
      if (io) {
        for (const uid of adminIds) {
          io.to(`user_${uid}`).emit("notification:new", {
            id: notifId,
            title,
            body,
            category: "finance",
            source: "system",
            created_at: nRes.rows[0].created_at,
            meta,
          });
        }
      }
    }
  } catch (e) {
    console.warn("finance notification failed:", e.message);
  }

  return res.status(201).json({
    id: inserted.id,
    receiptNo: inserted.receiptNo,
    status,
    paidAt: inserted.paidAt
  });
}