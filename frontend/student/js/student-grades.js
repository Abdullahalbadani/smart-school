(() => {
  "use strict";

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const API_BASE = window.API_BASE || "/api";

  const state = {
    student: null,

    mode: "term_results",

    termResults: [],
    activeTermIndex: 0,

    assessmentItems: [],
    assessmentSummary: null,

    loaded: false,
  };

  const toast = (msg, type = "info") => {
    const fn = window.toast || window.Toast || window.showToast || null;
    if (typeof fn === "function") return fn(msg, type);
    if (type === "error") console.error(msg);
    else console.log(msg);
  };

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("token") ||
    "";

  async function apiGet(path) {
    const token = getToken();

    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.message || `فشل الطلب (${res.status})`);
    }

    return data;
  }

  const modal = () => qs("#modal-grades");
  const tableBody = () => qs("#stu-gr-table-body");
  const emptyState = () => qs("#stu-gr-empty");

  const typeSelect = () => qs("#stu-gr-filter-type");
  const termSelect = () => qs("#stu-gr-filter-subject");
  const searchInput = () => qs("#stu-gr-filter-search");
  const refreshBtn = () => qs("#stu-gr-refresh");

  const countTotal = () => qs("#stu-gr-count-total");
  const avgEl = () => qs("#stu-gr-average");
  const highestEl = () => qs("#stu-gr-highest");
  const lastPublishedEl = () => qs("#stu-gr-last-published");
  const listBadge = () => qs("#stu-gr-list-badge");

  const detailEmpty = () => qs("#stu-gr-detail-empty");
  const detailContent = () => qs("#stu-gr-detail-content");
  const detailBadge = () => qs("#stu-gr-detail-badge");
  const detailTitle = () => qs("#stu-gr-detail-title");
  const detailSubject = () => qs("#stu-gr-detail-subject");
  const detailTeacher = () => qs("#stu-gr-detail-teacher");
  const detailType = () => qs("#stu-gr-detail-type");
  const detailPublished = () => qs("#stu-gr-detail-published");
  const detailScore = () => qs("#stu-gr-detail-score");
  const detailMax = () => qs("#stu-gr-detail-max");
  const detailPercent = () => qs("#stu-gr-detail-percent");
  const detailWord = () => qs("#stu-gr-detail-grade-word");
  const detailFeedback = () => qs("#stu-gr-detail-feedback");
  const detailStatus = () => qs("#stu-gr-detail-status");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.classList.add("is-open");
    el.style.display = "flex";
    el.focus?.();
    document.body.classList.add("modal-open");
  }

  function closeModal(el) {
    if (!el) return;

    el.classList.remove("is-open");
    el.style.display = "none";
    document.body.classList.remove("modal-open");
  }

  function fmtNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(digits);
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

  function scoreWithMax(score, max) {
    if (score === null || score === undefined) return "—";
    if (max === null || max === undefined) return fmtNumber(score);
    return `${fmtNumber(score)} / ${fmtNumber(max)}`;
  }

  function statusLabel(status) {
    const map = {
      graded: "مرصودة",
      passed: "ناجح",
      failed: "راسب",
      incomplete: "ناقص",
      missing: "ناقص",
      absent: "غائب",
      excused: "معذور",
      not_approved: "غير معتمد",
      published: "منشورة",
      pending: "قيد الانتظار",
    };

    return map[status] || status || "—";
  }

  function statusBadgeClass(status) {
    if (["passed", "graded"].includes(status)) return "ss-badge ss-badge--success";
    if (["failed", "absent"].includes(status)) return "ss-badge ss-badge--danger";
    return "ss-badge ss-badge--soft";
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

  function getTermResultTitle(result) {
    if (!result) return "—";

    return [
      result.academic_year_name || "سنة دراسية",
      result.term_label || `الفصل ${result.term || ""}`,
      result.grade_name || "",
      result.section_name ? `شعبة ${result.section_name}` : "",
    ]
      .filter(Boolean)
      .join(" - ");
  }

  function activeTermResult() {
    return state.termResults[state.activeTermIndex] || null;
  }

  function configureExistingModal() {
    const title = qs("#stu-gr-title span") || qs("#stu-gr-title");
    if (title) title.textContent = "درجات الطالب";

    const subtitle = qs("#modal-grades .modal-subtitle");
    if (subtitle) {
      subtitle.textContent =
        "يعرض نتائج نهاية الفصل وكل الدرجات المنشورة من اختبارات وأنشطة وتكليفات.";
    }

    const typeLabel = typeSelect()?.closest(".field")?.querySelector(".field-label");
    if (typeLabel) typeLabel.textContent = "نوع الدرجات";

    const termLabel = termSelect()?.closest(".field")?.querySelector(".field-label");
    if (termLabel) termLabel.textContent = "النتيجة المنشورة";

    const searchField = searchInput()?.closest(".field");
    if (searchField) searchField.style.display = "none";

    const refreshText = refreshBtn()?.querySelector("span");
    if (refreshText) refreshText.textContent = "تحديث الدرجات";

    fillTypeSelect();

    const actions = qs("#stu-gr-filter-form .ss-actions");
    if (actions && !qs("#stu-gr-print")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.id = "stu-gr-print";
btn.innerHTML = `<i class="ri-printer-line"></i><span>طباعة كشف الدرجات</span>`;
      actions.appendChild(btn);
    }

    updateTermTableHeader();
    updateTermSummaryLabels();
  }

  function fillTypeSelect() {
    const select = typeSelect();
    if (!select) return;

    const current = select.value || state.mode || "term_results";

    const options = [
      ["term_results", "نتائج نهاية الفصل"],
      ["all", "كل الدرجات المنشورة"],
      ["monthly", "الاختبارات الشهرية"],
      ["exams", "الاختبارات"],
      ["activities", "الأنشطة والتكليفات"],
      ["term_work", "الأعمال الفصلية / المحصلة"],
    ];

    select.innerHTML = options
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");

    select.value = options.some(([value]) => value === current)
      ? current
      : "term_results";

    state.mode = select.value;
  }

  function showTermSelector(show) {
    const field = termSelect()?.closest(".field");
    if (field) field.style.display = show ? "" : "none";
  }

  function updateTermTableHeader() {
    const headRow = qs("#stu-gr-table thead tr");
    if (!headRow) return;

    headRow.innerHTML = `
      <th>المادة</th>
      <th>المحصلة</th>
      <th>الاختبار</th>
      <th>مجموع المادة</th>
      <th>التقدير</th>
      <th>الحالة</th>
      <th>إجراء</th>
    `;
  }

  function updateAssessmentTableHeader() {
    const headRow = qs("#stu-gr-table thead tr");
    if (!headRow) return;

    headRow.innerHTML = `
      <th>المادة</th>
      <th>التقييم</th>
      <th>النوع</th>
      <th>الدرجة</th>
      <th>النسبة</th>
      <th>التقدير</th>
      <th>الحالة</th>
      <th>إجراء</th>
    `;
  }

  function updateTermSummaryLabels() {
    const labels = qsa("#modal-grades .ss-summary-label");

    if (labels[0]) labels[0].textContent = "المجموع النهائي";
    if (labels[1]) labels[1].textContent = "النسبة";
    if (labels[2]) labels[2].textContent = "التقدير العام";
    if (labels[3]) labels[3].textContent = "الحالة / الترتيب";
  }

  function updateAssessmentSummaryLabels() {
    const labels = qsa("#modal-grades .ss-summary-label");

    if (labels[0]) labels[0].textContent = "عدد الدرجات";
    if (labels[1]) labels[1].textContent = "متوسط النسبة";
    if (labels[2]) labels[2].textContent = "التقدير التقريبي";
    if (labels[3]) labels[3].textContent = "مرصود / غياب";
  }

  function fillTermSelect() {
    const select = termSelect();
    if (!select) return;

    select.innerHTML = "";

    if (!state.termResults.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "لا توجد نتائج منشورة";
      select.appendChild(option);
      return;
    }

    state.termResults.forEach((result, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = getTermResultTitle(result);
      select.appendChild(option);
    });

    select.value = String(state.activeTermIndex);
  }

  function updateTermSummary(result) {
    if (!result) {
      countTotal() && (countTotal().textContent = "—");
      avgEl() && (avgEl().textContent = "—");
      highestEl() && (highestEl().textContent = "—");
      lastPublishedEl() && (lastPublishedEl().textContent = "—");
      listBadge() && (listBadge().textContent = "لا توجد نتيجة");
      return;
    }

    const total = scoreWithMax(result.total_score, result.max_score);

    const percentage =
      result.percentage === null || result.percentage === undefined
        ? "—"
        : `${fmtNumber(result.percentage)}%`;

    const gradeLabel =
      result.grade_label || gradeLabelFromPercentage(result.percentage);

    const statusText = result.student_status_label || statusLabel(result.student_status);
    const rank = result.rank_in_section || "—";

    countTotal() && (countTotal().textContent = total);
    avgEl() && (avgEl().textContent = percentage);
    highestEl() && (highestEl().textContent = gradeLabel);
    lastPublishedEl() && (lastPublishedEl().textContent = `${statusText} / ${rank}`);
    listBadge() && (listBadge().textContent = `${result.subjects?.length || 0} مادة`);
  }

  function updateAssessmentSummary(summary) {
    const s = summary || {};

    const avg =
      s.average_percentage === null || s.average_percentage === undefined
        ? "—"
        : `${fmtNumber(s.average_percentage)}%`;

    countTotal() && (countTotal().textContent = String(s.total_count || 0));
    avgEl() && (avgEl().textContent = avg);
    highestEl() &&
      (highestEl().textContent =
        s.average_grade_word || s.average_grade_label || "—");
    lastPublishedEl() &&
      (lastPublishedEl().textContent = `${s.graded_count || 0} / ${s.absent_count || 0}`);
    listBadge() && (listBadge().textContent = `${s.total_count || 0} درجة`);
  }

  function renderEmpty(message) {
    const tbody = tableBody();
    if (tbody) tbody.innerHTML = "";

    emptyState() && (emptyState().style.display = "");
    emptyState() &&
      (emptyState().textContent = message || "لا توجد درجات منشورة حاليًا.");

    resetDetail();
  }

  function resetDetail(result = null) {
    if (!result) {
      detailEmpty() && (detailEmpty().style.display = "");
      detailEmpty() &&
        (detailEmpty().textContent =
          "اختر عنصرًا من الجدول لعرض التفاصيل، أو حدّث الدرجات.");
      detailContent() && (detailContent().style.display = "none");
      detailBadge() && (detailBadge().textContent = "—");
      return;
    }

    const student = state.student || {};
    const total = scoreWithMax(result.total_score, result.max_score);

    const percentage =
      result.percentage === null || result.percentage === undefined
        ? "—"
        : `${fmtNumber(result.percentage)}%`;

    const gradeLabel =
      result.grade_label || gradeLabelFromPercentage(result.percentage);

    const statusText = result.student_status_label || statusLabel(result.student_status);
    const rank = result.rank_in_section || "—";

    detailEmpty() && (detailEmpty().style.display = "none");
    detailContent() && (detailContent().style.display = "");

    detailBadge() && (detailBadge().textContent = statusText);
    detailBadge() && (detailBadge().className = statusBadgeClass(result.student_status));

    detailTitle() && (detailTitle().textContent = student.full_name || "نتيجة الطالب");
    detailSubject() &&
      (detailSubject().textContent = `الطالب: ${student.student_code || "—"}`);
    detailTeacher() &&
      (detailTeacher().textContent = `الصف: ${result.grade_name || "—"} - شعبة ${result.section_name || "—"}`);
    detailType() &&
      (detailType().textContent = `الفصل: ${result.term_label || "—"}`);
    detailPublished() &&
      (detailPublished().textContent = `تاريخ النشر: ${fmtDate(result.published_at)}`);

    detailScore() &&
      (detailScore().textContent =
        result.total_score != null ? fmtNumber(result.total_score) : "—");
    detailMax() &&
      (detailMax().textContent =
        `/ ${result.max_score != null ? fmtNumber(result.max_score) : "—"}`);
    detailPercent() && (detailPercent().textContent = percentage);
    detailWord() && (detailWord().textContent = gradeLabel);

    detailFeedback() &&
      (detailFeedback().textContent =
        `المجموع النهائي: ${total}، النسبة: ${percentage}، التقدير: ${gradeLabel}.`);

    detailStatus() &&
      (detailStatus().textContent =
        `الحالة النهائية: ${statusText}. الترتيب في الشعبة: ${rank}. المواد الراسبة: ${result.failed_subjects || 0}. المواد الناقصة: ${result.missing_subjects || 0}.`);
  }

  function renderTermSubjectDetail(subject) {
    const result = activeTermResult();
    if (!subject || !result) return;

    const aggregate = scoreWithMax(subject.aggregate_score, subject.aggregate_max_score);
    const exam = scoreWithMax(subject.exam_score, subject.exam_max_score);
    const total = scoreWithMax(subject.total_score, subject.max_score);

    const percentage =
      subject.percentage === null || subject.percentage === undefined
        ? "—"
        : `${fmtNumber(subject.percentage)}%`;

    const gradeLabel =
      subject.grade_label || gradeLabelFromPercentage(subject.percentage);

    const statusText = subject.status_label || statusLabel(subject.status);

    detailEmpty() && (detailEmpty().style.display = "none");
    detailContent() && (detailContent().style.display = "");

    detailBadge() && (detailBadge().textContent = statusText);
    detailBadge() && (detailBadge().className = statusBadgeClass(subject.status));

    detailTitle() && (detailTitle().textContent = subject.subject_name || "مادة");
    detailSubject() && (detailSubject().textContent = `المحصلة: ${aggregate}`);
    detailTeacher() && (detailTeacher().textContent = `الاختبار: ${exam}`);
    detailType() && (detailType().textContent = `مجموع المادة: ${total}`);
    detailPublished() && (detailPublished().textContent = `الفصل: ${result.term_label || "—"}`);

    detailScore() &&
      (detailScore().textContent =
        subject.total_score != null ? fmtNumber(subject.total_score) : "—");
    detailMax() &&
      (detailMax().textContent =
        `/ ${subject.max_score != null ? fmtNumber(subject.max_score) : "—"}`);
    detailPercent() && (detailPercent().textContent = percentage);
    detailWord() && (detailWord().textContent = gradeLabel);

    detailFeedback() &&
      (detailFeedback().textContent =
        subject.missing_reason || "لا توجد ملاحظات على هذه المادة.");

    detailStatus() &&
      (detailStatus().textContent = `حالة المادة: ${statusText}.`);
  }

  function renderAssessmentDetail(item) {
    if (!item) return;

    const title =
      item.assessment_title ||
      item.title_short ||
      item.title ||
      item.kind_label ||
      "تقييم";

    const percentage =
      item.percentage === null || item.percentage === undefined
        ? "—"
        : `${fmtNumber(item.percentage)}%`;

    const gradeWord =
      item.grade_word ||
      item.grade_label ||
      gradeLabelFromPercentage(item.percentage);

    const statusText = item.status_label || statusLabel(item.status);

    const published =
      item.published_at ||
      item.grade_published_at ||
      item.assessment_published_at ||
      item.graded_at ||
      item.assessment_created_at;

    detailEmpty() && (detailEmpty().style.display = "none");
    detailContent() && (detailContent().style.display = "");

    detailBadge() && (detailBadge().textContent = statusText);
    detailBadge() && (detailBadge().className = statusBadgeClass(item.status));

    detailTitle() && (detailTitle().textContent = title);
    detailSubject() &&
      (detailSubject().textContent = `المادة: ${item.subject_name || "—"}`);
    detailTeacher() &&
      (detailTeacher().textContent = `المعلم: ${item.teacher_name || "—"}`);
    detailType() &&
      (detailType().textContent = `النوع: ${item.kind_label || item.type || "تقييم"}`);
    detailPublished() &&
      (detailPublished().textContent = `تاريخ النشر: ${fmtDate(published)}`);

    detailScore() &&
      (detailScore().textContent =
        item.score != null ? fmtNumber(item.score) : "—");
    detailMax() &&
      (detailMax().textContent =
        `/ ${item.max_score != null ? fmtNumber(item.max_score) : "—"}`);
    detailPercent() && (detailPercent().textContent = percentage);
    detailWord() && (detailWord().textContent = gradeWord);

    detailFeedback() &&
      (detailFeedback().textContent =
        item.feedback || "لا توجد ملاحظات من المعلم.");

    detailStatus() &&
      (detailStatus().textContent = `حالة الدرجة: ${statusText}.`);
  }

  function renderTermTable(result) {
    updateTermTableHeader();
    updateTermSummaryLabels();
    updateTermSummary(result);

    const tbody = tableBody();
    if (!tbody) return;

    tbody.innerHTML = "";

    const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

    if (!result || !subjects.length) {
      renderEmpty("لا توجد تفاصيل مواد لهذه النتيجة.");
      updateTermSummary(result);
      return;
    }

    emptyState() && (emptyState().style.display = "none");

    subjects.forEach((subject) => {
      const aggregate = scoreWithMax(subject.aggregate_score, subject.aggregate_max_score);
      const exam = scoreWithMax(subject.exam_score, subject.exam_max_score);
      const total = scoreWithMax(subject.total_score, subject.max_score);

      const gradeLabel =
        subject.grade_label || gradeLabelFromPercentage(subject.percentage);

      const statusText = subject.status_label || statusLabel(subject.status);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(subject.subject_name || "—")}</td>
        <td>${escapeHtml(aggregate)}</td>
        <td>${escapeHtml(exam)}</td>
        <td>${escapeHtml(total)}</td>
        <td>${escapeHtml(gradeLabel)}</td>
        <td>
          <span class="${statusBadgeClass(subject.status)}">
            ${escapeHtml(statusText)}
          </span>
        </td>
        <td></td>
      `;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.innerHTML = `<i class="ri-eye-line"></i><span>تفاصيل</span>`;
      btn.addEventListener("click", () => renderTermSubjectDetail(subject));

      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });

    resetDetail(result);
  }

  function renderAssessmentTable(items, summary) {
    updateAssessmentTableHeader();
    updateAssessmentSummaryLabels();
    updateAssessmentSummary(summary);

    const tbody = tableBody();
    if (!tbody) return;

    tbody.innerHTML = "";

    const rows = Array.isArray(items) ? items : [];

    if (!rows.length) {
      renderEmpty("لا توجد درجات منشورة من هذا النوع.");
      updateAssessmentSummary(summary);
      return;
    }

    emptyState() && (emptyState().style.display = "none");

    rows.forEach((item) => {
      const title =
        item.assessment_title ||
        item.title_short ||
        item.title ||
        item.kind_label ||
        "تقييم";

      const percentage =
        item.percentage === null || item.percentage === undefined
          ? "—"
          : `${fmtNumber(item.percentage)}%`;

      const gradeWord =
        item.grade_word ||
        item.grade_label ||
        gradeLabelFromPercentage(item.percentage);

      const statusText = item.status_label || statusLabel(item.status);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(item.subject_name || "—")}</td>
        <td>${escapeHtml(title)}</td>
        <td>${escapeHtml(item.kind_label || item.type || "تقييم")}</td>
        <td>${escapeHtml(scoreWithMax(item.score, item.max_score))}</td>
        <td>${escapeHtml(percentage)}</td>
        <td>${escapeHtml(gradeWord)}</td>
        <td>
          <span class="${statusBadgeClass(item.status)}">
            ${escapeHtml(statusText)}
          </span>
        </td>
        <td></td>
      `;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.innerHTML = `<i class="ri-eye-line"></i><span>تفاصيل</span>`;
      btn.addEventListener("click", () => renderAssessmentDetail(item));

      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });

    resetDetail();
  }

  function renderActiveTermResult() {
    const result = activeTermResult();

    if (!result) {
      renderEmpty("لا توجد نتائج نهاية فصل منشورة حاليًا.");
      updateTermSummary(null);
      return;
    }

    renderTermTable(result);
  }

  async function loadTermResults() {
    refreshBtn() && (refreshBtn().disabled = true);

    try {
      setLoading("جاري تحميل نتيجة نهاية الفصل...");

      const data = await apiGet("/student/term-results");

      state.loaded = true;
      state.student = data?.student || null;
      state.termResults = Array.isArray(data?.results) ? data.results : [];
      state.assessmentItems = [];
      state.activeTermIndex = 0;

      showTermSelector(true);
      fillTermSelect();
      renderActiveTermResult();
      updateCardHint();
    } catch (e) {
      state.loaded = true;
      showTermSelector(true);
      fillTermSelect();
      renderEmpty(e.message || "تعذر تحميل النتيجة.");
      toast(e.message || "تعذر تحميل النتيجة", "error");
    } finally {
      refreshBtn() && (refreshBtn().disabled = false);
    }
  }

  async function loadAssessmentGrades(type) {
    refreshBtn() && (refreshBtn().disabled = true);

    try {
      setLoading("جاري تحميل الدرجات المنشورة...");

      const data = await apiGet(`/student/learning/grades?type=${encodeURIComponent(type)}`);

      state.loaded = true;
      state.student = state.student || data?.student || null;
      state.assessmentItems = Array.isArray(data?.items) ? data.items : [];
      state.assessmentSummary = data?.summary || null;
      state.termResults = [];

      showTermSelector(false);
      renderAssessmentTable(state.assessmentItems, state.assessmentSummary);
      updateCardHintFromAssessments();
    } catch (e) {
      state.loaded = true;
      showTermSelector(false);
      renderEmpty(e.message || "تعذر تحميل الدرجات.");
      toast(e.message || "تعذر تحميل الدرجات", "error");
    } finally {
      refreshBtn() && (refreshBtn().disabled = false);
    }
  }

  function setLoading(message) {
    const tbody = tableBody();
    if (tbody) tbody.innerHTML = "";

    emptyState() && (emptyState().style.display = "");
    emptyState() && (emptyState().textContent = message || "جاري التحميل...");

    resetDetail();
  }

  async function loadCurrentMode() {
    const select = typeSelect();
    state.mode = select?.value || "term_results";

    if (state.mode === "term_results") {
      await loadTermResults();
    } else {
      await loadAssessmentGrades(state.mode);
    }
  }

  function updateCardHint() {
    const result = state.termResults[0];
    if (!result) return;

    const triggers = qsa('[data-open-modal="modal-grades"], [data-modal="modal-grades"]');

    const percentage =
      result.percentage === null || result.percentage === undefined
        ? "—"
        : `${fmtNumber(result.percentage)}%`;

    for (const card of triggers) {
      const small = card.querySelector("small");
      const metric = card.querySelector(".metric");

      if (small) {
        small.textContent = `${result.term_label || "نتيجة منشورة"} · ${result.student_status_label || statusLabel(result.student_status)}`;
      }

      if (metric) {
        metric.textContent = `المجموع: ${scoreWithMax(result.total_score, result.max_score)} · النسبة: ${percentage}`;
      }
    }
  }

  function updateCardHintFromAssessments() {
    const summary = state.assessmentSummary || {};
    const triggers = qsa('[data-open-modal="modal-grades"], [data-modal="modal-grades"]');

    const avg =
      summary.average_percentage === null || summary.average_percentage === undefined
        ? "—"
        : `${fmtNumber(summary.average_percentage)}%`;

    for (const card of triggers) {
      const small = card.querySelector("small");
      const metric = card.querySelector(".metric");

      if (small) {
        small.textContent = `درجات منشورة: ${summary.total_count || 0}`;
      }

      if (metric) {
        metric.textContent = `متوسط النسبة: ${avg}`;
      }
    }
  }
function resultSheetTitle(result) {
  const term = Number(result?.term);

  if (term === 1) return "كشف درجات نصف العام";
  if (term === 2) return "كشف درجات نهاية العام";

  return "كشف درجات الطالب";
}

function resultKindLabel(result) {
  const term = Number(result?.term);

  if (term === 1) return "نتائج نصف العام";
  if (term === 2) return "نتائج نهاية العام";

  return result?.term_label || "نتائج الطالب";
}

function sheetDate() {
  return new Date().toLocaleDateString("ar-YE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function buildStudentResultSheetHTML(result) {
  const student = state.student || {};
  const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

  const title = resultSheetTitle(result);
  const kind = resultKindLabel(result);

  const total = scoreWithMax(result?.total_score, result?.max_score);

  const percentage =
    result?.percentage === null || result?.percentage === undefined
      ? "—"
      : `${fmtNumber(result.percentage)}%`;

  const gradeLabel =
    result?.grade_label || gradeLabelFromPercentage(result?.percentage);

  const statusText =
    result?.student_status_label || statusLabel(result?.student_status);

  const rank = result?.rank_in_section || "—";

  const rowsHtml = subjects.length
    ? subjects
        .map((subject) => {
          const aggregate = scoreWithMax(
            subject.aggregate_score,
            subject.aggregate_max_score
          );

          const exam = scoreWithMax(
            subject.exam_score,
            subject.exam_max_score
          );

          const subjectTotal = scoreWithMax(
            subject.total_score,
            subject.max_score
          );

          const subjectPercentage =
            subject.percentage === null || subject.percentage === undefined
              ? "—"
              : `${fmtNumber(subject.percentage)}%`;

          const subjectGrade =
            subject.grade_label || gradeLabelFromPercentage(subject.percentage);

          const subjectStatus =
            subject.status_label || statusLabel(subject.status);

          return `
            <tr>
              <td class="subject-name">${escapeHtml(subject.subject_name || "—")}</td>
              <td>${escapeHtml(aggregate)}</td>
              <td>${escapeHtml(exam)}</td>
              <td>${escapeHtml(subjectTotal)}</td>
              <td>${escapeHtml(subjectPercentage)}</td>
              <td>${escapeHtml(subjectGrade)}</td>
              <td>${escapeHtml(subjectStatus)}</td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="7" class="empty-row">
          لا توجد تفاصيل مواد لهذه النتيجة.
        </td>
      </tr>
    `;

  return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(title)}</title>

      <style>
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          direction: rtl;
          font-family: Arial, Tahoma, sans-serif;
          background: #eef2f7;
          color: #111827;
        }

        .no-print {
          padding: 14px;
          text-align: center;
        }

        .print-btn {
          border: 0;
          border-radius: 999px;
          padding: 11px 26px;
          background: #2563eb;
          color: white;
          font-weight: 900;
          font-size: 14px;
          cursor: pointer;
        }

        .sheet {
          width: 190mm;
          min-height: 270mm;
          margin: 0 auto 20px;
          padding: 14mm;
          background: #ffffff;
          border-radius: 18px;
          border: 1px solid #dbe4f0;
          box-shadow: 0 18px 55px rgba(15, 23, 42, 0.13);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding-bottom: 14px;
          border-bottom: 2px solid #dbeafe;
          margin-bottom: 16px;
        }

        .school {
          font-size: 18px;
          font-weight: 950;
          color: #1e3a8a;
        }

        .subtitle {
          margin-top: 6px;
          color: #64748b;
          font-weight: 800;
          font-size: 12px;
        }

        .logo-box {
          width: 64px;
          height: 64px;
          border-radius: 18px;
          background: #eff6ff;
          border: 1px solid #dbeafe;
          display: grid;
          place-items: center;
          color: #2563eb;
          font-size: 28px;
          font-weight: 950;
        }

        .title {
          text-align: center;
          color: #2563eb;
          font-size: 28px;
          font-weight: 950;
          margin: 18px 0 18px;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 9px;
          margin-bottom: 14px;
        }

        .info {
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          border-radius: 12px;
          padding: 10px;
          min-height: 58px;
        }

        .info span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          margin-bottom: 5px;
        }

        .info strong {
          display: block;
          color: #111827;
          font-size: 13px;
          font-weight: 950;
          line-height: 1.5;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 9px;
          margin: 14px 0 16px;
        }

        .summary {
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          border-radius: 12px;
          padding: 10px;
          text-align: center;
        }

        .summary span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
          margin-bottom: 5px;
        }

        .summary strong {
          display: block;
          font-size: 14px;
          font-weight: 950;
          color: #111827;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        th,
        td {
          border: 1px solid #d1d5db;
          padding: 8px 7px;
          text-align: center;
          vertical-align: middle;
        }

        th {
          background: #eaf2ff;
          color: #1e3a8a;
          font-weight: 950;
        }

        td.subject-name {
          text-align: right;
          font-weight: 900;
        }

        .empty-row {
          padding: 18px;
          text-align: center;
          color: #64748b;
          font-weight: 800;
        }

        .footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 36px;
          margin-top: 26px;
          align-items: end;
        }

        .signature {
          text-align: center;
          font-weight: 950;
          color: #111827;
        }

        .signature span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 30px;
          padding-bottom: 8px;
          border-bottom: 1px solid #94a3b8;
        }

        @media print {
          body {
            background: #ffffff;
          }

          .no-print {
            display: none;
          }

          .sheet {
            width: auto;
            min-height: auto;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            box-shadow: none;
          }
        }
      </style>
    </head>

    <body>
      <div class="no-print">
        <button class="print-btn" onclick="window.print()">طباعة الكشف</button>
      </div>

      <main class="sheet">
        <header class="header">
          <div>
            <div class="school">إدارة المدرسة</div>
            <div class="subtitle">${escapeHtml(kind)}</div>
          </div>

          <div class="logo-box">⌁</div>
        </header>

        <h1 class="title">${escapeHtml(title)}</h1>

        <section class="info-grid">
          <div class="info">
            <span>اسم الطالب</span>
            <strong>${escapeHtml(student.full_name || "—")}</strong>
          </div>

          <div class="info">
            <span>رقم الطالب</span>
            <strong>${escapeHtml(student.student_code || "—")}</strong>
          </div>

          <div class="info">
            <span>السنة الدراسية</span>
            <strong>${escapeHtml(result?.academic_year_name || "—")}</strong>
          </div>

          <div class="info">
            <span>الفصل</span>
            <strong>${escapeHtml(result?.term_label || "—")}</strong>
          </div>

          <div class="info">
            <span>الصف</span>
            <strong>${escapeHtml(result?.grade_name || "—")}</strong>
          </div>

          <div class="info">
            <span>الشعبة</span>
            <strong>${escapeHtml(result?.section_name || "—")}</strong>
          </div>

          <div class="info">
            <span>نوع النتيجة</span>
            <strong>${escapeHtml(kind)}</strong>
          </div>

          <div class="info">
            <span>تاريخ الإصدار</span>
            <strong>${escapeHtml(sheetDate())}</strong>
          </div>
        </section>

        <section class="summary-grid">
          <div class="summary">
            <span>المجموع</span>
            <strong>${escapeHtml(total)}</strong>
          </div>

          <div class="summary">
            <span>النسبة</span>
            <strong>${escapeHtml(percentage)}</strong>
          </div>

          <div class="summary">
            <span>التقدير</span>
            <strong>${escapeHtml(gradeLabel)}</strong>
          </div>

          <div class="summary">
            <span>الترتيب</span>
            <strong>${escapeHtml(rank)}</strong>
          </div>

          <div class="summary">
            <span>الحالة</span>
            <strong>${escapeHtml(statusText)}</strong>
          </div>
        </section>

        <table>
          <thead>
            <tr>
              <th>المادة</th>
              <th>المحصلة</th>
              <th>الاختبار</th>
              <th>مجموع المادة</th>
              <th>النسبة</th>
              <th>التقدير</th>
              <th>الحالة</th>
            </tr>
          </thead>

          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <footer class="footer">
          <div class="signature">
            <span>تاريخ الإصدار</span>
            ${escapeHtml(sheetDate())}
          </div>

          <div class="signature">
            <span>مدير المدرسة</span>
            مدير المدرسة
          </div>
        </footer>
      </main>
    </body>
    </html>
  `;
}

function printTermResultSheet() {
  const result = activeTermResult();

  if (!result) {
    toast("لا توجد نتيجة منشورة للطباعة", "error");
    return;
  }

  const win = window.open("", "_blank", "width=950,height=720");

  if (!win) {
    toast("المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.", "error");
    return;
  }

  win.document.open();
  win.document.write(buildStudentResultSheetHTML(result));
  win.document.close();
  win.focus();

  setTimeout(() => {
    win.print();
  }, 500);
}
function printResult() {
  if (state.mode === "term_results") {
    printTermResultSheet();
    return;
  }

  const hasData = state.assessmentItems.length > 0;

  if (!hasData) {
    toast("لا توجد درجات للطباعة", "error");
    return;
  }

  window.print();
}
  function bindModal() {
    const m = modal();
    if (!m) return;

    qsa("[data-close-modal]", m).forEach((btn) => {
      btn.addEventListener("click", () => closeModal(m));
    });

    m.addEventListener("click", (e) => {
      if (e.target === m) closeModal(m);
    });

    m.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal(m);
    });
  }

  function bindActions() {
    refreshBtn()?.addEventListener("click", loadCurrentMode);

    typeSelect()?.addEventListener("change", async () => {
      await loadCurrentMode();
    });

    termSelect()?.addEventListener("change", (e) => {
      state.activeTermIndex = Number(e.target.value) || 0;
      renderActiveTermResult();
    });

    qs("#stu-gr-print")?.addEventListener("click", printResult);

    qsa('[data-open-modal="modal-grades"], [data-modal="modal-grades"]').forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();

        openModal("modal-grades");

        if (!state.loaded) {
          await loadCurrentMode();
        } else if (state.mode === "term_results") {
          renderActiveTermResult();
        } else {
          renderAssessmentTable(state.assessmentItems, state.assessmentSummary);
        }
      });
    });

    window.addEventListener("student:openGrades", async () => {
      openModal("modal-grades");

      if (!state.loaded) {
        await loadCurrentMode();
      } else if (state.mode === "term_results") {
        renderActiveTermResult();
      } else {
        renderAssessmentTable(state.assessmentItems, state.assessmentSummary);
      }
    });
  }

  function init() {
    if (window.__studentGradesInit) return;
    window.__studentGradesInit = true;

    if (!modal()) return;

    configureExistingModal();
    bindModal();
    bindActions();

    window.StudentGradesModal = {
      open: async () => {
        openModal("modal-grades");
        if (!state.loaded) await loadCurrentMode();
        else if (state.mode === "term_results") renderActiveTermResult();
        else renderAssessmentTable(state.assessmentItems, state.assessmentSummary);
      },
      reload: loadCurrentMode,
    };

    // تحميل خفيف لتحديث كرت الدرجات إذا كان الطالب مسجلًا.
    loadCurrentMode().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();