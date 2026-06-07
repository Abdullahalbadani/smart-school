// frontend/student/js/student-attendance.js
(function () {
  "use strict";

  if (window.__STUDENT_ATTENDANCE_LOADED__) return;
  window.__STUDENT_ATTENDANCE_LOADED__ = true;

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
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "—";
    const y = +m[1], mo = +m[2] - 1, da = +m[3];
    const js = new Date(y, mo, da).getDay();
    return AR_DAYS[js] || "—";
  }

  function dateFromISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
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

  // بداية أسبوع المدرسة = السبت
  function schoolWeekStartISO(endIso) {
    const d = dateFromISO(endIso);
    if (!d) return "";
    const jsDay = d.getDay(); // 0=Sun..6=Sat
    const backToSat = (jsDay - 6 + 7) % 7; // Sat->0, Sun->1, Mon->2...
    d.setDate(d.getDate() - backToSat);
    return isoFromDate(d);
  }

  function monthRangeISO(baseIso) {
    const d = dateFromISO(baseIso);
    if (!d) return null;
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: isoFromDate(from), to: isoFromDate(to) };
  }

  function normalizeUrl(url) {
    const u = String(url || "");
    if (!u) return u;
    if (u.startsWith("/")) return API_BASE + u;
    return u;
  }

  async function apiGet(url) {
    const finalUrl = normalizeUrl(url);

    // لو عندك apiFetch موحد في مشروعك
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

  // term/year من نفس LocalStorage المستخدمة عندك
  function getYearTerm() {
    const yearId =
      Number(localStorage.getItem("TT_YEAR_ID")) ||
      Number(localStorage.getItem("S_YEAR_ID")) ||
      0;

    const term =
      Number(localStorage.getItem("TT_TERM")) ||
      Number(localStorage.getItem("S_TERM")) ||
      1;

    return {
      yearId: Number.isFinite(yearId) && yearId > 0 ? yearId : null,
      term: term === 2 ? 2 : 1,
    };
  }

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

  /* =========================
     UI Helpers: Banner outside modal
  ========================= */

  function ensureTopBanner() {
    const hero = document.querySelector(".hero-strip");
    if (!hero) return null;

    let banner = $("student-att-banner");
    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = "student-att-banner";
    banner.style.marginTop = "0.6rem";
    banner.style.padding = "0.55rem 0.75rem";
    banner.style.borderRadius = "14px";
    banner.style.border = "1px solid rgba(148,163,184,0.25)";
    banner.style.background = "rgba(148,163,184,0.10)";
    banner.style.fontSize = "0.78rem";
    banner.style.display = "none";

    const left = hero.querySelector("div") || hero;
    left.appendChild(banner);
    return banner;
  }

  function showTopBanner(text, kind) {
    const banner = ensureTopBanner();
    if (!banner) return;

    banner.textContent = text || "";
    banner.style.display = text ? "block" : "none";

    if (kind === "danger") {
      banner.style.borderColor = "rgba(239,68,68,0.35)";
      banner.style.background = "rgba(239,68,68,0.10)";
    } else if (kind === "warn") {
      banner.style.borderColor = "rgba(245,158,11,0.35)";
      banner.style.background = "rgba(245,158,11,0.10)";
    } else if (kind === "ok") {
      banner.style.borderColor = "rgba(34,197,94,0.35)";
      banner.style.background = "rgba(34,197,94,0.10)";
    } else {
      banner.style.borderColor = "rgba(148,163,184,0.25)";
      banner.style.background = "rgba(148,163,184,0.10)";
    }
  }

  function updateAttendanceRatePill(rate) {
    const el = $("st-year-att-rate");
    if (!el) return;
    el.textContent = `${Number(rate || 0)}٪`;
  }

  /* =========================
     Load: Today message + Year stats
  ========================= */

  async function loadTodayMessage() {
    const { yearId, term } = getYearTerm();
    const iso = todayISO();

    try {
      const qs = new URLSearchParams({ date: iso, term: String(term) });
      if (yearId) qs.set("yearId", String(yearId));

      const data = await apiGet("/api/student/attendance/today?" + qs.toString());

      const msg = String(data.message || "");
      const c = data.counts || data;

      let kind = "info";
      if ((c.absent || 0) > 0) kind = "danger";
      else if ((c.late || 0) > 0) kind = "warn";
      else if ((c.present || 0) > 0 || (c.excused || 0) > 0) kind = "ok";

      showTopBanner(msg, kind);

      const dot = document.querySelector(".badge-dot");
      if (dot) {
        dot.toggleAttribute("hidden", !(kind === "danger" || kind === "warn"));
      }
    } catch (e) {
      console.error("student today ui error:", e);
      showTopBanner("تعذر تحميل رسالة الحضور لليوم.", "warn");
    }
  }

  async function loadYearStats() {
    const { yearId /*, term*/ } = getYearTerm();

    try {
      const qs = new URLSearchParams({});
      if (yearId) qs.set("yearId", String(yearId));
      // إذا تبيها “هذا الفصل” فقط:
      // qs.set("term", String(term));

      const data = await apiGet("/api/student/attendance/stats?" + qs.toString());
      updateAttendanceRatePill(data.attendanceRate || 0);
    } catch (e) {
      console.error("student stats ui error:", e);
      updateAttendanceRatePill(0);
    }
  }

  /* =========================
     Modal Attendance (HTML IDs: st-att-*)
  ========================= */

  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = String(text ?? "—");
  }

  function showEl(id, show) {
    const el = $(id);
    if (!el) return;
    el.style.display = show ? "" : "none";
  }

  function setPill(id, label, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = `${label}: ${value}`;
  }

  function setAlert(text, kind) {
    const box = $("st-att-alert");
    const txt = $("st-att-alert-text");
    if (!box || !txt) return;

    const t = String(text || "").trim();
    if (!t) {
      box.style.display = "none";
      txt.textContent = "—";
      return;
    }

    box.style.display = "";
    txt.textContent = t;

    // تلوين خفيف
    if (kind === "danger") {
      box.style.borderColor = "rgba(239,68,68,0.35)";
      box.style.background = "rgba(239,68,68,0.10)";
    } else if (kind === "warn") {
      box.style.borderColor = "rgba(245,158,11,0.35)";
      box.style.background = "rgba(245,158,11,0.10)";
    } else if (kind === "ok") {
      box.style.borderColor = "rgba(34,197,94,0.35)";
      box.style.background = "rgba(34,197,94,0.10)";
    } else {
      box.style.borderColor = "rgba(148,163,184,0.25)";
      box.style.background = "rgba(148,163,184,0.10)";
    }
  }

  // قراءة النطاق الحالي من UI (تبويب + أدوات)
  function getRangeSelection() {
    const active =
      $("st-att-tab-advanced")?.classList.contains("active") ? "advanced" :
      $("st-att-tab-month")?.classList.contains("active") ? "month" :
      "week";

    const end = todayISO();

    if (active === "month") {
      const mr = monthRangeISO(end);
      return { mode: "month", from: mr?.from || end, to: mr?.to || end, label: "هذا الشهر" };
    }

    if (active === "advanced") {
      const from = String($("st-att-from")?.value || "");
      const to = String($("st-att-to")?.value || "");
      const okFrom = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "";
      const okTo = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : "";

      // fallback لو المستخدم ما اختار
      if (!okFrom || !okTo) {
        const start = schoolWeekStartISO(end);
        const t = addDaysISO(start, 6);
        return { mode: "week", from: start, to: t, label: "هذا الأسبوع" };
      }

      return { mode: "range", from: okFrom, to: okTo, label: "بحث متقدم" };
    }

    // week
    const start = schoolWeekStartISO(end);
    const to = addDaysISO(start, 6);
    return { mode: "week", from: start, to, label: "هذا الأسبوع" };
  }

  function formatRangeLabel(label, from, to) {
    return `${label}: ${from} → ${to}`;
  }

  function setTotalsUI(totals, from, to, label) {
    setText("st-att-range", formatRangeLabel(label, from, to));
    setText("st-att-note", "الحضور محسوب بالحِصص، والأذونات على مستوى اليوم (يوم كامل).");

    setPill("st-att-present", "حاضر (حصص)", totals.present || 0);
    setPill("st-att-absent", "غائب (حصص)", totals.absent || 0);
    setPill("st-att-late", "متأخر (حصص)", totals.late || 0);
    setPill("st-att-excused", "بعذر (حصص)", totals.excused || 0);
    setPill("st-att-perm", "أذونات (أيام)", totals.permit_days || 0);

    // إنذار ذكي
    if ((totals.absent || 0) > 0) setAlert("تنبيه: لديك غياب ضمن هذا النطاق.", "danger");
    else if ((totals.late || 0) > 0) setAlert("ملاحظة: لديك تأخر ضمن هذا النطاق.", "warn");
    else if ((totals.present || 0) > 0 || (totals.excused || 0) > 0) setAlert("ممتاز: بيانات الحضور موجودة ضمن هذا النطاق.", "ok");
    else setAlert("", "info");
  }

  function renderTable(days) {
    const tbody = $("st-att-body");
    if (!tbody) return;

    if (!Array.isArray(days) || !days.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">لا توجد بيانات ضمن هذا النطاق.</td></tr>`;
      return;
    }

    tbody.innerHTML = days.map((d) => {
      const iso = String(d.date || "").slice(0, 10);
      const dayName = dayNameFromISO(iso);

      const present = d.present ?? 0;
      const absent = d.absent ?? 0;
      const late = d.late ?? 0;
      const excused = d.excused ?? 0;

      const permText = d.permit && d.permit.exists ? permitLabel(d.permit) : "لا يوجد";

      // ملاحظة: API ما يرجع note حالياً
      const note = "—";

      return `
        <tr>
          <td>${iso || "—"}</td>
          <td>${dayName}</td>
          <td>${present}</td>
          <td>${absent}</td>
          <td>${late}</td>
          <td>${excused}</td>
          <td>${permText}</td>
          <td>${note}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadAttendanceRange(from, to, labelOverride) {
    const tbody = $("st-att-body");
    if (!tbody) {
      toast("لم يتم العثور على tbody#st-att-body في الصفحة.");
      return;
    }

    const { yearId, term } = getYearTerm();

    // حالة التحميل
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">جاري تحميل السجل…</td></tr>`;

    try {
      const qs = new URLSearchParams({
        from: String(from || ""),
        to: String(to || ""),
        term: String(term),
      });
      if (yearId) qs.set("yearId", String(yearId));

      const data = await apiGet("/api/student/attendance/range?" + qs.toString());
      const days = Array.isArray(data.days) ? data.days : [];
      const totals = data.totals || { present: 0, absent: 0, late: 0, excused: 0, sessions_total: 0, permit_days: 0 };

      const label = labelOverride || "النطاق";
      setTotalsUI(totals, from, to, label);
      renderTable(days);
    } catch (e) {
      console.error("student attendance range error:", e);
      setAlert("تعذر تحميل كشف الحضور والغياب.", "warn");
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">فشل تحميل السجل.</td></tr>`;
    }
  }

  async function loadAttendanceModal() {
    // تأكد عناصر الملخص موجودة (لا نوقف التنفيذ لو ناقص بعضها)
    const tbody = $("st-att-body");
    if (!tbody) {
      toast("لم يتم العثور على tbody#st-att-body في المودال.");
      return;
    }

    // اسم الطفل (إذا عندك قيمة محفوظة، وإلا نخليها —)
    // تقدر تربطها لاحقاً من API profile
    setText("st-att-child", $("st-att-child")?.textContent || "—");

    const sel = getRangeSelection();
    await loadAttendanceRange(sel.from, sel.to, sel.label);
  }

  /* =========================
     Tabs + Controls wiring
  ========================= */

  function setActiveTab(which) {
    const tabs = [
      ["st-att-tab-week", "week"],
      ["st-att-tab-month", "month"],
      ["st-att-tab-advanced", "advanced"],
    ];

    tabs.forEach(([id, key]) => {
      const b = $(id);
      if (!b) return;
      b.classList.toggle("active", key === which);
    });

    showEl("st-att-week-controls", which === "week");
    showEl("st-att-month-controls", which === "month");
    showEl("st-att-adv-controls", which === "advanced");
  }

  function wireTabsAndControls() {
    // Tabs
    $("st-att-tab-week")?.addEventListener("click", () => {
      setActiveTab("week");
      loadAttendanceModal().catch(() => {});
    });

    $("st-att-tab-month")?.addEventListener("click", () => {
      setActiveTab("month");
      loadAttendanceModal().catch(() => {});
    });

    $("st-att-tab-advanced")?.addEventListener("click", () => {
      setActiveTab("advanced");
      // لا نحمل تلقائيًا بدون تاريخين، لكن لو تبي:
      // loadAttendanceModal().catch(()=>{});
    });

    // Week controls
    $("st-att-week-current")?.addEventListener("click", () => {
      setActiveTab("week");
      loadAttendanceModal().catch(() => {});
    });

    $("st-att-week-prev")?.addEventListener("click", () => {
      // الأسبوع الماضي = اطرح 7 أيام من اليوم
      const end = todayISO();
      const prevEnd = addDaysISO(end, -7);
      const from = schoolWeekStartISO(prevEnd);
      const to = addDaysISO(from, 6);
      loadAttendanceRange(from, to, "الأسبوع الماضي").catch(() => {});
    });

    // Month controls
    $("st-att-month-current")?.addEventListener("click", () => {
      setActiveTab("month");
      loadAttendanceModal().catch(() => {});
    });

    $("st-att-month-prev")?.addEventListener("click", () => {
      const end = todayISO();
      const d = dateFromISO(end);
      if (!d) return;

      // الشهر الماضي
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const from = isoFromDate(prev);
      const to = isoFromDate(new Date(prev.getFullYear(), prev.getMonth() + 1, 0));

      loadAttendanceRange(from, to, "الشهر الماضي").catch(() => {});
    });

    // Advanced apply
    $("st-att-apply")?.addEventListener("click", () => {
      setActiveTab("advanced");
      loadAttendanceModal().catch(() => {});
    });

    // term داخل المودال (اختياري: مجرد trigger)
    $("st-att-term")?.addEventListener("change", () => {
      // نحفظ اختيار الترم محليًا لو تحب:
      const t = Number($("st-att-term")?.value || 1);
      localStorage.setItem("S_TERM", String(t === 2 ? 2 : 1));
      // لو تريد إعادة تحميل مباشرة:
      // loadAttendanceModal().catch(() => {});
    });
  }

  /* =========================
     Wiring main
  ========================= */

  function wire() {
    // تأكد بداية التبويب
    setActiveTab("week");
    wireTabsAndControls();

    // عند فتح المودال (الكرت)
    const card = document.querySelector('.card[data-modal="modal-attendance"]');
    if (card) {
      card.addEventListener("click", () => {
        // انتظر قليلًا حتى يفتح المودال عبر student.js ثم عبّي الجدول
        setTimeout(() => loadAttendanceModal().catch(() => {}), 0);
      });
    }

    // تحميل أعلى الصفحة
    loadYearStats().catch(() => {});
    loadTodayMessage().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
