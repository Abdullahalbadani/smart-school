// backend/src/routes/certificatesRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { CertificatesController } from "../controllers/certificatesController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/meta", CertificatesController.meta);

router.get("/:type/students", CertificatesController.students);
router.get("/:type", CertificatesController.list);

router.post("/:type", CertificatesController.create);
router.post("/:type/:id/printed", CertificatesController.markPrinted);

router.delete("/:type/:id", CertificatesController.remove);

export default router;