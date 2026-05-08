import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 🟢 1. استيراد المكتبات الخاصة بالسحر الحي (Socket.io)
import http from "http";
import { Server } from "socket.io";

// استيراد الروابط (Routes)
import publicRoutes from "./routes/public.routes.js";
import authRoutes from "./routes/authRoutes.js";
import moduleRoutes from "./routes/moduleRoutes.js";
import permissionRoutes from "./routes/permissionRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import permissionRoleRoutes from "./routes/permissionRoleRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
// import aiChatRoutes from "./routes/aiChatRoutes.js";
import academicYearRoutes from "./routes/academicYearRoutes.js";
import stageRoutes from "./routes/stageRoutes.js";
import gradeRoutes from "./routes/gradeRoutes.js";
import sectionRoutes from "./routes/sectionRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import parentsRoutes from "./routes/parentsRoutes.js";
import continuingRoutes from "./routes/continuingRoutes.js";
import timetablesRoutes from "./routes/timetablesRoutes.js";
import teacherTimetablesRoutes from "./routes/teacherTimetablesRoutes.js";
import studentPortalRoutes from "./routes/studentPortalRoutes.js";
import periodsRoutes from "./routes/periodsRoutes.js";
import parentPortalRoutes from "./routes/parentPortalRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import examTimetablesRoutes from "./routes/examTimetablesRoutes.js";
import employeesRoutes from "./routes/employeesRoutes.js";
import assignTeachersRoutes from "./routes/assignTeachersRoutes.js";
import schoolSettingsRoutes from "./routes/schoolSettingsRoutes.js";
import authMiddleware from "./middleware/authMiddleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import teacherAttendanceRoutes from "./routes/teacherAttendanceRoutes.js";
import teacherSessionsRoutes from "./routes/teacherSessionsRoutes.js";
import teacherDashboardRoutes from "./routes/teacherDashboardRoutes.js";
import teacherStudentsRoutes from "./routes/teacherStudentsRoutes.js";
import teacherProfileRoutes from "./routes/teacherProfileRoutes.js";
import parentPermissionsRoutes from "./routes/parentPermissionsRoutes.js";
import adminPermissionsRoutes from "./routes/adminPermissionsRoutes.js";
import parentAttendanceRoutes from "./routes/parentAttendanceRoutes.js";
import studentAttendanceRoutes from "./routes/studentAttendanceRoutes.js";
import studentBarcodeRoutes from "./routes/studentBarcodeRoutes.js";
import adminTeacherAttendanceRoutes from "./routes/adminTeacherAttendanceRoutes.js";
import adminTeacherPermitsRoutes from "./routes/adminTeacherPermitsRoutes.js";
import teacherPermitsRoutes from "./routes/teacherPermitsRoutes.js";
import teacherMeRoutes from "./routes/teacherMeRoutes.js";
import attendanceReportsRoutes from "./routes/attendanceReportsRoutes.js";
import notificationsInboxRoutes from "./routes/notificationsInboxRoutes.js";
import notificationsAdminRoutes from "./routes/notificationsAdminRoutes.js";
import teacherNotificationsRoutes from "./routes/teacherNotificationsRoutes.js";
import teacherNotificationsSendRoutes from "./routes/teacherNotificationsSendRoutes.js";
import studentNotificationsRoutes from "./routes/studentNotificationsRoutes.js";
import parentNotificationsRoutes from "./routes/parentNotificationsRoutes.js";
import teacherScopesRoutes from "./routes/teacherScopesRoutes.js";
import teacherAssessmentsRoutes from "./routes/teacherAssessmentsRoutes.js";
import teacherGradesRoutes from "./routes/teacherGradesRoutes.js";
import studentLearningRoutes from "./routes/studentLearningRoutes.js";
import parentRoutes from "./routes/parentRoutes.js";
import feesRoutes from "./routes/feesRoutes.js";
import metaRoutes from "./routes/metaRoutes.js";
import studentFeesPortalRoutes from "./routes/studentFeesPortalRoutes.js";
import parentFeesPortalRoutes from "./routes/parentFeesPortalRoutes.js";
import feeRulesRoutes from "./routes/feeRulesRoutes.js";
import { startFeesCronJob } from "./utils/feesCron.js";
import teacherReportsRoutes from "./routes/teacherReportsRoutes.js";
import adminAssessmentsRoutes from './routes/adminAssessmentsRoutes.js';
import adminTermWorksRoutes from "./routes/adminTermWorksRoutes.js";
import adminTermResultsRoutes from "./routes/adminTermResultsRoutes.js";
// ✅ استيراد ملفات مراقبة النشاطات (لاحظ الأقواس المعكوفة للميدل وير)
import { autoActivityLogger } from './middleware/activityLogger.js';
import activityRoutes from './routes/activityRoutes.js'; 
import monthlyCertificatesRoutes from "./routes/monthlyCertificatesRoutes.js";
import studentTermResultsRoutes from "./routes/studentTermResultsRoutes.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ تعريف مسار مجلد الواجهة الأمامية
const frontendPath = path.join(__dirname, "../../frontend");

dotenv.config();

const app = express();

// 🟢 2. إنشاء سيرفر HTTP
const httpServer = http.createServer(app);

// 🟣 CORS (معدل لدعم Subdomains المتعددة للمدارس)
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (/localhost/.test(origin) || /127\.0\.0\.1/.test(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "x-school-slug"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// 🟢 3. إعداد Socket.io
const io = new Server(httpServer, {
  cors: corsOptions,
});

app.set("io", io);

// 🟢 5. WebSockets
io.on("connection", (socket) => {
  const schoolId = socket.handshake.query.schoolId;
  
  if (schoolId) {
    socket.join(`school_${schoolId}`);
    console.log(`🏫 [Socket] Client joined school room: school_${schoolId}`);
  }

  socket.on("join_user_room", (userId) => {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return;
    socket.join(`user_${id}`);
    console.log(`👤 [Socket] user_${id} joined personal room`);
  });

  socket.on("join_teacher_room", (teacherId) => {
    socket.join(`teacher_${teacherId}`);
    console.log(`👨‍🏫 [Socket] Teacher ${teacherId} joined room`);
  });

  socket.on("disconnect", () => {
    console.log("❌ [Socket] Client disconnected");
  });
});

// 🟣 Middlewares الأساسية
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ تقديم ملفات الواجهة
app.use("/frontend", express.static(frontendPath));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ==========================================
// 🔓 1. الروابط العامة (لا تحتاج تسجيل دخول)
// ==========================================
app.use("/api/public", publicRoutes); 
app.use("/api/auth", authRoutes);     

// ==========================================
// 🔥 مراقب الأحداث المركزي (Audit Trail Logger)
// يوضع هنا لكي لا يراقب الروابط العامة، ويبدأ المراقبة لما تحته
// ==========================================
app.use(autoActivityLogger);

// ==========================================
// 🔒 2. الروابط المحمية (تحتاج توكن وصلاحيات - authMiddleware)
// ==========================================

// 👈 إضافة مسار جلب النشاطات للوحة التحكم
app.use('/api', activityRoutes); 

// روابط النظام الأساسية
app.use("/api/modules", authMiddleware, moduleRoutes);
app.use("/api/permissions", authMiddleware, permissionRoutes);
app.use("/api/roles", authMiddleware, roleRoutes);
app.use("/api/role-permissions", authMiddleware, permissionRoleRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/profile", authMiddleware, profileRoutes);
// app.use("/api/ai-chat", authMiddleware, aiChatRoutes);

// الهيكل التنظيمي
app.use("/api/academic-years", authMiddleware, academicYearRoutes);
app.use("/api/stages", authMiddleware, stageRoutes);
app.use("/api/grades", authMiddleware, gradeRoutes);
app.use("/api/sections", authMiddleware, sectionRoutes);
app.use("/api/students", authMiddleware, studentRoutes);
app.use("/api/periods", authMiddleware, periodsRoutes);
app.use("/api/dashboard", authMiddleware, dashboardRoutes);
app.use("/api/admin/monthly-certificates", monthlyCertificatesRoutes);
// بوابة المعلم
app.use("/api/teacher/attendance", authMiddleware, teacherAttendanceRoutes);
app.use("/api/teacher/sessions", authMiddleware, teacherSessionsRoutes);
app.use("/api/teacher/profile", authMiddleware, teacherProfileRoutes);
app.use("/api/teacher/timetables", authMiddleware, teacherTimetablesRoutes);
app.use("/api/teacher", authMiddleware, teacherDashboardRoutes);
app.use("/api/teacher/students", authMiddleware, teacherStudentsRoutes);
app.use("/api/teacher/me", authMiddleware, teacherMeRoutes);
app.use("/api/teacher/permits", authMiddleware, teacherPermitsRoutes);
app.use("/api/teacher/scopes", authMiddleware, teacherScopesRoutes);
app.use("/api/teacher/assessments", authMiddleware, teacherAssessmentsRoutes);
app.use("/api/teacher/grades", authMiddleware, teacherGradesRoutes);
app.use("/api/teacher/reports", authMiddleware, teacherReportsRoutes);
app.use("/api/teacher/notifications", authMiddleware, teacherNotificationsRoutes);
app.use("/api/admin/term-results", adminTermResultsRoutes);
// الإشعارات
app.use("/api/notifications/admin", authMiddleware, notificationsAdminRoutes);
app.use("/api/notifications", authMiddleware, notificationsInboxRoutes);
app.use("/api/teacher/notifications", authMiddleware, teacherNotificationsSendRoutes);
app.use("/api/student/notifications", authMiddleware, studentNotificationsRoutes);
app.use("/api/parent/notifications", authMiddleware, parentNotificationsRoutes);
app.use("/api/student/term-results", studentTermResultsRoutes);
// بوابة الطالب وولي الأمر
app.use("/api/student/attendance", authMiddleware, studentAttendanceRoutes);
app.use("/api/student/barcode", authMiddleware, studentBarcodeRoutes);
app.use("/api/student/learning", authMiddleware, studentLearningRoutes);
app.use("/api/student", authMiddleware, studentPortalRoutes);

app.use("/api/parent/attendance", authMiddleware, parentAttendanceRoutes);
app.use("/api/parent/permissions", authMiddleware, parentPermissionsRoutes);
app.use("/api/parent", authMiddleware, parentPortalRoutes);
app.use("/api/parent", authMiddleware, parentRoutes);

// الإدارة والمالية
app.use("/api/employees", authMiddleware, employeesRoutes);
app.use("/api/admin/assign-teachers", authMiddleware, assignTeachersRoutes);
app.use("/api/admin/school-settings", authMiddleware, schoolSettingsRoutes);
app.use("/api/admin/teacher-attendance", authMiddleware, adminTeacherAttendanceRoutes);
app.use("/api/admin/teacher-permits", authMiddleware, adminTeacherPermitsRoutes);
app.use("/api/admin/reports", authMiddleware, attendanceReportsRoutes);
app.use("/api/admin", authMiddleware, adminPermissionsRoutes);
app.use("/api/admin/fee-rules", authMiddleware, feeRulesRoutes);
app.use("/api/admin/control", authMiddleware, adminTermWorksRoutes);
app.use('/api/admin-assessments', adminAssessmentsRoutes);
// الجداول الزمنية والاختبارات
app.use("/api/timetables", authMiddleware, timetablesRoutes);
app.use("/api/exam-timetables", authMiddleware, examTimetablesRoutes);

// الروابط العامة التي تستخدم "/api" مباشرة
app.use("/api", authMiddleware, feesRoutes);
app.use("/api", authMiddleware, studentFeesPortalRoutes);
app.use("/api", authMiddleware, parentFeesPortalRoutes);
app.use("/api", authMiddleware, metaRoutes);
app.use("/api", authMiddleware, parentsRoutes);
app.use("/api", authMiddleware, continuingRoutes);

// معالج الأخطاء (يجب أن يكون في النهاية دائماً)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// تشغيل فحص الرسوم التلقائي
startFeesCronJob(io);

// تشغيل السيرفر
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.io is ready!`);
  console.log(`🌐 Frontend: http://localhost:${PORT}/frontend/register/register.html`);
});