// backend/src/routes/monthlyCertificatesRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { MonthlyCertificatesController } from "../controllers/monthlyCertificatesController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/meta", MonthlyCertificatesController.meta);
router.get("/students", MonthlyCertificatesController.students);
router.get("/", MonthlyCertificatesController.list);

router.post("/", MonthlyCertificatesController.create);
router.post("/:id/printed", MonthlyCertificatesController.markPrinted);

router.delete("/:id", MonthlyCertificatesController.remove);

export default router;