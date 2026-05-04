import { Router } from "express";
import uploadFeesRequests from "../middleware/uploadFeesRequests.js";
import authMiddleware from "../middleware/authMiddleware.js"; // ✅ أضفنا هذا

import {
  getContract,
  createContract,
  updateContract,     // ✅ استدعاء دالة التعديل الجديدة
  getInstallments,
  getPayments,
  createPayment,
  reportCollections,
  reportOutstanding,
  confirmPayment, 
} from "../controllers/feesController.js";

const router = Router();

// ==========================================
// 🔒 جميع المسارات محمية بـ authMiddleware
// ==========================================

// إدارة العقود والأقساط
router.get("/fees/contract", authMiddleware, getContract);
router.post("/fees/contracts", authMiddleware, createContract);
router.put("/fees/contracts/:id", authMiddleware, updateContract); // ✅ مسار التعديل وإعادة الجدولة

router.get("/fees/installments", authMiddleware, getInstallments);

// إدارة الدفعات
router.get("/fees/payments", authMiddleware, getPayments);
router.post("/fees/payments", authMiddleware, uploadFeesRequests, createPayment);

// اعتماد دفعة (قيد المراجعة -> مؤكد)
router.patch("/fees/payments/:id/confirm", authMiddleware, confirmPayment);

// التقارير
router.get("/fees/reports/collections", authMiddleware, reportCollections);
router.get("/fees/reports/outstanding", authMiddleware, reportOutstanding);

export default router;