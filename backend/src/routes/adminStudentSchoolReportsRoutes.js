import { Router } from "express";
import {
  downloadStudentSchoolReportPdf,
  previewStudentSchoolReport,
  printStudentSchoolReport,
} from "../controllers/adminStudentSchoolReportsController.js";

const router = Router();

router.post("/preview", previewStudentSchoolReport);
router.post("/pdf", downloadStudentSchoolReportPdf);
router.post("/print", printStudentSchoolReport);

export default router;
