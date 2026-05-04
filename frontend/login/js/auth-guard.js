console.log("auth-guard.js loaded ✅");

function getRoleKeyFromUser(user) {
  // 1) لو السيرفر يرجع role_key جاهز
  const direct =
    (user && (user.role_key || user.roleKey || user.role_code || user.roleCode)) || "";
  if (direct) return String(direct).trim().toLowerCase();

  // 2) لو يرجع role/role_name كنص
  const name =
    (user && (user.role || user.role_name || user.roleName)) || "";
  const n = String(name).trim().toLowerCase();
  if (["admin", "teacher", "student", "parent"].includes(n)) return n;

  // 3) fallback للأرقام القديمة فقط
  const id = Number(user && user.role_id);
  if (id === 1) return "admin";
  if (id === 2) return "teacher";
  if (id === 3) return "student";
  if (id === 4) return "parent";

  // 4) رول جديد من RBAC -> غير معروف كـ key ثابت
  return "";
}

function dashboardUrlFor(roleKey) {
  if (roleKey === "admin") return "/frontend/admin/index.html";
  if (roleKey === "teacher") return "/frontend/teacher/index.html";
  if (roleKey === "student") return "/frontend/student/index.html";
  if (roleKey === "parent") return "/frontend/parent/index.html";

  // ✅ لو رول غير معروف، لا نرجع login افتراضيًا (لتجنب loop)
  // رجّعه للأدمن أو صفحة عامة حسب مشروعك
  return "/frontend/admin/index.html";
}

function logoutToLogin(reason) {
  console.warn("logoutToLogin:", reason || "");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/frontend/login/login.html");
}

function runAuthGuard() {
  console.log("runAuthGuard called");

  const token = localStorage.getItem("token");
  const userStr = localStorage.getItem("user");

  console.log("token:", token ? "exists" : "missing");
  console.log("userStr:", userStr ? "exists" : "missing");

  if (!token || !userStr) {
    logoutToLogin("Missing token/user");
    return;
  }

  let user;
  try {
    user = JSON.parse(userStr);
  } catch (e) {
    console.warn("stored user JSON invalid:", e);
    logoutToLogin("Bad user JSON");
    return;
  }

  const requiredRole = String(document.body?.dataset?.role || "")
    .trim()
    .toLowerCase();

  const userRoleKey = getRoleKeyFromUser(user);

  console.log("requiredRole (data-role):", requiredRole);
  console.log("user role:", { role_id: user.role_id, role_name: user.role_name, roleKey: userRoleKey });

  // ✅ إذا الصفحة ما حدّدت data-role لا نمنعها
  if (!requiredRole) return;

  // ✅ الأدمن: لا نمنع الدخول بناءً على role_id (لأن عندك RBAC)
  // التحكم الحقيقي يكون بالصلاحيات داخل القائمة و API
  if (requiredRole === "admin") {
    console.log("admin page -> allow (RBAC-based) ✅");
    return;
  }

  // باقي البوابات (teacher/student/parent) نطبق تحقق roleKey
  if (!userRoleKey) {
    alert("لا تملك صلاحية لفتح هذه الصفحة");
    logoutToLogin("Unknown roleKey for non-admin page");
    return;
  }

  if (userRoleKey !== requiredRole) {
    alert("لا تملك صلاحية لفتح هذه الصفحة");
    const url = dashboardUrlFor(userRoleKey);
    console.log("role mismatch -> redirecting to:", url);
    window.location.replace(url);
    return;
  }

  console.log("role matches, access granted ✅");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runAuthGuard);
} else {
  runAuthGuard();
}
