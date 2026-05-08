(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

  const state = {
    certMeta: {},
    meta: {},
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
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = { Accept: "application/json" };

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      throw new Error(data?.message || `فشل الاتصال بالسيرفر: ${res.status}`);
    }

    return data;
  }

  const apiGet = (path) => apiRequest("GET", path);
  const apiPost = (path, body) => apiRequest("POST", path, body);
  const apiDelete = (path) => apiRequest("DELETE", path);

  function showAlert(message, type = "info") {
    const el = qs("#mcAlert");
    if (!el) return;

    if (!message) {
      el.className = "mcert-alert";
      el.textContent = "";
      return;
    }

    el.className = `mcert-alert show ${type}`;
    el.textContent = message;
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return;

    if (loading) {
      button.dataset.oldText = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="ri-loader-4-line"></i> ${escapeHtml(text || "جاري التحميل")}`;
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
      option.value = item.id;
      option.textContent = labelFn(item);
      select.appendChild(option);
    }
  }

  function fillAcademicYears() {
    const years = getMetaArray(["academicYears", "academic_years", "years"]);
    const select = qs("#mcAcademicYear");

    fillSelect(select, years, "اختر السنة الدراسية", (item) => item.name || item.title || `سنة ${item.id}`);

    const active = years.find((item) => item.is_active) || years[0];
    if (active && select) select.value = String(active.id);
  }

  function fillStages() {
    const stages = getMetaArray(["stages"]);
    fillSelect(qs("#mcStage"), stages, "اختر المرحلة", (item) => item.name || `مرحلة ${item.id}`);
  }

  function fillGrades() {
    const stageId = selectedNumber("#mcStage");
    const grades = getMetaArray(["grades"]).filter((item) => {
      if (!stageId) return true;
      return Number(item.stage_id) === stageId;
    });

    fillSelect(qs("#mcGrade"), grades, "اختر الصف", (item) => item.grade_name || item.name || `صف ${item.id}`);
  }

  function fillSections() {
    const gradeId = selectedNumber("#mcGrade");
    const sections = getMetaArray(["sections"]).filter((item) => {
      if (!gradeId) return true;
      return Number(item.grade_id) === gradeId;
    });

    fillSelect(qs("#mcSection"), sections, "اختر الشعبة", (item) => item.name || `شعبة ${item.id}`);
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
    return {
      academic_year_id: selectedNumber("#mcAcademicYear"),
      term: selectedNumber("#mcTerm"),
      month: selectedNumber("#mcMonth"),
      stage_id: selectedNumber("#mcStage"),
      grade_id: selectedNumber("#mcGrade"),
      section_id: selectedNumber("#mcSection"),
    };
  }

  function validateFilters() {
    const filters = getFilters();

    if (!filters.academic_year_id) throw new Error("اختر السنة الدراسية.");
    if (!filters.term) throw new Error("اختر الفصل الدراسي.");
    if (!filters.month) throw new Error("اختر الشهر.");
    if (!filters.stage_id) throw new Error("اختر المرحلة.");
    if (!filters.grade_id) throw new Error("اختر الصف.");
    if (!filters.section_id) throw new Error("اختر الشعبة.");

    return filters;
  }

 function getSchoolName() {
  return (
    state.meta?.school?.name ||
    state.meta?.school?.school_name ||
    state.meta?.school_name ||
    state.meta?.settings?.school_name ||
    state.meta?.schoolSettings?.school_name ||
    state.meta?.data?.school_name ||
    state.meta?.data?.school?.name ||
    localStorage.getItem("school_name") ||
    "مدرستنا"
  );
}
  function getSchoolLogo() {
    return (
      state.meta?.school?.logo_url ||
      state.meta?.logo_url ||
      state.meta?.settings?.logo_url ||
      state.meta?.schoolSettings?.logo_url ||
      ""
    );
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

function getCertificateSchool() {
  return state.certMeta?.school || {};
}

function getCertificateSettings() {
  return state.certMeta?.settings || {};
}

function normalizeAssetUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  const apiOrigin = API_BASE.replace(/\/api\/?$/, "");
  return `${apiOrigin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function getSchoolName() {
  const school = getCertificateSchool();
  const settings = getCertificateSettings();

  return (
    pickValue(settings, [
      "school_name",
      "name",
      "arabic_name",
      "display_name",
      "official_name",
    ]) ||
    pickValue(school, [
      "name",
      "school_name",
      "arabic_name",
      "display_name",
      "official_name",
    ]) ||
    state.meta?.school?.name ||
    state.meta?.school_name ||
    "اسم المدرسة"
  );
}

function getPrincipalName() {
  const school = getCertificateSchool();
  const settings = getCertificateSettings();

  return (
    pickValue(settings, [
      "principal_name",
      "manager_name",
      "director_name",
      "headmaster_name",
      "school_principal",
      "school_manager",
      "manager",
      "director",
    ]) ||
    pickValue(school, [
      "principal_name",
      "manager_name",
      "director_name",
      "headmaster_name",
      "school_principal",
      "school_manager",
      "manager",
      "director",
    ]) ||
    "مدير المدرسة"
  );
}

function getSchoolLogo() {
  const school = getCertificateSchool();
  const settings = getCertificateSettings();

  const logo =
    pickValue(settings, [
      "logo_url",
      "school_logo",
      "logo",
      "logo_path",
      "image_url",
    ]) ||
    pickValue(school, [
      "logo_url",
      "school_logo",
      "logo",
      "logo_path",
      "image_url",
    ]);

  return normalizeAssetUrl(logo);
}

async function loadCertificateMeta() {
  const data = await apiGet("/admin/monthly-certificates/meta");
  state.certMeta = data || {};
}
  function getAcademicYearName() {
    const id = selectedNumber("#mcAcademicYear");
    const years = getMetaArray(["academicYears", "academic_years", "years"]);
    const item = years.find((x) => Number(x.id) === Number(id));
    return item?.name || item?.title || "";
  }

  function selectedStudentIds() {
    return qsa(".mc-student-check:checked").map((input) => Number(input.value)).filter(Boolean);
  }

  function selectedCertificateIds() {
    return qsa(".mc-cert-check:checked").map((input) => Number(input.value)).filter(Boolean);
  }

  function updateButtons() {
    const hasSelectedStudents = selectedStudentIds().length > 0;
    const hasSelectedCertificates = selectedCertificateIds().length > 0;
    const hasPreview = state.previewItems.length > 0;

    const saveBtn = qs("#mcSaveBtn");
    const previewBtn = qs("#mcPreviewBtn");
    const printBtn = qs("#mcPrintBtn");

    if (saveBtn) saveBtn.disabled = !hasSelectedStudents;
    if (previewBtn) previewBtn.disabled = !(hasSelectedStudents || hasSelectedCertificates || state.certificates.length);
    if (printBtn) printBtn.disabled = !hasPreview;
  }

  function resetStudents() {
    state.students = [];
    const wrap = qs("#mcStudentsTableWrap");
    const empty = qs("#mcStudentsEmpty");
    const body = qs("#mcStudentsBody");
    const count = qs("#mcStudentsCount");

    if (body) body.innerHTML = "";
    if (wrap) wrap.style.display = "none";
    if (empty) {
      empty.style.display = "";
      empty.textContent = "اختر الفلاتر ثم اضغط تحميل الطلاب.";
    }
    if (count) count.textContent = "لم يتم تحميل الطلاب بعد.";

    const selectAll = qs("#mcSelectAll");
    if (selectAll) selectAll.checked = false;

    updateButtons();
  }

  function renderStudents() {
    const wrap = qs("#mcStudentsTableWrap");
    const empty = qs("#mcStudentsEmpty");
    const body = qs("#mcStudentsBody");
    const count = qs("#mcStudentsCount");
    const q = String(qs("#mcSearch")?.value || "").trim().toLowerCase();

    if (!body || !wrap || !empty) return;

    const items = state.students.filter((row) => {
      if (!q) return true;
      return (
        String(row.full_name || "").toLowerCase().includes(q) ||
        String(row.student_code || "").toLowerCase().includes(q)
      );
    });

    if (count) count.textContent = `${items.length} طالب ظاهر من أصل ${state.students.length}.`;

    if (!items.length) {
      body.innerHTML = "";
      wrap.style.display = "none";
      empty.style.display = "";
      empty.textContent = "لا توجد بيانات طلاب حسب الفلاتر أو البحث.";
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
            <td>
              <input
                type="checkbox"
                class="mc-student-check"
                value="${escapeHtml(row.student_id)}"
                ${issued ? "disabled" : ""}
              >
            </td>
            <td>
              <div class="mcert-student-name">${escapeHtml(row.full_name || "—")}</div>
              <div class="mcert-muted">ID: ${escapeHtml(row.student_id)}</div>
            </td>
            <td>${escapeHtml(row.student_code || "—")}</td>
            <td>${escapeHtml(row.roll_number || "—")}</td>
            <td>
              ${
                issued
                  ? `<span class="mcert-badge mcert-badge-issued">تم إصدار شهادة</span>`
                  : `<span class="mcert-badge mcert-badge-new">متاح للإصدار</span>`
              }
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".mc-student-check").forEach((input) => {
      input.addEventListener("change", updateButtons);
    });

    updateButtons();
  }

  function renderCertificates() {
    const wrap = qs("#mcIssuedTableWrap");
    const body = qs("#mcIssuedBody");
    const count = qs("#mcIssuedCount");

    if (!wrap || !body) return;

    if (count) count.textContent = `${state.certificates.length} شهادة محفوظة.`;

    if (!state.certificates.length) {
      wrap.style.display = "none";
      body.innerHTML = "";
      updateButtons();
      return;
    }

    wrap.style.display = "";

    body.innerHTML = state.certificates
      .map((row) => {
        return `
          <tr>
            <td>
              <input type="checkbox" class="mc-cert-check" value="${escapeHtml(row.id)}">
            </td>
            <td>
              <div class="mcert-student-name">${escapeHtml(row.full_name || "—")}</div>
              <div class="mcert-muted">ID: ${escapeHtml(row.student_id)}</div>
            </td>
            <td>${escapeHtml(row.student_code || "—")}</td>
            <td>${escapeHtml(formatDate(row.issued_at))}</td>
            <td>
              ${
                row.printed_at
                  ? `<span class="mcert-badge mcert-badge-printed">مطبوعة</span>`
                  : `<span class="mcert-badge mcert-badge-new">لم تطبع</span>`
              }
            </td>
            <td>
              <button type="button" class="mcert-btn mcert-btn-danger mc-delete-cert" data-id="${escapeHtml(row.id)}" style="min-height:34px;padding:0 10px;">
                حذف
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".mc-cert-check").forEach((input) => {
      input.addEventListener("change", updateButtons);
    });

    qsa(".mc-delete-cert").forEach((button) => {
      button.addEventListener("click", () => deleteCertificate(Number(button.dataset.id || 0)));
    });

    updateButtons();
  }

  function certificateFromStudent(row) {
    return {
      id: null,
      student_id: row.student_id,
      full_name: row.full_name,
      student_code: row.student_code,
      issued_at: new Date().toISOString(),
      printed_at: null,
    };
  }

 function certificateHTML(item) {
  const schoolName = getSchoolName();
  const principalName = getPrincipalName();
  const logo = getSchoolLogo();
  const dateText = formatDate(item.issued_at || new Date().toISOString());

  return `
    <article class="mcert-certificate" dir="rtl">
      <div class="mcert-deco-top"></div>
      <div class="mcert-deco-bottom"></div>
      <div class="mcert-deco-line"></div>

      <div class="mcert-medal-wrap">
        <div class="mcert-medal-ribbon"></div>
        <div class="mcert-medal"></div>
      </div>

      <div class="mcert-stamp-watermark">ختم المدرسة</div>

      <div class="mcert-inner">
        <header class="mcert-header-block">
          ${
            logo
              ? `<img src="${escapeHtml(logo)}" alt="شعار المدرسة" style="width:58px;height:58px;object-fit:contain;margin-bottom:6px;">`
              : ""
          }
          <h2 class="mcert-school-name">${escapeHtml(schoolName)}</h2>
          <div class="mcert-school-admin">إدارة المدرسة</div>
        </header>

        <main class="mcert-main">
          <h1 class="mcert-title-main">شهادة شكر وتقدير</h1>

          <div class="mcert-give-line">تمنح هذه الشهادة إلى الطالب:</div>

          <div class="mcert-student-display">
            ${escapeHtml(item.full_name || "اسم الطالب")}
          </div>

          <div class="mcert-body-text">
            تهانينا لك على مستواك الرائع مع الشكر والتقدير
            وأطيب أمنياتي لك المزيد من النجاح والتوفيق.
          </div>

          <div class="mcert-love-line">منحة بكل الحب والتقدير</div>
        </main>

        <footer class="mcert-footer">
          <div class="mcert-footer-item">
            <div class="mcert-footer-label">التاريخ</div>
            <div class="mcert-signature-line"></div>
            <div class="mcert-date-value">${escapeHtml(dateText)}</div>
          </div>

          <div class="mcert-footer-item">
            <div class="mcert-footer-label">المدير</div>
            <div class="mcert-signature-line"></div>
            <div class="mcert-principal-name">${escapeHtml(principalName)}</div>
          </div>
        </footer>
      </div>
    </article>
  `;
}
  function renderPreview(items) {
    const printArea = qs("#mcPrintArea");
    if (!printArea) return;

    state.previewItems = items || [];

    if (!state.previewItems.length) {
      printArea.innerHTML = `<div class="mcert-empty">لا توجد شهادات للمعاينة.</div>`;
      updateButtons();
      return;
    }

    printArea.innerHTML = state.previewItems.map(certificateHTML).join("");
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
    const button = qs("#mcLoadStudentsBtn");

    try {
      const filters = validateFilters();
      setButtonLoading(button, true, "جاري تحميل الطلاب");
      showAlert("");

      const params = new URLSearchParams();
      params.set("academic_year_id", filters.academic_year_id);
      params.set("term", filters.term);
      params.set("month", filters.month);
      params.set("stage_id", filters.stage_id);
      params.set("grade_id", filters.grade_id);
      params.set("section_id", filters.section_id);

      const data = await apiGet(`/admin/monthly-certificates/students?${params.toString()}`);
      state.students = Array.isArray(data?.items) ? data.items : [];

      renderStudents();

      if (!state.students.length) {
        showAlert("لا يوجد طلاب في هذه الشعبة.", "error");
      } else {
        showAlert(`تم تحميل ${state.students.length} طالب. اختر الطلاب المطلوب إصدار شهادات لهم.`, "success");
      }
    } catch (err) {
      showAlert(err.message || "تعذر تحميل الطلاب.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function saveCertificates() {
    const button = qs("#mcSaveBtn");

    try {
      const filters = validateFilters();
      const studentIds = selectedStudentIds();

      if (!studentIds.length) {
        return showAlert("اختر طالبًا واحدًا على الأقل.", "error");
      }

      if (!confirm(`سيتم إصدار شهادات شهرية لعدد ${studentIds.length} طالب. هل تريد المتابعة؟`)) {
        return;
      }

      setButtonLoading(button, true, "جاري الحفظ");

      const result = await apiPost("/admin/monthly-certificates", {
        ...filters,
        student_ids: studentIds,
      });

      showAlert(result?.message || "تم حفظ الشهادات.", "success");

      await loadStudents();
      await loadCertificates();

      const createdIds = Array.isArray(result?.items) ? result.items.map((x) => Number(x.id)).filter(Boolean) : [];
      if (createdIds.length) {
        const created = state.certificates.filter((x) => createdIds.includes(Number(x.id)));
        renderPreview(created);
      }
    } catch (err) {
      showAlert(err.message || "تعذر حفظ الشهادات.", "error");
    } finally {
      setButtonLoading(button, false);
      updateButtons();
    }
  }

  async function loadCertificates() {
    const button = qs("#mcLoadIssuedBtn");

    try {
      const filters = validateFilters();
      setButtonLoading(button, true, "جاري العرض");
      showAlert("");

      const params = new URLSearchParams();
      params.set("academic_year_id", filters.academic_year_id);
      params.set("term", filters.term);
      params.set("month", filters.month);
      params.set("stage_id", filters.stage_id);
      params.set("grade_id", filters.grade_id);
      params.set("section_id", filters.section_id);

      const data = await apiGet(`/admin/monthly-certificates?${params.toString()}`);
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
    } finally {
      setButtonLoading(button, false);
    }
  }

  function previewSelected() {
    const certIds = selectedCertificateIds();

    if (certIds.length) {
      const items = state.certificates.filter((row) => certIds.includes(Number(row.id)));
      renderPreview(items);
      return;
    }

    const studentIds = selectedStudentIds();

    if (studentIds.length) {
      const items = state.students
        .filter((row) => studentIds.includes(Number(row.student_id)))
        .map(certificateFromStudent);

      renderPreview(items);
      return;
    }

    if (state.certificates.length) {
      renderPreview(state.certificates);
      return;
    }

    showAlert("اختر طلابًا أو شهادات محفوظة للمعاينة.", "error");
  }

  async function markPreviewedAsPrinted() {
    const ids = state.previewItems.map((x) => Number(x.id)).filter(Boolean);

    for (const id of ids) {
      try {
        await apiPost(`/admin/monthly-certificates/${id}/printed`, {});
      } catch (err) {
        console.warn("Failed to mark certificate as printed", id, err);
      }
    }
  }

  async function printPreview() {
    if (!state.previewItems.length) {
      return showAlert("لا توجد شهادات في المعاينة للطباعة.", "error");
    }

    window.print();

    await markPreviewedAsPrinted();

    try {
      await loadCertificates();
    } catch (_) {
      // لا نوقف المستخدم إذا فشل تحديث القائمة بعد الطباعة
    }
  }

  async function deleteCertificate(id) {
    if (!id) return;

    if (!confirm("هل تريد حذف هذه الشهادة؟")) return;

    try {
      await apiDelete(`/admin/monthly-certificates/${id}`);
      showAlert("تم حذف الشهادة.", "success");
      await loadStudents();
      await loadCertificates();
    } catch (err) {
      showAlert(err.message || "تعذر حذف الشهادة.", "error");
    }
  }

  function setupEvents() {
    qs("#mcStage")?.addEventListener("change", () => {
      fillGrades();
      fillSections();
      resetStudents();
      renderCertificates();
      renderPreview([]);
    });

    qs("#mcGrade")?.addEventListener("change", () => {
      fillSections();
      resetStudents();
      renderCertificates();
      renderPreview([]);
    });

    ["#mcAcademicYear", "#mcTerm", "#mcMonth", "#mcSection"].forEach((selector) => {
      qs(selector)?.addEventListener("change", () => {
        resetStudents();
        state.certificates = [];
        renderCertificates();
        renderPreview([]);
      });
    });

    qs("#mcSearch")?.addEventListener("input", renderStudents);

    qs("#mcSelectAll")?.addEventListener("change", (e) => {
      qsa(".mc-student-check:not(:disabled)").forEach((input) => {
        input.checked = e.target.checked;
      });
      updateButtons();
    });

    qs("#mcLoadStudentsBtn")?.addEventListener("click", loadStudents);
    qs("#mcSaveBtn")?.addEventListener("click", saveCertificates);
    qs("#mcLoadIssuedBtn")?.addEventListener("click", loadCertificates);
    qs("#mcPreviewBtn")?.addEventListener("click", previewSelected);
    qs("#mcPrintBtn")?.addEventListener("click", printPreview);
  }

  window.initMonthlyCertificatesScreen = async function () {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    setupEvents();
    resetStudents();
    renderCertificates();
    renderPreview([]);

    try {
     await loadMeta();
await loadCertificateMeta();
      const monthSelect = qs("#mcMonth");
      if (monthSelect && !monthSelect.value) {
        monthSelect.value = String(new Date().getMonth() + 1);
      }
      showAlert("اختر الفلاتر ثم حمّل الطلاب أو الشهادات المحفوظة.");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل بيانات الصفحة.", "error");
    }
  };

  if (document.readyState !== "loading") {
    if (root()) window.initMonthlyCertificatesScreen();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (root()) window.initMonthlyCertificatesScreen();
    });
  }
})();