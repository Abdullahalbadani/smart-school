// frontend/admin/js/admin.js
// (نسخة موحّدة بعد التنظيف + إصلاح init + ✅ منع الطرد بسبب 403)
// ملاحظة: أهم تعديل هنا هو: ✅ لا نسجّل خروج إلا عند 401 فقط

console.log("admin.js loaded");

// ==============================
// إعدادات عامة / ثوابت
// ==============================
const API_BASE = "http://127.0.0.1:5000/api";
const THEME_KEY = "smart_school_theme";

// ✅ مهم: بعض الصفحات/الملفات تعتمد على window.API_BASE
window.API_BASE = API_BASE;

let currentUser = null;
window.USER_PERMISSIONS = [];

// ✅ Logout آمن: امسح token/user فقط (لا تمس بقية مفاتيح المشروع)
function logoutToLogin(reason) {
  console.warn("logoutToLogin:", reason || "");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  // لا نستخدم href حتى لا يرجع بالباك
  window.location.replace("/frontend/login/login.html");
}

// ✅ API helper عام (اختياري) — يفيدك لو حبيت تستخدمه بملفات أخرى
window.apiFetchSafe = async function (path, opts = {}) {
  const token = localStorage.getItem("token");
  const url = path.startsWith("http") ? path : API_BASE + path;

  const r = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });

  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  // ✅ Logout فقط عند 401
  if (r.status === 401) {
    logoutToLogin("401 Unauthorized from API: " + path);
    throw new Error("انتهت الجلسة — سجل الدخول من جديد");
  }

  // ✅ 403 ممنوع = لا تعمل logout
  if (!r.ok) {
    const msg = (data && (data.error || data.message)) || `API ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    e.payload = data;
    throw e;
  }

  return data;
};
// ✅ دالة تحديث شعار واسم المدرسة في الهيدر (عالمية)
window.setupSchoolBranding = function() {
    const userStr = localStorage.getItem("user");
    if (!userStr) return;
    
    try {
        const user = JSON.parse(userStr);
        // بحث ذكي عن الاسم والشعار
        const schoolName = user.school_name_ar || user.school?.name_ar || "Smart School";
        const logoUrl = user.logo_url || user.school?.logo_url;

        const nameEl = document.getElementById('real-school-name');
        const logoImg = document.getElementById('real-school-logo');
        const logoText = document.getElementById('default-logo-text');

        if (nameEl) nameEl.textContent = schoolName;

        if (logoImg && logoUrl) {
            const SERVER_URL = window.API_BASE.replace('/api', '');
            const finalUrl = logoUrl.startsWith('http') ? logoUrl : (SERVER_URL + logoUrl);
            
            logoImg.src = finalUrl;
            logoImg.style.display = 'block';
            if (logoText) logoText.style.display = 'none';
        }
    } catch (e) {
        console.error("Error setting up branding:", e);
    }
};

// تشغيلها فور تحميل الملف لكي يظهر الشعار عند فتح الصفحة
document.addEventListener("DOMContentLoaded", () => {
    window.setupSchoolBranding();
});
// ==============================
// 🛡 حماية لوحة الأدمن + تعبئة بيانات المستخدم الأساسية
// ==============================
(function authGuard() {
  const token = localStorage.getItem("token");
  const userStr = localStorage.getItem("user");

  if (!token || !userStr) {
    logoutToLogin("Missing token/user");
    return;
  }

  try {
    currentUser = JSON.parse(userStr);

    const name =
      currentUser.name ||
      currentUser.full_name ||
      currentUser.username ||
      "مستخدم";

    const email = currentUser.email || "";
    const role =
      currentUser.role || currentUser.role_name || currentUser.roleName || "";

    // ⭐️ لو عندي صلاحيات داخل الـ user استخدمها مباشرة
    if (Array.isArray(currentUser.permissions)) {
      window.USER_PERMISSIONS = currentUser.permissions;
      console.log(
        "Loaded permissions from localStorage user:",
        window.USER_PERMISSIONS
      );
    }

    // عناصر النافبار
    const usernameEl = document.getElementById("navbar-username");
    const roleEl = document.getElementById("navbar-role");
    const avatarLetter = document.getElementById("navbar-avatar-letter");

    if (usernameEl) usernameEl.textContent = name;
    if (roleEl) roleEl.textContent = role || "حساب إداري";
    if (avatarLetter) avatarLetter.textContent = name.charAt(0) || "أ";

    // إيميل في فورم تغيير البريد (لو موجود في هذه الواجهة)
    const currentEmailInput = document.getElementById("currentEmail");
    if (currentEmailInput && email) currentEmailInput.value = email;

    // تعبئة مودال الملف الشخصي (لو موجود)
    const profileName = document.getElementById("profile-name");
    const profileEmail = document.getElementById("profile-email");
    const profileRole = document.getElementById("profile-role");

    if (profileName) profileName.textContent = name;
    if (profileEmail && email) profileEmail.textContent = email;
    if (profileRole) profileRole.textContent = role || "حساب إداري";
  } catch (e) {
    console.warn("Cannot parse stored user:", e);
    logoutToLogin("Bad stored user JSON");
  }
})();

// ==============================
// ⏰ الساعة الديناميكية (clock-time / clock-date)
// ==============================
function initClock() {
  const timeEl = document.getElementById("clock-time");
  const dateEl = document.getElementById("clock-date");

  if (!timeEl || !dateEl) return;

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function tick() {
    const now = new Date();
    const h = pad(now.getHours());
    const m = pad(now.getMinutes());
    const s = pad(now.getSeconds());
    timeEl.textContent = `${h}:${m}:${s}`;

    const d = pad(now.getDate());
    const mo = pad(now.getMonth() + 1);
    const y = now.getFullYear();
    dateEl.textContent = `${d}/${mo}/${y}`;
  }

  tick();
  setInterval(tick, 1000);
}

// ==============================
// 📂 تحميل صفحات المحتوى (partials) من مجلد pages
// ==============================
function getPageContainer() {
  const screenPageContent = document.getElementById("screen-page-content");
  if (screenPageContent) return screenPageContent;

  const contentEl = document.getElementById("content");
  if (contentEl) return contentEl;

  return null;
}

const PAGE_NORMALIZE_MAP = {
  "users-manage": "rbac-users",
  "roles-manage": "rbac-roles",
  "permissions-manage": "rbac-permissions",
  "modules-manage": "rbac-modules",
};

const PAGE_FILE_MAP = {
  dashboard: "dashboard",

  "rbac-users": "users/rbac-users",
  "rbac-roles": "users/rbac-roles",
  "rbac-permissions": "users/rbac-permissions",
  "rbac-modules": "users/rbac-modules",

  studentsList: "studentsList",
  studentRegister: "studentRegister",
  studentRenew: "studentRenew",
  staffRegister: "staffRegister",
  assignTeachers: "assignTeachers",
  weeklySchedule: "weeklySchedule",
  examSchedule: "examSchedule",
  monthlyWork: "monthlyWork",
  monthlyReports: "monthlyReports",
  termWork: "termWork",
  termReports: "termReports",
  termResults: "termResults",
  yearResults: "yearResults",
  createNotify: "createNotify",
  notifyLog: "notifyLog",
  inbox: "inbox",
  barcodeAttendance: "barcodeAttendance",
  manualAttendance: "manualAttendance",
  attendanceReports: "attendanceReports",
  feesPay: "feesPay",
  feesReports: "feesReports",
  studentData: "studentData",
  staffData: "staffData",
  termGrades: "termGrades",
  finalGrades: "finalGrades",
  studentStats: "studentStats",
  settingschool: "settingschool",
  feesSettings: "feesSettings",
};

window.loadPage = async function (pageKey) {
  const container = getPageContainer();
  if (!container) {
    console.warn(
      "لا يوجد حاوية لعرض الصفحات (screen-page-content أو content)."
    );
    return;
  }

  const normalizedKey = PAGE_NORMALIZE_MAP[pageKey] || pageKey;
  const fileKey = PAGE_FILE_MAP[normalizedKey] || normalizedKey;

  const url = `pages/${fileKey}.html`;
  container.innerHTML = `<p style="padding:1rem;">جاري تحميل المحتوى...</p>`;

  try {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      container.innerHTML = `
          <div style="padding:1rem; color:#c00; text-align:center;">
            <h3>تعذر تحميل الصفحة</h3>
            <p>الملف: <code>${url}</code></p>
            <p>تأكد أنك أنشأت هذا الملف داخل مجلد <code>frontend/admin/pages</code>.</p>
          </div>
        `;
      return;
    }

    const html = await res.text();
    container.innerHTML = html;

    // ✅ لو عندك تبويبات RBAC
    if (window.RBAC_tabs) {
      window.RBAC_tabs.activateByPage(normalizedKey);
    }

    if (window.RBAC && typeof window.RBAC.onPageLoaded === "function") {
      window.RBAC.onPageLoaded(normalizedKey);
    }

    // ✅ تهيئة صفحات تحتاج init بعد الحقن
    try {
      if (
        normalizedKey === "feesPay" &&
        typeof window.initFeesPayPage === "function"
      ) {
        requestAnimationFrame(() => window.initFeesPayPage());
      }

      if (
        normalizedKey === "feesReports" &&
        typeof window.initFeesReportsPage === "function"
      ) {
        requestAnimationFrame(() => window.initFeesReportsPage());
      }
// تأكد من وضع هذا السطر بعد كود إظهار الواجهة مباشرة
if (window.attendanceReports) {
    window.attendanceReports.init();
}
      // ✅ weeklySchedule
      if (
        normalizedKey === "weeklySchedule" &&
        typeof window.initWeeklySchedule === "function"
      ) {
        requestAnimationFrame(() => window.initWeeklySchedule());
      }
      if (
        normalizedKey === "inbox" &&
        typeof window.initAdminInboxPage === "function"
      ) {
        requestAnimationFrame(() => window.initAdminInboxPage());
      }
      if (
        normalizedKey === "notifyLog" &&
        typeof window.initAdminNotificationsLogPage === "function"
      ) {
        requestAnimationFrame(() => window.initAdminNotificationsLogPage());
      }
      if (
        normalizedKey === "createNotify" &&
        typeof window.initAdminNotificationSendPage === "function"
      ) {
        requestAnimationFrame(() => window.initAdminNotificationSendPage());
      }

      // ✅ examSchedule (جاهز للمستقبل)
      if (
        normalizedKey === "examSchedule" &&
        typeof window.initExamSchedule === "function"
      ) {
        requestAnimationFrame(() => window.initExamSchedule());
      }
      if (
        normalizedKey === "feespay" &&
        typeof window.initFeesPayPage === "function"
      ) {
        requestAnimationFrame(() => window.initFeesPayPage());
      }
      if (
        normalizedKey === "feesReports" &&
        typeof window.initFeesReportsPage === "function"
      ) {
        requestAnimationFrame(() => window.initFeesReportsPage());
      }
      if (
        normalizedKey === "monthlyWork" &&
        typeof window.initMonthlyWorkScreen === "function"
      ) {
        requestAnimationFrame(() => window.initMonthlyWorkScreen());
      }
      if (
        normalizedKey === "termWork" &&
        typeof window.initMonthlyCertificatesScreen === "function"
      ) {
        requestAnimationFrame(() => window.initMonthlyCertificatesScreen());
      }
      if (
        normalizedKey === "termResults" &&
        typeof window.initTermResultsScreen === "function"
      ) {
        requestAnimationFrame(() => window.initTermResultsScreen());
      }
      if (
  normalizedKey === "monthlyReports" &&
  typeof window.initMonthlyReportsScreen === "function"
) {
  requestAnimationFrame(() => window.initMonthlyReportsScreen());
}
    } catch (e) {
      console.warn("Page init failed:", normalizedKey, e);
    }

    window.scrollTo(0, 0);
  } catch (err) {
    console.error("Error loading page:", err);
    container.innerHTML = `
        <p style="padding:1rem; color:#c00; text-align:center;">
          حدث خطأ أثناء تحميل المحتوى.
        </p>
      `;
  }
};

// تبويبات RBAC
window.RBAC_tabs = {
  open(el, pageKey) {
    // ملاحظة: بعض المتصفحات توفر event كمتغير عالمي
    if (typeof event !== "undefined" && event && event.preventDefault) {
      event.preventDefault();
    }

    loadPage(pageKey);

    document
      .querySelectorAll(".rbac-tabs .tab-link")
      .forEach((a) => a.classList.remove("active"));

    if (el) el.classList.add("active");
  },

  activateByPage(pageKey) {
    document.querySelectorAll(".rbac-tabs .tab-link").forEach((a) => {
      if (a.dataset.tab === pageKey) {
        a.classList.add("active");
      } else {
        a.classList.remove("active");
      }
    });
  },
};

// ==============================
// 🛡 نظام الصلاحيات لإخفاء العناصر
// ==============================
function hasPermission(code) {
  if (!Array.isArray(window.USER_PERMISSIONS)) return false;
  return window.USER_PERMISSIONS.includes(code);
}

function hasAnyPermission(codes) {
  if (!Array.isArray(window.USER_PERMISSIONS)) return false;
  return codes.some((c) => window.USER_PERMISSIONS.includes(c));
}

function applyMenuPermissions() {
  document.querySelectorAll("[data-permission]").forEach((el) => {
    const perm = el.getAttribute("data-permission");
    if (!perm) return;
    el.style.display = hasPermission(perm) ? "" : "none";
  });

  document.querySelectorAll("[data-any-permission]").forEach((el) => {
    const raw = el.getAttribute("data-any-permission") || "";
    const perms = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (!perms.length) return;
    el.style.display = hasAnyPermission(perms) ? "" : "none";
  });
}

// ⭐️ نستخدم الـ API فقط إذا ما وجدنا صلاحيات في الـ user
async function fetchMenuPermissions() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.USER_PERMISSIONS = [];
    applyMenuPermissions();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/me/menu-permissions`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    // ✅ 401 فقط = سجّل خروج
    if (res.status === 401) {
      logoutToLogin("401 from menu-permissions");
      return;
    }

    // ✅ 403 ممنوع: لا تسجّل خروج — فقط طبّق الإخفاء بناءً على الموجود
    if (!res.ok) {
      console.warn("menu-permissions error:", res.status);
      // إذا ما عندنا صلاحيات أصلاً، خليها فاضية وطبّق الإخفاء
      if (!Array.isArray(window.USER_PERMISSIONS)) window.USER_PERMISSIONS = [];
      applyMenuPermissions();
      return;
    }

    const data = await res.json();
    window.USER_PERMISSIONS = Array.isArray(data.permissions)
      ? data.permissions
      : [];

    applyMenuPermissions();
  } catch (err) {
    console.warn("Failed to load menu permissions:", err);
    // لا logout هنا
  }
}

// ==============================
// 🎛 واجهة الداشبورد الجديدة (شاشات + ثيم + مودالات)
// ==============================
(function () {
  function $(selector) {
    return document.querySelector(selector);
  }

  function $all(selector) {
    return document.querySelectorAll(selector);
  }

  /* =========================
    تبديل الشاشات
  ========================== */
  function switchScreen(targetId) {
    const screens = $all(".screen");
    const navButtons = $all(".bottom-item[data-target]");
    const hero =
      document.getElementById("home-hero") || document.querySelector(".hero");

    // ✅ (1) تفعيل الشاشة المطلوبة
    screens.forEach((screen) => {
      screen.classList.toggle("is-active", screen.id === targetId);
    });

    // ✅ (2) تفعيل زر الناف السفلي
    navButtons.forEach((btn) => {
      const target = btn.getAttribute("data-target");
      btn.classList.toggle("bottom-item--active", target === targetId);
    });

    // ✅ (3) إظهار الملخص التنفيذي فقط في الرئيسية
    const isHome = targetId === "screen-dashboard";
    if (hero) hero.classList.toggle("is-hidden", !isHome);

    // ✅ حفظ الشاشة الحالية
    if (window.Dashboard) {
      window.Dashboard.currentScreenId = targetId;
    }

    // ✅ يرجع لأعلى
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.Dashboard = {
    currentScreenId: "screen-dashboard",
    previousScreenId: null,

    switchScreen,

    openPage(pageKey, title) {
      const pageScreen = document.getElementById("screen-page");
      const pageTitleEl = document.getElementById("screen-page-title");

      if (pageScreen && pageTitleEl && getPageContainer()) {
        this.previousScreenId = this.currentScreenId || "screen-dashboard";
        pageTitleEl.textContent = title || this.mapPageTitle(pageKey);
        switchScreen("screen-page");
        loadPage(pageKey);
        return;
      }

      if (getPageContainer()) {
        loadPage(pageKey);
        return;
      }

      console.log("فتح صفحة:", pageKey);
      alert("سيتم لاحقًا ربط هذا الخيار بصفحة: " + pageKey);
    },

    backFromPage() {
      const prev = this.previousScreenId || "screen-dashboard";
      switchScreen(prev);
    },

    mapPageTitle(pageKey) {
      const map = {
        studentsList: "عرض الطلاب",
        studentRegister: "تسجيل طالب جديد",
        studentRenew: "تسجيل المستمرين",
        staffRegister: "تسجيل الموظفين",
        assignTeachers: "تعيين المدرسين",
        weeklySchedule: "جداول الحصص الأسبوعية",
        examSchedule: "جداول الامتحانات",
        barcodeAttendance: "تسجيل الحضور باركود",
        manualAttendance: "تسجيل الحضور يدويًا",
        attendanceReports: "تقارير الحضور",
        feesPay: "سداد الرسوم",
        feesReports: "تقارير الرسوم",
        feesSettings: "اعدادات الرسوم",
        studentData: "بيانات الطلاب",
        staffData: "بيانات الموظفين",
        termGrades: "تقارير الدرجات الفصلية",
        finalGrades: "تقارير الدرجات النهائية",
        studentStats: "إحصائيات الطلاب",
        settingschool: "إعدادات المدرسة",
        "rbac-users": "المستخدمون",
        "rbac-roles": "الأدوار",
        "rbac-permissions": "الصلاحيات",
        "rbac-modules": "الوحدات (Modules)",
      };
      return map[pageKey] || "تفاصيل";
    },
  };

  /* =========================
    الشريط السفلي
  ========================== */
  function initBottomNav() {
    $all(".bottom-item[data-target]").forEach((btn) => {
      if (btn.classList.contains("bottom-item--menu")) return;

      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        switchScreen(targetId);
      });
    });

    const backBtn = document.getElementById("screen-page-back");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        window.Dashboard.backFromPage();
      });
    }
  }

  /* =========================
    شيت القائمة الرئيسية
  ========================== */
  function initMainMenuSheet() {
    const sheet = $("#main-menu-sheet");
    const openBtn = $("#main-menu-button");
    const closeBtn = $("#main-menu-close");

    if (!sheet || !openBtn || !closeBtn) return;

    function openSheet() {
      sheet.classList.add("is-open");
    }

    function closeSheet() {
      sheet.classList.remove("is-open");
    }

    openBtn.addEventListener("click", openSheet);
    closeBtn.addEventListener("click", closeSheet);

    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) closeSheet();
    });

    sheet.querySelectorAll(".sheet-item[data-target]").forEach((item) => {
      item.addEventListener("click", () => {
        const targetId = item.getAttribute("data-target");
        switchScreen(targetId);
        closeSheet();
      });
    });
  }

  /* =========================
    منيو الحساب + المودالات (فتح/إغلاق فقط)
  ========================== */
  function initAccountMenu() {
    const toggle = $("#account-menu-toggle");
    const dropdown = $("#account-dropdown");

    if (!toggle || !dropdown) return;

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("is-open");
    });

    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && !toggle.contains(e.target)) {
        dropdown.classList.remove("is-open");
      }
    });
  }

  function initModals() {
    const overlay = $("#modal-overlay");
    const profileModal = $("#profile-modal");
    const changePasswordModal = $("#change-password-modal");
    const changeEmailModal = $("#change-email-modal");

    if (!overlay) return;

    function openModal(modal) {
      if (!modal) return;
      overlay.classList.add("is-visible");
      modal.classList.add("is-visible");
    }

    function closeAllModals() {
      overlay.classList.remove("is-visible");
      [profileModal, changePasswordModal, changeEmailModal].forEach((m) => {
        if (m) m.classList.remove("is-visible");
      });
    }

    const openProfile = $("#open-profile-modal");
    const openPassword = $("#open-change-password-modal");
    const openEmail = $("#open-change-email-modal");

    if (openProfile && profileModal) {
      openProfile.addEventListener("click", () => {
        if (currentUser) {
          const name =
            currentUser.name ||
            currentUser.full_name ||
            currentUser.username ||
            "مستخدم";
          const email = currentUser.email || "-";
          const role =
            currentUser.role ||
            currentUser.role_name ||
            currentUser.roleName ||
            "-";
          const pn = document.getElementById("profile-name");
          const pe = document.getElementById("profile-email");
          const pr = document.getElementById("profile-role");
          if (pn) pn.textContent = name;
          if (pe) pe.textContent = email;
          if (pr) pr.textContent = role;
        }
        openModal(profileModal);
      });
    }
    if (openPassword && changePasswordModal) {
      openPassword.addEventListener("click", () =>
        openModal(changePasswordModal)
      );
    }
    if (openEmail && changeEmailModal) {
      openEmail.addEventListener("click", () => openModal(changeEmailModal));
    }

    const openProfileCard = $("#open-profile-modal-card");
    const openPasswordCard = $("#open-change-password-modal-card");
    const openEmailCard = $("#open-change-email-modal-card");

    if (openProfileCard && profileModal) {
      openProfileCard.addEventListener("click", () => openModal(profileModal));
    }
    if (openPasswordCard && changePasswordModal) {
      openPasswordCard.addEventListener("click", () =>
        openModal(changePasswordModal)
      );
    }
    if (openEmailCard && changeEmailModal) {
      openEmailCard.addEventListener("click", () =>
        openModal(changeEmailModal)
      );
    }

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeAllModals);
    });

    overlay.addEventListener("click", closeAllModals);

    // 🔑 منطق تغيير كلمة المرور + البريد + تسجيل الخروج
    // أصبح في الملف المشترك:
    // /frontend/shared/profile-account.js
    // هنا فقط فتح/إغلاق المودالات.
  }

  /* =========================
    تبديل الثيم (نهاري / ليلي)
  ========================== */
  function applyTheme(theme) {
    const body = document.body;
    const themeBtn = $("#theme-toggle");
    const cardBtn = $("#theme-toggle-card");

    if (theme === "dark") {
      body.classList.add("theme-dark");
    } else {
      body.classList.remove("theme-dark");
    }

    // (اختياري) تغيير شكل الزر
    if (themeBtn) {
      themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
    }
    if (cardBtn) {
      cardBtn.textContent = theme === "dark" ? "الوضع النهاري" : "الوضع الليلي";
    }
  }

  function initThemeToggle() {
    let initial = "light";

    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") {
        initial = saved;
      }
    } catch (e) {}

    applyTheme(initial);

    function toggleTheme() {
      const isDark = document.body.classList.contains("theme-dark");
      const next = isDark ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {}
    }

    const topBtn = $("#theme-toggle");
    const cardBtn = $("#theme-toggle-card");

    if (topBtn) topBtn.addEventListener("click", toggleTheme);
    if (cardBtn) cardBtn.addEventListener("click", toggleTheme);
  }

  /* =========================
    مركز الأوامر (بحث عام)
  ========================== */
  
  /* =========================
    مركز الأوامر (بحث عام)
  ========================== */
  function initCommandCenter() {
    const input = document.getElementById("command-input");
    if (!input) return;

    const COMMANDS = [
      { keywords: ["الطلاب", "عرض الطلاب"], run() { if (window.Dashboard) window.Dashboard.openPage("studentsList", "عرض الطلاب"); } },
      { keywords: ["الرسوم", "سداد"], run() { if (window.Dashboard) window.Dashboard.switchScreen("screen-fees"); } },
      { keywords: ["الحضور", "الغياب", "جداول"], run() { if (window.Dashboard) window.Dashboard.switchScreen("screen-timetable"); } },
      { keywords: ["التقارير", "إحصاء"], run() { if (window.Dashboard) window.Dashboard.switchScreen("screen-reports"); } },
      { keywords: ["الرئيسية", "dashboard"], run() { if (window.Dashboard) window.Dashboard.switchScreen("screen-dashboard"); } },
    ];

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = input.value.trim().toLowerCase();
        for (const cmd of COMMANDS) {
          if (cmd.keywords.some(k => q.includes(k))) { cmd.run(); return; }
        }
        alert("لم يتم العثور على أمر يطابق: " + q);
        input.select();
      }
    });
  }

  // ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح صفحة الأذونات (إصلاح الزر)
  // ==========================================
// ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح صفحة الأذونات
  // ==========================================
 // ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح المودال مباشرة!
  // ==========================================
// ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح المودال مباشرة!
  // ==========================================
 // ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح المودال بشكل متسلسل ومضمون
  // ==========================================
// ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح المودال (النسخة المتتبعة - Smart Tracker)
  // ==========================================
// ==========================================
  // 🦅 نظام عين الصقر: الدالة الذكية لفتح المودال (نسخة الاستهداف المباشر المضمونة)
  // ==========================================
 // ==========================================
  // 🦅 نظام عين الصقر: النسخة المصححة لفتح ملف manualAttendance
  // ==========================================
  // ==========================================
  // 🦅 نظام عين الصقر: النسخة الكاملة والمحسنة لفتح المودال في المنتصف
  // ==========================================
 // ==========================================
  // 🦅 نظام عين الصقر: النسخة النهائية لحل مشكلة السكرول
  // ==========================================
window.openTeacherPermitsPage = function() {
    // 1. إخفاء صندوق الإنذار
    const alertBox = document.getElementById("admin-eagle-eye-alerts");
    if (alertBox) alertBox.style.display = "none";

    // 2. الانتقال لصفحة الأذونات
    if (window.Dashboard && typeof window.Dashboard.openPage === "function") {
        window.Dashboard.openPage("manualAttendance", "أذونات المعلمين");
    }

    // 3. الصائد الذكي لمراقبة الجدول
    let attempts = 0;
    let checkExist = setInterval(() => {
        attempts++;
        if (attempts > 50) { clearInterval(checkExist); return; }

        const statusSelect = document.getElementById("tp-status");
        const listEl = document.getElementById("tp-list");
        const refreshBtn = document.getElementById("tp-refresh");

        if (statusSelect && listEl && refreshBtn) {
            if (listEl.innerHTML.includes("جاري تحميل")) return; 

            clearInterval(checkExist);
            statusSelect.value = "approved";
            refreshBtn.click();

            // 4. انتظار ظهور البطاقات وفتح المودال
            setTimeout(() => {
                let cardCheck = setInterval(() => {
                    if (listEl.innerHTML.includes("جاري تحميل")) return;
                    clearInterval(cardCheck);
                    
                    const detailsBtn = listEl.querySelector(".tp-card button[data-action='open']");
                    if (detailsBtn) {
                        // 💥 فتح المودال
                        detailsBtn.click(); 

                        // 🌟 الحل الجذري للسكرول: الصعود الفوري للقمة الصفرية
                        setTimeout(() => {
                            window.scrollTo(0, 0);
                            document.documentElement.scrollTop = 0;
                            document.body.scrollTop = 0;
                        }, 100); 

                    }
                }, 200);
            }, 500);
        }
    }, 200);
};
  // ==========================================
  // 🦅 نظام عين الصقر: بناء الصندوق الأحمر
// ==========================================
  // 🦅 نظام عين الصقر: بناء الصندوق الأحمر (ذكي يفرق بين الرفض وانتهاء الوقت)
  // ==========================================
  window.refreshEagleEye = async function() {
    try {
      const res = await window.apiFetchSafe("/admin/teacher-permits/alerts/rejected-subs");
      const alerts = res?.alerts || [];
      
      let alertBox = document.getElementById("admin-eagle-eye-alerts");
      if (!alertBox) {
        alertBox = document.createElement("div");
        alertBox.id = "admin-eagle-eye-alerts";
        document.querySelector("main").prepend(alertBox); 
      }

      if (alerts.length > 0) {
        // 🟢 فرز نوع المشاكل لكي نكتب نصاً دقيقاً للإدارة
        const expiredCount = alerts.filter(a => a.status === 'expired').length;
        const rejectedCount = alerts.filter(a => a.status === 'rejected').length;

        let alertTitle = "";
        let alertDesc = "";
        let iconClass = "ri-alarm-warning-fill";

        if (expiredCount > 0 && rejectedCount > 0) {
          alertTitle = `تنبيه عاجل! (${rejectedCount} رفض | ${expiredCount} تجاهل وانتهى وقتهم ⏱️)`;
          alertDesc = "بعض المعلمين اعتذروا صراحة، وآخرون انتهى الوقت المسموح لهم دون أي رد. الرجاء التدخل السريع.";
        } else if (expiredCount > 0) {
          alertTitle = `انتهى الوقت! (${expiredCount} طلب احتياط متجاهل ⏱️)`;
          alertDesc = "انتهت المهلة الزمنية التي حددتها لبعض المعلمين دون أي استجابة منهم. الرجاء الدخول وتعيين بدلاء.";
          iconClass = "ri-timer-flash-line"; // تغيير الأيقونة لتناسب الوقت
        } else {
          alertTitle = `تحذير إداري هام! (${rejectedCount} حصص احتياط تم رفضها)`;
          alertDesc = "بعض المعلمين المكلفين بالاحتياط اعتذروا عن التغطية صراحة. الرجاء تعيين بدلاء فوراً لضمان سير الحصص.";
        }

        let html = `
          <div style="background: linear-gradient(135deg, #ef4444, #b91c1c); color: white; padding: 15px 20px; border-radius: 8px; margin: 15px; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h3 style="margin: 0 0 5px 0; display: flex; align-items: center; gap: 8px; font-size:1.1rem;">
                <i class="${iconClass}" style="font-size: 1.5rem; animation: pulse 2s infinite;"></i> 
                ${alertTitle}
              </h3>
              <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">
                ${alertDesc}
              </p>
            </div>
            <button onclick="window.openTeacherPermitsPage()" style="background: white; color: #b91c1c; border: none; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s; white-space: nowrap;">
              <i class="ri-arrow-left-circle-line"></i> الذهاب للأذونات للحل
            </button>
          </div>`;
        alertBox.innerHTML = html;
        alertBox.style.display = "flex";
      } else {
        alertBox.style.display = "none";
      }
    } catch (e) {
      console.warn("Eagle Eye Error:", e.message);
    }
  };

  /* =========================
    تهيئة عامة + استقبال السحر الحي
  ========================== */

// ==========================================
// 🔊 نظام التنبيهات الصوتية للإدارة
// ==========================================
// ==========================================
// 🔊 نظام التنبيهات الصوتية للإدارة
// ==========================================
window.playAdminAlertSound = function(type) {
  try {
    let soundUrl = "";
    
    if (type === "success") {
      soundUrl = "https://actions.google.com/sounds/v1/alarms/spaceship_alarm.ogg"; 
    } else if (type === "error") {
      soundUrl = "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"; 
    }

    if (!soundUrl) return;

    const audio = new Audio(soundUrl);
    audio.volume = 0.7; 
    
    audio.play().catch(e => {
      console.warn("🔇 المتصفح منع تشغيل الصوت تلقائياً:", e.message);
    });
  } catch (err) {
    console.error("خطأ في تشغيل الصوت:", err);
  }
};

/* =========================
  تهيئة عامة + استقبال السحر الحي
========================== */
document.addEventListener("DOMContentLoaded", () => {
  initBottomNav();
  initMainMenuSheet();
  initAccountMenu();
  initModals();
  initThemeToggle();
  initCommandCenter();
  initClock();

  if (Array.isArray(window.USER_PERMISSIONS) && window.USER_PERMISSIONS.length) {
    applyMenuPermissions();
  } else {
    fetchMenuPermissions();
  }

  switchScreen("screen-dashboard");
  
  // تشغيل الرادار لأول مرة عند فتح الصفحة
  window.refreshEagleEye(); 

  // ⚡ استقبال السحر الحي في الإدارة (Real-Time)
  if (typeof io !== "undefined") {
    const adminSocket = io(window.API_BASE ? window.API_BASE.replace("/api", "") : "http://127.0.0.1:5000");
    
    adminSocket.on("connect", () => {
      console.log("🟢 [Socket] الإدارة متصلة بالسيرفر الحي وتستمع لإشعارات المعلمين!");
    });

    // 1. استقبال حالة الرفض 🚨
    adminSocket.on("substitute_rejected", (data) => {
      console.log("🚨 [Socket] تم استلام رفض احتياط!");
      
      // 🔊 إطلاق صوت الإنذار!
      if (typeof window.playAdminAlertSound === "function") window.playAdminAlertSound("error");

      if (typeof window.showToast === "function") {
        window.showToast(`تحذير: الأستاذ (${data?.teacherName || 'المعلم'}) اعتذر عن التغطية!`, "error");
      }
      
      window.refreshEagleEye(); // إظهار الصندوق الأحمر فوراً بدون تحديث الصفحة
    });

    // 2. استقبال حالة القبول ✅ (الإشعار الأخضر الفخم)
    adminSocket.on("substitute_accepted", (data) => {
      console.log("✅ [Socket] تم استلام قبول من المعلم:", data?.teacherName);
      
      // 🔊 إطلاق صوت النجاح!
      if (typeof window.playAdminAlertSound === "function") window.playAdminAlertSound("success");

      // إظهار الـ Toast الصغير المعتاد
      if (typeof window.showToast === "function") {
        window.showToast(`ممتاز: الأستاذ (${data?.teacherName || 'المعلم'}) وافق على التغطية.`, "success");
      }

      // بناء الصندوق الأخضر الكبير في أعلى الشاشة
      let successBox = document.createElement("div");
      successBox.style = "background: linear-gradient(135deg, #10b981, #047857); color: white; padding: 15px 20px; border-radius: 8px; margin: 15px; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3); display: flex; align-items: center; justify-content: space-between; transition: opacity 0.5s ease;";
      
      successBox.innerHTML = `
        <div>
          <h3 style="margin: 0 0 5px 0; display: flex; align-items: center; gap: 8px; font-size:1.1rem;">
            <i class="ri-checkbox-circle-fill" style="font-size: 1.5rem;"></i> 
            خبر مفرح! (تم قبول الاحتياط)
          </h3>
          <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">
            وافق الأستاذ/ة <strong>(${data?.teacherName || 'المعلم'})</strong> للتو على تغطية حصة الاحتياط. سير العملية التعليمية بأمان ولا حاجة لأي إجراء منك.
          </p>
        </div>
        <button onclick="this.parentElement.remove()" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 8px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s; white-space: nowrap;">
          <i class="ri-close-line"></i> إخفاء
        </button>
      `;

      // إضافة الصندوق في أعلى الشاشة
      document.querySelector("main").prepend(successBox);

      // السحر: إخفاء الصندوق تلقائياً بعد 6 ثوانٍ لكي تبقى الشاشة نظيفة
      setTimeout(() => {
        if (successBox && successBox.parentElement) {
          successBox.style.opacity = "0"; // تدرج بالاختفاء
          setTimeout(() => successBox.remove(), 500); // حذفه نهائياً
        }
      }, 6000);
    });

    // 3. تحديث جدول الأذونات فوراً
    adminSocket.on("refresh_admin_permits", () => {
      const refreshBtn = document.getElementById("tp-refresh");
      if (refreshBtn) refreshBtn.click();
    });

  } else {
    console.error("❌ [Socket] لم يتم العثور على مكتبة Socket.io في صفحة الإدارة!");
  }
});

})();