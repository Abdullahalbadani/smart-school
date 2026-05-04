// backend/src/routes/adminPermissionsRoutes.js
import { Router } from "express";
import { listPermissions, decidePermission, overridePermission } from "../controllers/adminPermissionsController.js";

const router = Router();

router.get("/permissions", listPermissions);
router.post("/permissions/:id/decide", decidePermission);
router.post("/permissions/:id/override", overridePermission);

export default router;
