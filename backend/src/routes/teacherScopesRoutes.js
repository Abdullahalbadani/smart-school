import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { listTeacherScopes } from "../controllers/teacherScopesController.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/", listTeacherScopes);

export default router;