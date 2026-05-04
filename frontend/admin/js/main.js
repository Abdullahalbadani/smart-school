// ===============================
// System Core & Dashboard Widgets
// ===============================
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";
  const SERVER_URL = API_BASE.replace('/api', '');
  const $id = (id) => document.getElementById(id);

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  function formatAr(n) {
    try { return Number(n).toLocaleString("ar-EG"); }
    catch { return String(n); }
  }

  function animateCount(el, to) {
    if (!el) return;
    const target = Number(to) || 0;
    const from = 0;
    const start = performance.now();
    const dur = 650;

    function tick(t) {
      const p = Math.min(1, (t - start) / dur);
      const v = Math.round(from + (target - from) * p);
      el.textContent = formatAr(v);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // 🕒 دالة احترافية لتحويل الوقت إلى صيغة "منذ..."
  function timeAgo(dateString) {
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return "الآن";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "أمس";
    if (days === 2) return "منذ يومين";
    return `منذ ${days} أيام`;
  }

  // ===============================
  // 1. إحصائيات النظام
  // ===============================
  async function loadOrbitStats() {
    const elStudents = $id("orbit-students");
    const elTeachers = $id("orbit-teachers");
    const elClasses = $id("orbit-classes");

    [elStudents, elTeachers, elClasses].forEach((el) => {
      if (el) el.textContent = "…";
    });

    try {
      let schoolIdParam = "";
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const userObj = JSON.parse(userStr);
        const currentSchoolId = userObj.school_id || userObj.school?.id; 
        if (currentSchoolId) schoolIdParam = `?schoolId=${currentSchoolId}`;
      }

      const r = await fetch(`${API_BASE}/dashboard/stats${schoolIdParam}`, {
        headers: { ...authHeaders() },
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.message || "فشل تحميل الإحصائيات");

      animateCount(elStudents, data.students);
      animateCount(elTeachers, data.teachers);
      animateCount(elClasses, data.classes); 
    } catch (e) {
      console.error("Orbit stats error:", e);
      if (elStudents) elStudents.textContent = "0";
      if (elTeachers) elTeachers.textContent = "0";
      if (elClasses) elClasses.textContent = "0";
    }
  }

  // ===============================
  // 2. سجل النشاطات المباشر (Live Radar)
  // ===============================
 // ===============================
  // 2. سجل النشاطات المباشر (النسخة الأنيقة)
  // ===============================
  // ===============================
  // 2. سجل النشاطات المباشر (النسخة النظيفة والمتوافقة 100% مع شاشات الجوال)
  // ===============================
// ===============================
  // 2. سجل النشاطات المباشر (متوافق 100% مع قالبك الأصلي)
  // ===============================
 // ===============================
  // 2. سجل النشاطات المباشر (النسخة الأنيقة والفخمة)
  // ===============================
 // ===============================
  // 2. سجل النشاطات (مفلتر باليوم + النقر للتفاصيل)
  // ===============================

  // إضافة مستمع لحقل التاريخ عندما يتم تغيير اليوم
  document.addEventListener('DOMContentLoaded', () => {
    const dateFilter = document.getElementById('activity-date-filter');
    if (dateFilter) {
      // تعيين تاريخ اليوم كافتراضي عند فتح الصفحة
      const today = new Date().toISOString().split('T')[0];
      dateFilter.value = today;
      
      // جلب البيانات عند تغيير التاريخ
      dateFilter.addEventListener('change', () => {
        fetchLiveActivities(dateFilter.value);
      });
    }
  });

  // الدالة التي تفتح/تغلق تفاصيل الوقت الدقيق عند النقر
  window.toggleTime = function(element) {
    const timeDiv = element.querySelector('.exact-time-display');
    if (timeDiv.style.display === 'none') {
      timeDiv.style.display = 'block';
      element.style.background = 'rgba(37, 99, 235, 0.05)'; // إضاءة خفيفة عند الفتح
      element.style.borderRadius = '8px';
      element.style.padding = '8px';
    } else {
      timeDiv.style.display = 'none';
      element.style.background = 'transparent';
      element.style.padding = '0';
    }
  };

  async function fetchLiveActivities(selectedDate = null) {
    const container = document.getElementById('live-activity-timeline');
    if (!container) return;

    // تحديد التاريخ المطلوب (إذا لم يُمرر، نأخذ القيمة من الحقل أو تاريخ اليوم)
    if (!selectedDate) {
      const dateInput = document.getElementById('activity-date-filter');
      selectedDate = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().split('T')[0];
    }

    try {
      // إرسال التاريخ في مسار الـ API كـ Query Parameter (?date=...)
      const response = await fetch(`${API_BASE}/activities/recent?date=${selectedDate}`, {
        method: 'GET',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' }
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'فشل جلب البيانات');

      if (!result.data || result.data.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #666;">
            <p style="font-size: 14px; color: #94a3b8;">لا توجد نشاطات مسجلة في هذا اليوم.</p>
          </div>`;
        return;
      }

      container.innerHTML = '';

      const actionNamesAr = { 'CREATE': 'إضافة', 'UPDATE': 'تعديل', 'DELETE': 'حذف' };
      const resourceNamesAr = {
        'students': 'طالب', 'fees': 'بيانات مالية', 'roles': 'صلاحيات نظام',
        'users': 'مستخدم', 'employees': 'موظف', 'schools': 'إعدادات المدرسة', 'system': 'تغيير بالنظام'
      };

result.data.forEach(activity => {
        const dateObj = new Date(activity.created_at);
        const timeOnly = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const fullDate = dateObj.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        let dotClass = 'timeline-dot'; 
        let metaClass = 'meta'; 
        
        if (activity.action === 'DELETE') {
          dotClass = 'timeline-dot timeline-dot--danger'; 
          metaClass = 'meta meta-warn'; 
        } else if (activity.action === 'UPDATE') {
          dotClass = 'timeline-dot timeline-dot--warn'; 
        }

        const actionNamesAr = { 'CREATE': 'إضافة', 'UPDATE': 'تعديل', 'DELETE': 'حذف' };
        const resourceNamesAr = {
          'students': 'طالب', 'fees': 'بيانات مالية', 'roles': 'صلاحيات', 'role-permissions': 'صلاحيات النظام',
          'users': 'مستخدم', 'employees': 'موظف', 'schools': 'إعدادات المدرسة', 'system': 'نظام'
        };

        const actionTitle = actionNamesAr[activity.action] || 'عملية';
        const sectionTitle = resourceNamesAr[activity.resource_type] || activity.resource_type;
        
        // 🎯 عرض الحدث بدقة كما جاء من الباك إند الذكي
        let exactDetails = activity.description || '';
        
        // بناء الـ HTML الأنيق
        const htmlItem = `
          <div class="timeline-item">
            <div class="timeline-time" style="font-size: 11.5px; font-weight: 700; color: #94a3b8; direction: ltr; margin-top: 2px;">
              ${timeOnly}
            </div>
            <div class="${dotClass}"></div>
            <div class="timeline-card" onclick="toggleTime(this)" style="cursor: pointer; transition: all 0.2s ease;">
              
              <p style="margin: 0 0 5px 0;">
                <span style="font-weight: 800; font-size: 14px;">${actionTitle} ${sectionTitle}</span><br>
                <span style="font-size: 12.5px; color: #cbd5e1; line-height: 1.6; display: inline-block; margin-top: 2px;">
                  ${exactDetails}
                </span>
              </p>
              
              <span class="${metaClass}">بواسطة: ${activity.user_name || 'المدير'}</span>
              
              <div class="exact-time-display" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(148, 163, 184, 0.3); font-size: 11.5px; color: #94a3b8;">
                <span style="font-weight: 700; color: #cbd5e1;">التاريخ:</span> <br>
                ${fullDate}
              </div>
            </div>
          </div>
        `;
        
        container.insertAdjacentHTML('beforeend', htmlItem);
      });
    } catch (error) {
      console.error("❌ Live Activities Error:", error);
      if (container.innerHTML.trim() === '') {
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: #ef4444;">تعذر الاتصال بالخادم.</div>`;
      }
    }
  }
  // ===============================
  // 3. هوية المدرسة الديناميكية
  // ===============================
  async function setupSchoolBranding() {
    const userStr = localStorage.getItem("user");
    if (!userStr) return;

    try {
      const user = JSON.parse(userStr);
      const schoolName = user.school_name_ar || user.school?.name_ar || user.school?.name || user.name_ar || "Smart School";
      const logoUrl = user.logo_url || user.school?.logo_url || user.school_logo;
      
      const nameEl = $id("real-school-name");
      const textEl = $id("default-logo-text");
      const imgEl = $id("real-school-logo");

      if (nameEl) nameEl.textContent = schoolName;
      if (textEl && schoolName !== "Smart School") textEl.textContent = schoolName.charAt(0);

      if (logoUrl && imgEl && textEl) {
        imgEl.src = logoUrl.startsWith('http') ? logoUrl : `${SERVER_URL}${logoUrl}`;
        imgEl.style.display = "block";
        textEl.style.display = "none";
      }

      // التحديث في الخلفية من السيرفر
      const r = await fetch(`${API_BASE}/profile/me`, {
        headers: { ...authHeaders() }
      });

      if (r.ok) {
        const data = await r.json();
        const schoolData = data.school || user; 
        
        if (nameEl && schoolData.school_name_ar) {
           nameEl.textContent = schoolData.school_name_ar;
        }

        if (schoolData.logo_url && imgEl && textEl) {
           const freshLogoUrl = schoolData.logo_url.startsWith('http') ? schoolData.logo_url : `${SERVER_URL}${schoolData.logo_url}`;
           imgEl.src = freshLogoUrl;
           imgEl.style.display = "block";
           textEl.style.display = "none";
           
           user.logo_url = schoolData.logo_url;
           localStorage.setItem("user", JSON.stringify(user));
        }
      }
    } catch (e) {
      console.error("خطأ في تحديث هوية المدرسة:", e);
    }
  }

  // ===============================
  // 🎯 المُنسق المركزي (Orchestrator) 
  // يضمن تشغيل كل شيء بترتيب سليم وبدون تكرار
  // ===============================
  document.addEventListener("DOMContentLoaded", () => {
    // 1. هوية المدرسة والإحصائيات
    setupSchoolBranding();
    loadOrbitStats();
    
    // 2. سجل النشاطات المباشر
    fetchLiveActivities();
    setInterval(fetchLiveActivities, 60000); // تحديث كل دقيقة بالخلفية
  });

})();

// ===============================
// RBAC Filters (Search in Tables)
// ===============================
window.RBAC_filters = {
  filter(input, tbodyId) {
    const q = (input.value || "").toLowerCase();
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.style.display = tr.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  },
};

// ===============================
// UserUI - واجهة إدارة المستخدمين
// ===============================
window.UserUI = {
  modalEl: null,
  formEl: null,
  titleEl: null,
  countBadge: null,

  init() {
    this.modalEl = document.getElementById("user-modal");
    this.formEl = document.getElementById("rbac-user-form");
    this.titleEl = document.getElementById("user-modal-title");
    this.countBadge = document.getElementById("users-count-badge");

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });

    if (window.RBAC && Array.isArray(window.RBAC.users)) {
      this.updateCount(window.RBAC.users.length);
    }
  },

  ensureInit() {
    if (!this.modalEl || !this.formEl || !this.titleEl) this.init();
  },

  openCreate() {
    this.ensureInit();
    if (!this.modalEl || !this.formEl) return;

    this.formEl.reset();
    const idInput = document.getElementById("user-id");
    if (idInput) idInput.value = "";

    if (this.titleEl) this.titleEl.textContent = "مستخدم جديد";
    this.modalEl.classList.add("is-open");
  },

  openEdit() {
    this.ensureInit();
    if (!this.modalEl) return;

    if (this.titleEl) this.titleEl.textContent = "تعديل مستخدم";
    this.modalEl.classList.add("is-open");
  },

  close() {
    this.ensureInit();
    if (!this.modalEl) return;
    this.modalEl.classList.remove("is-open");
  },

  search(query) {
    const tbody = document.getElementById("rbac-users-tbody");
    if (!tbody) return;

    const q = (query || "").toLowerCase();
    tbody.querySelectorAll("tr").forEach((tr) => {
      const text = tr.innerText.toLowerCase();
      tr.style.display = text.includes(q) ? "" : "none";
    });
  },

  updateCount(count) {
    if (!this.countBadge) this.countBadge = document.getElementById("users-count-badge");
    if (!this.countBadge) return;

    const n = Number(count || 0);
    let text;

    if (n === 0) text = "لا يوجد مستخدمون";
    else if (n === 1) text = "مستخدم واحد";
    else if (n === 2) text = "مستخدمان";
    else if (n <= 10) text = `${n} مستخدمين`;
    else text = `${n} مستخدم`;

    this.countBadge.textContent = text;
  },
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.UserUI && typeof window.UserUI.init === "function") {
    window.UserUI.init();
  }
});

// ===============================
// Idle Auto Logout System
// ===============================
const IDLE_LIMIT = 15 * 60 * 1000; // 15 دقيقة
let idleTimer;

function logoutDueToIdle() {
  alert("تم تسجيل خروجك بسبب عدم النشاط للحفاظ على أمان البيانات.");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/frontend/login/login.html";
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(logoutDueToIdle, IDLE_LIMIT);
}

["mousemove", "keydown", "click", "scroll"].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer);
});

resetIdleTimer();