// /frontend/shared/profile-account.js
// سكربت مشترك لكل الواجهات (أدمن، طالب، معلم، ولي أمر)
// مسؤول عن: تغيير كلمة المرور، تغيير البريد، تسجيل الخروج، تعبئة بيانات الملف الشخصي
console.log("profile-account.js loaded");

(function () {
  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const apiUrl =
  typeof window.apiUrl === "function"
    ? window.apiUrl
    : function (path = "") {
        if (/^https?:\/\//i.test(path)) return path;

        let cleanPath = String(path || "").replace(/^\/+/, "");

        if (cleanPath.startsWith("api/")) {
          cleanPath = cleanPath.slice(4);
        }

        return `${API_BASE}/${cleanPath}`;
      };
  // =========================
  // Toast داخلي مشترك
  // =========================
  function ensureFallbackToastElement() {
    let el = document.getElementById("global-profile-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "global-profile-toast";
      el.style.position = "fixed";
      el.style.bottom = "1.2rem";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.background = "linear-gradient(120deg,#2563eb,#0ea5e9)";
      el.style.color = "#fff";
      el.style.padding = "0.5rem 1.2rem";
      el.style.borderRadius = "999px";
      el.style.fontSize = "0.8rem";
      el.style.boxShadow = "0 18px 40px rgba(37,99,235,.5)";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      el.style.transition = "opacity .25s ease";
      el.style.zIndex = "9999";
      document.body.appendChild(el);
    }
    return el;
  }

  function internalToast(message, type) {
    // لو الصفحة عندها showToast خاص (مثل صفحة الطالب) نستعمله
    if (typeof window.showToast === "function") {
      try {
        window.showToast(message, type);
        return;
      } catch (e) {
        console.warn("page showToast error, using fallback", e);
      }
    }

    // Toast افتراضي مشترك
    const el = ensureFallbackToastElement();
    el.textContent = message;

    if (type === "error") {
      el.style.background = "linear-gradient(120deg,#ef4444,#b91c1c)";
    } else if (type === "success") {
      el.style.background = "linear-gradient(120deg,#22c55e,#16a34a)";
    } else {
      el.style.background = "linear-gradient(120deg,#2563eb,#0ea5e9)";
    }

    clearTimeout(internalToast._timer);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      internalToast._timer = setTimeout(() => {
        el.style.opacity = "0";
      }, 2600);
    });
  }

  // =========================
  // استدعاء API خاص بالبروفايل
  // =========================
  async function profileApiRequest(subPath, payload) {
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
const res = await fetch(apiUrl(`/profile${subPath}`), {        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      // الجلسة منتهية
      if (res.status === 401) {
        let msg = "انتهت الجلسة، الرجاء تسجيل الدخول من جديد.";
        try {
          const txt = await res.text();
          const data = JSON.parse(txt);
          if (data.message) msg = data.message;
        } catch (_) {}
        internalToast(msg, "error");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setTimeout(() => {
          window.location.href = "/frontend/login/login.html";
        }, 900);
        return null;
      }

      const txt = await res.text();

      if (!res.ok) {
        let msg = "حدث خطأ في الخادم.";
        try {
          const data = JSON.parse(txt);
          if (data.message) msg = data.message;
        } catch (_) {}
        internalToast(msg, "error");
        throw new Error(msg);
      }

      if (!txt) return null;
      try {
        return JSON.parse(txt);
      } catch (_) {
        return null;
      }
    } catch (err) {
      console.error("Profile API error:", err);
      internalToast(err.message || "حدث خطأ غير متوقع", "error");
      throw err;
    }
  }

  // =========================
  // تعبئة بيانات البروفايل من localStorage.user
  // =========================
  function fillProfileFromUser() {
    const userStr = localStorage.getItem("user");
    if (!userStr) return;

    try {
      const user = JSON.parse(userStr);
      const name =
        user.name || user.full_name || user.username || "مستخدم";
      const email = user.email || "";
      const role =
        user.role || user.role_name || user.roleName || "";

      const profileName = document.getElementById("profile-name");
      const profileEmail = document.getElementById("profile-email");
      const profileRole = document.getElementById("profile-role");
      const currentEmailInput = document.getElementById("currentEmail");

      const navbarUsername = document.getElementById("navbar-username");
      const navbarRole = document.getElementById("navbar-role");
      const navbarLetter =
        document.getElementById("navbar-avatar-letter") ||
        document.getElementById("student-avatar-letter");

      if (profileName) profileName.textContent = name;
      if (profileEmail && email) profileEmail.textContent = email;
      if (profileRole) profileRole.textContent = role || "حساب";
      if (currentEmailInput && email) currentEmailInput.value = email;
      if (navbarUsername) navbarUsername.textContent = name;
      if (navbarRole) navbarRole.textContent = role || "حساب";
      if (navbarLetter) navbarLetter.textContent = name.charAt(0) || "م";
    } catch (e) {
      console.warn("cannot fill profile from user:", e);
    }
  }

  // =========================
  // ربط الفورمات والأزرار
  // =========================
  document.addEventListener("DOMContentLoaded", () => {
    fillProfileFromUser();

    // تغيير كلمة المرور
    const changePasswordForm = document.getElementById("changePasswordForm");
    if (changePasswordForm) {
      changePasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const current = document
          .getElementById("currentPassword")
          ?.value.trim();
        const np = document
          .getElementById("newPassword")
          ?.value.trim();
        const cp = document
          .getElementById("confirmNewPassword")
          ?.value.trim();

        if (!current || !np || !cp) {
          internalToast("الرجاء تعبئة جميع الحقول.", "error");
          return;
        }
        if (np !== cp) {
          internalToast(
            "كلمة المرور الجديدة وتأكيدها غير متطابقتين.",
            "error"
          );
          return;
        }
        if (np.length < 6) {
          internalToast(
            "يفضل أن تكون كلمة المرور 6 أحرف/أرقام على الأقل.",
            "error"
          );
          return;
        }

        try {
          await profileApiRequest("/password", {
            currentPassword: current,
            newPassword: np,
          });

          internalToast(
            "تم تغيير كلمة المرور بنجاح، سيتم تسجيل خروجك الآن.",
            "success"
          );
          changePasswordForm.reset();

          // إغلاق المودال (لو موجود)
          const modal = document.getElementById("change-password-modal");
          const overlay = document.getElementById("modal-overlay");
          if (modal) modal.style.display = "none";
          if (overlay) overlay.style.display = "none";

          localStorage.removeItem("token");
          localStorage.removeItem("user");
          setTimeout(() => {
            window.location.href = "/frontend/login/login.html";
          }, 900);
        } catch (_) {
          // الخطأ تم إظهاره داخل profileApiRequest
        }
      });
    }

    // تغيير البريد
    const changeEmailForm = document.getElementById("changeEmailForm");
    if (changeEmailForm) {
      changeEmailForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        let newEmail = document
          .getElementById("newEmail")
          ?.value.trim();

        if (!newEmail) {
          internalToast("الرجاء إدخال بريد جديد.", "error");
          return;
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
          internalToast("صيغة البريد الإلكتروني غير صحيحة.", "error");
          return;
        }

        try {
          const data = await profileApiRequest("/email", { newEmail });
          if (data && data.email) {
            newEmail = data.email;
          }

          internalToast("تم تحديث البريد الإلكتروني بنجاح.", "success");

          // تحديث user في localStorage
          try {
            const userStr = localStorage.getItem("user");
            const oldUser = userStr ? JSON.parse(userStr) : {};
            const updatedUser = { ...oldUser, email: newEmail };
            localStorage.setItem("user", JSON.stringify(updatedUser));
          } catch (_) {}

          const currentEmailInput = document.getElementById("currentEmail");
          const profileEmail = document.getElementById("profile-email");
          if (currentEmailInput) currentEmailInput.value = newEmail;
          if (profileEmail) profileEmail.textContent = newEmail;

          changeEmailForm.reset();
          const modal = document.getElementById("change-email-modal");
          const overlay = document.getElementById("modal-overlay");
          if (modal) modal.style.display = "none";
          if (overlay) overlay.style.display = "none";
        } catch (_) {
          // الخطأ تم إظهاره داخل profileApiRequest
        }
      });
    }

    // تسجيل الخروج
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn && !logoutBtn.dataset.profileAccountBound) {
      logoutBtn.dataset.profileAccountBound = "1";
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        // internalToast("تم تسجيل الخروج بنجاح.", "success");
        setTimeout(() => {
          window.location.href = "/frontend/login/login.html";
        }, 800);
      });
    }
  });

  // تعريض بعض الدوال لو احتجتها
  window.ProfileAccount = {
    apiRequest: profileApiRequest,
    toast: internalToast,
    fillProfileFromUser,
  };
})();
