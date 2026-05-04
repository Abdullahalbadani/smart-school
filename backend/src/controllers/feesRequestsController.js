// import { FeesRequestsModel } from "../modules/feesRequestsModel.js";
// import { FeesModel } from "../modules/feesModel.js"; // لازم يكون موجود عندك (دفعات + توزيع أقساط)

// export const FeesRequestsController = {
//   async create(req, res) {
//     try {
//       const { enrollment_id, amount, method, receipt_no, note } = req.body || {};
//       if (!enrollment_id || !amount) {
//         return res.status(400).json({ message: "enrollment_id و amount مطلوبان" });
//       }

//       const submitted_by = req.user?.id || null;
//       const files = req.files || [];

//       const data = await FeesRequestsModel.createRequest({
//         enrollment_id,
//         amount,
//         method,
//         receipt_no,
//         note,
//         submitted_by,
//         files,
//       });

//       return res.json({ data, message: "تم إرسال طلب الدفع ✅" });
//     } catch (e) {
//       return res.status(400).json({ message: e.message || "خطأ" });
//     }
//   },

//   async list(req, res) {
//     try {
//       const data = await FeesRequestsModel.listRequests(req.query);
//       return res.json({ data });
//     } catch (e) {
//       return res.status(400).json({ message: e.message || "خطأ" });
//     }
//   },

//   async read(req, res) {
//     try {
//       const data = await FeesRequestsModel.getRequestById(req.params.id);
//       return res.json({ data });
//     } catch (e) {
//       return res.status(404).json({ message: e.message || "غير موجود" });
//     }
//   },

//   async reject(req, res) {
//     try {
//       const reviewer_id = req.user?.id || null;
//       const reason = req.body?.reason || null;
//       const data = await FeesRequestsModel.rejectRequest(req.params.id, reviewer_id, reason);
//       return res.json({ data, message: "تم رفض الطلب ✅" });
//     } catch (e) {
//       return res.status(400).json({ message: e.message || "خطأ" });
//     }
//   },

//   async approve(req, res) {
//     try {
//       const reviewer_id = req.user?.id || null;

//       // 1) اجلب الطلب + تأكد أنه pending
//       const { request } = await FeesRequestsModel.getRequestById(req.params.id);
//       if (request.status !== "pending") {
//         return res.status(400).json({ message: "الطلب ليس معلّقاً" });
//       }

//       // 2) حوّله لدفعة رسمية (توزيع تلقائي على الأقساط)
//       const paymentRes = await FeesModel.createPayment({
//         enrollment_id: request.enrollment_id,
//         amount: request.amount,
//         method: request.method,
//         receipt_no: request.receipt_no,
//         note: request.note ? `طلب دفع #${request.id} — ${request.note}` : `طلب دفع #${request.id}`,
//         created_by: reviewer_id,
//         request_id: request.id, // ✅ إذا كنت عدلت FeesModel لقبولها (انظر ملاحظة أسفل)
//       });

//       // 3) حدّث حالة الطلب إلى approved واربطه بالدفعة
//       const data = await FeesRequestsModel.markApproved(req.params.id, reviewer_id, paymentRes.payment_id);

//       return res.json({ data, message: "تم اعتماد الطلب وتحويله لدفعة ✅" });
//     } catch (e) {
//       return res.status(400).json({ message: e.message || "خطأ" });
//     }
//   },
// };
