import { Router } from "express";
import {
  downloadStudentsAttendanceSchoolReportPdf,
  downloadTeachersAttendanceSchoolReportPdf,
  previewStudentsAttendanceSchoolReport,
  previewTeachersAttendanceSchoolReport,
  printStudentsAttendanceSchoolReport,
  printTeachersAttendanceSchoolReport,
} from "../controllers/adminAttendanceSchoolReportsController.js";

const router = Router();

router.post("/students/preview", previewStudentsAttendanceSchoolReport);
router.post("/students/pdf", downloadStudentsAttendanceSchoolReportPdf);
router.post("/students/print", printStudentsAttendanceSchoolReport);

router.post("/teachers/preview", previewTeachersAttendanceSchoolReport);
router.post("/teachers/pdf", downloadTeachersAttendanceSchoolReportPdf);
router.post("/teachers/print", printTeachersAttendanceSchoolReport);

export default router;
