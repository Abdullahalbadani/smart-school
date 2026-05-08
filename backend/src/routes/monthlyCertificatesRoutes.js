import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
    getMonthlyCertificatesMeta,
  listEligibleStudents,
  createMonthlyCertificates,
  listMonthlyCertificates,
  markCertificatePrinted,
  deleteMonthlyCertificate,
} from "../controllers/monthlyCertificatesController.js";

const router = express.Router();

router.use(authMiddleware);
router.get("/meta", getMonthlyCertificatesMeta);
router.get("/students", listEligibleStudents);
router.get("/", listMonthlyCertificates);
router.post("/", createMonthlyCertificates);
router.post("/:id/printed", markCertificatePrinted);
router.delete("/:id", deleteMonthlyCertificate);

export default router;