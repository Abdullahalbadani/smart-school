// src/routes/assignTeachersRoutes.js
import { Router } from "express";
import { meta, sectionView, saveSection } from "../controllers/assignTeachersController.js";

// إذا عندك authMiddleware/checkPermission استخدمهم هنا
import  authMiddleware  from "../middleware/authMiddleware.js";
// import { checkPermission } from "../middleware/checkPermission.js";

const router = Router();

router.use(authMiddleware);
// router.use(checkPermission("timetables.assign_teachers"));

router.get("/meta", meta);
router.get("/section", sectionView);
router.post("/section", saveSection);

export default router;
