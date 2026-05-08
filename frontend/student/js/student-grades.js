(() => {
  "use strict";

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const API_BASE = window.API_BASE || "/api";

  const state = {
    student: null,
    results: [],
    activeIndex: 0,
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

  const resultSelect = () => qs("#stu-gr-filter-type");
  const subjectFilter = () => qs("#stu-gr-filter-subject");
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
      passed: "ناجح",
      failed: "راسب",
      incomplete: "ناقص",
      missing: "ناقص",
      absent: "غائب",
      excused: "معذور",
      not_approved: "غير معتمد",
      published: "منشورة",
    };

    return map[status] || status || "—";
  }

  function statusBadgeClass(status) {
    if (status === "passed") return "ss-badge ss-badge--success";
    if (status === "failed") return "ss-badge ss-badge--danger";
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

  function getResultTitle(result) {
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

  function activeResult() {
    return state.results[state.activeIndex] || null;
  }

  function configureExistingModal() {
    const title = qs("#stu-gr-title span") || qs("#stu-gr-title");
    if (title) title.textContent = "نتائج نهاية الفصل";

    const subtitle = qs("#modal-grades .modal-subtitle");
    if (subtitle) {
      subtitle.textContent =
        "النتائج المنشورة من الإدارة: درجات المواد، المحصلة، الاختبار، المجموع، التقدير والحالة.";
    }

    const typeLabel = resultSelect()?.closest(".field")?.querySelector(".field-label");
    if (typeLabel) typeLabel.textContent = "النتيجة المنشورة";

    const subjectField = subjectFilter()?.closest(".field");
    if (subjectField) subjectField.style.display = "none";

    const searchField = searchInput()?.closest(".field");
    if (searchField) searchField.style.display = "none";

    const refreshText = refreshBtn()?.querySelector("span");
    if (refreshText) refreshText.textContent = "تحديث النتيجة";

    const form = qs("#stu-gr-filter-form");
    if (form) {
      form.style.gridTemplateColumns = "minmax(220px, 1fr) auto";
    }

    const actions = qs("#stu-gr-filter-form .ss-actions");
    if (actions && !qs("#stu-gr-print")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.id = "stu-gr-print";
      btn.innerHTML = `<i class="ri-printer-line"></i><span>طباعة النتيجة</span>`;
      actions.appendChild(btn);
    }

    updateTableHeader();
    updateSummaryLabels();
  }

  function updateTableHeader() {
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

  function updateSummaryLabels() {
    const labels = qsa("#modal-grades .ss-summary-label");

    if (labels[0]) labels[0].textContent = "المجموع النهائي";
    if (labels[1]) labels[1].textContent = "النسبة";
    if (labels[2]) labels[2].textContent = "التقدير العام";
    if (labels[3]) labels[3].textContent = "الحالة / الترتيب";
  }

  function fillResultSelect() {
    const select = resultSelect();
    if (!select) return;

    select.innerHTML = "";

    if (!state.results.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "لا توجد نتائج منشورة";
      select.appendChild(option);
      return;
    }

    state.results.forEach((result, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = getResultTitle(result);
      select.appendChild(option);
    });

    select.value = String(state.activeIndex);
  }

  function updateSummary(result) {
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

  function renderEmpty(message) {
    const tbody = tableBody();
    if (tbody) tbody.innerHTML = "";

    emptyState() && (emptyState().style.display = "");
    emptyState() && (emptyState().textContent = message || "لا توجد نتائج منشورة حاليًا.");

    updateSummary(null);
    resetDetail();
  }

  function resetDetail(result = null) {
    if (!result) {
      detailEmpty() && (detailEmpty().style.display = "");
      detailEmpty() &&
        (detailEmpty().textContent =
          "اختر مادة من الجدول لعرض تفاصيلها، أو حدّث النتيجة.");
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

    detailScore() && (detailScore().textContent = result.total_score != null ? fmtNumber(result.total_score) : "—");
    detailMax() && (detailMax().textContent = `/ ${result.max_score != null ? fmtNumber(result.max_score) : "—"}`);
    detailPercent() && (detailPercent().textContent = percentage);
    detailWord() && (detailWord().textContent = gradeLabel);

    detailFeedback() &&
      (detailFeedback().textContent =
        `المجموع النهائي: ${total}، النسبة: ${percentage}، التقدير: ${gradeLabel}.`);

    detailStatus() &&
      (detailStatus().textContent =
        `الحالة النهائية: ${statusText}. الترتيب في الشعبة: ${rank}. المواد الراسبة: ${result.failed_subjects || 0}. المواد الناقصة: ${result.missing_subjects || 0}.`);
  }

  function renderSubjectDetail(subject) {
    const result = activeResult();
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

    detailScore() && (detailScore().textContent = subject.total_score != null ? fmtNumber(subject.total_score) : "—");
    detailMax() && (detailMax().textContent = `/ ${subject.max_score != null ? fmtNumber(subject.max_score) : "—"}`);
    detailPercent() && (detailPercent().textContent = percentage);
    detailWord() && (detailWord().textContent = gradeLabel);

    detailFeedback() &&
      (detailFeedback().textContent =
        subject.missing_reason || "لا توجد ملاحظات على هذه المادة.");

    detailStatus() &&
      (detailStatus().textContent = `حالة المادة: ${statusText}.`);
  }

  function renderTable(result) {
    const tbody = tableBody();
    if (!tbody) return;

    tbody.innerHTML = "";

    const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

    updateSummary(result);

    if (!result || !subjects.length) {
      renderEmpty("لا توجد تفاصيل مواد لهذه النتيجة.");
      return;
    }

    emptyState() && (emptyState().style.display = "none");

    subjects.forEach((subject, index) => {
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
      btn.addEventListener("click", () => renderSubjectDetail(subject));

      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    });

    resetDetail(result);
  }

  function renderActiveResult() {
    const result = activeResult();

    if (!result) {
      renderEmpty("لا توجد نتائج منشورة حاليًا.");
      return;
    }

    renderTable(result);
  }

  async function loadTermResults() {
    try {
      refreshBtn() && (refreshBtn().disabled = true);

      if (emptyState()) {
        emptyState().style.display = "";
        emptyState().textContent = "جاري تحميل النتيجة...";
      }

      const data = await apiGet("/student/term-results");

      state.loaded = true;
      state.student = data?.student || null;
      state.results = Array.isArray(data?.results) ? data.results : [];
      state.activeIndex = 0;

      fillResultSelect();
      renderActiveResult();
      updateCardHint();
    } catch (e) {
      state.loaded = true;
      renderEmpty(e.message || "تعذر تحميل النتيجة.");
      toast(e.message || "تعذر تحميل النتيجة", "error");
    } finally {
      refreshBtn() && (refreshBtn().disabled = false);
    }
  }

  function updateCardHint() {
    const result = state.results[0];
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

  function printResult() {
    const result = activeResult();

    if (!result) {
      toast("لا توجد نتيجة للطباعة", "error");
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
    refreshBtn()?.addEventListener("click", loadTermResults);

    resultSelect()?.addEventListener("change", (e) => {
      state.activeIndex = Number(e.target.value) || 0;
      renderActiveResult();
    });

    qs("#stu-gr-print")?.addEventListener("click", printResult);

    qsa('[data-open-modal="modal-grades"], [data-modal="modal-grades"]').forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();

        openModal("modal-grades");

        if (!state.loaded) {
          await loadTermResults();
        } else {
          renderActiveResult();
        }
      });
    });

    window.addEventListener("student:openGrades", async () => {
      openModal("modal-grades");

      if (!state.loaded) {
        await loadTermResults();
      } else {
        renderActiveResult();
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
        if (!state.loaded) await loadTermResults();
        else renderActiveResult();
      },
      reload: loadTermResults,
    };

    // تحميل خفيف لتحديث كرت الدرجات إذا كان الطالب مسجلًا.
    loadTermResults().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", init);
})();