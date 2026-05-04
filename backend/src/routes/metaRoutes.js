import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getAcademicYears,
  getGrades,
  getClasses,
  searchStudents,
} from "../controllers/metaController.js";

const router = Router();

router.use(authMiddleware);

router.get("/academic-years", getAcademicYears);
router.get("/grades", getGrades);
router.get("/classes", getClasses);
router.get("/students/search", searchStudents);

export default router;