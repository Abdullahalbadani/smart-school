
const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}
function isLoginPage() {
  const p = (location.pathname || "").toLowerCase();
  return p.includes("/frontend/login/");
}

function logoutToLogin(reason) {
  console.warn("logoutToLogin:", reason || "");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/frontend/login/login.html");
}

// ==============================
// 🛡 التحقق من صلاحية التوكن
// ==============================
async function validateToken() {
  // لا نتحقق داخل صفحة اللوجن
  if (isLoginPage()) return;

  const token = localStorage.getItem("token");
  if (!token) {
    logoutToLogin("No token");
    return;
  }

  try {
const res = await fetch(apiUrl("/auth/validate-token"), {
        method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    // ✅ 200 OK -> تمام
    if (res.ok) return;

    // ✅ 401: قد يكون توكن منتهي (أو endpoint محمي غلط)
    // بدل ما نطرد مباشرة: نجرب طلب بسيط أكثر "عمومية"
    // إذا ما عندك endpoint /users/me خليها كما هي، أو عدّلها للـ endpoint الموجود عندك
    if (res.status === 401) {
      console.warn("validate-token returned 401, probing /users/me ...");

      // probe (اختياري) — عدّل المسار إذا عندك /auth/me مثلاً
      let probeOk = false;
      try {
const probe = await fetch(apiUrl("/users/me"), {
            method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        // إذا probe رجع 200 => التوكن سليم و validate-token هو اللي محمي بصلاحيات
        if (probe.ok) probeOk = true;

        // إذا probe رجع 403 => التوكن سليم لكن ممنوع (صلاحيات)
        if (probe.status === 403) probeOk = true;
      } catch (e) {
        console.warn("probe failed:", e);
      }

      if (probeOk) {
        console.warn("Token seems valid; skipping logout (likely permission on validate-token).");
        return;
      }

      alert("انتهت الجلسة أو التوكن غير صالح. سجل الدخول مرة أخرى.");
      logoutToLogin("401 token invalid");
      return;
    }

    // ✅ 403 ممنوع = صلاحيات، لا نطرد
    if (res.status === 403) {
      console.warn("validate-token 403 (permission) -> do NOT logout");
      return;
    }

    console.warn("validate-token other status:", res.status);
  } catch (error) {
    console.error("Error validating token:", error);
  }
}

// استدعاء التحقق عند تحميل الصفحة
validateToken();
