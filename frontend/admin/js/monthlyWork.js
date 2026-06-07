(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");
  const state = {
    meta: {},
    assessments: [],
    currentData: null,
  };

  function root() {
    return document.getElementById("monthlyWorkPage");
  }

  function qs(selector, base = root()) {
    return base ? base.querySelector(selector) : null;
  }

  function setText(selector, value) {
    const el = qs(selector);
    if (el) el.textContent = value ?? "";
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

  async function apiGet(path) {
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      Accept: "application/json",
    };

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { headers });
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
  
  async function apiPost(path, body = {}) {
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
  function showAlert(message, type = "info") {
    const el = qs("#mwAlert");
    if (!el) return;

    if (!message) {
      el.className = "mw-alert";
      el.textContent = "";
      return;
    }

    el.className = `mw-alert show ${type}`;
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

  function selectedNumber(selector) {
    const value = qs(selector)?.value;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(value) {
    if (!value) return "—";

    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);

    return date.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function formatTime(value) {
    if (!value) return "—";
    return String(value).slice(0, 5);
  }

  function formatScore(score, maxScore) {
    if (score === null || score === undefined || score === "") return "—";
    return `${Number(score).toString()} / ${Number(maxScore || 0).toString()}`;
  }

  function termLabel(term) {
    if (Number(term) === 1) return "الفصل الأول";
    if (Number(term) === 2) return "الفصل الثاني";
    return "—";
  }
  function approvalLabel(status) {
    if (status === "approved") return "معتمد";
    if (status === "returned") return "مرجع للمعلم";
    return "غير معتمد";
  }

  function updateActionButtons(data) {
    const printBtn = qs("#mwPrintBtn");
    const approveBtn = qs("#mwApproveBtn");
    const returnBtn = qs("#mwReturnBtn");

    const hasData = !!data;
    const isApproved = data?.approval?.status === "approved";
    const canApprove = !!data?.summary?.can_approve && !isApproved;

    if (printBtn) printBtn.disabled = !hasData;

    if (approveBtn) {
      approveBtn.disabled = !canApprove;
      approveBtn.innerHTML = isApproved
        ? `<i class="ri-lock-line"></i> تم الاعتماد`
        : `<i class="ri-checkbox-circle-line"></i> اعتماد الكشف الشهري`;
    }

    if (returnBtn) {
      returnBtn.disabled = !hasData || isApproved;
      returnBtn.innerHTML = isApproved
        ? `<i class="ri-lock-line"></i> تم الاعتماد`
        : `<i class="ri-arrow-go-back-line"></i> إرجاع للمعلم`;
    }
  }
  function statusBadge(status, label) {
    const map = {
      recorded: "mw-badge-recorded",
      excused: "mw-badge-excused",
      absent: "mw-badge-absent",
      missing: "mw-badge-missing",
    };

    return `<span class="mw-badge ${map[status] || "mw-badge-neutral"}">${escapeHtml(label || "—")}</span>`;
  }

  function publishBadge(row) {
    if (row.is_published === true) {
      return `<span class="mw-badge mw-badge-published">منشور</span>`;
    }

    if (row.is_published === false) {
      return `<span class="mw-badge mw-badge-unpublished">غير منشور</span>`;
    }

    return `<span class="mw-badge mw-badge-neutral">لا يحتاج نشر</span>`;
  }

  function resetSummary() {
    setText("#mwTotalStudents", "0");
    setText("#mwRecorded", "0");
    setText("#mwExcused", "0");
    setText("#mwAbsent", "0");
    setText("#mwMissing", "0");
    setText("#mwUnpublished", "0");
  }

  function renderEmpty(message) {
    const empty = qs("#mwEmpty");
    const table = qs("#mwTableCard");
    const info = qs("#mwExamInfo");
    const printBtn = qs("#mwPrintBtn");

    if (empty) {
      empty.style.display = "";
      empty.textContent = message || "لا توجد بيانات.";
    }

    if (table) table.classList.remove("show");
    if (info) info.classList.remove("show");
    if (printBtn) printBtn.disabled = true;
    updateActionButtons(null);
    state.currentData = null;
    resetSummary();
  }

  function clearAssessmentSelect() {
    const select = qs("#mwAssessment");
    if (!select) return;

    select.innerHTML = `<option value="">اختر الاختبار الشهري</option>`;
    state.assessments = [];
    renderEmpty("اختر الفلاتر ثم اضغط تحميل الاختبارات الشهرية.");
  }

  function fillAcademicYears() {
    const years = getMetaArray(["academicYears", "academic_years", "years"]);
    const select = qs("#mwAcademicYear");

    fillSelect(select, years, "اختر السنة الدراسية", (item) => item.name || item.title || `سنة ${item.id}`);

    const active = years.find((item) => item.is_active) || years[0];
    if (active && select) select.value = String(active.id);
  }

  function fillStages() {
    const stages = getMetaArray(["stages"]);
    fillSelect(qs("#mwStage"), stages, "اختر المرحلة", (item) => item.name || `مرحلة ${item.id}`);
  }

  function fillGrades() {
    const stageId = selectedNumber("#mwStage");
    const grades = getMetaArray(["grades"]).filter((item) => {
      if (!stageId) return true;
      return Number(item.stage_id) === stageId;
    });

    fillSelect(qs("#mwGrade"), grades, "اختر الصف", (item) => item.grade_name || item.name || `صف ${item.id}`);
  }

  function fillSections() {
    const gradeId = selectedNumber("#mwGrade");
    const sections = getMetaArray(["sections"]).filter((item) => {
      if (!gradeId) return true;
      return Number(item.grade_id) === gradeId;
    });

    fillSelect(qs("#mwSection"), sections, "اختر الشعبة", (item) => item.name || `شعبة ${item.id}`);
  }

  function fillSubjects() {
    const stageId = selectedNumber("#mwStage");
    const gradeId = selectedNumber("#mwGrade");
    const subjects = getMetaArray(["subjects"]).filter((item) => {
      const hasGrade = item.grade_id !== undefined && item.grade_id !== null;
      const hasStage = item.stage_id !== undefined && item.stage_id !== null;

      if (hasGrade && gradeId) return Number(item.grade_id) === gradeId;
      if (hasStage && stageId) return Number(item.stage_id) === stageId;

      return true;
    });

    fillSelect(qs("#mwSubject"), subjects, "اختر المادة", (item) => item.name || `مادة ${item.id}`);
  }

  function getFilters() {
    return {
      academic_year_id: selectedNumber("#mwAcademicYear"),
      term: selectedNumber("#mwTerm"),
      stage_id: selectedNumber("#mwStage"),
      grade_id: selectedNumber("#mwGrade"),
      section_id: selectedNumber("#mwSection"),
      subject_id: selectedNumber("#mwSubject"),
      assessment_id: selectedNumber("#mwAssessment"),
    };
  }

  function validateFilters(includeAssessment = false) {
    const filters = getFilters();

    if (!filters.academic_year_id) throw new Error("اختر السنة الدراسية.");
    if (!filters.term) throw new Error("اختر الفصل الدراسي.");
    if (!filters.stage_id) throw new Error("اختر المرحلة.");
    if (!filters.grade_id) throw new Error("اختر الصف.");
    if (!filters.section_id) throw new Error("اختر الشعبة.");
    if (!filters.subject_id) throw new Error("اختر المادة.");
    if (includeAssessment && !filters.assessment_id) throw new Error("اختر الاختبار الشهري.");

    return filters;
  }

  function renderAssessmentOptions(items) {
    const select = qs("#mwAssessment");
    if (!select) return;

    select.innerHTML = `<option value="">اختر الاختبار الشهري</option>`;

    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.id;

      const date = item.starts_at ? formatDateTime(item.starts_at) : "بدون وقت";
      const teacher = item.teacher_name ? ` - ${item.teacher_name}` : "";
      const score = item.max_score ? ` - ${Number(item.max_score).toString()} درجة` : "";

      option.textContent = `${item.title || "اختبار شهري"}${score} - ${date}${teacher}`;
      select.appendChild(option);
    }

    if (items.length === 1) {
      select.value = String(items[0].id);
    }
  }

  async function loadMeta() {
    showAlert("جاري تحميل بيانات الفلاتر...");
    const payload = await apiGet("/timetables/meta");
    state.meta = payload?.data || payload || {};

    fillAcademicYears();
    fillStages();
    fillGrades();
    fillSections();
    fillSubjects();
    clearAssessmentSelect();

    showAlert("");
  }

  async function loadAssessments() {
    const button = qs("#mwLoadAssessmentsBtn");

    try {
      const filters = validateFilters(false);
      setButtonLoading(button, true, "جاري تحميل الاختبارات");
      showAlert("");

      const params = new URLSearchParams();
      params.set("academic_year_id", filters.academic_year_id);
      params.set("term", filters.term);
      params.set("stage_id", filters.stage_id);
      params.set("grade_id", filters.grade_id);
      params.set("section_id", filters.section_id);
      params.set("subject_id", filters.subject_id);

      const data = await apiGet(`/admin/control/monthly-works/assessments?${params.toString()}`);
      state.assessments = Array.isArray(data?.items) ? data.items : [];

      renderAssessmentOptions(state.assessments);

      if (!state.assessments.length) {
        renderEmpty("لا توجد اختبارات شهرية لهذه المادة والشعبة.");
        showAlert("لا توجد اختبارات شهرية حسب الفلاتر المختارة.", "error");
        window.AppUI?.toast("لا توجد اختبارات شهرية حسب الفلاتر المختارة.", "warning");
        return;
      }

      renderEmpty("اختر الاختبار الشهري ثم اضغط عرض الكشف.");
      showAlert(`تم العثور على ${state.assessments.length} اختبار شهري.`, "success");
      window.AppUI?.toast(`تم العثور على ${state.assessments.length} اختبار شهري.`, "success");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل الاختبارات الشهرية.", "error");
      window.AppUI?.toast(err.message || "تعذر تحميل الاختبارات الشهرية.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  function renderInfo(data) {
    const info = qs("#mwExamInfo");
    if (!info) return;

    const assessment = data.assessment || {};
    const session = data.exam_session || null;
    const summary = data.summary || {};
    const approval = data.approval || {};
    info.innerHTML = `
      <div class="mw-info-grid">
        <div class="mw-info-item">
          <span>الاختبار</span>
          <strong>${escapeHtml(assessment.title || "—")}</strong>
        </div>

        <div class="mw-info-item">
          <span>المادة</span>
          <strong>${escapeHtml(assessment.subject_name || "—")}</strong>
        </div>

        <div class="mw-info-item">
          <span>الصف / الشعبة</span>
          <strong>${escapeHtml(`${assessment.grade_name || "—"} / ${assessment.section_name || "—"}`)}</strong>
        </div>

        <div class="mw-info-item">
          <span>الفصل</span>
          <strong>${escapeHtml(termLabel(assessment.term))}</strong>
        </div>

        <div class="mw-info-item">
          <span>درجة الاختبار</span>
          <strong>${escapeHtml(Number(assessment.max_score || 0).toString())}</strong>
        </div>

        <div class="mw-info-item">
          <span>وقت الاختبار</span>
          <strong>${escapeHtml(formatDateTime(assessment.starts_at))}</strong>
        </div>

        <div class="mw-info-item">
          <span>حصة الاختبار</span>
          <strong>${escapeHtml(session ? `${formatDate(session.exam_date)} - ${session.period_name || "حصة"} ${formatTime(session.start_time)}-${formatTime(session.end_time)}` : "غير مرتبطة بتحضير")}</strong>
        </div>

              <div class="mw-info-item">
          <span>جاهزية الاعتماد</span>
          <strong>${summary.can_approve ? "جاهز" : "غير جاهز"}</strong>
        </div>

        <div class="mw-info-item">
          <span>حالة الكنترول</span>
          <strong>${escapeHtml(approvalLabel(approval.status))}</strong>
        </div>

        <div class="mw-info-item">
          <span>ملاحظة الإرجاع</span>
          <strong>${escapeHtml(approval.return_note || "—")}</strong>
        </div>
      </div>
    `;

    info.classList.add("show");
  }

  function renderSummary(summary) {
    setText("#mwTotalStudents", summary?.total_students || 0);
    setText("#mwRecorded", summary?.recorded || 0);
    setText("#mwExcused", summary?.excused || 0);
    setText("#mwAbsent", summary?.absent || 0);
    setText("#mwMissing", summary?.missing || 0);
    setText("#mwUnpublished", summary?.unpublished || 0);
  }

  function renderRows(data) {
    const tbody = qs("#mwTableBody");
    const table = qs("#mwTableCard");
    const empty = qs("#mwEmpty");
    const students = Array.isArray(data.students) ? data.students : [];
    const maxScore = data.assessment?.max_score || 0;

    if (!tbody || !table) return;

    tbody.innerHTML = students
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.no)}</td>
            <td>
              <div class="mw-student-name">${escapeHtml(row.student_name || "—")}</div>
              <div class="mw-muted">ID: ${escapeHtml(row.student_id)}</div>
            </td>
            <td>${escapeHtml(row.student_code || "—")}</td>
            <td>${escapeHtml(row.roll_number || "—")}</td>
<td class="mw-score" dir="ltr">${escapeHtml(formatScore(row.score, maxScore))}</td>
            <td>${escapeHtml(row.attendance_status || "—")}</td>
            <td>${escapeHtml(row.excuse_reason || "—")}</td>
            <td>${statusBadge(row.status, row.status_label)}</td>
            <td>${publishBadge(row)}</td>
            <td>${escapeHtml(row.note || "—")}</td>
          </tr>
        `;
      })
      .join("");

    table.classList.add("show");
    if (empty) empty.style.display = "none";
  }

  function renderData(data) {
    state.currentData = data;

    renderSummary(data.summary || {});
    renderInfo(data);
    renderRows(data);

    updateActionButtons(data);
    const summary = data.summary || {};
    const approval = data.approval || {};

    if (approval.status === "approved") {
      showAlert("تم اعتماد الكشف الشهري من الكنترول.", "success");
    } else if (approval.status === "returned") {
      showAlert(`الكشف الشهري مرجع للمعلم. السبب: ${approval.return_note || "لم يتم كتابة سبب."}`, "error");
    } else if (summary.can_approve) {
      showAlert("الكشف الشهري جاهز للمراجعة والاعتماد.", "success");
    } else if (summary.missing > 0) {
      showAlert("يوجد طلاب ناقصون: لا توجد درجة ولا غياب ولا عذر معتمد.", "error");
    } else if (summary.unpublished > 0) {
      showAlert("يوجد درجات مرصودة لكنها غير منشورة من المعلم.", "error");
    } else {
      showAlert("");
    }
  }

  async function loadMonthlyWorks() {
    const button = qs("#mwShowBtn");

    try {
      const filters = validateFilters(true);
      setButtonLoading(button, true, "جاري عرض الكشف");
      showAlert("");

      const data = await apiGet(`/admin/control/monthly-works?assessment_id=${encodeURIComponent(filters.assessment_id)}`);
      renderData(data);
    } catch (err) {
      showAlert(err.message || "تعذر عرض كشف الأعمال الشهرية.", "error");
      window.AppUI?.toast(err.message || "تعذر عرض كشف الأعمال الشهرية.", "error");
    } finally {
      setButtonLoading(button, false);
    }
  }
  async function approveMonthlyWorks() {
    const button = qs("#mwApproveBtn");

    try {
      const filters = validateFilters(true);

      if (!state.currentData?.summary?.can_approve) {
        window.AppUI?.toast("لا يمكن الاعتماد قبل اكتمال الكشف ونشر الدرجات.", "warning");
        return showAlert("لا يمكن الاعتماد قبل اكتمال الكشف ونشر الدرجات.", "error");
      }

      setButtonLoading(button, true, "جاري الاعتماد");

      const result = await apiPost("/admin/control/monthly-works/approve", {
        assessment_id: filters.assessment_id,
      });

      showAlert(result?.message || "تم اعتماد الكشف الشهري.", "success");
      window.AppUI?.toast(result?.message || "تم اعتماد الكشف الشهري.", "success");
      await loadMonthlyWorks();
    } catch (err) {
      showAlert(err.message || "تعذر اعتماد الكشف الشهري.", "error");
      window.AppUI?.toast(err.message || "تعذر اعتماد الكشف الشهري.", "error");
    } finally {
      setButtonLoading(button, false);
      updateActionButtons(state.currentData);
    }
  }

  async function returnMonthlyWorks() {
    const button = qs("#mwReturnBtn");

    try {
      const filters = validateFilters(true);

      if (state.currentData?.approval?.status === "approved") {
        window.AppUI?.toast("لا يمكن إرجاع كشف شهري معتمد.", "warning");
        return showAlert("لا يمكن إرجاع كشف شهري معتمد.", "error");
      }

      const note = await window.AppUI.prompt({
        title: "إرجاع الكشف الشهري",
        message: "اكتب سبب إرجاع الكشف الشهري للمعلم.",
        defaultValue: "",
        confirmText: "إرجاع الكشف",
        cancelText: "إلغاء",
        required: true,
        requiredMessage: "سبب الإرجاع مطلوب.",
      });

      if (note === null) return;

      const returnNote = String(note || "").trim();

      if (!returnNote) {
        window.AppUI?.toast("سبب الإرجاع مطلوب.", "warning");
        return showAlert("سبب الإرجاع مطلوب.", "error");
      }

      setButtonLoading(button, true, "جاري الإرجاع");

      const result = await apiPost("/admin/control/monthly-works/return", {
        assessment_id: filters.assessment_id,
        return_note: returnNote,
      });

      showAlert(result?.message || "تم إرجاع الكشف الشهري للمعلم.", "success");
      window.AppUI?.toast(result?.message || "تم إرجاع الكشف الشهري للمعلم.", "success");
      await loadMonthlyWorks();
    } catch (err) {
      showAlert(err.message || "تعذر إرجاع الكشف الشهري.", "error");
      window.AppUI?.toast(err.message || "تعذر إرجاع الكشف الشهري.", "error");
    } finally {
      setButtonLoading(button, false);
      updateActionButtons(state.currentData);
    }
  }
  function setupEvents() {
    qs("#mwStage")?.addEventListener("change", () => {
      fillGrades();
      fillSections();
      fillSubjects();
      clearAssessmentSelect();
    });

    qs("#mwGrade")?.addEventListener("change", () => {
      fillSections();
      fillSubjects();
      clearAssessmentSelect();
    });

    qs("#mwAcademicYear")?.addEventListener("change", clearAssessmentSelect);
    qs("#mwTerm")?.addEventListener("change", clearAssessmentSelect);
    qs("#mwSection")?.addEventListener("change", clearAssessmentSelect);
    qs("#mwSubject")?.addEventListener("change", clearAssessmentSelect);

    qs("#mwLoadAssessmentsBtn")?.addEventListener("click", loadAssessments);
    qs("#mwShowBtn")?.addEventListener("click", loadMonthlyWorks);

    qs("#mwPrintBtn")?.addEventListener("click", () => {
      window.print();

    });
    qs("#mwApproveBtn")?.addEventListener("click", approveMonthlyWorks);
    qs("#mwReturnBtn")?.addEventListener("click", returnMonthlyWorks);
  }

  window.initMonthlyWorkScreen = async function () {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    setupEvents();
    resetSummary();
    renderEmpty("جاري تحميل الفلاتر...");

    try {
      await loadMeta();
      renderEmpty("اختر الفلاتر ثم اضغط تحميل الاختبارات الشهرية.");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل بيانات الصفحة.", "error");
      window.AppUI?.toast(err.message || "تعذر تحميل بيانات الصفحة.", "error");
      renderEmpty("تعذر تحميل بيانات الصفحة.");
    }
  };

  if (document.readyState !== "loading") {
    if (root()) window.initMonthlyWorkScreen();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (root()) window.initMonthlyWorkScreen();
    });
  }
})();