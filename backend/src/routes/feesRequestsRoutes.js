// import express from "express";
// import authMiddleware from "../middleware/authMiddleware.js";
// import { uploadFeesRequestImages } from "../middleware/uploadFeesRequests.js";
// import { FeesRequestsController } from "../controllers/feesRequestsController.js";

// const router = express.Router();

// // إنشاء طلب دفع (multipart/form-data) + صور متعددة
// router.post("/fees/requests", authMiddleware, (req, res, next) => {
//   uploadFeesRequestImages(req, res, (err) => {
//     if (err) return res.status(400).json({ message: err.message });
//     next();
//   });
// }, FeesRequestsController.create);

// router.get("/fees/requests", authMiddleware, FeesRequestsController.list);
// router.get("/fees/requests/:id", authMiddleware, FeesRequestsController.read);

// router.post("/fees/requests/:id/approve", authMiddleware, FeesRequestsController.approve);
// router.post("/fees/requests/:id/reject", authMiddleware, FeesRequestsController.reject);

// export default router;
