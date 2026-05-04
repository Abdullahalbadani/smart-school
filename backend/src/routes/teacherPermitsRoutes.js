import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { TeacherPermitsController } from "../controllers/teacherPermitsController.js";

const router = express.Router();
router.use(authMiddleware);

// ✅ مهم: لازم هذه الدالة تكون موجودة في الكنترولر
router.get("/available-slots", TeacherPermitsController.availableSlots);

router.get("/", TeacherPermitsController.listMyPermits);
router.post("/", TeacherPermitsController.createPermit);
// في ملف teacherRoutes.js أو ما شابه:
router.get("/substitutions/pending", TeacherPermitsController.getPendingSubstitutions);
router.patch("/substitutions/:id/respond", TeacherPermitsController.respondToSubstitution);
export default router;
