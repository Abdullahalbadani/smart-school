import { Router } from "express";
import  authMiddleware  from "../middleware/authMiddleware.js";
import  checkPermission  from "../middleware/checkPermission.js";
import { getSections } from "../controllers/sectionController.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  checkPermission("view_academic_years"),
  getSections
);

export default router;
