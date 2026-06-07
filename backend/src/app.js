import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";
import platformAuthMiddleware from "./middleware/platformAuthMiddleware.js";
import platformAuthRoutes from "./routes/platformAuthRoutes.js";
import platformSchoolsRoutes from "./routes/platformSchoolsRoutes.js";
// Middlewares
import authMiddleware from "./middleware/authMiddleware.js";
import { tenantMiddleware } from "./middleware/tenantMiddleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { autoActivityLogger } from "./middleware/activityLogger.js";
import xssSanitizer from "./middleware/xssSanitizer.js";

// Utils
import { startFeesCronJob } from "./utils/feesCron.js";
import { startSubscriptionsCronJob } from "./utils/subscriptionsCron.js";

// Public/Auth Routes
import publicRoutes from "./routes/public.routes.js";
import authRoutes from "./routes/authRoutes.js";
import googleAuthRouter from "./routes/googleAuthRouter.js"; // 🟢 إضافة استيراد راوتر قوقل درايف
// Core System Routes
import moduleRoutes from "./routes/moduleRoutes.js";
import permissionRoutes from "./routes/permissionRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import permissionRoleRoutes from "./routes/permissionRoleRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import studentTransferRequestsRoutes from "./routes/studentTransferRequestsRoutes.js";
// Academic Structure Routes
import academicYearRoutes from "./routes/academicYearRoutes.js";
import stageRoutes from "./routes/stageRoutes.js";
import gradeRoutes from "./routes/gradeRoutes.js";
import sectionRoutes from "./routes/sectionRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import parentsRoutes from "./routes/parentsRoutes.js";
import continuingRoutes from "./routes/continuingRoutes.js";
import periodsRoutes from "./routes/periodsRoutes.js";
import staffReportsRoutes from "./routes/staffReportsRoutes.js";
import certificatesRoutes from "./routes/certificatesRoutes.js";
// Timetables and Exams Routes
import timetablesRoutes from "./routes/timetablesRoutes.js";
import teacherTimetablesRoutes from "./routes/teacherTimetablesRoutes.js";
import examTimetablesRoutes from "./routes/examTimetablesRoutes.js";
import studentReportsRoutes from "./routes/studentReportsRoutes.js";
import adminStudentSchoolReportsRoutes from "./routes/adminStudentSchoolReportsRoutes.js";
// Student Portal Routes
import studentPortalRoutes from "./routes/studentPortalRoutes.js";
import studentAttendanceRoutes from "./routes/studentAttendanceRoutes.js";
import studentBarcodeRoutes from "./routes/studentBarcodeRoutes.js";
import studentLearningRoutes from "./routes/studentLearningRoutes.js";
import studentNotificationsRoutes from "./routes/studentNotificationsRoutes.js";
import studentFeesPortalRoutes from "./routes/studentFeesPortalRoutes.js";
import studentTermResultsRoutes from "./routes/studentTermResultsRoutes.js";
// 1. أضف الاستيراد في قسم الاستيرادات
import adminTeachersRoutes from "./routes/adminTeachersRoutes.js";

// 2. أضف في قسم Protected Routes
// Parent Portal Routes
import parentPortalRoutes from "./routes/parentPortalRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import parentPermissionsRoutes from "./routes/parentPermissionsRoutes.js";
import parentAttendanceRoutes from "./routes/parentAttendanceRoutes.js";
import parentNotificationsRoutes from "./routes/parentNotificationsRoutes.js";
import parentFeesPortalRoutes from "./routes/parentFeesPortalRoutes.js";
import parentTermResultsRoutes from "./routes/parentTermResultsRoutes.js";
import parentGradesRoutes from "./routes/parentGradesRoutes.js";

// Teacher Portal Routes
import teacherAttendanceRoutes from "./routes/teacherAttendanceRoutes.js";
import teacherSessionsRoutes from "./routes/teacherSessionsRoutes.js";
import teacherDashboardRoutes from "./routes/teacherDashboardRoutes.js";
import teacherStudentsRoutes from "./routes/teacherStudentsRoutes.js";
import teacherProfileRoutes from "./routes/teacherProfileRoutes.js";
import teacherPermitsRoutes from "./routes/teacherPermitsRoutes.js";
import teacherMeRoutes from "./routes/teacherMeRoutes.js";
import teacherScopesRoutes from "./routes/teacherScopesRoutes.js";
import teacherAssessmentsRoutes from "./routes/teacherAssessmentsRoutes.js";
import teacherGradesRoutes from "./routes/teacherGradesRoutes.js";
import teacherReportsRoutes from "./routes/teacherReportsRoutes.js";
import teacherNotificationsRoutes from "./routes/teacherNotificationsRoutes.js";
import teacherNotificationsSendRoutes from "./routes/teacherNotificationsSendRoutes.js";

// Admin Routes
import employeesRoutes from "./routes/employeesRoutes.js";
import assignTeachersRoutes from "./routes/assignTeachersRoutes.js";
import schoolSettingsRoutes from "./routes/schoolSettingsRoutes.js";
import adminPermissionsRoutes from "./routes/adminPermissionsRoutes.js";
import adminTeacherAttendanceRoutes from "./routes/adminTeacherAttendanceRoutes.js";
import adminTeacherPermitsRoutes from "./routes/adminTeacherPermitsRoutes.js";
import attendanceReportsRoutes from "./routes/attendanceReportsRoutes.js";
import adminAssessmentsRoutes from "./routes/adminAssessmentsRoutes.js";
import assessmentReopenRequestsRoutes from "./routes/assessmentReopenRequestsRoutes.js";
import adminTermWorksRoutes from "./routes/adminTermWorksRoutes.js";
import adminTermResultsRoutes from "./routes/adminTermResultsRoutes.js";
import monthlyCertificatesRoutes from "./routes/monthlyCertificatesRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import { startBackupsCronJob } from "./utils/backupsCron.js";

// Notifications Routes
import notificationsInboxRoutes from "./routes/notificationsInboxRoutes.js";
import notificationsAdminRoutes from "./routes/notificationsAdminRoutes.js";

// Fees and Meta Routes
import feeAdjustmentRequestsRoutes from "./routes/feeAdjustmentRequestsRoutes.js";
import feesRoutes from "./routes/feesRoutes.js";
import feeRulesRoutes from "./routes/feeRulesRoutes.js";
import metaRoutes from "./routes/metaRoutes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "../../frontend");

const app = express();
const httpServer = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5000",
  "http://localhost:3000",
  "http://127.0.0.1:5000",
  process.env.FRONTEND_URL,
  process.env.RENDER_EXTERNAL_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

   if (allowedOrigins.includes(origin)) {
  return cb(null, true);
}

// السماح بأي subdomain محلي مثل al-king.localhost:5000
if (/^http:\/\/([a-z0-9-]+\.)?localhost:\d+$/i.test(origin)) {
  return cb(null, true);
}

if (/^http:\/\/127\.0\.0\.1:\d+$/i.test(origin)) {
  return cb(null, true);
}

// السماح بروابط Render
if (/^https:\/\/.+\.onrender\.com$/.test(origin)) {
  return cb(null, true);
}
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-school-slug",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 200,
};
const io = new Server(httpServer, {
  cors: corsOptions,
});

app.set("io", io);

io.on("connection", (socket) => {
  const schoolId = socket.handshake.query.schoolId;

  if (schoolId) {
    socket.join(`school_${schoolId}`);
    console.log(`[Socket] Client joined school room: school_${schoolId}`);
  }

  socket.on("join_user_room", (userId) => {
    const id = Number(userId);

    if (!Number.isInteger(id) || id <= 0) return;

    socket.join(`user_${id}`);
    console.log(`[Socket] user_${id} joined personal room`);
  });

  socket.on("join_teacher_room", (teacherId) => {
    socket.join(`teacher_${teacherId}`);
    console.log(`[Socket] Teacher ${teacherId} joined room`);
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Client disconnected");
  });
});

function mountRoutes(routes) {
  routes.forEach(({ path, middlewares = [], router }) => {
    app.use(path, ...middlewares, router);
  });
}

// ==============================
// Basic Middlewares
// ==============================
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const query = req.query;
  Object.defineProperty(req, 'query', {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true
  });
  next();
});
app.use(xssSanitizer);

// ==============================
// Static Files
// ==============================
app.use("/frontend", express.static(frontendPath));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.get("/", (req, res) => {
  res.redirect("/frontend/register/register.html");
});
// ==============================
// Public Routes
// لا تحتاج تسجيل دخول
// ==============================
// ==============================
// Public Routes
// لا تحتاج تسجيل دخول
// ==============================
mountRoutes([
  { path: "/api/public", router: publicRoutes },
  { path: "/api/auth", router: authRoutes },
  { path: "/api/platform/auth", router: platformAuthRoutes },
  { path: "/api/public/auth", router: googleAuthRouter }, // 🟢 حقن مسارات قوقل درايف (Init & Callback)
]);

// ==============================
// Activity Logger
// يبدأ بعد الروابط العامة
// ==============================
app.use(autoActivityLogger);

// ==============================
// Open Routes
// هذه المسارات كانت بدون authMiddleware في النسخة القديمة
// لذلك نتركها كما هي الآن حتى لا ينكسر النظام
// ==============================
mountRoutes([
  { path: "/api", router: activityRoutes },
  { path: "/api/admin/certificates" ,  router: certificatesRoutes },
  { path: "/api/admin/monthly-certificates", router: monthlyCertificatesRoutes },
  { path: "/api/admin/term-results", router: adminTermResultsRoutes },
  { path: "/api/admin-assessments", router: adminAssessmentsRoutes },
  { path: "/api/student/term-results", router: studentTermResultsRoutes },
  { path: "/api/parent/term-results", router: parentTermResultsRoutes },
  { path: "/api/parent/grades", router: parentGradesRoutes },
]);
mountRoutes([
  {
    path: "/api/platform",
    middlewares: [platformAuthMiddleware],
    router: platformSchoolsRoutes,
  },
]);
// ==============================
// Protected Routes
// تحتاج تسجيل دخول
// ==============================
const protectedMiddlewares = [authMiddleware, tenantMiddleware];

mountRoutes([
  // Core System
  { path: "/api/modules", middlewares: protectedMiddlewares, router: moduleRoutes },
  { path: "/api/permissions", middlewares: protectedMiddlewares, router: permissionRoutes },
  { path: "/api/roles", middlewares: protectedMiddlewares, router: roleRoutes },
  { path: "/api/role-permissions", middlewares: protectedMiddlewares, router: permissionRoleRoutes },
  { path: "/api/users", middlewares: protectedMiddlewares, router: userRoutes },
  { path: "/api/profile", middlewares: protectedMiddlewares, router: profileRoutes },
  { path: "/api/dashboard", middlewares: protectedMiddlewares, router: dashboardRoutes },

  // Academic Structure
  { path: "/api/academic-years", middlewares: protectedMiddlewares, router: academicYearRoutes },
  { path: "/api/stages", middlewares: protectedMiddlewares, router: stageRoutes },
  { path: "/api/grades", middlewares: protectedMiddlewares, router: gradeRoutes },
  { path: "/api/sections", middlewares: protectedMiddlewares, router: sectionRoutes },
  { path: "/api/students", middlewares: protectedMiddlewares, router: studentRoutes },
  { path: "/api/periods", middlewares: protectedMiddlewares, router: periodsRoutes },

  // Teacher Portal
  { path: "/api/teacher/attendance", middlewares: protectedMiddlewares, router: teacherAttendanceRoutes },
  { path: "/api/teacher/sessions", middlewares: protectedMiddlewares, router: teacherSessionsRoutes },
  { path: "/api/teacher/profile", middlewares: protectedMiddlewares, router: teacherProfileRoutes },
  { path: "/api/teacher/timetables", middlewares: protectedMiddlewares, router: teacherTimetablesRoutes },
  { path: "/api/teacher", middlewares: protectedMiddlewares, router: teacherDashboardRoutes },
  { path: "/api/teacher/students", middlewares: protectedMiddlewares, router: teacherStudentsRoutes },
  { path: "/api/teacher/me", middlewares: protectedMiddlewares, router: teacherMeRoutes },
  { path: "/api/teacher/permits", middlewares: protectedMiddlewares, router: teacherPermitsRoutes },
  { path: "/api/teacher/scopes", middlewares: protectedMiddlewares, router: teacherScopesRoutes },
  { path: "/api/teacher/assessments", middlewares: protectedMiddlewares, router: teacherAssessmentsRoutes },
  { path: "/api/teacher/grades", middlewares: protectedMiddlewares, router: teacherGradesRoutes },
  { path: "/api/teacher/reports", middlewares: protectedMiddlewares, router: teacherReportsRoutes },
  { path: "/api/teacher/notifications", middlewares: protectedMiddlewares, router: teacherNotificationsRoutes },
  { path: "/api/teacher/notifications", middlewares: protectedMiddlewares, router: teacherNotificationsSendRoutes },
{ path: "/api/admin/teachers", middlewares: protectedMiddlewares, router: adminTeachersRoutes },

  // Student Portal
  { path: "/api/student/attendance", middlewares: protectedMiddlewares, router: studentAttendanceRoutes },
  { path: "/api/student/barcode", middlewares: protectedMiddlewares, router: studentBarcodeRoutes },
  { path: "/api/student/learning", middlewares: protectedMiddlewares, router: studentLearningRoutes },
  { path: "/api/student/notifications", middlewares: protectedMiddlewares, router: studentNotificationsRoutes },
  { path: "/api/student", middlewares: protectedMiddlewares, router: studentPortalRoutes },
{ path: "/api/admin/reports/students", middlewares: protectedMiddlewares, router: studentReportsRoutes },
  { path: "/api/admin/school-reports/students", middlewares: protectedMiddlewares, router: adminStudentSchoolReportsRoutes },
  // Parent Portal
  { path: "/api/parent/attendance", middlewares: protectedMiddlewares, router: parentAttendanceRoutes },
  { path: "/api/parent/notifications", middlewares: protectedMiddlewares, router: parentNotificationsRoutes },
  { path: "/api/parent", middlewares: protectedMiddlewares, router: parentPermissionsRoutes },
  { path: "/api/parent", middlewares: protectedMiddlewares, router: parentPortalRoutes },
  { path: "/api/parent", middlewares: protectedMiddlewares, router: parentRoutes },
{ path: "/api/admin/reports/staff", middlewares: protectedMiddlewares, router: staffReportsRoutes },  // Admin
  { path: "/api/employees", middlewares: protectedMiddlewares, router: employeesRoutes },
  { path: "/api/admin/assign-teachers", middlewares: protectedMiddlewares, router: assignTeachersRoutes },
  { path: "/api/admin/school-settings", middlewares: protectedMiddlewares, router: schoolSettingsRoutes },
  { path: "/api/admin/backups", middlewares: protectedMiddlewares, router: backupRoutes },
  { path: "/api/admin/teacher-attendance", middlewares: protectedMiddlewares, router: adminTeacherAttendanceRoutes },
  { path: "/api/admin/teacher-permits", middlewares: protectedMiddlewares, router: adminTeacherPermitsRoutes },
  { path: "/api/admin/reports", middlewares: protectedMiddlewares, router: attendanceReportsRoutes },
  { path: "/api/admin/assessment-reopen-requests", middlewares: protectedMiddlewares, router: assessmentReopenRequestsRoutes },
  { path: "/api/admin/fee-adjustment-requests", middlewares: protectedMiddlewares, router: feeAdjustmentRequestsRoutes },
  { path: "/api/admin/student-transfer-requests", middlewares: protectedMiddlewares, router: studentTransferRequestsRoutes },
  { path: "/api/admin", middlewares: protectedMiddlewares, router: adminPermissionsRoutes },
  { path: "/api/admin/fee-rules", middlewares: protectedMiddlewares, router: feeRulesRoutes },
  { path: "/api/admin/control", middlewares: protectedMiddlewares, router: adminTermWorksRoutes },

  // Timetables and Exams
  { path: "/api/timetables", middlewares: protectedMiddlewares, router: timetablesRoutes },
  { path: "/api/exam-timetables", middlewares: protectedMiddlewares, router: examTimetablesRoutes },

  // Fees and Meta
  { path: "/api", middlewares: protectedMiddlewares, router: feesRoutes },
  { path: "/api", middlewares: protectedMiddlewares, router: studentFeesPortalRoutes },
  { path: "/api", middlewares: protectedMiddlewares, router: parentFeesPortalRoutes },
  { path: "/api", middlewares: protectedMiddlewares, router: metaRoutes },
{ path: "/api/parents", middlewares: protectedMiddlewares, router: parentsRoutes },
  { path: "/api", middlewares: protectedMiddlewares, router: continuingRoutes },

  // Notifications
  { path: "/api/notifications/admin", middlewares: protectedMiddlewares, router: notificationsAdminRoutes },
  { path: "/api/notifications", middlewares: protectedMiddlewares, router: notificationsInboxRoutes },
]);

// ==============================
// Error Handler
// ==============================
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

startFeesCronJob(io);
startSubscriptionsCronJob();
startBackupsCronJob();
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Socket.io is ready!");
  console.log(`Frontend: http://localhost:${PORT}/frontend/register/register.html`);
});