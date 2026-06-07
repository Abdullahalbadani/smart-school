// frontend/parent/js/parent.js
(function () {
  "use strict";

  /* ===================== CONFIG ===================== */
  const API_BASE = window.API_BASE || "/api";
  const THEME_KEY = "smart_theme";
  const ACTIVE_CHILD_KEY = "parent_active_child_id";
  const TAB_KEY = "parent_modal_tables_tab"; // weekly | exams

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ===================== Helpers: Auth + API ===================== */
  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiFetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const r = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });

    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!r.ok) throw new Error(data?.message || data?.error || text.slice(0, 200) || "API Error");
    return data;
  }

  const apiGet = (path) => apiFetch(path, { method: "GET" });
  const apiPost = (path, body) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* ===================== Toast ===================== */
  const toastEl = $("#toast");
  let toastTimer;
  function showToast(msg, type = "info") {
    if (!msg) return;
    if (window.AppUI?.toast) return window.AppUI.toast(msg, type);
    if (!toastEl) return console.warn(msg);
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ===================== Theme (Light/Dark) ===================== */
  const htmlEl = document.documentElement;
  const themeToggle = $("#theme-toggle");

  function applyTheme(t) {
    const theme = t === "dark" ? "dark" : "light";
    htmlEl.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const ic = themeToggle?.querySelector("i");
    if (ic) ic.className = theme === "dark" ? "ri-moon-clear-line" : "ri-sun-line";
  }

  applyTheme(localStorage.getItem(THEME_KEY) || htmlEl.getAttribute("data-theme") || "dark");

  themeToggle?.addEventListener("click", () => {
    const cur = htmlEl.getAttribute("data-theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  /* ===================== Clock ===================== */
  (function initClock() {
    const tEl = $("#clock-time");
    const dEl = $("#clock-date");
    if (!tEl || !dEl) return;

    function tick() {
      const now = new Date();
      tEl.textContent = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      dEl.textContent = now.toLocaleDateString("ar-EG", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    tick();
    setInterval(tick, 60000);
  })();

  /* ===================== Account dropdown ===================== */
  const accountToggle = $("#account-menu-toggle");
  const accountDropdown = $("#account-dropdown");

  function closeAccountDropdown() {
    if (accountDropdown) accountDropdown.style.display = "none";
  }

  accountToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!accountDropdown) return;
    const open = accountDropdown.style.display === "flex";
    accountDropdown.style.display = open ? "none" : "flex";
    accountDropdown.style.flexDirection = "column";
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".account-wrapper")) closeAccountDropdown();
  });

  /* ===================== Modals ===================== */
  const overlay = $("#modal-overlay");

  function anyModalOpen() {
    return $$(".modal").some((m) => m.dataset.open === "1");
  }

  function lockScroll(lock) {
    document.body.style.overflow = lock ? "hidden" : "";
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = "flex";
    modal.dataset.open = "1";
    if (overlay) overlay.style.display = "flex";
    closeAccountDropdown();
    lockScroll(true);
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = "none";
    delete modalEl.dataset.open;

    if (overlay && !anyModalOpen()) overlay.style.display = "none";
    if (!anyModalOpen()) lockScroll(false);
  }
async function openFeesModalForActiveChild() {
  const c = getActiveChild();
  const sid = c ? String(getChildId(c)) : localStorage.getItem(ACTIVE_CHILD_KEY);

  if (!sid) {
    showToast("لا يوجد ابن محدد.");
    return;
  }

  localStorage.setItem(ACTIVE_CHILD_KEY, sid);

  if (typeof window.openParentFeesModal === "function") {
    await window.openParentFeesModal(sid);
    return;
  }

  showToast("تعذر فتح نافذة الرسوم.");
}
  $$("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.closest(".modal")));
  });

  overlay?.addEventListener("click", () => {
    $$('.modal[data-open="1"]').forEach((m) => closeModal(m));
    if (overlay) overlay.style.display = "none";
    lockScroll(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay?.style.display === "flex") overlay.click();
  });

  /* ===================== Buttons that open modals ===================== */
  $("#open-profile-modal")?.addEventListener("click", () => openModal("profile-modal"));
  $("#open-change-password-modal")?.addEventListener("click", () => openModal("change-password-modal"));
  $("#open-change-email-modal")?.addEventListener("click", () => openModal("change-email-modal"));
  $("#open-link-child-modal")?.addEventListener("click", () => openModal("modal-link-child"));

  $("#btn-link-child")?.addEventListener("click", () => openModal("modal-link-child"));

  $("#btn-fees-quick")?.addEventListener("click", async () => {
  await openFeesModalForActiveChild();
});

  $("#btn-child-card")?.addEventListener("click", () => {
    openModal("modal-child-info");
    renderChildCard();
  });

  $("#notifications-btn")?.addEventListener("click", () => {
    openModal("modal-notifications");
  });

  $("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    // window.location.href = "../login/index.html";
  });

  /* ===================== Command Palette (Ctrl+K) ===================== */
  const cmdInput = $("#command-input");
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      cmdInput?.focus();
      cmdInput?.select?.();
    }
  });

cmdInput?.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
    e.preventDefault();
    const v = (cmdInput.value || "").trim();
    if (!v) return;

    const map = [
      { k: ["درجات", "نتائج"], id: "modal-grades" },
      { k: ["جدول", "الحصص", "امتحان", "الامتحانات"], id: "modal-timetable" },
{ k: ["رسوم", "دفع"], id: "modal-fees-parent" },      { k: ["إشعار", "إشعارات"], id: "modal-notifications" },
      { k: ["نشاط", "اختبار"], id: "modal-activities" },
      { k: ["ربط", "ابن"], id: "modal-link-child" },
      { k: ["بطاقة", "بيانات"], id: "modal-child-info" },
    ];

    const hit = map.find((x) => x.k.some((kk) => v.includes(kk)));
    if (!hit) return showToast("لم أتعرف على الأمر.");
if (hit.id === "modal-fees-parent") {
  await openFeesModalForActiveChild();
  return;
}
    openModal(hit.id);

    if (hit.id === "modal-timetable") {
      const saved = localStorage.getItem(TAB_KEY) || "weekly";
      setTablesTab(saved, true);
    }
    if (hit.id === "modal-child-info") renderChildCard();
    if (hit.id === "modal-fees") renderFeesForActiveChild();
    if (hit.id === "modal-notifications") loadNotifications();
  });

  /* ===================== Data (REAL from DB) ===================== */
  const selChild = $("#selChild");
  const heroGreeting = $("#hero-greeting");
  const heroSub = $("#hero-sub");
  const heroActiveChild = $("#hero-active-child");
  const heroChildrenPill = $("#hero-children-pill");
  const heroFeesPill = $("#hero-fees-pill");

  const parentNamePill = $("#parent-name-pill");
  const parentExtraPill = $("#parent-extra-pill");

  const profileName = $("#profile-name");
  const profileEmail = $("#profile-email");
  const profileChildrenCount = $("#profile-children-count");
  const currentEmailInput = $("#currentEmail");

  let parentProfile = null;
  let children = [];
  let activeChildId = null;

  function getChildId(c) {
    return c?.student_id ?? c?.studentId ?? c?.id ?? null;
  }

  function getChildDisplayName(c) {
    return c?.student_name ?? c?.name ?? c?.full_name ?? "—";
  }

  function getChildClassText(c) {
    const grade = c?.grade_name ?? c?.grade ?? c?.grade_id ?? "";
    const section = c?.section_name ?? c?.section ?? c?.section_id ?? "";
    const stage = c?.stage_name ?? c?.stage ?? "";
    const parts = [stage, grade].filter(Boolean).join(" / ");
    const sec = section ? ` (${section})` : "";
    return (parts || "—") + sec;
  }

  function getActiveChild() {
    if (!children.length) return null;
    const c = children.find((x) => String(getChildId(x)) === String(activeChildId));
    return c || children[0];
  }

  function fillChildrenSelect() {
    if (!selChild) return;

    selChild.innerHTML = "";
    if (!children.length) {
      selChild.insertAdjacentHTML("beforeend", `<option value="">لا يوجد أبناء مرتبطون</option>`);
      selChild.disabled = true;
      return;
    }

    selChild.disabled = false;
    children.forEach((c) => {
      const id = getChildId(c);
      const label = `${getChildDisplayName(c)} — ${getChildClassText(c)}`;
      selChild.insertAdjacentHTML("beforeend", `<option value="${id}">${escapeHtml(label)}</option>`);
    });

    const saved = localStorage.getItem(ACTIVE_CHILD_KEY);
    const exists = children.some((c) => String(getChildId(c)) === String(saved));
    activeChildId = exists ? saved : String(getChildId(children[0]));
    selChild.value = activeChildId;
  }

  function updateHeaderAndProfile() {
    const user = (() => {
      try {
        return JSON.parse(localStorage.getItem("user") || "null");
      } catch {
        return null;
      }
    })();

    const parentName = parentProfile?.name || parentProfile?.full_name || user?.name || "وليّ الأمر";
    const parentMail = parentProfile?.email || user?.email || "—";

    if (parentNamePill) parentNamePill.textContent = parentName;
    if (profileName) profileName.textContent = parentName;
    if (profileEmail) profileEmail.textContent = parentMail;
    if (currentEmailInput) currentEmailInput.value = parentMail;

    const count = children.length;
    if (profileChildrenCount) profileChildrenCount.textContent = String(count);

    if (heroGreeting) heroGreeting.textContent = `مرحبًا، ${parentName} 👋`;
    if (heroChildrenPill) heroChildrenPill.textContent = `عدد الأبناء المرتبطين: ${count}`;

    if (parentExtraPill) {
      parentExtraPill.textContent = count
        ? `لديك ${count} ${count === 1 ? "ابن" : "أبناء"} في النظام`
        : "لا يوجد أبناء مرتبطون بعد.";
    }

    const c = getActiveChild();
    if (!c) {
      if (heroActiveChild) heroActiveChild.textContent = "لا يوجد أبناء مرتبطون حتى الآن.";
      if (heroSub) heroSub.textContent = "اربط ابنًا من (ربط ابن جديد) للبدء.";
      if (heroFeesPill) heroFeesPill.textContent = "—";
      return;
    }

    const childLine = `${getChildDisplayName(c)} — ${getChildClassText(c)}`;
    if (heroActiveChild) heroActiveChild.textContent = childLine;
    if (heroSub) heroSub.textContent = `أنت الآن تتابع: ${childLine}`;

    if (heroFeesPill) heroFeesPill.textContent = "—";
  }

  /* ===================== Cards click (opens modals) ===================== */

  $("#cards-grid")?.addEventListener("click", async (e) => {
  const card = e.target.closest(".card[data-modal]");
  if (!card) return;

  const id = card.getAttribute("data-modal");
  if (!id) return;

  if (id === "modal-fees" || id === "modal-fees-parent") {
    await openFeesModalForActiveChild();
    return;
  }

  openModal(id);

  if (id === "modal-timetable") {
    const saved = localStorage.getItem(TAB_KEY) || "weekly";
    setTablesTab(saved, true);
  }
  if (id === "modal-child-info") renderChildCard();
  if (id === "modal-notifications") loadNotifications();
});

  /* ===================== Child Card ===================== */
  function renderChildCard() {
    const host = $("#ciContent");
    const c = getActiveChild();
    if (!host) return;

    if (!c) {
      host.innerHTML = `<div class="empty-state">لا يوجد ابن محدد. اربط ابنًا أولاً.</div>`;
      return;
    }

    const name = escapeHtml(getChildDisplayName(c));
    const cls = escapeHtml(getChildClassText(c));

    const code = escapeHtml(c?.student_code ?? c?.code ?? c?.studentCode ?? "—");
    const nat = escapeHtml(c?.national_id ?? c?.nid ?? c?.identity_no ?? "—");
    const dob = escapeHtml(c?.birth_date ?? c?.dob ?? "—");
    const phone = escapeHtml(c?.phone ?? "—");

    host.innerHTML = `
      <div class="chips">
        <span class="chip">الاسم: ${name}</span>
        <span class="chip">الصف/الشعبة: ${cls}</span>
        <span class="chip">كود الطالب: ${code}</span>
        <span class="chip">الهوية: ${nat}</span>
        <span class="chip">الميلاد: ${dob}</span>
        <span class="chip">الهاتف: ${phone}</span>
      </div>

      <div class="muted-box" style="margin-top:10px">
        هذه البيانات تأتي من قاعدة البيانات حسب الابن المختار.
      </div>
    `;
  }

  /* ===================== Timetable (Weekly) ===================== */
  const pttTerm = $("#ptt-term");
  const pttRefresh = $("#ptt-refresh");
  const pttEmpty = $("#ptt-empty");
  const pttHeadRow = $("#ptt-head-row");
  const pttBody = $("#ptt-body");

  const DAYS = [
    { id: 1, name: "السبت" },
    { id: 2, name: "الأحد" },
    { id: 3, name: "الاثنين" },
    { id: 4, name: "الثلاثاء" },
    { id: 5, name: "الأربعاء" },
    { id: 6, name: "الخميس" },
  ];

  function parseTime(t) {
    const s = String(t || "").slice(0, 5);
    return s || "";
  }

  function renderTimetable(periods, entries) {
    if (!pttBody || !pttHeadRow) return;

    const per = (periods || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    pttHeadRow.innerHTML =
      `<th>اليوم</th>` +
      per
        .map((p) => {
          const st = parseTime(p.start_time);
          const en = parseTime(p.end_time);
          const time = st && en ? `${st}-${en}` : "";
          const label = p.name || p.sort_order || p.id;
          return `<th>
            <div class="tt-period-head">
              <strong>الحصة ${escapeHtml(label)}</strong>
              <small>${escapeHtml(time)}</small>
            </div>
          </th>`;
        })
        .join("");

    const map = new Map();
    (entries || []).forEach((e) => {
      const d = e.day_of_week ?? e.day ?? e.day_id;
      const pid = e.period_id ?? e.periodId;
      if (d && pid) map.set(`${d}-${pid}`, e);
    });

    pttBody.innerHTML = DAYS.map((d) => {
      const tds = per
        .map((p) => {
          const e = map.get(`${d.id}-${p.id}`);
          if (!e) return `<td class="tt-cell"><div class="tt-empty">—</div></td>`;

          const subject = escapeHtml(e.subject_name ?? e.subject ?? "—");
          const teacher = escapeHtml(e.teacher_name ?? e.teacher ?? "—");
          const room = e.room ? ` • ${escapeHtml(e.room)}` : "";

          return `<td class="tt-cell">
            <div class="tt-lesson">
              <div class="tt-subject">${subject}</div>
              <div class="tt-teacher">${teacher}${room}</div>
            </div>
          </td>`;
        })
        .join("");

      return `<tr>
        <td class="tt-day"><strong>${escapeHtml(d.name)}</strong></td>
        ${tds}
      </tr>`;
    }).join("");
  }

  async function loadAndRenderTimetable(silent = false) {
    const c = getActiveChild();
    if (!c) {
      if (pttEmpty) {
        pttEmpty.style.display = "block";
        pttEmpty.textContent = "لا يوجد ابن محدد. اربط ابنًا أولاً.";
      }
      if (pttBody) pttBody.innerHTML = "";
      return;
    }

    const term = Number(pttTerm?.value || 1) || 1;
    const studentId = getChildId(c);

    try {
      if (pttEmpty) pttEmpty.style.display = "none";

      // meta periods
      let meta = null;
      try {
        meta = await apiGet("/parent/meta");
      } catch {
        try {
          meta = await apiGet("/student/meta");
        } catch {
          meta = { data: { periods: [] } };
        }
      }
      const periods = meta?.data?.periods || [];

      const res = await apiGet(
        `/parent/timetable?studentId=${encodeURIComponent(studentId)}&term=${encodeURIComponent(term)}`
      );

      const entries = res?.data?.entries || res?.data || [];

      if (!entries.length) {
        if (pttEmpty) {
          pttEmpty.style.display = "block";
          pttEmpty.textContent = "لا يوجد جدول منشور لهذا الابن (حسب الترم المحدد).";
        }
        renderTimetable(periods, []);
        return;
      }

      renderTimetable(periods, entries);
    } catch (e) {
      console.error(e);
      if (!silent) showToast(e.message || "فشل تحميل جدول الابن");
      if (pttEmpty) {
        pttEmpty.style.display = "block";
        pttEmpty.textContent = "تعذر تحميل الجدول. تحقق من API والمسار.";
      }
      if (pttBody) pttBody.innerHTML = "";
    }
  }

  pttRefresh?.addEventListener("click", () => loadAndRenderTimetable(false));
  pttTerm?.addEventListener("change", () => loadAndRenderTimetable(true));

  /* ===================== Exams (inside same modal) ===================== */
  // ✅ تصحيح IDs لتطابق HTML:
  const tabWeekly = $("#ptt-tab-weekly");
  const tabExams = $("#ptt-tab-exams");
  const viewWeekly = $("#ptt-view-weekly");
  const viewExams = $("#ptt-view-exams");

  const pexType = $("#pex-type");
  const pexMonthWrap = $("#pex-month-wrap");
  const pexMonth = $("#pex-month");
  const pexSubject = $("#pex-subject");
  const pexBtn = $("#pex-filter");
  const pexBody = $("#pex-body");
  const pexEmpty = $("#pex-empty");

  const MONTHS_AR = [
    { id: 1, name: "يناير" }, { id: 2, name: "فبراير" }, { id: 3, name: "مارس" },
    { id: 4, name: "أبريل" }, { id: 5, name: "مايو" }, { id: 6, name: "يونيو" },
    { id: 7, name: "يوليو" }, { id: 8, name: "أغسطس" }, { id: 9, name: "سبتمبر" },
    { id:10, name: "أكتوبر" }, { id:11, name: "نوفمبر" }, { id:12, name: "ديسمبر" },
  ];
  const AR_DAYS = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

  // =============================
  // ✅ Date/Time normalizers (حل مشكلة اليوم/التاريخ)
  // =============================
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

    // لو كان ISO datetime
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    s = s.replace(/\./g, "/").replace(/-/g, "/").replace(/\s+/g, "");

    // YYYY/MM/DD
    let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
    }

    // DD/MM/YYYY
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      return `${m[3]}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
    }

    return null;
  }

  function normalizeTimeHHMM(input) {
    let s = toLatinDigits(String(input || "")).replace(RTL_MARKS, "").trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }

  function timeToMinutes(t) {
    const n = normalizeTimeHHMM(t);
    if (!n) return null;
    const [h, m] = n.split(":").map(Number);
    return h * 60 + m;
  }

  // ✅ حفظ الفلاتر وعدم رجوعها إلى "كل الأشهر/كل المواد"
  function getExamFiltersUI() {
    return {
      type: String(pexType?.value || ""),
      month: String(pexMonth?.value || ""),
      subjectId: String(pexSubject?.value || ""),
    };
  }

  function restoreExamFiltersUI(keep) {
    if (!keep) return;

    if (pexType) {
      if (keep.type != null) pexType.value = keep.type;
    }

    // شهر يعتمد على النوع
    syncExamMonthUI(pexType?.value);

    if (pexMonth) {
      if (keep.month != null) {
        pexMonth.value = keep.month;
        // لو القيمة غير موجودة ضمن الخيارات بعد إعادة بناء القائمة
        if (String(pexMonth.value || "") !== String(keep.month || "")) pexMonth.value = "";
      }
    }

    if (pexSubject) {
      if (keep.subjectId != null) {
        pexSubject.value = keep.subjectId;
        if (String(pexSubject.value || "") !== String(keep.subjectId || "")) pexSubject.value = "";
      }
    }
  }

  // ✅ مهم: إزالة “الكل” من المنطق نهائيًا حتى لو كانت موجودة بالـ HTML
  function ensureExamTypeDefault() {
    if (!pexType) return "midyear";
    const v = String(pexType.value || "").trim();
    if (v) return v;

    // إذا كانت قيمة فارغة (مثل خيار "الكل") نجبرها على midyear
    pexType.value = "midyear";
    return "midyear";
  }

  // ✅ حساب اليوم باستخدام UTC لتجنب اختلاف المناطق
  function exDayName(isoDate) {
    const iso = normalizeDateISO(isoDate);
    if (!iso) return "—";
    try {
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return AR_DAYS[dt.getUTCDay()] || "—";
    } catch {
      return "—";
    }
  }

  function exTypeName(t, month) {
    if (t === "monthly") {
      const mName = MONTHS_AR.find((m) => String(m.id) === String(month))?.name;
      return `شهري${month ? " - " + (mName || month) : ""}`;
    }
    if (t === "midyear") return "نصف العام";
    if (t === "final") return "آخر العام";
    return t || "—";
  }

  function syncExamMonthUI(forceType) {
    const t = String(forceType || pexType?.value || "").trim() || ensureExamTypeDefault();
    if (pexMonthWrap) pexMonthWrap.style.display = t === "monthly" ? "" : "none";
    if (t !== "monthly" && pexMonth) pexMonth.value = "";
  }

  function ensureExamMeta(studentId) {
    // السيرفر غالباً لا يحتاج studentId هنا، لكن لا مشكلة بإرساله
    return apiGet(`/parent/exams/meta?studentId=${encodeURIComponent(studentId)}`);
  }

  async function loadExamMeta(studentId, keepFilters) {
    const keep = keepFilters || getExamFiltersUI();

    const r = await ensureExamMeta(studentId);
    const meta = r?.data || {};

    if (pexMonth) {
      const months = meta.months?.length ? meta.months : MONTHS_AR;
      pexMonth.innerHTML =
        `<option value="">كل الأشهر</option>` +
        months.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
    }

    if (pexSubject) {
      const subs = Array.isArray(meta.subjects) ? meta.subjects : [];
      pexSubject.innerHTML =
        `<option value="">كل المواد</option>` +
        subs.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    }

    // ✅ نرجّع الفلاتر كما هي بعد إعادة بناء القوائم
    restoreExamFiltersUI(keep);

    // ✅ ضمان UI الشهر حسب النوع
    ensureExamTypeDefault();
    syncExamMonthUI(pexType?.value);
  }

  function renderExams(rows, msg) {
    if (!pexBody) return;

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      if (pexEmpty) {
        pexEmpty.style.display = "block";
        pexEmpty.textContent = msg || "لا يوجد جدول امتحانات منشور لهذا الابن.";
      }
      pexBody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(msg || "لا يوجد بيانات")}</td></tr>`;
      return;
    }

    if (pexEmpty) pexEmpty.style.display = "none";

    pexBody.innerHTML = list
      .map((x) => {
        // ✅ التاريخ الصحيح: امتحان أولاً ثم أي بديل
        const dateISO =
          normalizeDateISO(x.exam_date || x.examDate || x.date || x.created_at) ||
          String(x.exam_date || x.date || "—").slice(0, 10);

        const day = exDayName(dateISO);
        const subject = escapeHtml(x.subject_name || "—");
        const type = exTypeName(x.exam_type, x.month);

        // ✅ تطبيع الوقت + إذا كان مقلوب نقلبه للعرض فقط
        let st = normalizeTimeHHMM(x.start_time || x.start || x.startTime) || String(x.start_time || "—").slice(0, 5);
        let en = normalizeTimeHHMM(x.end_time || x.end || x.endTime) || String(x.end_time || "—").slice(0, 5);

        const sm = timeToMinutes(st);
        const em = timeToMinutes(en);
        if (sm != null && em != null && sm > em) {
          const tmp = st;
          st = en;
          en = tmp;
        }

        const time = `${escapeHtml(st || "—")} - ${escapeHtml(en || "—")}`;

        const room = escapeHtml(x.room ?? "—");

        const baseNotes = (x.notes && String(x.notes).trim()) ? String(x.notes).trim() : "";
        const apply =
          x.apply_to_section_id != null
            ? ` (شعبة: ${escapeHtml(x.apply_to_section_name || x.apply_to_section_id)})`
            : "";
        const notes = escapeHtml((baseNotes || "—") + apply);

        return `
          <tr>
            <td>${escapeHtml(dateISO || "—")}</td>
            <td>${escapeHtml(day)}</td>
            <td>${subject}</td>
            <td>${escapeHtml(type)}</td>
            <td>${time}</td>
            <td>${room}</td>
            <td>${notes}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadAndRenderExams(silent = false) {
    const c = getActiveChild();
    if (!c) {
      renderExams([], "لا يوجد ابن محدد. اربط ابنًا أولاً.");
      return;
    }

    try {
      const studentId = getChildId(c);

      // ✅ أهم سطر: حفظ الفلاتر ثم تحميل meta ثم إرجاعها
      const keep = getExamFiltersUI();
      await loadExamMeta(studentId, keep);

      const qs = new URLSearchParams();
      qs.set("studentId", String(studentId));

      // ✅ هنا: examType دائمًا قيمة
      const examType = ensureExamTypeDefault();
      qs.set("examType", examType);

      const m = String(pexMonth?.value || "");
      const sId = String(pexSubject?.value || "");

      if (examType === "monthly" && m) qs.set("month", m);
      if (sId) qs.set("subjectId", sId);

      const r = await apiGet("/parent/exams?" + qs.toString());
      const rows = r?.data?.exams || [];
      renderExams(rows, "لا يوجد جدول امتحانات منشور لهذا الابن (حسب الفلاتر).");
    } catch (e) {
      console.error(e);
      if (!silent) showToast(e.message || "فشل تحميل الامتحانات");
      renderExams([], "تعذر تحميل الامتحانات. تحقق من API.");
    }
  }

  function setTablesTab(tab, silent = false) {
    const t = tab === "exams" ? "exams" : "weekly";
    localStorage.setItem(TAB_KEY, t);

    tabWeekly?.classList.toggle("active", t === "weekly");
    tabExams?.classList.toggle("active", t === "exams");

    if (viewWeekly) viewWeekly.style.display = t === "weekly" ? "" : "none";
    if (viewExams) viewExams.style.display = t === "exams" ? "" : "none";

    if (t === "weekly") {
      loadAndRenderTimetable(true);
    } else {
      // ✅ لا تصفّر الشهر/المادة عند فتح تبويب الامتحانات
      ensureExamTypeDefault();
      syncExamMonthUI(pexType?.value);
      loadAndRenderExams(true);
    }

    if (!silent) showToast(t === "weekly" ? "عرض الجدول الأسبوعي" : "عرض جداول الامتحانات");
  }

  tabWeekly?.addEventListener("click", () => setTablesTab("weekly", true));
  tabExams?.addEventListener("click", () => setTablesTab("exams", true));

  pexType?.addEventListener("change", () => {
    ensureExamTypeDefault();
    syncExamMonthUI(pexType?.value);
  });
  pexBtn?.addEventListener("click", () => loadAndRenderExams(false));

  /* ===================== Fees (optional API) ===================== */
  async function renderFeesForActiveChild() {
    const c = getActiveChild();
    const wrap = $("#feesSummary");
    if (!wrap) return;

    if (!c) {
      wrap.innerHTML = `<div class="empty-state">لا يوجد ابن محدد.</div>`;
      return;
    }

    try {
      const studentId = getChildId(c);
      const res = await apiGet(`/parent/fees?studentId=${encodeURIComponent(studentId)}`);
      const f = res?.data || {};
      const total = Number(f.total || 0);
      const discount = Number(f.discount || 0);
      const paid = Number(f.paid || 0);
      const due = Number(f.due || 0);

      wrap.innerHTML = `
        <span class="chip">الإجمالي: ${total.toLocaleString("ar-EG")} ريال</span>
        <span class="chip">الخصم: ${discount.toLocaleString("ar-EG")} ريال</span>
        <span class="chip">المدفوع: ${paid.toLocaleString("ar-EG")} ريال</span>
        <span class="chip">المتبقي: ${due.toLocaleString("ar-EG")} ريال</span>
      `;

      const payAmount = $("#payAmount");
      if (payAmount) payAmount.value = due > 0 ? String(due) : "";

      if (heroFeesPill) {
        heroFeesPill.textContent =
          due > 0
            ? `رسوم مستحقة على ${getChildDisplayName(c)}: ${due.toLocaleString("ar-EG")} ريال`
            : `لا توجد رسوم مستحقة على ${getChildDisplayName(c)}`;
      }
    } catch {
      wrap.innerHTML = `<div class="empty-state">لم يتم تجهيز API الرسوم بعد.</div>`;
    }
  }

  /* ===================== Notifications (optional API) ===================== */
  async function loadNotifications() {
    const host = $("#ntList");
    const dot = $("#notif-dot");
    const small = $("#notif-small");
    if (!host) return;

    try {
      const res = await apiGet("/parent/notifications");
      const list = res?.data || [];

      if (!list.length) {
        host.innerHTML = `<div class="empty-state">لا توجد إشعارات حاليًا.</div>`;
        if (dot) dot.hidden = true;
        if (small) small.textContent = "لا توجد إشعارات جديدة.";
        return;
      }

      host.innerHTML = list
        .map((n) => {
          const when = escapeHtml(n.when || n.created_at || "");
          const text = escapeHtml(n.text || n.message || "");
          return `
            <div class="card" style="cursor:auto">
              <div class="card-icon"><i class="ri-notification-badge-line"></i></div>
              <div>
                <h3>إشعار</h3>
                <p>${text}</p>
                <small>${when}</small>
              </div>
            </div>
          `;
        })
        .join("");

      if (dot) dot.hidden = false;
      if (small) small.textContent = `${list.length} إشعارات`;
    } catch {
      host.innerHTML = `<div class="empty-state">لم يتم تجهيز API الإشعارات بعد.</div>`;
      if (dot) dot.hidden = true;
      if (small) small.textContent = "—";
    }
  }

  /* ===================== Load parent + children from DB ===================== */
  async function loadParentAndChildren() {
    try {
      const res = await apiGet("/parent/me");

      parentProfile = res?.data?.parent || res?.data?.guardian || null;
      children = res?.data?.children || res?.data?.students || [];

      fillChildrenSelect();
      localStorage.setItem(ACTIVE_CHILD_KEY, selChild?.value || "");

      updateHeaderAndProfile();

      if (!children.length) {
        openModal("modal-link-child");
        showToast("قم بربط ابن للبدء.");
      }
    } catch (e) {
      console.error(e);
      showToast(e.message || "فشل تحميل بيانات ولي الأمر/الأبناء");

      parentProfile = null;
      children = [];
      fillChildrenSelect();
      updateHeaderAndProfile();
    }
  }

  selChild?.addEventListener("change", async () => {
  activeChildId = selChild.value;
  localStorage.setItem(ACTIVE_CHILD_KEY, String(activeChildId || ""));
  updateHeaderAndProfile();

  const open = $('.modal[data-open="1"]');

  if (open?.id === "modal-child-info") renderChildCard();

  if (open?.id === "modal-timetable") {
    const saved = localStorage.getItem(TAB_KEY) || "weekly";
    setTablesTab(saved, true);
  }

  const feesModal = document.getElementById("modal-fees-parent");
  const feesModalOpen =
    feesModal &&
    (
      feesModal.classList.contains("is-open") ||
      feesModal.getAttribute("aria-hidden") === "false" ||
      feesModal.style.display === "flex"
    );

  if (feesModalOpen && typeof window.reloadParentFeesData === "function") {
    await window.reloadParentFeesData(activeChildId);
  }
});

  /* ===================== Init ===================== */
  (async function init() {
    await loadParentAndChildren();
  })();
})();
