import { Router } from "express";
import {
  downloadStaffSchoolReportPdf,
  previewStaffSchoolReport,
  printStaffSchoolReport,
} from "../controllers/adminStaffSchoolReportsController.js";

const router = Router();

router.post("/preview", previewStaffSchoolReport);
router.post("/pdf", downloadStaffSchoolReportPdf);
router.post("/print", printStaffSchoolReport);

export default router;
