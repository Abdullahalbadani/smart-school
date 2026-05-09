(function () {
  "use strict";

  const API_BASE = window.API_BASE || "/api";

  const state = {
    student: null,
    results: [],
    activeIndex: 0,
  };

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function getToken() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function apiGet(path) {
    const token = getToken();

    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.message || "تعذر جلب البيانات.");
    }

    return data;
  }

  function fmtNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(digits);
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
    };

    return map[status] || status || "—";
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
function getSelectedStudentId() {
  // 1) عناصر محددة إن وجدت
  const directSelectors = [
    "#selectedStudentId",
    "#selectedChildId",
    "#parentStudentSelect",
    "#childSelect",
    "#childrenSelect",
    "#studentSelect",
    "[name='student_id']",
    "[name='child_id']",
    "[data-selected-student-id]",
    "[data-student-id].active",
    "[data-student-id].selected",
    ".child-card.active",
    ".child-card.selected",
    ".student-card.active",
    ".student-card.selected",
  ];

  for (const selector of directSelectors) {
    const el = document.querySelector(selector);
    if (!el) continue;

    const fromDataset =
      el.dataset?.selectedStudentId ||
      el.dataset?.studentId ||
      el.dataset?.childId ||
      el.getAttribute("data-selected-student-id") ||
      el.getAttribute("data-student-id") ||
      el.getAttribute("data-child-id");

    const datasetId = Number(fromDataset);
    if (Number.isInteger(datasetId) && datasetId > 0) return datasetId;

    const valueId = Number(el.value);
    if (Number.isInteger(valueId) && valueId > 0) return valueId;
  }

  // 2) ابحث في أي select خارج موديل الدرجات، لأن grResultSelect داخل الموديل ليس الابن
  const selects = Array.from(document.querySelectorAll("select")).filter((select) => {
    return !select.closest("#modal-grades");
  });

  for (const select of selects) {
    const selectedOption = select.options?.[select.selectedIndex];
    const text = String(selectedOption?.textContent || "");
    const value = Number(select.value);

    const looksLikeStudent =
      text.includes("طالب") ||
      text.includes("S7-") ||
      text.includes("المرحلة") ||
      String(select.id || "").toLowerCase().includes("student") ||
      String(select.id || "").toLowerCase().includes("child") ||
      String(select.name || "").toLowerCase().includes("student") ||
      String(select.name || "").toLowerCase().includes("child");

    if (looksLikeStudent && Number.isInteger(value) && value > 0) {
      return value;
    }

    const optionStudentId =
      selectedOption?.dataset?.studentId ||
      selectedOption?.dataset?.childId ||
      selectedOption?.getAttribute("data-student-id") ||
      selectedOption?.getAttribute("data-child-id");

    const optionId = Number(optionStudentId);
    if (Number.isInteger(optionId) && optionId > 0) return optionId;
  }

  // 3) قيم عامة لو ملف اختيار الابن يخزنها في window/localStorage
  const globals = [
    window.selectedStudentId,
    window.currentStudentId,
    window.selectedChildId,
    window.currentChildId,
    window.ParentPortal?.selectedStudentId,
    window.ParentPortal?.currentStudentId,
    window.ParentPortal?.selectedChildId,
    window.parentPortal?.selectedStudentId,
    window.parentState?.selectedStudentId,
  ];

  for (const value of globals) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) return id;
  }

  const saved =
    localStorage.getItem("selectedStudentId") ||
    localStorage.getItem("currentStudentId") ||
    localStorage.getItem("selectedChildId") ||
    localStorage.getItem("currentChildId");

  const savedId = Number(saved);
  if (Number.isInteger(savedId) && savedId > 0) return savedId;

  return null;
}

  function resultTitle(result) {
    if (!result) return "—";

    return [
      result.academic_year_name || "سنة دراسية",
      result.term_label || `الفصل ${result.term}`,
      result.grade_name || "",
      result.section_name ? `شعبة ${result.section_name}` : "",
    ]
      .filter(Boolean)
      .join(" - ");
  }

  function activeResult() {
    return state.results[state.activeIndex] || null;
  }

  function fillResultSelect() {
    const select = $("#grResultSelect");
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
      option.textContent = resultTitle(result);
      select.appendChild(option);
    });

    select.value = String(state.activeIndex);
  }

  function renderSummary(result) {
    const box = $("#parentResultSummary");
    if (!box) return;

    if (!result) {
      box.innerHTML = `<div class="muted-box">لا توجد نتائج منشورة لهذا الابن.</div>`;
      return;
    }

    const student = state.student || {};
    const total = scoreWithMax(result.total_score, result.max_score);

    const percentage =
      result.percentage == null ? "—" : `${fmtNumber(result.percentage)}%`;

    const gradeLabel =
      result.grade_label || gradeLabelFromPercentage(result.percentage);

    const statusText =
      result.student_status_label || statusLabel(result.student_status);

    box.innerHTML = `
      <div class="muted-box">
        <strong>${escapeHtml(student.full_name || "—")}</strong>
        <br>
        ${escapeHtml(student.student_code || "—")}
        · ${escapeHtml(result.grade_name || "—")}
        · شعبة ${escapeHtml(result.section_name || "—")}
        · ${escapeHtml(result.term_label || "—")}
        <br><br>
        المجموع النهائي: <strong>${escapeHtml(total)}</strong>
        · النسبة: <strong>${escapeHtml(percentage)}</strong>
        · التقدير: <strong>${escapeHtml(gradeLabel)}</strong>
        · الحالة: <strong>${escapeHtml(statusText)}</strong>
        · الترتيب: <strong>${escapeHtml(result.rank_in_section || "—")}</strong>
      </div>
    `;
  }

  function renderTable(result) {
    const body = $("#grBody");
    const empty = $("#grEmpty");

    if (!body) return;

    body.innerHTML = "";

    const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

    if (!result || !subjects.length) {
      if (empty) empty.style.display = "";
      renderSummary(result);
      return;
    }

    if (empty) empty.style.display = "none";

    body.innerHTML = subjects
      .map((subject) => {
        const aggregate = scoreWithMax(
          subject.aggregate_score,
          subject.aggregate_max_score
        );

        const exam = scoreWithMax(
          subject.exam_score,
          subject.exam_max_score
        );

        const total = scoreWithMax(subject.total_score, subject.max_score);

        const percentage =
          subject.percentage == null ? "—" : `${fmtNumber(subject.percentage)}%`;

        const gradeLabel =
          subject.grade_label || gradeLabelFromPercentage(subject.percentage);

        const statusText =
          subject.status_label || statusLabel(subject.status);

        return `
          <tr>
            <td>${escapeHtml(subject.subject_name || "—")}</td>
            <td>${escapeHtml(aggregate)}</td>
            <td>${escapeHtml(exam)}</td>
            <td>${escapeHtml(total)}</td>
            <td>${escapeHtml(percentage)}</td>
            <td>${escapeHtml(gradeLabel)}</td>
            <td>${escapeHtml(statusText)}</td>
          </tr>
        `;
      })
      .join("");

    renderSummary(result);
  }

  function renderActive() {
    fillResultSelect();
    renderTable(activeResult());
  }

  async function loadGrades() {
    const studentId = getSelectedStudentId();
  console.log("parent selected student id:", studentId);

    if (!studentId) {
      renderSummary(null);
      const empty = $("#grEmpty");
      if (empty) {
        empty.style.display = "";
        empty.textContent = "اختر الابن أولًا.";
      }
      return;
    }

    const btn = $("#btnGrLoad");
    if (btn) btn.disabled = true;

    try {
      const data = await apiGet(`/parent/term-results?student_id=${encodeURIComponent(studentId)}`);

      state.student = data.student || null;
      state.results = Array.isArray(data.results) ? data.results : [];
      state.activeIndex = 0;

      renderActive();
    } catch (err) {
      state.student = null;
      state.results = [];
      state.activeIndex = 0;

      fillResultSelect();
      renderSummary(null);

      const empty = $("#grEmpty");
      if (empty) {
        empty.style.display = "";
        empty.textContent = err.message || "تعذر تحميل درجات الابن.";
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function printGrades() {
    if (!activeResult()) {
      alert("لا توجد نتيجة للطباعة.");
      return;
    }

    window.print();
  }

  function bindEvents() {
    $("#btnGrLoad")?.addEventListener("click", loadGrades);

    $("#grResultSelect")?.addEventListener("change", (ev) => {
      state.activeIndex = Number(ev.target.value) || 0;
      renderActive();
    });

    $("#btnGrPrint")?.addEventListener("click", printGrades);

    document.addEventListener("click", (ev) => {
      const trigger = ev.target.closest('[data-modal="modal-grades"], [data-open-modal="modal-grades"]');
      if (!trigger) return;

      setTimeout(() => {
        loadGrades();
      }, 150);
    });

    window.addEventListener("parent:selectedStudentChanged", () => {
      loadGrades();
    });
  }

  function init() {
    if (!$("#modal-grades")) return;
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();