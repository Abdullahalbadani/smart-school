/* =========================================================
   attendanceReports.js (SPA) — متوافق 100% مع HTML الذي أرسلته
   ✅ تم إضافة فلتر الطريقة (method) لتقارير الطلاب.
   ✅ تم إصلاح الأخطاء الصامتة في جلب الفلاتر.
   ========================================================= */

(() => {
  "use strict";

  // =========================
  // Config
  // =========================
// =========================
// Config
// =========================
const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const apiUrl =
  typeof window.apiUrl === "function"
    ? window.apiUrl
    : function (path = "") {
        if (/^https?:\/\//i.test(path)) return path;

        let cleanPath = String(path || "").replace(/^\/+/, "");

        if (cleanPath.startsWith("api/")) {
          cleanPath = cleanPath.slice(4);
        }

        return `${API_BASE}/${cleanPath}`;
      };

const EP = {
  // Reports
  studentsReport: "/admin/reports/attendance/students",
  studentDetails: (id) => `/admin/reports/attendance/students/${id}/details`,
  teachersReport: "/admin/reports/attendance/teachers",
  teacherDetails: (id) => `/admin/reports/attendance/teachers/${id}/details`,

  // Filters
  years: [
    "/academic-years",
    "/academic_years",
  ],
  stages: [
    "/stages",
  ],
  gradesByStage: (stageId) => [
    `/grades?stage_id=${encodeURIComponent(stageId)}`,
    `/grades?stageId=${encodeURIComponent(stageId)}`,
  ],
  sectionsByGrade: (gradeId) => [
    `/sections?grade_id=${encodeURIComponent(gradeId)}`,
    `/sections?gradeId=${encodeURIComponent(gradeId)}`,
  ],

 attendanceReasons: [
  "/teacher/attendance/reasons",
],
};

  // =========================
  // State
  // =========================
  const state = {
    students: { page: 1, limit: 25, sort: "name_asc", lastRows: [], lastSummary: null },
    teachers: { page: 1, limit: 25, sort: "name_asc", lastRows: [], lastSummary: null },
    modal: {
      active: null,
      studentCtx: null,
      teacherCtx: null,
    },
    chart: { student: null },
  };

  // =========================
  // DOM Helpers
  // =========================
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const safe = (v) => (v === null || v === undefined) ? "" : String(v);
  const toInt = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

  const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

  const nowLocal = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return safe(s); } };

  // =========================
  // Token + Fetch
  // =========================
  const getToken = () => localStorage.getItem("token") || "";

  const buildHeaders = () => {
    const token = getToken();
    const h = { "Accept": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  const parseJsonSafe = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { return { success: false, message: text || "Invalid JSON" }; }
  };

  const normalizeSuccess = (data, ok) => {
    if (data && typeof data.success === "boolean") return data.success;
    if (data && typeof data.ok === "boolean") return data.ok;
    return ok;
  };

  const normalizeRows = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    // تمت إضافة المفاتيح الشائعة التالية:
    if (Array.isArray(data.payload)) return data.payload; 
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.results)) return data.results;
    return [];
  };
const apiGet = async (path, params = {}) => {
  const u = new URL(apiUrl(path), window.location.origin);

  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === "" || v === null || v === undefined) return;
    u.searchParams.set(k, String(v));
  });

  const res = await fetch(u.toString(), {
    headers: buildHeaders(),
  });

  const data = await parseJsonSafe(res);
  const ok = normalizeSuccess(data, res.ok);

  if (!ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
};

  const apiGetFirstOk = async (urls, params = {}) => {
    let lastErr = null;
    for (const u of urls) {
      try { return await apiGet(u, params); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("No endpoint matched");
  };

  // =========================
  // CSV
  // =========================
  const escapeCsv = (v) => {
    const s = safe(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const downloadCsv = (filename, headers, rows) => {
    const csv = [
      headers.map(escapeCsv).join(","),
      ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  };

  // =========================
  // Tabs (ARIA)
  // =========================
  const setActiveTab = (tabId) => {
    const tabs = qsa("#attendance-main-tabs [role='tab']");
    tabs.forEach((btn) => {
      const controls = btn.getAttribute("aria-controls");
      const active = controls === tabId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });

    const panels = qsa(".attendance-tab-content[role='tabpanel']");
    panels.forEach((p) => {
      const active = p.id === tabId;
      p.classList.toggle("active", active);
      p.style.display = active ? "" : "none";
    });
  };

  const handleTabKeyNav = (e) => {
    const tabs = qsa("#attendance-main-tabs [role='tab']");
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      tabs[(idx + dir + tabs.length) % tabs.length].focus();
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const tabId = document.activeElement.getAttribute("aria-controls");
      if (tabId) setActiveTab(tabId);
    }
  };

  // =========================
  // Modals
  // =========================
  const openModal = (id) => {
    const m = $(id);
    if (!m) return;
    m.setAttribute("aria-hidden", "false");
    m.classList.add("show-modal", "active");
    m.style.display = "flex";
    state.modal.active = id;
  };

  const closeModal = (id) => {
    const m = $(id);
    if (!m) return;
    m.setAttribute("aria-hidden", "true");
    m.classList.remove("show-modal", "active");
    m.style.display = "none";
    if (state.modal.active === id) state.modal.active = null;
  };

  const bindModalClose = () => {
    document.addEventListener("click", (e) => {
      if (e.target?.id === "student-dashboard-modal") closeModal("student-dashboard-modal");
      if (e.target?.id === "teacher-dashboard-modal") closeModal("teacher-dashboard-modal");
      if (e.target.closest("#close-stu-modal")) closeModal("student-dashboard-modal");
      if (e.target.closest("#close-tch-modal")) closeModal("teacher-dashboard-modal");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (state.modal.active === "student-dashboard-modal") closeModal("student-dashboard-modal");
      if (state.modal.active === "teacher-dashboard-modal") closeModal("teacher-dashboard-modal");
    });
  };

  // =========================
  // Filters loaders
  // =========================
  const fillSelect = (id, rows, placeholder, { valueKey = "id", labelKey = "name" } = {}) => {
    const sel = $(id);
    if (!sel) return;
    const curr = sel.value;

    const out = [`<option value="">${placeholder}</option>`];
    (rows || []).forEach((r) => {
      const v = r?.[valueKey] ?? r?.id;
      const t = r?.[labelKey] ?? r?.name ?? r?.full_name ?? r?.title ?? "";
      if (v === undefined || v === null) return;
      out.push(`<option value="${String(v)}">${String(t)}</option>`);
    });

    sel.innerHTML = out.join("");
    if (curr && Array.from(sel.options).some(o => o.value === curr)) sel.value = curr;
  };

  const resetGradesAndSections = () => {
    if ($("filter-stu-grade")) $("filter-stu-grade").innerHTML = `<option value="">كل الصفوف</option>`;
    if ($("filter-stu-section")) $("filter-stu-section").innerHTML = `<option value="">كل الشعب</option>`;
  };

  const loadTeachersSelectFromReport = async () => {
    const sel = $("filter-tch-teacher");
    if (!sel) return;

    try {
      // Requires token (same as reports)
      const data = await apiGet(EP.teachersReport, { page: 1, limit: 500, sort: "name_asc" });
      const rows = normalizeRows(data);

      const list = rows
        .map(r => ({ id: r.teacher_id ?? r.id, full_name: r.teacher_name ?? r.full_name ?? r.name }))
        .filter(x => x.id);

      fillSelect("filter-tch-teacher", list, "الكل", { valueKey: "id", labelKey: "full_name" });
    } catch {
      // keep dropdown with only "الكل"
      sel.innerHTML = `<option value="">الكل</option>`;
    }
  };

  const loadBaseFilters = async () => {
    // Years (students + teachers) — public
    try {
      const y = await apiGetFirstOk(EP.years);
      const rows = normalizeRows(y);
      fillSelect("filter-stu-year", rows, "الكل", { labelKey: "name" });
      fillSelect("filter-tch-year", rows, "الكل", { labelKey: "name" });
    } catch (e) {
      console.error("❌ خطأ في جلب الأعوام الدراسية:", e);
    }

    // Stages (students) — public
    try {
      const s = await apiGetFirstOk(EP.stages);
      fillSelect("filter-stu-stage", normalizeRows(s), "كل المراحل", { labelKey: "name" });
    } catch (e) {
      console.error("❌ خطأ في جلب المراحل:", e);
    }

    // Teachers list — from report (protected)
    await loadTeachersSelectFromReport();

    // Reasons — optional
    try {
      const r = await apiGetFirstOk(EP.attendanceReasons);
      fillSelect("filter-stu-reason", normalizeRows(r), "الكل", { labelKey: "name" });
    } catch (e) {
      console.warn("⚠️ لم يتم العثور على أسباب الحضور:", e);
      const sel = $("filter-stu-reason");
      if (sel) sel.innerHTML = `<option value="">الكل</option>`;
    }

    resetGradesAndSections();
  };

  const loadGradesByStage = async (stageId) => {
    const gradeSel = $("filter-stu-grade");
    if (!gradeSel) return;

    if (!stageId) {
      resetGradesAndSections();
      return;
    }

    try {
      const g = await apiGetFirstOk(EP.gradesByStage(stageId));
      fillSelect("filter-stu-grade", normalizeRows(g), "كل الصفوف", { labelKey: "name" });
    } catch (e) {
      console.error("❌ خطأ في جلب الصفوف:", e);
      gradeSel.innerHTML = `<option value="">كل الصفوف</option>`;
    }

    if ($("filter-stu-section")) $("filter-stu-section").innerHTML = `<option value="">كل الشعب</option>`;
  };

  const loadSectionsByGrade = async (gradeId) => {
    const secSel = $("filter-stu-section");
    if (!secSel) return;

    if (!gradeId) {
      secSel.innerHTML = `<option value="">كل الشعب</option>`;
      return;
    }

    try {
      const s = await apiGetFirstOk(EP.sectionsByGrade(gradeId));
      fillSelect("filter-stu-section", normalizeRows(s), "كل الشعب", { labelKey: "name" });
    } catch (e) {
      console.error("❌ خطأ في جلب الشعب:", e);
      secSel.innerHTML = `<option value="">كل الشعب</option>`;
    }
  };

  // =========================
  // Month -> range (teachers)
  // =========================
  const setTeacherRangeFromMonth = () => {
    const month = $("filter-tch-month")?.value || "";
    if (!month) return;

    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    if (!y || !m) return;

    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0);

    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    if ($("filter-tch-from")) $("filter-tch-from").value = fmt(from);
    if ($("filter-tch-to")) $("filter-tch-to").value = fmt(to);
  };

  // =========================
  // Build params
  // =========================
  const getStudentsParams = () => ({
    year_id: $("filter-stu-year")?.value || "",
    term_id: $("filter-stu-term")?.value || "",
    from: $("filter-stu-from")?.value || "",
    to: $("filter-stu-to")?.value || "",
    stage_id: $("filter-stu-stage")?.value || "",
    grade_id: $("filter-stu-grade")?.value || "",
    section_id: $("filter-stu-section")?.value || "",
    method: $("filter-stu-method")?.value || "", // ✅ تمت إضافة هذا السطر فقط
    search: $("filter-stu-search")?.value || "",
    sort: $("stu-sort")?.value || state.students.sort,
    page: state.students.page,
    limit: state.students.limit,
  });

  const getTeachersParams = () => ({
    year_id: $("filter-tch-year")?.value || "",
    month: $("filter-tch-month")?.value || "",
    from: $("filter-tch-from")?.value || "",
    to: $("filter-tch-to")?.value || "",
    teacher_id: $("filter-tch-teacher")?.value || "",
    method: $("filter-tch-method")?.value || "",
    search: $("filter-tch-search")?.value || "",
    sort: $("tch-sort")?.value || state.teachers.sort,
    page: state.teachers.page,
    limit: state.teachers.limit,
  });

  const getStudentsSchoolReportFilters = () => {
    const params = getStudentsParams();
    return {
      year_id: params.year_id,
      term_id: params.term_id,
      from: params.from,
      to: params.to,
      stage_id: params.stage_id,
      grade_id: params.grade_id,
      section_id: params.section_id,
      method: params.method,
      sort: params.sort,
    };
  };

  const getTeachersSchoolReportFilters = () => {
    const params = getTeachersParams();
    return {
      year_id: params.year_id,
      month: params.month,
      from: params.from,
      to: params.to,
      teacher_id: params.teacher_id,
      method: params.method,
      sort: params.sort,
    };
  };

  const showSchoolReportUnavailable = async () => {
    const message = "تعذر فتح نظام الكشوف المدرسية. حدّث الصفحة ثم حاول مرة أخرى.";
    if (window.AppUI?.alert) {
      await window.AppUI.alert({ title: "تعذر إنشاء الكشف", message, type: "error" });
      return;
    }
    window.alert(message);
  };

  const openStudentsSchoolReport = (action) => {
    if (!window.SchoolReports?.openAttendanceStudentsReport) return showSchoolReportUnavailable();
    return window.SchoolReports.openAttendanceStudentsReport({
      action,
      filters: getStudentsSchoolReportFilters(),
    });
  };

  const openTeachersSchoolReport = (action) => {
    if (!window.SchoolReports?.openAttendanceTeachersReport) return showSchoolReportUnavailable();
    return window.SchoolReports.openAttendanceTeachersReport({
      action,
      filters: getTeachersSchoolReportFilters(),
    });
  };

  // =========================
  // Render KPIs (Students)
  // =========================
  const renderStudentsKPIs = (summary, rows) => {
    const n = rows.length;

    let total = 0, present = 0, absent = 0, late = 0, excused = 0;
    let sumPct = 0, pctCount = 0;

    rows.forEach((r) => {
      total += toInt(r.total_sessions ?? r.total ?? 0);
      present += toInt(r.present_count ?? r.total_present ?? 0);
      absent += toInt(r.total_absent ?? 0);
      late += toInt(r.total_late ?? 0);
      excused += toInt(r.total_excused ?? 0);

      const pct = Number(r.attendance_percent ?? r.pct);
      if (Number.isFinite(pct)) { sumPct += pct; pctCount += 1; }
    });

    const avgPct = pctCount ? (sumPct / pctCount) : 0;

    if (summary && typeof summary === "object") {
      setText("stu-kpi-students", safe(summary.students ?? n));
      setText("stu-kpi-total", safe(summary.total_sessions ?? total));
      setText("stu-kpi-absent-total", safe(summary.absent ?? absent));
      setText("stu-kpi-late-total", safe(summary.late ?? late));
      setText("stu-kpi-excused-total", safe(summary.excused ?? excused));
      setText("stu-kpi-att-pct", safe((summary.avg_attendance_percent ?? avgPct).toFixed?.(2) ?? summary.avg_attendance_percent ?? avgPct));
      return;
    }

    setText("stu-kpi-students", safe(n));
    setText("stu-kpi-total", safe(total));
    setText("stu-kpi-absent-total", safe(absent));
    setText("stu-kpi-late-total", safe(late));
    setText("stu-kpi-excused-total", safe(excused));
    setText("stu-kpi-att-pct", avgPct.toFixed(2));
  };

  // =========================
  // Render KPIs (Teachers)
  // =========================
  const renderTeachersKPIs = (summary, rows) => {
    const n = rows.length;

    let total = 0, present = 0, absent = 0, late = 0;
    let sumPct = 0, pctCount = 0;

    rows.forEach((r) => {
      total += toInt(r.total_days ?? r.total ?? 0);
      present += toInt(r.present_days ?? r.present ?? 0);
      absent += toInt(r.total_absent ?? r.absent_days ?? 0);
      late += toInt(r.late_days ?? r.total_late ?? 0);

      const pct = Number(r.presence_percent ?? r.pct);
      if (Number.isFinite(pct)) { sumPct += pct; pctCount += 1; }
    });

    const avgPct = pctCount ? (sumPct / pctCount) : 0;

    if (summary && typeof summary === "object") {
      setText("tch-kpi-teachers", safe(summary.teachers ?? n));
      setText("tch-kpi-total-days", safe(summary.total_days ?? total));
      setText("tch-kpi-absent-days", safe(summary.absent_days ?? absent));
      setText("tch-kpi-late-days", safe(summary.late_days ?? late));
      setText("tch-kpi-present-days", safe(summary.present_days ?? present));
      setText("tch-kpi-presence-pct", safe((summary.avg_presence_percent ?? avgPct).toFixed?.(2) ?? summary.avg_presence_percent ?? avgPct));
      return;
    }

    setText("tch-kpi-teachers", safe(n));
    setText("tch-kpi-total-days", safe(total));
    setText("tch-kpi-absent-days", safe(absent));
    setText("tch-kpi-late-days", safe(late));
    setText("tch-kpi-present-days", safe(present));
    setText("tch-kpi-presence-pct", avgPct.toFixed(2));
  };

  // =========================
  // Render tables
  // =========================
  const renderStudentsTable = (rows) => {
    const body = $("students-reports-table-body");
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="12" class="center muted">لا توجد بيانات مطابقة للفلاتر.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((r) => {
      const studentId = r.student_id ?? r.id;
      const name = safe(r.student_name ?? r.full_name ?? r.name);
      const code = safe(r.student_code ?? r.code ?? "");
      const gs = safe(r.grade_section ?? r.section_name ?? r.class_name ?? "");

      const total = toInt(r.total_sessions ?? r.total ?? 0);
      const present = toInt(r.present_count ?? r.total_present ?? 0);
      const absent = toInt(r.total_absent ?? 0);
      const late = toInt(r.total_late ?? 0);
      const excused = toInt(r.total_excused ?? 0);
      const lateMin = toInt(r.late_minutes_total ?? r.late_minutes ?? 0);

      const pctRaw = r.attendance_percent ?? r.pct;
      const pct = (pctRaw === null || pctRaw === undefined || pctRaw === "")
        ? (total ? (((present + excused) / total) * 100) : 0)
        : Number(pctRaw);
      const pctStr = Number.isFinite(pct) ? pct.toFixed(2) : "0.00";

 

      return `
        <tr>
          <td style="font-weight:800;">${name}</td>
          <td>${code || "—"}</td>
          <td>${gs || "—"}</td>
          <td class="center">${total}</td>
          <td class="center">${present}</td>
          <td class="center">${absent}</td>
          <td class="center">${late}</td>
          <td class="center">${excused}</td>
          <td class="center">${lateMin}</td>
          <td class="center">${pctStr}</td>
          <td class="center">
            <button type="button" class="tp-btn tp-btn--pri btn-stu-details"
              data-stu-id="${studentId}"
              data-stu-name="${encodeURIComponent(name)}"
              data-stu-code="${encodeURIComponent(code)}"
              data-stu-gs="${encodeURIComponent(gs)}">
              <i class="ri-dashboard-line"></i> التفاصيل
            </button>
          </td>
        </tr>
      `;
    }).join("");
  };

  const renderTeachersTable = (rows) => {
    const body = $("teachers-reports-table-body");
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="10" class="center muted">لا توجد بيانات مطابقة للفلاتر.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((r) => {
      const teacherId = r.teacher_id ?? r.id;
      const name = safe(r.teacher_name ?? r.full_name ?? r.name);

      const total = toInt(r.total_days ?? r.total ?? 0);
      const present = toInt(r.present_days ?? r.present ?? 0);
      const absent = toInt(r.total_absent ?? r.absent_days ?? 0);
      const late = toInt(r.late_days ?? r.total_late ?? 0);

      const method = safe(r.method ?? r.last_method ?? "—");
    
      const pctRaw = r.presence_percent ?? r.pct;
      const pct = (pctRaw === null || pctRaw === undefined || pctRaw === "")
        ? (total ? ((present / total) * 100) : 0)
        : Number(pctRaw);
      const pctStr = Number.isFinite(pct) ? pct.toFixed(2) : "0.00";


      return `
        <tr>
          <td style="font-weight:800;">${name}</td>
          <td class="center">${total}</td>
          <td class="center">${present}</td>
          <td class="center">${absent}</td>
          <td class="center">${late}</td>
          <td class="center">${method || "—"}</td>
          <td class="center">${pctStr}</td>
          <td class="center">
            <button type="button" class="tp-btn tp-btn--pri btn-tch-details"
              data-tch-id="${teacherId}"
              data-tch-name="${encodeURIComponent(name)}">
              <i class="ri-dashboard-line"></i> التفاصيل
            </button>
          </td>
        </tr>
      `;
    }).join("");
  };

  // =========================
  // Fetch reports
  // =========================
  const setStudentsLoading = () => {
    setHTML("students-reports-table-body", `<tr><td colspan="12" class="center"><i class="ri-loader-4-line ri-spin"></i> جاري التحميل...</td></tr>`);
  };

  const setTeachersLoading = () => {
    setHTML("teachers-reports-table-body", `<tr><td colspan="10" class="center"><i class="ri-loader-4-line ri-spin"></i> جاري التحميل...</td></tr>`);
  };

  const fetchStudentsReport = async () => {
    setStudentsLoading();

    const params = getStudentsParams();
    state.students.sort = params.sort;
    state.students.limit = toInt(params.limit || 25);

    try {
      const data = await apiGet(EP.studentsReport, params);
      const rows = normalizeRows(data);
      state.students.lastRows = rows;
      state.students.lastSummary = data.summary || data.kpis || null;

      renderStudentsKPIs(state.students.lastSummary, rows);
      renderStudentsTable(rows);

      setText("students-last-refresh", `آخر تحديث: ${nowLocal()}`);
      setText("students-results-count", `نتائج: ${rows.length}`);
      setText("stu-page", `صفحة ${state.students.page}`);
    } catch (e) {
      setHTML("students-reports-table-body", `<tr><td colspan="12" class="center muted">❌ ${safe(e.message) || "خطأ في الاتصال بالخادم"}</td></tr>`);
      renderStudentsKPIs(null, []);
      setText("students-last-refresh", `آخر تحديث: —`);
      setText("students-results-count", `نتائج: —`);
      setText("stu-page", `صفحة —`);
    }
  };

  const fetchTeachersReport = async () => {
    setTeachersLoading();

    const params = getTeachersParams();
    state.teachers.sort = params.sort;
    state.teachers.limit = toInt(params.limit || 25);

    try {
      const data = await apiGet(EP.teachersReport, params);
      const rows = normalizeRows(data);
      state.teachers.lastRows = rows;
      state.teachers.lastSummary = data.summary || data.kpis || null;

      renderTeachersKPIs(state.teachers.lastSummary, rows);
      renderTeachersTable(rows);

      setText("teachers-last-refresh", `آخر تحديث: ${nowLocal()}`);
      setText("teachers-results-count", `نتائج: ${rows.length}`);
      setText("tch-page", `صفحة ${state.teachers.page}`);
    } catch (e) {
      setHTML("teachers-reports-table-body", `<tr><td colspan="10" class="center muted">❌ ${safe(e.message) || "خطأ في الاتصال بالخادم"}</td></tr>`);
      renderTeachersKPIs(null, []);
      setText("teachers-last-refresh", `آخر تحديث: —`);
      setText("teachers-results-count", `نتائج: —`);
      setText("tch-page", `صفحة —`);
    }
  };

  // =========================
  // Student details modal
  // =========================
  const renderStudentModalHeader = ({ name, code, gradeSection }) => {
    const from = $("filter-stu-from")?.value || "—";
    const to = $("filter-stu-to")?.value || "—";
    const year = $("filter-stu-year")?.selectedOptions?.[0]?.textContent || "—";
    const term = $("filter-stu-term")?.selectedOptions?.[0]?.textContent || "—";

    setHTML("stu-dash-header", `
      <span class="chip"><strong>${safe(name)}</strong></span>
      <span class="chip">الكود: ${safe(code) || "—"}</span>
      <span class="chip">${safe(gradeSection) || "—"}</span>
      <span class="chip">${safe(year)}</span>
      <span class="chip">${safe(term)}</span>
      <span class="chip">الفترة: ${safe(from)} → ${safe(to)}</span>
    `);
  };

  const mapStudentStatusToAr = (st) => {
    const s = safe(st).toLowerCase();
    if (s === "absent") return "غائب";
    if (s === "late") return "متأخر";
    if (s === "excused") return "بعذر";
    if (s === "present") return "حاضر";
    return safe(st) || "—";
  };

  const renderStudentLogTable = (logs) => {
    const body = $("stu-log-table-body");
    if (!body) return;

    if (!logs.length) {
      body.innerHTML = `<tr><td colspan="9" class="center muted">لا توجد سجلات ضمن الفترة.</td></tr>`;
      return;
    }

    body.innerHTML = logs.map((log) => {
      const date = safe(log.date ?? log.attendance_date ?? log.created_at ?? "");
      const period = safe(log.period ?? log.period_name ?? log.session ?? "—");
      const subject = safe(log.subject_name ?? log.subject ?? "—");
      const teacher = safe(log.teacher_name ?? log.teacher ?? "—");
      const status = safe(log.status_ar ?? mapStudentStatusToAr(log.status ?? ""));
      const reason = safe(log.reason_name ?? log.reason ?? "—");
      const lateMin = safe(log.late_minutes ?? log.late_min ?? "—");
      const notes = safe(log.notes ?? log.note ?? log.details ?? "—");
      const corrected = (log.is_corrected || log.corrected || log.correction) ? "نعم" : "—";

      return `
        <tr data-status="${safe(log.status ?? "").toLowerCase()}" data-corrected="${corrected === "نعم" ? "1" : "0"}">
          <td dir="ltr" style="text-align:right;">${date || "—"}</td>
          <td class="center">${period || "—"}</td>
          <td>${subject || "—"}</td>
          <td>${teacher || "—"}</td>
          <td class="center">${status || "—"}</td>
          <td>${reason || "—"}</td>
          <td class="center">${lateMin || "—"}</td>
          <td>${notes || "—"}</td>
          <td class="center">${corrected}</td>
        </tr>
      `;
    }).join("");
  };

  const applyStudentLogFilter = () => {
    const filter = $("stu-log-filter")?.value || "";
    const body = $("stu-log-table-body");
    if (!body) return;

    const trs = Array.from(body.querySelectorAll("tr"));
    trs.forEach((tr) => {
      const status = (tr.getAttribute("data-status") || "").toLowerCase();
      const corrected = tr.getAttribute("data-corrected") === "1";

      let show = true;
      if (filter === "corrected") show = corrected;
      else if (filter) show = status === filter;

      tr.style.display = show ? "" : "none";
    });
  };

  const renderStudentChart = (chartDataOrLogs) => {
    const canvas = $("studentAttendanceChart");
    if (!canvas) return;
    if (typeof Chart === "undefined") return;

    let labels = [];
    let values = [];

    if (chartDataOrLogs && typeof chartDataOrLogs === "object" && Array.isArray(chartDataOrLogs.labels)) {
      labels = chartDataOrLogs.labels;
      if (Array.isArray(chartDataOrLogs.data)) values = chartDataOrLogs.data;
      else if (Array.isArray(chartDataOrLogs.datasets?.[0]?.data)) values = chartDataOrLogs.datasets[0].data;
    } else if (Array.isArray(chartDataOrLogs)) {
      let p = 0, a = 0, l = 0, e = 0;
      chartDataOrLogs.forEach((x) => {
        const st = safe(x.status ?? x.status_ar).toLowerCase();
        if (st.includes("present") || st.includes("حاضر")) p++;
        else if (st.includes("absent") || st.includes("غائب")) a++;
        else if (st.includes("late") || st.includes("متأخر")) l++;
        else if (st.includes("excused") || st.includes("بعذر")) e++;
      });
      labels = ["حاضر", "غائب", "متأخر", "بعذر"];
      values = [p, a, l, e];
    }

    if (state.chart.student) {
      state.chart.student.destroy();
      state.chart.student = null;
    }

    state.chart.student = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "العدد",
          data: values,
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  };

  const renderStudentDetails = (data) => {
    const k = data.kpis || data.summary || {};
    const logs = normalizeRows(data.logs || data.details || data.entries || []);

    const total = toInt(k.total_sessions ?? k.total ?? data.total_sessions ?? 0);
    const absent = toInt(k.total_absent ?? k.absent ?? 0);
    const late = toInt(k.total_late ?? k.late ?? 0);
    const excused = toInt(k.total_excused ?? k.excused ?? 0);
    const present = toInt(k.present ?? k.present_count ?? 0);
    const pct = total ? (((present + excused) / total) * 100) : 0;

    setText("stu-kpi-absent", safe(absent));
    setText("stu-kpi-late", safe(late));
    setText("stu-kpi-excused", safe(excused));
    setText("stu-kpi-total", safe(total));
    setText("stu-kpi-pct", pct.toFixed(2));

    renderStudentLogTable(logs);
    applyStudentLogFilter();
    renderStudentChart(data.chartData || data.chart || logs);
  };

  const openStudentDashboard = async (studentId, name, code, gs) => {
    state.modal.studentCtx = { id: studentId, name, code, gs };

    setText("stu-kpi-absent", "…");
    setText("stu-kpi-late", "…");
    setText("stu-kpi-excused", "…");
    setText("stu-kpi-total", "…");
    setText("stu-kpi-pct", "…");
    setHTML("stu-log-table-body", `<tr><td colspan="9" class="center muted">جاري جلب السجل...</td></tr>`);

    renderStudentModalHeader({ name, code, gradeSection: gs });
    openModal("student-dashboard-modal");

    try {
      const params = getStudentsParams();
      const data = await apiGet(EP.studentDetails(studentId), params);
      renderStudentDetails(data);
    } catch (e) {
      setHTML("stu-log-table-body", `<tr><td colspan="9" class="center muted">❌ ${safe(e.message) || "فشل جلب التفاصيل"}</td></tr>`);
    }
  };

  // =========================
  // Teacher details modal
  // =========================
  const renderTeacherModalHeader = ({ name }) => {
    const from = $("filter-tch-from")?.value || "—";
    const to = $("filter-tch-to")?.value || "—";
    const year = $("filter-tch-year")?.selectedOptions?.[0]?.textContent || "—";
    setHTML("tch-dash-header", `
      <span class="chip"><strong>${safe(name)}</strong></span>
      <span class="chip">${safe(year)}</span>
      <span class="chip">الفترة: ${safe(from)} → ${safe(to)}</span>
    `);
  };

  const mapTeacherStatusToAr = (st) => {
    const s = safe(st).toLowerCase();
    if (s === "absent") return "غائب";
    if (s === "late") return "متأخر";
    if (s === "present") return "حاضر";
    return safe(st) || "—";
  };

  const renderTeacherLogTable = (logs) => {
    const body = $("tch-log-table-body");
    if (!body) return;

    if (!logs.length) {
      body.innerHTML = `<tr><td colspan="6" class="center muted">لا توجد سجلات ضمن الفترة.</td></tr>`;
      return;
    }

    body.innerHTML = logs.map((log) => {
      const date = safe(log.date ?? log.attendance_date ?? "");
      const status = safe(log.status_ar ?? mapTeacherStatusToAr(log.status ?? log.type ?? ""));
      const method = safe(log.method ?? log.source ?? log.scan_method ?? "");
      const notes = safe(log.notes ?? log.note ?? log.details ?? "");
      const corrected = (log.is_corrected || log.corrected || log.correction) ? "نعم" : "—";

      const statusKey = safe(log.status ?? "").toLowerCase();
      const methodKey = safe(method).toLowerCase();

      return `
        <tr data-status="${statusKey}" data-method="${methodKey}" data-corrected="${corrected === "نعم" ? "1" : "0"}">
          <td dir="ltr" style="text-align:right;">${date || "—"}</td>
          <td class="center">${status || "—"}</td>
          <td class="center">${method || "—"}</td>
          <td>${notes || "—"}</td>
          <td class="center">${corrected}</td>
        </tr>
      `;
    }).join("");
  };

  const applyTeacherLogFilter = () => {
    const filter = $("tch-log-filter")?.value || "";
    const body = $("tch-log-table-body");
    if (!body) return;

    const trs = Array.from(body.querySelectorAll("tr"));
    trs.forEach((tr) => {
      const status = (tr.getAttribute("data-status") || "").toLowerCase();
      const method = (tr.getAttribute("data-method") || "").toLowerCase();
      const corrected = tr.getAttribute("data-corrected") === "1";

      let show = true;
      if (filter === "corrected") show = corrected;
      else if (filter === "manual" || filter === "scan") show = method.includes(filter);
      else if (filter) show = status === filter;

      tr.style.display = show ? "" : "none";
    });
  };

  const renderTeacherDetails = (data) => {
    const k = data.kpis || data.summary || {};
    const logs = normalizeRows(data.logs || data.details || data.entries || []);

    const total = toInt(k.total_days ?? k.total ?? data.total_days ?? 0);
    const present = toInt(k.present_days ?? k.present ?? 0);
    const absent = toInt(k.total_absent ?? k.absent_days ?? k.absent ?? 0);
    const late = toInt(k.late_days ?? k.total_late ?? k.late ?? 0);

    const pct = total ? ((present / total) * 100) : 0;

    setText("tch-kpi-total", safe(total));
    setText("tch-kpi-present", safe(present));
    setText("tch-kpi-absent", safe(absent));
    setText("tch-kpi-late", safe(late));
    setText("tch-kpi-pct", pct.toFixed(2));

    renderTeacherLogTable(logs);
    applyTeacherLogFilter();
  };

  const openTeacherDashboard = async (teacherId, name) => {
    state.modal.teacherCtx = { id: teacherId, name };

    setText("tch-kpi-total", "…");
    setText("tch-kpi-present", "…");
    setText("tch-kpi-absent", "…");
    setText("tch-kpi-late", "…");
    setText("tch-kpi-pct", "…");
    setHTML("tch-log-table-body", `<tr><td colspan="6" class="center muted">جاري جلب السجل...</td></tr>`);

    renderTeacherModalHeader({ name });
    openModal("teacher-dashboard-modal");

    try {
      const params = getTeachersParams();
      const data = await apiGet(EP.teacherDetails(teacherId), params);
      renderTeacherDetails(data);
    } catch (e) {
      setHTML("tch-log-table-body", `<tr><td colspan="6" class="center muted">❌ ${safe(e.message) || "فشل جلب التفاصيل"}</td></tr>`);
    }
  };

  // =========================
  // Reset
  // =========================
  const resetStudentsFilters = () => {
    [
      "filter-stu-year","filter-stu-term","filter-stu-from","filter-stu-to",
      "filter-stu-stage","filter-stu-grade","filter-stu-section",
      "filter-stu-method","filter-stu-search" // ✅ تم إضافة method، وتم إزالة الفلاتر المعلقة لتجنب أخطاء
    ].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.value = "";
    });

    resetGradesAndSections();
    state.students.page = 1;
    state.students.limit = toInt($("stu-page-size")?.value || 25);
    state.students.sort = $("stu-sort")?.value || "name_asc";

    setHTML("students-reports-table-body", `<tr><td colspan="12" class="center muted">حدد الفلاتر ثم اضغط عرض التقرير</td></tr>`);
    renderStudentsKPIs(null, []);
    setText("students-last-refresh", "آخر تحديث: —");
    setText("students-results-count", "نتائج: —");
    setText("stu-page", "صفحة —");
  };

  const resetTeachersFilters = () => {
    [
      "filter-tch-year","filter-tch-month","filter-tch-from","filter-tch-to",
      "filter-tch-teacher","filter-tch-status","filter-tch-method","filter-tch-locked","filter-tch-search"
    ].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.value = "";
    });

    state.teachers.page = 1;
    state.teachers.limit = toInt($("tch-page-size")?.value || 25);
    state.teachers.sort = $("tch-sort")?.value || "name_asc";

    setHTML("teachers-reports-table-body", `<tr><td colspan="10" class="center muted">حدد الفلاتر ثم اضغط عرض التقرير</td></tr>`);
    renderTeachersKPIs(null, []);
    setText("teachers-last-refresh", "آخر تحديث: —");
    setText("teachers-results-count", "نتائج: —");
    setText("tch-page", "صفحة —");
  };

  // =========================
  // Export main tables CSV
  // =========================
  const exportStudentsCsv = () => {
    const rows = state.students.lastRows || [];
    if (!rows.length) return;

    const mapped = rows.map((r) => ({
      student_name: safe(r.student_name ?? r.full_name ?? r.name),
      student_code: safe(r.student_code ?? r.code ?? ""),
      grade_section: safe(r.grade_section ?? r.section_name ?? r.class_name ?? ""),
      total_sessions: toInt(r.total_sessions ?? r.total ?? 0),
      present: toInt(r.present_count ?? r.total_present ?? 0),
      absent: toInt(r.total_absent ?? 0),
      late: toInt(r.total_late ?? 0),
      excused: toInt(r.total_excused ?? 0),
      late_minutes: toInt(r.late_minutes_total ?? r.late_minutes ?? 0),
      attendance_percent: safe(r.attendance_percent ?? r.pct ?? ""),
      last_event: safe(r.last_event_date ?? r.last_date ?? r.last_event ?? ""),
    }));

    downloadCsv(`students_attendance_${Date.now()}.csv`, Object.keys(mapped[0]), mapped);
  };

  const exportTeachersCsv = () => {
    const rows = state.teachers.lastRows || [];
    if (!rows.length) return;

    const mapped = rows.map((r) => ({
      teacher_name: safe(r.teacher_name ?? r.full_name ?? r.name),
      total_days: toInt(r.total_days ?? r.total ?? 0),
      present_days: toInt(r.present_days ?? r.present ?? 0),
      absent_days: toInt(r.total_absent ?? r.absent_days ?? 0),
      late_days: toInt(r.late_days ?? r.total_late ?? 0),
      method: safe(r.method ?? r.last_method ?? ""),
      locked: (r.is_locked ?? r.locked) === null || (r.is_locked ?? r.locked) === undefined ? "" : (String(r.is_locked ?? r.locked) === "true" ? "locked" : "unlocked"),
      presence_percent: safe(r.presence_percent ?? r.pct ?? ""),
      last_event: safe(r.last_event_date ?? r.last_date ?? r.last_event ?? ""),
    }));

    downloadCsv(`teachers_attendance_${Date.now()}.csv`, Object.keys(mapped[0]), mapped);
  };

  // =========================
  // Export modal CSV (visible rows only)
  // =========================
  const exportStudentModalCsv = () => {
    const body = $("stu-log-table-body");
    if (!body) return;
    const trs = Array.from(body.querySelectorAll("tr")).filter(tr => tr.style.display !== "none");
    if (!trs.length) return;

    const rows = trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim());
      return {
        date: tds[0] || "",
        period: tds[1] || "",
        subject: tds[2] || "",
        teacher: tds[3] || "",
        status: tds[4] || "",
        reason: tds[5] || "",
        late_minutes: tds[6] || "",
        notes: tds[7] || "",
        corrected: tds[8] || "",
      };
    });

    const name = safe(state.modal.studentCtx?.name || "student").replace(/\s+/g, "_");
    downloadCsv(`student_log_${name}_${Date.now()}.csv`, Object.keys(rows[0]), rows);
  };

  const exportTeacherModalCsv = () => {
    const body = $("tch-log-table-body");
    if (!body) return;
    const trs = Array.from(body.querySelectorAll("tr")).filter(tr => tr.style.display !== "none");
    if (!trs.length) return;

    const rows = trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td")).map(td => td.textContent.trim());
      return {
        date: tds[0] || "",
        status: tds[1] || "",
        method: tds[2] || "",
        locked: tds[3] || "",
        notes: tds[4] || "",
        corrected: tds[5] || "",
      };
    });

    const name = safe(state.modal.teacherCtx?.name || "teacher").replace(/\s+/g, "_");
    downloadCsv(`teacher_log_${name}_${Date.now()}.csv`, Object.keys(rows[0]), rows);
  };

  // =========================
  // Pagination
  // =========================
  const studentsPrev = () => {
    if (state.students.page <= 1) return;
    state.students.page -= 1;
    fetchStudentsReport();
  };

  const studentsNext = () => {
    state.students.page += 1;
    fetchStudentsReport();
  };

  const teachersPrev = () => {
    if (state.teachers.page <= 1) return;
    state.teachers.page -= 1;
    fetchTeachersReport();
  };

  const teachersNext = () => {
    state.teachers.page += 1;
    fetchTeachersReport();
  };

  // =========================
  // Events binding
  // =========================
  const bindEvents = () => {
    document.addEventListener("click", (e) => {
      const tabBtn = e.target.closest("#attendance-main-tabs .tab-link");
      if (tabBtn) {
        const targetId = tabBtn.getAttribute("aria-controls") || tabBtn.getAttribute("data-tab");
        if (targetId) setActiveTab(targetId);
      }
    });

    const tabs = $("attendance-main-tabs");
    if (tabs) tabs.addEventListener("keydown", handleTabKeyNav);

    document.addEventListener("click", (e) => {
      if (e.target.closest("#btn-refresh-students")) {
        state.students.page = 1;
        fetchStudentsReport();
      }
      if (e.target.closest("#btn-reset-students")) resetStudentsFilters();
      if (e.target.closest("#btn-export-students-csv")) openStudentsSchoolReport("pdf");
      if (e.target.closest("#btn-print-students")) openStudentsSchoolReport("print");
      if (e.target.closest("#stu-prev")) studentsPrev();
      if (e.target.closest("#stu-next")) studentsNext();

      if (e.target.closest("#btn-refresh-teachers")) {
        state.teachers.page = 1;
        fetchTeachersReport();
      }
      if (e.target.closest("#btn-reset-teachers")) resetTeachersFilters();
      if (e.target.closest("#btn-export-teachers-csv")) openTeachersSchoolReport("pdf");
      if (e.target.closest("#btn-print-teachers")) openTeachersSchoolReport("print");
      if (e.target.closest("#tch-prev")) teachersPrev();
      if (e.target.closest("#tch-next")) teachersNext();

      const stuBtn = e.target.closest(".btn-stu-details");
      if (stuBtn) {
        const id = stuBtn.getAttribute("data-stu-id");
        const name = decodeSafe(stuBtn.getAttribute("data-stu-name") || "");
        const code = decodeSafe(stuBtn.getAttribute("data-stu-code") || "");
        const gs = decodeSafe(stuBtn.getAttribute("data-stu-gs") || "");
        if (id) openStudentDashboard(id, name, code, gs);
      }

      const tchBtn = e.target.closest(".btn-tch-details");
      if (tchBtn) {
        const id = tchBtn.getAttribute("data-tch-id");
        const name = decodeSafe(tchBtn.getAttribute("data-tch-name") || "");
        if (id) openTeacherDashboard(id, name);
      }

      if (e.target.closest("#btn-stu-export-csv")) exportStudentModalCsv();
      if (e.target.closest("#btn-stu-print")) window.print();
      if (e.target.closest("#btn-tch-export-csv")) exportTeacherModalCsv();
      if (e.target.closest("#btn-tch-print")) window.print();
    });

    document.addEventListener("change", (e) => {
      if (e.target?.id === "filter-stu-stage") {
        state.students.page = 1;
        loadGradesByStage(e.target.value);
      }
      if (e.target?.id === "filter-stu-grade") {
        state.students.page = 1;
        loadSectionsByGrade(e.target.value);
      }

      if (e.target?.id === "stu-sort") {
        state.students.sort = e.target.value;
        state.students.page = 1;
        fetchStudentsReport();
      }
      if (e.target?.id === "stu-page-size") {
        state.students.limit = toInt(e.target.value || 25);
        state.students.page = 1;
        fetchStudentsReport();
      }

      if (e.target?.id === "tch-sort") {
        state.teachers.sort = e.target.value;
        state.teachers.page = 1;
        fetchTeachersReport();
      }
      if (e.target?.id === "tch-page-size") {
        state.teachers.limit = toInt(e.target.value || 25);
        state.teachers.page = 1;
        fetchTeachersReport();
      }

      if (e.target?.id === "filter-tch-month") {
        setTeacherRangeFromMonth();
      }

      if (e.target?.id === "stu-log-filter") applyStudentLogFilter();
      if (e.target?.id === "tch-log-filter") applyTeacherLogFilter();
    });

    bindModalClose();
  };

  // =========================
  // Init
  // =========================
  const init = async () => {
    setActiveTab("students-rep-tab");

    const m = $("filter-tch-month");
    if (m && !m.value) m.value = new Date().toISOString().slice(0, 7);

    await loadBaseFilters();

    setText("stu-page", `صفحة ${state.students.page}`);
    setText("tch-page", `صفحة ${state.teachers.page}`);

    bindEvents();
  };

  window.attendanceReports = {
    init,
    fetchStudentsReport,
    fetchTeachersReport,
    loadBaseFilters,
    loadGradesByStage,
    loadSectionsByGrade,
    resetStudentsFilters,
    resetTeachersFilters,
  };

})();