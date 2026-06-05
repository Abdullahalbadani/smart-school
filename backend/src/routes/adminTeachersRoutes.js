import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";

const router = Router();
router.use(authMiddleware);

// GET /api/admin/teachers/list
router.get("/list", (req, res) => {
  // TODO: استبدل هذا بمنطق جلب المدرسين من قاعدة البيانات
  res.json({ teachers: [] });
});

// GET /api/admin/staff/teachers (أو /api/admin/teachers/staff)
router.get("/staff/teachers", (req, res) => {
  // TODO: استبدل هذا بمنطق جلب موظفي المدرسين
  res.json({ staff: [] });
});

export default router;