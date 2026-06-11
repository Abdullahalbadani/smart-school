(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");
  const apiUrl =
    typeof window.apiUrl === "function"
      ? window.apiUrl
      : function (path = "") {
          if (/^https?:\/\//i.test(path)) return path;
          let cleanPath = String(path || "").replace(/^\/+/, "");
          if (cleanPath.startsWith("api/")) cleanPath = cleanPath.slice(4);
          return `${API_BASE}/${cleanPath}`;
        };

  const $ = (id) => document.getElementById(id);
  const state = { page: 1, limit: 20, totalPages: 0, totalCount: 0, items: [] };

  const ROLE_LABELS = {
    school_admin: "مدير المدرسة",
    admin: "مدير",
    administrator: "مدير",
    platform_admin: "مدير المنصة",
    superadmin: "مدير المنصة",
    super_admin: "مدير المنصة",
    teacher: "معلم",
    employee: "موظف",
    student: "طالب",
    parent: "ولي أمر",
    system: "النظام",
  };

  const SEVERITY_LABELS = {
    normal: "عادي",
    important: "مهم",
    sensitive: "حساس",
    danger: "خطير",
    critical: "خطير",
  };

  const RESULT_LABELS = { success: "ناجحة", failure: "فاشلة" };

  const MODULE_LABELS = {
    Security: "الأمان وتسجيل الدخول",
    Finance: "الرسوم والمدفوعات",
    Grades: "الدرجات والنتائج",
    users: "المستخدمون",
    roles: "الأدوار والصلاحيات",
    permissions: "الصلاحيات",
    students: "الطلاب",
    guardians: "أولياء الأمور",
    employees: "الموظفون والمعلمون",
    schools: "إعدادات المدرسة",
    "school-settings": "إعدادات المدرسة",
    "academic-years": "السنوات الدراسية",
    stages: "المراحل الدراسية",
    grades: "الصفوف الدراسية",
    sections: "الشعب الدراسية",
    subjects: "المواد الدراسية",
    periods: "الحصص الدراسية",
    curriculum: "الخطة الدراسية",
    "assign-teachers": "توزيع المعلمين",
    attendance: "الحضور والغياب",
    assessments: "الاختبارات والتقييمات",
    results: "النتائج الدراسية",
    fees: "الرسوم والمدفوعات",
    "fee-rules": "قواعد الرسوم",
    "fee-adjustments": "طلبات تعديل الرسوم",
    reports: "التقارير المدرسية",
    "school-reports": "التقارير المدرسية",
    backups: "النسخ الاحتياطية",
    notifications: "الإشعارات والرسائل",
    timetables: "الجداول الدراسية",
    certificates: "الشهادات",
    transfers: "طلبات نقل الطلاب",
    "student-transfer-requests": "طلبات نقل الطلاب",
    permits: "الأذونات",
    learning: "الأنشطة التعليمية",
    system: "النظام",
    System: "النظام",
  };

  const FIELD_LABELS = {
    name: "الاسم",
    full_name: "الاسم الكامل",
    student_name: "اسم الطالب",
    employee_name: "اسم الموظف",
    teacher_name: "اسم المعلم",
    guardian_name: "اسم ولي الأمر",
    username: "اسم المستخدم",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف",
    job_title: "المسمى الوظيفي",
    is_teacher: "نوع الموظف",
    is_active: "الحالة",
    status: "الحالة",
    role: "الدور",
    role_name: "الدور الوظيفي",
    grade_name: "الصف",
    stage_name: "المرحلة",
    section_name: "الشعبة",
    subject_name: "المادة",
    assessment_title: "التقييم",
    title: "العنوان",
    student_code: "رقم الطالب",
    attendance_status: "حالة الحضور",
    payment_method: "طريقة الدفع",
    receipt_number: "رقم السند",
    amount: "المبلغ",
    annual_amount: "المبلغ السنوي",
    paid_amount: "المبلغ المدفوع",
    remaining_amount: "المبلغ المتبقي",
    discount_amount: "قيمة الخصم",
    discount_percent: "نسبة الخصم",
    reason: "السبب",
    notes: "الملاحظات",
    start_date: "تاريخ البداية",
    end_date: "تاريخ النهاية",
    from_class_label: "من الصف والشعبة",
    to_class_label: "إلى الصف والشعبة",
    term: "الفصل الدراسي",
    academic_year_name: "السنة الدراسية",
    is_published: "حالة النشر",
    published: "حالة النشر",
    result_status: "حالة النتيجة",
  };

  const FIELD_PRIORITY = [
    "full_name",
    "student_name",
    "employee_name",
    "teacher_name",
    "guardian_name",
    "name",
    "title",
    "assessment_title",
    "student_code",
    "job_title",
    "is_teacher",
    "is_active",
    "status",
    "grade_name",
    "section_name",
    "subject_name",
    "attendance_status",
    "amount",
    "paid_amount",
    "remaining_amount",
    "receipt_number",
    "payment_method",
    "reason",
    "notes",
  ];

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function text(value, fallback = "—") {
    const s = String(value ?? "").trim();
    return s || fallback;
  }

  function objectOrEmpty(value) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function roleLabel(role) {
    return ROLE_LABELS[String(role || "").toLowerCase()] || text(role, "—");
  }

  function severityLabel(value) {
    return SEVERITY_LABELS[String(value || "normal").toLowerCase()] || "عادي";
  }

  function resultLabel(value) {
    return RESULT_LABELS[String(value || "success").toLowerCase()] || "—";
  }

  function moduleLabel(activity) {
    const key = activity.module || activity.resource_type || activity.entity_type || "system";
    return activity.module_label || MODULE_LABELS[key] || key || "النظام";
  }

  function badge(label, type) {
    return `<span class="audit-badge audit-badge--${escapeHtml(type)}">${escapeHtml(label)}</span>`;
  }

  function formatDateTime(activity) {
    const date = new Date(activity.created_at || `${activity.event_date || ""}T${activity.event_time || ""}`);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ar-EG", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function isManagerField(field) {
    return Boolean(FIELD_LABELS[field]);
  }

  function isInternalField(field) {
    return (
      /^id$/i.test(field) ||
      /_id$/i.test(field) ||
      /^(created_at|updated_at|deleted_at|school_id|user_id|session_id|request_body|response_body|metadata|path|method|status_code|ip_address|device_info|user_agent)$/i.test(field)
    );
  }

  function maskPhone(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7) return raw;
    return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
  }

  function maskEmail(value) {
    const raw = String(value ?? "").trim();
    const at = raw.indexOf("@");
    if (at <= 1) return raw || "—";
    return `${raw.slice(0, 2)}***${raw.slice(at)}`;
  }

  function statusText(value) {
    const key = String(value ?? "").toLowerCase();
    const labels = {
      active: "نشط",
      inactive: "غير نشط",
      enabled: "مفعّل",
      disabled: "معطّل",
      pending: "بانتظار المراجعة",
      approved: "مقبول",
      rejected: "مرفوض",
      present: "حاضر",
      absent: "غائب",
      late: "متأخر",
      excused: "بعذر",
      paid: "مدفوع",
      unpaid: "غير مدفوع",
      published: "منشور",
      draft: "مسودة",
    };
    return labels[key] || String(value ?? "—");
  }

  function valueText(value, field = "") {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "phone") return maskPhone(value);
    if (field === "email") return maskEmail(value);
    if (field === "is_active") return value === true || value === "true" || value === 1 || value === "1" ? "نشط" : "غير نشط";
    if (field === "is_teacher") return value === true || value === "true" || value === 1 || value === "1" ? "معلم" : "موظف إداري";
    if (field === "is_published" || field === "published") return value === true || value === "true" || value === 1 || value === "1" ? "منشور" : "غير منشور";
    if (field === "status" || field === "attendance_status" || field === "result_status") return statusText(value);
    if (/amount$/i.test(field)) return `${Number(value || 0).toLocaleString("ar-EG")} ريال`;
    if (field === "discount_percent") return `${Number(value || 0).toLocaleString("ar-EG")}٪`;
    if (typeof value === "boolean") return value ? "نعم" : "لا";
    if (Array.isArray(value)) return value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("، ");
    if (typeof value === "object") return "تم حفظ بيانات إضافية";
    return String(value);
  }

  function sortFields(a, b) {
    const ai = FIELD_PRIORITY.indexOf(a.field);
    const bi = FIELD_PRIORITY.indexOf(b.field);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }

  function managerRows(data, max = 8) {
    const obj = objectOrEmpty(data);
    return Object.entries(obj)
      .filter(([field, value]) => !isInternalField(field) && isManagerField(field) && value !== null && value !== undefined && value !== "")
      .map(([field, value]) => ({ field, label: FIELD_LABELS[field], value: valueText(value, field) }))
      .sort(sortFields)
      .slice(0, max);
  }

  function managerChangeRows(activity, max = 12) {
    const rawChanges = objectOrEmpty(activity.changes);
    const oldData = objectOrEmpty(activity.old_data || rawChanges.before);
    const newData = objectOrEmpty(activity.new_data || rawChanges.after);
    const changedFields = Array.isArray(activity.changed_fields) && activity.changed_fields.length
      ? activity.changed_fields
      : [...new Set([...Object.keys(oldData), ...Object.keys(newData)])];

    return changedFields
      .filter((field) => !isInternalField(field) && isManagerField(field))
      .filter((field) => JSON.stringify(oldData[field]) !== JSON.stringify(newData[field]))
      .map((field) => ({
        field,
        label: FIELD_LABELS[field],
        oldValue: valueText(oldData[field], field),
        newValue: valueText(newData[field], field),
      }))
      .sort(sortFields)
      .slice(0, max);
  }

  function renderSimpleTable(title, rows) {
    if (!rows.length) return "";
    return `
      <section class="audit-detail-section">
        <h3>${escapeHtml(title)}</h3>
        <div class="audit-table-wrap">
          <table class="audit-change-table">
            <tbody>
              ${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderChanges(activity) {
    const action = String(activity.action || "").toUpperCase();
    const rawChanges = objectOrEmpty(activity.changes);

    if (action === "CREATE") {
      return renderSimpleTable("بيانات السجل المضاف", managerRows(activity.new_data || rawChanges.after, 8));
    }

    if (action === "DELETE") {
      return renderSimpleTable("بيانات السجل المحذوف", managerRows(activity.old_data || rawChanges.before, 8));
    }

    const rows = managerChangeRows(activity, 12);
    if (!rows.length) return "";

    return `
      <section class="audit-detail-section">
        <h3>التغييرات المسجلة</h3>
        <div class="audit-table-wrap">
          <table class="audit-change-table">
            <thead><tr><th>الحقل</th><th>قبل التعديل</th><th>بعد التعديل</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.oldValue)}</td><td>${escapeHtml(row.newValue)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function buildParams() {
    const params = new URLSearchParams();
    params.set("scope", "all");
    params.set("page", String(state.page));
    params.set("limit", String(state.limit));

    const map = [
      ["q", $("audit-q")?.value],
      ["date_from", $("audit-date-from")?.value],
      ["date_to", $("audit-date-to")?.value],
      ["user", $("audit-user")?.value],
      ["module", $("audit-module")?.value],
      ["action", $("audit-action")?.value],
      ["severity", $("audit-severity")?.value],
      ["result", $("audit-result")?.value],
    ];

    map.forEach(([key, value]) => {
      const clean = String(value || "").trim();
      if (clean) params.set(key, clean);
    });

    if ($("audit-include-noise")?.checked) params.set("include_noise", "true");
    return params;
  }

  async function loadLogs() {
    const tbody = $("audit-table-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" class="audit-empty">جاري تحميل السجل...</td></tr>`;

    try {
      state.limit = Number($("audit-limit")?.value || state.limit || 20);
      const response = await fetch(apiUrl(`/activities/recent?${buildParams().toString()}`), {
        headers: { ...authHeaders() },
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 401) {
        window.location.href = "./index.html";
        return;
      }
      if (!response.ok) throw new Error(result.message || "تعذر تحميل سجل الأحداث");

      state.items = Array.isArray(result.data) ? result.data : [];
      state.totalCount = Number(result.pagination?.totalCount || 0);
      state.totalPages = Number(result.pagination?.totalPages || 0);
      state.page = Number(result.pagination?.currentPage || state.page || 1);
      renderLogs();
      renderPagination();
    } catch (error) {
      console.error("Activity logs page error:", error);
      tbody.innerHTML = `<tr><td colspan="8" class="audit-empty">${escapeHtml(error.message || "تعذر تحميل سجل الأحداث")}</td></tr>`;
      $("audit-table-subtitle").textContent = "تعذر تحميل السجل. تأكد من تشغيل الباك إند والصلاحيات.";
    }
  }

  function renderLogs() {
    const tbody = $("audit-table-body");
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="audit-empty">لا توجد أحداث مطابقة للفلاتر الحالية.</td></tr>`;
      $("audit-table-subtitle").textContent = "لم يتم العثور على نتائج.";
      return;
    }

    tbody.innerHTML = state.items
      .map((item, index) => {
        const severity = String(item.severity || "normal").toLowerCase();
        const result = String(item.result || (Number(item.status_code || 200) >= 400 ? "failure" : "success")).toLowerCase();
        return `
          <tr>
            <td>${escapeHtml(formatDateTime(item))}</td>
            <td><strong>${escapeHtml(text(item.action_label, item.action || "عملية"))}</strong></td>
            <td>${escapeHtml(moduleLabel(item))}</td>
            <td class="audit-description">${escapeHtml(text(item.display_text, item.description || "—"))}</td>
            <td>
              <strong>${escapeHtml(text(item.actor_name, item.user_name || "مستخدم غير معروف"))}</strong>
              <div class="audit-muted">${escapeHtml(roleLabel(item.user_role))}</div>
            </td>
            <td>${badge(severityLabel(severity), severity)}</td>
            <td>${badge(resultLabel(result), result)}</td>
            <td><button type="button" class="audit-btn audit-btn--ghost audit-details-btn" data-audit-index="${index}">عرض</button></td>
          </tr>`;
      })
      .join("");

    $("audit-table-subtitle").textContent = `تم عرض ${state.items.length.toLocaleString("ar-EG")} حدث في هذه الصفحة.`;
  }

  function renderPagination() {
    $("audit-total-count").textContent = state.totalCount.toLocaleString("ar-EG");
    $("audit-current-page").textContent = state.page.toLocaleString("ar-EG");
    $("audit-total-pages").textContent = state.totalPages.toLocaleString("ar-EG");
    $("audit-page-info").textContent = `الصفحة ${state.page.toLocaleString("ar-EG")} من ${Math.max(state.totalPages, 1).toLocaleString("ar-EG")}`;
    $("audit-prev-btn").disabled = state.page <= 1;
    $("audit-next-btn").disabled = state.page >= state.totalPages || state.totalPages === 0;
  }

  function detailItem(label, value) {
    if (value === null || value === undefined || String(value).trim() === "" || value === "—") return "";
    return `<div class="audit-detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function openDetails(index) {
    const activity = state.items[index];
    if (!activity) return;

    const severity = String(activity.severity || "normal").toLowerCase();
    const result = String(activity.result || (Number(activity.status_code || 200) >= 400 ? "failure" : "success")).toLowerCase();
    const details = objectOrEmpty(activity.details);
    const targetLabel = activity.target_label || details.target_label || "";

    $("auditDetailsTitle").textContent = text(activity.action_label, activity.action || "تفاصيل الحدث");
    $("audit-details-body").innerHTML = `
      <section class="audit-detail-section">
        <h3>ملخص العملية</h3>
        <div class="audit-detail-grid">
          ${detailItem("نوع العملية", text(activity.action_label, activity.action || "عملية"))}
          ${detailItem("القسم", moduleLabel(activity))}
          ${detailItem("الحالة", resultLabel(result))}
          ${detailItem("الأهمية", severityLabel(severity))}
          ${detailItem("التاريخ والوقت", formatDateTime(activity))}
        </div>
      </section>

      <section class="audit-detail-section">
        <h3>الوصف</h3>
        <p class="audit-description">${escapeHtml(text(activity.display_text, activity.description || "—"))}</p>
      </section>

      <section class="audit-detail-section">
        <h3>المستخدم المنفذ</h3>
        <div class="audit-detail-grid">
          ${detailItem("الاسم", text(activity.actor_name, activity.user_name || "مستخدم غير معروف"))}
          ${detailItem("الدور", roleLabel(activity.user_role))}
        </div>
      </section>

      ${targetLabel || activity.reason ? `
        <section class="audit-detail-section">
          <h3>السجل المتأثر</h3>
          <div class="audit-detail-grid">
            ${detailItem("الاسم", targetLabel)}
            ${detailItem("السبب", activity.reason)}
          </div>
        </section>` : ""}

      ${renderChanges(activity)}
    `;

    $("audit-details-drawer").classList.add("is-open");
    $("audit-details-drawer").setAttribute("aria-hidden", "false");
    document.body.classList.add("audit-no-scroll");
  }

  function closeDetails() {
    $("audit-details-drawer").classList.remove("is-open");
    $("audit-details-drawer").setAttribute("aria-hidden", "true");
    document.body.classList.remove("audit-no-scroll");
  }

  function resetFilters() {
    $("audit-filter-form").reset();
    state.page = 1;
    state.limit = 20;
    $("audit-limit").value = "20";
    loadLogs();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const storedTheme = localStorage.getItem("theme") || localStorage.getItem("admin-theme");
    if (storedTheme === "light") document.body.classList.remove("theme-dark");
    if (storedTheme === "dark") document.body.classList.add("theme-dark");

    $("audit-back-btn").addEventListener("click", () => {
      window.location.href = "./index.html";
    });
    $("audit-refresh-btn").addEventListener("click", loadLogs);
    $("audit-reset-btn").addEventListener("click", resetFilters);
    $("audit-filter-form").addEventListener("submit", (event) => {
      event.preventDefault();
      state.page = 1;
      loadLogs();
    });
    $("audit-limit").addEventListener("change", () => {
      state.page = 1;
      loadLogs();
    });
    $("audit-prev-btn").addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        loadLogs();
      }
    });
    $("audit-next-btn").addEventListener("click", () => {
      if (state.page < state.totalPages) {
        state.page += 1;
        loadLogs();
      }
    });
    $("audit-table-body").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-audit-index]");
      if (!btn) return;
      openDetails(Number(btn.dataset.auditIndex));
    });
    document.querySelectorAll("[data-audit-close]").forEach((el) => el.addEventListener("click", closeDetails));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDetails();
    });

    loadLogs();
  });
})();
