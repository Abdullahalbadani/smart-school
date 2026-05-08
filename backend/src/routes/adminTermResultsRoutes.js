import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getTermResults,
  calculateTermResults,
  approveTermResults,
  publishTermResults,
  unpublishTermResults,
} from "../controllers/adminTermResultsController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", getTermResults);
router.post("/calculate", calculateTermResults);
router.post("/approve", approveTermResults);
router.post("/publish", publishTermResults);
router.post("/unpublish", unpublishTermResults);

export default router;