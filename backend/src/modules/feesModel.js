// // src/modules/feesModel.js
// import { pool } from "../config/db.js";

// /* =========================================================
//    Helpers: اكتشاف أعمدة اسم الطالب/كوده حسب جدول students
// ========================================================= */
// let _studentColsCache = null;

// async function resolveStudentCols() {
//   if (_studentColsCache) return _studentColsCache;

//   const colsRes = await pool.query(
//     `SELECT column_name
//      FROM information_schema.columns
//      WHERE table_schema='public' AND table_name='students'`
//   );

//   const cols = new Set(colsRes.rows.map((r) => r.column_name));

//   // ✅ اسم الطالب: نحاول عدة احتمالات شائعة
//   let nameExpr = null;
//   const nameCandidates = [
//     "name",
//     "full_name",
//     "student_name",
//     "student_full_name",
//     "arabic_name",
//     "name_ar",
//     "fullname",
//   ];

//   for (const c of nameCandidates) {
//     if (cols.has(c)) {
//       nameExpr = `s.${c}`;
//       break;
//     }
//   }

//   // لو عندك first_name + last_name
//   if (!nameExpr && cols.has("first_name") && cols.has("last_name")) {
//     nameExpr = `concat_ws(' ', s.first_name, s.last_name)`;
//   }

//   // آخر حل: اسم افتراضي
//   if (!nameExpr) nameExpr = `('طالب #' || s.id::text)`;

//   // ✅ كود الطالب
//   let codeExpr = null;
//   const codeCandidates = ["code", "student_code", "stu_code"];
//   for (const c of codeCandidates) {
//     if (cols.has(c)) {
//       codeExpr = `s.${c}`;
//       break;
//     }
//   }
//   if (!codeExpr) codeExpr = `s.id::text`;

//   _studentColsCache = { nameExpr, codeExpr };
//   return _studentColsCache;
// }

// export const FeesModel = {
//   // ====== جلب خطة رسوم مناسبة لقيد الطالب ======
//   async getPlanForEnrollment(client, enrollmentId) {
//     const enr = await client.query(
//       `SELECT id, academic_year_id, stage_id, grade_id, section_id
//        FROM student_enrollments
//        WHERE id = $1`,
//       [Number(enrollmentId)]
//     );
//     if (!enr.rowCount) throw new Error("القيد غير موجود");

//     const e = enr.rows[0];

//     // يبحث عن خطة تطابق (شعبة/صف/مرحلة) إن وجدت، وإلا خطة عامة للسنة
//     const plan = await client.query(
//       `SELECT *
//        FROM fee_plans
//        WHERE academic_year_id = $1 AND is_active = TRUE
//          AND (stage_id   IS NULL OR stage_id   = $2)
//          AND (grade_id   IS NULL OR grade_id   = $3)
//          AND (section_id IS NULL OR section_id = $4)
//        ORDER BY (section_id IS NOT NULL) DESC,
//                 (grade_id   IS NOT NULL) DESC,
//                 (stage_id   IS NOT NULL) DESC
//        LIMIT 1`,
//       [e.academic_year_id, e.stage_id, e.grade_id, e.section_id]
//     );

//     return { enrollment: e, plan: plan.rows[0] || null };
//   },

//   // ====== إنشاء فاتورة + أقساط للطالب إذا غير موجودة ======
//   async ensureInvoice(client, enrollmentId) {
//     const inv = await client.query(
//       `SELECT * FROM fee_invoices WHERE enrollment_id = $1`,
//       [Number(enrollmentId)]
//     );
//     if (inv.rowCount) return inv.rows[0];

//     const { plan } = await this.getPlanForEnrollment(client, enrollmentId);
//     if (!plan) throw new Error("لا توجد خطة رسوم لهذا القيد. أنشئ fee_plans أولاً.");

//     const tpl = await client.query(
//       `SELECT title, due_date, amount, sort_order, notes
//        FROM fee_plan_installments
//        WHERE plan_id = $1
//        ORDER BY sort_order ASC, due_date ASC`,
//       [plan.id]
//     );
//     if (!tpl.rowCount) throw new Error("الخطة موجودة لكن لا يوجد أقساط قالب داخلها.");

//     const total = tpl.rows.reduce((a, r) => a + Number(r.amount || 0), 0);

//     const created = await client.query(
//       `INSERT INTO fee_invoices (enrollment_id, plan_id, issue_date, status, total_amount)
//        VALUES ($1, $2, CURRENT_DATE, 'issued', $3)
//        RETURNING *`,
//       [Number(enrollmentId), plan.id, total]
//     );

//     const invoice = created.rows[0];

//     for (const row of tpl.rows) {
//       await client.query(
//         `INSERT INTO fee_installments (invoice_id, title, due_date, amount, paid_amount, status, sort_order, notes)
//          VALUES ($1, $2, $3, $4, 0, 'pending', $5, $6)`,
//         [invoice.id, row.title, row.due_date, row.amount, row.sort_order || 0, row.notes || null]
//       );
//     }

//     return invoice;
//   },

//   // ====== تسجيل دفعة رسمية + توزيع تلقائي على الأقساط (الأقدم أولاً) ======
//   async createPayment({ enrollment_id, amount, method, receipt_no, note, created_by, request_id }) {
//     const client = await pool.connect();
//     try {
//       await client.query("BEGIN");

//       const invoice = await this.ensureInvoice(client, enrollment_id);

//       const inst = await client.query(
//         `SELECT id, amount, paid_amount, due_date, sort_order
//          FROM fee_installments
//          WHERE invoice_id = $1
//          ORDER BY due_date ASC, sort_order ASC`,
//         [invoice.id]
//       );

//       const remainingTotal = inst.rows.reduce(
//         (a, r) => a + (Number(r.amount) - Number(r.paid_amount)),
//         0
//       );

//       if (Number(amount) <= 0) throw new Error("مبلغ الدفعة غير صحيح");
//       if (Number(amount) > remainingTotal + 0.0001) throw new Error("المبلغ أكبر من المتبقي.");

//       // ✅ request_id موجود (اختياري) لربط الدفعة بطلب الدفع
//       const payRes = await client.query(
//         `INSERT INTO fee_payments (invoice_id, enrollment_id, amount, method, receipt_no, note, created_by, request_id)
//          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
//          RETURNING *`,
//         [
//           invoice.id,
//           Number(enrollment_id),
//           Number(amount),
//           method || "cash",
//           receipt_no || null,
//           note || null,
//           created_by || null,
//           request_id || null,
//         ]
//       );

//       const payment = payRes.rows[0];

//       // توزيع تلقائي على الأقساط
//       let remain = Number(amount);
//       for (const r of inst.rows) {
//         if (remain <= 0) break;

//         const rRemain = Number(r.amount) - Number(r.paid_amount);
//         if (rRemain <= 0) continue;

//         const alloc = Math.min(rRemain, remain);

//         await client.query(
//           `INSERT INTO fee_payment_allocations (payment_id, installment_id, amount)
//            VALUES ($1,$2,$3)`,
//           [payment.id, r.id, alloc]
//         );

//         await client.query(
//           `UPDATE fee_installments SET paid_amount = paid_amount + $1 WHERE id = $2`,
//           [alloc, r.id]
//         );

//         remain -= alloc;
//       }

//       // تحديث حالة الأقساط
//       await client.query(
//         `UPDATE fee_installments
//          SET status = CASE
//            WHEN paid_amount >= amount THEN 'paid'
//            WHEN paid_amount > 0 THEN 'partial'
//            WHEN due_date < CURRENT_DATE THEN 'overdue'
//            ELSE 'pending'
//          END
//          WHERE invoice_id = $1`,
//         [invoice.id]
//       );

//       // تحديث حالة الفاتورة
//       const paidSum = await client.query(
//         `SELECT COALESCE(SUM(amount),0) AS paid
//          FROM fee_payments WHERE invoice_id = $1`,
//         [invoice.id]
//       );

//       const paid = Number(paidSum.rows[0].paid || 0);
//       const remaining = Number(invoice.total_amount) - paid;

//       const status =
//         invoice.total_amount > 0 && remaining <= 0
//           ? "paid"
//           : paid > 0
//           ? "partially_paid"
//           : "issued";

//       await client.query(`UPDATE fee_invoices SET status=$1 WHERE id=$2`, [status, invoice.id]);

//       await client.query("COMMIT");
//       return { payment_id: payment.id, invoice_id: invoice.id };
//     } catch (e) {
//       await client.query("ROLLBACK");
//       throw e;
//     } finally {
//       client.release();
//     }
//   },

//   /* =========================================================
//      1) قائمة الطلاب + ملخص الرسوم (للفلاتر والواجهة)
//      - يجيب الإجمالي/المدفوع/المتبقي + آخر دفعة
//   ========================================================= */
//   async listEnrollmentsSummary(q) {
//     const { nameExpr, codeExpr } = await resolveStudentCols();

//     const yearId = q.academic_year_id || q.year_id;
//     if (!yearId) throw new Error("academic_year_id مطلوب");

//     const params = [];
//     const where = [];

//     params.push(Number(yearId));
//     where.push(`e.academic_year_id = $${params.length}`);

//     if (q.stage_id) { params.push(Number(q.stage_id)); where.push(`e.stage_id = $${params.length}`); }
//     if (q.grade_id) { params.push(Number(q.grade_id)); where.push(`e.grade_id = $${params.length}`); }
//     if (q.section_id) { params.push(Number(q.section_id)); where.push(`e.section_id = $${params.length}`); }

//     if (q.search) {
//       params.push(`%${q.search}%`);
//       where.push(`(${nameExpr} ILIKE $${params.length} OR ${codeExpr} ILIKE $${params.length})`);
//     }

//     // (اختياري) فلتر حسب حالة الفاتورة: issued/partially_paid/paid/no_invoice
//     if (q.invoice_status) {
//       params.push(q.invoice_status);
//       if (q.invoice_status === "no_invoice") {
//         where.push(`inv.id IS NULL`);
//       } else {
//         where.push(`inv.status = $${params.length}`);
//       }
//     }

//     const sql = `
//       SELECT
//         e.id AS enrollment_id,
//         e.student_id,
//         e.academic_year_id, e.stage_id, e.grade_id, e.section_id,
//         ${nameExpr} AS student_name,
//         ${codeExpr} AS student_code,

//         COALESCE(inv.total_amount, 0) AS total_amount,
//         COALESCE(paid.paid_amount, 0) AS paid_amount,
//         (COALESCE(inv.total_amount, 0) - COALESCE(paid.paid_amount, 0)) AS remaining_amount,
//         COALESCE(inv.status, 'no_invoice') AS invoice_status,
//         paid.last_paid_at

//       FROM student_enrollments e
//       JOIN students s ON s.id = e.student_id
//       LEFT JOIN fee_invoices inv ON inv.enrollment_id = e.id
//       LEFT JOIN (
//         SELECT enrollment_id, SUM(amount) AS paid_amount, MAX(paid_at) AS last_paid_at
//         FROM fee_payments
//         GROUP BY enrollment_id
//       ) paid ON paid.enrollment_id = e.id

//       WHERE ${where.join(" AND ")}
//       ORDER BY student_name
//       LIMIT 500
//     `;

//     const { rows } = await pool.query(sql, params);
//     return { enrollments: rows };
//   },

//   /* =========================================================
//      2) كشف طالب واحد (Statement)
//      - فاتورة + أقساط + دفعات + توزيعات الدفعات على الأقساط
//   ========================================================= */
//   async getEnrollmentStatement(enrollmentId) {
//     const enrId = Number(enrollmentId);

//     const invRes = await pool.query(
//       `SELECT * FROM fee_invoices WHERE enrollment_id = $1`,
//       [enrId]
//     );
//     const invoice = invRes.rows[0] || null;

//     let installments = [];
//     if (invoice) {
//       const instRes = await pool.query(
//         `SELECT id, title, due_date, amount, paid_amount, status, sort_order, notes
//          FROM fee_installments
//          WHERE invoice_id = $1
//          ORDER BY sort_order ASC, due_date ASC`,
//         [invoice.id]
//       );
//       installments = instRes.rows;
//     }

//     const payRes = await pool.query(
//       `SELECT id, amount, method, receipt_no, note, paid_at, request_id
//        FROM fee_payments
//        WHERE enrollment_id = $1
//        ORDER BY paid_at DESC, id DESC`,
//       [enrId]
//     );

//     const allocRes = await pool.query(
//       `SELECT a.payment_id, a.installment_id, a.amount
//        FROM fee_payment_allocations a
//        JOIN fee_payments p ON p.id = a.payment_id
//        WHERE p.enrollment_id = $1`,
//       [enrId]
//     );

//     // ملخص سريع
//     const totalPaid = payRes.rows.reduce((a, r) => a + Number(r.amount || 0), 0);
//     const totalAmount = invoice ? Number(invoice.total_amount || 0) : 0;
//     const remaining = totalAmount - totalPaid;

//     return {
//       summary: {
//         enrollment_id: enrId,
//         total_amount: totalAmount,
//         paid_amount: totalPaid,
//         remaining_amount: remaining,
//         invoice_status: invoice ? invoice.status : "no_invoice",
//       },
//       invoice,
//       installments,
//       payments: payRes.rows,
//       allocations: allocRes.rows,
//     };
//   },

//   /* =========================================================
//      3) يوميات التحصيل (Payments Ledger)
//      - فلترة بالتاريخ/الشهر/الطريقة + بحث
//   ========================================================= */
//   async listPaymentsLedger(q) {
//     const { nameExpr, codeExpr } = await resolveStudentCols();

//     const yearId = q.academic_year_id || q.year_id;
//     if (!yearId) throw new Error("academic_year_id مطلوب");

//     const params = [];
//     const where = [];

//     params.push(Number(yearId));
//     where.push(`e.academic_year_id = $${params.length}`);

//     if (q.stage_id) { params.push(Number(q.stage_id)); where.push(`e.stage_id = $${params.length}`); }
//     if (q.grade_id) { params.push(Number(q.grade_id)); where.push(`e.grade_id = $${params.length}`); }
//     if (q.section_id) { params.push(Number(q.section_id)); where.push(`e.section_id = $${params.length}`); }

//     if (q.method) { params.push(q.method); where.push(`p.method = $${params.length}`); }

//     if (q.from) { params.push(q.from); where.push(`(p.paid_at::date) >= $${params.length}`); }
//     if (q.to) { params.push(q.to); where.push(`(p.paid_at::date) <= $${params.length}`); }

//     if (q.search) {
//       params.push(`%${q.search}%`);
//       where.push(
//         `(${nameExpr} ILIKE $${params.length}
//           OR ${codeExpr} ILIKE $${params.length}
//           OR COALESCE(p.receipt_no,'') ILIKE $${params.length})`
//       );
//     }

//     const sql = `
//       SELECT
//         p.id, p.amount, p.method, p.receipt_no, p.note, p.paid_at, p.request_id,
//         p.enrollment_id,
//         ${nameExpr} AS student_name,
//         ${codeExpr} AS student_code
//       FROM fee_payments p
//       JOIN student_enrollments e ON e.id = p.enrollment_id
//       JOIN students s ON s.id = e.student_id
//       WHERE ${where.join(" AND ")}
//       ORDER BY p.paid_at DESC, p.id DESC
//       LIMIT 500
//     `;

//     const { rows } = await pool.query(sql, params);
//     return { payments: rows };
//   },
// };
