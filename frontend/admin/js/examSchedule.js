// frontend/admin/js/examSchedule.js
(function () {
  "use strict";

  // ==============================
  // Date/Time Normalizers
  // ==============================
  const RTL_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g;

  function toLatinDigits(str) {
    const s = String(str ?? "");
    const ar = "٠١٢٣٤٥٦٧٨٩";
    const fa = "۰۱۲۳۴۵۶۷۸۹";
    return s
      .split("")
      .map((ch) => {
        const ia = ar.indexOf(ch);
        if (ia !== -1) return String(ia);
        const ifa = fa.indexOf(ch);
        if (ifa !== -1) return String(ifa);
        return ch;
      })
      .join("");
  }

  function normalizeDateISO(input) {
    let s = toLatinDigits(String(input || "")).replace(RTL_MARKS, "").trim();
    if (!s) return null;

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    s = s.replace(/\./g, "/").replace(/-/g, "/").replace(/\s+/g, "");

    let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
    }

    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
    }

    return null;
  }

  function normalizeTimeHHMM(input) {
    let s = toLatinDigits(String(input || "")).replace(RTL_MARKS, "").trim();
    if (!s) return null;

    const m = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
    if (!m) return null;

    const h = +m[1];
    const mi = +m[2];

    if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;

    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }

  // ==============================
  // Anti-double-load guard
  // ==============================
  window.__EXAM_SCHEDULE_LOADS__ = (window.__EXAM_SCHEDULE_LOADS__ || 0) + 1;

  if (window.__EXAM_SCHEDULE_JS_LOADED__) return;
  window.__EXAM_SCHEDULE_JS_LOADED__ = true;

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
  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

async function apiGet(path) {
  const r = await fetch(apiUrl(path), {
    headers: { ...authHeaders() },
  });

  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }

  if (!r.ok) {
    const msg = data?.message || data?.error || `API GET failed: ${path}`;
    throw new Error(msg);
  }

  return data;
}

async function apiSend(path, method, body) {
  const opts = {
    method,
    headers: { ...authHeaders() },
  };

  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body || {});
  }

  const r = await fetch(apiUrl(path), opts);

  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }

  if (!r.ok) {
    const msg = data?.message || data?.error || `API ${method} failed: ${path}`;
    const err = new Error(msg);
    err.payload = data;
    err.status = r.status;
    throw err;
  }

  return data;
}

  // ==============================
  // Fallback meta
  // ==============================
  const fallbackMeta = {
    years: [],
    stages: [],
    grades: [],
    sections: [],
    subjects: [],
  };

  let meta = null;
  let currentTimetableId = null;
  let currentTimetableStatus = "draft";
  let selectedRowId = null;
  let entries = [];
  let autosaveTimer = null;

  const LS_EX_LAST_TID = "ex_last_timetable_id";
  const LS_EX_LAST_SEL = "ex_last_selection";

  function persistLast(tid, selObj) {
    try {
      if (tid) localStorage.setItem(LS_EX_LAST_TID, String(tid));
      if (selObj) localStorage.setItem(LS_EX_LAST_SEL, JSON.stringify(selObj));
    } catch {}
  }

  function clearPersistedLast() {
    try {
      localStorage.removeItem(LS_EX_LAST_TID);
      localStorage.removeItem(LS_EX_LAST_SEL);
    } catch {}
  }

  function el(sel, root = document) {
    return root.querySelector(sel);
  }

 function toast(msg, type = "ok") {
  const finalType = type === "err" ? "error" : "success";

  if (window.AppUI?.toast) {
    window.AppUI.toast(msg, finalType);
    return;
  }

  const t = document.querySelector("#exToast");
  if (!t) return;
  t.className = "ex-toast ex-show " + (type === "err" ? "ex-err" : "ex-ok");
  t.textContent = msg;
  setTimeout(() => t.classList.remove("ex-show"), 1800);
}

async function exConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  return confirm(options.message || "هل تريد المتابعة؟");
}

async function exPrompt(options = {}) {
  if (window.AppUI?.prompt) {
    return await window.AppUI.prompt(options);
  }

  return prompt(options.message || "اكتب البيانات", options.defaultValue || "");
}
  function setStatusChip(status) {
    const chip = document.querySelector("#exStatusChip");
    if (!chip) return;
    const map = { draft: "مسودة", published: "منشور", "-": "—" };
    chip.textContent = "الحالة: " + (map[status] || status || "—");
  }

  function setCountChip(n) {
    const c = document.querySelector("#exCountChip");
    if (!c) return;
    c.textContent = "عدد الاختبارات: " + String(n || 0);
  }

  function setInfo(msg) {
    const i = document.querySelector("#exInfoChip");
    if (!i) return;
    i.textContent = msg || "";
  }

  function syncPublishButtons() {
    const publishBtn = document.querySelector("#exPublishBtn");
    const unpublishBtn = document.querySelector("#exUnpublishBtn");

    if (!publishBtn || !unpublishBtn) return;

    if (!currentTimetableId) {
      publishBtn.style.display = "none";
      unpublishBtn.style.display = "none";
      return;
    }

    if (currentTimetableStatus === "published") {
      publishBtn.style.display = "none";
      unpublishBtn.style.display = "";
      return;
    }

    publishBtn.style.display = "";
    unpublishBtn.style.display = "none";
  }

  function openDrawer() {
    document.documentElement.classList.add("ex-open");
    document.querySelector("#exDrawer")?.setAttribute("aria-hidden", "false");
    document.querySelector("#exDrawerBackdrop")?.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    document.documentElement.classList.remove("ex-open");
    document.querySelector("#exDrawer")?.setAttribute("aria-hidden", "true");
    document.querySelector("#exDrawerBackdrop")?.setAttribute("aria-hidden", "true");
    selectedRowId = null;
  }

  function openManage() {
    document.querySelector("#exManageBackdrop")?.setAttribute("aria-hidden", "false");
    document.querySelector("#exManageModal")?.setAttribute("aria-hidden", "false");
  }

  function closeManage() {
    document.querySelector("#exManageBackdrop")?.setAttribute("aria-hidden", "true");
    document.querySelector("#exManageModal")?.setAttribute("aria-hidden", "true");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fillSelect(sel, items, placeholder = "اختر...") {
    if (!sel) return;
    sel.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = placeholder;
    sel.appendChild(o0);

    (items || []).forEach((it) => {
      const o = document.createElement("option");
      o.value = it.id;
      o.textContent = it.name;
      sel.appendChild(o);
    });
  }

  function formatTypeName(t) {
    if (t === "midyear") return "نصف العام";
    if (t === "final") return "آخر العام";
    return t || "—";
  }

  function getArabicDayName(dateStr) {
  const iso = normalizeDateISO(dateStr);
  if (!iso) return "—";

  const d = parseISODateUTC(iso);
  if (!d) return "—";

  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return days[d.getUTCDay()] || "—";
}

  function toISODateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

function addDaysISO(isoDate, days) {
  const d = parseISODateUTC(isoDate);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

 function getStartOfWeekISO(isoDate) {
  const d = parseISODateUTC(isoDate);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function parseISODateUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
  function rebuildWeekDateSelect(selectedValue = "") {
    const root = document.getElementById("examSchedulePage") || document;
    const weekStart = normalizeDateISO(el("#exWeekStartInp", root)?.value || "");
    const weekSel = el("#exWeekDateSelect", root);
    const dateInp = el("#exDateInp", root);

    if (!weekSel) return;

    weekSel.innerHTML = `<option value="">اختر اليوم...</option>`;

    if (!weekStart) {
      if (dateInp) dateInp.value = "";
      return;
    }

    for (let i = 0; i < 7; i++) {
      const iso = addDaysISO(weekStart, i);
      const opt = document.createElement("option");
      opt.value = iso;
      opt.textContent = `${getArabicDayName(iso)} - ${iso}`;
      weekSel.appendChild(opt);
    }

    if (selectedValue) weekSel.value = selectedValue;
    if (dateInp) dateInp.value = weekSel.value || "";
  }

  function uid() {
    return "ex_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function createEmptyExamRow() {
    return {
      id: uid(),
      date: "",
      start_time: "",
      end_time: "",
      subjectId: null,
      subjectName: "",
      room: "",
      notes: "",
      applyToSectionId: null,
      applyToSectionName: null,
    };
  }

  function timeToMinutes(anyTime) {
    const t = normalizeTimeHHMM(anyTime);
    if (!t) return null;
    const [h, m] = t.split(":").map((x) => Number(x));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function normalizeSelection(sel) {
    const s = { ...(sel || {}) };
    s.academicYearId = Number(s.academicYearId) || null;
    s.stageId = Number(s.stageId) || null;
    s.gradeId = Number(s.gradeId) || null;
    s.sectionId = Number(s.sectionId) || null;
    s.examType = String(s.examType || "");
    s.scope = String(s.scope || "");

    if (s.scope !== "section") s.sectionId = null;
    return s;
  }

  function getSelection() {
    const root = document.getElementById("examSchedulePage") || document;
    const academicYearId = Number(el("#exYearSelect", root)?.value) || null;
    const examType = el("#exTypeSelect", root)?.value || "";
    const stageId = Number(el("#exStageSelect", root)?.value) || null;
    const gradeId = Number(el("#exGradeSelect", root)?.value) || null;
    const scope = el("#exScopeSelect", root)?.value || "";
    const sectionIdRaw = Number(el("#exSectionSelect", root)?.value) || null;

    return normalizeSelection({
      academicYearId,
      examType,
      stageId,
      gradeId,
      scope,
      sectionId: scope === "section" ? sectionIdRaw : null,
    });
  }

  function selectionOk(sel) {
    const s = normalizeSelection(sel);
    if (!s.academicYearId || !s.examType || !s.stageId || !s.gradeId || !s.scope) return false;
    if (s.scope === "section" && !s.sectionId) return false;
    return true;
  }

  function filterGradesByStage(stageId) {
    const all = meta?.grades || [];
    if (!stageId) return all;
    if (!all.length) return all;
    if (!("stage_id" in all[0]) && !("stageId" in all[0])) return all;
    return all.filter((g) => String(g.stage_id ?? g.stageId) === String(stageId));
  }

  function filterSectionsByGrade(gradeId) {
    const all = meta?.sections || [];
    if (!gradeId) return all;
    if (!all.length) return all;
    if (!("grade_id" in all[0]) && !("gradeId" in all[0])) return all;
    return all.filter((s) => String(s.grade_id ?? s.gradeId) === String(gradeId));
  }

  function rebuildGradeOptions() {
    const root = document.getElementById("examSchedulePage") || document;
    const stageId = Number(el("#exStageSelect", root)?.value) || null;
    const grades = filterGradesByStage(stageId);
    fillSelect(el("#exGradeSelect", root), grades, "اختر الصف...");
  }

  function rebuildSectionOptions() {
    const root = document.getElementById("examSchedulePage") || document;
    const gradeId = Number(el("#exGradeSelect", root)?.value) || null;
    const sections = filterSectionsByGrade(gradeId);
    fillSelect(el("#exSectionSelect", root), sections, "اختر الشعبة...");
    rebuildApplyToSelect();
  }

  function rebuildApplyToSelect() {
    const root = document.getElementById("examSchedulePage") || document;
    const applySel = el("#exApplyToSelect", root);
    if (!applySel) return;

    const scope = el("#exScopeSelect", root)?.value || "";
    const sections = filterSectionsByGrade(Number(el("#exGradeSelect", root)?.value) || null);

    applySel.innerHTML = "";

    const oAll = document.createElement("option");
    oAll.value = "all";
    oAll.textContent = "كل الشعب";
    applySel.appendChild(oAll);

    const applyWrap = el(".ex-applyWrap", root);
    if (applyWrap) applyWrap.style.display = scope === "grade" ? "" : "none";

    if (scope === "grade") {
      (sections || []).forEach((s) => {
        const o = document.createElement("option");
        o.value = String(s.id);
        o.textContent = "شعبة: " + (s.name || s.id);
        applySel.appendChild(o);
      });
    }
  }

  function syncTypeMonthUI() {
    const wrap = document.querySelector("#exMonthWrap");
    if (wrap) wrap.style.display = "none";
  }

  function syncScopeUI() {
    const root = document.getElementById("examSchedulePage") || document;
    const scope = el("#exScopeSelect", root)?.value || "";
    const sec = el("#exSectionSelect", root);
    if (!sec) return;

    if (scope === "section") {
      sec.disabled = false;
    } else {
      sec.disabled = true;
      sec.value = "";
    }

    const showApply = scope === "grade";
    root.querySelectorAll(".ex-colApply").forEach((th) => (th.style.display = showApply ? "" : "none"));
    root.querySelectorAll("td.ex-applyCell").forEach((td) => (td.style.display = showApply ? "" : "none"));

    rebuildApplyToSelect();
  }

  function applySelectionToUI(sel) {
    const root = document.getElementById("examSchedulePage") || document;
    if (!sel) return;
    const s = normalizeSelection(sel);

    const yearSel = el("#exYearSelect", root);
    const typeSel = el("#exTypeSelect", root);
    const stageSel = el("#exStageSelect", root);
    const gradeSel = el("#exGradeSelect", root);
    const scopeSel = el("#exScopeSelect", root);
    const sectionSel = el("#exSectionSelect", root);

    if (yearSel) yearSel.value = s.academicYearId || "";
    if (typeSel) typeSel.value = s.examType || "";

    syncTypeMonthUI();

    if (stageSel) stageSel.value = s.stageId || "";
    rebuildGradeOptions();

    if (gradeSel) gradeSel.value = s.gradeId || "";
    rebuildSectionOptions();

    if (scopeSel) scopeSel.value = s.scope || "";
    syncScopeUI();

    if (sectionSel) sectionSel.value = s.scope === "section" ? (s.sectionId || "") : "";
    syncScopeUI();
  }

  function resetExamScheduleToDefaults(infoMsg = "تم تصفير الصفحة. اختر الفلاتر ثم افتح جدول جديد.") {
    const root = document.getElementById("examSchedulePage") || document;

    try {
      clearTimeout(autosaveTimer);
    } catch {}
    autosaveTimer = null;

    try {
      closeDrawer();
    } catch {}
    try {
      closeManage();
    } catch {}

    currentTimetableId = null;
    currentTimetableStatus = "draft";
    selectedRowId = null;
    entries = [];

    clearPersistedLast();

    const idsToClear = [
      "#exYearSelect",
      "#exTypeSelect",
      "#exStageSelect",
      "#exGradeSelect",
      "#exScopeSelect",
      "#exSectionSelect",
      "#exWeekStartInp",
      "#exWeekDateSelect",
      "#exDateInp",
    ];

    idsToClear.forEach((s) => {
      const node = el(s, root);
      if (node) node.value = "";
    });

    const secSearch = el("#exSectionSearch", root);
    if (secSearch) secSearch.value = "";

    rebuildGradeOptions();
    rebuildSectionOptions();
    rebuildWeekDateSelect();
    syncTypeMonthUI();
    syncScopeUI();

    setStatusChip("-");
    syncPublishButtons();
    setCountChip(0);
    setInfo(infoMsg);
    renderTable();
  }

  async function restoreLastIfAny() {
    const lastId = Number(localStorage.getItem(LS_EX_LAST_TID) || "");
    if (Number.isFinite(lastId) && lastId > 0) {
      try {
        await openByTimetableId(lastId);
        return true;
      } catch (e) {
        console.warn("restore by id failed:", e);
        clearPersistedLast();
      }
    }

    try {
      const raw = localStorage.getItem(LS_EX_LAST_SEL);
      if (!raw) return false;

      const sel = normalizeSelection(JSON.parse(raw));
      await loadMeta(false);
      applySelectionToUI(sel);

      const s2 = getSelection();
      if (selectionOk(s2)) {
        await createOrOpenTimetable();
        return true;
      }
    } catch (e) {
      console.warn("restore by selection failed:", e);
    }

    return false;
  }

  function renderTable() {
    const root = document.getElementById("examSchedulePage");
    if (!root) return;

    const tbody = el("#exTbody", root);
    if (!tbody) return;

    const scope = el("#exScopeSelect", root)?.value || "";
    const sectionId = Number(el("#exSectionSelect", root)?.value) || null;

    let rows = [...entries];

    if (scope === "section" && sectionId) {
      rows = rows.filter((r) => r.applyToSectionId == null || String(r.applyToSectionId) === String(sectionId));
    }

    tbody.innerHTML = "";

    if (!currentTimetableId) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="ex-emptyRow">
            <div class="ex-empty">
              <i class="ri-calendar-event-line"></i>
              <div><b>لا يوجد جدول مفتوح</b><div>اختر الفلاتر ثم افتح جدولًا.</div></div>
            </div>
          </td>
        </tr>
      `;
      setCountChip(0);
      syncPublishButtons();
      return;
    }

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="ex-emptyRow">
            <div class="ex-empty">
              <i class="ri-inbox-2-line"></i>
              <div><b>لا توجد اختبارات</b><div>اضغط (إضافة اختبار) لبدء الجدول.</div></div>
            </div>
          </td>
        </tr>
      `;
      setCountChip(0);
      syncPublishButtons();
      return;
    }

    rows.sort(
      (a, b) =>
        String(a.date || "").localeCompare(String(b.date || "")) ||
        String(a.start_time || "").localeCompare(String(b.start_time || ""))
    );

    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.dataset.rowId = String(r.id);

      const dayName = getArabicDayName(r.date);
      const applyText =
        r.applyToSectionId == null ? "كل الشعب" : "شعبة: " + (r.applyToSectionName || r.applyToSectionId);

      tr.innerHTML = `
        <td>${escapeHtml(r.date || "—")}</td>
        <td>${escapeHtml(dayName)}</td>
        <td>${escapeHtml((r.start_time || "").slice(0, 5) || "—")}</td>
        <td>${escapeHtml((r.end_time || "").slice(0, 5) || "—")}</td>
        <td>${escapeHtml(r.subjectName || "—")}</td>
        <td>${escapeHtml(r.room || "—")}</td>
        <td>${escapeHtml(r.notes || "—")}</td>
        <td class="ex-applyCell ex-colApply">${escapeHtml(applyText)}</td>
        <td style="white-space:nowrap;">
          <button class="ex-miniBtn" data-act="edit"><i class="ri-edit-line"></i><span>تعديل</span></button>
          <button class="ex-miniBtn del" data-act="del"><i class="ri-delete-bin-6-line"></i><span>حذف</span></button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    syncScopeUI();
    syncPublishButtons();
    setCountChip(rows.length);
  }

  function entryHasAnyValue(e) {
    const date = String(e.date || "").replace(RTL_MARKS, "").trim();
    const st = String(e.start_time || "").replace(RTL_MARKS, "").trim();
    const en = String(e.end_time || "").replace(RTL_MARKS, "").trim();
    return Boolean(
      date ||
        st ||
        en ||
        e.subjectId ||
        String(e.room || "").trim() ||
        String(e.notes || "").trim() ||
        e.applyToSectionId
    );
  }

  function validateEntries(strict, showToastOnFail) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!entryHasAnyValue(e)) continue;

      const idx = i + 1;
      const isoDate = normalizeDateISO(e.date);

      if (!isoDate) {
        if (showToastOnFail) toast(`السطر ${idx}: صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD أو DD/MM/YYYY.`, "err");
        return { ok: false, index: i, reason: "date_format" };
      }

      const subjectId = Number(e.subjectId) || null;
      if (!subjectId) {
        if (showToastOnFail) toast(`السطر ${idx}: المادة مطلوبة.`, "err");
        return { ok: false, index: i, reason: "subject" };
      }

      const st = normalizeTimeHHMM(e.start_time);
      const en = normalizeTimeHHMM(e.end_time);

      if (!st || !en) {
        if (showToastOnFail) toast(`السطر ${idx}: وقت (من/إلى) مطلوب.`, "err");
        return { ok: false, index: i, reason: "time" };
      }

      const sm = timeToMinutes(st);
      const em = timeToMinutes(en);

      if (sm == null || em == null) {
        if (showToastOnFail) toast(`السطر ${idx}: صيغة الوقت غير صحيحة.`, "err");
        return { ok: false, index: i, reason: "time_format" };
      }

      if (sm >= em) {
        if (showToastOnFail) toast(`السطر ${idx}: وقت البداية يجب أن يكون أقل من النهاية.`, "err");
        return { ok: false, index: i, reason: "time_order" };
      }

      e.date = isoDate;
      e.start_time = st;
      e.end_time = en;

      if (strict) {
        // reserved
      }
    }
    return { ok: true };
  }

  function queueAutosave(reason = "") {
    if (!currentTimetableId) return;
    if (currentTimetableStatus === "published") return;

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const v = validateEntries(false, false);
      if (!v.ok) {
        console.log("[autosave skipped]", reason, "due to invalid row", v);
        return;
      }

      try {
        await saveDraft(true);
        await reloadCurrentTimetable();
        console.log("[autosave ok]", reason, "count:", entries.length);
      } catch (e) {
        console.warn("[autosave failed]", reason, e);
      }
    }, 300);
  }

 function openRowEditor(rowId) {
  const root = document.getElementById("examSchedulePage") || document;
  const rid = String(rowId);
  const r = entries.find((x) => String(x.id) === rid);
  if (!r) return;

  selectedRowId = rid;

  const iso = normalizeDateISO(r.date) || "";
  if (iso) r.date = iso;

  const sub = el("#exDrawerSub", root);
  if (sub) {
    const type = formatTypeName(el("#exTypeSelect", root)?.value);
    sub.textContent = `${type} • ${getArabicDayName(r.date)} • ${r.date || "—"}`;
  }

  // مهم: لا نغير بداية الأسبوع هنا
  rebuildWeekDateSelect(r.date || "");

  el("#exDateInp", root).value = r.date || "";
  el("#exStartInp", root).value = normalizeTimeHHMM(r.start_time) || "";
  el("#exEndInp", root).value = normalizeTimeHHMM(r.end_time) || "";
  el("#exSubjectSelect", root).value = r.subjectId || "";
  el("#exRoomInp", root).value = r.room || "";
  el("#exNotesInp", root).value = r.notes || "";

  const scope = el("#exScopeSelect", root)?.value || "";
  rebuildApplyToSelect();
  if (scope === "grade") {
    el("#exApplyToSelect", root).value = r.applyToSectionId == null ? "all" : String(r.applyToSectionId);
  }

  openDrawer();
}

 function saveRowFromDrawer(closeAfter = true, doAutosave = true) {
  const root = document.getElementById("examSchedulePage") || document;
  if (!selectedRowId) return false;

  const r = entries.find((x) => String(x.id) === String(selectedRowId));
  if (!r) return false;

  const subjectId = Number(el("#exSubjectSelect", root)?.value) || null;
  if (!subjectId) {
    toast("اختر المادة أولاً.", "err");
    return false;
  }

  const dateISO = normalizeDateISO(el("#exWeekDateSelect", root)?.value || "");
  if (!dateISO) {
    toast("اختر يوم الاختبار من الصندوق أولاً.", "err");
    return false;
  }

  const stRaw = el("#exStartInp", root)?.value || "";
  const enRaw = el("#exEndInp", root)?.value || "";

  const st = normalizeTimeHHMM(stRaw);
  const en = normalizeTimeHHMM(enRaw);

  if (!st || !en) {
    toast("حدد وقت (من/إلى) بصيغة HH:MM.", "err");
    return false;
  }

  const sm = timeToMinutes(st);
  const em = timeToMinutes(en);

  if (sm == null || em == null) {
    toast("صيغة الوقت غير صحيحة.", "err");
    return false;
  }

  if (sm >= em) {
    toast("وقت البداية يجب أن يكون أقل من النهاية.", "err");
    return false;
  }

  r.date = dateISO;
  r.start_time = st;
  r.end_time = en;
  r.subjectId = subjectId;
  r.subjectName =
    (meta?.subjects || []).find((s) => String(s.id) === String(subjectId))?.name || r.subjectName || "";
  r.room = (el("#exRoomInp", root)?.value || "").trim();
  r.notes = (el("#exNotesInp", root)?.value || "").trim();

  const scope = el("#exScopeSelect", root)?.value || "";
  if (scope === "grade") {
    const v = el("#exApplyToSelect", root)?.value;
    r.applyToSectionId = v === "all" ? null : Number(v);
    r.applyToSectionName =
      r.applyToSectionId == null
        ? null
        : (meta?.sections || []).find((s) => String(s.id) === String(r.applyToSectionId))?.name || null;
  } else {
    r.applyToSectionId = null;
    r.applyToSectionName = null;
  }

  renderTable();
  if (closeAfter) closeDrawer();
  toast("تم حفظ الاختبار.", "ok");

  if (doAutosave) {
    queueAutosave("drawer-save");
  }

  return true;
}

  function deleteRow(rowId) {
    const rid = String(rowId);
    entries = entries.filter((x) => String(x.id) !== rid);
    renderTable();
    toast("تم حذف الاختبار.", "ok");
    queueAutosave("row-delete");
  }

  function addNewRow() {
    if (!currentTimetableId) return toast("افتح جدول أولاً.", "err");
    if (currentTimetableStatus === "published") return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");

    const root = document.getElementById("examSchedulePage") || document;
    const weekStart = normalizeDateISO(el("#exWeekStartInp", root)?.value || "");
    if (!weekStart) return toast("اختر بداية أسبوع الاختبارات أولاً.", "err");

    const newRow = createEmptyExamRow();
    entries.push(newRow);
    renderTable();
    openRowEditor(newRow.id);
  }

  async function loadMeta(force = false) {
    if (meta && !force) return;

    try {
      const res = await apiGet("/exam-timetables/meta");
      meta = res.data || res;
    } catch (e) {
      console.error(e);
      meta =
        typeof structuredClone === "function"
          ? structuredClone(fallbackMeta)
          : JSON.parse(JSON.stringify(fallbackMeta));
      toast("تعذر تحميل البيانات — تم استخدام بيانات تجريبية.", "err");
    }

    const root = document.getElementById("examSchedulePage") || document;

    fillSelect(el("#exYearSelect", root), meta.years, "اختر السنة...");
    fillSelect(el("#exStageSelect", root), meta.stages, "اختر المرحلة...");
    fillSelect(el("#exGradeSelect", root), meta.grades, "اختر الصف...");
    fillSelect(el("#exSectionSelect", root), meta.sections, "اختر الشعبة...");
    fillSelect(el("#exSubjectSelect", root), meta.subjects, "اختر المادة...");

    rebuildApplyToSelect();
    syncTypeMonthUI();
    syncScopeUI();
  }

  async function createOrOpenTimetable() {
    const sel = getSelection();
    if (!selectionOk(sel)) {
      return toast("لازم تختار: السنة + النوع + المرحلة + الصف + النطاق.", "err");
    }

    setInfo("جاري فتح جدول الاختبارات...");
    try {
      const r1 = await apiSend("/exam-timetables/get-or-create", "POST", sel);
      currentTimetableId = r1.data?.id || r1.data?.timetableId || r1.id;
      currentTimetableStatus = r1.data?.status || r1.status || "draft";

      persistLast(currentTimetableId, normalizeSelection(getSelection()));

      setStatusChip(currentTimetableStatus);
      syncPublishButtons();

      await reloadCurrentTimetable();

      setInfo(`تم فتح الجدول (#${currentTimetableId}) — عدّل ثم احفظ.`);
      toast("تم فتح الجدول.", "ok");
    } catch (e) {
      console.error(e);
      setInfo("تعذر فتح الجدول.");
      toast(e.message || "فشل فتح الجدول.", "err");
    }
  }

  async function reloadCurrentTimetable() {
    if (!currentTimetableId) return;

    const r2 = await apiGet(`/exam-timetables/${currentTimetableId}`);
    const rows = r2.data?.entries || r2.entries || [];

    entries = (rows || []).map((x) => ({
      id: x.id != null ? String(x.id) : uid(),
      date: normalizeDateISO(x.date || x.exam_date) || "",
      start_time: normalizeTimeHHMM(x.start_time || x.start) || "",
      end_time: normalizeTimeHHMM(x.end_time || x.end) || "",
      subjectId: x.subject_id || x.subjectId || null,
      subjectName: x.subject_name || x.subjectName || "",
      room: x.room || "",
      notes: x.notes || "",
      applyToSectionId: x.apply_to_section_id ?? x.applyToSectionId ?? null,
      applyToSectionName: x.apply_to_section_name || x.applyToSectionName || null,
    }));

    renderTable();
  }

  async function saveDraft(silent = false) {
    if (!currentTimetableId) {
      if (!silent) toast("افتح جدول أولاً.", "err");
      return;
    }

    if (currentTimetableStatus === "published") {
      if (!silent) toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
      return;
    }

    const v = validateEntries(true, !silent);
    if (!v.ok) {
      if (!silent && typeof v.index === "number" && entries[v.index]) {
        openRowEditor(entries[v.index].id);
      }
      return;
    }

    const payload = {
      entries: entries
        .filter((e) => entryHasAnyValue(e))
        .map((e) => ({
          date: normalizeDateISO(e.date),
          start_time: normalizeTimeHHMM(e.start_time),
          end_time: normalizeTimeHHMM(e.end_time),
          subjectId: e.subjectId,
          room: (e.room || "").trim() || null,
          notes: (e.notes || "").trim() || null,
          applyToSectionId: e.applyToSectionId ?? null,
        })),
    };

    for (let i = 0; i < payload.entries.length; i++) {
      const p = payload.entries[i];
      if (!p.date) throw new Error(`السطر رقم ${i + 1}: صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD أو DD/MM/YYYY.`);
      if (!p.start_time || !p.end_time) throw new Error(`السطر رقم ${i + 1}: وقت (من/إلى) مطلوب.`);
    }

    try {
      await apiSend(`/exam-timetables/${currentTimetableId}/entries`, "PUT", payload);
      currentTimetableStatus = "draft";
      setStatusChip("draft");
      syncPublishButtons();

      persistLast(currentTimetableId, normalizeSelection(getSelection()));

      if (!silent) toast("تم حفظ المسودة.", "ok");
    } catch (e) {
      console.error(e);
      if (!silent) toast(e.message || "فشل حفظ المسودة.", "err");
      throw e;
    }
  }

 async function publish() {
  if (!currentTimetableId) return toast("افتح جدول أولاً.", "err");

  const v = validateEntries(true, true);
  if (!v.ok) return;

  const ok = await exConfirm({
    title: "نشر جدول الاختبارات",
    message:
      "سيتم نشر جدول الاختبارات للطلاب وأولياء الأمور.\nبعد النشر لن تستطيع التعديل إلا بعد إلغاء النشر.",
    confirmText: "نشر الجدول",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!ok) return;

  try {
    await saveDraft(true);
    await apiSend(`/exam-timetables/${currentTimetableId}/publish`, "PUT", {});
    currentTimetableStatus = "published";
    setStatusChip("published");
    syncPublishButtons();
    toast("تم نشر الجدول.", "ok");
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل النشر.", "err");
  }
}

 async function unpublish() {
  if (!currentTimetableId) return;

  const ok = await exConfirm({
    title: "إلغاء نشر جدول الاختبارات",
    message:
      "سيتم إلغاء نشر جدول الاختبارات من بوابات الطلاب وأولياء الأمور.\nسيعود الجدول إلى وضع المسودة ويمكن تعديله.",
    confirmText: "إلغاء النشر",
    cancelText: "رجوع",
    type: "warning",
  });

  if (!ok) return;

  try {
    await apiSend(`/exam-timetables/${currentTimetableId}/unpublish`, "PUT", {});
    currentTimetableStatus = "draft";
    setStatusChip("draft");
    syncPublishButtons();
    toast("تم إلغاء النشر.", "ok");
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل إلغاء النشر.", "err");
  }
}
  async function clearServerEntries() {
  if (!currentTimetableId) return toast("افتح جدول أولاً.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن تفريغ منشور — ألغِ النشر أولاً.", "err");
  }

  const ok = await exConfirm({
    title: "تفريغ جدول الاختبارات",
    message:
      "سيتم حذف كل الاختبارات من هذا الجدول.\nسيبقى الجدول نفسه موجودًا كمسودة فارغة.",
    confirmText: "تفريغ الجدول",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/exam-timetables/${currentTimetableId}/entries`, "DELETE");
    entries = [];
    renderTable();
    toast("تم تفريغ الجدول (مسودة).", "ok");
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل التفريغ.", "err");
  }
}

 async function deleteCurrentTimetable() {
  if (!currentTimetableId) return toast("لا يوجد جدول مفتوح.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن حذف جدول منشور — ألغِ النشر أولاً.", "err");
  }

  const ok = await exConfirm({
    title: "حذف جدول الاختبارات",
    message:
      `سيتم حذف جدول الاختبارات الحالي رقم #${currentTimetableId} بالكامل.\n` +
      "هذا الإجراء لا يمكن التراجع عنه.",
    confirmText: "حذف الجدول",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/exam-timetables/${currentTimetableId}`, "DELETE");
    toast("تم حذف الجدول.", "ok");

    currentTimetableId = null;
    currentTimetableStatus = "draft";
    entries = [];
    clearPersistedLast();

    setStatusChip("-");
    syncPublishButtons();
    setInfo("تم حذف الجدول. اختر الفلاتر وافتح جدول جديد.");
    renderTable();
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل الحذف.", "err");
  }
}
  async function copyFromTimetable() {
  if (!currentTimetableId) return toast("افتح جدول الهدف أولاً.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن النسخ لجدول منشور.", "err");
  }

  const fromIdRaw = await exPrompt({
    title: "نسخ من جدول آخر",
    message: "اكتب رقم جدول الاختبارات المصدر الذي تريد النسخ منه.",
    placeholder: "مثال: 12",
    confirmText: "نسخ الجدول",
    cancelText: "إلغاء",
    type: "info",
    required: true,
    requiredMessage: "رقم الجدول المصدر مطلوب.",
  });

  if (fromIdRaw === null) return;

  const fromTimetableId = Number(toLatinDigits(fromIdRaw));
  if (!Number.isFinite(fromTimetableId) || fromTimetableId <= 0) {
    return toast("رقم غير صحيح.", "err");
  }

  const ok = await exConfirm({
    title: "تأكيد نسخ الجدول",
    message:
      `سيتم نسخ اختبارات الجدول رقم #${fromTimetableId} إلى الجدول الحالي رقم #${currentTimetableId}.\n` +
      "هل تريد المتابعة؟",
    confirmText: "تأكيد النسخ",
    cancelText: "إلغاء",
    type: "warning",
  });

  if (!ok) return;

  try {
    await apiSend(`/exam-timetables/${currentTimetableId}/copy-from`, "POST", {
      fromTimetableId,
    });
    await reloadCurrentTimetable();
    toast("تم النسخ بنجاح.", "ok");
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل النسخ.", "err");
  }
}
  async function loadManageList() {
    const root = document.getElementById("examSchedulePage") || document;
    const sel = getSelection();
    if (!sel.academicYearId) return toast("اختر السنة أولاً.", "err");

    const qs = new URLSearchParams();
    qs.set("academicYearId", String(sel.academicYearId));
    if (sel.examType) qs.set("examType", String(sel.examType));
    if (sel.stageId) qs.set("stageId", String(sel.stageId));
    if (sel.gradeId) qs.set("gradeId", String(sel.gradeId));
    if (sel.scope) qs.set("scope", String(sel.scope));
    if (sel.scope === "section" && sel.sectionId) qs.set("sectionId", String(sel.sectionId));

    try {
      const r = await apiGet("/exam-timetables/list?" + qs.toString());
      const rows = r.data || r || [];
      const tbody = el("#exManageTbody", root);
      if (!tbody) return;

      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="11" class="ex-emptyRow">لا توجد جداول.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows
        .map(
          (x) => `
        <tr>
          <td>${escapeHtml(x.id)}</td>
          <td>${escapeHtml(x.year_name || x.academic_year_id)}</td>
          <td>${escapeHtml(formatTypeName(x.exam_type || x.examType))}</td>
          <td>${escapeHtml(x.month || "-")}</td>
          <td>${escapeHtml(x.stage_name || x.stage_id)}</td>
          <td>${escapeHtml(x.grade_name || x.grade_id)}</td>
          <td>${escapeHtml(x.scope || "-")}</td>
          <td>${escapeHtml(x.section_name || x.section_id || "-")}</td>
          <td>${escapeHtml(x.status || "-")}</td>
          <td>${escapeHtml(x.entries_count ?? x.count ?? 0)}</td>
          <td style="white-space:nowrap;">
            <button class="ex-btn ex-btn-ghost" data-open-id="${escapeHtml(x.id)}">فتح</button>
            ${
              x.status === "published"
                ? `<button class="ex-btn ex-btn-ghost" disabled>منشور</button>`
                : `<button class="ex-btn ex-btn-ghost" data-del-id="${escapeHtml(x.id)}">حذف</button>`
            }
          </td>
        </tr>
      `
        )
        .join("");
    } catch (e) {
      console.error(e);
      toast(e.message || "فشل تحميل القائمة.", "err");
    }
  }

  async function openByTimetableId(id) {
    await loadMeta(false);

    const r2 = await apiGet(`/exam-timetables/${id}`);
    const tt = r2.data?.timetable || r2.timetable || {};

    const ttSel = normalizeSelection({
      academicYearId: tt.academic_year_id || tt.academicYearId || null,
      examType: tt.exam_type || tt.examType || "",
      stageId: tt.stage_id || tt.stageId || null,
      gradeId: tt.grade_id || tt.gradeId || null,
      scope: tt.scope || "",
      sectionId: tt.section_id || tt.sectionId || null,
    });

    applySelectionToUI(ttSel);

    currentTimetableId = tt.id || id;
    currentTimetableStatus = tt.status || "draft";
    setStatusChip(currentTimetableStatus);
    syncPublishButtons();

    persistLast(currentTimetableId, normalizeSelection(getSelection()));

    const rows = r2.data?.entries || r2.entries || [];
    entries = (rows || []).map((x) => ({
      id: x.id != null ? String(x.id) : uid(),
      date: normalizeDateISO(x.date || x.exam_date) || "",
      start_time: normalizeTimeHHMM(x.start_time || x.start) || "",
      end_time: normalizeTimeHHMM(x.end_time || x.end) || "",
      subjectId: x.subject_id || x.subjectId || null,
      subjectName: x.subject_name || x.subjectName || "",
      room: x.room || "",
      notes: x.notes || "",
      applyToSectionId: x.apply_to_section_id ?? x.applyToSectionId ?? null,
      applyToSectionName: x.apply_to_section_name || x.applyToSectionName || null,
    }));

    setInfo(`تم فتح الجدول #${currentTimetableId}`);
    renderTable();
    toast("تم فتح الجدول.", "ok");
  }

  function bindEventsOnce() {
    if (window.__EXAM_SCHEDULE_EVENTS_BOUND__) return;
    window.__EXAM_SCHEDULE_EVENTS_BOUND__ = true;

    document.addEventListener("click", async (e) => {
      const root = document.getElementById("examSchedulePage");
      if (!root || !root.contains(e.target)) return;

      const btn = e.target.closest("button");
      const id = btn?.id;

   if (id === "exDrawerSaveAdd") {
  if (currentTimetableStatus === "published") {
    return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
  }

  // أوقف أي autosave سابق حتى لا يمسح السطر الجديد
  try { clearTimeout(autosaveTimer); } catch {}
  autosaveTimer = null;

  // احفظ السطر الحالي محليًا فقط
  const ok = saveRowFromDrawer(false, false);
  if (!ok) return;

  // افتح سطر جديد مباشرة
  const newRow = createEmptyExamRow();
  entries.push(newRow);
  renderTable();
  openRowEditor(newRow.id);

  setInfo("تم حفظ الاختبار الحالي. أكمل إدخال الاختبار التالي ثم اضغط حفظ مسودة أو نشر بعد الانتهاء.");
  return;
}

      if (id === "exCreateBtn") return createOrOpenTimetable();
      if (id === "exAddExamBtn") return addNewRow();
      if (id === "exSaveDraftBtn") return saveDraft(false);
      if (id === "exPublishBtn") return publish();
      if (id === "exUnpublishBtn") return unpublish();
      if (id === "exClearBtn") return clearServerEntries();
      if (id === "exCopyBtn") return copyFromTimetable();
      if (id === "exDeleteCurrentBtn") return deleteCurrentTimetable();

      if (id === "exDrawerClose" || id === "exDrawerCancel") return closeDrawer();
      if (id === "exManageClose") return closeManage();

      if (id === "exDrawerSave") {
        if (currentTimetableStatus === "published") return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
        return saveRowFromDrawer(true);
      }

     if (id === "exDrawerDelete") {
  if (!selectedRowId) return;
  if (currentTimetableStatus === "published") {
    return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
  }

  const ok = await exConfirm({
    title: "حذف اختبار",
    message: "هل أنت متأكد من حذف هذا الاختبار من الجدول؟",
    confirmText: "حذف الاختبار",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  deleteRow(selectedRowId);
  closeDrawer();
  return;
}

      if (id === "exManageBtn") {
        openManage();
        await loadMeta(false);
        await loadManageList();
        return;
      }

      if (id === "exManageRefresh") return loadManageList();

      const openBtn = e.target.closest("[data-open-id]");
      if (openBtn) {
        const tid = Number(openBtn.getAttribute("data-open-id"));
        await openByTimetableId(tid);
        closeManage();
        return;
      }

    const delBtn = e.target.closest("[data-del-id]");
if (delBtn) {
  const tid = Number(delBtn.getAttribute("data-del-id"));

  const ok = await exConfirm({
    title: "حذف جدول اختبارات",
    message:
      `سيتم حذف الجدول رقم #${tid}.\n` +
      "يجب أن يكون الجدول مسودة وغير منشور.\nهذا الإجراء لا يمكن التراجع عنه.",
    confirmText: "حذف الجدول",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/exam-timetables/${tid}`, "DELETE");
    toast("تم حذف الجدول.", "ok");
    await loadManageList();

    if (String(currentTimetableId) === String(tid)) {
      resetExamScheduleToDefaults("تم حذف الجدول المفتوح. اختر الفلاتر ثم افتح جدول جديد.");
    }
  } catch (err) {
    toast(err.message || "فشل الحذف", "err");
  }
  return;
}

      const tbody = el("#exTbody", root);
      if (tbody && tbody.contains(e.target)) {
        const tr = e.target.closest("tr[data-row-id]");
        if (!tr) return;

        const rowId = tr.dataset.rowId;
        const actBtn = e.target.closest("[data-act]");
        const act = actBtn?.getAttribute("data-act");
if (act === "del") {
  if (currentTimetableStatus === "published") {
    return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
  }

  const ok = await exConfirm({
    title: "حذف اختبار",
    message: "هل أنت متأكد من حذف هذا الاختبار؟",
    confirmText: "حذف الاختبار",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  deleteRow(rowId);
  return;
}

        if (currentTimetableStatus === "published") return toast("الجدول منشور — ألغِ النشر للتعديل.", "err");
        openRowEditor(rowId);
      }
    });

    document.addEventListener("input", (e) => {
      const root = document.getElementById("examSchedulePage");
      if (!root || !root.contains(e.target)) return;

      if (e.target.id === "exSectionSearch") {
        const sectionSel = el("#exSectionSelect", root);
        if (!sectionSel) return;
        const q = (e.target.value || "").trim();
        Array.from(sectionSel.options).forEach((opt) => {
          if (!opt.value) return;
          opt.hidden = q ? !opt.textContent.includes(q) : false;
        });
      }
    });

    document.addEventListener("change", (e) => {
      const root = document.getElementById("examSchedulePage");
      if (!root || !root.contains(e.target)) return;

    if (e.target.id === "exWeekStartInp") {
  const currentSelectedDay = el("#exWeekDateSelect", root)?.value || "";
  rebuildWeekDateSelect(currentSelectedDay);
  return;
}

      if (e.target.id === "exWeekDateSelect") {
        const iso = normalizeDateISO(e.target.value || "");
        const dateInp = el("#exDateInp", root);
        if (dateInp) dateInp.value = iso || "";
        return;
      }

      if (e.target.id === "exTypeSelect") return syncTypeMonthUI();
      if (e.target.id === "exScopeSelect") return syncScopeUI();

      if (e.target.id === "exStageSelect") {
        rebuildGradeOptions();
        rebuildSectionOptions();
        return;
      }

      if (e.target.id === "exGradeSelect") {
        rebuildSectionOptions();
        rebuildApplyToSelect();
        return;
      }
    });

    document.addEventListener("keydown", (e) => {
      const root = document.getElementById("examSchedulePage");
      if (!root || !root.contains(e.target)) return;

      const ids = new Set([
        "exYearSelect",
        "exTypeSelect",
        "exStageSelect",
        "exGradeSelect",
        "exScopeSelect",
        "exSectionSelect",
        "exSectionSearch",
      ]);

      if (ids.has(e.target.id) && e.key === "Enter") {
        e.preventDefault();
        createOrOpenTimetable();
      }
    });
  }

  async function initExamSchedule() {
  const root = document.getElementById("examSchedulePage");
  if (!root) return;

  if (root.dataset.exInited === "1") {
    resetExamScheduleToDefaults("اختر الفلاتر ثم اضغط (إنشاء/فتح الجدول).");
    return;
  }

  root.dataset.exInited = "1";

  await loadMeta(false);
  bindEventsOnce();

  // مهم: لا نريد استرجاع آخر جدول أو آخر فلاتر
  clearPersistedLast();
  resetExamScheduleToDefaults("اختر الفلاتر ثم اضغط (إنشاء/فتح الجدول).");
}

  window.initExamSchedule = initExamSchedule;

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("examSchedulePage")) initExamSchedule();
  });
})();