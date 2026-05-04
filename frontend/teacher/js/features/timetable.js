// teacher/features/timetable.js
(function () {
  "use strict";

  const TT_TAB_KEY = "teacher_tt_tab";
  const TT_LS_YEAR = "TT_YEAR_ID";
  const TT_LS_TERM = "TT_TERM";
  const TT_LS_WEEK = "TT_WEEK_START";

  const dayNameById = {
    1: "السبت",
    2: "الأحد",
    3: "الاثنين",
    4: "الثلاثاء",
    5: "الأربعاء",
    6: "الخميس",
    7: "الجمعة",
  };

  function pick(obj, keys, fallback = "") {
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fallback;
  }

  function getDayId(e) {
    return Number(pick(e, ["day_of_week", "dayId", "day"], 0));
  }

  // ✅ period_id لازم يكون هو periods.id (وليس sort_order)
  function getPeriodId(e) {
    return Number(pick(e, ["period_id", "periodId"], 0));
  }

  // ✅ رقم الحصة للعرض فقط (sort_order / lesson_no لو رجع من API)
  function getLessonNoFromEntry(e) {
    return Number(pick(e, ["period_sort_order", "lesson_no", "lessonNo", "period_order"], 0));
  }

  function getSubject(e) {
    return pick(e, ["subject_name", "subject", "subjectName"], "—");
  }
  function getGrade(e) {
    return pick(e, ["grade_name", "grade", "gradeName"], "");
  }
  function getSection(e) {
    return pick(e, ["section_name", "section", "sectionName"], "");
  }
  function getRoom(e) {
    return pick(e, ["room"], "");
  }

  function getEntryType(e) {
    return String(pick(e, ["type", "entry_type"], "lesson") || "lesson").toLowerCase();
  }

  // عناصر سيتم ربطها في init()
  let ttTabWeekly, ttTabExams, ttViewWeekly, ttViewExams;
  let ttYearSel, ttTermSel, ttLoadBtn;

  // ✅ Week controls
  let ttWeekInp, ttWeekPrev, ttWeekNext, ttWeekLabel;

  let exTypeSel, exMonthWrap, exMonthSel, exSubjectSel, exLoadBtn, exBody, exEmpty;

  // ====== Meta الأسبوعي ======
  let ttMeta = null;

  async function ensureTimetableMeta() {
    if (ttMeta) return ttMeta;

    const res = await apiGet("/teacher/timetables/meta");
    ttMeta = res?.data || res || {};
    const years = ttMeta?.years || ttMeta?.data?.years || [];

    if (ttYearSel) {
      ttYearSel.innerHTML = "";
      if (!years.length) {
        ttYearSel.innerHTML = `<option value="1">سنة افتراضية</option>`;
      } else {
        years.forEach((y) => {
          const id = y.id ?? y.value ?? y.year_id ?? y.academic_year_id;
          const name = y.name ?? y.label ?? y.year_name ?? `سنة ${id}`;
          ttYearSel.insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(name)}</option>`);
        });
      }

      const saved = Number(localStorage.getItem(TT_LS_YEAR) || "");
      const can = Array.from(ttYearSel.options).some((o) => String(o.value) === String(saved));
      ttYearSel.value = can ? String(saved) : ttYearSel.options[0]?.value || "1";
    }

    if (ttTermSel) {
      const savedTerm = localStorage.getItem(TT_LS_TERM) || "1";
      ttTermSel.value = savedTerm === "2" ? "2" : "1";
    }

    // Week default UI
    getWeekStartISO();
    updateWeekLabelUI();

    return ttMeta;
  }

  // ====== Week helpers (✅ Local no UTC) ======
  function toISODate(d) {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const day = String(x.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`; // ✅ local
  }

  function fromISODate(iso) {
    const s = String(iso || "").slice(0, 10);
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1); // ✅ local
  }

  // بداية الأسبوع = السبت
  function weekStartSaturday(anyDate) {
    const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay(); // Sunday=0 ... Saturday=6
    const back = (dow + 1) % 7; // السبت => 0، الأحد => 1 ...
    d.setDate(d.getDate() - back);
    return d;
  }

  function addDaysISO(iso, days) {
    const d = fromISODate(iso);
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function getWeekStartISO() {
    const v = (ttWeekInp?.value || localStorage.getItem(TT_LS_WEEK) || "").trim();
    const base = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : toISODate(new Date());
    const ws = toISODate(weekStartSaturday(fromISODate(base)));

    if (ttWeekInp) ttWeekInp.value = ws;
    localStorage.setItem(TT_LS_WEEK, ws);
    return ws;
  }

  function dayDateISO(dayId) {
    const ws = getWeekStartISO();
    return addDaysISO(ws, Number(dayId) - 1);
  }

  function updateWeekLabelUI() {
    if (!ttWeekLabel) return;
    const ws = getWeekStartISO();
    const we = addDaysISO(ws, 5); // السبت..الخميس
    ttWeekLabel.textContent = `من ${ws} إلى ${we}`;
  }

  function todayISO() {
    return toISODate(new Date()); // ✅ local
  }

  async function loadTeacherTimetable() {
    const tbody = $("tt-table-body");
    if (!tbody) return;

    const table = tbody.closest("table");
    const thead = table
      ? table.querySelector("thead") || table.insertBefore(document.createElement("thead"), table.firstChild)
      : null;

    await ensureTimetableMeta();

    const yearId = Number(ttYearSel?.value || localStorage.getItem(TT_LS_YEAR) || 1);
    const term = Number(ttTermSel?.value || localStorage.getItem(TT_LS_TERM) || 1);

    try {
      const daysRaw = ttMeta?.days || ttMeta?.data?.days || [];
      const periodsRaw = ttMeta?.periods || ttMeta?.data?.periods || [];

      const days = (daysRaw || []).filter((d) => [1, 2, 3, 4, 5, 6].includes(Number(d.id)));

      const periods = (periodsRaw || [])
        .slice()
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

      const weekStart = getWeekStartISO();
      updateWeekLabelUI();

      const sch = await apiGet(
        `/teacher/timetables?academicYearId=${encodeURIComponent(yearId)}&term=${encodeURIComponent(
          term
        )}&weekStart=${encodeURIComponent(weekStart)}`
      );

      const entries = sch?.data?.entries || sch?.entries || [];

      const map = new Map();
      for (const e of entries) {
        const dayId = getDayId(e);
        const periodId = getPeriodId(e);
        if (!dayId || !periodId) continue;
        map.set(`${dayId}-${periodId}`, e);
      }

      if (thead) {
        const ths = periods
          .map((p) => {
            const st = String(p.start_time || "").slice(0, 5);
            const en = String(p.end_time || "").slice(0, 5);
            const time = st && en ? `<div class="tt-time">${escapeHtml(st)} - ${escapeHtml(en)}</div>` : "";

            const lessonNo = Number(p.sort_order || 0) || "";
            const title = lessonNo ? `الحصة ${lessonNo}` : `الحصة ${escapeHtml(p.name || p.id)}`;

            return `<th class="tt-period-th" data-period-id="${escapeHtml(p.id)}">
              <div class="tt-period-title">${title}</div>
              ${time}
            </th>`;
          })
          .join("");

        thead.innerHTML = `<tr><th class="tt-day-th">اليوم</th>${ths}</tr>`;
      }

      const tISO = todayISO();

      tbody.innerHTML = days
        .map((d) => {
          const dISO = dayDateISO(Number(d.id));
          const isToday = dISO === tISO;

          const tds = periods
            .map((p) => {
              const e = map.get(`${Number(d.id)}-${Number(p.id)}`);
              if (!e) return `<td class="tt-cell"><div class="tt-empty">—</div></td>`;

              const type = getEntryType(e);
              const cls = `${getGrade(e)} / ${getSection(e)}`.trim();
              const room = getRoom(e);

              if (type === "cancel") {
                const sub = escapeHtml(getSubject(e));
                return `<td class="tt-cell" data-day-id="${escapeHtml(d.id)}" data-period-id="${escapeHtml(p.id)}">
                  <div class="tt-lesson" style="border-color:rgba(239,68,68,.55); background:rgba(239,68,68,.08);">
                    <div class="tt-lesson__sub">🚫 ملغاة</div>
                    <div class="tt-lesson__meta">
                      <span>${sub}</span>
                      ${cls ? `<span>•</span><span>${escapeHtml(cls)}</span>` : ``}
                    </div>
                  </div>
                </td>`;
              }

              if (type === "exam") {
                const title = escapeHtml(e.exam_title || e.examTitle || "اختبار");
                const sub = escapeHtml(getSubject(e));
                return `<td class="tt-cell" data-day-id="${escapeHtml(d.id)}" data-period-id="${escapeHtml(p.id)}">
                  <div class="tt-lesson" style="border-color:rgba(245,158,11,.65); background:rgba(245,158,11,.10);">
                    <div class="tt-lesson__sub">📝 ${title}</div>
                    <div class="tt-lesson__meta">
                      <span>المادة: ${sub}</span>
                      ${cls ? `<span>•</span><span>${escapeHtml(cls)}</span>` : ``}
                      ${room ? `<span>•</span><span>قاعة: ${escapeHtml(room)}</span>` : ``}
                    </div>
                  </div>
                </td>`;
              }

              return `<td class="tt-cell" data-day-id="${escapeHtml(d.id)}" data-period-id="${escapeHtml(p.id)}">
                <div class="tt-lesson">
                  <div class="tt-lesson__sub">${escapeHtml(getSubject(e))}</div>
                  <div class="tt-lesson__meta">
                    ${cls ? `<span>${escapeHtml(cls)}</span>` : ``}
                    ${room ? `<span>•</span><span>قاعة: ${escapeHtml(room)}</span>` : ``}
                  </div>
                </div>
              </td>`;
            })
            .join("");

          return `<tr class="${isToday ? "tt-today-row" : ""}">
            <th class="tt-day-row">
              ${escapeHtml(dayNameById[Number(d.id)] || d.name || d.id)}
              <span style="opacity:.7; font-weight:400;">(${escapeHtml(dISO)})</span>
              ${isToday ? `<span class="tt-today-badge">اليوم</span>` : ``}
            </th>
            ${tds}
          </tr>`;
        })
        .join("");

      const infoBox = $("tt-next-info");
      const nextSmall = $("next-class-small");

      const periodOrderMap = new Map(periods.map((p) => [String(p.id), Number(p.sort_order || 0)]));

      const onlyLessons = entries.filter((x) => getEntryType(x) === "lesson");
      const src = onlyLessons.length ? onlyLessons : entries;

      const sorted = src.slice().sort((a, b) => {
        const da = getDayId(a) - getDayId(b);
        if (da) return da;
        const pa = Number(periodOrderMap.get(String(getPeriodId(a))) || getLessonNoFromEntry(a) || 0);
        const pb = Number(periodOrderMap.get(String(getPeriodId(b))) || getLessonNoFromEntry(b) || 0);
        return pa - pb;
      });

      if (sorted[0]) {
        const n = sorted[0];
        const dayName = dayNameById[getDayId(n)] || "";
        const cls = `${getGrade(n)} / ${getSection(n)}`.trim();

        const pid = getPeriodId(n);
        const lessonNo = Number(periodOrderMap.get(String(pid)) || getLessonNoFromEntry(n) || 0) || pid;

        const txt = `${dayName} — الحصة ${lessonNo} — ${getSubject(n)} (${cls})`;
        if (infoBox) infoBox.textContent = "✅ أقرب حصة: " + txt;
        if (nextSmall) nextSmall.textContent = txt;
      } else {
        if (infoBox) infoBox.textContent = "لا توجد حصص منشورة لهذا الترم/السنة.";
        if (nextSmall) nextSmall.textContent = "لا توجد حصص.";
      }
    } catch (err) {
      console.log("TT ERROR:", err);
      const infoBox = $("tt-next-info");
      if (infoBox) infoBox.textContent = "فشل تحميل الجدول: " + (err.message || "");
      tbody.innerHTML = `<tr><td class="empty-state">تعذر تحميل الجدول</td></tr>`;
    }
  }

  // ====== Meta الاختبارات ======
  const MONTHS_AR = [
    { id: 1, name: "يناير" },
    { id: 2, name: "فبراير" },
    { id: 3, name: "مارس" },
    { id: 4, name: "أبريل" },
    { id: 5, name: "مايو" },
    { id: 6, name: "يونيو" },
    { id: 7, name: "يوليو" },
    { id: 8, name: "أغسطس" },
    { id: 9, name: "سبتمبر" },
    { id: 10, name: "أكتوبر" },
    { id: 11, name: "نوفمبر" },
    { id: 12, name: "ديسمبر" },
  ];
  const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  function exTypeName(t, month) {
    if (t === "monthly") {
      const mName = MONTHS_AR.find((m) => String(m.id) === String(month))?.name;
      return `شهري${month ? " - " + (mName || month) : ""}`;
    }
    if (t === "midyear") return "نصف العام";
    if (t === "final") return "آخر العام";
    return t || "—";
  }

  function dayNameFromISO(iso) {
    const dStr = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return "—";
    const d = fromISODate(dStr); // ✅ local
    const AR_DAYS_L = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    return AR_DAYS_L[d.getDay()] || "—";
  }

  let exMetaLoaded = false;

  function syncExamMonthUI() {
    const t = String(exTypeSel?.value || "midyear");
    if (exMonthWrap) exMonthWrap.style.display = t === "monthly" ? "" : "none";
    if (t !== "monthly" && exMonthSel) exMonthSel.value = "";
  }

  async function ensureExamMeta() {
    if (exMetaLoaded) return;

    try {
      let meta = null;
      try {
        const r = await apiGet("/teacher/timetables/exams/meta");
        meta = r?.data || r || {};
      } catch (e) {
        console.warn("teacher exams meta not ready:", e);
        meta = { months: MONTHS_AR, subjects: [] };
      }

      const prevMonth = exMonthSel?.value || "";
      const prevSub = exSubjectSel?.value || "";

      if (exMonthSel) {
        const months = Array.isArray(meta.months) && meta.months.length ? meta.months : MONTHS_AR;
        exMonthSel.innerHTML =
          `<option value="">كل الأشهر</option>` +
          months.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
        exMonthSel.value = prevMonth;
      }

      if (exSubjectSel) {
        const subs = Array.isArray(meta.subjects) ? meta.subjects : [];
        exSubjectSel.innerHTML =
          `<option value="">كل المواد</option>` +
          subs.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
        exSubjectSel.value = prevSub;
      }

      syncExamMonthUI();
      exMetaLoaded = true;
    } catch (e) {
      console.error(e);
      exMetaLoaded = true;
    }
  }

  function renderTeacherExams(rows) {
    if (!exBody) return;

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      if (exEmpty) exEmpty.style.display = "block";
      exBody.innerHTML = `<tr><td colspan="8" class="empty-state">لا توجد اختبارات مطابقة للفلاتر.</td></tr>`;
      return;
    }

    if (exEmpty) exEmpty.style.display = "none";

    exBody.innerHTML = list
      .map((x) => {
        const date = String(x.exam_date || x.date || "—").slice(0, 10);
        const day = dayNameFromISO(date);
        const subject = escapeHtml(x.subject_name || x.subjectName || x.subject || "—");
        const type = exTypeName(x.exam_type || x.examType, x.month);

        const st = String(x.start_time || x.start || "—").slice(0, 5);
        const en = String(x.end_time || x.end || "—").slice(0, 5);
        const time = `${escapeHtml(st)} - ${escapeHtml(en)}`;

        const grade = escapeHtml(x.grade_name || x.grade || x.gradeName || "");
        const section = escapeHtml(x.section_name || x.section || x.sectionName || "");
        const cls = grade || section ? `${grade}${section ? " / " + section : ""}` : "—";

        const room = escapeHtml(x.room ?? "—");
        const notes = escapeHtml(x.notes && String(x.notes).trim() ? String(x.notes).trim() : "—");

        return `<tr>
          <td>${escapeHtml(date)}</td>
          <td>${escapeHtml(day)}</td>
          <td>${subject}</td>
          <td>${escapeHtml(type)}</td>
          <td>${time}</td>
          <td>${cls}</td>
          <td>${room}</td>
          <td>${notes}</td>
        </tr>`;
      })
      .join("");
  }

  async function loadTeacherExams() {
    if (!exBody) return;

    await ensureExamMeta();

    const yearId = Number(ttYearSel?.value || localStorage.getItem(TT_LS_YEAR) || 1);
    const term = Number(ttTermSel?.value || localStorage.getItem(TT_LS_TERM) || 1);

    const examType = String(exTypeSel?.value || "midyear");
    const month = String(exMonthSel?.value || "");
    const subjectId = String(exSubjectSel?.value || "");

    const qs = new URLSearchParams();
    qs.set("academicYearId", String(yearId));
    qs.set("term", String(term));
    qs.set("examType", examType);
    if (examType === "monthly" && month) qs.set("month", month);
    if (subjectId) qs.set("subjectId", subjectId);

    try {
      const r = await apiGet("/teacher/timetables/exams?" + qs.toString());
      const rows = r?.data?.exams || r?.data || r?.exams || [];
      renderTeacherExams(rows);
    } catch (e) {
      console.error(e);
      renderTeacherExams([]);
      showToast("API اختبارات المعلم غير جاهز أو المسار غير صحيح: /api/teacher/timetables/exams");
    }
  }

  function setTimetableTab(tab, silent = false) {
    const t = tab === "exams" ? "exams" : "weekly";
    localStorage.setItem(TT_TAB_KEY, t);

    if (ttTabWeekly) ttTabWeekly.style.opacity = t === "weekly" ? "1" : ".75";
    if (ttTabExams) ttTabExams.style.opacity = t === "exams" ? "1" : ".75";

    if (ttViewWeekly) ttViewWeekly.style.display = t === "weekly" ? "" : "none";
    if (ttViewExams) ttViewExams.style.display = t === "exams" ? "" : "none";

    if (t === "weekly") {
      ensureTimetableMeta().then(loadTeacherTimetable).catch(console.error);
    } else {
      ensureExamMeta().then(loadTeacherExams).catch(console.error);
    }

    if (!silent) showToast(t === "weekly" ? "عرض الجدول الأسبوعي" : "عرض جدول الاختبارات");
  }

  function applyDefaultTab() {
    const savedTab = localStorage.getItem(TT_TAB_KEY) || "weekly";
    if (ttViewWeekly && ttViewExams) {
      ttViewWeekly.style.display = savedTab === "weekly" ? "" : "none";
      ttViewExams.style.display = savedTab === "exams" ? "" : "none";
    }
  }

  function init() {
    // tabs
    ttTabWeekly = $("tt-tab-weekly");
    ttTabExams = $("tt-tab-exams");
    ttViewWeekly = $("tt-view-weekly");
    ttViewExams = $("tt-view-exams");

    ttYearSel = $("tt-year");
    ttTermSel = $("tt-term");
    ttLoadBtn = $("tt-load-real");

    // ✅ week controls (لازم تكون موجودة في HTML)
    ttWeekInp = $("tt-week-start");
    ttWeekPrev = $("tt-week-prev");
    ttWeekNext = $("tt-week-next");
    ttWeekLabel = $("tt-week-label");

    // ✅ افتح دائمًا على أسبوع اليوم
    const ws = toISODate(weekStartSaturday(new Date()));
    if (ttWeekInp) ttWeekInp.value = ws;
    localStorage.setItem(TT_LS_WEEK, ws);

    // exams controls
    exTypeSel = $("tt-ex-type");
    exMonthWrap = $("tt-ex-month-wrap");
    exMonthSel = $("tt-ex-month");
    exSubjectSel = $("tt-ex-subject");
    exLoadBtn = $("tt-ex-load");
    exBody = $("tt-ex-body");
    exEmpty = $("tt-ex-empty");

    ttTabWeekly?.addEventListener("click", () => setTimetableTab("weekly", true));
    ttTabExams?.addEventListener("click", () => setTimetableTab("exams", true));

    ttLoadBtn?.addEventListener("click", () => {
      const y = ttYearSel?.value || "1";
      const t = ttTermSel?.value || "1";
      localStorage.setItem(TT_LS_YEAR, String(y));
      localStorage.setItem(TT_LS_TERM, String(t));
      loadTeacherTimetable();
    });

    ttYearSel?.addEventListener("change", () => localStorage.setItem(TT_LS_YEAR, String(ttYearSel.value || "1")));
    ttTermSel?.addEventListener("change", () => localStorage.setItem(TT_LS_TERM, String(ttTermSel.value || "1")));

    // ✅ week bindings
    getWeekStartISO();
    updateWeekLabelUI();

    ttWeekInp?.addEventListener("change", () => {
      getWeekStartISO();
      updateWeekLabelUI();
      loadTeacherTimetable();
    });

    ttWeekPrev?.addEventListener("click", () => {
      const ws2 = getWeekStartISO();
      const prev = addDaysISO(ws2, -7);
      if (ttWeekInp) ttWeekInp.value = prev;
      localStorage.setItem(TT_LS_WEEK, prev);
      updateWeekLabelUI();
      loadTeacherTimetable();
    });

    ttWeekNext?.addEventListener("click", () => {
      const ws2 = getWeekStartISO();
      const next = addDaysISO(ws2, 7);
      if (ttWeekInp) ttWeekInp.value = next;
      localStorage.setItem(TT_LS_WEEK, next);
      updateWeekLabelUI();
      loadTeacherTimetable();
    });

    // exams
    exTypeSel?.addEventListener("change", syncExamMonthUI);
    exLoadBtn?.addEventListener("click", loadTeacherExams);

    applyDefaultTab();
  }

  window.TeacherTimetable = {
    init,
    setTab: setTimetableTab,
    ensureTimetableMeta,
    loadTeacherTimetable,
    ensureExamMeta,
    loadTeacherExams,
    applyDefaultTab,
    TT_LS_YEAR,
    TT_LS_TERM,
    TT_LS_WEEK,
  };
})();