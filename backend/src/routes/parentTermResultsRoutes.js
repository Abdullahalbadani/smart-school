import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getParentChildTermResults } from "../controllers/parentTermResultsController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getParentChildTermResults);

export default router;