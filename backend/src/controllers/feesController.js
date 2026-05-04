// src/controllers/feesController.js
import { pool } from "../config/db.js";
import { generateInstallments, computeInstallmentStatus } from "../utils/feesInstallments.js";
import { genReceiptNumber } from "../utils/receipt.js";

async function hasTable(db, name) {
  const { rows } = await db.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return !!rows[0]?.t;
}

async function hasColumn(db, table, column) {
  const { rows } = await db.query(
    `
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
    `,
    [table, column]
  );
  return rows.length > 0;
}

async function getAdminUserIds(db, schoolId) {
  // 1) users.role_id + roles
  if ((await hasColumn(db, "users", "role_id")) && (await hasTable(db, "roles"))) {
    const { rows } = await db.query(`
      SELECT u.id
      FROM users u
      JOIN roles r ON r.id=u.role_id
      WHERE LOWER(r.name) IN ('admin','administrator')
        AND COALESCE(u.status,'active')='active'
        AND u.school_id = $1 -- ✅ فلترة المدرسة
    `, [schoolId]);
    return rows.map(r => Number(r.id)).filter(Boolean);
  }

  // 2) user_roles / users_roles / user_role_assignments
  for (const linkTable of ["user_roles", "users_roles", "user_role_assignments"]) {
    if ((await hasTable(db, linkTable)) && (await hasTable(db, "roles"))) {
      const { rows } = await db.query(`
        SELECT DISTINCT u.id
        FROM ${linkTable} ur
        JOIN roles r ON r.id=ur.role_id
        JOIN users u ON u.id=ur.user_id
        WHERE LOWER(r.name) IN ('admin','administrator')
          AND COALESCE(u.status,'active')='active'
          AND u.school_id = $1 -- ✅ فلترة المدرسة
      `, [schoolId]);
      return rows.map(r => Number(r.id)).filter(Boolean);
    }
  }

  // 3) fallback columns
  for (const col of ["role", "user_type", "type"]) {
    if (await hasColumn(db, "users", col)) {
      const { rows } = await db.query(`
        SELECT id
        FROM users
        WHERE LOWER(${col}) IN ('admin','administrator')
          AND COALESCE(status,'active')='active'
          AND school_id = $1 -- ✅ فلترة المدرسة
      `, [schoolId]);
      return rows.map(r => Number(r.id)).filter(Boolean);
    }
  }

  // 4) fallback username=admin
  if (await hasColumn(db, "users", "username")) {
    const { rows } = await db.query(`
      SELECT id FROM users
      WHERE LOWER(username)='admin'
        AND COALESCE(status,'active')='active'
        AND school_id = $1 -- ✅ فلترة المدرسة
    `, [schoolId]);
    return rows.map(r => Number(r.id)).filter(Boolean);
  }

  return [];
}

async function notifyFinanceAdmins({ db, io, senderUserId, studentId, contractId, paymentId, amount, method, schoolId }) {
  const adminIds = await getAdminUserIds(db, schoolId);
  if (!adminIds.length) return;

  const st = await db.query(`SELECT full_name FROM students WHERE id=$1 AND school_id=$2 LIMIT 1`, [studentId, schoolId]);
  const studentName = st.rows[0]?.full_name || `طالب #${studentId}`;

  const title = "حوالة رسوم جديدة";
  const body = `${studentName} — ${amount} — ${method} (قيد المراجعة)`;

  // ✅ أنشئ الإشعار مع ربطه بالمدرسة
  const nRes = await db.query(
    `
    INSERT INTO notifications
      (school_id, sender_user_id, sender_display_name, title, body, source, category, priority, related_type, related_id, meta)
    VALUES
      ($1, $2, (SELECT name FROM users WHERE id=$2), $3, $4, 'system', 'finance', 'important', 'fee_payment', $5, $6)
    RETURNING id, created_at
    `,
    [
      schoolId,
      senderUserId,
      title,
      body,
      paymentId,
      JSON.stringify({ studentId, contractId, paymentId, method, amount })
    ]
  );

  const notifId = nRes.rows[0].id;

  // ✅ recipients
  const params = [notifId];
  const values = adminIds.map((uid, i) => {
    params.push(uid);
    return `($1, $${i + 2}, false)`;
  });

  await db.query(
    `INSERT INTO notification_recipients (notification_id, recipient_user_id, is_read)
     VALUES ${values.join(",")}`,
    params
  );

  // ✅ Socket (اختياري)
  if (io) {
    for (const uid of adminIds) {
      io.to(`user_${uid}`).emit("notification:new", {
        id: notifId,
        title,
        body,
        category: "finance",
        source: "system",
        created_at: nRes.rows[0].created_at,
        meta: { studentId, contractId, paymentId }
      });
    }
  }
}

export async function getContract(req, res) {
  const schoolId = req.user?.school_id;
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const studentId = parseInt(req.query.studentId || "0", 10);
  const yearId = parseInt(req.query.yearId || "0", 10);
  if (!studentId || !yearId) return res.status(400).json({ message: "studentId/yearId required" });

  const q = `
    SELECT
      id,
      student_id AS "studentId",
      academic_year_id AS "yearId",
      annual_amount AS "annualAmount",
      installments_count AS "installmentsCount",
      first_due_date AS "firstDueDate",
      status
    FROM fee_contracts
    WHERE student_id = $1 AND academic_year_id = $2 AND school_id = $3
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [studentId, yearId, schoolId]);
  if (!rows.length) return res.status(404).json(null);
  return res.json(rows[0]);
}

export async function createContract(req, res) {
  const schoolId = req.user?.school_id;
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const studentId = parseInt(req.body?.studentId || "0", 10);
  const yearId = parseInt(req.body?.yearId || "0", 10);
  const annualAmount = Number(req.body?.annualAmount);
  // ✅ استقبال الخصم والسبب
  const discountAmount = Number(req.body?.discountAmount || 0); 
  const discountReason = req.body?.discountReason || null;      
  const installmentsCount = parseInt(req.body?.installmentsCount || "0", 10);
  const firstDueDate = req.body?.firstDueDate;

  if (!studentId || !yearId) return res.status(400).json({ message: "studentId/yearId required" });
  if (!annualAmount || annualAmount <= 0) return res.status(400).json({ message: "annualAmount invalid" });
  if (!installmentsCount || installmentsCount <= 0) return res.status(400).json({ message: "installmentsCount invalid" });
  if (!firstDueDate) return res.status(400).json({ message: "firstDueDate required" });

  // 💡 حساب الصافي المطلوب سداده
  const netAmount = annualAmount - discountAmount;
  if (netAmount < 0) return res.status(400).json({ message: "الخصم لا يمكن أن يكون أكبر من الرسوم!" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ex = await client.query(
      `SELECT id FROM fee_contracts WHERE student_id=$1 AND academic_year_id=$2 AND school_id=$3 LIMIT 1`,
      [studentId, yearId, schoolId]
    );
    if (ex.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Contract already exists for this student/year." });
    }

    // ✅ تحديث كود الإدخال ليحفظ الخصم و school_id
    const ins = await client.query(
      `INSERT INTO fee_contracts (school_id, student_id, academic_year_id, annual_amount, discount_amount, discount_reason, installments_count, first_due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
       RETURNING
         id,
         student_id AS "studentId",
         academic_year_id AS "yearId",
         annual_amount AS "annualAmount",
         discount_amount AS "discountAmount",
         discount_reason AS "discountReason",
         installments_count AS "installmentsCount",
         first_due_date AS "firstDueDate",
         status`,
      [schoolId, studentId, yearId, annualAmount, discountAmount, discountReason, installmentsCount, firstDueDate]
    );

    const contract = ins.rows[0];

    // 💡 الأهم: تمرير (الصافي) وليس الإجمالي ليتوزع على الأقساط
    const items = generateInstallments({
      annualAmount: netAmount, 
      count: installmentsCount,
      firstDueDate,
    });

    const values = [];
    const placeholders = items
      .map((it, i) => {
        const base = i * 7;
        // ✅ إضافة school_id للأقساط
        values.push(schoolId, contract.id, it.installmentNo, it.dueDate, it.amount, 0, "unpaid");
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      })
      .join(",");

    await client.query(
      `INSERT INTO fee_installments (school_id, contract_id, installment_no, due_date, amount, paid_amount, status)
       VALUES ${placeholders}`,
      values
    );

    await client.query("COMMIT");
    return res.status(201).json(contract);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ message: "createContract failed", error: e.message });
  } finally {
    client.release();
  }
}

export async function updateContract(req, res) {
  const schoolId = req.user?.school_id;
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const contractId = parseInt(req.params.id, 10);
  const annualAmount = Number(req.body?.annualAmount);
  // ✅ استقبال الخصم والسبب
  const discountAmount = Number(req.body?.discountAmount || 0); 
  const discountReason = req.body?.discountReason || null;  
  const installmentsCount = parseInt(req.body?.installmentsCount || "0", 10);
  const firstDueDate = req.body?.firstDueDate;

  if (!contractId || !annualAmount || !installmentsCount || !firstDueDate) {
    return res.status(400).json({ message: "بيانات العقد غير مكتملة." });
  }

  // 💡 حساب الصافي المطلوب سداده
  const netAmount = annualAmount - discountAmount;
  if (netAmount < 0) return res.status(400).json({ message: "الخصم لا يمكن أن يكون أكبر من الرسوم!" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT SUM(paid_amount) as total_paid FROM fee_installments WHERE contract_id = $1 AND school_id = $2`,
      [contractId, schoolId]
    );
    
    if (check.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Contract not found" });
    }

    if (Number(check.rows[0]?.total_paid || 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "لا يمكن تعديل العقد بالكامل لوجود مبالغ مدفوعة مسبقاً." });
    }

    await client.query(`DELETE FROM fee_installments WHERE contract_id = $1 AND school_id = $2`, [contractId, schoolId]);

    // ✅ تحديث العقد لحفظ قيم الخصم الجديدة
    await client.query(
      `UPDATE fee_contracts 
       SET annual_amount=$1, discount_amount=$2, discount_reason=$3, installments_count=$4, first_due_date=$5 
       WHERE id=$6 AND school_id=$7`,
      [annualAmount, discountAmount, discountReason, installmentsCount, firstDueDate, contractId, schoolId]
    );

    // 💡 الأهم: تمرير (الصافي) لدالة الأقساط
    const items = generateInstallments({ annualAmount: netAmount, count: installmentsCount, firstDueDate });
    
    const values = [];
    const placeholders = items.map((it, i) => {
      const base = i * 7;
      values.push(schoolId, contractId, it.installmentNo, it.dueDate, it.amount, 0, "unpaid");
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
    }).join(",");

    await client.query(
      `INSERT INTO fee_installments (school_id, contract_id, installment_no, due_date, amount, paid_amount, status) VALUES ${placeholders}`,
      values
    );

    await client.query("COMMIT");
    return res.json({ message: "تم تحديث العقد والأقساط بنجاح." });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "فشل تعديل العقد", error: e.message });
  } finally {
    client.release();
  }
}

export async function getInstallments(req, res) {
  const schoolId = req.user?.school_id;
  const contractId = parseInt(req.query.contractId || "0", 10);
  if (!contractId) return res.status(400).json({ message: "contractId required" });

  const { rows } = await pool.query(
    `SELECT
        id,
        contract_id AS "contractId",
        installment_no AS "installmentNo",
        due_date AS "dueDate",
        amount,
        paid_amount AS "paidAmount",
        status
      FROM fee_installments
      WHERE contract_id = $1 AND school_id = $2
      ORDER BY installment_no ASC`,
    [contractId, schoolId]
  );

  return res.json(rows);
}

export async function getPayments(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const contractId = parseInt(req.query.contractId || "0", 10);
    if (!contractId) return res.status(400).json({ message: "contractId required" });

    // ✅ جلب إعدادات المدرسة
    const settingsRes = await pool.query(
      `SELECT ss.invoice_prefix, s.currency 
       FROM school_settings ss 
       JOIN schools s ON s.id = ss.school_id 
       WHERE ss.school_id = $1`,
      [schoolId]
    );
    const invPrefix = settingsRes.rows[0]?.invoice_prefix || "";
    const currency = settingsRes.rows[0]?.currency || "YER";

    const { rows } = await pool.query(
      `SELECT
          id,
          contract_id AS "contractId",
          student_id AS "studentId",
          amount,
          method,
          provider,
          reference,
          note,
          status,
          receipt_number AS "receiptNo",
          paid_at AS "paidAt",
          attachment_path AS "attachmentPath" 
        FROM fee_payments
        WHERE contract_id = $1 AND school_id = $2
        ORDER BY paid_at DESC`,
      [contractId, schoolId]
    );

    // تحويل المسار وتطبيق الإعدادات
    const base = `${req.protocol}://${req.get("host")}`;
    const payments = rows.map(p => ({
      ...p,
      receiptNo: p.receiptNo ? `${invPrefix}${p.receiptNo}` : null,
      currency: currency,
      attachmentUrl: p.attachmentPath ? `${base}/${p.attachmentPath}` : null
    }));

    return res.json(payments);
  } catch (e) {
    console.error("getPayments Error:", e);
    return res.status(500).json({ message: "خطأ داخلي في جلب الدفعات" });
  }
}

export async function confirmPayment(req, res) {
  const schoolId = req.user?.school_id;
  const paymentId = parseInt(req.params.id || "0", 10);
  if (!paymentId) return res.status(400).json({ message: "Invalid payment id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // اقفل الدفعة للتأكد ما تتكرر
    const pRes = await client.query(
      `SELECT id, contract_id AS "contractId", student_id AS "studentId", amount, status
       FROM fee_payments
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [paymentId, schoolId]
    );

    if (!pRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Payment not found" });
    }

    const payment = pRes.rows[0];

    // لو مؤكد من قبل، لا تعيد التوزيع
    if (payment.status === "confirmed") {
      await client.query("COMMIT");
      return res.json({ message: "Already confirmed" });
    }

    // لازم يكون pending
    if (payment.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Only pending payments can be confirmed" });
    }

    // ✅ منع اعتماد نفس الدفعة مرتين
    await client.query(
      `DELETE FROM fee_payment_allocations WHERE payment_id = $1 AND school_id = $2`,
      [paymentId, schoolId]
    );

    // ✅ علّم الدفعة confirmed
    await client.query(
      `UPDATE fee_payments
       SET status = 'confirmed'
       WHERE id = $1 AND school_id = $2`,
      [paymentId, schoolId]
    );

    // ✅ توزيع المبلغ على الأقساط (نفس منطق createPayment)
    let remaining = Number(payment.amount);

    const inst = await client.query(
      `SELECT id, amount, paid_amount AS "paidAmount"
       FROM fee_installments
       WHERE contract_id = $1 AND school_id = $2 AND status NOT IN ('paid','voided')
       ORDER BY installment_no ASC
       FOR UPDATE`,
      [payment.contractId, schoolId]
    );

    for (const row of inst.rows) {
      if (remaining <= 0) break;

      const balance = Math.max(0, Number(row.amount) - Number(row.paidAmount));
      if (balance <= 0) continue;

      const take = Math.min(balance, remaining);

      await client.query(
        `INSERT INTO fee_payment_allocations (school_id, payment_id, installment_id, allocated_amount)
         VALUES ($1,$2,$3,$4)`,
        [schoolId, paymentId, row.id, take]
      );

      const newPaid = Number(row.paidAmount) + take;
      const newStatus = computeInstallmentStatus(row.amount, newPaid);

      await client.query(
        `UPDATE fee_installments
         SET paid_amount=$1, status=$2, updated_at=NOW()
         WHERE id=$3 AND school_id = $4`,
        [newPaid, newStatus, row.id, schoolId]
      );

      remaining -= take;
    }

    // ==========================================
    // ✅ الإضافة: إرسال إشعار لولي الأمر بالاعتماد
    // ==========================================
    try {
      // 1. جلب حساب ولي الأمر الأساسي للطالب مع التأكد من المدرسة
      const parentRes = await client.query(`
        SELECT g.user_id 
        FROM student_guardians sg
        JOIN guardians g ON sg.guardian_id = g.id
        WHERE sg.student_id = $1 AND sg.is_primary = true AND sg.school_id = $2
        LIMIT 1
      `, [payment.studentId, schoolId]);

      const parentUserId = parentRes.rows[0]?.user_id;

      if (parentUserId) {
        const title = "تم اعتماد الدفعة بنجاح";
        const body = `تم تأكيد استلام دفعتك بمبلغ ${payment.amount.toLocaleString()} واعتمادها في النظام المالي. شكراً لك.`;
        
        // 2. تسجيل الإشعار
        const nRes = await client.query(`
          INSERT INTO notifications (school_id, sender_user_id, sender_display_name, title, body, source, category, priority, related_type, related_id)
          VALUES ($1, NULL, 'الإدارة المالية', $2, $3, 'system', 'finance', 'normal', 'fee_payment', $4)
          RETURNING id, created_at
        `, [schoolId, title, body, paymentId]);

        const notifId = nRes.rows[0].id;

        await client.query(`
          INSERT INTO notification_recipients (notification_id, recipient_user_id, is_read)
          VALUES ($1, $2, false)
        `, [notifId, parentUserId]);

        // 3. الإرسال اللحظي
        const io = req.app.get("io");
        if (io) {
          io.to(`user_${parentUserId}`).emit("notification:new", {
            id: notifId,
            title,
            body,
            category: "finance",
            source: "system",
            created_at: nRes.rows[0].created_at
          });
        }
      }
    } catch (e) {
      console.warn("Parent notification failed on confirm:", e.message);
    }

    await client.query("COMMIT");
    return res.json({ message: "Payment confirmed", paymentId });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ message: "confirmPayment failed", error: e.message });
  } finally {
    client.release();
  }
}

export async function createPayment(req, res) {
  const schoolId = req.user?.school_id;
  if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

  const contractId = parseInt(req.body?.contractId || "0", 10);
  const studentId = parseInt(req.body?.studentId || "0", 10);
  const amount = Number(req.body?.amount);
  const method = req.body?.method;
  const provider = req.body?.provider || null;
  const reference = req.body?.reference || null;
  const note = req.body?.note || null;
  const status = req.body?.status || "confirmed"; // pending/confirmed

  if (!contractId || !studentId) return res.status(400).json({ message: "contractId/studentId required" });
  if (!amount || amount <= 0) return res.status(400).json({ message: "amount invalid" });
  if (!method) return res.status(400).json({ message: "method required" });

  const attachment = req.file || null;
  const attachmentPath = attachment ? attachment.path : null;
  const attachmentMime = attachment ? attachment.mimetype : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const c = await client.query(`SELECT id FROM fee_contracts WHERE id=$1 AND school_id = $2 LIMIT 1`, [contractId, schoolId]);
    if (!c.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Contract not found" });
    }

    // receipt unique retry
    let receiptNo = genReceiptNumber();
    let paymentRow = null;

    for (let i = 0; i < 5; i++) {
      try {
        const ins = await client.query(
          `INSERT INTO fee_payments
            (school_id, contract_id, student_id, amount, method, provider, reference, note,
             attachment_path, attachment_mime, status, receipt_number, paid_at)
           VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           RETURNING id, receipt_number AS "receiptNo", paid_at AS "paidAt"`,
          [schoolId, contractId, studentId, amount, method, provider, reference, note, attachmentPath, attachmentMime, status, receiptNo]
        );
        paymentRow = ins.rows[0];
        break;
      } catch (e) {
        if (e.code === "23505") { // unique violation
          receiptNo = genReceiptNumber();
          continue;
        }
        throw e;
      }
      
    }
    if (!paymentRow) throw new Error("Failed to generate unique receipt number.");

    const paymentId = paymentRow.id;
    const io = req.app.get("io");

    // أي حوالة/غير نقدي أو pending → إشعار مالي
    if (status === "pending" || method !== "cash") {
      try {
        await notifyFinanceAdmins({
          db: client,
          io,
          senderUserId: req.user?.id || null,
          studentId,
          contractId,
          paymentId,
          amount,
          method,
          schoolId // ✅ تمرير المدرسة
        });
      } catch (e) {
        console.warn("finance notify failed:", e.message);
      }
    }

    // confirmed => allocate to oldest installments
    if (status === "confirmed") {
      let remaining = amount;

      const inst = await client.query(
        `SELECT id, amount, paid_amount AS "paidAmount"
         FROM fee_installments
         WHERE contract_id = $1 AND school_id = $2 AND status NOT IN ('paid','voided')
         ORDER BY installment_no ASC
         FOR UPDATE`,
        [contractId, schoolId]
      );

      for (const row of inst.rows) {
        if (remaining <= 0) break;

        const balanceNeeded = Number(row.amount) - Number(row.paidAmount);
        if (balanceNeeded <= 0) continue;

        const take = Math.min(balanceNeeded, remaining);

        await client.query(
          `INSERT INTO fee_payment_allocations (school_id, payment_id, installment_id, allocated_amount)
           VALUES ($1,$2,$3,$4)`,
          [schoolId, paymentId, row.id, take]
        );

        const newPaid = Number(row.paidAmount) + take;
        const newStatus = computeInstallmentStatus(row.amount, newPaid);

        await client.query(
          `UPDATE fee_installments
           SET paid_amount=$1, status=$2, updated_at=NOW()
           WHERE id=$3 AND school_id = $4`,
          [newPaid, newStatus, row.id, schoolId]
        );

        remaining -= take; 
      }
    }

    // ✅ إرسال إشعار لولي الأمر بالاعتماد
    if (status === "confirmed") {
        try {
          const parentRes = await client.query(`
            SELECT g.user_id FROM student_guardians sg
            JOIN guardians g ON sg.guardian_id = g.id
            WHERE sg.student_id = $1 AND sg.is_primary = true AND sg.school_id = $2
            LIMIT 1
          `, [studentId, schoolId]);
          const parentUserId = parentRes.rows[0]?.user_id;
          if (parentUserId) {
            const title = "تم اعتماد الدفعة بنجاح";
            const body = `تم تأكيد استلام دفعتك بمبلغ ${amount.toLocaleString()} واعتمادها في النظام المالي. شكراً لك.`;
            const nRes = await client.query(`
              INSERT INTO notifications (school_id, sender_user_id, sender_display_name, title, body, source, category, priority, related_type, related_id)
              VALUES ($1, NULL, 'الإدارة المالية', $2, $3, 'system', 'finance', 'normal', 'fee_payment', $4)
              RETURNING id, created_at
            `, [schoolId, title, body, paymentId]);
            const notifId = nRes.rows[0].id;
            await client.query(`INSERT INTO notification_recipients (notification_id, recipient_user_id, is_read) VALUES ($1, $2, false)`, [notifId, parentUserId]);
            if (io) { io.to(`user_${parentUserId}`).emit("notification:new", { id: notifId, title, body, category: "finance", created_at: nRes.rows[0].created_at }); }
          }
        } catch (e) { console.warn("Direct Payment notification failed:", e.message); }
    }

    await client.query("COMMIT");

    return res.status(201).json({
      id: paymentId,
      contractId,
      studentId,
      amount,
      method,
      provider,
      reference,
      note,
      status,
      receiptNo: paymentRow.receiptNo,
      paidAt: paymentRow.paidAt,
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ message: "createPayment failed", error: e.message });
  } finally {
    client.release();
  }
}

export async function reportCollections(req, res) {
  try {
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
    const invPrefix = settingsRes.rows[0]?.invoice_prefix || "";
    const stdPrefix = settingsRes.rows[0]?.student_code_prefix || "";
    const currency = settingsRes.rows[0]?.currency || "YER";

    const asIntStr = (expr) => `CASE WHEN (${expr})::text ~ '^[0-9]+$' THEN ((${expr})::text)::int END`;

    const pContractId = asIntStr("p.contract_id");
    const pStudentId = asIntStr("p.student_id");
    const seStudentId = asIntStr("se.student_id");
    const seYearId = asIntStr("se.academic_year_id");
    const seGradeId = asIntStr("se.grade_id");
    const seSectionId = asIntStr("se.section_id");

    const params = [schoolId, yearId];
    const where = [];

    where.push(`p.school_id = $1`); // ✅ حماية المدرسة
    where.push(`p.status = 'confirmed'`);
    where.push(`c.academic_year_id = $2`);

    if (from) { params.push(from); where.push(`p.paid_at::date >= $${params.length}`); }
    if (to) { params.push(to); where.push(`p.paid_at::date <= $${params.length}`); }
    if (method) { params.push(method); where.push(`p.method = $${params.length}`); }

    if (gradeId) { params.push(gradeId); where.push(`${seGradeId} = $${params.length}`); }
    if (classId) { params.push(classId); where.push(`${seSectionId} = $${params.length}`); }

    const whereSql = `WHERE ${where.join(" AND ")}`;

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
      JOIN fee_contracts c ON c.id = ${pContractId} AND c.school_id = p.school_id
      JOIN students s ON s.id = ${pStudentId} AND s.school_id = p.school_id
      LEFT JOIN student_enrollments se
        ON ${seStudentId} = s.id
        AND ${seYearId} = c.academic_year_id
        AND se.status = 'enrolled'
        AND se.school_id = p.school_id
      LEFT JOIN grades gr ON gr.id = ${seGradeId} AND gr.school_id = p.school_id
      LEFT JOIN sections sc ON sc.id = ${seSectionId} AND sc.school_id = p.school_id
      ${whereSql}
      ORDER BY p.paid_at DESC
      LIMIT 500
    `;

    const rowsRes = await pool.query(rowsSql, params);
    let rows = rowsRes.rows || [];

    // ✅ تطبيق بادئة كود الطالب والفاتورة والعملة
    rows = rows.map(r => ({
      ...r,
      receiptNo: r.receiptNo ? `${invPrefix}${r.receiptNo}` : null,
      studentCode: r.studentCode ? `${stdPrefix}${r.studentCode}` : null,
      currency: currency
    }));

    const byMethodSql = `
      SELECT p.method, COUNT(*)::int AS count, COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = ${pContractId} AND c.school_id = p.school_id
      JOIN students s ON s.id = ${pStudentId} AND s.school_id = p.school_id
      LEFT JOIN student_enrollments se
        ON ${seStudentId} = s.id
        AND ${seYearId} = c.academic_year_id
        AND se.status='enrolled'
        AND se.school_id = p.school_id
      ${whereSql}
      GROUP BY p.method
      ORDER BY total DESC
    `;
    const byMethod = (await pool.query(byMethodSql, params)).rows || [];

    const byGradeSql = `
      SELECT COALESCE(gr.name,'—') AS "gradeName", COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = ${pContractId} AND c.school_id = p.school_id
      JOIN students s ON s.id = ${pStudentId} AND s.school_id = p.school_id
      LEFT JOIN student_enrollments se
        ON ${seStudentId} = s.id
        AND ${seYearId} = c.academic_year_id
        AND se.status='enrolled'
        AND se.school_id = p.school_id
      LEFT JOIN grades gr ON gr.id = ${seGradeId} AND gr.school_id = p.school_id
      LEFT JOIN sections sc ON sc.id = ${seSectionId} AND sc.school_id = p.school_id
      ${whereSql}
      GROUP BY gr.name
      ORDER BY total DESC
      LIMIT 5
    `;
    const byGrade = (await pool.query(byGradeSql, params)).rows || [];

    const bySectionSql = `
      SELECT COALESCE(sc.name,'—') AS "className", COALESCE(SUM(p.amount),0)::bigint AS total
      FROM fee_payments p
      JOIN fee_contracts c ON c.id = ${pContractId} AND c.school_id = p.school_id
      JOIN students s ON s.id = ${pStudentId} AND s.school_id = p.school_id
      LEFT JOIN student_enrollments se
        ON ${seStudentId} = s.id
        AND ${seYearId} = c.academic_year_id
        AND se.status='enrolled'
        AND se.school_id = p.school_id
      LEFT JOIN grades gr ON gr.id = ${seGradeId} AND gr.school_id = p.school_id
      LEFT JOIN sections sc ON sc.id = ${seSectionId} AND sc.school_id = p.school_id
      ${whereSql}
      GROUP BY sc.name
      ORDER BY total DESC
      LIMIT 5
    `;
    const bySection = (await pool.query(bySectionSql, params)).rows || [];

    const totalCollected = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const paymentsCount = rows.length;

    return res.json({
      kpis: {
        totalCollected,
        paymentsCount,
        totalOutstanding: 0,
        studentsOutstanding: 0,
        hint1: byMethod[0]?.method ? `أكثر طريقة: ${byMethod[0].method}` : "—",
        hint2: (from || to) ? `الفترة: ${from || "—"} → ${to || "—"}` : "كل الفترات",
        hint3: "Confirmed فقط",
        hint4: "—",
        currency: currency // ✅ إرسال العملة للواجهة
      },
      breakdowns: { byMethod, byGrade, bySection },
      rows,
    });
  } catch (error) {
    console.error("reportCollections Error:", error);
    return res.status(500).json({ message: "حدث خطأ داخلي" });
  }
}

export async function reportOutstanding(req, res) {
  try {
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

    const asIntStr = (expr) => `CASE WHEN (${expr})::text ~ '^[0-9]+$' THEN ((${expr})::text)::int END`;
    const pContractId = asIntStr("p.contract_id");
    const seStudentId = asIntStr("se.student_id");
    const seYearId = asIntStr("se.academic_year_id");
    const seGradeId = asIntStr("se.grade_id");
    const seSectionId = asIntStr("se.section_id");

    const params = [schoolId, yearId];
    let i = 2;
    const extra = [];

    if (gradeId) { params.push(gradeId); extra.push(`${seGradeId} = $${++i}`); }
    if (classId) { params.push(classId); extra.push(`${seSectionId} = $${++i}`); }

    const extraWhere = extra.length ? `AND ${extra.join(" AND ")}` : "";

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
          WHERE fi.contract_id = c.id AND fi.status IN ('unpaid','partial') AND fi.school_id = c.school_id
        ) AS "nextDueDate"
      FROM fee_contracts c
      JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
      LEFT JOIN fee_payments p ON ${pContractId} = c.id AND p.school_id = c.school_id
      LEFT JOIN student_enrollments se
        ON ${seStudentId} = s.id
        AND ${seYearId} = c.academic_year_id
        AND se.status = 'enrolled'
        AND se.school_id = c.school_id
      LEFT JOIN grades gr ON gr.id = ${seGradeId} AND gr.school_id = c.school_id
      LEFT JOIN sections sc ON sc.id = ${seSectionId} AND sc.school_id = c.school_id
      WHERE c.academic_year_id = $2
        AND c.school_id = $1 -- ✅ حماية المدرسة
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
        currency: currency // ✅ إرسال العملة للواجهة
      },
      breakdowns: { byGrade, bySection, topStudents },
      rows,
    });
  } catch (error) {
    console.error("reportOutstanding Error:", error);
    return res.status(500).json({ message: "حدث خطأ داخلي" });
  }
}