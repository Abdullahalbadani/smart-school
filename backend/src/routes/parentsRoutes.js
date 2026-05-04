// src/routes/parentsRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import ParentsController from "../controllers/parentsController.js";

const router = express.Router();

// ✅ endpoints واضحة
router.get("/search", authMiddleware, ParentsController.search);
router.get("/", authMiddleware, ParentsController.list);

// ✅ Route ذكي: لو رقم => getById ، لو نص => search بدل خطأ Invalid id
router.get("/:id", authMiddleware, (req, res) => {
  const raw = String(req.params.id || "").trim();

  // رقم؟ روح getById
  if (/^\d+$/.test(raw)) {
    return ParentsController.getById(req, res);
  }

  // نص؟ اعتبره بحث (حتى لو جاء بالغلط من أي سكربت)
  req.query.q = raw; // يدعم search() مباشرة
  return ParentsController.search(req, res);
});

export default router;
