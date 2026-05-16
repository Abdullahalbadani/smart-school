import express from "express";
import {
  getPlatformDashboard,
  listSchools,
  getSchoolDetails,
  activateTrial,
  activateSubscription,
  suspendSchool,
  impersonateSchoolAdmin,
  reactivateSchool,
  getSchoolFullDetails,
listPlatformActivityLogs,
getSubscriptionAlerts,
} from "../controllers/platformSchoolsController.js";

const router = express.Router();
router.get("/dashboard", getPlatformDashboard);
router.get("/activity-logs", listPlatformActivityLogs);
router.get("/subscription-alerts", getSubscriptionAlerts);

router.get("/schools", listSchools);
router.get("/schools/:id/full-details", getSchoolFullDetails);
router.get("/schools/:id", getSchoolDetails);

router.post("/schools/:id/trial", activateTrial);
router.post("/schools/:id/subscription", activateSubscription);
router.post("/schools/:id/suspend", suspendSchool);
router.post("/schools/:id/reactivate", reactivateSchool);
router.post("/schools/:id/impersonate", impersonateSchoolAdmin);

export default router;