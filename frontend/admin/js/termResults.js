(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

  const state = {
    meta: {},
    batch: null,
    summary: {
      students_count: 0,
      passed_count: 0,
      failed_count: 0,
      incomplete_count: 0,
    },
    students: [],
  };

  function root() {
    return document.getElementById("termResultsPage");
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

  function showAlert(message, type = "info") {
    const el = qs("#trAlert");
    if (!el) return;

    if (!message) {
      el.className = "tr-alert";
      el.textContent = "";
      return;
    }

    el.className = `tr-alert show ${type}`;
    el.textContent = message;
  }

  function setButtonLoading(button, loading, text = "جاري التنفيذ") {
    if (!button) return;

    if (loading) {
      button.dataset.oldText = button.innerHTML;
      button.disabled = true;
      button.innerHTML = text;
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
    const select = qs("#trAcademicYear");

    fillSelect(select, years, "اختر السنة الدراسية", (item) => {
      return item.name || item.title || `سنة ${item.id}`;
    });

    const active = years.find((item) => item.is_active) || years[0];
    if (active && select) select.value = String(active.id);
  }

  function fillStages() {
    const stages = getMetaArray(["stages"]);
    fillSelect(qs("#trStage"), stages, "اختر المرحلة", (item) => {
      return item.name || `مرحلة ${item.id}`;
    });
  }

  function fillGrades() {
    const stageId = selectedNumber("#trStage");
    const grades = getMetaArray(["grades"]).filter((item) => {
      if (!stageId) return true;
      return Number(item.stage_id) === stageId;
    });

    fillSelect(qs("#trGrade"), grades, "اختر الصف", (item) => {
      return item.grade_name || item.name || `صف ${item.id}`;
    });
  }

  function fillSections() {
    const gradeId = selectedNumber("#trGrade");
    const sections = getMetaArray(["sections"]).filter((item) => {
      if (!gradeId) return true;
      return Number(item.grade_id) === gradeId;
    });

    fillSelect(qs("#trSection"), sections, "اختر الشعبة", (item) => {
      return item.name || `شعبة ${item.id}`;
    });
  }

  function termLabel(term) {
    if (Number(term) === 1) return "الفصل الأول";
    if (Number(term) === 2) return "الفصل الثاني";
    return "—";
  }

  function statusLabel(status) {
    const map = {
      draft: "مسودة",
      calculated: "محسوبة",
      approved: "معتمدة",
      published: "منشورة",
      passed: "ناجح",
      failed: "راسب",
      incomplete: "ناقص",
      missing: "ناقص",
      absent: "غائب",
      excused: "معذور",
      not_approved: "غير معتمد",
    };

    return map[status] || status || "—";
  }

  function statusClass(status) {
    if (status === "passed") return "tr-badge-passed";
    if (status === "failed") return "tr-badge-failed";

    if (["incomplete", "missing", "excused", "not_approved"].includes(status)) {
      return "tr-badge-incomplete";
    }

    if (status === "approved") return "tr-badge-approved";
    if (status === "published") return "tr-badge-published";
    if (status === "calculated") return "tr-badge-calculated";

    return "tr-badge-draft";
  }

  function fmtNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(digits);
  }

  function gradeLabelFromPercentage(percentage) {
    const p = Number(percentage);

    if (!Number.isFinite(p)) return "—";
    if (p >= 90) return "ممتاز";
    if (p >= 80) return "جيد جدًا";
    if (p >= 70) return "جيد";
    if (p >= 60) return "مقبول";

    return "ضعيف";
  }

  function fmtDate(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";

    return d.toLocaleString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getFilters() {
    return {
      academic_year_id: selectedNumber("#trAcademicYear"),
      term: selectedNumber("#trTerm"),
      stage_id: selectedNumber("#trStage"),
      grade_id: selectedNumber("#trGrade"),
      section_id: selectedNumber("#trSection"),
    };
  }

  function validateFilters() {
    const filters = getFilters();

    if (!filters.academic_year_id) throw new Error("اختر السنة الدراسية.");
    if (!filters.term) throw new Error("اختر الفصل الدراسي.");
    if (!filters.stage_id) throw new Error("اختر المرحلة.");
    if (!filters.grade_id) throw new Error("اختر الصف.");
    if (!filters.section_id) throw new Error("اختر الشعبة.");

    return filters;
  }

  function buildQuery(filters) {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      params.set(key, String(value));
    });

    return params.toString();
  }

  function resetData() {
    state.batch = null;
    state.summary = {
      students_count: 0,
      passed_count: 0,
      failed_count: 0,
      incomplete_count: 0,
    };
    state.students = [];

    renderAll();
  }

  function updateActionButtons() {
    const status = state.batch?.status || null;

    const approveBtn = qs("#trApproveBtn");
    const publishBtn = qs("#trPublishBtn");
    const unpublishBtn = qs("#trUnpublishBtn");
    const printBtn = qs("#trPrintBtn");

    const hasStudents = state.students.length > 0;
    const hasIncomplete = state.students.some((s) => s.status === "incomplete");

    if (approveBtn) {
      approveBtn.disabled = !(status === "calculated" && hasStudents && !hasIncomplete);
    }

    if (publishBtn) {
      publishBtn.disabled = status !== "approved";
    }

    if (unpublishBtn) {
      unpublishBtn.disabled = status !== "published";
    }

    if (printBtn) {
      printBtn.disabled = !hasStudents;
    }
  }

  function renderStatus() {
    const statusEl = qs("#trBatchStatus");
    const datesEl = qs("#trBatchDates");
    const termEl = qs("#trTermLabel");

    const status = state.batch?.status || "none";

    if (statusEl) {
      statusEl.className = `tr-badge ${statusClass(status)}`;
      statusEl.textContent = state.batch ? statusLabel(status) : "لا توجد نتائج";
    }

    if (termEl) {
      termEl.textContent = termLabel(selectedNumber("#trTerm"));
    }

    if (datesEl) {
      if (!state.batch) {
        datesEl.textContent = "لم يتم احتساب نتائج لهذا النطاق بعد.";
      } else {
        const parts = [];

        if (state.batch.calculated_at) {
          parts.push(`احتساب: ${fmtDate(state.batch.calculated_at)}`);
        }

        if (state.batch.approved_at) {
          parts.push(`اعتماد: ${fmtDate(state.batch.approved_at)}`);
        }

        if (state.batch.published_at) {
          parts.push(`نشر: ${fmtDate(state.batch.published_at)}`);
        }

        datesEl.textContent = parts.length ? parts.join(" | ") : "—";
      }
    }
  }

  function renderSummary() {
    const s = state.summary || {};

    const countStudents = qs("#trCountStudents");
    const countPassed = qs("#trCountPassed");
    const countFailed = qs("#trCountFailed");
    const countIncomplete = qs("#trCountIncomplete");

    if (countStudents) countStudents.textContent = String(s.students_count || 0);
    if (countPassed) countPassed.textContent = String(s.passed_count || 0);
    if (countFailed) countFailed.textContent = String(s.failed_count || 0);
    if (countIncomplete) countIncomplete.textContent = String(s.incomplete_count || 0);
  }

  function renderStudents() {
    const body = qs("#trStudentsBody");
    const wrap = qs("#trTableWrap");
    const empty = qs("#trEmpty");
    const meta = qs("#trStudentsMeta");

    if (!body || !wrap || !empty) return;

    if (meta) {
      meta.textContent = state.students.length
        ? `${state.students.length} طالب في النتائج.`
        : "لا توجد نتائج معروضة.";
    }

    if (!state.students.length) {
      body.innerHTML = "";
      wrap.style.display = "none";
      empty.style.display = "";
      empty.textContent = "لا توجد نتائج. اضغط احتساب النتائج أولًا.";
      return;
    }

    empty.style.display = "none";
    wrap.style.display = "";

    body.innerHTML = state.students
      .map((student, index) => {
        const total =
          student.total_score == null || student.max_score == null
            ? "—"
            : `${fmtNumber(student.total_score)} / ${fmtNumber(student.max_score)}`;

        const percentage =
          student.percentage == null ? "—" : `${fmtNumber(student.percentage)}%`;

        const gradeLabel =
          student.grade_label || gradeLabelFromPercentage(student.percentage);

        return `
          <tr>
            <td class="tr-col-index" data-label="م">${index + 1}</td>

            <td class="tr-col-student" data-label="الطالب">
              <div class="tr-student-name">${escapeHtml(student.full_name || "—")}</div>
              <div class="tr-muted">
                ${escapeHtml(student.student_code || "—")}
                | ID: ${escapeHtml(student.student_id)}
              </div>

              <div class="tr-mobile-summary">
                <div class="tr-mobile-item">
                  <span class="tr-mobile-label">المجموع</span>
                  <span class="tr-mobile-value">${escapeHtml(total)}</span>
                </div>

                <div class="tr-mobile-item">
                  <span class="tr-mobile-label">النسبة</span>
                  <span class="tr-mobile-value">${escapeHtml(percentage)}</span>
                </div>

                <div class="tr-mobile-item">
                  <span class="tr-mobile-label">التقدير</span>
                  <span class="tr-mobile-value">${escapeHtml(gradeLabel)}</span>
                </div>

                <div class="tr-mobile-item">
                  <span class="tr-mobile-label">الترتيب</span>
                  <span class="tr-mobile-value">${student.rank_in_section || "—"}</span>
                </div>

                <div class="tr-mobile-item">
                  <span class="tr-mobile-label">ناقص / راسب</span>
                  <span class="tr-mobile-value">${student.missing_subjects || 0} / ${student.failed_subjects || 0}</span>
                </div>
              </div>
            </td>

            <td class="tr-col-code" data-label="الكود">${escapeHtml(student.student_code || "—")}</td>
            <td class="tr-col-total" data-label="المجموع">${escapeHtml(total)}</td>
            <td class="tr-col-percentage" data-label="النسبة">${escapeHtml(percentage)}</td>
            <td class="tr-col-grade" data-label="التقدير">${escapeHtml(gradeLabel)}</td>
            <td class="tr-col-rank" data-label="الترتيب">${student.rank_in_section || "—"}</td>
            <td class="tr-col-missing" data-label="المواد الناقصة">${student.missing_subjects || 0}</td>
            <td class="tr-col-failed" data-label="المواد الراسبة">${student.failed_subjects || 0}</td>

            <td class="tr-col-status" data-label="الحالة">
              <span class="tr-badge ${statusClass(student.status)}">
                ${escapeHtml(statusLabel(student.status))}
              </span>
            </td>

            <td class="tr-col-action" data-label="تفاصيل">
              <button type="button" class="tr-btn tr-btn-soft tr-detail-btn" data-index="${index}">
                عرض التفاصيل
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".tr-detail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.index);
        renderDetails(state.students[index]);
      });
    });
  }

  function renderDetails(student) {
    const box = qs("#trDetails");
    if (!box) return;

    if (!student) {
      box.innerHTML = `<div class="tr-empty">اختر طالبًا من الجدول لعرض تفاصيله.</div>`;
      return;
    }

    const subjects = Array.isArray(student.subjects) ? student.subjects : [];

    const total =
      student.total_score == null || student.max_score == null
        ? "—"
        : `${fmtNumber(student.total_score)} / ${fmtNumber(student.max_score)}`;

    const percentage =
      student.percentage == null ? "—" : `${fmtNumber(student.percentage)}%`;

    const gradeLabel =
      student.grade_label || gradeLabelFromPercentage(student.percentage);

    box.innerHTML = `
      <div class="tr-detail-title">${escapeHtml(student.full_name || "—")}</div>

      <div class="tr-detail-sub">
        ${escapeHtml(student.student_code || "—")}
        ${student.rank_in_section ? ` | الترتيب: ${escapeHtml(student.rank_in_section)}` : ""}
      </div>

      <div class="tr-subject-card">
        <div class="tr-subject-top">
          <div class="tr-subject-name">ملخص الطالب</div>
          <span class="tr-badge ${statusClass(student.status)}">
            ${escapeHtml(statusLabel(student.status))}
          </span>
        </div>

        <div class="tr-subject-grid">
          <div class="tr-mini">
            <div class="tr-mini-label">المجموع</div>
            <div class="tr-mini-value">${escapeHtml(total)}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">النسبة</div>
            <div class="tr-mini-value">${escapeHtml(percentage)}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">التقدير</div>
            <div class="tr-mini-value">${escapeHtml(gradeLabel)}</div>
          </div>
        </div>
      </div>

      ${
        subjects.length
          ? subjects.map(subjectHTML).join("")
          : `<div class="tr-empty">لا توجد تفاصيل مواد لهذا الطالب.</div>`
      }
    `;
  }

  function subjectHTML(subject) {
    const total =
      subject.total_score == null || subject.max_score == null
        ? "—"
        : `${fmtNumber(subject.total_score)} / ${fmtNumber(subject.max_score)}`;

    const percentage =
      subject.percentage == null ? "—" : `${fmtNumber(subject.percentage)}%`;

    const gradeLabel =
      subject.grade_label || gradeLabelFromPercentage(subject.percentage);

    return `
      <div class="tr-subject-card">
        <div class="tr-subject-top">
          <div class="tr-subject-name">${escapeHtml(subject.subject_name || "مادة")}</div>
          <span class="tr-badge ${statusClass(subject.status)}">
            ${escapeHtml(statusLabel(subject.status))}
          </span>
        </div>

        <div class="tr-subject-grid">
          <div class="tr-mini">
            <div class="tr-mini-label">المحصلة</div>
            <div class="tr-mini-value">${escapeHtml(fmtNumber(subject.aggregate_score))}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">الاختبار</div>
            <div class="tr-mini-value">${escapeHtml(fmtNumber(subject.exam_score))}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">المجموع</div>
            <div class="tr-mini-value">${escapeHtml(total)}</div>
          </div>
        </div>

        <div class="tr-subject-grid">
          <div class="tr-mini">
            <div class="tr-mini-label">النسبة</div>
            <div class="tr-mini-value">${escapeHtml(percentage)}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">التقدير</div>
            <div class="tr-mini-value">${escapeHtml(gradeLabel)}</div>
          </div>

          <div class="tr-mini">
            <div class="tr-mini-label">الحالة</div>
            <div class="tr-mini-value">${escapeHtml(statusLabel(subject.status))}</div>
          </div>
        </div>

        ${
          subject.missing_reason
            ? `<div class="tr-reason">${escapeHtml(subject.missing_reason)}</div>`
            : ""
        }
      </div>
    `;
  }

  function renderAll() {
    renderStatus();
    renderSummary();
    renderStudents();
    renderDetails(null);
    updateActionButtons();
  }

  function applyPayload(data) {
    state.batch = data?.batch || null;

    state.summary = data?.summary || {
      students_count: 0,
      passed_count: 0,
      failed_count: 0,
      incomplete_count: 0,
    };

    state.students = Array.isArray(data?.students) ? data.students : [];

    renderAll();
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

  async function loadResults() {
    const btn = qs("#trLoadBtn");

    try {
      const filters = validateFilters();
      setButtonLoading(btn, true, "جاري العرض...");

      const data = await apiGet(`/admin/term-results?${buildQuery(filters)}`);
      applyPayload(data);

      if (!state.batch) {
        showAlert("لا توجد نتائج محفوظة لهذا النطاق. اضغط احتساب النتائج.", "error");
      } else {
        showAlert("تم عرض النتائج المحفوظة.", "success");
      }
    } catch (err) {
      showAlert(err.message || "تعذر عرض النتائج.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateActionButtons();
    }
  }

  async function calculateResults() {
    const btn = qs("#trCalculateBtn");

    try {
      const filters = validateFilters();

      if (!confirm("سيتم احتساب نتائج نهاية الفصل من الدرجات المعتمدة. هل تريد المتابعة؟")) {
        return;
      }

      setButtonLoading(btn, true, "جاري الاحتساب...");

      const data = await apiPost("/admin/term-results/calculate", filters);
      applyPayload(data);

      showAlert(data?.message || "تم احتساب النتائج.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر احتساب النتائج.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateActionButtons();
    }
  }

  async function approveResults() {
    const btn = qs("#trApproveBtn");

    try {
      const filters = validateFilters();

      if (!confirm("سيتم اعتماد نتائج نهاية الفصل. بعد الاعتماد لا يمكن إعادة الاحتساب إلا بعد فك الاعتماد لاحقًا. هل تريد المتابعة؟")) {
        return;
      }

      setButtonLoading(btn, true, "جاري الاعتماد...");

      const data = await apiPost("/admin/term-results/approve", filters);
      applyPayload(data);

      showAlert(data?.message || "تم اعتماد النتائج.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر اعتماد النتائج.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateActionButtons();
    }
  }

  async function publishResults() {
    const btn = qs("#trPublishBtn");

    try {
      const filters = validateFilters();

      if (!confirm("سيتم نشر نتائج نهاية الفصل للطلاب وأولياء الأمور. هل تريد المتابعة؟")) {
        return;
      }

      setButtonLoading(btn, true, "جاري النشر...");

      const data = await apiPost("/admin/term-results/publish", filters);
      applyPayload(data);

      showAlert(data?.message || "تم نشر النتائج.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر نشر النتائج.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateActionButtons();
    }
  }

  async function unpublishResults() {
    const btn = qs("#trUnpublishBtn");

    try {
      const filters = validateFilters();

      if (!confirm("سيتم إلغاء نشر النتائج مع بقائها معتمدة. هل تريد المتابعة؟")) {
        return;
      }

      setButtonLoading(btn, true, "جاري إلغاء النشر...");

      const data = await apiPost("/admin/term-results/unpublish", filters);
      applyPayload(data);

      showAlert(data?.message || "تم إلغاء نشر النتائج.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر إلغاء النشر.", "error");
    } finally {
      setButtonLoading(btn, false);
      updateActionButtons();
    }
  }

  function printResults() {
    if (!state.students.length) {
      return showAlert("لا توجد نتائج للطباعة.", "error");
    }

    window.print();
  }

  function bindEvents() {
    qs("#trStage")?.addEventListener("change", () => {
      fillGrades();
      fillSections();
      resetData();
    });

    qs("#trGrade")?.addEventListener("change", () => {
      fillSections();
      resetData();
    });

    ["#trAcademicYear", "#trTerm", "#trSection"].forEach((selector) => {
      qs(selector)?.addEventListener("change", resetData);
    });

    qs("#trLoadBtn")?.addEventListener("click", loadResults);
    qs("#trCalculateBtn")?.addEventListener("click", calculateResults);
    qs("#trApproveBtn")?.addEventListener("click", approveResults);
    qs("#trPublishBtn")?.addEventListener("click", publishResults);
    qs("#trUnpublishBtn")?.addEventListener("click", unpublishResults);
    qs("#trPrintBtn")?.addEventListener("click", printResults);
  }

  window.initTermResultsScreen = async function () {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    bindEvents();
    renderAll();

    try {
      await loadMeta();
      showAlert("اختر الفلاتر ثم اضغط احتساب النتائج أو عرض النتائج المحفوظة.");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل بيانات الصفحة.", "error");
    }
  };

  if (document.readyState !== "loading") {
    if (root()) window.initTermResultsScreen();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (root()) window.initTermResultsScreen();
    });
  }
})();