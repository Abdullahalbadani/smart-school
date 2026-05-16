const API_BASE = window.location.origin;

const els = {
  loginSection: document.getElementById("loginSection"),
  appSection: document.getElementById("appSection"),
  loginForm: document.getElementById("loginForm"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  loginMessage: document.getElementById("loginMessage"),
  logoutBtn: document.getElementById("logoutBtn"),
  refreshBtn: document.getElementById("refreshBtn"),

  pageTitle: document.getElementById("pageTitle"),
  dashboardView: document.getElementById("dashboardView"),
  schoolsView: document.getElementById("schoolsView"),

  totalSchools: document.getElementById("totalSchools"),
  activeSchools: document.getElementById("activeSchools"),
  trialSchools: document.getElementById("trialSchools"),
  subscribedSchools: document.getElementById("subscribedSchools"),
  suspendedSchools: document.getElementById("suspendedSchools"),
  expiredSchools: document.getElementById("expiredSchools"),
  totalStudents: document.getElementById("totalStudents"),
  totalTeachers: document.getElementById("totalTeachers"),
  latestSchools: document.getElementById("latestSchools"),

  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  schoolsTableBody: document.getElementById("schoolsTableBody"),
  pageInfo: document.getElementById("pageInfo"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
alertsView: document.getElementById("alertsView"),
logsView: document.getElementById("logsView"),

alertsDaysFilter: document.getElementById("alertsDaysFilter"),
alertsList: document.getElementById("alertsList"),

logsSearchInput: document.getElementById("logsSearchInput"),
logsActionFilter: document.getElementById("logsActionFilter"),
activityLogsList: document.getElementById("activityLogsList"),
logsPageInfo: document.getElementById("logsPageInfo"),
prevLogsPageBtn: document.getElementById("prevLogsPageBtn"),
nextLogsPageBtn: document.getElementById("nextLogsPageBtn"),

schoolDetailsModal: document.getElementById("schoolDetailsModal"),
detailsSchoolName: document.getElementById("detailsSchoolName"),
detailsSchoolMeta: document.getElementById("detailsSchoolMeta"),
schoolDetailsContent: document.getElementById("schoolDetailsContent"),
  toast: document.getElementById("toast"),
};

let state = {
  token: localStorage.getItem("platform_token") || "",
  currentView: "dashboardView",
  schoolsPage: 1,
  schoolsLimit: 20,
  schoolsTotal: 0,
  searchTimer: null,
  logsPage: 1,
logsLimit: 30,
logsTotal: 0,
logsSearchTimer: null,
};

function showToast(message, type = "normal") {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");

  if (type === "error") {
    els.toast.style.background = "#991b1b";
  } else if (type === "success") {
    els.toast.style.background = "#166534";
  } else {
    els.toast.style.background = "#17122b";
  }

  setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 3000);
}

function getToken() {
  return localStorage.getItem("platform_token") || "";
}

function setToken(token) {
  state.token = token;
  localStorage.setItem("platform_token", token);
}

function clearToken() {
  state.token = "";
  localStorage.removeItem("platform_token");
}

async function api(path, options = {}) {
  const token = getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    clearToken();
    showLogin();
    throw new Error(data.message || "انتهت الجلسة، يرجى تسجيل الدخول");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "حدث خطأ غير متوقع");
  }

  return data;
}

function showLogin() {
  els.loginSection.classList.remove("hidden");
  els.appSection.classList.add("hidden");
}

function showApp() {
  els.loginSection.classList.add("hidden");
  els.appSection.classList.remove("hidden");
}

function switchView(viewId) {
  state.currentView = viewId;

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.add("hidden");
  });

  document.getElementById(viewId).classList.remove("hidden");

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

 const titles = {
  dashboardView: "الرئيسية",
  schoolsView: "إدارة المدارس",
  alertsView: "تنبيهات الاشتراك",
  logsView: "سجل العمليات",
};

els.pageTitle.textContent = titles[viewId] || "لوحة المالك";

if (viewId === "dashboardView") {
  loadDashboard();
}

if (viewId === "schoolsView") {
  loadSchools();
}

if (viewId === "alertsView") {
  loadSubscriptionAlerts();
}

if (viewId === "logsView") {
  loadActivityLogs();
}
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ar");
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("ar-YE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatusText(status) {
  const map = {
    trial: "تجربة",
    active: "فعال",
    suspended: "موقوفة",
    expired: "منتهية",
    cancelled: "ملغية",
  };

  return map[status] || status || "—";
}

function getPlanText(plan) {
  const map = {
    trial: "تجربة",
    monthly: "شهري",
    yearly: "سنوي",
    lifetime: "دائم",
    custom: "مخصص",
  };

  return map[plan] || plan || "—";
}

function renderStatusBadge(status) {
  return `<span class="badge ${status || ""}">${getStatusText(status)}</span>`;
}

async function login(email, password) {
  const data = await api("/api/platform/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  setToken(data.token);
  showApp();
  await loadDashboard();
}

async function loadDashboard() {
  try {
    const data = await api("/api/platform/dashboard");

    const stats = data.stats || {};

    els.totalSchools.textContent = formatNumber(stats.total_schools);
    els.activeSchools.textContent = formatNumber(stats.active_schools);
    els.trialSchools.textContent = formatNumber(stats.trial_schools);
    els.subscribedSchools.textContent = formatNumber(stats.subscribed_schools);
    els.suspendedSchools.textContent = formatNumber(stats.suspended_schools);
    els.expiredSchools.textContent = formatNumber(stats.expired_schools);
    els.totalStudents.textContent = formatNumber(stats.total_students);
    els.totalTeachers.textContent = formatNumber(stats.total_teachers);

    renderLatestSchools(data.latest_schools || []);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderLatestSchools(schools) {
  if (!schools.length) {
    els.latestSchools.innerHTML = `<p class="empty">لا توجد مدارس حتى الآن.</p>`;
    return;
  }

  els.latestSchools.innerHTML = schools
    .map((school) => {
      return `
        <div class="latest-item">
          <div>
            <strong>${school.name_ar || school.name_en || "مدرسة بدون اسم"}</strong>
            <span>${school.slug || "—"} • ${school.email || "—"}</span>
          </div>
          ${renderStatusBadge(school.subscription_status)}
        </div>
      `;
    })
    .join("");
}
function renderRealDashboard(stats) {
  const statusBars = document.getElementById("statusBars");
  const usageSummary = document.getElementById("usageSummary");

  if (!statusBars || !usageSummary) return;

  const total = Number(stats.total_schools || 0) || 1;

  const rows = [
    {
      label: "مدارس مفعلة",
      value: Number(stats.active_schools || 0),
      className: "green",
    },
    {
      label: "تجربة مجانية",
      value: Number(stats.trial_schools || 0),
      className: "yellow",
    },
    {
      label: "اشتراك فعال",
      value: Number(stats.subscribed_schools || 0),
      className: "",
    },
    {
      label: "موقوفة أو منتهية",
      value:
        Number(stats.suspended_schools || 0) +
        Number(stats.expired_schools || 0) +
        Number(stats.cancelled_schools || 0),
      className: "red",
    },
  ];

  statusBars.innerHTML = rows
    .map((row) => {
      const percent = Math.min(Math.round((row.value / total) * 100), 100);

      return `
        <div class="status-row">
          <div class="status-row-head">
            <span>${row.label}</span>
            <strong>${formatNumber(row.value)} / ${percent}%</strong>
          </div>
          <div class="status-track">
            <div class="status-fill ${row.className}" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    })
    .join("");

  const totalSchools = Number(stats.total_schools || 0);
  const totalStudents = Number(stats.total_students || 0);
  const totalTeachers = Number(stats.total_teachers || 0);
  const totalUsers = Number(stats.total_users || 0);

  const avgStudents =
    totalSchools > 0 ? Math.round(totalStudents / totalSchools) : 0;

  usageSummary.innerHTML = `
    <div class="usage-item">
      <span>إجمالي المستخدمين</span>
      <strong>${formatNumber(totalUsers)}</strong>
    </div>

    <div class="usage-item">
      <span>متوسط الطلاب لكل مدرسة</span>
      <strong>${formatNumber(avgStudents)}</strong>
    </div>

    <div class="usage-item">
      <span>إجمالي الطلاب</span>
      <strong>${formatNumber(totalStudents)}</strong>
    </div>

    <div class="usage-item">
      <span>إجمالي المعلمين</span>
      <strong>${formatNumber(totalTeachers)}</strong>
    </div>
  `;
}
async function loadSchools() {
  try {
    const q = encodeURIComponent(els.searchInput.value.trim());
    const status = encodeURIComponent(els.statusFilter.value.trim());

    const data = await api(
      `/api/platform/schools?page=${state.schoolsPage}&limit=${state.schoolsLimit}&q=${q}&status=${status}`
    );

    state.schoolsTotal = data.total || 0;

    renderSchoolsTable(data.data || []);
    updatePagination();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderSchoolsTable(schools) {
  if (!schools.length) {
    els.schoolsTableBody.innerHTML = `
      <div class="school-card">
        <div class="school-card-title">
          <strong>لا توجد مدارس مطابقة</strong>
          <span>جرّب تغيير البحث أو الفلترة.</span>
        </div>
      </div>
    `;
    return;
  }

  els.schoolsTableBody.innerHTML = schools
    .map((school) => {
      return `
        <article class="school-card">
          <div class="school-card-head">
            <div class="school-card-title">
              <strong>${school.name_ar || school.name_en || "مدرسة بدون اسم"}</strong>
              <span>${school.slug || "—"} · ${school.email || "—"}</span>
            </div>

            ${renderStatusBadge(school.subscription_status)}
          </div>

          <div class="school-info-grid">
            <div class="school-info">
              <span>الكود</span>
              <strong>${school.code || "—"}</strong>
            </div>

            <div class="school-info">
              <span>الخطة</span>
              <strong>${getPlanText(school.subscription_plan)}</strong>
            </div>

            <div class="school-info">
              <span>الطلاب</span>
              <strong>${formatNumber(school.students_count)}</strong>
            </div>

            <div class="school-info">
              <span>المعلمون</span>
              <strong>${formatNumber(school.teachers_count)}</strong>
            </div>

            <div class="school-info">
              <span>انتهاء التجربة</span>
              <strong>${formatDate(school.trial_ends_at)}</strong>
            </div>

            <div class="school-info">
              <span>انتهاء الاشتراك</span>
              <strong>${formatDate(school.subscription_ends_at)}</strong>
            </div>
          </div>

          <div class="school-actions">
            <button class="btn btn-warning-soft" onclick="activateTrial(${school.id})">تجربة</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${school.id}, 'monthly')">شهري</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${school.id}, 'yearly')">سنوي</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${school.id}, 'lifetime')">دائم</button>
            <button class="btn btn-light" onclick="activateCustom(${school.id})">مخصص</button>
            <button class="btn btn-danger-soft" onclick="suspendSchool(${school.id})">إيقاف</button>
            <button class="btn btn-light" onclick="reactivateSchool(${school.id})">فتح</button>
            <button class="btn btn-primary" onclick="enterAsSchoolAdmin(${school.id})">دخول كمدير</button>
            <button class="btn btn-light" onclick="openSchoolDetails(${school.id})">تفاصيل</button>
          </div>
        </article>
      `;
    })
    .join("");
}   
function updatePagination() {
  const totalPages = Math.max(Math.ceil(state.schoolsTotal / state.schoolsLimit), 1);

  els.pageInfo.textContent = `صفحة ${state.schoolsPage} من ${totalPages}`;

  els.prevPageBtn.disabled = state.schoolsPage <= 1;
  els.nextPageBtn.disabled = state.schoolsPage >= totalPages;
}

async function activateTrial(schoolId) {
  const daysText = prompt("كم مدة التجربة بالأيام؟", "3");

  if (!daysText) return;

  const days = Number(daysText);

  if (!Number.isInteger(days) || days <= 0) {
    showToast("مدة التجربة غير صحيحة", "error");
    return;
  }

  try {
    await api(`/api/platform/schools/${schoolId}/trial`, {
      method: "POST",
      body: JSON.stringify({ days }),
    });

    showToast("تم تفعيل التجربة بنجاح", "success");
    await refreshCurrentView();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function activateSubscription(schoolId, plan) {
  const text = {
    monthly: "شهري",
    yearly: "سنوي",
    lifetime: "دائم",
  }[plan];

  const ok = confirm(`هل تريد تفعيل اشتراك ${text} لهذه المدرسة؟`);

  if (!ok) return;

  try {
    await api(`/api/platform/schools/${schoolId}/subscription`, {
      method: "POST",
      body: JSON.stringify({ plan }),
    });

    showToast("تم تفعيل الاشتراك بنجاح", "success");
    await refreshCurrentView();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function activateCustom(schoolId) {
  const daysText = prompt("كم عدد أيام الاشتراك المخصص؟", "10");

  if (!daysText) return;

  const days = Number(daysText);

  if (!Number.isInteger(days) || days <= 0) {
    showToast("عدد الأيام غير صحيح", "error");
    return;
  }

  try {
    await api(`/api/platform/schools/${schoolId}/subscription`, {
      method: "POST",
      body: JSON.stringify({ plan: "custom", days }),
    });

    showToast("تم تفعيل الاشتراك المخصص بنجاح", "success");
    await refreshCurrentView();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function suspendSchool(schoolId) {
  const reason = prompt("سبب إيقاف المدرسة:", "لم يتم تجديد الاشتراك");

  if (reason === null) return;

  const ok = confirm("هل أنت متأكد من إيقاف هذه المدرسة؟");

  if (!ok) return;

  try {
    await api(`/api/platform/schools/${schoolId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });

    showToast("تم إيقاف المدرسة", "success");
    await refreshCurrentView();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reactivateSchool(schoolId) {
  const ok = confirm("هل تريد إعادة فتح هذه المدرسة؟");

  if (!ok) return;

  try {
    await api(`/api/platform/schools/${schoolId}/reactivate`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    showToast("تم فتح المدرسة بنجاح", "success");
    await refreshCurrentView();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshCurrentView() {
  if (state.currentView === "dashboardView") {
    await loadDashboard();
  } else {
    await loadSchools();
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  els.loginMessage.textContent = "";

  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;

  try {
    await login(email, password);
    showToast("تم تسجيل الدخول بنجاح", "success");
  } catch (error) {
    els.loginMessage.textContent = error.message;
  }
});

els.logoutBtn.addEventListener("click", () => {
  clearToken();
  showLogin();
});

els.refreshBtn.addEventListener("click", refreshCurrentView);

document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchView(btn.dataset.view);
  });
});

els.searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);

  state.searchTimer = setTimeout(() => {
    state.schoolsPage = 1;
    loadSchools();
  }, 400);
});

els.statusFilter.addEventListener("change", () => {
  state.schoolsPage = 1;
  loadSchools();
});

els.prevPageBtn.addEventListener("click", () => {
  if (state.schoolsPage > 1) {
    state.schoolsPage -= 1;
    loadSchools();
  }
});

els.nextPageBtn.addEventListener("click", () => {
  const totalPages = Math.max(Math.ceil(state.schoolsTotal / state.schoolsLimit), 1);

  if (state.schoolsPage < totalPages) {
    state.schoolsPage += 1;
    loadSchools();
  }
});
async function enterAsSchoolAdmin(schoolId) {
  const ok = confirm(
    "سيتم الدخول إلى لوحة هذه المدرسة كمدير مؤقت لمدة ساعة. هل تريد المتابعة؟"
  );

  if (!ok) return;

  try {
    const data = await api(`/api/platform/schools/${schoolId}/impersonate`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (!data.token || !data.user) {
      throw new Error("لم يرجع النظام بيانات الدخول كمدير");
    }

    // نحفظ توكن المدرسة بنفس طريقة تسجيل الدخول العادي
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));

    // مفاتيح إضافية لبعض صفحات الإدارة
    localStorage.setItem("school", JSON.stringify(data.school || {}));
    localStorage.setItem("school_id", String(data.user.school_id || ""));
    localStorage.setItem("school_slug", String(data.user.school_slug || ""));
    localStorage.setItem("role", "admin");
    localStorage.setItem("permissions", JSON.stringify(data.user.permissions || []));

    // حتى نقدر نرجع للوحة المالك لاحقًا
    localStorage.setItem("platform_return_url", "/frontend/super-admin/index.html");

    showToast("تم الدخول كمدير المدرسة، سيتم تحويلك الآن", "success");

    setTimeout(() => {
      window.location.href = data.redirect_url || "/frontend/admin/index.html";
    }, 500);
  } catch (error) {
    showToast(error.message, "error");
  }
}
window.activateTrial = activateTrial;
window.activateSubscription = activateSubscription;
window.activateCustom = activateCustom;
window.suspendSchool = suspendSchool;
window.reactivateSchool = reactivateSchool;
window.enterAsSchoolAdmin = enterAsSchoolAdmin;
window.openSchoolDetails = openSchoolDetails;
window.closeSchoolDetailsModal = closeSchoolDetailsModal;
if (els.alertsDaysFilter) {
  els.alertsDaysFilter.addEventListener("change", loadSubscriptionAlerts);
}

if (els.logsSearchInput) {
  els.logsSearchInput.addEventListener("input", () => {
    clearTimeout(state.logsSearchTimer);

    state.logsSearchTimer = setTimeout(() => {
      state.logsPage = 1;
      loadActivityLogs();
    }, 400);
  });
}

if (els.logsActionFilter) {
  els.logsActionFilter.addEventListener("change", () => {
    state.logsPage = 1;
    loadActivityLogs();
  });
}

if (els.prevLogsPageBtn) {
  els.prevLogsPageBtn.addEventListener("click", () => {
    if (state.logsPage > 1) {
      state.logsPage -= 1;
      loadActivityLogs();
    }
  });
}

if (els.nextLogsPageBtn) {
  els.nextLogsPageBtn.addEventListener("click", () => {
    const totalPages = Math.max(
      Math.ceil(state.logsTotal / state.logsLimit),
      1
    );

    if (state.logsPage < totalPages) {
      state.logsPage += 1;
      loadActivityLogs();
    }
  });
}
(async function init() {
  if (!getToken()) {
    showLogin();
    return;
  }

  showApp();
  switchView("dashboardView");
})();async function openSchoolDetails(schoolId) {
  try {
    const data = await api(`/api/platform/schools/${schoolId}/full-details`);

    const school = data.school || {};
    const admins = data.admins || [];
    const logs = data.logs || [];

    els.detailsSchoolName.textContent =
      school.name_ar || school.name_en || "تفاصيل المدرسة";

    els.detailsSchoolMeta.textContent =
      `${school.slug || "—"} · ${school.email || "—"} · ${school.phone || "—"}`;

    els.schoolDetailsContent.innerHTML = `
      <div class="details-grid">
        <div class="details-card wide">
          <h3>بيانات المدرسة</h3>

          <div class="details-info-grid">
            <div><span>الاسم العربي</span><strong>${school.name_ar || "—"}</strong></div>
            <div><span>الاسم الإنجليزي</span><strong>${school.name_en || "—"}</strong></div>
            <div><span>الكود</span><strong>${school.code || "—"}</strong></div>
            <div><span>الرابط المختصر</span><strong>${school.slug || "—"}</strong></div>
            <div><span>البريد</span><strong>${school.email || "—"}</strong></div>
            <div><span>الهاتف</span><strong>${school.phone || "—"}</strong></div>
            <div><span>المدينة</span><strong>${school.city || "—"}</strong></div>
            <div><span>الحالة</span><strong>${getStatusText(school.subscription_status)}</strong></div>
          </div>
        </div>

        <div class="details-card">
          <h3>الاشتراك</h3>

          <div class="details-info-grid single">
            <div><span>الخطة</span><strong>${getPlanText(school.subscription_plan)}</strong></div>
            <div><span>بداية التجربة</span><strong>${formatDate(school.trial_started_at)}</strong></div>
            <div><span>نهاية التجربة</span><strong>${formatDate(school.trial_ends_at)}</strong></div>
            <div><span>بداية الاشتراك</span><strong>${formatDate(school.subscription_starts_at)}</strong></div>
            <div><span>نهاية الاشتراك</span><strong>${formatDate(school.subscription_ends_at)}</strong></div>
            <div><span>سبب الإيقاف</span><strong>${school.suspended_reason || "—"}</strong></div>
          </div>
        </div>

        <div class="details-card">
          <h3>الإحصائيات</h3>

          <div class="details-stats">
            <div><strong>${formatNumber(school.students_count)}</strong><span>طلاب</span></div>
            <div><strong>${formatNumber(school.teachers_count)}</strong><span>معلمون</span></div>
            <div><strong>${formatNumber(school.users_count)}</strong><span>مستخدمون</span></div>
            <div><strong>${formatNumber(school.guardians_count)}</strong><span>أولياء أمور</span></div>
            <div><strong>${formatNumber(school.sections_count)}</strong><span>شعب</span></div>
            <div><strong>${formatNumber(school.subjects_count)}</strong><span>مواد</span></div>
          </div>
        </div>

        <div class="details-card wide">
          <h3>مدير المدرسة</h3>
          ${renderDetailsAdmins(admins)}
        </div>

        <div class="details-card wide">
          <h3>إجراءات سريعة</h3>

          <div class="details-actions">
            <button class="btn btn-primary" onclick="enterAsSchoolAdmin(${school.id})">دخول كمدير</button>
            <button class="btn btn-warning-soft" onclick="activateTrial(${school.id})">تفعيل تجربة</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${school.id}, 'monthly')">اشتراك شهري</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${school.id}, 'yearly')">اشتراك سنوي</button>
            <button class="btn btn-danger-soft" onclick="suspendSchool(${school.id})">إيقاف</button>
            <button class="btn btn-light" onclick="reactivateSchool(${school.id})">فتح</button>
          </div>
        </div>

        <div class="details-card wide">
          <h3>آخر عمليات المالك على المدرسة</h3>
          ${renderDetailsLogs(logs)}
        </div>
      </div>
    `;

    els.schoolDetailsModal.classList.remove("hidden");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function closeSchoolDetailsModal() {
  els.schoolDetailsModal.classList.add("hidden");
}

function renderDetailsAdmins(admins) {
  if (!admins.length) {
    return `<p class="muted-text">لا يوجد مدير مدرسة ظاهر لهذه المدرسة.</p>`;
  }

  return `
    <div class="mini-list">
      ${admins
        .map(
          (admin) => `
          <div class="mini-list-item">
            <strong>${admin.name || admin.username || "مدير المدرسة"}</strong>
            <span>${admin.email || "—"} · ${admin.phone || "—"} · ${admin.role_name || "—"}</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

function renderDetailsLogs(logs) {
  if (!logs.length) {
    return `<p class="muted-text">لا توجد عمليات مسجلة على هذه المدرسة.</p>`;
  }

  return `
    <div class="mini-list">
      ${logs
        .map(
          (log) => `
          <div class="mini-list-item">
            <strong>${getActionText(log.action)}</strong>
            <span>${log.description || "—"}</span>
            <small>${formatDateTime(log.created_at)} · ${log.platform_admin_name || "النظام"}</small>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

async function loadSubscriptionAlerts() {
  try {
    const days = els.alertsDaysFilter?.value || 7;
    const data = await api(`/api/platform/subscription-alerts?days=${days}`);
    renderSubscriptionAlerts(data.data || []);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderSubscriptionAlerts(alerts) {
  if (!alerts.length) {
    els.alertsList.innerHTML = `
      <div class="empty-state">
        <strong>لا توجد تنبيهات</strong>
        <span>لا توجد مدارس ستنتهي خلال الفترة المحددة.</span>
      </div>
    `;
    return;
  }

  els.alertsList.innerHTML = alerts
    .map((item) => {
      const isTrial = item.alert_type === "trial";
      const endDate = isTrial ? item.trial_ends_at : item.subscription_ends_at;

      return `
        <article class="alert-card">
          <div>
            <strong>${item.name_ar || item.name_en || "مدرسة بدون اسم"}</strong>
            <span>${item.slug || "—"} · ${item.email || "—"}</span>
          </div>

          <div class="alert-meta">
            <span>${isTrial ? "انتهاء تجربة" : "انتهاء اشتراك"}</span>
            <strong>باقي ${formatNumber(item.remaining_days)} يوم</strong>
            <small>${formatDate(endDate)}</small>
          </div>

          <div class="alert-actions">
            <button class="btn btn-light" onclick="openSchoolDetails(${item.id})">تفاصيل</button>
            <button class="btn btn-warning-soft" onclick="activateTrial(${item.id})">تمديد تجربة</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${item.id}, 'monthly')">تجديد شهري</button>
            <button class="btn btn-success-soft" onclick="activateSubscription(${item.id}, 'yearly')">تجديد سنوي</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadActivityLogs() {
  try {
    const q = encodeURIComponent(els.logsSearchInput?.value?.trim() || "");
    const action = encodeURIComponent(els.logsActionFilter?.value || "");

    const data = await api(
      `/api/platform/activity-logs?page=${state.logsPage}&limit=${state.logsLimit}&q=${q}&action=${action}`
    );

    state.logsTotal = data.total || 0;
    renderActivityLogs(data.data || []);
    updateLogsPagination();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderActivityLogs(logs) {
  if (!logs.length) {
    els.activityLogsList.innerHTML = `
      <div class="empty-state">
        <strong>لا توجد عمليات</strong>
        <span>لا توجد نتائج مطابقة للبحث الحالي.</span>
      </div>
    `;
    return;
  }

  els.activityLogsList.innerHTML = logs
    .map(
      (log) => `
      <article class="log-card">
        <div class="log-icon">≡</div>

        <div class="log-body">
          <strong>${getActionText(log.action)}</strong>
          <span>${log.description || "—"}</span>
          <small>
            ${formatDateTime(log.created_at)}
            · ${log.platform_admin_name || "النظام"}
            · ${log.school_name_ar || log.school_slug || "—"}
          </small>
        </div>
      </article>
    `
    )
    .join("");
}

function updateLogsPagination() {
  const totalPages = Math.max(Math.ceil(state.logsTotal / state.logsLimit), 1);

  els.logsPageInfo.textContent = `صفحة ${state.logsPage} من ${totalPages}`;
  els.prevLogsPageBtn.disabled = state.logsPage <= 1;
  els.nextLogsPageBtn.disabled = state.logsPage >= totalPages;
}

function getActionText(action) {
  const map = {
    activate_trial: "تفعيل تجربة",
    activate_subscription: "تفعيل اشتراك",
    suspend_school: "إيقاف مدرسة",
    reactivate_school: "فتح مدرسة",
    impersonate_school_admin: "دخول كمدير",
    auto_expire_trial: "انتهاء تجربة تلقائي",
    auto_expire_subscription: "انتهاء اشتراك تلقائي",
  };

  return map[action] || action || "عملية";
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ar-YE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}