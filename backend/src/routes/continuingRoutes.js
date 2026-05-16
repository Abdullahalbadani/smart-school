import express from "express";
import {
  getContinuingMeta,
  listContinuingStudents,
  registerContinuingStudents,
} from "../controllers/continuingStudentsController.js";

const router = express.Router();

router.get("/continuing-students/meta", getContinuingMeta);
router.get("/continuing-students/students", listContinuingStudents);
router.post("/continuing-students/register", registerContinuingStudents);

export default router;