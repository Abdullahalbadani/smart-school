// src/routes/feeRulesRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import checkPermission from "../middleware/checkPermission.js";

import {
  listFeeRules,
  createFeeRule,
  updateFeeRule,
  deleteFeeRule,
  listStudentsFeesView,
} from "../controllers/feeRulesController.js";

const router = Router();

// ⚠️ عدّل اسم الصلاحية حسب جدول permissions عندك

router.get(
  "/",
  authMiddleware,
  listFeeRules
);

router.get(
  "/students",
  authMiddleware,
  listStudentsFeesView
);

router.post(
  "/",
  authMiddleware,
  createFeeRule
);

router.put(
  "/:id",
  authMiddleware,
  updateFeeRule
);

router.delete(
  "/:id",
  authMiddleware,
  deleteFeeRule
);

export default router;