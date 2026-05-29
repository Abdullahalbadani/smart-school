// frontend/admin/js/weeklySchedule.js
(function () {
  "use strict";

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
  const opts = { method, headers: { ...authHeaders() } };

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

  // ===== fallback meta (لو meta فشل) =====
  const fallbackMeta = {
    days: [
      { id: 1, name: "السبت" },
      { id: 2, name: "الأحد" },
      { id: 3, name: "الاثنين" },
      { id: 4, name: "الثلاثاء" },
      { id: 5, name: "الأربعاء" },
      { id: 6, name: "الخميس" },
    ],
    periods: [
      { id: 1, name: "1", sort_order: 1, start_time: "08:00", end_time: "08:45" },
      { id: 2, name: "2", sort_order: 2, start_time: "08:50", end_time: "09:35" },
      { id: 3, name: "3", sort_order: 3, start_time: "09:40", end_time: "10:25" },
      { id: 4, name: "4", sort_order: 4, start_time: "10:40", end_time: "11:25" },
      { id: 5, name: "5", sort_order: 5, start_time: "11:30", end_time: "12:15" },
      { id: 6, name: "6", sort_order: 6, start_time: "12:20", end_time: "13:05" },
    ],
    years: [],
    stages: [],
    grades: [],
    sections: [],
    subjects: [],
    teachers: [],
  };

  let meta = null;
let academicSettings = null;
let defaultMonthlyExamTotal = 20;
  let timetable = {
    id: null,
    status: "draft",
    entries: new Map(), // key: `${dayId}-${periodId}`
  };

  let currentTimetableId = null;
  let currentTimetableStatus = "draft";
  let selectedCell = null;

  // ===== Week mode / Overrides (Exam & Exceptions) =====
  let viewMode = "template"; // "template" | "week"
  let weekStartISO = null; // YYYY-MM-DD
  let overrides = new Map(); // current working copy
  let overridesBaseline = new Map(); // last saved copy from server
  let overridesDirty = false;

  function clonePlain(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
  }

  function cloneMapDeep(src) {
    return new Map(Array.from(src || new Map(), ([k, v]) => [k, clonePlain(v)]));
  }

  function el(sel) {
    return document.querySelector(sel);
  }

function toast(msg, type = "ok") {
  const finalType = type === "err" ? "error" : "success";

  if (window.AppUI?.toast) {
    window.AppUI.toast(msg, finalType);
    return;
  }

  const t = el("#wsToast");
  if (!t) return;
  t.className = "ws-toast ws-show " + (type === "err" ? "ws-err" : "ws-ok");
  t.textContent = msg;
  setTimeout(() => t.classList.remove("ws-show"), 2200);
}

async function wsConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  return confirm(options.message || "هل تريد المتابعة؟");
}

async function wsPrompt(options = {}) {
  if (window.AppUI?.prompt) {
    return await window.AppUI.prompt(options);
  }

  return prompt(options.message || "اكتب البيانات", options.defaultValue || "");
}

  function setStatusChip(status) {
    const chip = el("#wsStatusChip");
    if (!chip) return;
    const map = { draft: "مسودة", published: "منشور", "-": "—" };
    chip.textContent = "الحالة: " + (map[status] || status || "—");
  }

  function showUnpublishBtn() {
    const b = el("#wsUnpublishBtn");
    if (!b) return;
    b.style.display = currentTimetableStatus === "published" ? "" : "none";
  }

  function openDrawer() {
    document.documentElement.classList.add("ws-open");
    el("#wsDrawer")?.setAttribute("aria-hidden", "false");
    el("#wsDrawerBackdrop")?.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    document.documentElement.classList.remove("ws-open");
    el("#wsDrawer")?.setAttribute("aria-hidden", "true");
    el("#wsDrawerBackdrop")?.setAttribute("aria-hidden", "true");
    selectedCell = null;
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

  function getSelection() {
    const academicYearId = Number(el("#wsYearSelect")?.value) || null;
    const term = Number(el("#wsTermSelect")?.value) || 1;
    const stageId = Number(el("#wsStageSelect")?.value) || null;
    const gradeId = Number(el("#wsGradeSelect")?.value) || null;
    const sectionId = Number(el("#wsSectionSelect")?.value) || null;
    return { academicYearId, term, stageId, gradeId, sectionId };
  }

  function selectionOk(sel) {
    return sel.academicYearId && sel.stageId && sel.gradeId && sel.sectionId;
  }

  function getNameById(list, id) {
    return (list || []).find((x) => String(x.id) === String(id))?.name || "";
  }

  function formatTime(t) {
    if (!t) return "";
    return String(t).slice(0, 5);
  }

  function toISODate(d) {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fromISODate(iso) {
    const s = String(iso || "").slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  // بداية الأسبوع = السبت
  function weekStartSaturday(anyDate) {
    const d = new Date(anyDate);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay(); // Sunday=0 ... Saturday=6
    const back = (dow + 1) % 7; // السبت => 0، الأحد => 1 ...
    d.setDate(d.getDate() - back);
    return d;
  }

  function getDateForDayId(dayId) {
    if (viewMode !== "week" || !weekStartISO) return null;
    const start = fromISODate(weekStartISO);
    start.setHours(0, 0, 0, 0);
    const offset = Number(dayId) - 1; // 1=السبت
    const d = new Date(start);
    d.setDate(start.getDate() + offset);
    return toISODate(d);
  }
async function loadAcademicSettings() {
  try {
    const r = await apiGet("/admin/school-settings/academic");
    academicSettings = r?.data || null;
    defaultMonthlyExamTotal =
      Number(
        academicSettings?.monthly_exam_max_grade ??
          academicSettings?.monthly_exam_max ??
          20
      ) || 20;
  } catch {
    academicSettings = null;
    defaultMonthlyExamTotal = 20;
  }
}

function getDefaultExamTotal(kind) {
  const k = String(kind || "monthly").trim();

  if (k === "monthly") {
    return Number(
      academicSettings?.monthly_exam_max_grade ??
        academicSettings?.monthly_exam_max ??
        defaultMonthlyExamTotal ??
        20
    ) || 20;
  }

  if (k === "midterm" || k === "midyear") {
    return Number(
      academicSettings?.midterm_exam_max_grade ??
        academicSettings?.midterm_exam_max ??
        30
    ) || 30;
  }

  if (k === "final") {
    return Number(
      academicSettings?.final_exam_max_grade ??
        academicSettings?.final_exam_max ??
        30
    ) || 30;
  }

  return 20;
}

function fillDefaultExamTotalIfEmpty() {
  const type = el("#wsEntryType")?.value || "lesson";
  const totalEl = el("#wsExamTotal");
  const kindEl = el("#wsExamKind");

  if (type !== "exam" || !totalEl) return;

  if (!String(totalEl.value || "").trim()) {
    totalEl.value = String(getDefaultExamTotal(kindEl?.value || "monthly"));
  }
}
  function toggleExamFields() {
  const t = el("#wsEntryType")?.value || "lesson";
  const box = el("#wsExamFields");

  if (box) box.style.display = t === "exam" ? "" : "none";

  if (t === "exam") {
    fillDefaultExamTotalIfEmpty();
  }
}

  function clearConflictsUI() {
    const conf = el("#wsConflictsCount");
    if (conf) conf.textContent = "0";

    const box = el("#wsConflictsBox");
    if (box) box.innerHTML = `<div class="ws-empty">لا يوجد تعارضات حاليًا.</div>`;
  }

  function refreshStatsAndConflicts() {
    const filled = el("#wsFilledCount");
    if (filled) filled.textContent = String(timetable.entries.size);
  }

  function getDays() {
    return meta?.days?.length ? meta.days : fallbackMeta.days;
  }

  function getPeriods() {
    const p = meta?.periods?.length ? meta.periods : fallbackMeta.periods;
    return [...p].sort((a, b) => (a.sort_order || a.id) - (b.sort_order || b.id));
  }

  function getVisiblePeriods() {
    return getPeriods();
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ensureWeekChangesSaved() {
    if (viewMode === "week" && overridesDirty) {
      toast("لديك تعديلات أسبوعية غير محفوظة. اضغط (حفظ المسودة) أولاً.", "err");
      return false;
    }
    return true;
  }

  function renderArabicConflicts(conflicts, title = "يوجد تعارضات") {
    const box = el("#wsConflictsBox");
    const countEl = el("#wsConflictsCount");

    if (!Array.isArray(conflicts) || !conflicts.length) {
      clearConflictsUI();
      return;
    }

    if (countEl) countEl.textContent = String(conflicts.length);
    if (!box) return;

    box.innerHTML = conflicts
      .map((c) => {
        const teacher =
          c.teacher_name || (c.teacher_id ? `المعلم رقم ${c.teacher_id}` : "المعلم غير محدد");
        const subject =
          c.subject_name || (c.subject_id ? `المادة رقم ${c.subject_id}` : "مادة غير معروفة");
        const stage =
          c.stage_name || (c.stage_id ? `المرحلة رقم ${c.stage_id}` : "مرحلة غير معروفة");
        const grade =
          c.grade_name || (c.grade_id ? `الصف رقم ${c.grade_id}` : "صف غير معروف");
        const section =
          c.section_name || (c.section_id ? `الشعبة رقم ${c.section_id}` : "شعبة غير معروفة");
        const day =
          c.day_name || (c.day_of_week ? `اليوم رقم ${c.day_of_week}` : "يوم غير معروف");
        const period =
          c.period_name || (c.period_id ? `الحصة رقم ${c.period_id}` : "حصة غير معروفة");
        const dateText = c.date ? ` — التاريخ: ${String(c.date).slice(0, 10)}` : "";

        return `
          <div class="ws-confItem">
            <b>${escapeHtml(title)}</b>
            <div>المعلم: ${escapeHtml(teacher)}</div>
            <div>المادة: ${escapeHtml(subject)}</div>
            <div>الموعد: ${escapeHtml(day)} — ${escapeHtml(period)}${escapeHtml(dateText)}</div>
            <div>المكان المتعارض: ${escapeHtml(stage)} / ${escapeHtml(grade)} / ${escapeHtml(section)}</div>
          </div>
        `;
      })
      .join("");
  }

  // اختياري: إذا كان عندك endpoint في الباك إند لفحص تعارض المعلم قبل الحفظ
  async function checkTeacherConflictBeforeSave({ teacherId, dayId, periodId, dateISO }) {
    if (!teacherId || !currentTimetableId) return null;

    const sel = getSelection();
    const qs = new URLSearchParams();
    qs.set("teacherId", String(teacherId));
    qs.set("academicYearId", String(sel.academicYearId || ""));
    qs.set("term", String(sel.term || 1));
    qs.set("stageId", String(sel.stageId || ""));
    qs.set("gradeId", String(sel.gradeId || ""));
    qs.set("sectionId", String(sel.sectionId || ""));
    qs.set("periodId", String(periodId || ""));
    qs.set("excludeTimetableId", String(currentTimetableId || ""));

    if (viewMode === "week" && dateISO) {
      qs.set("date", String(dateISO));
    } else {
      qs.set("dayId", String(dayId || ""));
    }

    try {
      const r = await apiGet(`/timetables/check-teacher-conflict?${qs.toString()}`);
      return r?.data || r || null;
    } catch {
      return null;
    }
  }

  // ==========================================================
  // ✅✅ Cascading Filters: Stage -> Grades -> Sections
  // ==========================================================
  function refilterGradesByStage() {
    const stageId = Number(el("#wsStageSelect")?.value || 0);
    const all = meta?.__allGrades || meta?.grades || [];

    const list =
      stageId && all.length && all[0] && Object.prototype.hasOwnProperty.call(all[0], "stage_id")
        ? all.filter((g) => Number(g.stage_id) === stageId)
        : stageId
        ? all
        : [];

    fillSelect(el("#wsGradeSelect"), list, "اختر الصف...");

    fillSelect(el("#wsSectionSelect"), [], "اختر الشعبة...");
    const sb = el("#wsSectionSearch");
    if (sb) sb.value = "";
  }

  function refilterSectionsByGrade() {
    const gradeId = Number(el("#wsGradeSelect")?.value || 0);
    const all = meta?.__allSections || meta?.sections || [];

    const list =
      gradeId && all.length && all[0] && Object.prototype.hasOwnProperty.call(all[0], "grade_id")
        ? all.filter((s) => Number(s.grade_id) === gradeId)
        : gradeId
        ? all
        : [];

    fillSelect(el("#wsSectionSelect"), list, "اختر الشعبة...");
    const sb = el("#wsSectionSearch");
    if (sb) sb.value = "";
  }

  function renderGrid() {
    const grid = el("#wsGrid");
    if (!grid) return;

    const days = getDays();
    const periods = getVisiblePeriods();

    grid.style.setProperty("--ws-cols", String(periods.length));
    grid.innerHTML = "";

    const header = document.createElement("div");
    header.className = "ws-gridHeader";

    const corner = document.createElement("div");
    corner.className = "ws-colHead";
    corner.textContent = "اليوم \\ الحصة";
    header.appendChild(corner);

    periods.forEach((p) => {
      const h = document.createElement("div");
      h.className = "ws-colHead";
      const timeLine =
        p.start_time && p.end_time ? ` (${formatTime(p.start_time)} - ${formatTime(p.end_time)})` : "";
      h.textContent = "حصة " + (p.name ?? p.id) + timeLine;
      header.appendChild(h);
    });

    grid.appendChild(header);

    days.forEach((d) => {
      const row = document.createElement("div");
      row.className = "ws-gridRow";

      const rh = document.createElement("div");
      rh.className = "ws-rowHead";
      rh.textContent = d.name;
      row.appendChild(rh);

      periods.forEach((p) => {
        const cell = document.createElement("div");
        const key = `${d.id}-${p.id}`;

        const dateISO = getDateForDayId(d.id);
        const overrideKey = dateISO ? `${dateISO}-${p.id}` : null;
        const over = overrideKey ? overrides.get(overrideKey) : null;

        const base = timetable.entries.get(key);
        const entry = viewMode === "week" ? over || base : base;

        let cls = "ws-cell " + (entry ? "" : "ws-empty");
        if (entry?.type === "exam") cls += " ws-exam";
        cell.className = cls;
        cell.dataset.dayId = d.id;
        cell.dataset.periodId = p.id;

        const pillText =
          viewMode === "week" && dateISO
            ? `${d.name} • ${dateISO} • ${p.name ?? p.id}`
            : `${d.name} • ${p.name ?? p.id}`;

        const pillClass = entry?.type === "exam" ? "ws-pill ws-pill-exam" : "ws-pill";

        if (entry) {
          const title = entry.type === "exam" ? entry.examTitle || "اختبار" : entry.subjectName || "—";
          const subline =
            entry.type === "exam"
              ? entry.subjectName
                ? `المادة: ${entry.subjectName}`
                : "—"
              : entry.teacherName || "—";

          cell.innerHTML = `
            <span class="${pillClass}">${escapeHtml(pillText)}</span>
            <div class="ws-subject">${escapeHtml(title)}</div>
            <div class="ws-teacher">${escapeHtml(subline)}</div>
          `;
        } else {
          cell.innerHTML = `
            <span class="${pillClass}">${escapeHtml(pillText)}</span>
            <div class="ws-subject">+ إضافة</div>
            <div class="ws-teacher">اضغط للتعيين</div>
          `;
        }

        cell.addEventListener("click", () => onCellClick(d.id, p.id));
        row.appendChild(cell);
      });

      grid.appendChild(row);
    });

    refreshStatsAndConflicts();
  }

  async function onCellClick(dayId, periodId) {
    if (!currentTimetableId) return toast("اختر الفلاتر ثم اضغط (إنشاء/فتح الجدول).", "err");
    if (currentTimetableStatus === "published") {
      return toast("الجدول منشور — اضغط (إلغاء النشر) للتعديل.", "err");
    }

    const dateISO = getDateForDayId(dayId);
    selectedCell = { dayId, periodId, dateISO };

    const dayName = getDays().find((x) => x.id === dayId)?.name || "";
    const perName = getPeriods().find((x) => x.id === periodId)?.name || "";

    const sub = el("#wsDrawerSub");
    if (sub) sub.textContent = `${dayName} — حصة ${perName || periodId}`;

    const key = `${dayId}-${periodId}`;
    const base = timetable.entries.get(key);

    const overKey = dateISO ? `${dateISO}-${periodId}` : null;
    const over = overKey ? overrides.get(overKey) : null;

    const entry = viewMode === "week" ? over || base : base;

    if (el("#wsEntryType")) el("#wsEntryType").value = entry?.type || "lesson";
    toggleExamFields();
    if (el("#wsExamTitle")) el("#wsExamTitle").value = entry?.examTitle || "";
    if (el("#wsExamKind")) el("#wsExamKind").value = entry?.examKind || "monthly";
if (el("#wsExamTotal")) {
  el("#wsExamTotal").value = entry?.examTotal ?? "";
  if ((entry?.type || "lesson") === "exam") {
    fillDefaultExamTotalIfEmpty();
  }
}
    el("#wsSubjectSelect").value = entry?.subjectId || "";
    const sid = Number(el("#wsSubjectSelect").value || 0);

    await loadTeachersForSubject(sid, entry?.teacherId || null);

    el("#wsRoomInput").value = entry?.room || "";
    el("#wsNotesInput").value = entry?.notes || "";

    openDrawer();
  }

  // ===== Periods CRUD =====
  function openPeriodsModal() {
    el("#wsPeriodsBackdrop")?.setAttribute("aria-hidden", "false");
    el("#wsPeriodsModal")?.setAttribute("aria-hidden", "false");
  }

  function closePeriodsModal() {
    el("#wsPeriodsBackdrop")?.setAttribute("aria-hidden", "true");
    el("#wsPeriodsModal")?.setAttribute("aria-hidden", "true");
  }

  function renderPeriodsTable(periods) {
    const tbody = el("#wsPeriodsTbody");
    if (!tbody) return;

    if (!periods || !periods.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; opacity:.8; padding:14px;">
            لا يوجد حصص. اضف حصة من الأعلى.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = periods
      .sort((a, b) => (a.sort_order || a.id) - (b.sort_order || b.id))
      .map((p) => {
        const st = formatTime(p.start_time);
        const en = formatTime(p.end_time);

        return `
        <tr data-period-id="${p.id}">
          <td>${p.id}</td>
          <td>
            <input class="ws-inp" data-f="name" type="text" value="${escapeHtml(p.name || "")}" disabled style="width:100%;" />
          </td>
          <td>
            <input class="ws-inp" data-f="start_time" type="time" value="${st}" disabled />
          </td>
          <td>
            <input class="ws-inp" data-f="end_time" type="time" value="${en}" disabled />
          </td>
          <td>
            <input class="ws-inp" data-f="sort_order" type="number" min="1" step="1" value="${p.sort_order ?? ""}" disabled style="width:90px;" />
          </td>
          <td style="white-space:nowrap;">
            <button class="ws-btn ws-btn-ghost" data-act="edit"><i class="ri-edit-line"></i> تعديل</button>
            <button class="ws-btn ws-btn-primary" data-act="save" style="display:none;"><i class="ri-check-line"></i> حفظ</button>
            <button class="ws-btn ws-btn-ghost" data-act="cancel" style="display:none;"><i class="ri-close-line"></i> إلغاء</button>
            <button class="ws-btn ws-btn-ghost" data-act="del"><i class="ri-delete-bin-6-line"></i> حذف</button>
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll("tr[data-period-id]").forEach((tr) => {
      const id = Number(tr.getAttribute("data-period-id"));
      const editBtn = tr.querySelector('[data-act="edit"]');
      const saveBtn = tr.querySelector('[data-act="save"]');
      const cancelBtn = tr.querySelector('[data-act="cancel"]');
      const delBtn = tr.querySelector('[data-act="del"]');

      const original = {};
      tr.querySelectorAll("input.ws-inp").forEach((inp) => {
        original[inp.dataset.f] = inp.value;
      });

      editBtn?.addEventListener("click", () => {
        tr.querySelectorAll("input.ws-inp").forEach((inp) => (inp.disabled = false));
        editBtn.style.display = "none";
        delBtn.style.display = "none";
        saveBtn.style.display = "";
        cancelBtn.style.display = "";
      });

      cancelBtn?.addEventListener("click", () => {
        tr.querySelectorAll("input.ws-inp").forEach((inp) => {
          inp.value = original[inp.dataset.f] ?? "";
          inp.disabled = true;
        });
        editBtn.style.display = "";
        delBtn.style.display = "";
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";
      });

      saveBtn?.addEventListener("click", async () => {
        const payload = {};
        tr.querySelectorAll("input.ws-inp").forEach((inp) => {
          payload[inp.dataset.f] = inp.value;
        });

        if (!payload.name?.trim()) return toast("اسم الحصة مطلوب.", "err");
        if (!payload.start_time || !payload.end_time) return toast("حدد البداية والنهاية.", "err");
        const so = Number(payload.sort_order);
        if (!Number.isFinite(so) || so <= 0) return toast("الترتيب sort_order غير صحيح.", "err");

        try {
          await apiSend(`/periods/${id}`, "PUT", {
            name: payload.name.trim(),
            start_time: payload.start_time,
            end_time: payload.end_time,
            sort_order: so,
          });
          toast("تم تحديث الحصة.", "ok");
          await refreshPeriodsAndGrid();
        } catch (e) {
          console.error(e);
          toast(e.message || "فشل التحديث.", "err");
        }
      });

    delBtn?.addEventListener("click", async () => {
  const ok = await wsConfirm({
    title: "حذف الحصة",
    message:
      "هل أنت متأكد من حذف هذه الحصة؟\nقد يؤثر ذلك على الجداول التي تستخدم هذه الحصة.",
    confirmText: "حذف الحصة",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/periods/${id}`, "DELETE");
    toast("تم حذف الحصة.", "ok");
    await refreshPeriodsAndGrid();
  } catch (e) {
    console.error(e);
    toast(e.message || "فشل الحذف.", "err");
  }
});
    });
  }

  async function loadPeriodsList() {
    const r = await apiGet("/periods");
    const rows = r?.data || r || [];
    const periods = Array.isArray(rows) ? rows : rows.data || [];
    meta.periods = periods;
    renderPeriodsTable(periods);

    const maxSort = (periods || []).reduce((m, x) => Math.max(m, Number(x.sort_order || 0)), 0);
    const sortInp = el("#wsPSort");
    if (sortInp && !sortInp.value) sortInp.value = String(maxSort + 1);
  }

  async function refreshPeriodsAndGrid() {
    try {
      await loadPeriodsList();
      renderGrid();
    } catch (e) {
      console.error(e);
      toast(e.message || "فشل تحميل الحصص.", "err");
    }
  }

  function clearNewPeriodForm() {
    if (el("#wsPName")) el("#wsPName").value = "";
    if (el("#wsPStart")) el("#wsPStart").value = "";
    if (el("#wsPEnd")) el("#wsPEnd").value = "";
    if (el("#wsPSort")) el("#wsPSort").value = "";
  }

  async function createNewPeriod() {
    const name = (el("#wsPName")?.value || "").trim();
    const start_time = el("#wsPStart")?.value || "";
    const end_time = el("#wsPEnd")?.value || "";
    const sort_order = Number(el("#wsPSort")?.value);

    if (!name) return toast("اسم الحصة مطلوب.", "err");
    if (!start_time || !end_time) return toast("حدد البداية والنهاية.", "err");
    if (!Number.isFinite(sort_order) || sort_order <= 0) return toast("الترتيب sort_order غير صحيح.", "err");

    try {
      await apiSend("/periods", "POST", { name, start_time, end_time, sort_order });
      toast("تمت إضافة الحصة.", "ok");
      clearNewPeriodForm();
      await refreshPeriodsAndGrid();
    } catch (e) {
      console.error(e);
      toast(e.message || "فشل الإضافة.", "err");
    }
  }

  // ===== Timetables Meta / Load =====
  async function loadMeta() {
    try {
      const res = await apiGet("/timetables/meta");
      meta = res.data || res;
    } catch (e) {
      console.error(e);
      meta =
        typeof structuredClone === "function"
          ? structuredClone(fallbackMeta)
          : JSON.parse(JSON.stringify(fallbackMeta));
      toast("تعذر تحميل البيانات — تم استخدام بيانات تجريبية.", "err");
    }

    try {
      if (!meta.periods || !meta.periods.length) {
        const rP = await apiGet("/periods");
        const rows = rP?.data || rP || [];
        meta.periods = Array.isArray(rows) ? rows : rows.data || [];
      }
    } catch {
      if (!meta.periods || !meta.periods.length) meta.periods = fallbackMeta.periods;
    }
await loadAcademicSettings();
    meta.__allGrades = Array.isArray(meta.grades) ? meta.grades.slice() : [];
    meta.__allSections = Array.isArray(meta.sections) ? meta.sections.slice() : [];

    fillSelect(el("#wsYearSelect"), meta.years, "اختر السنة...");
    fillSelect(el("#wsStageSelect"), meta.stages, "اختر المرحلة...");
    fillSelect(el("#wsGradeSelect"), [], "اختر الصف...");
    fillSelect(el("#wsSectionSelect"), [], "اختر الشعبة...");

    fillSelect(el("#wsSubjectSelect"), meta.subjects, "اختر المادة...");
    fillSelect(el("#wsTeacherSelect"), meta.teachers, "اختر المعلم...");

    timetable = { id: null, status: "draft", entries: new Map() };
    currentTimetableId = null;
    currentTimetableStatus = "draft";
    selectedCell = null;
    overrides.clear();
    overridesBaseline.clear();
    overridesDirty = false;

    setStatusChip("-");
    showUnpublishBtn();

    const info = el("#wsInfoChip");
    if (info) info.textContent = "اختر الفلاتر ثم اضغط (إنشاء/فتح الجدول) أو اضغط Enter.";

    teachersBySubjectCache.clear();
    clearConflictsUI();
    renderGrid();
  }

  async function reloadCurrentTimetable() {
    if (!currentTimetableId) return;
    const r2 = await apiGet(`/timetables/${currentTimetableId}`);
    const entries = r2.data?.entries || r2.entries || [];

    timetable = { id: currentTimetableId, status: currentTimetableStatus, entries: new Map() };

    entries.forEach((e) => {
      const key = `${e.day_of_week}-${e.period_id}`;
      timetable.entries.set(key, {
        dayId: e.day_of_week,
        periodId: e.period_id,
        subjectId: e.subject_id,
        teacherId: e.teacher_id,
        subjectName: e.subject_name,
        teacherName: e.teacher_name,
        room: e.room || "",
        notes: e.notes || "",
      });
    });

    renderGrid();
  }

  async function loadWeekOverrides() {
    overrides.clear();
    overridesBaseline.clear();
    overridesDirty = false;

    if (!currentTimetableId || viewMode !== "week" || !weekStartISO) return;

    try {
      const r = await apiGet(
        `/timetables/${currentTimetableId}/overrides?weekStart=${encodeURIComponent(weekStartISO)}`
      );

      const rows = r?.data || r || [];

      (rows || []).forEach((o) => {
        const dateISO = String(o.date || "").slice(0, 10);
        const key = `${dateISO}-${o.period_id}`;

        overrides.set(key, {
          date: dateISO,
          dayId: o.day_of_week,
          periodId: o.period_id,
          type: o.type || "lesson",

          subjectId: o.subject_id || null,
          teacherId: o.teacher_id || null,
          subjectName: o.subject_name || "",
          teacherName: o.teacher_name || "",
          room: o.room || "",
          notes: o.notes || "",

          examTitle: o.exam_title || "",
          examKind: o.exam_kind || "monthly",
          examTotal: o.exam_total ?? null,
        });
      });

      overridesBaseline = cloneMapDeep(overrides);
      overridesDirty = false;
    } catch (e) {
      console.warn("loadWeekOverrides failed:", e.message);
    }
  }

  async function createOrOpenTimetable() {
    const sel = getSelection();
    if (!selectionOk(sel)) return toast("لازم تختار: السنة + الترم + المرحلة + الصف + الشعبة.", "err");

    const info = el("#wsInfoChip");
    if (info) info.textContent = "جاري فتح الجدول...";

    try {
      const r1 = await apiSend("/timetables/get-or-create", "POST", sel);
      currentTimetableId = r1.data.id;
      currentTimetableStatus = r1.data.status || "draft";
      setStatusChip(currentTimetableStatus);
      showUnpublishBtn();

      await reloadCurrentTimetable();
      if (viewMode === "week" && weekStartISO) {
        await loadWeekOverrides();
      }

      if (info) info.textContent = `تم فتح الجدول (#${currentTimetableId}) — عدّل ثم احفظ.`;
      clearConflictsUI();
      toast("تم فتح الجدول.", "ok");
    } catch (err) {
      console.error(err);
      if (info) info.textContent = "تعذر فتح الجدول.";
      toast(err.message || "فشل فتح الجدول.", "err");
    }
  }

  async function applyCellSave() {
    if (!selectedCell) return;

    const type = el("#wsEntryType")?.value || "lesson";

    if (viewMode === "template" && type !== "lesson") {
      return toast("الاختبار/الإلغاء يتم فقط من وضع (هذا الأسبوع).", "err");
    }

    const subjectIdRaw = el("#wsSubjectSelect")?.value || "";
    const teacherIdRaw = el("#wsTeacherSelect")?.value || "";

    if (type !== "cancel") {
      if (!subjectIdRaw) return toast("اختر المادة أولاً.", "err");
      if (!teacherIdRaw) return toast("اختر المعلم أولاً.", "err");
    }

    const subjectId = subjectIdRaw ? Number(subjectIdRaw) : null;
    const teacherId = teacherIdRaw ? Number(teacherIdRaw) : null;
    const room = (el("#wsRoomInput")?.value || "").trim();
    const notes = (el("#wsNotesInput")?.value || "").trim();

    // فحص اختياري للتعارض الفوري إذا كان عندك endpoint في الباك
    if (teacherId) {
      const conflict = await checkTeacherConflictBeforeSave({
        teacherId,
        dayId: selectedCell.dayId,
        periodId: selectedCell.periodId,
        dateISO: selectedCell.dateISO,
      });

      if (conflict?.hasConflict) {
        renderArabicConflicts([conflict], "تعارض معلم");
        return toast(
          conflict.message ||
            `${conflict.teacher_name || "هذا المعلم"} لديه حصة أخرى في هذا الوقت.`,
          "err"
        );
      }
    }

    // ===== حفظ في وضع الأسبوع (Overrides) =====
    if (viewMode === "week") {
      if (!selectedCell?.dateISO) return toast("حدد الأسبوع أولاً.", "err");
      if (currentTimetableStatus === "published") {
        return toast("الجدول منشور — اضغط (إلغاء النشر) للتعديل.", "err");
      }

      const subjName = el("#wsSubjectSelect")?.selectedOptions?.[0]?.textContent || "";
      const teachName = el("#wsTeacherSelect")?.selectedOptions?.[0]?.textContent || "";

      const oKey = `${selectedCell.dateISO}-${selectedCell.periodId}`;

      const payload = {
        date: selectedCell.dateISO,
        dayId: selectedCell.dayId,
        periodId: selectedCell.periodId,
        type,
        subjectId,
        teacherId,
        room,
        notes,
        examTitle: (el("#wsExamTitle")?.value || "").trim(),
        examKind: el("#wsExamKind")?.value || "monthly",
        examTotal: el("#wsExamTotal")?.value ? Number(el("#wsExamTotal").value) : null,
      };

      overrides.set(oKey, {
        ...payload,
        subjectName: subjName,
        teacherName: teachName,
      });

      overridesDirty = true;
      renderGrid();
      closeDrawer();
      return toast("تم حفظ الحدث محليًا. اضغط (حفظ المسودة) ثم (نشر).", "ok");
    }

    // ===== حفظ القالب (الجدول الأسبوعي المتكرر) =====
    const subjOpt =
      el("#wsSubjectSelect")?.selectedOptions?.[0]?.textContent ||
      getNameById(meta.subjects, subjectIdRaw);

    const teachOpt =
      el("#wsTeacherSelect")?.selectedOptions?.[0]?.textContent ||
      getNameById(meta.teachers, teacherIdRaw);

    const key = `${selectedCell.dayId}-${selectedCell.periodId}`;
    timetable.entries.set(key, {
      type: "lesson",
      dayId: selectedCell.dayId,
      periodId: selectedCell.periodId,
      subjectId,
      teacherId,
      subjectName: subjOpt,
      teacherName: teachOpt,
      room,
      notes,
    });

    renderGrid();
    closeDrawer();
    toast("تم حفظ الحصة.", "ok");
  }

  async function applyCellClear() {
    if (!selectedCell) return;

    if (viewMode === "week" && selectedCell?.dateISO) {
      if (currentTimetableStatus === "published") {
        return toast("الجدول منشور — اضغط (إلغاء النشر) للتعديل.", "err");
      }

      const oKey = `${selectedCell.dateISO}-${selectedCell.periodId}`;
      overrides.delete(oKey);
      overridesDirty = true;
      renderGrid();
      closeDrawer();
      return toast("تم مسح الاستثناء محليًا. اضغط (حفظ المسودة) ثم (نشر).", "ok");
    }

    const key = `${selectedCell.dayId}-${selectedCell.periodId}`;
    timetable.entries.delete(key);
    renderGrid();
    closeDrawer();
    toast("تم مسح الخلية.", "ok");
  }

  async function saveWeekOverridesDraft(silent = false) {
    if (!currentTimetableId) return;
    if (!weekStartISO) return;
    if (!overridesDirty) return;

    for (const [, oldVal] of overridesBaseline.entries()) {
      const oldKey = `${oldVal.date}-${oldVal.periodId}`;
      if (!overrides.has(oldKey)) {
        await apiSend(
          `/timetables/${currentTimetableId}/overrides?date=${encodeURIComponent(
            oldVal.date
          )}&periodId=${encodeURIComponent(oldVal.periodId)}`,
          "DELETE"
        );
      }
    }

    for (const [, o] of overrides.entries()) {
      if (!o?.date || !o?.periodId) continue;

      if (o.type !== "cancel") {
        if (!o.subjectId) throw new Error("يوجد حدث أسبوعي بدون مادة.");
        if (!o.teacherId) throw new Error("يوجد حدث أسبوعي بدون معلم.");
      }

      await apiSend(`/timetables/${currentTimetableId}/overrides`, "PUT", {
        override: {
          date: o.date,
          dayId: o.dayId,
          periodId: o.periodId,
          type: o.type || "lesson",
          subjectId: o.subjectId || null,
          teacherId: o.teacherId || null,
          room: o.room || null,
          notes: o.notes || null,
          examTitle: o.examTitle || null,
          examKind: o.examKind || "monthly",
          examTotal: o.examTotal ?? null,
        },
      });
    }

    overridesBaseline = cloneMapDeep(overrides);
    overridesDirty = false;

    if (!silent) {
      toast("تم حفظ تعديلات هذا الأسبوع ضمن المسودة.", "ok");
    }
  }

  async function saveDraft(silent = false) {
    if (!currentTimetableId) {
      if (!silent) toast("افتح جدول أولاً.", "err");
      return false;
    }

    if (currentTimetableStatus === "published") {
      if (!silent) toast("الجدول منشور — اضغط (إلغاء النشر) ثم حاول حفظ المسودة.", "err");
      return false;
    }

    const entries = Array.from(timetable.entries.values()).map((e) => ({
      dayId: e.dayId,
      periodId: e.periodId,
      subjectId: e.subjectId,
      teacherId: e.teacherId,
      room: e.room || null,
      notes: e.notes || null,
    }));

    try {
      await apiSend(`/timetables/${currentTimetableId}/entries`, "PUT", { entries });
      await saveWeekOverridesDraft(true);

      currentTimetableStatus = "draft";
      setStatusChip("draft");
      showUnpublishBtn();
      refreshStatsAndConflicts();
      clearConflictsUI();

      if (!silent) toast("تم حفظ المسودة.", "ok");
      return true;
    } catch (err) {
      console.error(err);

      if (err.status === 409 && err.payload?.conflicts) {
        renderArabicConflicts(err.payload.conflicts, "تعارض في الجدول");
        if (!silent) toast(err.message || "يوجد تعارض في توزيع المعلمين.", "err");
        throw err;
      }

      if (!silent) toast(err.message || "فشل حفظ المسودة.", "err");
      throw err;
    }
  }
async function publish() {
  if (!currentTimetableId) return toast("افتح جدول أولاً.", "err");

  const okConfirm = await wsConfirm({
    title: "نشر الجدول الأسبوعي",
    message:
      "سيتم نشر الجدول الأسبوعي للطلاب والمعلمين.\nبعد النشر لن تستطيع التعديل إلا بعد إلغاء النشر.",
    confirmText: "نشر الجدول",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!okConfirm) return;

  try {
    const ok = await saveDraft(true);
    if (!ok) return;

    await apiSend(`/timetables/${currentTimetableId}/publish`, "PUT", {});
    currentTimetableStatus = "published";
    setStatusChip("published");
    showUnpublishBtn();
    toast("تم نشر الجدول.", "ok");
  } catch (err) {
    console.error(err);
    toast(err.message || "فشل النشر.", "err");
  }
}

 async function unpublish() {
  if (!currentTimetableId) return;

  const ok = await wsConfirm({
    title: "إلغاء نشر الجدول الأسبوعي",
    message:
      "سيتم إلغاء نشر الجدول من البوابات.\nسيعود الجدول إلى وضع المسودة ويمكنك التعديل عليه.",
    confirmText: "إلغاء النشر",
    cancelText: "رجوع",
    type: "warning",
  });

  if (!ok) return;

  try {
    await apiSend(`/timetables/${currentTimetableId}/unpublish`, "PUT", {});
    currentTimetableStatus = "draft";
    setStatusChip("draft");
    showUnpublishBtn();
    toast("تم إلغاء النشر.", "ok");
  } catch (err) {
    console.error(err);
    toast(err.message || "فشل إلغاء النشر.", "err");
  }
}
 async function clearServerEntries() {
  if (!currentTimetableId) return toast("افتح جدول أولاً.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن تفريغ منشور — ألغِ النشر أولاً.", "err");
  }

  const ok = await wsConfirm({
    title: "تفريغ الجدول الأسبوعي",
    message:
      "سيتم حذف كل الحصص من هذا الجدول.\nسيبقى الجدول نفسه موجودًا كمسودة فارغة.",
    confirmText: "تفريغ الجدول",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/timetables/${currentTimetableId}/entries`, "DELETE");
    timetable.entries = new Map();
    overrides.clear();
    overridesBaseline.clear();
    overridesDirty = false;
    renderGrid();
    clearConflictsUI();
    toast("تم تفريغ الجدول (مسودة).", "ok");
  } catch (err) {
    console.error(err);
    toast(err.message || "فشل التفريغ.", "err");
  }
}

 async function deleteCurrentTimetable() {
  if (!currentTimetableId) return toast("لا يوجد جدول مفتوح.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن حذف جدول منشور — ألغِ النشر أولاً.", "err");
  }

  const ok = await wsConfirm({
    title: "حذف الجدول الأسبوعي",
    message:
      `سيتم حذف الجدول الحالي رقم #${currentTimetableId} بالكامل.\n` +
      "هذا الإجراء لا يمكن التراجع عنه.",
    confirmText: "حذف الجدول",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiSend(`/timetables/${currentTimetableId}`, "DELETE");
    toast("تم حذف الجدول.", "ok");

    timetable = { id: null, status: "draft", entries: new Map() };
    currentTimetableId = null;
    currentTimetableStatus = "draft";
    selectedCell = null;
    overrides.clear();
    overridesBaseline.clear();
    overridesDirty = false;

    setStatusChip("-");
    showUnpublishBtn();
    if (el("#wsInfoChip")) {
      el("#wsInfoChip").textContent =
        "تم حذف الجدول. اختر الفلاتر وافتح جدول جديد.";
    }
    clearConflictsUI();
    renderGrid();
  } catch (e) {
    toast(e.message || "فشل الحذف.", "err");
  }
}
  // ===== Manage modal =====
  function openManage() {
    el("#wsManageBackdrop")?.setAttribute("aria-hidden", "false");
    el("#wsManageModal")?.setAttribute("aria-hidden", "false");
  }

  function closeManage() {
    el("#wsManageBackdrop")?.setAttribute("aria-hidden", "true");
    el("#wsManageModal")?.setAttribute("aria-hidden", "true");
  }

  async function openByTimetableId(id) {
    const r2 = await apiGet(`/timetables/${id}`);
    const tt = r2.data.timetable;
    const entries = r2.data.entries || [];

    el("#wsYearSelect").value = tt.academic_year_id;
    el("#wsTermSelect").value = tt.term;

    el("#wsStageSelect").value = tt.stage_id;
    refilterGradesByStage();

    el("#wsGradeSelect").value = tt.grade_id;
    refilterSectionsByGrade();

    el("#wsSectionSelect").value = tt.section_id;

    currentTimetableId = tt.id;
    currentTimetableStatus = tt.status || "draft";
    setStatusChip(currentTimetableStatus);
    showUnpublishBtn();

    timetable = { id: tt.id, status: currentTimetableStatus, entries: new Map() };
    entries.forEach((e) => {
      const key = `${e.day_of_week}-${e.period_id}`;
      timetable.entries.set(key, {
        dayId: e.day_of_week,
        periodId: e.period_id,
        subjectId: e.subject_id,
        teacherId: e.teacher_id,
        subjectName: e.subject_name,
        teacherName: e.teacher_name,
        room: e.room || "",
        notes: e.notes || "",
      });
    });

    if (el("#wsInfoChip")) el("#wsInfoChip").textContent = `تم فتح الجدول #${tt.id}`;

    if (viewMode === "week" && weekStartISO) {
      await loadWeekOverrides();
    }

    clearConflictsUI();
    renderGrid();
    toast("تم فتح الجدول.", "ok");
  }

  async function loadManageList() {
    const sel = getSelection();
    if (!sel.academicYearId) return toast("اختر السنة أولاً.", "err");

    const qs = new URLSearchParams();
    qs.set("academicYearId", String(sel.academicYearId));
    qs.set("term", String(sel.term || 1));
    if (sel.stageId) qs.set("stageId", String(sel.stageId));
    if (sel.gradeId) qs.set("gradeId", String(sel.gradeId));
    if (sel.sectionId) qs.set("sectionId", String(sel.sectionId));

    const r = await apiGet("/timetables/list?" + qs.toString());
    const rows = r.data || [];
    const tbody = el("#wsManageTbody");
    if (!tbody) return;

    tbody.innerHTML = rows
      .map(
        (x) => `
      <tr>
        <td>${x.id}</td>
        <td>${escapeHtml(x.year_name || x.academic_year_id)}</td>
        <td>${escapeHtml(x.term)}</td>
        <td>${escapeHtml(x.stage_name || x.stage_id)}</td>
        <td>${escapeHtml(x.grade_name || x.grade_id)}</td>
        <td>${escapeHtml(x.section_name || x.section_id)}</td>
        <td>${escapeHtml(x.status)}</td>
        <td>${escapeHtml(x.entries_count)}</td>
        <td style="white-space:nowrap;">
          <button class="ws-btn ws-btn-ghost" data-open-id="${x.id}">فتح</button>
          <button class="ws-btn ws-btn-ghost" data-del-id="${x.id}">حذف</button>
        </td>
      </tr>
    `
      )
      .join("");

    tbody.querySelectorAll("[data-open-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.getAttribute("data-open-id"));
        await openByTimetableId(id);
        closeManage();
      });
    });

  tbody.querySelectorAll("[data-del-id]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = Number(btn.getAttribute("data-del-id"));

    const ok = await wsConfirm({
      title: "حذف جدول أسبوعي",
      message:
        `سيتم حذف الجدول رقم #${id}.\n` +
        "يجب أن يكون الجدول مسودة وغير منشور.\nهذا الإجراء لا يمكن التراجع عنه.",
      confirmText: "حذف الجدول",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    try {
      await apiSend(`/timetables/${id}`, "DELETE");
      toast("تم حذف الجدول.", "ok");
      await loadManageList();
    } catch (e) {
      toast(e.message || "فشل الحذف", "err");
    }
  });
});
  }

async function copyFromTimetable() {
  if (!currentTimetableId) return toast("افتح جدول الهدف أولاً.", "err");
  if (currentTimetableStatus === "published") {
    return toast("لا يمكن النسخ لجدول منشور.", "err");
  }

  const fromIdRaw = await wsPrompt({
    title: "نسخ من جدول آخر",
    message: "اكتب رقم الجدول المصدر الذي تريد النسخ منه.",
    placeholder: "مثال: 15",
    confirmText: "متابعة",
    cancelText: "إلغاء",
    type: "info",
    required: true,
    requiredMessage: "رقم الجدول المصدر مطلوب.",
  });

  if (fromIdRaw === null) return;

  const fromTimetableId = Number(fromIdRaw);
  if (!Number.isFinite(fromTimetableId) || fromTimetableId <= 0) {
    return toast("رقم غير صحيح.", "err");
  }

  const ok = await wsConfirm({
    title: "تأكيد نسخ الجدول",
    message:
      `سيتم نسخ محتوى الجدول رقم #${fromTimetableId} إلى الجدول الحالي رقم #${currentTimetableId}.\n` +
      "قد يتم استبدال أو إضافة حصص حسب منطق النظام.",
    confirmText: "تأكيد النسخ",
    cancelText: "إلغاء",
    type: "warning",
  });

  if (!ok) return;

  try {
    await apiSend(`/timetables/${currentTimetableId}/copy-from`, "POST", {
      fromTimetableId,
    });
    await reloadCurrentTimetable();
    clearConflictsUI();
    toast("تم النسخ بنجاح.", "ok");
  } catch (err) {
    console.error(err);

    if (err.status === 409 && err.payload?.conflicts) {
      renderArabicConflicts(err.payload.conflicts, "تعارض بعد النسخ");
      return toast(err.message || "لا يمكن النسخ بسبب تعارض.", "err");
    }

    toast(err.message || "فشل النسخ.", "err");
  }
}

  function bindEnterToOpen() {
    const ids = [
      "#wsYearSelect",
      "#wsTermSelect",
      "#wsStageSelect",
      "#wsGradeSelect",
      "#wsSectionSelect",
      "#wsSectionSearch",
    ];
    ids.forEach((s) => {
      el(s)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          createOrOpenTimetable();
        }
      });
    });
  }

  // ================================
  // ✅✅ تحميل المدرسين حسب السياق الحقيقي
  // ================================
  const teachersBySubjectCache = new Map();

  function teachersCacheKey(subjectId) {
    const sel = getSelection();
    return [
      String(subjectId || 0),
      String(sel.academicYearId || 0),
      String(sel.term || 1),
      String(sel.sectionId || 0),
    ].join("|");
  }

  async function loadTeachersForSubject(subjectId, keepTeacherId = null) {
    const teacherSel = el("#wsTeacherSelect");
    if (!teacherSel) return;

    if (!subjectId) {
      fillSelect(teacherSel, [], "اختر المعلم...");
      teacherSel.value = "";
      teacherSel.disabled = true;
      return;
    }

    teacherSel.innerHTML = `<option value="">جارٍ التحميل...</option>`;
    teacherSel.disabled = true;

    const sel = getSelection();
    const qs = new URLSearchParams();
    qs.set("subjectId", String(subjectId));
    if (sel.academicYearId) qs.set("academicYearId", String(sel.academicYearId));
    if (sel.term) qs.set("term", String(sel.term || 1));
    if (sel.sectionId) qs.set("sectionId", String(sel.sectionId));

    const key = teachersCacheKey(subjectId);

    try {
      let list = teachersBySubjectCache.get(key);
      if (!list) {
        const r = await apiGet(`/timetables/teachers?${qs.toString()}`);
        list = r?.data || r || [];
        teachersBySubjectCache.set(key, list);
      }

      if (!list.length) {
        fillSelect(teacherSel, [], "لا يوجد مدرس مُعيّن لهذه المادة");
        teacherSel.value = "";
        teacherSel.disabled = true;
        return;
      }

      fillSelect(teacherSel, list, "اختر المعلم...");
      teacherSel.disabled = false;

      if (keepTeacherId && list.some((x) => String(x.id) === String(keepTeacherId))) {
        teacherSel.value = String(keepTeacherId);
      } else {
        teacherSel.value = "";
      }
    } catch (e) {
      console.error(e);
      fillSelect(teacherSel, meta?.teachers || [], "اختر المعلم...");
      teacherSel.disabled = false;
    }
  }

  function isDrawerOpen() {
    return document.documentElement.classList.contains("ws-open");
  }

  async function reloadTeachersIfNeeded() {
    if (!isDrawerOpen()) return;
    const sid = Number(el("#wsSubjectSelect")?.value || 0);
    if (!sid) return;
    await loadTeachersForSubject(sid, null);
  }

  function bindEvents() {
    el("#wsStageSelect")?.addEventListener("change", () => {
      refilterGradesByStage();
      teachersBySubjectCache.clear();
      reloadTeachersIfNeeded();
    });

    el("#wsGradeSelect")?.addEventListener("change", () => {
      refilterSectionsByGrade();
      teachersBySubjectCache.clear();
      reloadTeachersIfNeeded();
    });

    ["#wsYearSelect", "#wsTermSelect", "#wsSectionSelect"].forEach((s) => {
      el(s)?.addEventListener("change", () => {
        teachersBySubjectCache.clear();
        reloadTeachersIfNeeded();
      });
    });

    el("#wsDrawerClose")?.addEventListener("click", closeDrawer);
    el("#wsDrawerBackdrop")?.addEventListener("click", closeDrawer);

    el("#wsCellSaveBtn")?.addEventListener("click", applyCellSave);
    el("#wsCellClearBtn")?.addEventListener("click", applyCellClear);

    el("#wsCreateBtn")?.addEventListener("click", createOrOpenTimetable);
    el("#wsSaveDraftBtn")?.addEventListener("click", () => saveDraft(false));
    el("#wsPublishBtn")?.addEventListener("click", publish);
    el("#wsUnpublishBtn")?.addEventListener("click", unpublish);

    el("#wsReloadMetaBtn")?.addEventListener("click", loadMeta);
    el("#wsClearBtn")?.addEventListener("click", clearServerEntries);

    el("#wsCopyBtn")?.addEventListener("click", copyFromTimetable);

    el("#wsManageBtn")?.addEventListener("click", async () => {
      openManage();
      await loadManageList();
    });
    el("#wsManageClose")?.addEventListener("click", closeManage);
    el("#wsManageBackdrop")?.addEventListener("click", closeManage);
    el("#wsManageRefresh")?.addEventListener("click", loadManageList);

    el("#wsDeleteCurrentBtn")?.addEventListener("click", deleteCurrentTimetable);

    // ✅ Periods modal bindings
    el("#wsPeriodsBtn")?.addEventListener("click", async () => {
      openPeriodsModal();
      await refreshPeriodsAndGrid();
    });
    el("#wsPeriodsClose")?.addEventListener("click", closePeriodsModal);
    el("#wsPeriodsBackdrop")?.addEventListener("click", closePeriodsModal);
    el("#wsPeriodsRefresh")?.addEventListener("click", refreshPeriodsAndGrid);
    el("#wsPeriodsAddBtn")?.addEventListener("click", () => {
      const periods = getPeriods();
      const maxSort = (periods || []).reduce((m, x) => Math.max(m, Number(x.sort_order || 0)), 0);
      if (el("#wsPSort")) el("#wsPSort").value = String(maxSort + 1);
      el("#wsPName")?.focus();
    });
    el("#wsPeriodsSaveNew")?.addEventListener("click", createNewPeriod);
    el("#wsPeriodsClearNew")?.addEventListener("click", clearNewPeriodForm);

    // ✅ عند تغيير المادة داخل الدرج: حمّل المعلمين حسب (السنة+الترم+الشعبة)
    el("#wsSubjectSelect")?.addEventListener("change", async () => {
      const subjectId = Number(el("#wsSubjectSelect").value || 0);
      await loadTeachersForSubject(subjectId);
    });

    // بحث الشعبة
    const searchBox = el("#wsSectionSearch");
    const sectionSel = el("#wsSectionSelect");
    if (searchBox && sectionSel) {
      searchBox.addEventListener("input", (e) => {
        const q = (e.target.value || "").trim();
        Array.from(sectionSel.options).forEach((opt) => {
          if (!opt.value) return;
          opt.hidden = q ? !opt.textContent.includes(q) : false;
        });
      });
    }

    function setMode(m) {
      viewMode = m;
      el("#wsModeTemplate")?.classList.toggle("ws-btn-active", m === "template");
      el("#wsModeWeek")?.classList.toggle("ws-btn-active", m === "week");
      renderGrid();
    }

    function updateWeekLabel() {
      const lab = el("#wsWeekLabel");
      if (!lab) return;
      if (viewMode !== "week" || !weekStartISO) return (lab.textContent = "—");

      const end = fromISODate(weekStartISO);
      end.setDate(end.getDate() + 5);
      lab.textContent = `من ${weekStartISO} إلى ${toISODate(end)}`;
    }

    el("#wsModeTemplate")?.addEventListener("click", () => {
      if (!ensureWeekChangesSaved()) return;
      setMode("template");
    });

    el("#wsModeWeek")?.addEventListener("click", async () => {
      if (!weekStartISO) {
        weekStartISO = toISODate(weekStartSaturday(new Date()));
        if (el("#wsWeekStart")) el("#wsWeekStart").value = weekStartISO;
      }
      setMode("week");
      updateWeekLabel();
      await loadWeekOverrides();
      renderGrid();
    });

    el("#wsWeekStart")?.addEventListener("change", async () => {
      if (!ensureWeekChangesSaved()) {
        if (el("#wsWeekStart")) el("#wsWeekStart").value = weekStartISO || "";
        return;
      }

      const v = el("#wsWeekStart")?.value;
      if (!v) return;

      weekStartISO = toISODate(weekStartSaturday(fromISODate(v)));
      el("#wsWeekStart").value = weekStartISO;
      updateWeekLabel();

      if (viewMode === "week") {
        await loadWeekOverrides();
        renderGrid();
      }
    });

    el("#wsWeekPrev")?.addEventListener("click", async () => {
      if (!ensureWeekChangesSaved()) return;
      if (!weekStartISO) return;

      const d = fromISODate(weekStartISO);
      d.setDate(d.getDate() - 7);
      weekStartISO = toISODate(d);

      el("#wsWeekStart").value = weekStartISO;
      updateWeekLabel();

      if (viewMode === "week") {
        await loadWeekOverrides();
        renderGrid();
      }
    });

    el("#wsWeekNext")?.addEventListener("click", async () => {
      if (!ensureWeekChangesSaved()) return;
      if (!weekStartISO) return;

      const d = fromISODate(weekStartISO);
      d.setDate(d.getDate() + 7);
      weekStartISO = toISODate(d);

      el("#wsWeekStart").value = weekStartISO;
      updateWeekLabel();

      if (viewMode === "week") {
        await loadWeekOverrides();
        renderGrid();
      }
    });

el("#wsEntryType")?.addEventListener("change", () => {
  toggleExamFields();
  fillDefaultExamTotalIfEmpty();
});

el("#wsExamKind")?.addEventListener("change", () => {
  const totalEl = el("#wsExamTotal");
  if (totalEl) totalEl.value = String(getDefaultExamTotal(el("#wsExamKind")?.value || "monthly"));
});
    bindEnterToOpen();
  }

  // init
  let inited = false;

  async function initWeeklySchedule() {
    if (inited) return;
    const root = document.getElementById("weeklySchedulePage");
    if (!root) return;

    inited = true;
    await loadMeta();
    bindEvents();
  }

  window.initWeeklySchedule = initWeeklySchedule;

  function watchForInjection() {
    const tryInit = () => initWeeklySchedule();
    tryInit();

    const obs = new MutationObserver(() => tryInit());
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchForInjection);
  } else {
    watchForInjection();
  }
})();