// frontend/admin/js/notificationsSend.js
(function () {
  "use strict";

const state = {
  initialized: false,
  lastPreview: null,
  ruleSeq: 0,

  // cache لنتائج البحث (تحسين الأداء)
  lookupCache: new Map(),
};

  // فعّلها مؤقتًا للتشخيص إن أردت
  const DEBUG_NOTIF_SEND = true;

  /* =========================
     Helpers
  ========================== */

  /* =========================
     Lookups API + Searchable Pickers
  ========================== */

  const LOOKUPS_BASE = "/api/notifications/admin/lookups";

  function buildQueryString(params = {}) {
    const parts = [];
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    });
    return parts.join("&");
  }

  async function apiGet(url, params = {}) {
    const query = buildQueryString(params);
    const finalUrl = query ? `${url}?${query}` : url;
    return apiRequest(finalUrl, { method: "GET" });
  }

  function getCachedLookupKey(path, params = {}) {
    const keys = Object.keys(params).sort();
    const stable = {};
    keys.forEach((k) => { stable[k] = params[k]; });
    return `${path}?${JSON.stringify(stable)}`;
  }

  async function fetchLookupItems(path, params = {}, { useCache = true } = {}) {
    const key = getCachedLookupKey(path, params);

    if (useCache && state.lookupCache.has(key)) {
      return state.lookupCache.get(key);
    }

    const res = await apiGet(path, params);
    const items = Array.isArray(res?.data?.items) ? res.data.items : [];
    const payload = { items, raw: res };

    if (useCache) state.lookupCache.set(key, payload);
    return payload;
  }

  function triggerFieldChange(el) {
    if (!el) return;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setNativeFieldValue(inputEl, value, label = "") {
    if (!inputEl) return;
    inputEl.value = value ?? "";
    if (label) inputEl.dataset.lookupLabel = label;
    else delete inputEl.dataset.lookupLabel;
    triggerFieldChange(inputEl);
  }

  function getFieldEl(panel, key) {
    return qs(`.js-field[data-field="${key}"]`, panel);
  }

  function getFieldInt(panel, key) {
    const el = getFieldEl(panel, key);
    if (!el) return null;
    return toIntOrNull(el.value);
  }

  function getRuleCard(el) {
    return el?.closest(".target-rule-card") || null;
  }

  function getRulePanel(el) {
    return el?.closest(".rule-fields-panel") || null;
  }

  function getPanelType(panel) {
    return panel?.dataset?.ruleFields || "";
  }

  function getUiScopeValue(panel, key) {
    if (!panel) return null;
    const map = {
      stage_id: ".js-ui-scope-stage",
      grade_id: ".js-ui-scope-grade",
      section_id: ".js-ui-scope-section",
    };
    const el = qs(map[key], panel);
    if (!el) return null;
    return toIntOrNull(el.value);
  }

  function getAnyScopeValue(panel, key) {
    // أولاً فلتر واجهة مساعد (إن وجد)
    const uiVal = getUiScopeValue(panel, key);
    if (uiVal) return uiVal;

    // ثم الحقل الفعلي ضمن الشرط (المخفي/الأصلي)
    return getFieldInt(panel, key);
  }

  function fillSelectOptions(selectEl, items = [], {
    placeholder = "اختر...",
    valueKey = "id",
    labelBuilder = null,
    keepValue = true,
  } = {}) {
    if (!selectEl) return;

    const oldValue = keepValue ? String(selectEl.value || "") : "";

    let html = `<option value="">${escapeHtml(placeholder)}</option>`;
    html += (items || []).map((item) => {
      const val = item?.[valueKey] ?? item?.id ?? "";
      const label = labelBuilder ? labelBuilder(item) : (item?.label || item?.name || `#${val}`);
      return `<option value="${escapeHtml(val)}">${escapeHtml(label)}</option>`;
    }).join("");

    selectEl.innerHTML = html;

    if (keepValue && oldValue) {
      const exists = qsa("option", selectEl).some((o) => o.value === oldValue);
      if (exists) selectEl.value = oldValue;
    }

    selectEl.disabled = (items || []).length === 0;
  }

  async function loadStagesIntoSelect(selectEl) {
    if (!selectEl) return;
    try {
      selectEl.disabled = true;
      fillSelectOptions(selectEl, [], { placeholder: "جارٍ تحميل المراحل..." });

      const { items } = await fetchLookupItems(`${LOOKUPS_BASE}/stages`, { limit: 100 });
      fillSelectOptions(selectEl, items, { placeholder: "كل المراحل (اختياري للتصفية)" });
      selectEl.disabled = false;
    } catch (err) {
      console.error("loadStagesIntoSelect error:", err);
      fillSelectOptions(selectEl, [], { placeholder: "تعذر تحميل المراحل" });
    }
  }

  async function loadGradesIntoSelect(selectEl, { stageId = null } = {}) {
    if (!selectEl) return;
    try {
      selectEl.disabled = true;
      fillSelectOptions(selectEl, [], { placeholder: "جارٍ تحميل الصفوف..." });

      const params = { limit: 200 };
      if (stageId) params.stage_id = stageId;

      const { items } = await fetchLookupItems(`${LOOKUPS_BASE}/grades`, params);
      fillSelectOptions(selectEl, items, {
        placeholder: stageId ? "اختر الصف" : "كل الصفوف (اختياري للتصفية)",
        labelBuilder: (x) => x?.stage_name ? `${x.name} — ${x.stage_name}` : (x.name || x.label),
      });
      selectEl.disabled = false;
    } catch (err) {
      console.error("loadGradesIntoSelect error:", err);
      fillSelectOptions(selectEl, [], { placeholder: "تعذر تحميل الصفوف" });
    }
  }

  async function loadSectionsIntoSelect(selectEl, { stageId = null, gradeId = null } = {}) {
    if (!selectEl) return;
    try {
      selectEl.disabled = true;
      fillSelectOptions(selectEl, [], { placeholder: "جارٍ تحميل الشعب..." });

      const params = { limit: 300 };
      if (stageId) params.stage_id = stageId;
      if (gradeId) params.grade_id = gradeId;

      const { items } = await fetchLookupItems(`${LOOKUPS_BASE}/sections`, params);
      fillSelectOptions(selectEl, items, {
        placeholder: "اختر الشعبة / الفصل",
        labelBuilder: (x) => {
          const parts = [x?.name || x?.label];
          if (x?.grade_name) parts.push(x.grade_name);
          if (x?.stage_name) parts.push(x.stage_name);
          return parts.filter(Boolean).join(" — ");
        },
      });
      selectEl.disabled = false;
    } catch (err) {
      console.error("loadSectionsIntoSelect error:", err);
      fillSelectOptions(selectEl, [], { placeholder: "تعذر تحميل الشعب" });
    }
  }

  function clearDependentTargetSelection(panel) {
    if (!panel) return;
    // إذا تغيّر نطاق الفلاتر (مرحلة/صف/شعبة) امسح اختيار الطالب/المعلم حتى لا يبقى قديمًا
    ["student_id", "teacher_id"].forEach((key) => {
      const field = getFieldEl(panel, key);
      if (field && field.value) {
        setNativeFieldValue(field, "", "");
      }
      const picker = field ? panel.querySelector(`.lookup-picker[data-source-field="${key}"]`) : null;
      if (picker) updateLookupPickerSelectedState(picker, field);
    });
  }

  function ensureUiScopeFilters(panel) {
    if (!panel) return;
    const type = getPanelType(panel);

    // نضيف فلاتر مساعدة فقط لأن هذه اللوحات لا تحتوي stage/grade/section أصلاً
    if (!["STUDENT", "GUARDIAN_OF_STUDENT", "TEACHER"].includes(type)) return;
    if (qs(".js-ui-scope-filters", panel)) return;

    const block = document.createElement("div");
    block.className = "scope-grid js-ui-scope-filters";
    block.innerHTML = `
      <div class="field">
        <label>المرحلة (تصفية اختيارية)</label>
        <select class="js-ui-scope-stage">
          <option value="">جارٍ التحميل...</option>
        </select>
      </div>
      <div class="field">
        <label>الصف (تصفية اختيارية)</label>
        <select class="js-ui-scope-grade" disabled>
          <option value="">اختر المرحلة أولًا</option>
        </select>
      </div>
      <div class="field">
        <label>الشعبة / الفصل (تصفية اختيارية)</label>
        <select class="js-ui-scope-section" disabled>
          <option value="">اختر الصف أولًا</option>
        </select>
      </div>
    `;

    // نضع الفلاتر قبل أول حقل فعلي في اللوحة
    const firstField = qs(".field", panel);
    if (firstField) firstField.parentNode.insertBefore(block, firstField);
    else panel.prepend(block);

    const stageSel = qs(".js-ui-scope-stage", block);
    const gradeSel = qs(".js-ui-scope-grade", block);
    const sectionSel = qs(".js-ui-scope-section", block);

    loadStagesIntoSelect(stageSel);

    stageSel?.addEventListener("change", async () => {
      const stageId = toIntOrNull(stageSel.value);
      gradeSel.value = "";
      sectionSel.value = "";

      fillSelectOptions(gradeSel, [], { placeholder: "جارٍ تحميل الصفوف..." });
      fillSelectOptions(sectionSel, [], { placeholder: "اختر الصف أولًا" });

      if (stageId) {
        await loadGradesIntoSelect(gradeSel, { stageId });
      } else {
        await loadGradesIntoSelect(gradeSel, { stageId: null });
      }

      fillSelectOptions(sectionSel, [], {
        placeholder: "اختر الصف أولًا",
      });
      sectionSel.disabled = true;

      clearDependentTargetSelection(panel);
    });

    gradeSel?.addEventListener("change", async () => {
      const stageId = toIntOrNull(stageSel.value);
      const gradeId = toIntOrNull(gradeSel.value);

      sectionSel.value = "";

      if (!gradeId && !stageId) {
        fillSelectOptions(sectionSel, [], { placeholder: "اختر الصف أولًا" });
        sectionSel.disabled = true;
      } else {
        await loadSectionsIntoSelect(sectionSel, { stageId, gradeId });
      }

      clearDependentTargetSelection(panel);
    });

    sectionSel?.addEventListener("change", () => {
      clearDependentTargetSelection(panel);
    });
  }

  function getLookupSourceConfig(inputEl) {
    const panel = getRulePanel(inputEl);
    const card = getRuleCard(inputEl);
    const field = inputEl?.dataset?.field;
    const panelType = getPanelType(panel);

    if (!field || !panel || !card) return null;

    if (field === "stage_id") {
      return {
        endpoint: `${LOOKUPS_BASE}/stages`,
        title: "اختيار المرحلة",
        searchPlaceholder: "ابحث باسم المرحلة...",
        resultLabel: (x) => x?.name || x?.label || `#${x?.id}`,
        buildParams: (q) => ({ q, limit: 100 }),
      };
    }

    if (field === "grade_id") {
      return {
        endpoint: `${LOOKUPS_BASE}/grades`,
        title: "اختيار الصف",
        searchPlaceholder: "ابحث باسم الصف...",
        resultLabel: (x) => {
          const parts = [x?.name || x?.label];
          if (x?.stage_name) parts.push(x.stage_name);
          return parts.filter(Boolean).join(" — ");
        },
        buildParams: (q) => {
          const stageId = getAnyScopeValue(panel, "stage_id");
          const params = { q, limit: 200 };
          if (stageId) params.stage_id = stageId;
          return params;
        },
      };
    }

    if (field === "section_id") {
      return {
        endpoint: `${LOOKUPS_BASE}/sections`,
        title: "اختيار الشعبة / الفصل",
        searchPlaceholder: "ابحث باسم الشعبة/الفصل...",
        resultLabel: (x) => {
          const parts = [x?.name || x?.label];
          if (x?.grade_name) parts.push(x.grade_name);
          if (x?.stage_name) parts.push(x.stage_name);
          return parts.filter(Boolean).join(" — ");
        },
        buildParams: (q) => {
          const stageId = getAnyScopeValue(panel, "stage_id");
          const gradeId = getAnyScopeValue(panel, "grade_id");
          const params = { q, limit: 200 };
          if (stageId) params.stage_id = stageId;
          if (gradeId) params.grade_id = gradeId;
          return params;
        },
      };
    }

    if (field === "student_id") {
      return {
        endpoint: `${LOOKUPS_BASE}/students`,
        title: "اختيار الطالب",
        searchPlaceholder: "ابحث باسم الطالب...",
        resultLabel: (x) => {
          const parts = [x?.name || x?.label];
          const meta = [];
          if (x?.section_name) meta.push(x.section_name);
          if (x?.grade_name) meta.push(x.grade_name);
          if (x?.stage_name) meta.push(x.stage_name);
          return meta.length ? `${parts[0]} — ${meta.join(" / ")}` : parts[0];
        },
        buildParams: (q) => {
          const stageId = getAnyScopeValue(panel, "stage_id");
          const gradeId = getAnyScopeValue(panel, "grade_id");
          const sectionId = getAnyScopeValue(panel, "section_id");

          const params = { q, limit: 50 };
          if (stageId) params.stage_id = stageId;
          if (gradeId) params.grade_id = gradeId;
          if (sectionId) params.section_id = sectionId;

          const academicYearId = getFieldInt(panel, "academic_year_id");
          const term = getFieldInt(panel, "term");
          if (academicYearId) params.academic_year_id = academicYearId;
          if (term) params.term = term;

          return params;
        },
      };
    }

    if (field === "teacher_id") {
      return {
        endpoint: `${LOOKUPS_BASE}/teachers`,
        title: "اختيار المعلم",
        searchPlaceholder: "ابحث باسم المعلم...",
        resultLabel: (x) => x?.name || x?.label || `#${x?.id}`,
        buildParams: (q) => {
          const params = { q, limit: 50 };

          // لو في فلتر شعبة مساعد داخل لوحة TEACHER نستخدمه
          const sectionId = getAnyScopeValue(panel, "section_id");
          if (sectionId) params.section_id = sectionId;

          const academicYearId = getFieldInt(panel, "academic_year_id");
          const term = getFieldInt(panel, "term");
          if (academicYearId) params.academic_year_id = academicYearId;
          if (term) params.term = term;

          return params;
        },
      };
    }

    return null;
  }

  function updateLookupPickerSelectedState(picker, sourceInput) {
    if (!picker || !sourceInput) return;

    const selectedBox = qs(".js-lookup-selected", picker);
    const hiddenValue = String(sourceInput.value || "").trim();
    const label = sourceInput.dataset.lookupLabel || "";

    if (!selectedBox) return;

    if (!hiddenValue) {
      selectedBox.innerHTML = `<span>لا يوجد اختيار بعد.</span>`;
      return;
    }

    selectedBox.innerHTML = `
      <span><strong>المحدد:</strong> ${escapeHtml(label || `ID #${hiddenValue}`)}</span>
      <small style="opacity:.8;">(ID: ${escapeHtml(hiddenValue)})</small>
    `;
  }

  function renderLookupSearchResults(picker, sourceInput, items, config) {
    const results = qs(".js-lookup-results", picker);
    if (!results) return;

    if (!Array.isArray(items) || !items.length) {
      results.innerHTML = `<div class="lookup-empty">لا توجد نتائج.</div>`;
      return;
    }

    results.innerHTML = items.map((item) => {
      const id = item?.id ?? "";
      const label = config.resultLabel ? config.resultLabel(item) : (item?.label || item?.name || `#${id}`);
      return `
        <button type="button" class="lookup-result-btn js-lookup-result-item"
          data-id="${escapeHtml(id)}"
          data-label="${escapeHtml(label)}"
          title="${escapeHtml(label)}">
          ${escapeHtml(label)}
        </button>
      `;
    }).join("");
  }

  async function performLookupSearch(picker, sourceInput, { force = false } = {}) {
    if (!picker || !sourceInput) return;

    const config = getLookupSourceConfig(sourceInput);
    if (!config) return;

    const qInput = qs(".js-lookup-search", picker);
    const q = String(qInput?.value || "").trim();

    const statusEl = qs(".js-lookup-status", picker);
    const resultsWrap = qs(".js-lookup-results", picker);

    try {
      if (statusEl) statusEl.textContent = "جارٍ البحث...";
      if (resultsWrap && !force && !q && resultsWrap.dataset.loadedOnce === "1") {
        if (statusEl) statusEl.textContent = "";
        return;
      }

      const params = config.buildParams ? config.buildParams(q) : { q };
      const { items } = await fetchLookupItems(config.endpoint, params, {
        // نتائج البحث النصي لا نحتاج تخزينها كثيرًا لو كبيرة
        useCache: true,
      });

      renderLookupSearchResults(picker, sourceInput, items, config);
      if (resultsWrap) resultsWrap.dataset.loadedOnce = "1";
      if (statusEl) statusEl.textContent = `عدد النتائج: ${items.length}`;
    } catch (err) {
      console.error("performLookupSearch error:", err);
      if (statusEl) statusEl.textContent = "تعذر جلب النتائج";
      if (resultsWrap) {
        resultsWrap.innerHTML = `<div class="lookup-empty">تعذر تحميل النتائج.</div>`;
      }
    }
  }

  function clearLookupSelection(picker, sourceInput) {
    setNativeFieldValue(sourceInput, "", "");
    updateLookupPickerSelectedState(picker, sourceInput);
  }

  function ensureLookupPickerForInput(inputEl) {
    if (!inputEl) return;
    if (inputEl.dataset.lookupEnhanced === "1") return;

    const config = getLookupSourceConfig(inputEl);
    if (!config) return;

    const panel = getRulePanel(inputEl);
    if (!panel) return;

    // للطالب/ولي الأمر/المعلم: أضف فلاتر مرحلة/صف/شعبة اختيارية
    ensureUiScopeFilters(panel);

    inputEl.dataset.lookupEnhanced = "1";

    // نخفي حقل الـ ID الأصلي لكن نُبقيه في DOM ليُرسل payload
    inputEl.style.display = "none";

    const picker = document.createElement("div");
    picker.className = "lookup-picker";
    picker.dataset.sourceField = inputEl.dataset.field || "";

    picker.innerHTML = `
      <div class="lookup-picker-head">
        <div class="js-lookup-selected">لا يوجد اختيار بعد.</div>
      </div>

      <div class="lookup-picker-tools">
        <input type="text" class="js-lookup-search" placeholder="${escapeHtml(config.searchPlaceholder || "ابحث...")}" autocomplete="off" />
        <button type="button" class="btn btn-light btn-sm js-lookup-search-btn">بحث</button>
        <button type="button" class="btn btn-light btn-sm js-lookup-clear-btn">مسح</button>
      </div>

      <div class="js-lookup-status field-hint" style="margin:.25rem 0 .35rem 0;"></div>
      <div class="js-lookup-results lookup-results-list"></div>
    `;

    inputEl.insertAdjacentElement("afterend", picker);
    updateLookupPickerSelectedState(picker, inputEl);

    const searchInput = qs(".js-lookup-search", picker);
    const searchBtn = qs(".js-lookup-search-btn", picker);
    const clearBtn = qs(".js-lookup-clear-btn", picker);
    const resultsWrap = qs(".js-lookup-results", picker);

    const debouncedSearch = debounce(() => performLookupSearch(picker, inputEl), 250);

    searchInput?.addEventListener("input", debouncedSearch);
    searchInput?.addEventListener("focus", () => {
      performLookupSearch(picker, inputEl);
    });

    searchBtn?.addEventListener("click", () => {
      performLookupSearch(picker, inputEl, { force: true });
    });

    clearBtn?.addEventListener("click", () => {
      clearLookupSelection(picker, inputEl);
    });

    resultsWrap?.addEventListener("click", (e) => {
      const btn = e.target.closest(".js-lookup-result-item");
      if (!btn) return;

      const id = toIntOrNull(btn.dataset.id);
      const label = btn.dataset.label || "";
      if (!id) return;

      setNativeFieldValue(inputEl, id, label);
      updateLookupPickerSelectedState(picker, inputEl);
    });
  }

  function syncLookupPickersInCard(card) {
    if (!card) return;
    qsa(".js-field[data-field]", card).forEach((inputEl) => {
      const picker = card.querySelector(`.lookup-picker[data-source-field="${inputEl.dataset.field}"]`);
      if (picker) updateLookupPickerSelectedState(picker, inputEl);
    });
  }

  function enhanceRuleCardLookups(card) {
    if (!card) return;

    // أعمدة نريد تحويلها من ID -> اختيار بالأسماء
    const targetFields = new Set(["stage_id", "grade_id", "section_id", "student_id", "teacher_id"]);

    qsa(".js-field[data-field]", card).forEach((inputEl) => {
      const key = inputEl.dataset.field;
      if (!targetFields.has(key)) return;

      const panel = getRulePanel(inputEl);
      if (!panel) return;

      // لا نعالج الحقول داخل لوحات غير نشطة إذا أردت تقليل DOM؟ لا بأس نعالج كلها
      ensureLookupPickerForInput(inputEl);
    });

    syncLookupPickersInCard(card);
  }


  function qs(s, root = document) { return root.querySelector(s); }
  function qsa(s, root = document) { return Array.from(root.querySelectorAll(s)); }

  function getRoot() {
    return qs("#adminNotificationSendPage");
  }

  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("accessToken") ||
      ""
    );
  }

  const API_BASE =
    window.API_BASE_URL ||
    localStorage.getItem("apiBaseUrl") ||
    "http://127.0.0.1:5000";

  function toApiUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  async function apiRequest(url, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const finalUrl = toApiUrl(url);
    console.log("[API]", options.method || "GET", finalUrl);

    const res = await fetch(finalUrl, {
      ...options,
      headers,
    });

    let data = null;
    try { data = await res.json(); } catch (_) {}

    if (!res.ok) {
      const msg = data?.message || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(msg);
    }

    return data;
  }

  function debug(...args) {
    if (!DEBUG_NOTIF_SEND) return;
    console.log("[notificationsSend]", ...args);
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toIntOrNull(v) {
    if (v === null || v === undefined) return null;
    const txt = String(v).trim();
    if (!txt) return null;
    const n = Number(txt);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function toNumberOrZero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function parseUserIdsInput(text) {
    return [...new Set(
      String(text || "")
        .split(/[\s,،\n\r\t]+/g)
        .map((x) => Number(x))
        .filter((x) => Number.isInteger(x) && x > 0)
    )];
  }

  function nonEmptyString(v) {
    const s = String(v ?? "").trim();
    return s ? s : null;
  }

  function isTruthyLike(v) {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
  }

  function debounce(fn, wait = 150) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* =========================
     UI status / boxes
  ========================== */
  function setStatus(message, type = "info") {
    const box = qs("#sendPageStatusBox");
    if (!box) return;

    box.textContent = message || "";

    box.classList.remove("is-error", "is-success", "is-info", "is-warning");
    if (type === "error") box.classList.add("is-error");
    else if (type === "success") box.classList.add("is-success");
    else if (type === "warning") box.classList.add("is-warning");
    else box.classList.add("is-info");
  }

  function clearWarnings() {
    const box = qs("#sendPageWarningsBox");
    if (!box) return;
    box.innerHTML = "";
    box.classList.add("hidden");
  }

  function renderWarnings(warnings) {
    const box = qs("#sendPageWarningsBox");
    if (!box) return;

    const arr = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    if (!arr.length) {
      box.innerHTML = "";
      box.classList.add("hidden");
      return;
    }

    box.classList.remove("hidden");
    box.innerHTML = arr.map((w, i) => {
      const title = typeof w === "object" ? (w.title || `تنبيه ${i + 1}`) : `تنبيه ${i + 1}`;
      const body = typeof w === "object" ? (w.message || w.text || JSON.stringify(w)) : String(w);
      return `
        <div class="message-item">
          <div class="message-item-title">${escapeHtml(title)}</div>
          <div class="message-item-body">${escapeHtml(body)}</div>
        </div>
      `;
    }).join("");
  }

  function clearPreviewBox() {
    const box = qs("#sendPagePreviewBox");
    if (box) box.innerHTML = "";
  }

  function clearPreviewSummary() {
    qs("#sendPagePreviewSummary")?.classList.add("hidden");
    setText("#previewTotalRecipientsValue", "0");
    setText("#previewAdminsCountValue", "0");
    setText("#previewTeachersCountValue", "0");
    setText("#previewGuardiansCountValue", "0");
    setText("#previewStudentsCountValue", "0");
    setText("#previewDedupedCountValue", "0");
  }

  function clearResultMeta() {
    qs("#sendPageResultMetaBox")?.classList.add("hidden");
    setText("#resultRequestIdValue", "-");
    setText("#resultCreatedRowsValue", "0");
    setText("#resultRealtimeSentValue", "0");
  }

  function setText(selector, value, root = document) {
    const el = qs(selector, root);
    if (el) el.textContent = String(value ?? "");
  }

  function setValue(selector, value, root = document) {
    const el = qs(selector, root);
    if (el) el.value = value ?? "";
  }

  /* =========================
     Category UI
  ========================== */
  function renderCategoryCustom() {
    const category = qs("#notifCategory")?.value || "general";
    const wrap = qs("#notifCategoryCustomWrap");
    if (!wrap) return;
    wrap.classList.toggle("hidden", category !== "custom");
  }

  function getFinalCategoryValue() {
    const category = qs("#notifCategory")?.value || "general";
    if (category !== "custom") return category;
    return nonEmptyString(qs("#notifCategoryCustom")?.value) || "custom";
  }

  /* =========================
     Target Builder
  ========================== */
  const TARGET_TYPE_LABELS = {
    ALL_SCHOOL: "المدرسة كاملة",
    ROLE_GROUPS: "حسب الأدوار",
    GRADE: "صف محدد",
    SECTION: "شعبة / فصل محدد",
    ALL_SECTIONS_OF_GRADE: "كل شعب صف معيّن",
    STUDENT: "طالب محدد",
    GUARDIAN_OF_STUDENT: "ولي أمر طالب",
    TEACHER: "معلم محدد",
    ALL_TEACHERS: "جميع المعلمين",
    TEACHERS_OF_SECTION: "معلمو شعبة / فصل",
    ACADEMIC_SCOPE: "نطاق أكاديمي متقدم",
    USERS: "مستخدمون محددون",
  };

  function getTargetRulesContainer() {
    return qs("#targetRulesContainer");
  }

  function getTargetRuleTemplate() {
    return qs("#notificationTargetRuleTemplate");
  }

  function nextRuleId() {
    state.ruleSeq += 1;
    return state.ruleSeq;
  }

  function createTargetRuleCard(type = "", seed = null) {
    const tpl = getTargetRuleTemplate();
    if (!tpl) return null;

    const fragment = tpl.content.cloneNode(true);
    const card = qs(".target-rule-card", fragment);
    if (!card) return null;

    const localId = nextRuleId();
    card.dataset.ruleId = String(localId);

    if (type) {
      const typeSelect = qs(".js-target-type", card);
      if (typeSelect) typeSelect.value = type;
      renderTargetRuleTypePanel(card);
    }

    if (seed && typeof seed === "object") {
      applyRuleSeed(card, seed);
    } else if (type) {
      applyDefaultValuesForType(card, type);
    }

    return card;
  }

  function addTargetRule(type = "", seed = null) {
    const container = getTargetRulesContainer();
    if (!container) return null;

    const card = createTargetRuleCard(type, seed);
    if (!card) return null;

   container.appendChild(card);
renderTargetRuleTypePanel(card);
enhanceRuleCardLookups(card); // ✅ جديد
updateRuleCardsMeta();
updateTargetSummaryUI();
return card;
  }

  function clearAllTargetRules() {
    const container = getTargetRulesContainer();
    if (!container) return;
    container.innerHTML = "";
    updateTargetSummaryUI();
  }

  function ensureAtLeastOneRule() {
    const container = getTargetRulesContainer();
    if (!container) return;
    if (!qsa(".target-rule-card", container).length) {
      addTargetRule("ROLE_GROUPS");
    }
  }

  function updateRuleCardsMeta() {
    const cards = qsa(".target-rule-card", getTargetRulesContainer());
    cards.forEach((card, idx) => {
      card.dataset.ruleIndex = String(idx);
      setText(".target-rule-title", `شرط استهداف #${idx + 1}`, card);

      const typeVal = qs(".js-target-type", card)?.value || "";
      const subtitle = qs(".target-rule-subtitle", card);
      if (subtitle) {
        subtitle.textContent = typeVal
          ? `النوع: ${TARGET_TYPE_LABELS[typeVal] || typeVal}`
          : "اختر النوع ثم عبّئ الحقول المطلوبة";
      }
    });
  }

  function renderTargetRuleTypePanel(card) {
    if (!card) return;
    const type = qs(".js-target-type", card)?.value || "";

    qsa(".rule-fields-panel", card).forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.ruleFields !== type);
    });

    const subtitle = qs(".target-rule-subtitle", card);
    if (subtitle) {
      subtitle.textContent = type
        ? `النوع: ${TARGET_TYPE_LABELS[type] || type}`
        : "اختر النوع ثم عبّئ الحقول المطلوبة";
    }
        // تفعيل واجهات الاختيار بالأسماء داخل اللوحة الحالية
    enhanceRuleCardLookups(card);
  }

  function applyDefaultValuesForType(card, type) {
    if (!card || !type) return;

    if (type === "ROLE_GROUPS") {
      qsa('.js-role-check[value="teachers"]', card).forEach((el) => { el.checked = true; });
      qsa('.js-role-check[value="guardians"]', card).forEach((el) => { el.checked = true; });
    }
  }

  function duplicateTargetRule(sourceCard) {
    if (!sourceCard) return;

    const seed = serializeRuleCard(sourceCard, { includeEmpty: true, rawForDuplicate: true });
    const newCard = addTargetRule(seed?.type || "", seed);

    if (newCard) {
      const labelInput = qs(".js-rule-label", newCard);
      if (labelInput && labelInput.value) {
        labelInput.value = `${labelInput.value} (نسخة)`;
      }
    }
    updateTargetSummaryUI();
  }

  function removeTargetRule(card) {
    if (!card) return;
    card.remove();
    updateRuleCardsMeta();
    updateTargetSummaryUI();
  }

  function applyRuleSeed(card, seed) {
    if (!card || !seed || typeof seed !== "object") return;

    const type = seed.type || "";
    const typeSelect = qs(".js-target-type", card);
    if (typeSelect) {
      typeSelect.value = type;
      renderTargetRuleTypePanel(card);
    }

    if (seed.label) {
      setValue(".js-rule-label", seed.label, card);
    }

    if (Array.isArray(seed.roles)) {
      qsa(".js-role-check", card).forEach((chk) => {
        chk.checked = seed.roles.includes(chk.value);
      });
    }

    qsa(".js-field", card).forEach((el) => {
      const field = el.dataset.field;
      if (!field) return;

      if (field === "user_ids_text" && Array.isArray(seed.user_ids)) {
        el.value = seed.user_ids.join(",");
        return;
      }

      if (!(field in seed)) return;

      const val = seed[field];
      if (el.type === "checkbox") {
        el.checked = !!val;
      } else if (el.tagName === "SELECT") {
        el.value = String(
          typeof val === "boolean" ? (val ? 1 : 0) : (val ?? "")
        );
      } else {
        el.value = val ?? "";
      }
    });

    // مزامنة واجهة الـ lookup بعد تعبئة القيم (مهم عند النسخ)
    enhanceRuleCardLookups(card);
    syncLookupPickersInCard(card);

  }

  function getActiveRulePanel(card) {
    const type = qs(".js-target-type", card)?.value || "";
    return type ? qs(`.rule-fields-panel[data-rule-fields="${type}"]`, card) : null;
  }

  function serializeRuleCard(card, opts = {}) {
    const { includeEmpty = false, rawForDuplicate = false } = opts;
    if (!card) return null;

    const type = qs(".js-target-type", card)?.value || "";
    const label = nonEmptyString(qs(".js-rule-label", card)?.value);
    if (!type && !includeEmpty) return null;

    const rule = {};
    if (type) rule.type = type;
    if (label) rule.label = label;

    if (type === "ROLE_GROUPS") {
      const roles = qsa(".js-role-check:checked", card).map((x) => x.value);
      if (roles.length || includeEmpty) rule.roles = roles;
    }

    const panel = getActiveRulePanel(card);
    if (panel) {
      qsa(".js-field", panel).forEach((el) => {
        const key = el.dataset.field;
        if (!key) return;

        let val;
        if (el.type === "checkbox") {
          val = !!el.checked;
        } else {
          val = (el.value ?? "").toString().trim();
        }

        if (el.type === "number") {
          val = toIntOrNull(val);
        }

        if (key === "include_guardians_also") {
          val = isTruthyLike(val);
        }

        if (key === "user_ids_text") {
          if (rawForDuplicate) {
            if (includeEmpty || val) rule.user_ids_text = val;
          } else {
            const ids = parseUserIdsInput(val);
            if (ids.length || includeEmpty) rule.user_ids = ids;
          }
          return;
        }

        if (val === "" || val === null) {
          if (includeEmpty) rule[key] = (el.type === "number" ? null : "");
          return;
        }

        rule[key] = val;
      });
    }

    if (type === "USERS" && rawForDuplicate && Array.isArray(rule.user_ids)) {
      rule.user_ids_text = rule.user_ids.join(",");
      delete rule.user_ids;
    }

    return rule;
  }

  function collectTargets() {
    const cards = qsa(".target-rule-card", getTargetRulesContainer());
    return cards
      .map((card) => serializeRuleCard(card))
      .filter((x) => x && x.type);
  }

  function getTargetRuleHumanSummary(rule) {
    if (!rule || !rule.type) return "شرط غير مكتمل";

    const typeLabel = TARGET_TYPE_LABELS[rule.type] || rule.type;
    const parts = [];

    if (rule.label) parts.push(`"${rule.label}"`);

    switch (rule.type) {
      case "ALL_SCHOOL": {
        const included = [];
        if (rule.include_admins) included.push("الإدارة");
        if (rule.include_teachers) included.push("المعلمون");
        if (rule.include_guardians) included.push("أولياء الأمور");
        if (rule.include_students) included.push("الطلاب");
        parts.push(included.length ? `الفئات: ${included.join("، ")}` : "بدون فئات محددة");
        break;
      }

      case "ROLE_GROUPS":
        parts.push(Array.isArray(rule.roles) && rule.roles.length
          ? `الأدوار: ${rule.roles.join(", ")}`
          : "بدون أدوار");
        break;

      case "GRADE":
        parts.push(`grade_id=${rule.grade_id ?? "?"}`);
        if (rule.stage_id) parts.push(`stage_id=${rule.stage_id}`);
        if (rule.academic_year_id) parts.push(`year=${rule.academic_year_id}`);
        if (rule.term) parts.push(`term=${rule.term}`);
        break;

      case "SECTION":
      case "TEACHERS_OF_SECTION":
        parts.push(`section_id=${rule.section_id ?? "?"}`);
        if (rule.grade_id) parts.push(`grade_id=${rule.grade_id}`);
        if (rule.academic_year_id) parts.push(`year=${rule.academic_year_id}`);
        if (rule.term) parts.push(`term=${rule.term}`);
        break;

      case "ALL_SECTIONS_OF_GRADE":
        parts.push(`grade_id=${rule.grade_id ?? "?"}`);
        if (rule.academic_year_id) parts.push(`year=${rule.academic_year_id}`);
        if (rule.term) parts.push(`term=${rule.term}`);
        break;

      case "STUDENT":
      case "GUARDIAN_OF_STUDENT":
        parts.push(`student_id=${rule.student_id ?? "?"}`);
        if (rule.guardian_relation) parts.push(`relation=${rule.guardian_relation}`);
        if (rule.include_guardians_also) parts.push("مع ولي الأمر");
        break;

      case "TEACHER":
        parts.push(`teacher_id=${rule.teacher_id ?? "?"}`);
        break;

      case "ALL_TEACHERS":
        if (rule.academic_year_id) parts.push(`year=${rule.academic_year_id}`);
        if (rule.term) parts.push(`term=${rule.term}`);
        break;

      case "ACADEMIC_SCOPE":
        if (rule.academic_year_id) parts.push(`year=${rule.academic_year_id}`);
        if (rule.term) parts.push(`term=${rule.term}`);
        if (rule.stage_id) parts.push(`stage_id=${rule.stage_id}`);
        if (rule.grade_id) parts.push(`grade_id=${rule.grade_id}`);
        if (rule.section_id) parts.push(`section_id=${rule.section_id}`);
        break;

      case "USERS":
        parts.push(`user_ids=${Array.isArray(rule.user_ids) ? rule.user_ids.length : 0}`);
        break;
    }

    return `${typeLabel}${parts.length ? " — " + parts.join(" | ") : ""}`;
  }

  function updateTargetSummaryUI() {
    const targets = collectTargets();
    const textBox = qs("#targetSummaryText");
    const chipsBox = qs("#targetSummaryChips");

    if (!textBox || !chipsBox) return;

    if (!targets.length) {
      textBox.textContent = "لم تتم إضافة أي شروط استهداف بعد.";
      chipsBox.innerHTML = "";
      return;
    }

    textBox.textContent = `تمت إضافة ${targets.length} شرط/شروط استهداف. سيتم دمج النتائج وإزالة التكرار عند المعاينة/الإرسال.`;

    chipsBox.innerHTML = targets.map((rule, idx) => {
      return `<span class="chip target-chip" title="${escapeHtml(getTargetRuleHumanSummary(rule))}">
        ${escapeHtml(`${idx + 1}. ${TARGET_TYPE_LABELS[rule.type] || rule.type}`)}
      </span>`;
    }).join("");
  }

  /* =========================
     Validation
  ========================== */
  function validateTargets(targets) {
    const errors = [];

    if (!Array.isArray(targets) || !targets.length) {
      errors.push("أضف شرط استهداف واحدًا على الأقل.");
      return errors;
    }

    targets.forEach((t, index) => {
      const n = index + 1;
      if (!t.type) {
        errors.push(`شرط الاستهداف #${n}: نوع الاستهداف غير محدد.`);
        return;
      }

      switch (t.type) {
        case "ALL_SCHOOL": {
          const anyIncluded = !!(t.include_admins || t.include_teachers || t.include_guardians || t.include_students);
          if (!anyIncluded) errors.push(`شرط #${n} (المدرسة كاملة): اختر فئة واحدة على الأقل.`);
          break;
        }

        case "ROLE_GROUPS":
          if (!Array.isArray(t.roles) || !t.roles.length) {
            errors.push(`شرط #${n} (حسب الأدوار): اختر دورًا واحدًا على الأقل.`);
          }
          break;

        case "GRADE":
          if (!t.grade_id) errors.push(`شرط #${n} (صف محدد): grade_id مطلوب.`);
          if (!(t.include_teachers || t.include_guardians || t.include_students)) {
            errors.push(`شرط #${n} (صف محدد): اختر فئة مستهدفة واحدة على الأقل (معلمون/أولياء أمور/طلاب).`);
          }
          break;

        case "SECTION":
          if (!t.section_id) errors.push(`شرط #${n} (شعبة/فصل): section_id مطلوب.`);
          if (!(t.include_teachers || t.include_guardians || t.include_students)) {
            errors.push(`شرط #${n} (شعبة/فصل): اختر فئة مستهدفة واحدة على الأقل.`);
          }
          break;

        case "ALL_SECTIONS_OF_GRADE":
          if (!t.grade_id) errors.push(`شرط #${n} (كل شعب صف): grade_id مطلوب.`);
          if (!(t.include_teachers || t.include_guardians || t.include_students)) {
            errors.push(`شرط #${n} (كل شعب صف): اختر فئة مستهدفة واحدة على الأقل.`);
          }
          break;

        case "STUDENT":
          if (!t.student_id) errors.push(`شرط #${n} (طالب محدد): student_id مطلوب.`);
          break;

        case "GUARDIAN_OF_STUDENT":
          if (!t.student_id) errors.push(`شرط #${n} (ولي أمر طالب): student_id مطلوب.`);
          break;

        case "TEACHER":
          if (!t.teacher_id) errors.push(`شرط #${n} (معلم محدد): teacher_id مطلوب.`);
          break;

        case "TEACHERS_OF_SECTION":
          if (!t.section_id) errors.push(`شرط #${n} (معلمو شعبة/فصل): section_id مطلوب.`);
          break;

        case "ACADEMIC_SCOPE": {
          const anyScope = !!(t.academic_year_id || t.term || t.stage_id || t.grade_id || t.section_id);
          const anyIncluded = !!(t.include_admins || t.include_teachers || t.include_guardians || t.include_students);
          if (!anyScope) {
            errors.push(`شرط #${n} (نطاق أكاديمي متقدم): أدخل معيار نطاق واحدًا على الأقل (stage/grade/section/term/year).`);
          }
          if (!anyIncluded) {
            errors.push(`شرط #${n} (نطاق أكاديمي متقدم): اختر فئة واحدة على الأقل.`);
          }
          break;
        }

        case "USERS":
          if (!Array.isArray(t.user_ids) || !t.user_ids.length) {
            errors.push(`شرط #${n} (مستخدمون محددون): أدخل user_id واحدًا على الأقل.`);
          }
          break;

        case "ALL_TEACHERS":
          break;

        default:
          errors.push(`شرط #${n}: نوع استهداف غير مدعوم (${t.type}).`);
      }
    });

    return errors;
  }

  function validatePayload(payload, { requireBody = true } = {}) {
    const errors = [];

    if (!payload.title || !String(payload.title).trim()) {
      errors.push("عنوان الإشعار مطلوب.");
    }

    if (requireBody && (!payload.body || !String(payload.body).trim())) {
      errors.push("محتوى الإشعار مطلوب.");
    }

    if (!payload.category || !String(payload.category).trim()) {
      errors.push("فئة الإشعار مطلوبة.");
    }

    if (toNumberOrZero(payload.dedupe_seconds) < 0) {
      errors.push("قيمة منع التكرار يجب أن تكون 0 أو أكبر.");
    }

    errors.push(...validateTargets(payload.targets || []));

    return errors;
  }

  /* =========================
     Payload collection (NEW schema)
  ========================== */
  function collectPayload() {
    const title = nonEmptyString(qs("#notifTitle")?.value) || "";
    const body = nonEmptyString(qs("#notifBody")?.value) || "";
    const category = getFinalCategoryValue();
    const priority = qs("#notifPriority")?.value || "normal";
    const dedupeSeconds = Math.max(0, Number(qs("#notifDedupeSeconds")?.value || 0) || 0);
    const allowRealtime = isTruthyLike(qs("#notifAllowRealtime")?.value ?? "1");
    const previewLimit = Math.max(5, Math.min(100, Number(qs("#notifPreviewLimit")?.value || 20) || 20));
    const payloadVersion = Number(qs("#notifPayloadVersion")?.value || 2) || 2;

    const targets = collectTargets();

    const payload = {
      payload_version: payloadVersion,

      title,
      body,
      category,
      priority,

      // الجديد
      dedupe_seconds: dedupeSeconds,
      allow_realtime: allowRealtime,
      preview_limit: previewLimit,
      recipient_mode: "targets", // مهم جدًا للتوافق مع resolver الحالي
      targets,

      meta: {
        ui_source: "admin_send_page_target_builder",
        ui_version: 2,
      },

      // توافق مع الباك إند الحالي (notificationCreateService يستخدم هذا الاسم)
      dedupe_window_seconds: dedupeSeconds,

      // توافق إضافي لو عندك أي طبقة وسيطة قديمة
      target_rules: targets,
    };

    debug("Collected payload:", payload);
    return payload;
  }

  /* =========================
     Preview rendering
  ========================== */
  function getPreviewDataEnvelope(preview) {
    if (!preview) return null;
    return preview.data || preview;
  }

  function pickBreakdown(data) {
    if (!data) return {};
    return data.breakdown || data.audience?.breakdown || {};
  }

  function extractSampleRecipients(data) {
    if (!data) return [];
    return (
      data.sample ||
      data.samples ||
      data.recipient_samples ||
      data.recipients_sample ||
      data.recipients_preview ||
      data.audience?.sample ||
      []
    );
  }

  function extractWarnings(data) {
    if (!data) return [];
    return data.warnings || data.messages || [];
  }

  function renderPreviewSummary(preview) {
    const wrap = qs("#sendPagePreviewSummary");
    if (!wrap) return;

    const data = getPreviewDataEnvelope(preview);
    const bd = pickBreakdown(data);

    const total =
      data?.total_recipients ??
      data?.total_unique ??
      bd?.total_recipients ??
      bd?.total_unique ??
      (Array.isArray(data?.recipient_user_ids) ? data.recipient_user_ids.length : 0) ??
      0;

    const admins = data?.admins ?? bd?.admins ?? 0;
    const teachers = data?.teachers ?? bd?.teachers ?? 0;
    const guardians = data?.guardians ?? bd?.guardians ?? 0;
    const students = data?.students ?? bd?.students ?? 0;
    const deduped =
      data?.deduped_count ??
      data?.duplicates_removed ??
      bd?.deduped_count ??
      bd?.duplicates_removed ??
      0;

    setText("#previewTotalRecipientsValue", total);
    setText("#previewAdminsCountValue", admins);
    setText("#previewTeachersCountValue", teachers);
    setText("#previewGuardiansCountValue", guardians);
    setText("#previewStudentsCountValue", students);
    setText("#previewDedupedCountValue", deduped);

    wrap.classList.remove("hidden");
  }

  function renderPreviewRecipientsList(preview) {
    const box = qs("#sendPagePreviewBox");
    if (!box) return;

    const data = getPreviewDataEnvelope(preview);
    const sample = extractSampleRecipients(data);

    const summaryLines = [];
    const bd = pickBreakdown(data);

    if (data?.mode || bd?.mode) {
      summaryLines.push(`<div><strong>الوضع:</strong> ${escapeHtml(data?.mode || bd?.mode)}</div>`);
    }

    if (data?.academic_year_id || bd?.academic_year_id) {
      summaryLines.push(`<div><strong>السنة الدراسية المستخدمة:</strong> ${escapeHtml(data?.academic_year_id || bd?.academic_year_id)}</div>`);
    }

    if (Array.isArray(data?.recipient_user_ids)) {
      summaryLines.push(`<div><strong>عدد user_ids (حسب الاستجابة):</strong> ${escapeHtml(data.recipient_user_ids.length)}</div>`);
    }

    const headHtml = `
      <div class="preview-card">
        ${summaryLines.length ? summaryLines.join("") : `<div>تمت المعاينة بنجاح.</div>`}
      </div>
    `;

    if (!Array.isArray(sample) || !sample.length) {
      box.innerHTML = headHtml + `
        <div class="preview-empty">
          لا توجد عيّنة مستلمين في الاستجابة (أو الباكند لم يُرجع sample بعد).
        </div>
      `;
      return;
    }

    const tpl = qs("#notificationPreviewRecipientItemTemplate");
    let listHtml = "";

    if (tpl) {
      sample.forEach((item) => {
        const wrapper = document.createElement("div");
        wrapper.appendChild(tpl.content.cloneNode(true));

        const name =
          item.full_name ||
          item.name ||
          item.display_name ||
          item.username ||
          "مستخدم";

        const role =
          item.role_key ||
          item.role ||
          item.user_type ||
          "—";

        const metaParts = [];
        if (item.user_id) metaParts.push(`user_id: ${item.user_id}`);
        if (item.student_id) metaParts.push(`student_id: ${item.student_id}`);
        if (item.teacher_id) metaParts.push(`teacher_id: ${item.teacher_id}`);
        if (item.guardian_id) metaParts.push(`guardian_id: ${item.guardian_id}`);
        if (item.section_id) metaParts.push(`section_id: ${item.section_id}`);
        if (item.grade_id) metaParts.push(`grade_id: ${item.grade_id}`);

        setText(".preview-recipient-name", name, wrapper);
        setText(".preview-recipient-meta", metaParts.join(" | ") || "—", wrapper);
        setText(".preview-recipient-tag", role, wrapper);

        listHtml += wrapper.innerHTML;
      });
    } else {
      listHtml = sample.map((item) => {
        const name = item.full_name || item.name || item.display_name || item.username || "مستخدم";
        const role = item.role_key || item.role || item.user_type || "—";
        return `
          <div class="preview-recipient-item">
            <div class="preview-recipient-main">
              <div class="preview-recipient-name">${escapeHtml(name)}</div>
              <div class="preview-recipient-meta">user_id: ${escapeHtml(item.user_id ?? "—")}</div>
            </div>
            <div class="preview-recipient-tag">${escapeHtml(role)}</div>
          </div>
        `;
      }).join("");
    }

    box.innerHTML = headHtml + `
      <div class="preview-recipient-list">
        ${listHtml}
      </div>
    `;
  }

  function renderPreview(preview) {
    if (!preview) {
      clearPreviewSummary();
      clearPreviewBox();
      clearWarnings();
      return;
    }

    const data = getPreviewDataEnvelope(preview);
    renderPreviewSummary(preview);
    renderWarnings(extractWarnings(data));
    renderPreviewRecipientsList(preview);
  }

  function renderSendResultMeta(sendResponse) {
    const box = qs("#sendPageResultMetaBox");
    if (!box) return;

    const data = sendResponse?.data || sendResponse || {};
    const sendResult = data?.send_result || {};
    const notifRow = sendResult?.notification || null;
    const recipientRows = Array.isArray(sendResult?.recipients) ? sendResult.recipients : [];

    const requestId =
      data.request_id ||
      data.operation_id ||
      notifRow?.id ||
      data.id ||
      "-";

    const createdRows =
      data.created_rows ??
      data.created_count ??
      data.inserted_count ??
      data.recipients_created ??
      recipientRows.length ??
      0;

    // باك إندك الحالي لا يرجع عدد realtime بشكل صريح
    const realtimeSent =
      data.realtime_sent ??
      data.realtime_sent_count ??
      data.socket_sent ??
      0;

    setText("#resultRequestIdValue", requestId);
    setText("#resultCreatedRowsValue", createdRows);
    setText("#resultRealtimeSentValue", realtimeSent);

    box.classList.remove("hidden");
  }

  /* =========================
     Actions
  ========================== */
  async function handlePreview() {
    try {
      clearResultMeta();

      const payload = collectPayload();
      const validationErrors = validatePayload(payload, { requireBody: false });

      if (validationErrors.length) {
        renderWarnings(validationErrors);
        setStatus("تعذر تنفيذ المعاينة بسبب أخطاء في النموذج.", "error");
        return;
      }

      setStatus("جارٍ معاينة المستلمين...", "info");
      clearWarnings();

      debug("Preview payload =>", payload);

      const res = await apiRequest("/api/notifications/admin/preview-recipients", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      debug("Preview response <=", res);

      state.lastPreview = res;
      renderPreview(res);
      setStatus(res.message || "تمت المعاينة بنجاح.", "success");
    } catch (err) {
      console.error("preview recipients error:", err);
      renderWarnings([err.message || "فشل معاينة المستلمين"]);
      setStatus(err.message || "فشل معاينة المستلمين", "error");
    }
  }

  async function handleSend(e) {
    e?.preventDefault?.();

    try {
      const payload = collectPayload();
      const validationErrors = validatePayload(payload, { requireBody: true });

      if (validationErrors.length) {
        renderWarnings(validationErrors);
        setStatus("تعذر الإرسال بسبب أخطاء في النموذج.", "error");
        return;
      }

      setStatus("جارٍ إرسال الإشعار...", "info");
      clearWarnings();
      clearResultMeta();

      debug("Send payload =>", payload);

      const res = await apiRequest("/api/notifications/admin/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      debug("Send response <=", res);

      const audiencePreview =
        res?.data?.audience ||
        res?.data?.preview ||
        (res?.data?.breakdown || res?.data?.sample ? res : null);

      if (audiencePreview) {
        renderPreview(audiencePreview);
      }

      renderWarnings(extractWarnings(res?.data || res));
      renderSendResultMeta(res);

      if (res?.data?.skipped) {
        setStatus(res.message || "لم يتم الإرسال (تم التخطي).", "warning");
        return;
      }

      setStatus(res.message || "تم إرسال الإشعار بنجاح.", "success");

      // تفريغ جزئي بعد الإرسال (نحافظ على شروط الاستهداف غالبًا)
      setValue("#notifTitle", "");
      setValue("#notifBody", "");
    } catch (err) {
      console.error("send notification error:", err);
      renderWarnings([err.message || "فشل إرسال الإشعار"]);
      setStatus(err.message || "فشل إرسال الإشعار", "error");
    }
  }

  function handleResetForm() {
    const form = qs("#notificationSendForm");
    form?.reset?.();

    renderCategoryCustom();

    clearAllTargetRules();
    ensureAtLeastOneRule();

    state.lastPreview = null;
    clearWarnings();
    clearPreviewSummary();
    clearPreviewBox();
    clearResultMeta();
    setStatus("تمت إعادة تعيين النموذج.", "info");
        state.lookupCache.clear?.();
  }

  function handleClearResults() {
    state.lastPreview = null;
    clearWarnings();
    clearPreviewSummary();
    clearPreviewBox();
    clearResultMeta();
    setStatus("تم مسح نتائج المعاينة/الإرسال.", "info");
  }

  function handleQuickAddRule() {
    const type = qs("#targetQuickAddType")?.value || "";
    if (!type) {
      setStatus("اختر نوع الاستهداف من الإضافة السريعة أولًا.", "warning");
      return;
    }
    addTargetRule(type);
    setStatus(`تمت إضافة شرط: ${TARGET_TYPE_LABELS[type] || type}`, "success");
  }

  /* =========================
     Event Binding
     (مهم لـ SPA: الربط على الجذر الحالي فقط)
  ========================== */
  const debouncedUpdateTargetSummaryUI = debounce(updateTargetSummaryUI, 120);

  function bindEventsForCurrentRoot() {
    const root = getRoot();
    if (!root) return;

    // تجنّب تكرار الربط على نفس النسخة من DOM
    if (root.dataset.notifSendBound === "1") return;
    root.dataset.notifSendBound = "1";

    // Category custom
    qs("#notifCategory", root)?.addEventListener("change", renderCategoryCustom);

    // Target builder buttons
    qs("#addTargetRuleBtn", root)?.addEventListener("click", () => addTargetRule());
    qs("#clearTargetRulesBtn", root)?.addEventListener("click", () => {
      clearAllTargetRules();
      updateTargetSummaryUI();
      setStatus("تم مسح جميع شروط الاستهداف.", "info");
    });

    qs("#quickAddTargetRuleBtn", root)?.addEventListener("click", handleQuickAddRule);

    // Preview / Send / Reset
    qs("#previewRecipientsBtn", root)?.addEventListener("click", handlePreview);
    qs("#notificationSendForm", root)?.addEventListener("submit", handleSend);
    qs("#resetNotificationFormBtn", root)?.addEventListener("click", handleResetForm);
    qs("#clearSendPageStatusBtn", root)?.addEventListener("click", handleClearResults);

    // Delegation داخل target rules container
    const container = getTargetRulesContainer();
    container?.addEventListener("click", function (e) {
      const btnRemove = e.target.closest(".js-remove-rule");
      const btnDuplicate = e.target.closest(".js-duplicate-rule");
      const card = e.target.closest(".target-rule-card");

      if (btnRemove && card) {
        removeTargetRule(card);
        return;
      }

      if (btnDuplicate && card) {
        duplicateTargetRule(card);
        return;
      }
    });

    container?.addEventListener("change", function (e) {
      const card = e.target.closest(".target-rule-card");
      if (!card) return;

      if (e.target.matches(".js-target-type")) {
        renderTargetRuleTypePanel(card);
        applyDefaultValuesForType(card, e.target.value);
        updateRuleCardsMeta();
      }

      debouncedUpdateTargetSummaryUI();
    });

    container?.addEventListener("input", function (e) {
      if (e.target.closest(".target-rule-card")) {
        debouncedUpdateTargetSummaryUI();
      }
    });
  }

  /* =========================
     Init
  ========================== */
  function hydrateInitialUI() {
    renderCategoryCustom();
    clearWarnings();
    clearPreviewSummary();
    clearPreviewBox();
    clearResultMeta();

    ensureAtLeastOneRule();
    updateRuleCardsMeta();
    updateTargetSummaryUI();

    setStatus("جاهز.", "info");
  }

  function init() {
    const root = getRoot();
    if (!root) return;

    bindEventsForCurrentRoot();
    hydrateInitialUI();

    state.initialized = true;
    debug("✅ Admin Notification Send Page (Target Builder) initialized");
  }

  function resetAndInit() {
    // إعادة تهيئة عند التنقل داخل SPA
    state.initialized = false;
    state.lastPreview = null;

    const container = getTargetRulesContainer();
    if (container) container.innerHTML = "";

    init();
  }

  // exposed for SPA routers
  window.initAdminNotificationSendPage = resetAndInit;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();