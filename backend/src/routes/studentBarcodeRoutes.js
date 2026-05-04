import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { StudentBarcodeController } from "../controllers/studentBarcodeController.js";

const router = express.Router();
router.use(authMiddleware);

router.get("/", StudentBarcodeController.getMyBarcode);

export default router;
