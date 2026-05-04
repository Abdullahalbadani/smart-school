(function () {
  "use strict";

  console.log("✅ continuing-register.js loaded");

  // ==================== CONFIG ====================
  const API_BASE = window.API_BASE || "http://localhost:5000/api";

  function toApiUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return API_BASE.replace(/\/$/, "") + (url.startsWith("/") ? url : "/" + url);
  }

  function getAuthToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("accessToken") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("jwt") ||
      ""
    );
  }

  async function apiFetch(url, options = {}) {
    const token = getAuthToken();

    const res = await fetch(toApiUrl(url), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  // ==================== INIT (SPA Safe) ====================
  function initContinuingRegister() {
    const root = document.querySelector("#cr-page");
    if (!root) return false;

    if (root.dataset.inited === "1") return true;
    root.dataset.inited = "1";

    const $ = (sel) => root.querySelector(sel);

    const el = {
      fromYear: $("#cr-fromYear"),
      toYear: $("#cr-toYear"),
      grade: $("#cr-grade"),
      section: $("#cr-section"),
      q: $("#cr-q"),

      modeBtns: root.querySelectorAll(".cr-seg-btn"),
      keepSection: $("#cr-keepSection"),
      defaultSection: $("#cr-defaultSection"),

      btnRefresh: $("#cr-btn-refresh"),
      btnPreview: $("#cr-btn-preview"),
      btnRun: $("#cr-btn-run"),

      tbody: $("#cr-tbody"),
      checkAll: $("#cr-checkAll"),

      bulk: $("#cr-bulk"),
      selectedCount: $("#cr-selectedCount"),
      bulkGrade: $("#cr-bulk-grade"),
      bulkSection: $("#cr-bulk-section"),
      bulkApply: $("#cr-bulk-apply"),
      bulkClear: $("#cr-bulk-clear"),

      drawer: $("#cr-drawer"),
      drawerClose: $("#cr-drawer-close"),
      drawerCancel: $("#cr-drawer-cancel"),
      drawerSave: $("#cr-drawer-save"),
      drawerName: $("#cr-drawer-name"),
      drawerSub: $("#cr-drawer-sub"),
      drawerBody: $("#cr-drawer-body"),

      modal: $("#cr-modal"),
      modalClose: $("#cr-modal-close"),
      modalCancel: $("#cr-modal-cancel"),
      modalConfirm: $("#cr-modal-confirm"),
      previewBody: $("#cr-previewBody"),
    };

    // ==================== STATE ====================
    const state = {
      mode: "AUTO", // AUTO | KEEP | MANUAL
      years: [],
      grades: [],
      sectionsByGrade: new Map(),
      rows: [],
      selected: new Set(),
      drawerEditingId: null,
      scrollY: 0,
    };

    // ==================== Scroll Lock ====================
    function lockScroll() {
      state.scrollY = window.scrollY || 0;
      document.body.classList.add("is-scroll-locked");
      document.body.style.top = `-${state.scrollY}px`;
    }
    function unlockScroll() {
      document.body.classList.remove("is-scroll-locked");
      const y = state.scrollY || 0;
      document.body.style.top = "";
      window.scrollTo(0, y);
    }

    // ==================== Utils ====================
    function debounce(fn, ms = 350) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    }

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setOptions(
      select,
      items,
      { value = "id", label = "name", empty = "— اختر —" } = {}
    ) {
      if (!select) return;
      select.innerHTML = "";
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = empty;
      select.appendChild(opt0);

      (items || []).forEach((it) => {
        const o = document.createElement("option");
        o.value = it[value];
        o.textContent = it[label];
        select.appendChild(o);
      });
    }

    function showBulkIfNeeded() {
      const n = state.selected.size;
      if (el.selectedCount) el.selectedCount.textContent = String(n);
      if (!el.bulk) return;
      if (n > 0) el.bulk.classList.remove("sr-hidden");
      else el.bulk.classList.add("sr-hidden");
    }

    function syncCheckAll() {
      if (!el.checkAll || !el.tbody) return;
      const enabled = [...el.tbody.querySelectorAll(".cr-row-check:not([disabled])")];
      const checked = enabled.filter((c) => c.checked);
      if (!enabled.length) {
        el.checkAll.checked = false;
        el.checkAll.indeterminate = false;
        return;
      }
      el.checkAll.checked = checked.length === enabled.length;
      el.checkAll.indeterminate = checked.length > 0 && checked.length < enabled.length;
    }

    function currentParams() {
      return {
        fromYearId: el.fromYear?.value || "",
        toYearId: el.toYear?.value || "",
        gradeId: el.grade?.value || "",
        sectionId: el.section?.value || "",
        q: (el.q?.value || "").trim(),
        mode: state.mode,
        keepSection: el.keepSection?.checked ? 1 : 0,
        defaultSectionId: el.defaultSection?.value || "",
      };
    }

    function sortedGrades() {
      return [...state.grades].sort(
        (a, b) =>
          (a.order_no ?? a.order_index ?? 0) - (b.order_no ?? b.order_index ?? 0)
      );
    }

    function calcAutoToGrade(fromGradeId) {
      const sorted = sortedGrades();
      const idx = sorted.findIndex((x) => String(x.id) === String(fromGradeId));
      return idx >= 0 && sorted[idx + 1] ? String(sorted[idx + 1].id) : "";
    }

    function fillRowDefaults(row) {
      // ملاحظة: نستخدم year_result إن توفر (passed/failed/pending...)
      const yr = String(row.yearResult || "").toLowerCase();

      if (state.mode === "KEEP") {
        row.toGradeId = String(row.fromGradeId || "");
        row.toSectionId = String(row.fromSectionId || "");
        return;
      }

      if (state.mode === "AUTO") {
        if (yr === "failed") {
          // راسب => يبقى نفس الصف
          row.toGradeId = String(row.fromGradeId || "");
        } else {
          // passed أو غير معروف => ترقية للصف التالي إن وجد
          row.toGradeId = calcAutoToGrade(row.fromGradeId);
        }

        if (el.keepSection?.checked) row.toSectionId = String(row.fromSectionId || "");
        else row.toSectionId = el.defaultSection?.value || "";
        return;
      }

      // MANUAL
      row.toGradeId = row.toGradeId || "";
      row.toSectionId = row.toSectionId || (el.defaultSection?.value || "");
    }

    // ==================== API ====================
    const api = {
      getYears: () => apiFetch("/academic-years"),
      getGrades: () => apiFetch("/grades"),
      getSections: (gradeId) => apiFetch(`/sections?grade_id=${encodeURIComponent(gradeId)}`),

      getEligible: (p) => {
        const qs = new URLSearchParams({
          fromYearId: p.fromYearId || "",
          toYearId: p.toYearId || "",
          gradeId: p.gradeId || "",
          sectionId: p.sectionId || "",
          q: p.q || "",
        });
        return apiFetch(`/continuing/eligible?${qs.toString()}`);
      },

      preview: (payload) =>
        apiFetch("/continuing/preview", {
          method: "POST",
          body: JSON.stringify(payload),
        }),

      runBulk: (payload) =>
        apiFetch("/continuing/register-bulk", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
    };

    // ==================== Render ====================
    function buildGradeSelect(studentId, value) {
      const opts = ['<option value="">— اختر الصف —</option>']
        .concat(
          state.grades.map((g) => {
            const sel = String(g.id) === String(value) ? "selected" : "";
            return `<option value="${g.id}" ${sel}>${escapeHtml(g.name)}</option>`;
          })
        )
        .join("");
      return `<select class="cr-miniSel cr-to-grade" data-id="${studentId}">${opts}</select>`;
    }

    function buildSectionSelect(studentId, gradeId, value) {
      const secs = state.sectionsByGrade.get(String(gradeId)) || [];
      const opts = ['<option value="">— اختر الشعبة —</option>']
        .concat(
          secs.map((s) => {
            const sel = String(s.id) === String(value) ? "selected" : "";
            return `<option value="${s.id}" ${sel}>${escapeHtml(s.name)}</option>`;
          })
        )
        .join("");
      return `<select class="cr-miniSel cr-to-section" data-id="${studentId}">${opts}</select>`;
    }

    function resultPill(yearResult) {
      const r = String(yearResult || "pending").toLowerCase();
      if (r === "passed") return `<span class="cr-pill cr-res cr-res-passed">passed</span>`;
      if (r === "failed") return `<span class="cr-pill cr-res cr-res-failed">failed</span>`;
      if (r === "graduated") return `<span class="cr-pill cr-res">graduated</span>`;
      if (r === "transferred") return `<span class="cr-pill cr-res">transferred</span>`;
      if (r === "withdrawn") return `<span class="cr-pill cr-res">withdrawn</span>`;
      return `<span class="cr-pill cr-res cr-res-pending">pending</span>`;
    }

    function renderTable() {
      if (!el.tbody) return;

      if (!state.rows.length) {
        el.tbody.innerHTML = `<tr><td colspan="6" class="cr-empty">لا توجد بيانات. غيّر الفلاتر أو اضغط تحديث.</td></tr>`;
        syncCheckAll();
        return;
      }

      el.tbody.innerHTML = state.rows
        .map((r) => {
          const checked = state.selected.has(String(r.studentId)) ? "checked" : "";
          const currentTxt = `${r.fromGradeName || "—"} / ${r.fromSectionName || "—"}`;

          const toGradeSel = buildGradeSelect(r.studentId, r.toGradeId);
          const toSectionSel = buildSectionSelect(r.studentId, r.toGradeId, r.toSectionId);

          const eligPill = r.eligible
            ? `<span class="cr-pill cr-status-ok">✅ مؤهل</span>`
            : `<span class="cr-pill cr-status-bad" title="${escapeHtml(r.reason || "")}">❌ مستبعد</span>`;

          return `
            <tr data-id="${r.studentId}" class="${r.eligible ? "" : "is-disabled"}">
              <td class="cr-col-check">
                <input type="checkbox" class="cr-row-check" data-id="${r.studentId}" ${checked} ${
            r.eligible ? "" : "disabled"
          } />
              </td>
              <td>
                <div style="display:grid;gap:4px">
                  <strong>${escapeHtml(r.name || "—")}</strong>
                  <span style="color:var(--text-muted);font-size:12px">${escapeHtml(r.code || "")}</span>
                </div>
              </td>
              <td><span class="cr-pill">${escapeHtml(currentTxt)}</span></td>
              <td style="display:grid;gap:8px;min-width:260px">
                ${toGradeSel}
                ${toSectionSel}
              </td>
              <td style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                ${resultPill(r.yearResult)}
                ${eligPill}
              </td>
              <td>
                <button class="cr-btn cr-btn-ghost cr-open" data-id="${r.studentId}" type="button">تفاصيل</button>
              </td>
            </tr>
          `;
        })
        .join("");

      syncCheckAll();
    }

    // ==================== Drawer ====================
    function openDrawer(studentId) {
      const r = state.rows.find((x) => String(x.studentId) === String(studentId));
      if (!r) return;

      state.drawerEditingId = String(studentId);

      if (el.drawerName) el.drawerName.textContent = r.name || "—";
      if (el.drawerSub)
        el.drawerSub.textContent = `${r.fromGradeName || "—"} / ${r.fromSectionName || "—"} • ${
          r.code || ""
        }`;

      if (el.drawerBody) {
        el.drawerBody.innerHTML = `
          <div style="display:grid;gap:12px">
            <label class="cr-field">
              <span>الصف الجديد</span>
              ${buildGradeSelect(r.studentId, r.toGradeId)}
            </label>
            <label class="cr-field">
              <span>الشعبة الجديدة</span>
              ${buildSectionSelect(r.studentId, r.toGradeId, r.toSectionId)}
            </label>
            <label class="cr-field">
              <span>ملاحظة (اختياري)</span>
              <input id="cr-note" placeholder="مثلاً: راسب/نقل شعبة..." value="${escapeHtml(r.note || "")}">
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${resultPill(r.yearResult)}
              ${
                !r.eligible
                  ? `<span class="cr-pill cr-status-bad">سبب الاستبعاد: ${escapeHtml(r.reason || "—")}</span>`
                  : `<span class="cr-pill cr-status-ok">مؤهل</span>`
              }
            </div>
          </div>
        `;
      }

      el.drawer?.classList.remove("sr-hidden");
      el.drawer?.setAttribute("aria-hidden", "false");
      lockScroll();
    }

    function closeDrawer() {
      el.drawer?.classList.add("sr-hidden");
      el.drawer?.setAttribute("aria-hidden", "true");
      state.drawerEditingId = null;
      unlockScroll();
    }

    // ==================== Modal ====================
    function openModal() {
      el.modal?.classList.remove("sr-hidden");
      el.modal?.setAttribute("aria-hidden", "false");
      lockScroll();
    }
    function closeModal() {
      el.modal?.classList.add("sr-hidden");
      el.modal?.setAttribute("aria-hidden", "true");
      unlockScroll();
    }

    // ==================== Build Payload ====================
    function buildPayload() {
      const p = currentParams();

      const selectedRows = state.rows
        .filter((r) => state.selected.has(String(r.studentId)))
        .filter((r) => r.eligible);

      return {
        fromYearId: p.fromYearId,
        toYearId: p.toYearId,
        mode: state.mode,
        keepSection: !!p.keepSection,
        defaultSectionId: p.defaultSectionId || null,
        students: selectedRows.map((r) => ({
          studentId: r.studentId,
          toGradeId: r.toGradeId || null,
          toSectionId: r.toSectionId || null,
          note: r.note || null,
        })),
      };
    }

    // ==================== Loaders ====================
    async function fillSectionsForGrade(gradeId) {
      if (!gradeId) {
        setOptions(el.section, [], { label: "name", empty: "كل الشعب" });
        setOptions(el.defaultSection, [], { label: "name", empty: "— بدون —" });
        setOptions(el.bulkSection, [], { label: "name", empty: "— تعيين شعبة —" });
        return;
      }

      const gid = String(gradeId);
      if (!state.sectionsByGrade.has(gid)) {
        const secRes = await api.getSections(gid);
        state.sectionsByGrade.set(gid, secRes.data || secRes || []);
      }

      const list = state.sectionsByGrade.get(gid) || [];
      setOptions(el.section, list, { label: "name", empty: "كل الشعب" });
      setOptions(el.defaultSection, list, { label: "name", empty: "— بدون —" });
      setOptions(el.bulkSection, list, { label: "name", empty: "— تعيين شعبة —" });
    }

    async function refreshEligible() {
      const p = currentParams();

      if (!p.fromYearId || !p.toYearId) {
        el.tbody.innerHTML = `<tr><td colspan="6" class="cr-empty">اختر السنة المصدر والسنة الهدف أولاً.</td></tr>`;
        return;
      }

      try {
        el.btnRefresh && (el.btnRefresh.disabled = true);
        el.tbody.innerHTML = `<tr><td colspan="6" class="cr-empty">جاري التحميل...</td></tr>`;

        const res = await api.getEligible(p);
        const list = res.data || res || [];

        state.selected.clear();
        showBulkIfNeeded();
        el.checkAll && (el.checkAll.checked = false);

        state.rows = list.map((x) => {
          const r = {
            studentId: x.student_id ?? x.id,
            name: x.name,
            code: x.code || x.student_code || "",
            fromGradeId: x.grade_id,
            fromGradeName: x.grade_name,
            fromSectionId: x.section_id,
            fromSectionName: x.section_name,
            yearResult: x.year_result || x.result || "pending",
            eligible: x.eligible !== false,
            reason: x.reason || "",
            toGradeId: "",
            toSectionId: "",
            note: "",
          };
          fillRowDefaults(r);
          return r;
        });

        renderTable();
      } catch (e) {
        el.tbody.innerHTML = `<tr><td colspan="6" class="cr-empty">خطأ: ${escapeHtml(e.message)}</td></tr>`;
      } finally {
        el.btnRefresh && (el.btnRefresh.disabled = false);
      }
    }

    const autoRefresh = debounce(refreshEligible, 350);

    async function loadInitial() {
      try {
        const [yearsRes, gradesRes] = await Promise.all([api.getYears(), api.getGrades()]);
        state.years = yearsRes.data || yearsRes || [];
        state.grades = gradesRes.data || gradesRes || [];

        setOptions(el.fromYear, state.years, { label: "name" });
        setOptions(el.toYear, state.years, { label: "name" });

        setOptions(el.grade, state.grades, { label: "name", empty: "كل الصفوف" });
        setOptions(el.bulkGrade, state.grades, { label: "name", empty: "— تعيين صف —" });

        // ✅ اختيار افتراضي (آخر سنتين) لتسهل التجربة
        if (!el.fromYear.value && state.years.length >= 2) {
          el.fromYear.value = String(state.years[state.years.length - 2].id);
          el.toYear.value = String(state.years[state.years.length - 1].id);
        }

        await fillSectionsForGrade(el.grade?.value || "");

        // ✅ تحميل تلقائي أول مرة
        autoRefresh();
      } catch (e) {
        el.tbody.innerHTML = `<tr><td colspan="6" class="cr-empty">خطأ: ${escapeHtml(e.message)}</td></tr>`;
      }
    }

    // ==================== Events ====================
    el.modeBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.modeBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.mode = btn.dataset.mode || "AUTO";
        state.rows.forEach((r) => fillRowDefaults(r));
        renderTable();
      });
    });

    // ✅ تحديث تلقائي عند أي تغيير فلاتر
    el.fromYear?.addEventListener("change", autoRefresh);
    el.toYear?.addEventListener("change", autoRefresh);

    el.grade?.addEventListener("change", async () => {
      await fillSectionsForGrade(el.grade.value);
      autoRefresh();
    });

    el.section?.addEventListener("change", autoRefresh);

    // ✅ بحث حي
    el.q?.addEventListener("input", autoRefresh);

    // زر تحديث (يبقى موجود)
    el.btnRefresh?.addEventListener("click", refreshEligible);

    el.keepSection?.addEventListener("change", () => {
      state.rows.forEach((r) => fillRowDefaults(r));
      renderTable();
    });

    el.defaultSection?.addEventListener("change", () => {
      state.rows.forEach((r) => fillRowDefaults(r));
      renderTable();
    });

    // تغيير checkbox / selects
    el.tbody?.addEventListener("change", async (e) => {
      const t = e.target;

      if (t.classList.contains("cr-row-check")) {
        const id = String(t.dataset.id);
        if (t.checked) state.selected.add(id);
        else state.selected.delete(id);
        showBulkIfNeeded();
        syncCheckAll();
        return;
      }

      if (t.classList.contains("cr-to-grade")) {
        const id = String(t.dataset.id);
        const row = state.rows.find((x) => String(x.studentId) === id);
        if (!row) return;

        row.toGradeId = t.value || "";

        if (row.toGradeId && !state.sectionsByGrade.has(String(row.toGradeId))) {
          try {
            const secRes = await api.getSections(row.toGradeId);
            state.sectionsByGrade.set(String(row.toGradeId), secRes.data || secRes || []);
          } catch {}
        }

        row.toSectionId = el.keepSection?.checked
          ? String(row.fromSectionId || "")
          : el.defaultSection?.value || "";
        renderTable();
        return;
      }

      if (t.classList.contains("cr-to-section")) {
        const id = String(t.dataset.id);
        const row = state.rows.find((x) => String(x.studentId) === id);
        if (!row) return;
        row.toSectionId = t.value || "";
      }
    });

    // ✅ ضغط على الصف لتحديد الطالب
    el.tbody?.addEventListener("click", (e) => {
      // زر التفاصيل
      const openBtn = e.target.closest(".cr-open");
      if (openBtn) {
        openDrawer(openBtn.dataset.id);
        return;
      }

      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;

      // تجاهل الضغط على عناصر تفاعلية
      if (e.target.closest("select, button, a, input")) return;

      const cb = tr.querySelector(".cr-row-check");
      if (!cb) return;

      if (cb.disabled) {
        const id = String(tr.dataset.id);
        const row = state.rows.find((x) => String(x.studentId) === id);
        alert(row?.reason ? `غير مؤهل: ${row.reason}` : "هذا الطالب غير مؤهل للترحيل");
        return;
      }

      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });

    el.checkAll?.addEventListener("change", () => {
      const checks = el.tbody?.querySelectorAll(".cr-row-check:not([disabled])") || [];
      checks.forEach((c) => {
        c.checked = el.checkAll.checked;
        const id = String(c.dataset.id);
        if (c.checked) state.selected.add(id);
        else state.selected.delete(id);
      });
      showBulkIfNeeded();
      syncCheckAll();
    });

    el.bulkApply?.addEventListener("click", () => {
      const g = el.bulkGrade?.value || "";
      const s = el.bulkSection?.value || "";

      state.rows.forEach((r) => {
        if (!r.eligible) return;
        if (!state.selected.has(String(r.studentId))) return;
        if (g) r.toGradeId = g;
        if (s) r.toSectionId = s;
      });

      renderTable();
    });

    el.bulkClear?.addEventListener("click", () => {
      state.selected.clear();
      el.checkAll && (el.checkAll.checked = false);
      const checks = el.tbody?.querySelectorAll(".cr-row-check") || [];
      checks.forEach((c) => (c.checked = false));
      showBulkIfNeeded();
      syncCheckAll();
    });

    el.drawerClose?.addEventListener("click", closeDrawer);
    el.drawerCancel?.addEventListener("click", closeDrawer);

    el.drawerSave?.addEventListener("click", () => {
      const id = state.drawerEditingId;
      if (!id) return;

      const row = state.rows.find((x) => String(x.studentId) === id);
      if (!row) return;

      const gradeSel = el.drawerBody?.querySelector(".cr-to-grade");
      const secSel = el.drawerBody?.querySelector(".cr-to-section");
      const note = el.drawerBody?.querySelector("#cr-note");

      row.toGradeId = gradeSel?.value || row.toGradeId;
      row.toSectionId = secSel?.value || row.toSectionId;
      row.note = note?.value || "";

      renderTable();
      closeDrawer();
    });

    el.btnPreview?.addEventListener("click", async () => {
      try {
        const payload = buildPayload();
        if (!payload.fromYearId || !payload.toYearId) throw new Error("اختر السنة المصدر والهدف");
        if (!payload.students.length) throw new Error("حدد طلابًا مؤهلين أولاً");

        el.previewBody && (el.previewBody.innerHTML = `<div class="cr-empty">جاري إعداد المعاينة...</div>`);
        openModal();

        const res = await api.preview(payload);
        const summary = res.summary || res.data || res;

        el.previewBody &&
          (el.previewBody.innerHTML = `
            <div style="display:grid;gap:10px">
              <div class="cr-pill cr-status-ok">✅ سيتم ترحيل: ${summary.willRegister ?? payload.students.length}</div>
              <div class="cr-pill">⚙️ وضع: ${escapeHtml(payload.mode)}</div>
              ${summary.blocked ? `<div class="cr-pill cr-status-bad">❌ مستبعد: ${summary.blocked}</div>` : ""}
              <div style="color:var(--text-muted);font-size:13px">اضغط "تنفيذ الآن" للبدء.</div>
            </div>
          `);
      } catch (e) {
        alert(e.message);
      }
    });

    el.modalClose?.addEventListener("click", closeModal);
    el.modalCancel?.addEventListener("click", closeModal);

    async function runNow() {
      const payload = buildPayload();
      if (!payload.fromYearId || !payload.toYearId) throw new Error("اختر السنة المصدر والهدف");
      if (!payload.students.length) throw new Error("حدد طلابًا مؤهلين أولاً");

      const missing = payload.students.filter((s) => !s.toGradeId);
      if (missing.length) throw new Error("هناك طلاب لم تحدد لهم الصف الجديد.");

      el.btnRun && (el.btnRun.disabled = true);

      const res = await api.runBulk(payload);

      alert(`تم الترحيل بنجاح ✅ (المُسجّل: ${res.registered_count ?? payload.students.length} | المتجاوز: ${res.skipped_count ?? 0})`);
      closeModal();
      await refreshEligible();
    }

    el.btnRun?.addEventListener("click", async () => {
      try {
        await runNow();
      } catch (e) {
        alert(e.message);
      } finally {
        el.btnRun && (el.btnRun.disabled = false);
      }
    });

    el.modalConfirm?.addEventListener("click", async () => {
      try {
        await runNow();
      } catch (e) {
        alert(e.message);
      } finally {
        el.btnRun && (el.btnRun.disabled = false);
      }
    });

    // ==================== Start ====================
    loadInitial();
    return true;
  }

  if (!initContinuingRegister()) {
    const obs = new MutationObserver(() => {
      if (initContinuingRegister()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
