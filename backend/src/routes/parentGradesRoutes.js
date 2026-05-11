import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getParentChildAssessmentGrades } from "../controllers/parentGradesController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getParentChildAssessmentGrades);

export default router;