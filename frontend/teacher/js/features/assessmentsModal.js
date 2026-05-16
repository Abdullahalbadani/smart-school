/* teacher/js/features/assessmentsModal.js */
(() => {
  "use strict";

  // =========================================================
  // Helpers
  // =========================================================
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const toast = (msg, type = "info") => {
    const fn = window.showToast || window.toast || window.Toast || null;

    if (typeof fn === "function") {
      fn(msg, type);
      return;
    }

    let el = document.getElementById("global-soft-toast");

    if (!el) {
      el = document.createElement("div");
      el.id = "global-soft-toast";
      el.style.position = "fixed";
      el.style.bottom = "24px";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.zIndex = "99999";
      el.style.padding = "10px 18px";
      el.style.borderRadius = "999px";
      el.style.fontSize = "13px";
      el.style.fontWeight = "800";
      el.style.color = "#fff";
      el.style.boxShadow = "0 16px 40px rgba(15,23,42,.28)";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      el.style.transition = "opacity .25s ease, transform .25s ease";
      document.body.appendChild(el);
    }

    el.textContent = msg || "حدث خطأ غير متوقع.";
    el.style.background =
      type === "error"
        ? "linear-gradient(135deg,#ef4444,#991b1b)"
        : type === "success"
          ? "linear-gradient(135deg,#22c55e,#15803d)"
          : "linear-gradient(135deg,#2563eb,#0f172a)";

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(-4px)";
    });

    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(0)";
    }, 2800);
  };

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;

    let cleanPath = String(path || "").replace(/^\/+/, "");

    if (cleanPath.startsWith("api/")) {
      cleanPath = cleanPath.slice(4);
    }

    return `${API_BASE}/${cleanPath}`;
  }

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("token") ||
    "";

  const api = async (method, url, body) => {
    const fullUrl = apiUrl(url);
    const currentToken = getToken();

    const headers = {
      Accept: "application/json",
    };

    if (!(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (currentToken) {
      headers.Authorization = `Bearer ${currentToken}`;
    }

    const opt = {
      method,
      credentials: "include",
      headers,
    };

    if (body !== undefined) {
      opt.body = body instanceof FormData ? body : JSON.stringify(body);
    }

    let res;

    try {
      res = await fetch(fullUrl, opt);
    } catch (_) {
      throw new Error("تعذر الاتصال بالخادم. تحقق من الاتصال أو حاول لاحقًا.");
    }

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { raw: text };
    }

    if (res.status === 401) {
      toast("انتهت الجلسة، الرجاء تسجيل الدخول مرة أخرى.", "error");

      localStorage.removeItem("token");
      localStorage.removeItem("access_token");
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user");

      setTimeout(() => {
        window.location.href = "/frontend/login/login.html";
      }, 900);

      throw new Error("انتهت الجلسة، الرجاء تسجيل الدخول مرة أخرى.");
    }

    if (res.status === 403) {
      throw new Error("لا تملك صلاحية تنفيذ هذه العملية.");
    }

    if (!res.ok) {
      const msg =
        data?.message ||
        data?.error ||
        (data?.raw ? "رد غير متوقع من الخادم." : `فشل الطلب (${res.status})`);

      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  };

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fmtDT = (value) => {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${y}-${m}-${day} ${hh}:${mm}`;
  };

  const dtLocalToISO = (value) => {
    if (!value) return null;

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    return d.toISOString();
  };

  const toLocalDatetimeValue = (value) => {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    return `${y}-${m}-${day}T${hh}:${mm}`;
  };

  const durationText = (mins) => {
    const n = Number(mins || 0);
    if (!Number.isFinite(n) || n <= 0) return "00:00:00";

    const sec = n * 60;
    const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");

    return `${hh}:${mm}:${ss}`;
  };

  const positiveNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const isAggregateType = (type) =>
    ["midterm_muhassala", "final_muhassala"].includes(String(type || ""));

  const isOfficialExamType = (type) =>
    ["monthly_exam", "midterm_exam", "final_exam"].includes(String(type || ""));

  const makeButton = (label, icon, className = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `primary-btn ${className}`.trim();
    btn.innerHTML = `<i class="${icon}"></i><span>${escapeHtml(label)}</span>`;
    return btn;
  };

  const normalizeAssessmentMeta = (item) => {
    if (!item) {
      return {
        rawType: null,
        canonicalType: null,
        examKind: null,
        aggregateKind: null,
        sequenceNo: null,
      };
    }

    const rawType = item.type || null;
    let canonicalType = item.canonical_type || item.type || null;
    let examKind = item.exam_kind || null;
    let aggregateKind = item.aggregate_kind || null;
    let sequenceNo = item.sequence_no ?? null;

    if (!item.canonical_type) {
      if (rawType === "quiz" || rawType === "monthly_exam") {
        canonicalType = "exam";
        examKind = "monthly";
        sequenceNo = sequenceNo ?? 1;
      } else if (rawType === "midterm_exam") {
        canonicalType = "exam";
        examKind = "midterm";
      } else if (rawType === "final_exam") {
        canonicalType = "exam";
        examKind = "final";
      } else if (rawType === "midterm_muhassala") {
        canonicalType = "aggregate";
        aggregateKind = "midterm";
      } else if (rawType === "final_muhassala") {
        canonicalType = "aggregate";
        aggregateKind = "final";
      }
    }

    return {
      rawType,
      canonicalType,
      examKind,
      aggregateKind,
      sequenceNo,
    };
  };

  const typeLabel = (itemOrType) => {
    if (typeof itemOrType === "string") {
      const map = {
        classwork: "نشاط صفي",
        homework: "واجب منزلي",
        quiz: "اختبار قصير",
        monthly_exam: "اختبار شهري",
        midterm_exam: "اختبار نصفي",
        final_exam: "اختبار نهائي",
        continuous_assessment: "المحصلة",
        midterm_muhassala: "محصلة النصفي",
        final_muhassala: "محصلة النهائي",
        activity: "نشاط",
        project: "مشروع",
        oral: "شفهي",
        exam: "اختبار",
        aggregate: "محصلة",
        live_online: "نشاط أونلاين مباشر",
      };

      return map[itemOrType] || itemOrType || "—";
    }

    const meta = normalizeAssessmentMeta(itemOrType);

    if (meta.canonicalType === "exam") {
      if (meta.examKind === "monthly") {
        return meta.sequenceNo ? `اختبار شهري ${meta.sequenceNo}` : "اختبار شهري";
      }

      if (meta.examKind === "midterm") return "اختبار نصفي";
      if (meta.examKind === "final") return "اختبار نهائي";

      return "اختبار";
    }

    if (meta.canonicalType === "aggregate") {
      if (meta.aggregateKind === "midterm") return "محصلة النصفي";
      if (meta.aggregateKind === "final") return "محصلة النهائي";

      return "محصلة";
    }

    return typeLabel(meta.rawType);
  };

  const modeLabel = (mode) => {
    const map = {
      in_class: "داخل الصف",
      home_submission: "واجب مع تسليم",
      home_no_submission: "واجب بدون تسليم",
      live_online: "نشاط أونلاين مباشر",
      at_home: "بالبيت",
      submission: "يتطلب تسليم",
    };

    return map[mode] || mode || "—";
  };

  const statusLabel = (status) => {
    const map = {
      draft: "مسودة",
      active: "نشط",
      published: "منشور",
      closed: "مغلق",
      reopened: "مفتوح للتعديل",
      scheduled: "مُجدول/قادم",
      running: "جارٍ الآن",
      finished: "انتهى وقت الاختبار",
      upcoming: "مُجدول",
      missing_score: "لم تضبط الدرجة",
      blocked: "ينتظر ضبط الدرجة",
    };

    return map[status] || status || "—";
  };

  const setButtonText = (btn, label) => {
    const span = btn?.querySelector("span");
    if (span) span.textContent = label;
  };

  const isVisibleOfficialContext = (ctx) => {
    if (!ctx?.matched) return false;
    return String(ctx.availability || "") !== "upcoming";
  };

  const officialStatusText = (ctx) => {
    const availability = String(ctx?.availability || "");
    const end = ctx?.ends_at_time ? String(ctx.ends_at_time).slice(0, 5) : "—";
    const start = ctx?.starts_at_time ? String(ctx.starts_at_time).slice(0, 5) : "—";

    if (availability === "missing_score") {
      return ctx?.message || "درجة الاختبار غير مضبوطة من إعدادات المدرسة.";
    }

    if (availability === "running") {
      return `الاختبار جارٍ الآن، ينتهي الساعة ${end}.`;
    }

    if (availability === "finished") {
      return "انتهى وقت الاختبار، يمكنك فتح رصد الدرجات.";
    }

    return `يبدأ الساعة ${start}.`;
  };

  const officialScheduleText = (ctx) => {
    const start = ctx?.starts_at ? fmtDT(ctx.starts_at) : "—";
    const end = ctx?.due_at ? fmtDT(ctx.due_at) : "—";
    return `بداية: ${start} • نهاية: ${end}`;
  };

  const isSameOfficialAssessment = (item, ctx) => {
    if (!item || !ctx) return false;

    const meta = normalizeAssessmentMeta(item);
    const ctxCanonical = ctx.canonical_type || "exam";
    const ctxExamKind = ctx.exam_kind || null;
    const ctxSequence = ctx.sequence_no ?? null;

    if (meta.canonicalType !== ctxCanonical) return false;
    if (ctxCanonical === "exam" && meta.examKind !== ctxExamKind) return false;

    if (ctxExamKind === "monthly") {
      return Number(meta.sequenceNo || 1) === Number(ctxSequence || 1);
    }

    return true;
  };

  const makeOfficialPreviewItem = (ctx, term, teacherAssignmentId, scope) => ({
    id: `official:${ctx.source_type}:${ctx.source_id}`,
    _official_preview: true,
    _official_context: ctx,
    teacher_assignment_id: teacherAssignmentId,
    term,
    title: ctx.title || ctx.exam_title || "اختبار رسمي",
    type: ctx.legacy_type || ctx.type || "exam",
    canonical_type: ctx.canonical_type || "exam",
    exam_kind: ctx.exam_kind || null,
    aggregate_kind: ctx.aggregate_kind || null,
    sequence_no: ctx.sequence_no ?? null,
    mode: ctx.mode || "in_class",
    max_score: ctx.max_score ?? "—",
    starts_at: ctx.starts_at || null,
    due_at: ctx.due_at || null,
    status:
      ctx.availability === "missing_score"
        ? "blocked"
        : ctx.availability === "finished"
          ? "finished"
          : "running",
    availability: ctx.availability || null,
    can_grade: ctx.can_grade === true && !!positiveNumber(ctx.max_score),
    source_type: ctx.source_type || "",
    source_id: ctx.source_id || "",
    scope_label: scope ? scopeText(scope) : "—",
    students_count: "—",
    submissions_count: "—",
  });

  const createOfficialAssessmentFromContext = async (ctx, teacherAssignmentId) => {
    if (!ctx?.can_grade) {
      throw new Error(ctx?.message || "لا يمكن فتح رصد الدرجات قبل انتهاء وقت الاختبار.");
    }

    const maxScore = positiveNumber(ctx.max_score);

    if (!maxScore) {
      throw new Error(ctx?.message || "درجة الاختبار غير مضبوطة من إعدادات المدرسة.");
    }

    const formData = new FormData();
    const title = ctx.title || ctx.exam_title || "اختبار رسمي";

    formData.append("teacher_assignment_id", String(teacherAssignmentId));
    formData.append("title", title);
    formData.append("type", ctx.legacy_type || ctx.type || "monthly_exam");
    formData.append("mode", "in_class");
    formData.append("max_score", String(maxScore));
    formData.append("description", ctx.message || "");
    formData.append("duration_minutes", ctx.duration_minutes != null ? String(ctx.duration_minutes) : "");

    if (ctx.starts_at) {
      formData.append("starts_at", dtLocalToISO(toLocalDatetimeValue(ctx.starts_at)) || ctx.starts_at);
    }

    if (ctx.due_at) {
      formData.append("due_at", dtLocalToISO(toLocalDatetimeValue(ctx.due_at)) || ctx.due_at);
    }

    formData.append("submission_kind", "none");
    formData.append("allow_late_submission", "false");
    formData.append("exam_kind", ctx.exam_kind || "");
    formData.append("is_system_generated", "true");
    formData.append("source_type", ctx.source_type || "");
    formData.append("source_id", String(ctx.source_id || ""));

    if (ctx.sequence_no != null) {
      formData.append("sequence_no", String(ctx.sequence_no));
    }

    return api("POST", "/api/teacher/assessments", formData);
  };

  // =========================================================
  // State
  // =========================================================
  const state = {
    scopesByTerm: new Map(),
    listItems: [],
    lastCreatedAssessmentId: null,
    officialExamContext: null,
    defaultModeOptionsHTML: "",
    defaultTypeOptionsHTML: "",
    liveTimer: null,
  };

  const openModal = (id) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.classList.add("is-open");
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    setTimeout(() => el.focus?.(), 0);
  };

  const closeModal = (modalEl) => {
    if (!modalEl) return;

    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }

    modalEl.classList.remove("is-open");
    modalEl.style.display = "none";
    modalEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  };

  // =========================================================
  // DOM refs
  // =========================================================
  const modal = () => qs("#modal-assessments");

  const listTabBtn = () => qs("#asm-tab-list");
  const createTabBtn = () => qs("#asm-tab-create");
  const listView = () => qs("#asm-view-list");
  const createView = () => qs("#asm-view-create");

  const filterTerm = () => qs("#asm-filter-term");
  const filterScope = () => qs("#asm-filter-scope");
  const filterType = () => qs("#asm-filter-type");
  const filterStatus = () => qs("#asm-filter-status");
  const filterSearch = () => qs("#asm-filter-search");
  const loadListBtn = () => qs("#asm-load-list");
  const openCreateBtn = () => qs("#asm-open-create");
  const tableBody = () => qs("#asm-table-body");
  const emptyState = () => qs("#asm-empty");

  const sumTotal = () => qs("#asm-sum-total");
  const sumDrafts = () => qs("#asm-sum-drafts");
  const sumPublished = () => qs("#asm-sum-published");
  const sumClosed = () => qs("#asm-sum-closed");

  const createForm = () => qs("#asm-create-form");
  const createTerm = () => qs("#asm-create-term");
  const createScope = () => qs("#asm-create-scope");
  const titleInput = () => qs("#asm-title-input");
  const typeSelect = () => qs("#asm-create-type");
  const modeSelect = () => qs("#asm-mode");
  const maxScoreInput = () => qs("#asm-max-score");
  const startAtInput = () => qs("#asm-start-at");
  const dueAtInput = () => qs("#asm-due-at");
  const durationInput = () => qs("#asm-duration-minutes");
  const submissionKind = () => qs("#asm-submission-kind");
  const latePolicy = () => qs("#asm-late-policy");
  const lateUntil = () => qs("#asm-late-until");
  const descriptionInput = () => qs("#asm-description");
  const filesInput = () => qs("#asm-files");

  const timerBadge = () => qs("#asm-timer-mode-badge");
  const timerValue = () => qs("#asm-timer-value");
  const timerHelp = () => qs("#asm-timer-help");
  const submissionSettingsBox = () => qs("#asm-submission-settings");
  const createStatusBox = () => qs("#asm-create-status");
  const saveDraftBtn = () => qs("#asm-save-draft");
  const publishBtn = () => qs("#asm-publish");
  const goToGradingBtn = () => qs("#asm-go-to-grading");
  const cancelCreateBtn = () => qs("#asm-cancel-create");
  const editIdInput = () => qs("#asm-edit-id");

  const smartContextText = () => qs("#asm-smart-context-text");
  const officialExamBox = () => qs("#asm-official-exam-box");
  const officialExamText = () => qs("#asm-official-exam-text");
  const officialSourceType = () => qs("#asm-official-source-type");
  const officialSourceId = () => qs("#asm-official-source-id");

  // =========================================================
  // Tabs
  // =========================================================
  const setTab = (tab) => {
    const isList = tab === "list";

    listTabBtn()?.classList.toggle("is-active", isList);
    createTabBtn()?.classList.toggle("is-active", !isList);

    listTabBtn()?.setAttribute("aria-selected", String(isList));
    createTabBtn()?.setAttribute("aria-selected", String(!isList));

    if (listView()) listView().hidden = !isList;
    if (createView()) createView().hidden = isList;
  };

  // =========================================================
  // Scopes
  // =========================================================
  const scopeText = (scope) => {
    const parts = [];

    if (scope.stage_name) parts.push(scope.stage_name);
    if (scope.grade_name) parts.push(scope.grade_name);
    if (scope.section_name) parts.push(`شعبة: ${scope.section_name}`);
    if (scope.subject_name) parts.push(`مادة: ${scope.subject_name}`);

    return parts.join(" • ");
  };

  const fillScopeSelect = (selectEl, items, placeholder = "— اختر —") => {
    if (!selectEl) return;

    selectEl.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);

    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = String(item.teacher_assignment_id);
      opt.textContent = scopeText(item);
      opt.dataset.scope = JSON.stringify(item);
      selectEl.appendChild(opt);
    }
  };

  const getSelectedScopeId = (selectEl) => {
    if (!selectEl?.value) return null;

    const n = Number(selectEl.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const getSelectedScopeObject = (selectEl) => {
    const opt = selectEl?.selectedOptions?.[0];

    if (!opt?.dataset?.scope) return null;

    try {
      return JSON.parse(opt.dataset.scope);
    } catch {
      return null;
    }
  };

  const loadScopesForTerm = async (term) => {
    if (!term) return [];
    if (state.scopesByTerm.has(term)) return state.scopesByTerm.get(term);

    const data = await api("GET", `/api/teacher/scopes?term=${encodeURIComponent(term)}`);
    const items = Array.isArray(data?.items) ? data.items : [];

    state.scopesByTerm.set(term, items);
    return items;
  };

  const onTermChange = async (termEl, scopeEl) => {
    if (!termEl || !scopeEl) return;

    const term = Number(termEl.value || 0) || null;

    scopeEl.disabled = true;
    fillScopeSelect(scopeEl, [], "— اختر الفصل أولًا —");

    if (!term) return;

    try {
      const items = await loadScopesForTerm(term);
      fillScopeSelect(scopeEl, items, "— اختر من نطاقاتك —");
      scopeEl.disabled = false;
    } catch (err) {
      toast(err.message || "فشل تحميل نطاقات التدريس", "error");
    }
  };

  // =========================================================
  // Official exam detection
  // =========================================================
  const restoreDefaultSelectOptions = () => {
    const typeEl = typeSelect();
    const modeEl = modeSelect();

    const currentType = typeEl?.value || "";
    const currentMode = modeEl?.value || "";

    if (typeEl && state.defaultTypeOptionsHTML && typeEl.innerHTML !== state.defaultTypeOptionsHTML) {
      typeEl.innerHTML = state.defaultTypeOptionsHTML;

      if (currentType && Array.from(typeEl.options).some((o) => o.value === currentType)) {
        typeEl.value = currentType;
      }
    }

    if (modeEl && state.defaultModeOptionsHTML && modeEl.innerHTML !== state.defaultModeOptionsHTML) {
      modeEl.innerHTML = state.defaultModeOptionsHTML;

      if (currentMode && Array.from(modeEl.options).some((o) => o.value === currentMode)) {
        modeEl.value = currentMode;
      }
    }
  };

  const clearOfficialContext = () => {
    state.officialExamContext = null;

    if (officialExamBox()) officialExamBox().style.display = "none";
    if (officialExamText()) officialExamText().textContent = "";
    if (officialSourceType()) officialSourceType().value = "";
    if (officialSourceId()) officialSourceId().value = "";

    if (typeSelect()) typeSelect().disabled = false;
    if (createScope()) createScope().disabled = false;
    if (maxScoreInput()) maxScoreInput().disabled = false;
    if (startAtInput()) startAtInput().disabled = false;
    if (dueAtInput()) dueAtInput().disabled = false;
    if (durationInput()) durationInput().disabled = false;
    if (saveDraftBtn()) saveDraftBtn().disabled = false;
    if (publishBtn()) publishBtn().disabled = false;

    restoreDefaultSelectOptions();
  };

  const tryDetectOfficialExam = async () => {
    clearOfficialContext();

    const term = Number(createTerm()?.value || 0) || null;
    const teacher_assignment_id = getSelectedScopeId(createScope());

    if (!term || !teacher_assignment_id) {
      applyCreateRules();
      return;
    }

    try {
      const data = await api(
        "GET",
        `/api/teacher/assessments/official-context?term=${encodeURIComponent(term)}&teacher_assignment_id=${encodeURIComponent(teacher_assignment_id)}`
      );

      if (!isVisibleOfficialContext(data)) {
        applyCreateRules();
        return;
      }

      state.officialExamContext = data;

      if (officialExamBox()) officialExamBox().style.display = "";
      if (officialExamText()) officialExamText().textContent = data.message || officialStatusText(data);
      if (officialSourceType()) officialSourceType().value = data.source_type || "";
      if (officialSourceId()) officialSourceId().value = data.source_id ? String(data.source_id) : "";

      if (startAtInput()) {
        startAtInput().value = toLocalDatetimeValue(
          data.starts_at || data.start_at || data.exam_starts_at || ""
        );
      }

      if (dueAtInput()) {
        dueAtInput().value = toLocalDatetimeValue(
          data.due_at || data.end_at || data.exam_ends_at || ""
        );
      }

      if (durationInput()) {
        if (data.duration_minutes != null) {
          durationInput().value = String(data.duration_minutes);
        } else {
          const s = new Date(data.starts_at || data.start_at || data.exam_starts_at || "");
          const e = new Date(data.due_at || data.end_at || data.exam_ends_at || "");

          if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s) {
            durationInput().value = String(Math.round((e - s) / 60000));
          }
        }
      }

      if (maxScoreInput()) {
        const maxScore = positiveNumber(data.max_score);
        maxScoreInput().value = maxScore ? String(maxScore) : "";
      }

      if (titleInput() && !String(titleInput().value || "").trim()) {
        const detectedTitle = String(data.title || data.exam_title || "").trim();

        titleInput().value =
          detectedTitle ||
          typeLabel({
            type: data.legacy_type || data.type,
            canonical_type: data.canonical_type,
            exam_kind: data.exam_kind,
            sequence_no: data.sequence_no,
          });
      }

      const selectEl = typeSelect();

      if (selectEl && (data.legacy_type || data.type)) {
        const targetType = data.legacy_type || data.type;
        const opt = Array.from(selectEl.options).find((o) => o.value === targetType);

        if (opt) {
          opt.disabled = false;
          opt.removeAttribute("disabled");
          selectEl.value = targetType;
        }
      }

      applyCreateRules();
    } catch (_) {
      applyCreateRules();
    }
  };

  // =========================================================
  // Create UI rules
  // =========================================================
  const updateSmartContextText = () => {
    const scope = getSelectedScopeObject(createScope());

    if (!scope || !smartContextText()) {
      if (smartContextText()) {
        smartContextText().textContent =
          "اختر النطاق أولًا، وسيتم بناء التقييم داخل المادة والشعبة الخاصة بك.";
      }

      return;
    }

    smartContextText().textContent = `النطاق الحالي: ${scopeText(scope)}.`;
  };

  const updateTimerPreview = () => {
    const type = String(typeSelect()?.value || "");
    const mode = String(modeSelect()?.value || "");
    const duration = Number(durationInput()?.value || 0);

    let badge = "غير مفعّل";
    let help = "سيتم تجهيز العداد أو نافذة التسليم حسب نوع التقييم.";
    let value = "00:00:00";

    if (["classwork", "monthly_exam", "midterm_exam", "final_exam"].includes(type) || mode === "in_class") {
      badge = "عداد مباشر";
      value = durationText(duration || 20);
      help = "يبدأ التقييم في الوقت المحدد ويستمر حسب المدة المختارة.";
    } else if (mode === "home_submission") {
      badge = "نافذة تسليم";
      value = "فتح/إغلاق";
      help = "يقبل تسليمًا إلكترونيًا مع إمكانية ضبط التأخير إن لزم.";
    } else if (mode === "live_online" || type === "live_online") {
      badge = "جلسة أونلاين";
      value = durationText(duration || 30);
      help = "نشاط مباشر بزمن محدد.";
    }

    if (timerBadge()) timerBadge().textContent = badge;
    if (timerValue()) timerValue().textContent = value;
    if (timerHelp()) timerHelp().textContent = help;
  };

  const applyCreateRules = () => {
    const currentType = String(typeSelect()?.value || "");
    const currentMode = String(modeSelect()?.value || "");
    const isOfficialLocked = !!state.officialExamContext?.matched;

    if (!isOfficialLocked) {
      restoreDefaultSelectOptions();

      if (typeSelect() && currentType && Array.from(typeSelect().options).some((o) => o.value === currentType)) {
        typeSelect().value = currentType;
      }

      if (modeSelect() && currentMode && Array.from(modeSelect().options).some((o) => o.value === currentMode)) {
        modeSelect().value = currentMode;
      }
    }

    const type = String(typeSelect()?.value || "");
    const modeSelectEl = modeSelect();
    const modeField = modeSelectEl?.closest(".field");
    const submissionBox = submissionSettingsBox();
    const startAtField = startAtInput()?.closest(".field");
    const dueAtField = dueAtInput()?.closest(".field");
    const filesField = filesInput()?.closest(".field");
    const descField = descriptionInput()?.closest(".field");
    const maxScoreField = maxScoreInput()?.closest(".field");
    const saveBtnSpan = qs("#asm-save-draft span");

    if (typeSelect()) typeSelect().disabled = false;
    if (createScope()) createScope().disabled = false;
    if (maxScoreInput()) maxScoreInput().disabled = false;
    if (maxScoreInput()) maxScoreInput().placeholder = "مثال: 10";
    if (startAtInput()) startAtInput().disabled = false;
    if (dueAtInput()) dueAtInput().disabled = false;
    if (durationInput()) durationInput().disabled = false;
    if (saveDraftBtn()) saveDraftBtn().disabled = false;
    if (publishBtn()) publishBtn().disabled = false;

    if (modeField) modeField.style.display = "";
    if (submissionBox) submissionBox.style.display = "none";
    if (startAtField) startAtField.style.display = "";
    if (dueAtField) dueAtField.style.display = "";
    if (filesField) filesField.style.display = "";
    if (descField) descField.style.display = "";
    if (maxScoreField) maxScoreField.style.display = "";
    if (publishBtn()) publishBtn().style.display = "inline-flex";
    if (saveBtnSpan) saveBtnSpan.textContent = "حفظ كمسودة";

    if (type && !modeSelectEl?.value) {
      modeSelectEl.value = "in_class";
    }

    if (type === "classwork") {
      if (modeField) modeField.style.display = "none";
      if (submissionBox) submissionBox.style.display = "none";
      if (startAtField) startAtField.style.display = "none";
      if (dueAtField) dueAtField.style.display = "none";
      if (filesField) filesField.style.display = "none";

      if (modeSelectEl) modeSelectEl.value = "in_class";

      if (publishBtn()) publishBtn().style.display = "none";
      if (saveBtnSpan) saveBtnSpan.textContent = "بدء النشاط";
    } else if (type === "homework") {
      if (modeSelectEl) {
        modeSelectEl.innerHTML = `
          <option value="home_submission">واجب مع تسليم إلكتروني</option>
          <option value="home_no_submission">واجب بدون تسليم</option>
        `;

        if (!["home_submission", "home_no_submission"].includes(modeSelectEl.value)) {
          modeSelectEl.value = "home_submission";
        }
      }

      if (submissionBox) {
        submissionBox.style.display = modeSelectEl?.value === "home_submission" ? "" : "none";
      }
    } else if (type === "live_online") {
      if (modeField) modeField.style.display = "none";
      if (submissionBox) submissionBox.style.display = "none";
      if (modeSelectEl) modeSelectEl.value = "live_online";
    } else if (isAggregateType(type)) {
      if (modeField) modeField.style.display = "none";
      if (submissionBox) submissionBox.style.display = "none";
      if (filesField) filesField.style.display = "none";
      if (startAtField) startAtField.style.display = "none";
      if (dueAtField) dueAtField.style.display = "none";

      if (modeSelectEl) modeSelectEl.value = "in_class";

      if (maxScoreInput()) {
        maxScoreInput().value = "";
        maxScoreInput().placeholder = "تؤخذ من إعدادات المدرسة";
        maxScoreInput().disabled = true;
      }

      if (publishBtn()) publishBtn().style.display = "none";

      if (saveBtnSpan) {
        saveBtnSpan.textContent =
          type === "midterm_muhassala" ? "حفظ محصلة النصفي" : "حفظ محصلة النهائي";
      }
    } else if (isOfficialExamType(type) && state.officialExamContext?.matched) {
      if (modeField) modeField.style.display = "none";
      if (submissionBox) submissionBox.style.display = "none";
      if (filesField) filesField.style.display = "none";

      if (modeSelectEl) modeSelectEl.value = "in_class";
      if (typeSelect()) typeSelect().disabled = true;
      if (createScope()) createScope().disabled = true;
      if (maxScoreInput()) maxScoreInput().disabled = true;
      if (startAtInput()) startAtInput().disabled = true;
      if (dueAtInput()) dueAtInput().disabled = true;
      if (durationInput()) durationInput().disabled = true;

      if (publishBtn()) publishBtn().style.display = "none";

      const canOpenOfficialGrades =
        state.officialExamContext?.can_grade === true &&
        !!positiveNumber(state.officialExamContext?.max_score);

      if (saveDraftBtn()) {
        saveDraftBtn().disabled = !canOpenOfficialGrades;
        saveDraftBtn().style.display = "inline-flex";
        saveDraftBtn().title = canOpenOfficialGrades
          ? "فتح رصد درجات الاختبار"
          : officialStatusText(state.officialExamContext);
      }

      if (saveBtnSpan) {
        saveBtnSpan.textContent = canOpenOfficialGrades
          ? "فتح رصد درجات الاختبار"
          : "ينتظر انتهاء الاختبار";
      }
    }

    if (
      modeSelectEl?.value === "home_submission" &&
      submissionBox &&
      submissionBox.style.display === "none" &&
      type !== "classwork"
    ) {
      submissionBox.style.display = "";
    }

    updateTimerPreview();
  };

  const showCreateStatus = (message = "", visible = true) => {
    const el = createStatusBox();

    if (!el) return;

    el.textContent = message;
    el.style.display = visible ? "" : "none";
  };

  const resetCreateForm = () => {
    clearOfficialContext();

    titleInput() && (titleInput().value = "");
    descriptionInput() && (descriptionInput().value = "");
    typeSelect() && (typeSelect().value = "");
    modeSelect() && (modeSelect().value = "");
    maxScoreInput() && (maxScoreInput().value = "10");
    startAtInput() && (startAtInput().value = "");
    dueAtInput() && (dueAtInput().value = "");
    durationInput() && (durationInput().value = "");
    submissionKind() && (submissionKind().value = "none");
    latePolicy() && (latePolicy().value = "no");
    lateUntil() && (lateUntil().value = "");
    filesInput() && (filesInput().value = "");
    editIdInput() && (editIdInput().value = "");

    showCreateStatus("", false);

    if (createForm()) {
      createForm().style.display = "";
    }

    updateSmartContextText();
    applyCreateRules();
  };

  // =========================================================
  // List
  // =========================================================
  const updateListSummary = (items) => {
    const total = items.length;
    const drafts = items.filter((x) => x.status === "draft").length;
    const published = items.filter((x) => x.status === "published" || x.status === "active").length;
    const closed = items.filter((x) => x.status === "closed").length;

    if (sumTotal()) sumTotal().textContent = String(total);
    if (sumDrafts()) sumDrafts().textContent = String(drafts);
    if (sumPublished()) sumPublished().textContent = String(published);
    if (sumClosed()) sumClosed().textContent = String(closed);
  };

  const attachOfficialContextToList = async (items, { term, teacher_assignment_id }) => {
    if (!term || !teacher_assignment_id) return items;

    try {
      const data = await api(
        "GET",
        `/api/teacher/assessments/official-context?term=${encodeURIComponent(term)}&teacher_assignment_id=${encodeURIComponent(teacher_assignment_id)}`
      );

      if (!isVisibleOfficialContext(data)) {
        return items;
      }

      if (items.some((item) => isSameOfficialAssessment(item, data))) {
        return items;
      }

      const scope = getSelectedScopeObject(filterScope());
      return [makeOfficialPreviewItem(data, term, teacher_assignment_id, scope), ...items];
    } catch (_) {
      return items;
    }
  };

  const renderAssessmentRows = (items) => {
    const tbody = tableBody();
    const empty = emptyState();

    if (!tbody || !empty) return;

    tbody.innerHTML = "";
    updateListSummary(items);

    if (!items.length) {
      empty.style.display = "";
      return;
    }

    empty.style.display = "none";

    const selectedTerm = Number(filterTerm()?.value || 0) || null;
    const selectedScopeId = getSelectedScopeId(filterScope());

    for (const item of items) {
      const tr = document.createElement("tr");

      const isOfficialPreview = item._official_preview === true;
      const schedule = isOfficialPreview
        ? officialScheduleText(item._official_context)
        : item.starts_at || item.due_at
          ? `${item.starts_at ? `بداية: ${fmtDT(item.starts_at)}` : ""}${item.starts_at && item.due_at ? " • " : ""}${item.due_at ? `آخر موعد: ${fmtDT(item.due_at)}` : ""}`
          : "—";

      const scopeLabel =
        item.scope_label ||
        item.scope ||
        [item.stage_name, item.grade_name, item.section_name, item.subject_name].filter(Boolean).join(" • ") ||
        "—";

      const submissionsLabel =
        item.submissions_count !== undefined
          ? `${item.submissions_count}/${item.students_count || "—"}`
          : "—";

      const isOfficialExam = item.status === "scheduled" || isOfficialPreview;

      if (isOfficialExam) {
        tr.style.backgroundColor = "rgba(14, 165, 233, 0.05)";
      }

      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(item.title || "")}</strong>
          ${
            isOfficialExam
              ? '<span title="اختبار رسمي من الجدول" style="color:#0ea5e9; font-size:0.8rem; margin-right:4px;"><i class="ri-shield-star-line"></i></span>'
              : ""
          }
          ${
            isOfficialPreview
              ? `<div class="muted" style="font-size:.8rem;margin-top:.25rem;">${escapeHtml(officialStatusText(item._official_context))}</div>`
              : ""
          }
        </td>
        <td>${escapeHtml(typeLabel(item))}</td>
        <td>${escapeHtml(scopeLabel)}</td>
        <td>${escapeHtml(modeLabel(item.mode))}</td>
        <td>${escapeHtml(String(item.max_score ?? "—"))}</td>
        <td>${escapeHtml(schedule)}</td>
        <td>${escapeHtml(String(submissionsLabel))}</td>
        <td>
          <span class="ss-badge ${
            item.status === "active" || item.status === "finished"
              ? "ss-badge--success"
              : item.status === "scheduled" || item.status === "running"
                ? "ss-badge--info"
                : ""
          }">
            ${escapeHtml(statusLabel(item.status))}
          </span>
        </td>
        <td></td>
      `;

      const tdActions = tr.lastElementChild;
      const wrap = document.createElement("div");

      wrap.style.display = "flex";
      wrap.style.gap = ".35rem";
      wrap.style.flexWrap = "wrap";

      const gradesBtn = makeButton("الدرجات", "ri-bar-chart-2-line");
      const publishBtnEl = makeButton("نشر", "ri-megaphone-line", "primary-btn--success");
      const closeBtn = makeButton("إغلاق", "ri-lock-2-line", "primary-btn--danger");

      if (isOfficialExam) {
        publishBtnEl.style.display = "none";
        closeBtn.style.display = "none";
        gradesBtn.title = isOfficialPreview
          ? officialStatusText(item._official_context)
          : "رصد درجات الاختبار الرسمي.";
      }

      if (isOfficialPreview) {
        const canOpen = item.can_grade === true;

        setButtonText(
          gradesBtn,
          item.availability === "missing_score" || item.status === "blocked"
            ? "اضبط الدرجة"
            : canOpen
              ? "فتح الدرجات"
              : "جارٍ الاختبار"
        );

        gradesBtn.disabled = !canOpen;

        gradesBtn.addEventListener("click", async () => {
          try {
            gradesBtn.disabled = true;
            setButtonText(gradesBtn, "جارٍ التجهيز...");

            const created = await createOfficialAssessmentFromContext(
              item._official_context,
              item.teacher_assignment_id || selectedScopeId
            );

            const assessmentId = Number(created?.id || 0) || null;

            if (!assessmentId) {
              throw new Error("تعذر تجهيز الاختبار الرسمي.");
            }

            toast("تم تجهيز الاختبار الرسمي، سيتم فتح رصد الدرجات.", "success");
            await loadList();

            window.dispatchEvent(
              new CustomEvent("teacher:openGradesForAssessment", {
                detail: {
                  term: selectedTerm || item.term || null,
                  teacher_assignment_id: item.teacher_assignment_id || selectedScopeId || null,
                  assessment_id: assessmentId,
                },
              })
            );
          } catch (err) {
            toast(err.message || "فشل تجهيز الاختبار الرسمي", "error");
            gradesBtn.disabled = false;
            setButtonText(gradesBtn, "فتح الدرجات");
          }
        });
      } else {
        gradesBtn.addEventListener("click", () => {
          window.dispatchEvent(
            new CustomEvent("teacher:openGradesForAssessment", {
              detail: {
                term: selectedTerm || item.term || null,
                teacher_assignment_id: item.teacher_assignment_id || selectedScopeId || null,
                assessment_id: Number(item.id),
              },
            })
          );
        });
      }

      publishBtnEl.disabled =
        item.status === "published" ||
        item.status === "closed" ||
        item.status === "scheduled";

      publishBtnEl.addEventListener("click", async () => {
        try {
          publishBtnEl.disabled = true;
          await api("POST", `/api/teacher/assessments/${item.id}/publish`);
          toast("تم نشر التقييم.", "success");
          await loadList();
        } catch (err) {
          toast(err.message || "فشل نشر التقييم", "error");
          publishBtnEl.disabled = false;
        }
      });

      closeBtn.disabled = item.status !== "published";

      closeBtn.addEventListener("click", async () => {
        try {
          closeBtn.disabled = true;
          await api("POST", `/api/teacher/assessments/${item.id}/close`);
          toast("تم إغلاق التقييم.", "success");
          await loadList();
        } catch (err) {
          toast(err.message || "فشل إغلاق التقييم", "error");
          closeBtn.disabled = false;
        }
      });

      wrap.appendChild(gradesBtn);
      wrap.appendChild(publishBtnEl);
      wrap.appendChild(closeBtn);

      tdActions.appendChild(wrap);
      tbody.appendChild(tr);
    }
  };

  const loadList = async () => {
    const term = Number(filterTerm()?.value || 0) || null;
    const teacher_assignment_id = getSelectedScopeId(filterScope());
    const type = String(filterType()?.value || "all");
    const status = String(filterStatus()?.value || "all");
    const q = String(filterSearch()?.value || "").trim();

    if (!term) return toast("اختر الفصل الدراسي أولًا.", "error");
    if (!teacher_assignment_id) return toast("اختر نطاق التدريس.", "error");

    const params = new URLSearchParams();

    params.set("teacher_assignment_id", String(teacher_assignment_id));
    params.set("status", status);

    if (type && type !== "all") params.set("type", type);
    if (q) params.set("q", q);

    try {
      if (loadListBtn()) loadListBtn().disabled = true;

      const data = await api("GET", `/api/teacher/assessments?${params.toString()}`);
      const baseItems = Array.isArray(data?.items) ? data.items : [];
      const items = await attachOfficialContextToList(baseItems, { term, teacher_assignment_id });

      state.listItems = items;
      renderAssessmentRows(items);
    } catch (err) {
      toast(err.message || "فشل تحميل التقييمات", "error");
      renderAssessmentRows([]);
    } finally {
      if (loadListBtn()) loadListBtn().disabled = false;
    }
  };

  // =========================================================
  // Create / publish
  // =========================================================
  const buildCreatePayload = () => {
    const formData = new FormData();

    const teacher_assignment_id = getSelectedScopeId(createScope());
    const title = String(titleInput()?.value || "").trim();
    const type = String(typeSelect()?.value || "").trim();
    const mode = String(modeSelect()?.value || "").trim();
    const maxScoreRaw = String(maxScoreInput()?.value || "").trim();
    const max_score = maxScoreRaw ? Number(maxScoreRaw) : null;
    const isAggregate = isAggregateType(type);

    if (!teacher_assignment_id) throw new Error("اختر نطاق التدريس.");
    if (!title) throw new Error("عنوان التقييم مطلوب.");
    if (!type) throw new Error("نوع التقييم مطلوب.");
    if (!mode) throw new Error("طريقة التنفيذ مطلوبة.");

    if (!isAggregate && (!Number.isFinite(max_score) || max_score <= 0)) {
      throw new Error("الدرجة النهائية غير صحيحة.");
    }

    formData.append("teacher_assignment_id", String(teacher_assignment_id));
    formData.append("title", title);
    formData.append("type", type);
    formData.append("mode", mode);

    if (Number.isFinite(max_score) && max_score > 0) {
      formData.append("max_score", String(max_score));
    }

    formData.append("description", String(descriptionInput()?.value || "").trim());
    formData.append("duration_minutes", durationInput()?.value || "");

    const starts_at = dtLocalToISO(startAtInput()?.value || "");
    const due_at = dtLocalToISO(dueAtInput()?.value || "");

    if (starts_at) formData.append("starts_at", starts_at);
    if (due_at) formData.append("due_at", due_at);

    const files = filesInput()?.files;

    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i += 1) {
        formData.append("files", files[i]);
      }
    }

    formData.append(
      "submission_kind",
      mode === "home_submission" ? String(submissionKind()?.value || "mixed") : "none"
    );

    formData.append(
      "allow_late_submission",
      mode === "home_submission" && String(latePolicy()?.value || "no") === "soft" ? "true" : "false"
    );

    const lateUntilValue = String(lateUntil()?.value || "").trim();

    if (lateUntilValue) {
      formData.append("late_until", dtLocalToISO(lateUntilValue) || lateUntilValue);
    }

    if (state.officialExamContext?.canonical_type === "exam") {
      if (state.officialExamContext.can_grade !== true) {
        throw new Error(state.officialExamContext.message || "لا يمكن فتح رصد الدرجات قبل انتهاء وقت الاختبار.");
      }

      const officialMaxScore = positiveNumber(state.officialExamContext.max_score);

      if (!officialMaxScore) {
        throw new Error(state.officialExamContext.message || "درجة الاختبار غير مضبوطة من إعدادات المدرسة.");
      }

      formData.append("exam_kind", state.officialExamContext.exam_kind || "");
      formData.append("is_system_generated", "true");
      formData.append("source_type", state.officialExamContext.source_type || officialSourceType()?.value || "");
      formData.append("source_id", String(state.officialExamContext.source_id || officialSourceId()?.value || ""));

      if (state.officialExamContext.sequence_no != null) {
        formData.append("sequence_no", String(state.officialExamContext.sequence_no));
      }
    }

    return formData;
  };

  const maybeWarnAboutFiles = () => {
    const files = filesInput()?.files;

    if (files && files.length) {
      toast("تم إنشاء التقييم مع المرفقات المرفوعة.", "info");
    }
  };

  const createAssessment = async (publishAfter = false) => {
    const payload = buildCreatePayload();

    showCreateStatus("جارٍ حفظ التقييم والمرفقات...", true);

    const created = await api("POST", "/api/teacher/assessments", payload);

    state.lastCreatedAssessmentId = Number(created?.id || 0) || null;

    if (editIdInput()) {
      editIdInput().value = String(state.lastCreatedAssessmentId || "");
    }

    maybeWarnAboutFiles();

    if (publishAfter && state.lastCreatedAssessmentId) {
      showCreateStatus("جارٍ نشر التقييم...", true);
      await api("POST", `/api/teacher/assessments/${state.lastCreatedAssessmentId}/publish`);
    }

    showCreateStatus(publishAfter ? "تم حفظ التقييم ونشره." : "تم حفظ التقييم كمسودة.", true);

    return created;
  };

  const uniqueTerms = () => {
    const values = [
      Number(filterTerm()?.value || 0),
      Number(createTerm()?.value || 0),
      1,
      2,
    ].filter((x) => Number.isFinite(x) && x > 0);

    return [...new Set(values)];
  };

  const findCurrentOfficialExam = async () => {
    const terms = uniqueTerms();

    for (const term of terms) {
      const scopes = await loadScopesForTerm(term);

      for (const scope of scopes) {
        const teacherAssignmentId = Number(scope.teacher_assignment_id || 0);

        if (!teacherAssignmentId) continue;

        try {
          const data = await api(
            "GET",
            `/api/teacher/assessments/official-context?term=${encodeURIComponent(term)}&teacher_assignment_id=${encodeURIComponent(teacherAssignmentId)}`
          );

          if (isVisibleOfficialContext(data)) {
            return {
              term,
              scope,
              teacher_assignment_id: teacherAssignmentId,
              context: data,
            };
          }
        } catch (_) {
          // تجاهل الفحص الفاشل لهذا النطاق وجرب النطاق التالي
        }
      }
    }

    return null;
  };

  const selectTermAndScope = async (termEl, scopeEl, term, teacherAssignmentId) => {
    if (!termEl || !scopeEl) return;

    termEl.value = String(term);
    await onTermChange(termEl, scopeEl);
    scopeEl.value = String(teacherAssignmentId);
  };

  const autoShowCurrentOfficialExam = async ({ preferCreate = false } = {}) => {
    const found = await findCurrentOfficialExam();

    if (!found) {
      return false;
    }

    await selectTermAndScope(
      filterTerm(),
      filterScope(),
      found.term,
      found.teacher_assignment_id
    );

    await selectTermAndScope(
      createTerm(),
      createScope(),
      found.term,
      found.teacher_assignment_id
    );

    state.officialExamContext = found.context;

    if (preferCreate) {
      setTab("create");
      updateSmartContextText();
      await tryDetectOfficialExam();
      return true;
    }

    setTab("list");
    await loadList();
    return true;
  };

  // =========================================================
  // Events
  // =========================================================
  const bindModalClose = () => {
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
  };

  const bindTabs = () => {
    listTabBtn()?.addEventListener("click", () => setTab("list"));
    createTabBtn()?.addEventListener("click", () => setTab("create"));

    openCreateBtn()?.addEventListener("click", async () => {
      const prefillTerm = filterTerm()?.value || "";
      const prefillScope = filterScope()?.value || "";

      resetCreateForm();

      if (!prefillTerm || !prefillScope) {
        const shownOfficial = await autoShowCurrentOfficialExam({ preferCreate: true });

        if (shownOfficial) return;
      }

      setTab("create");

      if (prefillTerm && createTerm()) {
        createTerm().value = prefillTerm;
        await onTermChange(createTerm(), createScope());
      }

      if (prefillScope && createScope()) {
        createScope().value = prefillScope;
      }

      updateSmartContextText();
      await tryDetectOfficialExam();
    });

    cancelCreateBtn()?.addEventListener("click", () => {
      setTab("list");
    });
  };

  const bindFilters = () => {
    filterTerm()?.addEventListener("change", () => onTermChange(filterTerm(), filterScope()));

    createTerm()?.addEventListener("change", async () => {
      await onTermChange(createTerm(), createScope());
      updateSmartContextText();
      await tryDetectOfficialExam();
    });

    createScope()?.addEventListener("change", async () => {
      updateSmartContextText();
      await tryDetectOfficialExam();
    });

    [typeSelect(), modeSelect(), latePolicy(), durationInput()].forEach((el) => {
      el?.addEventListener("change", applyCreateRules);
      el?.addEventListener("input", applyCreateRules);
    });
  };

  const bindListActions = () => {
    loadListBtn()?.addEventListener("click", loadList);

    filterSearch()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadList().catch(() => {});
      }
    });
  };

  const bindCreateActions = () => {
    createForm()?.addEventListener("submit", (e) => e.preventDefault());

    saveDraftBtn()?.addEventListener("click", async () => {
      const type = typeSelect()?.value;
      const duration = Number(durationInput()?.value || 0);

      if (type === "classwork" && duration > 0) {
        if (!getSelectedScopeId(createScope())) {
          return toast("اختر نطاق التدريس أولًا", "error");
        }

        if (!titleInput()?.value) {
          return toast("أدخل عنوان النشاط", "error");
        }

        if (createForm()) createForm().style.display = "none";

        const statusBox = createStatusBox();

        if (statusBox) {
          statusBox.style.display = "block";
          statusBox.style.padding = "4rem 1rem";
          statusBox.style.textAlign = "center";
          statusBox.style.borderRadius = "12px";
          statusBox.style.backgroundColor = "#f8fafc";
          statusBox.style.border = "2px dashed var(--color-primary)";
        }

        let seconds = duration * 60;

        if (state.liveTimer) {
          clearInterval(state.liveTimer);
          state.liveTimer = null;
        }

        state.liveTimer = setInterval(async () => {
          const m = Math.floor(seconds / 60).toString().padStart(2, "0");
          const s = (seconds % 60).toString().padStart(2, "0");
          const color = seconds <= 60 ? "#ef4444" : "#f59e0b";

          if (statusBox) {
            statusBox.innerHTML = `
              <h2 style="font-size: 2rem; color: var(--color-primary); margin-bottom: 1rem;">النشاط مستمر الآن...</h2>
              <div style="font-size: 6rem; font-weight: 900; color: ${color}; font-family: monospace; letter-spacing: 5px;">
                ${m}:${s}
              </div>
              <p class="muted" style="margin-top: 1.5rem; font-size: 1.2rem;">
                عند انتهاء الوقت سيتم الحفظ تلقائيًا والانتقال إلى رصد الدرجات.
              </p>
            `;
          }

          if (seconds <= 0) {
            clearInterval(state.liveTimer);
            state.liveTimer = null;

            if (statusBox) {
              statusBox.innerHTML = `<h2 style="font-size: 2rem; color: #10b981;">انتهى الوقت! جارٍ حفظ النشاط...</h2>`;
            }

            try {
              await createAssessment(false);
              toast("تم حفظ النشاط الصفي بنجاح", "success");
              goToGradingBtn()?.click();
              closeModal(modal());
            } catch (err) {
              toast(err.message || "حدث خطأ أثناء الحفظ التلقائي", "error");

              if (createForm()) createForm().style.display = "";
              if (statusBox) statusBox.style.display = "none";
            }
          }

          seconds -= 1;
        }, 1000);

        return;
      }

      try {
        if (saveDraftBtn()) saveDraftBtn().disabled = true;
        if (publishBtn()) publishBtn().disabled = true;

        await createAssessment(false);

        if (state.officialExamContext?.matched) {
          toast("تم تجهيز الاختبار الرسمي، سيتم فتح رصد الدرجات.", "success");
          goToGradingBtn()?.click();
          return;
        }

        toast("تم حفظ التقييم كمسودة.", "success");
        setTab("list");
        await loadList();
      } catch (err) {
        toast(err.message || "فشل حفظ التقييم", "error");
        showCreateStatus(err.message || "فشل حفظ التقييم", true);
      } finally {
        if (saveDraftBtn()) saveDraftBtn().disabled = false;
        if (publishBtn()) publishBtn().disabled = false;
        applyCreateRules();
      }
    });

    publishBtn()?.addEventListener("click", async () => {
      try {
        if (saveDraftBtn()) saveDraftBtn().disabled = true;
        if (publishBtn()) publishBtn().disabled = true;

        await createAssessment(true);

        toast("تم نشر التقييم.", "success");
        setTab("list");
        await loadList();
      } catch (err) {
        toast(err.message || "فشل نشر التقييم", "error");
        showCreateStatus(err.message || "فشل نشر التقييم", true);
      } finally {
        if (saveDraftBtn()) saveDraftBtn().disabled = false;
        if (publishBtn()) publishBtn().disabled = false;
      }
    });

    goToGradingBtn()?.addEventListener("click", () => {
      const assessmentId = state.lastCreatedAssessmentId || Number(editIdInput()?.value || 0) || null;
      const teacher_assignment_id = getSelectedScopeId(createScope());
      const term = Number(createTerm()?.value || 0) || null;

      if (!assessmentId || !teacher_assignment_id || !term) {
        return toast("احفظ التقييم أولًا ثم انتقل إلى رصد الدرجات.", "error");
      }

      window.dispatchEvent(
        new CustomEvent("teacher:openGradesForAssessment", {
          detail: {
            term,
            teacher_assignment_id,
            assessment_id: assessmentId,
          },
        })
      );
    });
  };

  // =========================================================
  // Public API
  // =========================================================
  const openList = async () => {
    openModal("modal-assessments");
    setTab("list");

    const shownOfficial = await autoShowCurrentOfficialExam();

    if (!shownOfficial && filterTerm()?.value && filterScope()?.value) {
      await loadList();
    }
  };

  const openCreate = async (prefill = {}) => {
    openModal("modal-assessments");
    resetCreateForm();

    if (!prefill.term && !prefill.teacher_assignment_id) {
      const shownOfficial = await autoShowCurrentOfficialExam({ preferCreate: true });

      if (shownOfficial) {
        return;
      }
    }

    setTab("create");

    if (prefill.term && createTerm()) {
      createTerm().value = String(prefill.term);
      await onTermChange(createTerm(), createScope());
    }

    if (prefill.teacher_assignment_id && createScope()) {
      createScope().value = String(prefill.teacher_assignment_id);
    }

    updateSmartContextText();
    await tryDetectOfficialExam();
  };

  let autoOfficialScanRunning = false;
  let autoOfficialScanDoneForOpen = false;

  const isAssessmentsModalOpen = () => {
    const m = modal();

    if (!m) return false;

    return (
      m.classList.contains("is-open") ||
      m.getAttribute("aria-hidden") === "false" ||
      getComputedStyle(m).display !== "none"
    );
  };

  const runAutoOfficialScanOnOpen = async () => {
    if (autoOfficialScanRunning) return;
    if (autoOfficialScanDoneForOpen) return;
    if (!isAssessmentsModalOpen()) return;

    autoOfficialScanRunning = true;

    try {
      await autoShowCurrentOfficialExam({ preferCreate: false });
      autoOfficialScanDoneForOpen = true;
    } catch (_) {
      // لا نوقف فتح المودال إذا فشل الفحص التلقائي
    } finally {
      autoOfficialScanRunning = false;
    }
  };

  const watchAssessmentsModalOpen = () => {
    const m = modal();

    if (!m) return;

    const observer = new MutationObserver(() => {
      if (isAssessmentsModalOpen()) {
        setTimeout(() => {
          runAutoOfficialScanOnOpen();
        }, 150);
      } else {
        autoOfficialScanDoneForOpen = false;
      }
    });

    observer.observe(m, {
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden"],
    });

    qsa("[data-modal-target='modal-assessments'], [data-open-modal='modal-assessments'], [href='#modal-assessments']").forEach((btn) => {
      btn.addEventListener("click", () => {
        autoOfficialScanDoneForOpen = false;

        setTimeout(() => {
          runAutoOfficialScanOnOpen();
        }, 250);
      });
    });
  };

  // =========================================================
  // Init
  // =========================================================
  const init = () => {
    if (window.__teacherAssessmentsModalInit) return;
    window.__teacherAssessmentsModalInit = true;

    if (!modal()) return;

    state.defaultModeOptionsHTML = modeSelect()?.innerHTML || "";
    state.defaultTypeOptionsHTML = typeSelect()?.innerHTML || "";

    bindModalClose();
    bindTabs();
    bindFilters();
    bindListActions();
    bindCreateActions();
    watchAssessmentsModalOpen();

    setTab("list");
    updateSmartContextText();
    applyCreateRules();

    setTimeout(() => {
      runAutoOfficialScanOnOpen();
    }, 300);

    window.TeacherAssessmentsModal = {
      openList,
      openCreate,
      reload: loadList,
    };
  };

  document.addEventListener("DOMContentLoaded", init);
})();