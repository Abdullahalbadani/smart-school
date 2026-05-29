// frontend/admin/js/monthlyCertificates.js
(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

  function apiUrl(path = "") {
    if (/^https?:\/\//i.test(path)) return path;

    let cleanPath = String(path || "").replace(/^\/+/, "");
    if (cleanPath.startsWith("api/")) cleanPath = cleanPath.slice(4);

    return `${API_BASE}/${cleanPath}`;
  }

  const TYPES = {
    monthly: {
      title: "الشهادات الشهرية",
      desc:
        "إصدار شهادات شكر وتقدير شهرية للطلاب المحددين من الإدارة.",
      note:
        "الشهادات الشهرية تحتاج السنة، الفصل، الشهر، المرحلة، الصف، والشعبة.",
      issueText: "إصدار شهادات شهرية للمحددين",
      emptyText: "اختر الفلاتر ثم حمّل الطلاب لإصدار الشهادات الشهرية.",
    },
    midterm: {
      title: "الشهادات النصفية",
      desc:
        "إصدار شهادات نتيجة الفصل الأول من النتائج المعتمدة أو المنشورة فقط.",
      note:
        "الشهادات النصفية تعتمد تلقائيًا على نتائج الفصل الأول المعتمدة أو المنشورة.",
      issueText: "إصدار شهادات نصفية للمحددين",
      emptyText:
        "اختر السنة والمرحلة والصف والشعبة، ثم حمّل الطلاب من نتائج الفصل الأول.",
    },
    final: {
      title: "الشهادات النهائية",
      desc:
        "إصدار شهادات نهاية العام من نتائج الفصل الثاني المعتمدة أو المنشورة فقط.",
      note:
        "الشهادات النهائية تعتمد تلقائيًا على نتائج الفصل الثاني المعتمدة أو المنشورة.",
      issueText: "إصدار شهادات نهائية للمحددين",
      emptyText:
        "اختر السنة والمرحلة والصف والشعبة، ثم حمّل الطلاب من نتائج الفصل الثاني.",
    },
  };

  const state = {
    type: "monthly",
    meta: {},
    certMeta: {},
    students: [],
    certificates: [],
    previewItems: [],
  };

  function root() {
    return document.getElementById("monthlyCertificatesPage");
  }

  function qs(selector, base = root()) {
    return base ? base.querySelector(selector) : null;
  }

  function qsa(selector, base = root()) {
    return base ? Array.from(base.querySelectorAll(selector)) : [];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getToken() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }

  async function apiRequest(method, path, body) {
    const headers = { Accept: "application/json" };
    const token = getToken();

    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(apiUrl(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.message || `فشل الاتصال بالسيرفر: ${res.status}`);
    }

    return data;
  }

  const apiGet = (path) => apiRequest("GET", path);
  const apiPost = (path, body) => apiRequest("POST", path, body);
  const apiDelete = (path) => apiRequest("DELETE", path);

  function showAlert(message, type = "info") {
    const el = qs("#certAlert");
    if (!el) return;

    if (!message) {
      el.className = "cert-alert";
      el.textContent = "";
      return;
    }

    el.className = `cert-alert show ${type}`;
    el.textContent = message;
  }

  function toast(message, type = "info") {
    if (window.AppUI?.toast) {
      window.AppUI.toast(message, type);
      return;
    }

    showAlert(message, type === "error" ? "error" : type);
  }

  async function confirmDialog(options = {}) {
    if (window.AppUI?.confirm) {
      return await window.AppUI.confirm(options);
    }

    return confirm(options.message || "هل تريد المتابعة؟");
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return;

    if (loading) {
      button.dataset.oldText = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="ri-loader-4-line"></i> ${escapeHtml(text || "جاري التنفيذ")}`;
      return;
    }

    button.disabled = false;

    if (button.dataset.oldText) {
      button.innerHTML = button.dataset.oldText;
      delete button.dataset.oldText;
    }
  }

  function getMetaArray(names) {
    for (const name of names) {
      const value = state.meta?.[name];
      if (Array.isArray(value)) return value;
    }

    return [];
  }

  function selectedNumber(selector) {
    const value = qs(selector)?.value;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function fillSelect(select, items, placeholder, labelFn) {
    if (!select) return;

    select.innerHTML = "";

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);

    for (const item of items) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = labelFn(item);
      select.appendChild(option);
    }
  }

  function fillAcademicYears() {
    const years = getMetaArray(["academicYears", "academic_years", "years"]);
    const select = qs("#certAcademicYear");

    fillSelect(select, years, "اختر السنة الدراسية", (item) => {
      return item.name || item.title || `سنة ${item.id}`;
    });

    const active = years.find((item) => item.is_active) || years[0];
    if (active && select) select.value = String(active.id);
  }

  function fillStages() {
    const stages = getMetaArray(["stages"]);

    fillSelect(qs("#certStage"), stages, "اختر المرحلة", (item) => {
      return item.name || `مرحلة ${item.id}`;
    });
  }

  function fillGrades() {
    const stageId = selectedNumber("#certStage");

    const grades = getMetaArray(["grades"]).filter((item) => {
      if (!stageId) return true;
      return Number(item.stage_id) === stageId;
    });

    fillSelect(qs("#certGrade"), grades, "اختر الصف", (item) => {
      return item.grade_name || item.name || `صف ${item.id}`;
    });
  }

  function fillSections() {
    const gradeId = selectedNumber("#certGrade");

    const sections = getMetaArray(["sections"]).filter((item) => {
      if (!gradeId) return true;
      return Number(item.grade_id) === gradeId;
    });

    fillSelect(qs("#certSection"), sections, "اختر الشعبة", (item) => {
      return item.name || `شعبة ${item.id}`;
    });
  }

  function monthName(month) {
    const names = {
      1: "يناير",
      2: "فبراير",
      3: "مارس",
      4: "أبريل",
      5: "مايو",
      6: "يونيو",
      7: "يوليو",
      8: "أغسطس",
      9: "سبتمبر",
      10: "أكتوبر",
      11: "نوفمبر",
      12: "ديسمبر",
    };

    return names[Number(month)] || "—";
  }

  function termLabel(term) {
    if (Number(term) === 1) return "الفصل الأول";
    if (Number(term) === 2) return "الفصل الثاني";
    return "—";
  }

  function statusLabel(status) {
    const map = {
      issued: "صادرة",
      printed: "مطبوعة",
      canceled: "ملغاة",
      passed: "ناجح",
      failed: "راسب",
      incomplete: "ناقص",
      missing: "ناقص",
      approved: "معتمدة",
      published: "منشورة",
      calculated: "محسوبة",
    };

    return map[status] || status || "—";
  }

  function formatNumber(value, digits = 2) {
    const n = Number(value);

    if (!Number.isFinite(n)) return "—";
    if (Number.isInteger(n)) return String(n);

    return n.toFixed(digits);
  }

  function formatDate(value) {
    const date = value ? new Date(String(value).replace(" ", "T")) : new Date();

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function getFilters() {
    const filters = {
      academic_year_id: selectedNumber("#certAcademicYear"),
      stage_id: selectedNumber("#certStage"),
      grade_id: selectedNumber("#certGrade"),
      section_id: selectedNumber("#certSection"),
    };

    if (state.type === "monthly") {
      filters.term = selectedNumber("#certTerm");
      filters.month = selectedNumber("#certMonth");
    }

    return filters;
  }

  function validateFilters() {
    const filters = getFilters();

    if (!filters.academic_year_id) throw new Error("اختر السنة الدراسية.");
    if (!filters.stage_id) throw new Error("اختر المرحلة.");
    if (!filters.grade_id) throw new Error("اختر الصف.");
    if (!filters.section_id) throw new Error("اختر الشعبة.");

    if (state.type === "monthly") {
      if (!filters.term) throw new Error("اختر الفصل الدراسي.");
      if (!filters.month) throw new Error("اختر الشهر.");
    }

    return filters;
  }

  function queryString(filters) {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") {
        params.set(key, String(value));
      }
    });

    return params.toString();
  }

  function pickValue(source, keys) {
    if (!source || typeof source !== "object") return "";

    for (const key of keys) {
      const value = source[key];

      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }

    return "";
  }

  function normalizeAssetUrl(url) {
    const raw = String(url || "").trim();

    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;

    const origin = API_BASE.replace(/\/api\/?$/, "");
    return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
  }

  function getSchoolName() {
    const school = state.certMeta?.school || {};
    const settings = state.certMeta?.settings || {};

    return (
      pickValue(settings, ["school_name", "name", "arabic_name", "official_name"]) ||
      pickValue(school, ["name", "school_name", "arabic_name", "official_name"]) ||
      "اسم المدرسة"
    );
  }

  function getPrincipalName() {
    const school = state.certMeta?.school || {};
    const settings = state.certMeta?.settings || {};

    return (
      pickValue(settings, [
        "principal_name",
        "manager_name",
        "director_name",
        "headmaster_name",
      ]) ||
      pickValue(school, [
        "principal_name",
        "manager_name",
        "director_name",
        "headmaster_name",
      ]) ||
      "مدير المدرسة"
    );
  }

  function getSchoolLogo() {
    const school = state.certMeta?.school || {};
    const settings = state.certMeta?.settings || {};

    const logo =
      pickValue(settings, ["logo_url", "school_logo", "logo", "logo_path"]) ||
      pickValue(school, ["logo_url", "school_logo", "logo", "logo_path"]) ||
      "";

    return normalizeAssetUrl(logo);
  }

  async function loadCertificateMeta() {
    const data = await apiGet("/admin/certificates/meta");
    state.certMeta = data || {};
  }

  function selectedStudentIds() {
    return qsa(".cert-student-check:checked")
      .map((input) => Number(input.value))
      .filter(Boolean);
  }

  function selectedCertificateIds() {
    return qsa(".cert-cert-check:checked")
      .map((input) => Number(input.value))
      .filter(Boolean);
  }

  function certSnapshot(item) {
    const snapshot =
      item?.snapshot_json && typeof item.snapshot_json === "object"
        ? item.snapshot_json
        : {};

    const merged = {
      ...item,
      ...snapshot,
    };

    return {
      ...merged,
      id: item?.id ?? snapshot.id ?? null,
      student_id: item?.student_id ?? snapshot.student_id ?? null,
      certificate_type:
        snapshot.certificate_type ||
        item?.certificate_type ||
        state.type,
      student_name:
        snapshot.student_name ||
        item?.student_name ||
        item?.full_name ||
        "",
      full_name:
        snapshot.student_name ||
        snapshot.full_name ||
        item?.full_name ||
        item?.student_name ||
        "",
      student_code:
        snapshot.student_code ||
        item?.student_code ||
        "",
      issued_at:
        snapshot.issued_at ||
        item?.issued_at ||
        item?.created_at ||
        new Date().toISOString(),
      title:
        snapshot.title ||
        item?.title ||
        TYPES[state.type].title,
      school_name:
        snapshot.school_name ||
        item?.school_name ||
        getSchoolName(),
      principal_name:
        snapshot.principal_name ||
        item?.principal_name ||
        getPrincipalName(),
      logo_url:
        snapshot.logo_url ||
        item?.logo_url ||
        getSchoolLogo(),
      subjects: Array.isArray(snapshot.subjects) ? snapshot.subjects : [],
    };
  }

  function updateButtons() {
    const selectedStudents = selectedStudentIds();
    const selectedCerts = selectedCertificateIds();

    const saveBtn = qs("#certSaveBtn");
    const previewBtn = qs("#certPreviewBtn");
    const printBtn = qs("#certPrintBtn");

    if (saveBtn) saveBtn.disabled = selectedStudents.length === 0;

    if (previewBtn) {
      previewBtn.disabled = !(
        selectedCerts.length ||
        (state.type === "monthly" && selectedStudents.length) ||
        state.certificates.length
      );
    }

    if (printBtn) printBtn.disabled = state.previewItems.length === 0;
  }

  function clearData() {
    state.students = [];
    state.certificates = [];
    state.previewItems = [];

    renderStudents();
    renderCertificates();
    renderPreview([]);

    const selectAll = qs("#certSelectAll");
    if (selectAll) selectAll.checked = false;
  }
function applyTypeUI() {
  const config = TYPES[state.type];

  qs("#certMainTitle") && (qs("#certMainTitle").textContent = config.title);
  qs("#certMainDesc") && (qs("#certMainDesc").textContent = config.desc);
  qs("#certModeNote") && (qs("#certModeNote").textContent = config.note);

  const saveBtn = qs("#certSaveBtn span");
  if (saveBtn) saveBtn.textContent = config.issueText;

  qsa(".cert-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.certTab === state.type);
  });

  const isMonthly = state.type === "monthly";

  qsa(".cert-monthly-only").forEach((el) => {
    el.hidden = !isMonthly;
    el.style.display = isMonthly ? "" : "none";

    const input = el.querySelector("select, input");
    if (input) {
      input.disabled = !isMonthly;
    }
  });

  const termSelect = qs("#certTerm");
  const monthSelect = qs("#certMonth");

  if (!isMonthly) {
    if (termSelect) termSelect.value = "";
    if (monthSelect) monthSelect.value = "";
  }

  const empty = qs("#certStudentsEmpty");
  if (empty) empty.textContent = config.emptyText;
}

 function renderStudentsHead() {
  const head = qs("#certStudentsHead");
  if (!head) return;

  head.innerHTML = `
    <tr>
      <th>اختيار</th>
      <th>الطالب</th>
      <th>رقم الطالب</th>
      <th>الرقم</th>
      <th>الحالة</th>
    </tr>
  `;
}function renderStudents() {
  const wrap = qs("#certStudentsTableWrap");
  const empty = qs("#certStudentsEmpty");
  const body = qs("#certStudentsBody");
  const count = qs("#certStudentsCount");
  const q = String(qs("#certSearch")?.value || "").trim().toLowerCase();

  if (!body || !wrap || !empty) return;

  renderStudentsHead();

  const items = state.students.filter((row) => {
    if (!q) return true;

    return (
      String(row.full_name || "").toLowerCase().includes(q) ||
      String(row.student_code || "").toLowerCase().includes(q)
    );
  });

  if (count) {
    count.textContent = state.students.length
      ? `${items.length} طالب ظاهر من أصل ${state.students.length}.`
      : "لم يتم تحميل الطلاب بعد.";
  }

  if (!items.length) {
    body.innerHTML = "";
    wrap.style.display = "none";
    empty.style.display = "";
    updateButtons();
    return;
  }

  empty.style.display = "none";
  wrap.style.display = "";

  body.innerHTML = items
    .map((row) => {
      const issued = !!row.already_issued;

      return `
        <tr>
          <td data-label="اختيار">
            <input
              type="checkbox"
              class="cert-student-check"
              value="${escapeHtml(row.student_id)}"
              ${issued ? "disabled" : ""}
            >
          </td>

          <td data-label="الطالب">
            <div class="cert-student-name">${escapeHtml(row.full_name || "—")}</div>
            <div class="cert-muted">ID: ${escapeHtml(row.student_id || "—")}</div>
          </td>

          <td data-label="رقم الطالب">${escapeHtml(row.student_code || "—")}</td>
          <td data-label="الرقم">${escapeHtml(row.roll_number || "—")}</td>

          <td data-label="الحالة">
            ${
              issued
                ? `<span class="cert-badge cert-badge-issued">تم إصدار شهادة</span>`
                : `<span class="cert-badge cert-badge-new">متاح للإصدار</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  qsa(".cert-student-check").forEach((input) => {
    input.addEventListener("change", updateButtons);
  });

  const selectAll = qs("#certSelectAll");
  if (selectAll) selectAll.checked = false;

  updateButtons();
}

  function renderIssuedHead() {
    const head = qs("#certIssuedHead");
    if (!head) return;

    head.innerHTML = `
      <tr>
        <th>اختيار</th>
        <th>الطالب</th>
        <th>رقم الطالب</th>
        <th>تاريخ الإصدار</th>
        <th>الحالة</th>
        <th>إجراء</th>
      </tr>
    `;
  }

  function renderCertificates() {
    const wrap = qs("#certIssuedTableWrap");
    const body = qs("#certIssuedBody");
    const count = qs("#certIssuedCount");

    if (!wrap || !body) return;

    renderIssuedHead();

    if (count) count.textContent = `${state.certificates.length} شهادة محفوظة.`;

    if (!state.certificates.length) {
      wrap.style.display = "none";
      body.innerHTML = "";
      updateButtons();
      return;
    }

    wrap.style.display = "";

    body.innerHTML = state.certificates
      .map((raw) => {
        const row = certSnapshot(raw);

        return `
          <tr>
            <td data-label="اختيار">
              <input type="checkbox" class="cert-cert-check" value="${escapeHtml(row.id)}">
            </td>

            <td data-label="الطالب">
              <div class="cert-student-name">${escapeHtml(row.student_name || row.full_name || "—")}</div>
              <div class="cert-muted">ID: ${escapeHtml(row.student_id || "—")}</div>
            </td>

            <td data-label="رقم الطالب">${escapeHtml(row.student_code || "—")}</td>
            <td data-label="تاريخ الإصدار">${escapeHtml(formatDate(row.issued_at))}</td>

            <td data-label="الحالة">
              <span class="cert-badge ${row.status === "printed" ? "cert-badge-printed" : "cert-badge-new"}">
                ${escapeHtml(statusLabel(row.status))}
              </span>
            </td>

            <td data-label="إجراء">
              <button class="cert-btn cert-btn-danger cert-delete-btn" type="button" data-id="${escapeHtml(row.id)}">
                حذف
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".cert-cert-check").forEach((input) => {
      input.addEventListener("change", updateButtons);
    });

    qsa(".cert-delete-btn").forEach((button) => {
      button.addEventListener("click", () => {
        deleteCertificate(Number(button.dataset.id || 0));
      });
    });

    updateButtons();
  }

 function certificateFromStudent(row) {
  const filters = getFilters();

  const title =
    state.type === "monthly"
      ? "شهادة شكر وتقدير"
      : state.type === "midterm"
        ? "شهادة تقدير وتفوق"
        : "شهادة تقدير نهاية العام";

  const occasion =
    state.type === "monthly"
      ? `${monthName(filters.month)} - ${termLabel(filters.term)}`
      : state.type === "midterm"
        ? "منتصف العام الدراسي"
        : "نهاية العام الدراسي";

  const message =
    state.type === "monthly"
      ? "تقديرًا لتميزك خلال هذا الشهر، وتهانينا لك على جهدك الجميل وسلوكك الرائع."
      : state.type === "midterm"
        ? "تقديرًا لتميزك خلال الفصل الدراسي الأول، وتهانينا لك على هذا الإنجاز الجميل."
        : "تقديرًا لتميزك خلال العام الدراسي، وتهانينا لك على جهدك وتفوقك المستمر.";

  return {
    id: null,
    certificate_type: state.type,

    student_id: row.student_id,
    student_name: row.full_name,
    full_name: row.full_name,
    student_code: row.student_code,
    roll_number: row.roll_number,

    stage_name: row.stage_name,
    grade_name: row.grade_name,
    section_name: row.section_name,

    academic_year_id: filters.academic_year_id,
    term: filters.term || null,
    term_label: filters.term ? termLabel(filters.term) : null,
    month: filters.month || null,
    month_name: filters.month ? monthName(filters.month) : null,

    title,
    occasion,
    message,

    school_name: getSchoolName(),
    principal_name: getPrincipalName(),
    logo_url: getSchoolLogo(),

    issued_at: new Date().toISOString(),
    status: "preview",
  };
}

  function monthlyCertificateHTML(rawItem) {
    const item = certSnapshot(rawItem);
    const logo = normalizeAssetUrl(item.logo_url || getSchoolLogo());

    return `
      <article class="cert-monthly-sheet" dir="rtl">
        <div class="cert-deco cert-deco-a"></div>
        <div class="cert-deco cert-deco-b"></div>
        <div class="cert-monthly-border"></div>

        <div class="cert-monthly-inner">
          <header class="cert-monthly-header">
            ${
              logo
                ? `<img src="${escapeHtml(logo)}" alt="شعار المدرسة">`
                : ""
            }
            <h2>${escapeHtml(item.school_name || getSchoolName())}</h2>
            <span>إدارة المدرسة</span>
          </header>

          <main class="cert-monthly-main">
            <h1>${escapeHtml(item.title || "شهادة شكر وتقدير")}</h1>
            <p class="cert-give">تمنح هذه الشهادة إلى الطالب:</p>

            <div class="cert-big-name">
              ${escapeHtml(item.student_name || item.full_name || "اسم الطالب")}
            </div>

            <p class="cert-body-text">
              تهانينا لك على مستواك الرائع مع الشكر والتقدير
              وأطيب الأمنيات لك بمزيد من النجاح والتفوق.
            </p>

            <p class="cert-sub-line">
              ${escapeHtml(item.month_name || monthName(item.month))}
              ${item.term_label ? ` - ${escapeHtml(item.term_label)}` : ""}
            </p>
          </main>

          <footer class="cert-monthly-footer">
            <div>
              <span>التاريخ</span>
              <b>${escapeHtml(formatDate(item.issued_at))}</b>
            </div>

            <div>
              <span>مدير المدرسة</span>
              <b>${escapeHtml(item.principal_name || getPrincipalName())}</b>
            </div>
          </footer>
        </div>
      </article>
    `;
  }
  function appreciationCertificateHTML(rawItem) {
  const item = certSnapshot(rawItem);
  const logo = normalizeAssetUrl(item.logo_url || getSchoolLogo());

  const title =
    item.title ||
    (item.certificate_type === "midterm"
      ? "شهادة تقدير وتفوق"
      : item.certificate_type === "final"
        ? "شهادة تقدير نهاية العام"
        : "شهادة شكر وتقدير");

  const message =
    item.message ||
    (item.certificate_type === "midterm"
      ? "تقديرًا لتميزك خلال الفصل الدراسي الأول، وتهانينا لك على هذا الإنجاز الجميل."
      : item.certificate_type === "final"
        ? "تقديرًا لتميزك خلال العام الدراسي، وتهانينا لك على جهدك وتفوقك المستمر."
        : "تقديرًا لتميزك خلال هذا الشهر، وتهانينا لك على جهدك الجميل وسلوكك الرائع.");

  const occasion =
    item.occasion ||
    item.month_name ||
    item.term_label ||
    "";

  return `
    <article class="cert-monthly-sheet cert-appreciation-sheet" dir="rtl">
      <div class="cert-deco cert-deco-a"></div>
      <div class="cert-deco cert-deco-b"></div>
      <div class="cert-monthly-border"></div>

      <div class="cert-monthly-inner">
        <header class="cert-monthly-header">
          ${
            logo
              ? `<img src="${escapeHtml(logo)}" alt="شعار المدرسة">`
              : ""
          }

          <h2>${escapeHtml(item.school_name || getSchoolName())}</h2>
          <span>إدارة المدرسة</span>
        </header>

        <main class="cert-monthly-main">
          <h1>${escapeHtml(title)}</h1>

          <p class="cert-give">تمنح هذه الشهادة إلى الطالب:</p>

          <div class="cert-big-name">
            ${escapeHtml(item.student_name || item.full_name || "اسم الطالب")}
          </div>

          <p class="cert-body-text">
            ${escapeHtml(message)}
          </p>

          ${
            occasion
              ? `<p class="cert-sub-line">${escapeHtml(occasion)}</p>`
              : ""
          }
        </main>

        <footer class="cert-monthly-footer">
          <div>
            <span>التاريخ</span>
            <b>${escapeHtml(formatDate(item.issued_at))}</b>
          </div>

          <div>
            <span>مدير المدرسة</span>
            <b>${escapeHtml(item.principal_name || getPrincipalName())}</b>
          </div>
        </footer>
      </div>
    </article>
  `;
}
function resultCertificateHTML(rawItem) {
  return appreciationCertificateHTML(rawItem);
}
  function certificateHTML(item) {
    const snap = certSnapshot(item);

    if (snap.certificate_type === "monthly") {
      return monthlyCertificateHTML(snap);
    }

    return resultCertificateHTML(snap);
  }

  function renderPreview(items) {
    const area = qs("#certPrintArea");
    if (!area) return;

    state.previewItems = Array.isArray(items) ? items : [];

    if (!state.previewItems.length) {
      area.innerHTML = `<div class="cert-empty">لا توجد شهادات للمعاينة.</div>`;
      updateButtons();
      return;
    }

    area.innerHTML = state.previewItems.map(certificateHTML).join("");
    updateButtons();
  }

  async function loadMeta() {
    showAlert("جاري تحميل بيانات الفلاتر...");

    const payload = await apiGet("/timetables/meta");
    state.meta = payload?.data || payload || {};

    fillAcademicYears();
    fillStages();
    fillGrades();
    fillSections();

    showAlert("");
  }

  async function loadStudents() {
    const btn = qs("#certLoadStudentsBtn");

    try {
      const filters = validateFilters();

      setButtonLoading(btn, true, "جاري تحميل الطلاب");
      showAlert("");

      const data = await apiGet(
        `/admin/certificates/${state.type}/students?${queryString(filters)}`
      );

      state.students = Array.isArray(data?.items) ? data.items : [];
      renderStudents();

      if (data?.batch_ready === false) {
        showAlert(data.message || "لا توجد نتائج جاهزة لهذا النطاق.", "error");
        toast(data.message || "لا توجد نتائج جاهزة لهذا النطاق.", "warning");
        return;
      }

      showAlert(
        state.students.length
          ? `تم تحميل ${state.students.length} طالب.`
          : "لا توجد بيانات طلاب لهذا النطاق.",
        state.students.length ? "success" : "error"
      );
    } catch (err) {
      showAlert(err.message || "تعذر تحميل الطلاب.", "error");
      toast(err.message || "تعذر تحميل الطلاب.", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function loadCertificates() {
    const btn = qs("#certLoadIssuedBtn");

    try {
      const filters = validateFilters();

      setButtonLoading(btn, true, "جاري العرض");
      showAlert("");

      const data = await apiGet(
        `/admin/certificates/${state.type}?${queryString(filters)}`
      );

      state.certificates = Array.isArray(data?.items) ? data.items : [];
      renderCertificates();

      if (!state.certificates.length) {
        renderPreview([]);
        showAlert("لا توجد شهادات محفوظة حسب الفلاتر المحددة.", "error");
      } else {
        showAlert(`تم عرض ${state.certificates.length} شهادة محفوظة.`, "success");
      }
    } catch (err) {
      showAlert(err.message || "تعذر عرض الشهادات المحفوظة.", "error");
      toast(err.message || "تعذر عرض الشهادات المحفوظة.", "error");
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function saveCertificates() {
    const btn = qs("#certSaveBtn");

    try {
      const filters = validateFilters();
      const ids = selectedStudentIds();

      if (!ids.length) {
        toast("اختر طالبًا واحدًا على الأقل.", "warning");
        return;
      }

      const ok = await confirmDialog({
        title: "إصدار الشهادات",
        message:
          `سيتم إصدار ${ids.length} شهادة من نوع: ${TYPES[state.type].title}.\n\n` +
          "لن يتم إصدار شهادة للطالب إذا كانت موجودة مسبقًا.",
        confirmText: "إصدار الشهادات",
        cancelText: "إلغاء",
        type: "success",
      });

      if (!ok) return;

      setButtonLoading(btn, true, "جاري الإصدار");

      const result = await apiPost(`/admin/certificates/${state.type}`, {
        ...filters,
        student_ids: ids,
      });

      toast(result.message || "تم إصدار الشهادات.", "success");
      showAlert(result.message || "تم إصدار الشهادات.", "success");

      await loadStudents();
      await loadCertificates();

      const createdIds = Array.isArray(result?.items)
        ? result.items.map((x) => Number(x.id)).filter(Boolean)
        : [];

      if (createdIds.length) {
        const created = state.certificates.filter((x) =>
          createdIds.includes(Number(x.id))
        );

        renderPreview(created);
      }
    } catch (err) {
      showAlert(err.message || "تعذر إصدار الشهادات.", "error");
      toast(err.message || "تعذر إصدار الشهادات.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateButtons();
    }
  }

 function previewSelected() {
  const certIds = selectedCertificateIds();

  if (certIds.length) {
    renderPreview(
      state.certificates.filter((x) => certIds.includes(Number(x.id)))
    );
    return;
  }

  const studentIds = selectedStudentIds();

  if (studentIds.length) {
    renderPreview(
      state.students
        .filter((x) => studentIds.includes(Number(x.student_id)))
        .map(certificateFromStudent)
    );
    return;
  }

  if (state.certificates.length) {
    renderPreview(state.certificates);
    return;
  }

  toast("اختر طلابًا أو شهادات محفوظة للمعاينة.", "warning");
}
  async function markPreviewedAsPrinted() {
    const ids = state.previewItems.map((x) => Number(x.id)).filter(Boolean);

    for (const id of ids) {
      try {
        await apiPost(`/admin/certificates/${state.type}/${id}/printed`, {});
      } catch (err) {
        console.warn("Failed to mark printed", id, err);
      }
    }
  }

  async function printPreview() {
    if (!state.previewItems.length) {
      toast("لا توجد شهادات للطباعة.", "warning");
      return;
    }

    window.print();
    await markPreviewedAsPrinted();

    try {
      await loadCertificates();
    } catch (_) {}
  }

  async function deleteCertificate(id) {
    if (!id) return;

    const ok = await confirmDialog({
      title: "حذف شهادة",
      message:
        "سيتم حذف هذه الشهادة من السجل المحفوظ.\n" +
        "لن تظهر ضمن الشهادات المحفوظة بعد الحذف.",
      confirmText: "حذف الشهادة",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    try {
      await apiDelete(`/admin/certificates/${state.type}/${id}`);

      toast("تم حذف الشهادة بنجاح.", "success");

      state.previewItems = state.previewItems.filter((x) => Number(x.id) !== Number(id));
      renderPreview(state.previewItems);

      await loadStudents();
      await loadCertificates();
    } catch (err) {
      toast(err.message || "تعذر حذف الشهادة.", "error");
    }
  }

  function bindEvents() {
    qsa("[data-cert-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.certTab;

        if (!TYPES[type] || type === state.type) return;

        state.type = type;
        applyTypeUI();
        clearData();
        showAlert(TYPES[state.type].emptyText);
      });
    });

    qs("#certStage")?.addEventListener("change", () => {
      fillGrades();
      fillSections();
      clearData();
    });

    qs("#certGrade")?.addEventListener("change", () => {
      fillSections();
      clearData();
    });

    ["#certAcademicYear", "#certTerm", "#certMonth", "#certSection"].forEach((selector) => {
      qs(selector)?.addEventListener("change", clearData);
    });

    qs("#certSearch")?.addEventListener("input", renderStudents);

    qs("#certSelectAll")?.addEventListener("change", (event) => {
      qsa(".cert-student-check:not(:disabled)").forEach((input) => {
        input.checked = event.target.checked;
      });

      updateButtons();
    });

    qs("#certLoadStudentsBtn")?.addEventListener("click", loadStudents);
    qs("#certLoadIssuedBtn")?.addEventListener("click", loadCertificates);
    qs("#certSaveBtn")?.addEventListener("click", saveCertificates);
    qs("#certPreviewBtn")?.addEventListener("click", previewSelected);
    qs("#certPrintBtn")?.addEventListener("click", printPreview);
  }

  async function init() {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    bindEvents();
    applyTypeUI();
    clearData();

    try {
      await loadMeta();
      await loadCertificateMeta();

      const monthSelect = qs("#certMonth");
      if (monthSelect && !monthSelect.value) {
        monthSelect.value = String(new Date().getMonth() + 1);
      }

      showAlert(TYPES[state.type].emptyText);
    } catch (err) {
      showAlert(err.message || "تعذر تحميل بيانات الصفحة.", "error");
      toast(err.message || "تعذر تحميل بيانات الصفحة.", "error");
    }
  }

  window.initCertificatesCenterScreen = init;
  window.initMonthlyCertificatesScreen = init;

  if (document.readyState !== "loading") {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();