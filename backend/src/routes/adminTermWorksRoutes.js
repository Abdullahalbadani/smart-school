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
  previewMonthlyWorksReport,
  downloadMonthlyWorksReportPdf,
  printMonthlyWorksReport,
} from "../controllers/adminMonthlyWorksController.js";
const router = express.Router();

router.get("/monthly-works/assessments", listMonthlyAssessments);
router.get("/monthly-works", getMonthlyWorks);
router.post("/monthly-works/approve", approveMonthlyWorks);
router.post("/monthly-works/return", returnMonthlyWorks);
router.post("/monthly-works/report/preview", previewMonthlyWorksReport);
router.post("/monthly-works/report/pdf", downloadMonthlyWorksReportPdf);
router.post("/monthly-works/report/print", printMonthlyWorksReport);

router.get("/term-works", getTermWorks);
router.post("/term-works/approve", approveTermWorks);
router.post("/term-works/return", returnTermWorks);

export default router;