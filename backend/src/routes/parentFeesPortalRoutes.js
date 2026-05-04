import { Router } from "express";
import uploadFeesRequests from "../middleware/uploadFeesRequests.js";
import authMiddleware from "../middleware/authMiddleware.js"; // ✅ استدعاء الميدلوير
import { parentFeesOverview, parentPaymentRequest } from "../controllers/parentFeesPortalController.js";

const router = Router();

// ✅ تطبيق الحماية (authMiddleware) على المسارات لضمان وجود معرف المستخدم والمدرسة
router.get("/parent/fees/overview", authMiddleware, parentFeesOverview);
router.post("/parent/fees/payment-request", authMiddleware, uploadFeesRequests, parentPaymentRequest);

export default router;