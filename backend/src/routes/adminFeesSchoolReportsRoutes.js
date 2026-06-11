import { Router } from "express";
import {
  downloadFeesCollectionsSchoolReportPdf,
  downloadFeesOutstandingSchoolReportPdf,
  previewFeesCollectionsSchoolReport,
  previewFeesOutstandingSchoolReport,
  printFeesCollectionsSchoolReport,
  printFeesOutstandingSchoolReport,
} from "../controllers/adminFeesSchoolReportsController.js";

const router = Router();

router.post("/collections/preview", previewFeesCollectionsSchoolReport);
router.post("/collections/pdf", downloadFeesCollectionsSchoolReportPdf);
router.post("/collections/print", printFeesCollectionsSchoolReport);

router.post("/outstanding/preview", previewFeesOutstandingSchoolReport);
router.post("/outstanding/pdf", downloadFeesOutstandingSchoolReportPdf);
router.post("/outstanding/print", printFeesOutstandingSchoolReport);

export default router;
