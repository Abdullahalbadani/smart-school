import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getStudentTermResults } from "../controllers/studentTermResultsController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getStudentTermResults);

export default router;