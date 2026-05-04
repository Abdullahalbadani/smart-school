// src/routes/employeesRoutes.js
import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  employeesMeta,
  employeesList,
  employeeGet,
  employeeCreate,
  employeeUpdate,
  employeeDelete,
  employeeSetActive,
} from "../controllers/employeesController.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/meta", employeesMeta);
router.get("/", employeesList);
router.get("/:id", employeeGet);
router.post("/", employeeCreate);
router.put("/:id", employeeUpdate);
router.patch("/:id/active", employeeSetActive);
router.delete("/:id", employeeDelete);

export default router;