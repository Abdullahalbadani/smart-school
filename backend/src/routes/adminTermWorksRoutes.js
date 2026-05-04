import express from "express";
import {
  getTermWorks,
  approveTermWorks,
  returnTermWorks,
} from "../controllers/adminTermWorksController.js";
import {
  listMonthlyAssessments,
  getMonthlyWorks,
  approveMonthlyWorks,
  returnMonthlyWorks,
} from "../controllers/adminMonthlyWorksController.js";
const router = express.Router();

router.get("/monthly-works/assessments", listMonthlyAssessments);
router.get("/monthly-works", getMonthlyWorks);
router.post("/monthly-works/approve", approveMonthlyWorks);
router.post("/monthly-works/return", returnMonthlyWorks);

router.get("/term-works", getTermWorks);
router.post("/term-works/approve", approveTermWorks);
router.post("/term-works/return", returnTermWorks);

export default router;