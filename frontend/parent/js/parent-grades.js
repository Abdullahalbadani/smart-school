(function () {
  "use strict";

  const API_BASE = window.API_BASE || "/api";

  const state = {
    student: null,
    termResults: [],
    assessmentGrades: [],
    activeIndex: 0,
    mode: "term_results",
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

  function fmtDate(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";

    return d.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
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

  function parseStudentRefFromText(text) {
    const t = String(text || "").trim();
    if (!t) return null;

    const fullCode = t.match(/\bS\d+-\d+\b/i);
    if (fullCode) {
      return {
        type: "student_code",
        value: fullCode[0].toUpperCase(),
      };
    }

    const demoCode = t.match(/طالب\s+تجريبي\s+([0-9]{3,6})/);
    if (demoCode) {
      return {
        type: "student_code",
        value: demoCode[1],
      };
    }

    return null;
  }

  function getSelectedStudentRef() {
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
      if (Number.isInteger(datasetId) && datasetId > 0) {
        return { type: "student_id", value: datasetId };
      }

      const valueId = Number(el.value);
      if (Number.isInteger(valueId) && valueId > 0) {
        return { type: "student_id", value: valueId };
      }

      const byText = parseStudentRefFromText(el.textContent);
      if (byText) return byText;
    }

    const selectedTexts = [];

    document.querySelectorAll("select").forEach((select) => {
      if (select.closest("#modal-grades")) return;

      const option = select.options?.[select.selectedIndex];
      if (option) selectedTexts.push(option.textContent);
    });

    document
      .querySelectorAll(
        "button, [role='button'], .active, .selected, .is-active, .is-selected, .child-chip, .student-chip"
      )
      .forEach((el) => {
        if (el.closest("#modal-grades")) return;

        const text = String(el.textContent || "").trim();

        if (
          text.includes("طالب") ||
          text.includes("S7-") ||
          text.includes("المرحلة")
        ) {
          selectedTexts.push(text);
        }
      });

    for (const text of selectedTexts) {
      const ref = parseStudentRefFromText(text);
      if (ref) return ref;
    }

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
      if (Number.isInteger(id) && id > 0) {
        return { type: "student_id", value: id };
      }
    }

    const saved =
      localStorage.getItem("selectedStudentId") ||
      localStorage.getItem("currentStudentId") ||
      localStorage.getItem("selectedChildId") ||
      localStorage.getItem("currentChildId");

    const savedId = Number(saved);
    if (Number.isInteger(savedId) && savedId > 0) {
      return { type: "student_id", value: savedId };
    }

    return null;
  }

  function buildStudentQuery(selectedRef) {
    if (!selectedRef) return "";

    if (selectedRef.type === "student_id") {
      return `student_id=${encodeURIComponent(selectedRef.value)}`;
    }

    return `student_code=${encodeURIComponent(selectedRef.value)}`;
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

  function setLoading(message = "جاري التحميل...") {
    const select = $("#grResultSelect");
    const body = $("#grBody");
    const empty = $("#grEmpty");
    const summary = $("#parentResultSummary");

    if (select) {
      select.innerHTML = `<option value="">${message}</option>`;
    }

    if (body) body.innerHTML = "";

    if (empty) {
      empty.style.display = "";
      empty.textContent = message;
    }

    if (summary) {
      summary.innerHTML = `<div class="muted-box">${escapeHtml(message)}</div>`;
    }
  }

  function showEmpty(message) {
    const body = $("#grBody");
    const empty = $("#grEmpty");

    if (body) body.innerHTML = "";

    if (empty) {
      empty.style.display = "";
      empty.textContent = message || "لا توجد درجات منشورة.";
    }
  }

  function renderTermHeader() {
    const head = $("#grHead");
    if (!head) return;

    head.innerHTML = `
      <tr>
        <th>المادة</th>
        <th>المحصلة</th>
        <th>الاختبار</th>
        <th>المجموع</th>
        <th>النسبة</th>
        <th>التقدير</th>
        <th>الحالة</th>
      </tr>
    `;
  }

  function renderAssessmentHeader() {
    const head = $("#grHead");
    if (!head) return;

    head.innerHTML = `
      <tr>
        <th>المادة</th>
        <th>التقييم</th>
        <th>النوع</th>
        <th>الدرجة</th>
        <th>النسبة</th>
        <th>التقدير</th>
        <th>الحالة</th>
        <th>النشر</th>
      </tr>
    `;
  }

  function fillTermResultSelect() {
    const select = $("#grResultSelect");
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
      option.textContent = resultTitle(result);
      select.appendChild(option);
    });

    select.value = String(state.activeIndex);
  }

  function fillAssessmentSelect() {
    const select = $("#grResultSelect");
    if (!select) return;

    select.innerHTML = "";

    const option = document.createElement("option");
    option.value = "all";
    option.textContent = "كل الدرجات المعروضة";
    select.appendChild(option);
  }

  function renderTermSummary(result) {
    const box = $("#parentResultSummary");
    if (!box) return;

    if (!result) {
      box.innerHTML = `<div class="muted-box">لا توجد نتائج نهاية فصل منشورة لهذا الابن.</div>`;
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

  function renderAssessmentSummary(payload) {
    const box = $("#parentResultSummary");
    if (!box) return;

    const student = state.student || {};
    const summary = payload?.summary || {};
    const avg =
      summary.average_percentage == null
        ? "—"
        : `${fmtNumber(summary.average_percentage)}%`;

    box.innerHTML = `
      <div class="muted-box">
        <strong>${escapeHtml(student.full_name || "—")}</strong>
        <br>
        ${escapeHtml(student.student_code || "—")}
        <br><br>
        عدد الدرجات: <strong>${escapeHtml(summary.total_count || 0)}</strong>
        · المرصودة: <strong>${escapeHtml(summary.graded_count || 0)}</strong>
        · الغياب: <strong>${escapeHtml(summary.absent_count || 0)}</strong>
        · المعذور: <strong>${escapeHtml(summary.excused_count || 0)}</strong>
        · متوسط النسبة: <strong>${escapeHtml(avg)}</strong>
        · التقدير التقريبي: <strong>${escapeHtml(summary.average_grade_label || "—")}</strong>
      </div>
    `;
  }

  function renderTermTable(result) {
    renderTermHeader();
    renderTermSummary(result);

    const body = $("#grBody");
    const empty = $("#grEmpty");

    if (!body) return;

    body.innerHTML = "";

    const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

    if (!result || !subjects.length) {
      if (empty) {
        empty.style.display = "";
        empty.textContent = "لا توجد تفاصيل مواد لهذه النتيجة.";
      }
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
  }

  function renderAssessmentTable(payload) {
    renderAssessmentHeader();
    renderAssessmentSummary(payload);

    const body = $("#grBody");
    const empty = $("#grEmpty");

    if (!body) return;

    body.innerHTML = "";

    const grades = Array.isArray(payload?.grades) ? payload.grades : [];

    if (!grades.length) {
      if (empty) {
        empty.style.display = "";
        empty.textContent = "لا توجد درجات منشورة من هذا النوع.";
      }
      return;
    }

    if (empty) empty.style.display = "none";

    body.innerHTML = grades
      .map((item) => {
        const percentage =
          item.percentage == null ? "—" : `${fmtNumber(item.percentage)}%`;

        const gradeLabel =
          item.grade_label || gradeLabelFromPercentage(item.percentage);

        const statusText =
          item.status_label || statusLabel(item.grade_status);

        const title =
          item.title_short || item.title || item.kind_label || "تقييم";

        const published =
          item.grade_published_at ||
          item.assessment_published_at ||
          item.graded_at ||
          item.assessment_created_at;

        return `
          <tr>
            <td>${escapeHtml(item.subject_name || "—")}</td>
            <td>${escapeHtml(title)}</td>
            <td>${escapeHtml(item.kind_label || "تقييم")}</td>
            <td>${escapeHtml(scoreWithMax(item.score, item.max_score))}</td>
            <td>${escapeHtml(percentage)}</td>
            <td>${escapeHtml(gradeLabel)}</td>
            <td>${escapeHtml(statusText)}</td>
            <td>${escapeHtml(fmtDate(published))}</td>
          </tr>
        `;
      })
      .join("");
  }

  function activeTermResult() {
    return state.termResults[state.activeIndex] || null;
  }

  function renderActiveTermResult() {
    fillTermResultSelect();
    renderTermTable(activeTermResult());
  }

  async function loadTermResults(query) {
    const data = await apiGet(`/parent/term-results?${query}`);

    state.student = data.student || null;
    state.termResults = Array.isArray(data.results) ? data.results : [];
    state.assessmentGrades = [];
    state.activeIndex = 0;

    renderActiveTermResult();
  }

  async function loadAssessmentGrades(query, type) {
    const data = await apiGet(`/parent/grades?${query}&type=${encodeURIComponent(type)}`);

    state.student = data.student || null;
    state.assessmentGrades = Array.isArray(data.grades) ? data.grades : [];
    state.termResults = [];
    state.activeIndex = 0;

    fillAssessmentSelect();
    renderAssessmentTable(data);
  }

  async function loadGrades() {
    const selectedRef = getSelectedStudentRef();

    console.log("parent selected student ref:", selectedRef);

    const resultSelect = $("#grResultSelect");
    const empty = $("#grEmpty");
    const btn = $("#btnGrLoad");

    if (!selectedRef) {
      if (resultSelect) {
        resultSelect.innerHTML = `<option value="">اختر الابن أولًا</option>`;
      }

      if (empty) {
        empty.style.display = "";
        empty.textContent = "لم أستطع معرفة الابن المختار.";
      }

      renderTermSummary(null);
      return;
    }

    const type = $("#grType")?.value || "term_results";
    const query = buildStudentQuery(selectedRef);

    if (btn) btn.disabled = true;

    try {
      setLoading("جاري تحميل الدرجات...");

      if (type === "term_results") {
        state.mode = "term_results";
        await loadTermResults(query);
      } else {
        state.mode = "assessments";
        await loadAssessmentGrades(query, type);
      }
    } catch (err) {
      state.student = null;
      state.termResults = [];
      state.assessmentGrades = [];
      state.activeIndex = 0;

      if (resultSelect) {
        resultSelect.innerHTML = `<option value="">تعذر التحميل</option>`;
      }

      showEmpty(err.message || "تعذر تحميل درجات الابن.");

      const summary = $("#parentResultSummary");
      if (summary) {
        summary.innerHTML = `<div class="muted-box">${escapeHtml(err.message || "تعذر تحميل درجات الابن.")}</div>`;
      }
    } finally {
      if (btn) btn.disabled = false;
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

function buildParentResultSheetHTML(result) {
  const student = state.student || {};
  const subjects = Array.isArray(result?.subjects) ? result.subjects : [];

  const title = resultSheetTitle(result);
  const kind = resultKindLabel(result);

  const total = scoreWithMax(result?.total_score, result?.max_score);

  const percentage =
    result?.percentage == null ? "—" : `${fmtNumber(result.percentage)}%`;

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
            subject.percentage == null ? "—" : `${fmtNumber(subject.percentage)}%`;

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
    window.AppUI?.alert({
      title: "تعذر الطباعة",
      message: "لا توجد نتيجة منشورة للطباعة.",
      type: "warning",
    });
    return;
  }

  const win = window.open("", "_blank", "width=950,height=720");

  if (!win) {
    window.AppUI?.alert({
      title: "تعذر فتح نافذة الطباعة",
      message: "المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.",
      type: "warning",
    });
    return;
  }

  win.document.open();
  win.document.write(buildParentResultSheetHTML(result));
  win.document.close();
  win.focus();

  setTimeout(() => {
    win.print();
  }, 500);
}
  function printGrades() {
  if (state.mode === "term_results") {
    printTermResultSheet();
    return;
  }

  const hasData = state.assessmentGrades.length > 0;

  if (!hasData) {
    window.AppUI?.alert({
      title: "تعذر الطباعة",
      message: "لا توجد درجات للطباعة.",
      type: "warning",
    });
    return;
  }

  window.print();
}

  function bindEvents() {
    $("#btnGrLoad")?.addEventListener("click", loadGrades);

    $("#grType")?.addEventListener("change", () => {
      loadGrades();
    });

    $("#grResultSelect")?.addEventListener("change", (ev) => {
      if (state.mode !== "term_results") return;

      state.activeIndex = Number(ev.target.value) || 0;
      renderActiveTermResult();
    });

    $("#btnGrPrint")?.addEventListener("click", printGrades);

    document.addEventListener("click", (ev) => {
      const trigger = ev.target.closest(
        '[data-modal="modal-grades"], [data-open-modal="modal-grades"]'
      );

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
    const printBtnText = $("#btnGrPrint")?.querySelector("span");
if (printBtnText) printBtnText.textContent = "طباعة كشف الدرجات";
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();