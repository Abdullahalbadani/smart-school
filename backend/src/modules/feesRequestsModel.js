// // src/modules/feesRequestsModel.js
// import { pool } from "../config/db.js";

// let _studentExprCache = null;

// async function resolveStudentExpr() {
//   if (_studentExprCache) return _studentExprCache;

//   const colsRes = await pool.query(
//     `SELECT column_name
//      FROM information_schema.columns
//      WHERE table_schema='public' AND table_name='students'`
//   );

//   const cols = new Set(colsRes.rows.map((r) => r.column_name));

//   // ✅ اسم الطالب (نحاول عدة أسماء شائعة)
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

//   // آخر حل: استخدم id كنص
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

//   _studentExprCache = { nameExpr, codeExpr };
//   return _studentExprCache;
// }

// export const FeesRequestsModel = {
//   async createRequest({ enrollment_id, amount, method, receipt_no, note, submitted_by, files }) {
//     const client = await pool.connect();
//     try {
//       await client.query("BEGIN");

//       const reqRes = await client.query(
//         `INSERT INTO fee_payment_requests
//          (enrollment_id, amount, method, receipt_no, note, status, submitted_by)
//          VALUES ($1,$2,$3,$4,$5,'pending',$6)
//          RETURNING *`,
//         [
//           Number(enrollment_id),
//           Number(amount),
//           method || "transfer",
//           receipt_no || null,
//           note || null,
//           submitted_by || null,
//         ]
//       );

//       const request = reqRes.rows[0];

//       const attachments = [];
//       for (const f of files || []) {
//         const relUrl = `/uploads/fees_requests/${f.filename}`;
//         const filePath = `uploads/fees_requests/${f.filename}`;

//         const attRes = await client.query(
//           `INSERT INTO fee_payment_request_attachments
//            (request_id, file_path, url, original_name, mime_type, size_bytes)
//            VALUES ($1,$2,$3,$4,$5,$6)
//            RETURNING *`,
//           [
//             request.id,
//             filePath,
//             relUrl,
//             f.originalname || null,
//             f.mimetype || null,
//             f.size || null,
//           ]
//         );
//         attachments.push(attRes.rows[0]);
//       }

//       await client.query("COMMIT");
//       return { request, attachments };
//     } catch (e) {
//       await client.query("ROLLBACK");
//       throw e;
//     } finally {
//       client.release();
//     }
//   },

//   async listRequests(q) {
//     const { nameExpr, codeExpr } = await resolveStudentExpr();

//     const yearId = q.academic_year_id || q.year_id;
//     if (!yearId) throw new Error("academic_year_id مطلوب");

//     const params = [];
//     const where = [];

//     params.push(Number(yearId));
//     where.push(`e.academic_year_id = $${params.length}`);

//     if (q.stage_id) { params.push(Number(q.stage_id)); where.push(`e.stage_id = $${params.length}`); }
//     if (q.grade_id) { params.push(Number(q.grade_id)); where.push(`e.grade_id = $${params.length}`); }
//     if (q.section_id) { params.push(Number(q.section_id)); where.push(`e.section_id = $${params.length}`); }

//     if (q.status) { params.push(q.status); where.push(`r.status = $${params.length}`); }
//     if (q.method) { params.push(q.method); where.push(`r.method = $${params.length}`); }

//     if (q.from) { params.push(q.from); where.push(`(r.created_at::date) >= $${params.length}`); }
//     if (q.to) { params.push(q.to); where.push(`(r.created_at::date) <= $${params.length}`); }

//     if (q.search) {
//       params.push(`%${q.search}%`);
//       where.push(`(${nameExpr} ILIKE $${params.length} OR ${codeExpr} ILIKE $${params.length} OR COALESCE(r.receipt_no,'') ILIKE $${params.length})`);
//     }

//     const sql = `
//       SELECT
//         r.id, r.enrollment_id, r.amount, r.method, r.receipt_no, r.note, r.status,
//         r.created_at, r.reviewed_at, r.reject_reason,
//         ${nameExpr} AS student_name,
//         ${codeExpr} AS student_code,
//         (SELECT COUNT(*) FROM fee_payment_request_attachments a WHERE a.request_id = r.id) AS attachments_count
//       FROM fee_payment_requests r
//       JOIN student_enrollments e ON e.id = r.enrollment_id
//       JOIN students s ON s.id = e.student_id
//       WHERE ${where.join(" AND ")}
//       ORDER BY r.created_at DESC
//       LIMIT 200
//     `;

//     const { rows } = await pool.query(sql, params);
//     return { requests: rows };
//   },

//   async getRequestById(id) {
//     const { nameExpr, codeExpr } = await resolveStudentExpr();

//     const reqRes = await pool.query(
//       `SELECT
//         r.*,
//         ${nameExpr} AS student_name,
//         ${codeExpr} AS student_code
//        FROM fee_payment_requests r
//        JOIN student_enrollments e ON e.id = r.enrollment_id
//        JOIN students s ON s.id = e.student_id
//        WHERE r.id = $1`,
//       [Number(id)]
//     );
//     if (!reqRes.rowCount) throw new Error("الطلب غير موجود");

//     const attRes = await pool.query(
//       `SELECT id, url, original_name, mime_type, size_bytes, created_at
//        FROM fee_payment_request_attachments
//        WHERE request_id = $1
//        ORDER BY id ASC`,
//       [Number(id)]
//     );

//     const request = reqRes.rows[0];
//     request.attachments = attRes.rows;

//     return { request };
//   },

//   async rejectRequest(id, reviewer_id, reason) {
//     const res = await pool.query(
//       `UPDATE fee_payment_requests
//        SET status='rejected', reviewed_by=$2, reviewed_at=NOW(), reject_reason=$3, updated_at=NOW()
//        WHERE id=$1 AND status='pending'
//        RETURNING *`,
//       [Number(id), reviewer_id || null, reason || null]
//     );
//     if (!res.rowCount) throw new Error("لا يمكن رفض الطلب");
//     return { request: res.rows[0] };
//   },

//   async markApproved(id, reviewer_id, payment_id) {
//     const res = await pool.query(
//       `UPDATE fee_payment_requests
//        SET status='approved', reviewed_by=$2, reviewed_at=NOW(), updated_at=NOW()
//        WHERE id=$1 AND status='pending'
//        RETURNING *`,
//       [Number(id), reviewer_id || null]
//     );
//     if (!res.rowCount) throw new Error("لا يمكن اعتماد الطلب");

//     await pool.query(`UPDATE fee_payments SET request_id=$1 WHERE id=$2`, [
//       Number(id),
//       Number(payment_id),
//     ]);

//     return { request: res.rows[0] };
//   },
// };
