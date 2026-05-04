(() => {
  "use strict";

  const state = {
    meta: null,
    lastData: null,
    loading: false,
  };

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

  const $ = (selector, root = document) => root.querySelector(selector);

  function root() {
    return $("#monthlyReportsPage");
  }

  function token() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }

  function headers() {
    const t = token();
    return {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    };
  }

  function apiUrl(path) {
    if (path.startsWith("http")) return path;
    return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function apiGet(path) {
    const res = await fetch(apiUrl(path), {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new Error(data?.message || data?.error || "فشل الاتصال بالخادم.");
    }

    return data;
  }
async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || "فشل تنفيذ العملية.");
  }

  return data;
}
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeItems(data, keys) {
    for (const key of keys) {
      if (Array.isArray(data?.[key])) return data[key];
      if (Array.isArray(data?.data?.[key])) return data.data[key];
      if (Array.isArray(data?.items?.[key])) return data.items[key];
    }

    if (Array.isArray(data)) return data;

    return [];
  }

  function itemId(item) {
    return item?.id ?? item?.value ?? item?.academic_year_id ?? item?.stage_id ?? item?.grade_id ?? item?.section_id ?? item?.subject_id;
  }

  function itemName(item) {
    return item?.name ?? item?.title ?? item?.label ?? item?.year_name ?? item?.academic_year_name ?? item?.full_name ?? item?.subject_name ?? "";
  }

  function fillSelect(select, items, placeholder, selectedValue = "") {
    if (!select) return;

    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];

    for (const item of items) {
      const id = itemId(item);
      const name = itemName(item);

      if (id === undefined || id === null || name === "") continue;

      options.push(
        `<option value="${escapeHtml(id)}"${String(id) === String(selectedValue) ? " selected" : ""}>${escapeHtml(name)}</option>`
      );
    }

    select.innerHTML = options.join("");
  }

  function getAllYears() {
    return normalizeItems(state.meta, ["academicYears", "academic_years", "years"]);
  }

  function getAllStages() {
    return normalizeItems(state.meta, ["stages"]);
  }

  function getAllGrades() {
    return normalizeItems(state.meta, ["grades"]);
  }

  function getAllSections() {
    return normalizeItems(state.meta, ["sections", "classes"]);
  }

  function getAllSubjects() {
    return normalizeItems(state.meta, ["subjects"]);
  }

  function sameId(a, b) {
    return String(a ?? "") === String(b ?? "");
  }

  function hasField(item, fields) {
    return fields.some((field) => item?.[field] !== undefined && item?.[field] !== null && String(item?.[field]) !== "");
  }

  function filterByStage(items, stageId) {
    if (!stageId) return items;

    return items.filter((item) => {
      if (!hasField(item, ["stage_id", "stageId"])) return true;
      return sameId(item.stage_id ?? item.stageId, stageId);
    });
  }

  function filterByGrade(items, gradeId) {
    if (!gradeId) return items;

    return items.filter((item) => {
      if (!hasField(item, ["grade_id", "gradeId"])) return true;
      return sameId(item.grade_id ?? item.gradeId, gradeId);
    });
  }

  function getSelected(rootEl) {
    return {
      academic_year_id: $("#mrAcademicYear", rootEl)?.value || "",
      term: $("#mrTerm", rootEl)?.value || "",
      stage_id: $("#mrStage", rootEl)?.value || "",
      grade_id: $("#mrGrade", rootEl)?.value || "",
      section_id: $("#mrSection", rootEl)?.value || "",
      subject_id: $("#mrSubject", rootEl)?.value || "",
    };
  }

  function setMessage(message, type = "normal") {
    const result = $("#mrResult", root());
    if (!result) return;

    result.innerHTML = `
      <div class="mr-message ${type === "error" ? "mr-error" : ""}">
        ${escapeHtml(message)}
      </div>
    `;
  }

  function setLoading(isLoading) {
    state.loading = isLoading;

    const rootEl = root();
    const btn = $("#mrLoadBtn", rootEl);

    if (btn) {
      btn.disabled = isLoading;
      btn.innerHTML = isLoading
        ? `<i class="ri-loader-4-line"></i> جاري التحميل...`
        : `<i class="ri-search-line"></i> عرض الأعمال`;
    }
  }

  function scoreText(value, max) {
    if (value === null || value === undefined || value === "") {
      return `<span class="mr-empty-score">—</span>`;
    }

    return `<span class="mr-score">${escapeHtml(value)} / ${escapeHtml(max)}</span>`;
  }
function approvalText(status) {
  if (status === "approved") return "معتمدة";
  if (status === "returned") return "مرجعة للمعلم";
  return "غير معتمدة";
}

function approvalClass(status) {
  if (status === "approved") return "mr-status-ok";
  if (status === "returned") return "mr-status-bad";
  return "mr-status-bad";
}

function updateActionButtons(data) {
  const rootEl = root();
  if (!rootEl) return;

  const printBtn = $("#mrPrintBtn", rootEl);
  const approveBtn = $("#mrApproveBtn", rootEl);
  const returnBtn = $("#mrReturnBtn", rootEl);

  const hasData = !!data;
  const isApproved = data?.approval?.status === "approved";
  const canApprove = !!data?.summary?.can_approve;

  if (printBtn) printBtn.disabled = !hasData;

  if (approveBtn) {
    approveBtn.disabled = !canApprove;
    approveBtn.innerHTML = canApprove
      ? `<i class="ri-checkbox-circle-line"></i> اعتماد المادة`
      : `<i class="ri-lock-line"></i> غير جاهزة للاعتماد`;
  }

  if (returnBtn) {
    returnBtn.disabled = !hasData || isApproved;
    returnBtn.innerHTML = isApproved
      ? `<i class="ri-lock-line"></i> تم الاعتماد`
      : `<i class="ri-arrow-go-back-line"></i> إرجاع للمعلم`;
  }
}
  function renderMissingList(missing) {
    if (!Array.isArray(missing) || !missing.length) return "";

    return `
      <ul class="mr-missing-list">
        ${missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    `;
  }

function renderSummary(data) {
  const summary = data?.summary || {};
  const config = data?.config || {};
  const approval = data?.approval || {};

  return `
    <div class="mr-summary">
      <div class="mr-card">
        <span>الفصل</span>
        <strong>${escapeHtml(config.term_label || "—")}</strong>
      </div>

      <div class="mr-card">
        <span>عدد الطلاب</span>
        <strong>${escapeHtml(summary.students_count ?? 0)}</strong>
      </div>

      <div class="mr-card">
        <span>مكتمل</span>
        <strong>${escapeHtml(summary.complete_count ?? 0)}</strong>
      </div>

      <div class="mr-card">
        <span>ناقص</span>
        <strong>${escapeHtml(summary.missing_count ?? 0)}</strong>
      </div>

      <div class="mr-card">
        <span>حالة الاعتماد</span>
        <strong>${escapeHtml(approvalText(approval.status))}</strong>
      </div>
    </div>
  `;
}

  function renderAssessmentsInfo(data) {
    const exam = data?.assessments?.exam;
    const aggregate = data?.assessments?.aggregate;
    const config = data?.config || {};

    return `
      <div class="mr-panel">
        <div class="mr-summary" style="margin-bottom:0;">
          <div class="mr-card">
            <span>${escapeHtml(config.exam_label || "الاختبار")}</span>
            <strong>${exam ? escapeHtml(exam.status || "—") : "غير موجود"}</strong>
          </div>

          <div class="mr-card">
            <span>${escapeHtml(config.aggregate_label || "المحصلة")}</span>
            <strong>${aggregate ? escapeHtml(aggregate.status || "—") : "غير موجود"}</strong>
          </div>

          <div class="mr-card">
            <span>درجة الاختبار</span>
            <strong>${escapeHtml(config.exam_max ?? "—")}</strong>
          </div>

          <div class="mr-card">
            <span>درجة المحصلة</span>
            <strong>${escapeHtml(config.aggregate_max ?? "—")}</strong>
          </div>
        </div>
      </div>
    `;
  }
function renderApprovalInfo(data) {
  const approval = data?.approval || {};
  const status = approval.status || "pending";

  return `
    <div class="mr-panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div>
          <div style="color:#94a3b8;font-weight:900;font-size:13px;margin-bottom:8px;">حالة الكنترول</div>
          <span class="mr-status ${approvalClass(status)}">${escapeHtml(approvalText(status))}</span>
        </div>

        ${
          approval.return_note
            ? `<div style="color:#fecaca;font-weight:800;line-height:1.8;">سبب الإرجاع: ${escapeHtml(approval.return_note)}</div>`
            : ""
        }

        ${
          data?.summary?.can_approve
            ? `<div style="color:#86efac;font-weight:900;">المادة مكتملة وجاهزة للاعتماد.</div>`
            : status === "approved"
              ? `<div style="color:#86efac;font-weight:900;">تم اعتماد هذه المادة.</div>`
              : `<div style="color:#fecaca;font-weight:900;">لا يمكن الاعتماد قبل اكتمال جميع الطلاب.</div>`
        }
      </div>
    </div>
  `;
}
  function renderTable(data) {
    const rows = Array.isArray(data?.students) ? data.students : [];
    const config = data?.config || {};

    if (!rows.length) {
      return `
        <div class="mr-message">
          لا توجد بيانات طلاب لهذا الاختيار.
        </div>
      `;
    }

    return `
      <div class="mr-panel">
        <div class="mr-table-wrap">
          <table class="mr-table">
            <thead>
              <tr>
                <th>م</th>
                <th>الطالب</th>
                <th>${escapeHtml(config.exam_label || "الاختبار")} / ${escapeHtml(config.exam_max ?? "")}</th>
                <th>${escapeHtml(config.aggregate_label || "المحصلة")} / ${escapeHtml(config.aggregate_max ?? "")}</th>
                <th>${escapeHtml(config.total_label || "المجموع")} / ${escapeHtml(config.total_max ?? "")}</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((row, index) => {
                  const ok = !!row.is_complete;

                  return `
                    <tr>
                      <td>${index + 1}</td>
                      <td>
                        <div class="mr-student-name">${escapeHtml(row.full_name)}</div>
                        <div class="mr-muted">${escapeHtml(row.student_code || "")}</div>
                      </td>
                      <td>${scoreText(row.exam_score, config.exam_max)}</td>
                      <td>${scoreText(row.aggregate_score, config.aggregate_max)}</td>
                      <td>${scoreText(row.total_score, config.total_max)}</td>
                      <td>
                        <span class="mr-status ${ok ? "mr-status-ok" : "mr-status-bad"}">
                          ${escapeHtml(row.status)}
                        </span>
                        ${renderMissingList(row.missing)}
                      </td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderData(data) {
    const result = $("#mrResult", root());
    const printBtn = $("#mrPrintBtn", root());

    if (!result) return;

    state.lastData = data;

    if (printBtn) {
      printBtn.disabled = false;
    }

    result.innerHTML = `
      ${renderSummary(data)}
      ${renderAssessmentsInfo(data)}
      ${renderTable(data)}
    `;
  }
function renderData(data) {
  const result = $("#mrResult", root());

  if (!result) return;

  state.lastData = data;
  updateActionButtons(data);

  result.innerHTML = `
    ${renderSummary(data)}
    ${renderApprovalInfo(data)}
    ${renderAssessmentsInfo(data)}
    ${renderTable(data)}
  `;
}
  function validateSelection(sel) {
    if (!sel.academic_year_id) return "اختر السنة الدراسية.";
    if (!sel.term) return "اختر الفصل الدراسي.";
    if (!sel.stage_id) return "اختر المرحلة.";
    if (!sel.grade_id) return "اختر الصف.";
    if (!sel.section_id) return "اختر الشعبة.";
    if (!sel.subject_id) return "اختر المادة.";
    return "";
  }

  async function loadTermWorks() {
    const rootEl = root();
    if (!rootEl || state.loading) return;

    const sel = getSelected(rootEl);
    const error = validateSelection(sel);

    if (error) {
      setMessage(error, "error");
      return;
    }

    const qs = new URLSearchParams(sel);

    try {
      setLoading(true);
      setMessage("جاري تحميل كشف الأعمال الفصلية...");
      const data = await apiGet(`/admin/control/term-works?${qs.toString()}`);
      renderData(data);
    } catch (e) {
      state.lastData = null;
      const printBtn = $("#mrPrintBtn", rootEl);
      if (printBtn) printBtn.disabled = true;
      setMessage(e.message || "فشل تحميل البيانات.", "error");
    } finally {
      setLoading(false);
    }
  }

  function refreshGrades() {
    const rootEl = root();
    if (!rootEl) return;

    const stageId = $("#mrStage", rootEl)?.value || "";
    const grades = filterByStage(getAllGrades(), stageId);
    fillSelect($("#mrGrade", rootEl), grades, "اختر الصف");
    refreshSections();
    refreshSubjects();
  }

  function refreshSections() {
    const rootEl = root();
    if (!rootEl) return;

    const gradeId = $("#mrGrade", rootEl)?.value || "";
    const sections = filterByGrade(getAllSections(), gradeId);
    fillSelect($("#mrSection", rootEl), sections, "اختر الشعبة");
  }

  function refreshSubjects() {
    const rootEl = root();
    if (!rootEl) return;

    const gradeId = $("#mrGrade", rootEl)?.value || "";
    const stageId = $("#mrStage", rootEl)?.value || "";
    let subjects = getAllSubjects();

    subjects = filterByStage(subjects, stageId);
    subjects = filterByGrade(subjects, gradeId);

    fillSelect($("#mrSubject", rootEl), subjects, "اختر المادة");
  }

  async function loadMeta() {
    state.meta = await apiGet("/timetables/meta");
  }

  function selectDefaultYear(rootEl) {
    const yearSelect = $("#mrAcademicYear", rootEl);
    if (!yearSelect) return;

    const years = getAllYears();

    const active =
      years.find((year) => year.is_active === true || year.is_current === true || year.status === "active") ||
      years[0];

    if (active) {
      yearSelect.value = String(itemId(active));
    }
  }
async function approveCurrentWorks() {
  const rootEl = root();
  if (!rootEl || !state.lastData) return;

  if (!state.lastData.summary?.can_approve) {
    setMessage("لا يمكن اعتماد المادة قبل اكتمال جميع الدرجات.", "error");
    return;
  }

  const ok = confirm("هل تريد اعتماد الأعمال الفصلية لهذه المادة؟");
  if (!ok) return;

  const sel = getSelected(rootEl);

  try {
    setLoading(true);
    await apiPost("/admin/control/term-works/approve", sel);
    await loadTermWorks();
  } catch (e) {
    setMessage(e.message || "فشل اعتماد المادة.", "error");
  } finally {
    setLoading(false);
  }
}

async function returnCurrentWorks() {
  const rootEl = root();
  if (!rootEl || !state.lastData) return;

  if (state.lastData.approval?.status === "approved") {
    setMessage("لا يمكن إرجاع مادة معتمدة.", "error");
    return;
  }

  const note = prompt("اكتب سبب إرجاع الأعمال الفصلية للمعلم:");
  if (!note || !note.trim()) {
    setMessage("يجب كتابة سبب الإرجاع.", "error");
    return;
  }

  const sel = getSelected(rootEl);

  try {
    setLoading(true);
    await apiPost("/admin/control/term-works/return", {
      ...sel,
      note: note.trim(),
    });
    await loadTermWorks();
  } catch (e) {
    setMessage(e.message || "فشل إرجاع المادة.", "error");
  } finally {
    setLoading(false);
  }
}
  function bindEvents(rootEl) {
    if (rootEl.dataset.bound === "1") return;
    rootEl.dataset.bound = "1";

    $("#mrStage", rootEl)?.addEventListener("change", () => {
      refreshGrades();
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrGrade", rootEl)?.addEventListener("change", () => {
      refreshSections();
      refreshSubjects();
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrSection", rootEl)?.addEventListener("change", () => {
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrSubject", rootEl)?.addEventListener("change", () => {
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrTerm", rootEl)?.addEventListener("change", () => {
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrAcademicYear", rootEl)?.addEventListener("change", () => {
      state.lastData = null;
      $("#mrPrintBtn", rootEl).disabled = true;
      $("#mrApproveBtn", rootEl).disabled = true;
$("#mrReturnBtn", rootEl).disabled = true;
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    });

    $("#mrLoadBtn", rootEl)?.addEventListener("click", loadTermWorks);

    $("#mrPrintBtn", rootEl)?.addEventListener("click", () => {
      window.print();
    });
    $("#mrLoadBtn", rootEl)?.addEventListener("click", loadTermWorks);

$("#mrApproveBtn", rootEl)?.addEventListener("click", approveCurrentWorks);

$("#mrReturnBtn", rootEl)?.addEventListener("click", returnCurrentWorks);

$("#mrPrintBtn", rootEl)?.addEventListener("click", () => {
  window.print();
});
  }

  function renderFilters() {
    const rootEl = root();
    if (!rootEl) return;

    fillSelect($("#mrAcademicYear", rootEl), getAllYears(), "اختر السنة");
    fillSelect($("#mrStage", rootEl), getAllStages(), "اختر المرحلة");
    fillSelect($("#mrGrade", rootEl), [], "اختر الصف");
    fillSelect($("#mrSection", rootEl), [], "اختر الشعبة");
    fillSelect($("#mrSubject", rootEl), getAllSubjects(), "اختر المادة");

    selectDefaultYear(rootEl);
  }

  window.initMonthlyReportsScreen = async function () {
    const rootEl = root();
    if (!rootEl) return;

    try {
      setMessage("جاري تحميل بيانات الفلاتر...");
      bindEvents(rootEl);

      if (!state.meta) {
        await loadMeta();
      }

      renderFilters();
      setMessage("اختر البيانات المطلوبة ثم اضغط عرض الأعمال.");
    } catch (e) {
      setMessage(e.message || "تعذر تحميل بيانات الصفحة.", "error");
    }
  };
})();