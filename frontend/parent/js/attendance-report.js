// frontend/parent/js/attendance-report.js
(function () {
  "use strict";

  if (window.__PARENT_ATT_REPORT_LOADED__) return;
  window.__PARENT_ATT_REPORT_LOADED__ = true;

  const $ = (id) => document.getElementById(id);

  const API_BASE = String(
    window.API_BASE || localStorage.getItem("API_BASE") || window.location.origin
  ).replace(/\/+$/, "");

  function toast(msg) {
    if (typeof window.showToast === "function") return window.showToast(msg);
    console.warn(msg);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  function dayNameFromISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
    if (!m) return "—";
    const y = +m[1], mo = +m[2] - 1, da = +m[3];
    const js = new Date(y, mo, da).getDay();
    return AR_DAYS[js] || "—";
  }

  function dateFromISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function isoFromDate(d) {
    if (!(d instanceof Date)) return "";
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const da = pad2(d.getDate());
    return `${y}-${m}-${da}`;
  }

  function addDaysISO(iso, days) {
    const d = dateFromISO(iso);
    if (!d) return "";
    d.setDate(d.getDate() + Number(days || 0));
    return isoFromDate(d);
  }

  // ✅ بداية أسبوع المدرسة = السبت
  function schoolWeekStartISO(endIso) {
    const d = dateFromISO(endIso);
    if (!d) return "";
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const backToSat = (jsDay - 6 + 7) % 7; // Sat->0, Sun->1, Mon->2, ...
    d.setDate(d.getDate() - backToSat);
    return isoFromDate(d);
  }

  function firstDayOfMonthISO(iso) {
    const d = dateFromISO(iso);
    if (!d) return "";
    return isoFromDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function lastDayOfMonthISO(iso) {
    const d = dateFromISO(iso);
    if (!d) return "";
    return isoFromDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  function prevMonthFromAnyISO(iso) {
    const d = dateFromISO(iso);
    if (!d) return "";
    return isoFromDate(new Date(d.getFullYear(), d.getMonth() - 1, 15));
  }

  // ====== URL + API ======
  function normalizeUrl(url) {
    const u = String(url || "");
    if (!u) return u;
    if (u.startsWith("/")) return API_BASE + u;
    return u;
  }

  async function apiGet(url) {
    const finalUrl = normalizeUrl(url);

    if (typeof window.apiFetch === "function") {
      return window.apiFetch(finalUrl, { method: "GET" });
    }

    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("ACCESS_TOKEN") ||
      localStorage.getItem("AUTH_TOKEN") ||
      "";

    const r = await fetch(finalUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(txt || ("HTTP " + r.status));
    }

    return r.json();
  }

  // ====== اختيار الطالب ======
  function getSelectedStudentId() {
    const sel = $("selChild");
    const v = sel ? sel.value : "";
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function getSelectedStudentName() {
    const sel = $("selChild");
    if (!sel) return "—";
    const opt = sel.options && sel.options[sel.selectedIndex];
    return opt ? (opt.textContent || "—").trim() : "—";
  }

  function getYearTerm() {
    const yearId =
      Number(localStorage.getItem("TT_YEAR_ID")) ||
      Number(localStorage.getItem("P_YEAR_ID")) ||
      0;

    const term =
      Number(localStorage.getItem("TT_TERM")) ||
      Number(localStorage.getItem("P_TERM")) ||
      1;

    return {
      yearId: Number.isFinite(yearId) && yearId > 0 ? yearId : null,
      term: term === 2 ? 2 : 1,
    };
  }

  // ====== إذن اليوم كنص واضح ======
  function permitLabel(permit) {
    if (!permit || !permit.exists) return "لا يوجد";

    const s = String(permit.status || "");
    const t = String(permit.type || "");

    const typeAr =
      t === "ABSENCE" ? "غياب" :
      t === "LATE" ? "تأخر" :
      t === "EARLY_LEAVE" ? "انصراف مبكر" : (t || "إذن");

    const statusAr =
      s === "PENDING" ? "بانتظار الإدارة" :
      s === "APPROVED" ? "مقبول" :
      s === "REJECTED" ? "مرفوض" : (s || "—");

    return `${typeAr} — ${statusAr}`;
  }

  // ====== تقرير اليوم (خارج المودال) ======
  async function loadToday() {
    const studentId = getSelectedStudentId();
    const name = getSelectedStudentName();
    const iso = todayISO();
    const { yearId, term } = getYearTerm();

    const elChild = $("att-today-child");
    const elDate = $("att-today-date");
    const elStatus = $("att-today-status");

    const elP = $("att-today-present");
    const elA = $("att-today-absent");
    const elL = $("att-today-late");
    const elE = $("att-today-excused");
    const elPerm = $("att-today-perm");

    const bannerWrap = $("att-today-banner");
    const bannerText = $("att-today-banner-text");

    if (elChild) elChild.textContent = name || "—";
    if (elDate) elDate.textContent = iso + " — " + dayNameFromISO(iso);

    if (!studentId) {
      if (elStatus) elStatus.textContent = "اختر ابنًا لعرض تقرير اليوم.";
      if (bannerWrap) bannerWrap.style.display = "none";
      if (elP) elP.textContent = "حاضر (حصص): —";
      if (elA) elA.textContent = "غائب (حصص): —";
      if (elL) elL.textContent = "متأخر (حصص): —";
      if (elE) elE.textContent = "بعذر (حصص): —";
      if (elPerm) elPerm.textContent = "إذن اليوم: —";
      return;
    }

    try {
      if (elStatus) elStatus.textContent = "جاري تحميل تقرير اليوم…";

      const qs = new URLSearchParams({
        studentId: String(studentId),
        date: iso,
        term: String(term),
      });
      if (yearId) qs.set("yearId", String(yearId));

      const data = await apiGet("/api/parent/attendance/today?" + qs.toString());
      const c = data.counts || data;

      if (elP) elP.textContent = "حاضر (حصص): " + (c.present ?? 0);
      if (elA) elA.textContent = "غائب (حصص): " + (c.absent ?? 0);
      if (elL) elL.textContent = "متأخر (حصص): " + (c.late ?? 0);
      if (elE) elE.textContent = "بعذر (حصص): " + (c.excused ?? 0);

      if (elPerm) elPerm.textContent = "إذن اليوم: " + permitLabel(data.permit);

      if (elStatus) elStatus.textContent =
        data.banner || (data.hasRecords ? "تم تسجيل حضور اليوم." : "لا يوجد تسجيل حضور اليوم حتى الآن.");

      if (bannerWrap && bannerText && data.banner) {
        bannerText.textContent = data.banner;
        bannerWrap.style.display = "block";
      } else if (bannerWrap) {
        bannerWrap.style.display = "none";
      }
    } catch (e) {
      console.error("today error:", e);
      if (elStatus) elStatus.textContent = "فشل تحميل تقرير اليوم.";
      if (bannerWrap) bannerWrap.style.display = "none";
    }
  }

  // ====== فتح مودال (ثابت بالمنتصف) ======
  function openModalById(modalId) {
    const modal = $(modalId);
    const overlay = $("modal-overlay");
    if (!modal || !overlay) return;

    overlay.classList.add("show");
    overlay.style.display = "flex";
    modal.classList.add("show");
    modal.style.display = "flex";

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const close = () => {
      modal.classList.remove("show");
      modal.style.display = "none";
      overlay.classList.remove("show");
      overlay.style.display = "none";
      document.body.style.overflow = prevOverflow || "";
    };

    modal.querySelectorAll("[data-close-modal]").forEach((b) =>
      b.addEventListener("click", close, { once: true })
    );
    overlay.addEventListener("click", close, { once: true });
  }

  // ====== Render داخل المودال ======
  function setSummary(childName, rangeText, noteText, sums) {
    const elChild = $("att7-child");
    const rangeEl = $("att7-range");
    const noteEl = $("att7-note");

    const chipP = $("att7-present");
    const chipA = $("att7-absent");
    const chipL = $("att7-late");
    const chipE = $("att7-excused");
    const chipPerm = $("att7-perm");

    if (elChild) elChild.textContent = childName || "—";
    if (rangeEl) rangeEl.textContent = rangeText || "—";
    if (noteEl) noteEl.textContent = noteText || "—";

    if (chipP) chipP.textContent = "حاضر (حصص): " + (sums.present ?? 0);
    if (chipA) chipA.textContent = "غائب (حصص): " + (sums.absent ?? 0);
    if (chipL) chipL.textContent = "متأخر (حصص): " + (sums.late ?? 0);
    if (chipE) chipE.textContent = "بعذر (حصص): " + (sums.excused ?? 0);
    if (chipPerm) chipPerm.textContent = "أذونات (أيام): " + (sums.perm_days ?? 0);
  }

  function renderTable(rows) {
    const tbody = $("att7-body");
    if (!tbody) return;

    tbody.innerHTML = rows
      .map((r) => {
        const isFuture = !!r.isFuture;
        const cell = (v) => (isFuture ? "—" : String(v ?? 0));
        const permCell = () => (isFuture ? "—" : permitLabel(r.permit));

        return `
          <tr>
            <td>${r.date}</td>
            <td>${dayNameFromISO(r.date)}</td>
            <td>${cell(r.present)}</td>
            <td>${cell(r.absent)}</td>
            <td>${cell(r.late)}</td>
            <td>${cell(r.excused)}</td>
            <td>${permCell()}</td>
            <td class="muted">—</td>
          </tr>
        `;
      })
      .join("");
  }

  function computeSums(rows) {
    return rows.reduce(
      (acc, r) => {
        if (r.isFuture) return acc;
        acc.present += (r.present ?? 0);
        acc.absent += (r.absent ?? 0);
        acc.late += (r.late ?? 0);
        acc.excused += (r.excused ?? 0);
        if (r.permit && r.permit.exists) acc.perm_days += 1;
        return acc;
      },
      { present: 0, absent: 0, late: 0, excused: 0, perm_days: 0 }
    );
  }

  // ====== تحميل أسبوع (week endpoint) ======
  async function loadWeek(endIso) {
    const studentId = getSelectedStudentId();
    const name = getSelectedStudentName();
    const { yearId, term } = getYearTerm();

    if (!studentId) return toast("اختر ابنًا أولًا.");

    const tbody = $("att7-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="8">جاري التحميل...</td></tr>`;

    const qs = new URLSearchParams({
      studentId: String(studentId),
      term: String(term),
      end: String(endIso),
    });
    if (yearId) qs.set("yearId", String(yearId));

    const data = await apiGet("/api/parent/attendance/week?" + qs.toString());
    const days = Array.isArray(data.days) ? data.days : [];

    const rows = days.map((d) => ({
      date: String(d.date || "").slice(0, 10),
      isFuture: !!d.isFuture,
      present: d.present,
      absent: d.absent,
      late: d.late,
      excused: d.excused,
      permit: d.permit || null,
    }));

    const sums = computeSums(rows);

    setSummary(
      name,
      `أسبوع المدرسة: ${data.startDate || schoolWeekStartISO(endIso)} → ${data.weekEndDate || addDaysISO(schoolWeekStartISO(endIso), 6)} (حتى ${data.endDate || endIso})`,
      "عرض أسبوع المدرسة",
      sums
    );

    renderTable(rows);
  }

  // ====== تحميل نطاق (range endpoint) ======
  async function loadRange(fromIso, toIso, noteLabel, overrideYearId, overrideTerm) {
    const studentId = getSelectedStudentId();
    const name = getSelectedStudentName();

    const yt = getYearTerm();
    const yearId = (overrideYearId !== undefined ? overrideYearId : yt.yearId);
    const term = (overrideTerm !== undefined ? overrideTerm : yt.term);

    if (!studentId) return toast("اختر ابنًا أولًا.");
    if (!fromIso || !toIso) return toast("حدد من/إلى.");

    const tbody = $("att7-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="8">جاري التحميل...</td></tr>`;

    const qs = new URLSearchParams({
      studentId: String(studentId),
      from: String(fromIso),
      to: String(toIso),
      term: String(term),
    });
    if (yearId) qs.set("yearId", String(yearId));

    const data = await apiGet("/api/parent/attendance/range?" + qs.toString());
    const days = Array.isArray(data.days) ? data.days : [];

    const rows = days.map((d) => ({
      date: String(d.date || "").slice(0, 10),
      isFuture: false,
      present: d.present ?? 0,
      absent: d.absent ?? 0,
      late: d.late ?? 0,
      excused: d.excused ?? 0,
      permit: d.permit || null,
    }));

    const sums = computeSums(rows);

    setSummary(
      name,
      `من ${data.from || fromIso} إلى ${data.to || toIso}`,
      noteLabel || "عرض نطاق",
      sums
    );

    renderTable(rows);
  }

  // ====== تبويبات (Week/Month/Advanced) + Controls ======
  function setTab(tab) {
    const tWeek = $("att-tab-week");
    const tMonth = $("att-tab-month");
    const tAdv = $("att-tab-advanced");

    const cWeek = $("att-week-controls");
    const cMonth = $("att-month-controls");
    const cAdv = $("att-adv-controls");

    if (tWeek) tWeek.classList.toggle("active", tab === "week");
    if (tMonth) tMonth.classList.toggle("active", tab === "month");
    if (tAdv) tAdv.classList.toggle("active", tab === "advanced");

    if (cWeek) cWeek.style.display = tab === "week" ? "block" : "none";
    if (cMonth) cMonth.style.display = tab === "month" ? "block" : "none";
    if (cAdv) cAdv.style.display = tab === "advanced" ? "block" : "none";
  }

  // ====== State للي تنقل بين السابق/الحالي ======
  let currentWeekEnd = todayISO();   // end المستخدم للـ week
  let currentMonthAny = todayISO();  // تاريخ داخل الشهر الحالي (نبدل عليه prev/next)

  function wireTabsAndControls() {
    // Tabs
    const tWeek = $("att-tab-week");
    const tMonth = $("att-tab-month");
    const tAdv = $("att-tab-advanced");

    if (tWeek) tWeek.addEventListener("click", async () => {
      setTab("week");
      currentWeekEnd = todayISO();
      await loadWeek(currentWeekEnd);
    });

    if (tMonth) tMonth.addEventListener("click", async () => {
      setTab("month");
      currentMonthAny = todayISO();
      const from = firstDayOfMonthISO(currentMonthAny);
      const to = lastDayOfMonthISO(currentMonthAny);
      await loadRange(from, to, "هذا الشهر", undefined, undefined);
    });

    if (tAdv) tAdv.addEventListener("click", () => {
      setTab("advanced");

      // افتراضات لطيفة للمدخلات
      const now = todayISO();
      const from = firstDayOfMonthISO(now);
      const to = now;

      const inFrom = $("att-from");
      const inTo = $("att-to");
      if (inFrom && !inFrom.value) inFrom.value = from;
      if (inTo && !inTo.value) inTo.value = to;

      // term/year من localStorage
      const yt = getYearTerm();
      const selTerm = $("att-term");
      const selYear = $("att-year");
      if (selTerm) selTerm.value = String(yt.term || 1);
      if (selYear && yt.yearId) selYear.value = String(yt.yearId);
    });

    // Week controls
    const btnWeekCur = $("att-week-current");
    const btnWeekPrev = $("att-week-prev");

    if (btnWeekCur) btnWeekCur.addEventListener("click", async () => {
      currentWeekEnd = todayISO();
      await loadWeek(currentWeekEnd);
    });

    if (btnWeekPrev) btnWeekPrev.addEventListener("click", async () => {
      // الأسبوع الماضي = End = (بداية أسبوع هذا الأسبوع - 1 يوم)
      const thisStart = schoolWeekStartISO(todayISO());
      const prevEnd = addDaysISO(thisStart, -1);
      currentWeekEnd = prevEnd;
      await loadWeek(currentWeekEnd);
    });

    // Month controls
    const btnMonthCur = $("att-month-current");
    const btnMonthPrev = $("att-month-prev");

    if (btnMonthCur) btnMonthCur.addEventListener("click", async () => {
      currentMonthAny = todayISO();
      const from = firstDayOfMonthISO(currentMonthAny);
      const to = lastDayOfMonthISO(currentMonthAny);
      await loadRange(from, to, "هذا الشهر");
    });

    if (btnMonthPrev) btnMonthPrev.addEventListener("click", async () => {
      currentMonthAny = prevMonthFromAnyISO(currentMonthAny);
      const from = firstDayOfMonthISO(currentMonthAny);
      const to = lastDayOfMonthISO(currentMonthAny);
      await loadRange(from, to, "الشهر الماضي");
    });

    // Advanced apply
    const btnApply = $("att-apply");
    if (btnApply) btnApply.addEventListener("click", async () => {
      const from = String(($("att-from") && $("att-from").value) || "");
      const to = String(($("att-to") && $("att-to").value) || "");

      const selYear = $("att-year");
      const selTerm = $("att-term");

      const y = selYear && selYear.value ? Number(selYear.value) : null;
      const t = selTerm && selTerm.value ? Number(selTerm.value) : 1;

      if (!from || !to) return toast("حدد من/إلى");
      if (from > to) return toast("من تاريخ لازم يكون قبل إلى تاريخ");

      await loadRange(from, to, "بحث متقدم", y, t);
    });
  }

  // ====== فتح المودال من زر/بطاقة ======
  async function openAttendanceModalDefault() {
    openModalById("modal-attendance-report");
    setTab("week");
    currentWeekEnd = todayISO();
    await loadWeek(currentWeekEnd);
  }

  // ====== Wire main ======
  function wire() {
    // زر/بطاقة فتح التقرير
    const btnOpen = $("btn-open-att-report");
    if (btnOpen) btnOpen.addEventListener("click", openAttendanceModalDefault);

    const card = $("card-attendance-report");
    if (card) card.addEventListener("click", openAttendanceModalDefault);

    // تغيير الطالب => حدث تقرير اليوم فقط
    const sel = $("selChild");
    if (sel) {
      sel.addEventListener("change", async () => {
        await loadToday();
      });
    }

    wireTabsAndControls();

    loadToday().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
