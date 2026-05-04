// teacher.js (نسخة موحّدة + Tabs داخل مودال الجدول: أسبوعي + اختبارات)
(function () {
  "use strict";

  // ====== أدوات مساعدة عامة ======
  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) {
      alert(message);
      return;
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ====== API ======
  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";
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

    if (!r.ok) {
      const err = new Error(
        data?.message || data?.error || text.slice(0, 200) || "API Error"
      );
      err.status = r.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  const apiGet = (path) => apiFetch(path, { method: "GET" });
  const apiPost = (path, body) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });

  // ====== الساعة الحية ======
  (function initClock() {
    const timeEl = $("clock-time");
    const dateEl = $("clock-date");
    if (!timeEl || !dateEl) return;

    function pad(n) {
      return n < 10 ? "0" + n : "" + n;
    }

    function tick() {
      const now = new Date();
      const h = pad(now.getHours());
      const m = pad(now.getMinutes());
      timeEl.textContent = h + ":" + m;

      const d = pad(now.getDate());
      const mo = pad(now.getMonth() + 1);
      const y = now.getFullYear();
      dateEl.textContent = d + "/" + mo + "/" + y;
    }

    tick();
    setInterval(tick, 1000);
  })();

  // ====== تبديل الثيم (نهاري / ليلي) ======
  (function initThemeToggle() {
    const root = document.documentElement;
    const btn = $("theme-toggle");
    const icon = $("theme-icon");
    if (!btn) return;

    const saved = localStorage.getItem("smart_theme");
    if (saved === "dark" || saved === "light") {
      root.setAttribute("data-theme", saved);
    }

    function updateIcon() {
      const current = root.getAttribute("data-theme") || "light";
      if (!icon) return;
      icon.className =
        current === "dark" ? "ri-moon-clear-line" : "ri-sun-line";
    }

    updateIcon();

    btn.addEventListener("click", () => {
      const current = root.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("smart_theme", next);
      updateIcon();
    });
  })();

  // ====== فتح / إغلاق المودالات + الخلفية المعتمة ======
  const overlayEl = $("modal-overlay");

  function anyModalOpen() {
    return Array.from(document.querySelectorAll(".modal")).some(
      (m) => m.dataset.open === "1"
    );
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = "none";
    delete modalEl.dataset.open;

    if (overlayEl && !anyModalOpen()) overlayEl.style.display = "none";
  }

  function openModal(id) {
    // ✅ عند فتح مودال الطلاب: حمّل شعب المعلم من DB (وسيعرض فقط ما يدرسه)
    if (id === "modal-students") {
      if (typeof window.__loadTeacherStudentScopes === "function") {
        window.__loadTeacherStudentScopes();
      }
    }

    // ✅ عند فتح مودال الحضور أو الحصص: حمّل نطاق المعلم (DB)
    if (id === "modal-attendance" || id === "modal-lessons") {
      if (typeof window.__loadTeacherTeachingScopes === "function") {
        window.__loadTeacherTeachingScopes();
      }
    }

    const modal = $(id);
    if (!modal) return;

    modal.style.display = "flex";
    modal.dataset.open = "1";
    if (overlayEl) overlayEl.style.display = "flex";

    // ✅ عند فتح مودال الجدول: افتح آخر تبويب محفوظ
    if (id === "modal-timetable") {
      const savedTab = localStorage.getItem("teacher_tt_tab") || "weekly";
      setTimetableTab(savedTab, true);
    }
  }

  // إغلاق عند الضغط على زر الإغلاق
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal");
      closeModal(modal);
    });
  });

  // إغلاق عند الضغط على الخلفية
  if (overlayEl) {
    overlayEl.addEventListener("click", () => {
      document
        .querySelectorAll('.modal[data-open="1"]')
        .forEach((m) => closeModal(m));
      overlayEl.style.display = "none";
    });
  }

  // إغلاق عند زر ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (overlayEl && overlayEl.style.display === "flex") overlayEl.click();
    }
  });

  // فتح المودال عند الضغط على الكرت
  document.querySelectorAll(".cards-grid .card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button, input, select, textarea, a")) return;
      const id = card.getAttribute("data-modal");
      if (id) openModal(id);
    });
  });

  // ====== قائمة الحساب (Dropdown) ======
  (function initAccountMenu() {
    const toggleBtn = $("account-menu-toggle");
    const dropdown = $("account-dropdown");
    const logoutBtn = $("logout-btn");
    if (!toggleBtn || !dropdown) return;

    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === "flex";
      dropdown.style.display = isVisible ? "none" : "flex";
    });

    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
        dropdown.style.display = "none";
      }
    });

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        showToast("تم تسجيل الخروج (تجريبي)");
      });
    }

    const openProfileBtn = $("open-profile-modal");
    if (openProfileBtn) {
      openProfileBtn.addEventListener("click", () => {
        openModal("profile-modal");
        dropdown.style.display = "none";
      });
    }

    const openChangePassBtn = $("open-change-password-modal");
    if (openChangePassBtn) {
      openChangePassBtn.addEventListener("click", () => {
        openModal("change-password-modal");
        dropdown.style.display = "none";
      });
    }

    const openChangeEmailBtn = $("open-change-email-modal");
    if (openChangeEmailBtn) {
      openChangeEmailBtn.addEventListener("click", () => {
        openModal("change-email-modal");
        dropdown.style.display = "none";
      });
    }

    const openChangeAvatarBtn = $("open-change-avatar-modal");
    if (openChangeAvatarBtn) {
      openChangeAvatarBtn.addEventListener("click", () => {
        openModal("change-avatar-modal");
        dropdown.style.display = "none";
      });
    }
  })();

  // ====== صورة المعلّم (Avatar) ======
  (function initAvatar() {
    const imgEl = $("teacher-avatar-img");
    const letterEl = $("teacher-avatar-letter");
    const inputEl = $("avatar-input");
    const changeBtn = $("change-avatar-btn");
    if (!imgEl || !letterEl || !inputEl || !changeBtn) return;

    const stored = localStorage.getItem("teacher_avatar");
    if (stored) {
      imgEl.src = stored;
      imgEl.style.display = "block";
      letterEl.style.display = "none";
    }

    changeBtn.addEventListener("click", () => inputEl.click());

    inputEl.addEventListener("change", () => {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        imgEl.src = ev.target.result;
        imgEl.style.display = "block";
        letterEl.style.display = "none";
        localStorage.setItem("teacher_avatar", ev.target.result);
        showToast("تم تحديث الصورة الشخصية (تجريبي)");
      };
      reader.readAsDataURL(file);
    });
  })();

  // ====== شريط الأوامر (⌘K) ======
  (function initCommandPalette() {
    const input = $("command-input");
    if (!input) return;

    const shortcuts = [
      { keyword: "حضور", modal: "modal-attendance" },
      { keyword: "غياب", modal: "modal-attendance" },
      { keyword: "درجات", modal: "modal-grades" },
      { keyword: "إشعار", modal: "modal-notifications" },
      { keyword: "إشعارات", modal: "modal-notifications" },
      { keyword: "اختبار", modal: "modal-timetable", tab: "exams" },
      { keyword: "جدول", modal: "modal-timetable", tab: "weekly" },
      { keyword: "طلاب", modal: "modal-students" },
      { keyword: "حصة", modal: "modal-lessons" },
      { keyword: "تقرير", modal: "modal-reports" },
      { keyword: "ملف", modal: "profile-modal" },
    ];

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;

      const cmd = shortcuts.find((c) => value.includes(c.keyword));
      if (!cmd) return showToast("لم أتعرف على هذا الأمر (تجريبي)");

      openModal(cmd.modal);
      if (cmd.modal === "modal-timetable" && cmd.tab) {
        setTimetableTab(cmd.tab, true);
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  })();

  // ============================================================
  // ✅ Tabs داخل مودال الجدول: أسبوعي + اختبارات
  // ============================================================
  const TT_TAB_KEY = "teacher_tt_tab";
  const ttTabWeekly = $("tt-tab-weekly");
  const ttTabExams = $("tt-tab-exams");
  const ttViewWeekly = $("tt-view-weekly");
  const ttViewExams = $("tt-view-exams");

  function setTimetableTab(tab, silent = false) {
    const t = tab === "exams" ? "exams" : "weekly";
    localStorage.setItem(TT_TAB_KEY, t);

    if (ttTabWeekly) ttTabWeekly.style.opacity = t === "weekly" ? "1" : ".75";
    if (ttTabExams) ttTabExams.style.opacity = t === "exams" ? "1" : ".75";

    if (ttViewWeekly) ttViewWeekly.style.display = t === "weekly" ? "" : "none";
    if (ttViewExams) ttViewExams.style.display = t === "exams" ? "" : "none";

    if (t === "weekly") {
      ensureTimetableMeta()
        .then(() => loadTeacherTimetable())
        .catch(console.error);
    } else {
      ensureExamMeta()
        .then(() => loadTeacherExams())
        .catch(console.error);
    }

    if (!silent)
      showToast(t === "weekly" ? "عرض الجدول الأسبوعي" : "عرض جدول الاختبارات");
  }

  ttTabWeekly?.addEventListener("click", () => setTimetableTab("weekly", true));
  ttTabExams?.addEventListener("click", () => setTimetableTab("exams", true));

  // ============================================================
  // ✅ الجدول الأسبوعي من DB (مع سنة/ترم من داخل نفس المودال)
  // ============================================================
  const TT_LS_YEAR = "TT_YEAR_ID";
  const TT_LS_TERM = "TT_TERM";

  const ttYearSel = $("tt-year");
  const ttTermSel = $("tt-term");
  const ttLoadBtn = $("tt-load-real");

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
    for (const k of keys)
      if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fallback;
  }

  function getDayId(e) {
    return Number(pick(e, ["day_of_week", "dayId", "day"], 0));
  }
  function getPeriodId(e) {
    return Number(pick(e, ["period_id", "periodId"], 0));
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

  let ttMeta = null;

  async function ensureTimetableMeta() {
    if (ttMeta) return ttMeta;

    const res = await apiGet("/teacher/timetables/meta");
    ttMeta = res?.data || res || {};
    const years = ttMeta?.years || ttMeta?.data?.years || ttMeta?.years || [];

    // عبّي السنوات (مرة واحدة)
    if (ttYearSel) {
      ttYearSel.innerHTML = "";
      if (!years.length) {
        ttYearSel.innerHTML = `<option value="1">سنة افتراضية</option>`;
      } else {
        years.forEach((y) => {
          const id = y.id ?? y.value ?? y.year_id ?? y.academic_year_id;
          const name = y.name ?? y.label ?? y.year_name ?? `سنة ${id}`;
          ttYearSel.insertAdjacentHTML(
            "beforeend",
            `<option value="${id}">${escapeHtml(name)}</option>`
          );
        });
      }

      const saved = Number(localStorage.getItem(TT_LS_YEAR) || "");
      const can = Array.from(ttYearSel.options).some(
        (o) => String(o.value) === String(saved)
      );
      ttYearSel.value = can
        ? String(saved)
        : ttYearSel.options[0]?.value || "1";
    }

    if (ttTermSel) {
      const savedTerm = localStorage.getItem(TT_LS_TERM) || "1";
      ttTermSel.value = savedTerm === "2" ? "2" : "1";
    }

    return ttMeta;
  }

  async function loadTeacherTimetable() {
    const tbody = $("tt-table-body");
    if (!tbody) return;

    const table = tbody.closest("table");
    const thead = table
      ? table.querySelector("thead") ||
        table.insertBefore(document.createElement("thead"), table.firstChild)
      : null;

    await ensureTimetableMeta();

    const yearId = Number(
      ttYearSel?.value || localStorage.getItem(TT_LS_YEAR) || 1
    );
    const term = Number(
      ttTermSel?.value || localStorage.getItem(TT_LS_TERM) || 1
    );

    try {
      // days + periods
      const daysRaw = ttMeta?.days || ttMeta?.data?.days || [];
      const periodsRaw = ttMeta?.periods || ttMeta?.data?.periods || [];

      const days = (daysRaw || []).filter((d) =>
        [1, 2, 3, 4, 5, 6].includes(Number(d.id))
      );
      const periods = (periodsRaw || [])
        .slice()
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

      // schedule
      const sch = await apiGet(
        `/teacher/timetables?academicYearId=${encodeURIComponent(
          yearId
        )}&term=${encodeURIComponent(term)}`
      );
      const entries = sch?.data?.entries || sch?.entries || [];

      // map(day-period) => entry
      const map = new Map();
      for (const e of entries) map.set(`${getDayId(e)}-${getPeriodId(e)}`, e);

      // render header (periods)
      if (thead) {
        const ths = periods
          .map((p) => {
            const st = String(p.start_time || "").slice(0, 5);
            const en = String(p.end_time || "").slice(0, 5);
            const time =
              st && en ? `<div class="tt-time">${st} - ${en}</div>` : "";
            return `<th class="tt-period-th">
              <div class="tt-period-title">الحصة ${escapeHtml(
                p.name || p.sort_order || p.id
              )}</div>
              ${time}
            </th>`;
          })
          .join("");

        thead.innerHTML = `<tr><th class="tt-day-th">اليوم</th>${ths}</tr>`;
      }

      // body: row لكل يوم
      tbody.innerHTML = days
        .map((d) => {
          const tds = periods
            .map((p) => {
              const e = map.get(`${Number(d.id)}-${Number(p.id)}`);
              if (!e)
                return `<td class="tt-cell"><div class="tt-empty">—</div></td>`;

              const cls = `${getGrade(e)} / ${getSection(e)}`.trim();
              const room = getRoom(e);

              return `<td class="tt-cell">
                <div class="tt-lesson">
                  <div class="tt-lesson__sub">${escapeHtml(getSubject(e))}</div>
                  <div class="tt-lesson__meta">
                    ${cls ? `<span>${escapeHtml(cls)}</span>` : ``}
                    ${
                      room
                        ? `<span>•</span><span>قاعة: ${escapeHtml(room)}</span>`
                        : ``
                    }
                  </div>
                </div>
              </td>`;
            })
            .join("");

          return `<tr>
            <th class="tt-day-row">${escapeHtml(
              dayNameById[Number(d.id)] || d.name || d.id
            )}</th>
            ${tds}
          </tr>`;
        })
        .join("");

      // Next info
      const infoBox = $("tt-next-info");
      const nextSmall = $("next-class-small");

      const sorted = entries
        .slice()
        .sort(
          (a, b) =>
            getDayId(a) - getDayId(b) || getPeriodId(a) - getPeriodId(b)
        );
      if (sorted[0]) {
        const n = sorted[0];
        const dayName = dayNameById[getDayId(n)] || "";
        const cls = `${getGrade(n)} / ${getSection(n)}`.trim();
        const txt = `${dayName} — الحصة ${getPeriodId(n)} — ${getSubject(
          n
        )} (${cls})`;
        if (infoBox) infoBox.textContent = "✅ أقرب حصة: " + txt;
        if (nextSmall) nextSmall.textContent = txt;
      } else {
        if (infoBox) infoBox.textContent = "لا توجد حصص منشورة لهذا الترم/السنة.";
        if (nextSmall) nextSmall.textContent = "لا توجد حصص.";
      }
    } catch (err) {
      console.log("TT ERROR:", err);
      const infoBox = $("tt-next-info");
      if (infoBox)
        infoBox.textContent = "فشل تحميل الجدول: " + (err.message || "");
      tbody.innerHTML = `<tr><td class="empty-state">تعذر تحميل الجدول</td></tr>`;
    }
  }

  // زر تحميل الجدول
  ttLoadBtn?.addEventListener("click", () => {
    const y = ttYearSel?.value || "1";
    const t = ttTermSel?.value || "1";
    localStorage.setItem(TT_LS_YEAR, String(y));
    localStorage.setItem(TT_LS_TERM, String(t));
    loadTeacherTimetable();
  });

  ttYearSel?.addEventListener("change", () => {
    localStorage.setItem(TT_LS_YEAR, String(ttYearSel.value || "1"));
  });
  ttTermSel?.addEventListener("change", () => {
    localStorage.setItem(TT_LS_TERM, String(ttTermSel.value || "1"));
  });

  // ============================================================
  // ✅ تبويب الاختبارات داخل نفس مودال الجدول
  // ============================================================
  const exTypeSel = $("tt-ex-type");
  const exMonthWrap = $("tt-ex-month-wrap");
  const exMonthSel = $("tt-ex-month");
  const exSubjectSel = $("tt-ex-subject");
  const exLoadBtn = $("tt-ex-load");
  const exBody = $("tt-ex-body");
  const exEmpty = $("tt-ex-empty");

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
  const AR_DAYS = [
    "الأحد",
    "الاثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];

  function exTypeName(t, month) {
    if (t === "monthly") {
      const mName = MONTHS_AR.find((m) => String(m.id) === String(month))?.name;
      return `شهري${month ? " - " + (mName || month) : ""}`;
    }
    if (t === "midyear") return "نصف العام";
    if (t === "final") return "آخر العام";
    return t || "—";
  }

  // ✅ مهم جدًا: نحسب اليوم بطريقة ثابتة (UTC)
  function dayNameFromISO(iso) {
    const dStr = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return "—";
    const d = new Date(dStr + "T00:00:00Z"); // UTC
    return AR_DAYS[d.getUTCDay()] || "—";
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
        const months =
          Array.isArray(meta.months) && meta.months.length
            ? meta.months
            : MONTHS_AR;
        exMonthSel.innerHTML =
          `<option value="">كل الأشهر</option>` +
          months
            .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
            .join("");
        exMonthSel.value = prevMonth;
      }

      if (exSubjectSel) {
        const subs = Array.isArray(meta.subjects) ? meta.subjects : [];
        exSubjectSel.innerHTML =
          `<option value="">كل المواد</option>` +
          subs
            .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
            .join("");
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
        const subject = escapeHtml(
          x.subject_name || x.subjectName || x.subject || "—"
        );
        const type = exTypeName(x.exam_type || x.examType, x.month);

        const st = String(x.start_time || x.start || "—").slice(0, 5);
        const en = String(x.end_time || x.end || "—").slice(0, 5);
        const time = `${escapeHtml(st)} - ${escapeHtml(en)}`;

        const grade = escapeHtml(x.grade_name || x.grade || x.gradeName || "");
        const section = escapeHtml(
          x.section_name || x.section || x.sectionName || ""
        );
        const cls =
          grade || section
            ? `${grade}${section ? " / " + section : ""}`
            : "—";

        const room = escapeHtml(x.room ?? "—");
        const notes = escapeHtml(
          x.notes && String(x.notes).trim() ? String(x.notes).trim() : "—"
        );

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

    const yearId = Number(
      ttYearSel?.value || localStorage.getItem(TT_LS_YEAR) || 1
    );
    const term = Number(
      ttTermSel?.value || localStorage.getItem(TT_LS_TERM) || 1
    );

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
      showToast(
        "API اختبارات المعلم غير جاهز أو المسار غير صحيح: /api/teacher/timetables/exams"
      );
    }
  }

  exTypeSel?.addEventListener("change", () => {
    syncExamMonthUI();
  });

  exLoadBtn?.addEventListener("click", () => loadTeacherExams());

  // ============================================================
  // ====== تكوين النطاق (مرحلة / صف / شعبة / مادة)
  // (لباقي المودالات مثل الحضور/الدرجات/الحصص)
  // ============================================================
  const scopeConfig = {
    gradesByStage: {
      ابتدائية: ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"],
      إعدادية: ["الأول", "الثاني", "الثالث"],
      ثانوية: ["الأول", "الثاني", "الثالث"],
    },
    sections: ["أ", "ب", "ج"],
    subjectsByGrade: {
      الأول: ["قرآن", "رياضيات", "علوم", "لغة عربية"],
      الثاني: ["رياضيات", "علوم", "لغة عربية"],
      الثالث: ["رياضيات", "علوم", "لغة عربية"],
      الرابع: ["رياضيات", "علوم", "لغة عربية"],
      الخامس: ["رياضيات", "علوم", "لغة عربية"],
      السادس: ["رياضيات", "علوم", "لغة عربية"],
    },
  };

  function getScopeElements(prefix) {
    return {
      stageEl: $(prefix + "-stage"),
      gradeEl: $(prefix + "-grade"),
      sectionEl: $(prefix + "-section"),
      subjectEl: $(prefix + "-subject"),
    };
  }

  function initScopeSelectorsFor(prefix) {
    const { stageEl, gradeEl, sectionEl, subjectEl } = getScopeElements(prefix);
    if (!stageEl || !gradeEl || !sectionEl || !subjectEl) return;

    stageEl.addEventListener("change", () => {
      const stage = stageEl.value;
      gradeEl.innerHTML = '<option value="">اختر الصف</option>';
      sectionEl.innerHTML = '<option value="">اختر الشعبة</option>';
      subjectEl.innerHTML = '<option value="">اختر المادة</option>';
      gradeEl.disabled = true;
      sectionEl.disabled = true;
      subjectEl.disabled = true;

      const grades = scopeConfig.gradesByStage[stage] || [];
      grades.forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = g;
        gradeEl.appendChild(opt);
      });
      gradeEl.disabled = grades.length === 0;
    });

    gradeEl.addEventListener("change", () => {
      const grade = gradeEl.value;

      sectionEl.innerHTML = '<option value="">اختر الشعبة</option>';
      scopeConfig.sections.forEach((sec) => {
        const opt = document.createElement("option");
        opt.value = sec;
        opt.textContent = sec;
        sectionEl.appendChild(opt);
      });
      sectionEl.disabled = false;

      subjectEl.innerHTML = '<option value="">اختر المادة</option>';
      const subs = scopeConfig.subjectsByGrade[grade] || ["مادتي"];
      subs.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        subjectEl.appendChild(opt);
      });
      subjectEl.disabled = false;
    });
  }

  function getScope(prefix) {
    const { stageEl, gradeEl, sectionEl, subjectEl } = getScopeElements(prefix);
    return {
      stage: stageEl ? stageEl.value : "",
      grade: gradeEl ? gradeEl.value : "",
      section: sectionEl ? sectionEl.value : "",
      subject: subjectEl ? subjectEl.value : "",
    };
  }

  function ensureScopeSelected(prefix) {
    const scope = getScope(prefix);
    if (!scope.stage || !scope.grade || !scope.section || !scope.subject) {
      showToast("اختر المرحلة والصف والشعبة والمادة أولاً من نفس المودال.");
      return null;
    }
    return scope;
  }

  // بيانات طلاب تجريبية
  const demoStudentsBase = [
    { id: 1, name: "أحمد نبيل", parentPhone: "777000001" },
    { id: 2, name: "سارة علي", parentPhone: "777000002" },
    { id: 3, name: "محمد ياسر", parentPhone: "777000003" },
    { id: 4, name: "ليان يوسف", parentPhone: "777000004" },
    { id: 5, name: "خالد سمير", parentPhone: "777000005" },
  ];

  function getStudentsForScope(scope) {
    const classLabel = (scope.grade || "?") + " / " + (scope.section || "?");
    return demoStudentsBase.map((s, index) => ({
      ...s,
      code: "ST-" + String(index + 1).padStart(3, "0"),
      classLabel,
    }));
  }

  // ====== سجل الغيابات ======
  let attendanceHistory = [];

  (function loadAttendanceHistory() {
    const raw = localStorage.getItem("teacher_attendance_log");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) attendanceHistory = parsed;
    } catch {
      attendanceHistory = [];
    }
  })();

  function persistAttendanceHistory() {
    try {
      localStorage.setItem(
        "teacher_attendance_log",
        JSON.stringify(attendanceHistory)
      );
    } catch (e) {
      console.warn("تعذر حفظ سجل الغياب في localStorage", e);
    }
  }

  // ============================================================
  // ✅ نطاق المعلم + الحضور والغياب (DB Sessions) — بدون بيانات تجريبية
  // ============================================================
  function getYearTermForTeacher() {
    const yearId = Number(localStorage.getItem(TT_LS_YEAR) || 1);
    const term = Number(localStorage.getItem(TT_LS_TERM) || 1);
    return { yearId, term };
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  // ✅ ميتا الحصص (Periods) لتعبئة (att-lesson / ls-lesson) تلقائياً
  let __PERIODS_META = null;
  let __PERIODS_LOADED = false;

  async function ensurePeriodsMeta() {
    if (__PERIODS_LOADED)
      return Array.isArray(__PERIODS_META) ? __PERIODS_META : [];
    __PERIODS_LOADED = true;
    try {
      const r = await apiGet("/teacher/timetables/meta");
      const meta = r?.data || r || {};
      const periods = meta?.periods || meta?.data?.periods || [];
      __PERIODS_META = Array.isArray(periods) ? periods : [];
    } catch {
      __PERIODS_META = [];
    }
    return Array.isArray(__PERIODS_META) ? __PERIODS_META : [];
  }

  async function ensureLessonSelectOptions(selectEl, placeholder = "اختر الحصة") {
    if (!selectEl) return;

    // ✅ إذا كانت الخيارات مُعبأة من الميتا سابقاً (نميزها بوجود data-lesson) لا نعيد بناءها
    const hasMetaOptions = Array.from(selectEl.options || []).some(
      (o) => o && o.dataset && typeof o.dataset.lesson !== "undefined"
    );
    if (hasMetaOptions) return;

    const periods = (await ensurePeriodsMeta()).slice().sort((a, b) => {
      const aa = Number(a.sort_order || a.order || a.lesson || a.id || 0);
      const bb = Number(b.sort_order || b.order || b.lesson || b.id || 0);
      return aa - bb;
    });

    // إذا لا توجد periods من DB، اترك الخيارات الافتراضية كما هي
    if (!periods.length) return;

    // ✅ هنا نستبدل خيارات HTML الافتراضية (1..5) بخيارات DB الحقيقية
    selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;

    periods.forEach((p) => {
      const id = p.id ?? p.period_id ?? p.value;
      const lessonNo = Number(p.sort_order || p.order || p.lesson || id || 0);
      const name = p.name || `الحصة ${lessonNo || id}`;
      const st = String(p.start_time || "").slice(0, 5);
      const en = String(p.end_time || "").slice(0, 5);
      const time = st && en ? ` (${st}-${en})` : "";

      const opt = document.createElement("option");
      opt.value = String(id); // ✅ periodId الحقيقي
      opt.textContent = String(name) + time; // ✅ اسم + وقت
      opt.dataset.lesson = String(lessonNo || id); // ✅ رقم الحصة للـ API إذا احتجته
      selectEl.appendChild(opt);
    });
  }

  async function filterLessonsByTeacherDay(selectEl, scope) {
    if (!selectEl) return;

    const dateVal = ($("att-date")?.value || "").slice(0, 10);
    if (!dateVal) return;

    // لو النطاق غير مكتمل، لا نفلتر
    if (!scope?.sectionId || !scope?.subjectId) {
      // خليه يرجع للـ meta العامة (periods) فقط
      await ensureLessonSelectOptions(selectEl, "اختر الحصة");
      return;
    }

    // تحويل تاريخ -> day_id (Saturday=1 .. Friday=7)
    const jsDay = new Date(dateVal + "T00:00:00").getDay(); // 0=Sun..6=Sat
    const mapToSchoolDay = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
    const dayId = mapToSchoolDay[jsDay];
    if (!dayId) return;

    const { yearId, term } = getYearTermForTeacher();

    // periods meta للترتيب + أسماء الحصص
    const periodsMeta = (await ensurePeriodsMeta()).slice();
    const periodById = new Map(periodsMeta.map((p) => [String(p.id), p]));

    // helper لاستخراج periodId من entry
    const pickPeriodId = (e) =>
      Number(e?.period_id ?? e?.periodId ?? e?.period ?? 0);

    try {
      const r = await apiGet(
        `/teacher/timetables?academicYearId=${encodeURIComponent(
          yearId
        )}&term=${encodeURIComponent(
          term
        )}&day=${encodeURIComponent(dayId)}&sectionId=${encodeURIComponent(
          scope.sectionId
        )}&subjectId=${encodeURIComponent(scope.subjectId)}`
      );

      const entries = r?.data?.entries || r?.entries || [];
      if (!entries.length) {
        selectEl.innerHTML = `<option value="">لا توجد حصص لك هذا اليوم</option>`;
        return;
      }

      // unique periods
      const uniq = new Map();
      for (const e of entries) {
        const pid = pickPeriodId(e);
        if (!pid) continue;
        if (!uniq.has(pid)) uniq.set(pid, { periodId: pid });
      }

      const lessons = Array.from(uniq.values()).sort((a, b) => {
        const pa = periodById.get(String(a.periodId));
        const pb = periodById.get(String(b.periodId));
        const oa = Number(
          pa?.sort_order ?? pa?.order ?? pa?.lesson ?? pa?.id ?? a.periodId
        );
        const ob = Number(
          pb?.sort_order ?? pb?.order ?? pb?.lesson ?? pb?.id ?? b.periodId
        );
        return oa - ob;
      });

      selectEl.innerHTML =
        `<option value="">اختر الحصة</option>` +
        lessons
          .map((l) => {
            const p = periodById.get(String(l.periodId));
            const lessonNo = Number(
              p?.sort_order ?? p?.order ?? p?.lesson ?? p?.id ?? l.periodId
            );
            const name = p?.name || `الحصة ${lessonNo}`;
            const st = String(p?.start_time || "").slice(0, 5);
            const en = String(p?.end_time || "").slice(0, 5);
            const time = st && en ? ` (${st}-${en})` : "";
            return `<option value="${l.periodId}" data-lesson="${lessonNo}">${escapeHtml(
              name + time
            )}</option>`;
          })
          .join("");
    } catch (e) {
      console.warn("lesson filtering failed:", e);
      // fallback: اعرض periods العامة بدل ما تظل فاضية
      await ensureLessonSelectOptions(selectEl, "اختر الحصة");
    }
  }

  const __TEACHING_CACHE = { key: "", rows: [], loaded: false };

  // ✅ إصلاح: لا تجعل الميتا "جاهزة" قبل الجلب
  let __ATT_META = null;
  let __ATT_META_LOADED = false;

  async function ensureAttendanceMeta() {
    if (__ATT_META_LOADED) return __ATT_META || { reasons: [] };
    __ATT_META_LOADED = true;
    try {
      const r = await apiGet("/teacher/attendance/meta");
      const data = r?.data || r || {};
      __ATT_META = { reasons: Array.isArray(data.reasons) ? data.reasons : [] };
    } catch (e) {
      __ATT_META = { reasons: [] };
    }
    return __ATT_META || { reasons: [] };
  }

  async function loadTeachingScopes() {
    const { yearId, term } = getYearTermForTeacher();
    const key = `${yearId}-${term}`;
    if (__TEACHING_CACHE.loaded && __TEACHING_CACHE.key === key)
      return __TEACHING_CACHE.rows;

    // ✅ أولاً: scopes الخاص بالحضور (الأقوى)
    try {
      const r = await apiGet(
        `/teacher/attendance/scopes?academicYearId=${encodeURIComponent(
          yearId
        )}&term=${encodeURIComponent(term)}`
      );
      const rows = r?.data?.scopes || r?.scopes || r?.data || [];
      __TEACHING_CACHE.key = key;
      __TEACHING_CACHE.rows = Array.isArray(rows) ? rows : [];
      __TEACHING_CACHE.loaded = true;
      return __TEACHING_CACHE.rows;
    } catch (e) {
      // ✅ fallback: إن كان عندك endpoint القديم
      try {
        const r2 = await apiGet(
          `/teacher/timetables/students/scopes?academicYearId=${encodeURIComponent(
            yearId
          )}&term=${encodeURIComponent(term)}`
        );
        const rows2 = r2?.data?.scopes || r2?.scopes || r2?.data || [];
        __TEACHING_CACHE.key = key;
        __TEACHING_CACHE.rows = Array.isArray(rows2) ? rows2 : [];
        __TEACHING_CACHE.loaded = true;
        return __TEACHING_CACHE.rows;
      } catch {
        __TEACHING_CACHE.key = key;
        __TEACHING_CACHE.rows = [];
        __TEACHING_CACHE.loaded = true;
        return [];
      }
    }
  }

  function uniqBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr || []) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, x);
    }
    return Array.from(m.values());
  }

  function setOptions(sel, items, placeholder, valueKey, labelKey) {
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    (items || []).forEach((x) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(x[valueKey])}">${escapeHtml(
          x[labelKey]
        )}</option>`
      );
    });
    sel.disabled = !(items && items.length);
  }

  function hasOption(sel, v) {
    if (!sel) return false;
    return Array.from(sel.options).some((o) => String(o.value) === String(v));
  }

  function saveScope(prefix, obj) {
    try {
      localStorage.setItem(`teacher_scope_${prefix}`, JSON.stringify(obj || {}));
    } catch {}
  }
  function readScope(prefix) {
    try {
      return (
        JSON.parse(localStorage.getItem(`teacher_scope_${prefix}`) || "{}") || {}
      );
    } catch {
      return {};
    }
  }

  function initTeachingPicker(prefix) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);

    if (!stageSel || !gradeSel || !sectionSel || !subjectSel) return;

    // ✅ يسمح بإعادة التعبئة عند تغيير السنة/الترم أو فتح المودال مرة أخرى
    if (stageSel.dataset.inited === "1") {
      if (typeof stageSel.__applyFromCache === "function")
        stageSel.__applyFromCache();
      return;
    }
    stageSel.dataset.inited = "1";

    const applyFromCache = async () => {
      const scopes = await loadTeachingScopes();

      // stages
      const stages = uniqBy(scopes, (x) => String(x.stage_id)).map((x) => ({
        id: x.stage_id,
        name: x.stage_name || `Stage ${x.stage_id}`,
      }));
      setOptions(stageSel, stages, "اختر المرحلة", "id", "name");

      gradeSel.innerHTML = `<option value="">اختر الصف</option>`;
      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      gradeSel.disabled = true;
      sectionSel.disabled = true;
      subjectSel.disabled = true;

      if (!stages.length) return;

      const saved = readScope(prefix);

      // stage select
      if (saved.stageId && hasOption(stageSel, saved.stageId)) {
        stageSel.value = String(saved.stageId);
      } else {
        stageSel.value = String(stages[0].id);
      }
      stageSel.dispatchEvent(new Event("change"));
    };

    // اربطها للنداء لاحقاً في حال فتح المودال مرة أخرى
    stageSel.__applyFromCache = applyFromCache;

    stageSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;

      const grades = uniqBy(
        scopes.filter((x) => String(x.stage_id) === String(stageId)),
        (x) => String(x.grade_id)
      ).map((x) => ({
        id: x.grade_id,
        name: x.grade_name || `Grade ${x.grade_id}`,
      }));
      setOptions(gradeSel, grades, "اختر الصف", "id", "name");

      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      sectionSel.disabled = true;
      subjectSel.disabled = true;

      const saved = readScope(prefix);
      if (saved.gradeId && hasOption(gradeSel, saved.gradeId)) {
        gradeSel.value = String(saved.gradeId);
      } else if (grades.length) {
        gradeSel.value = String(grades[0].id);
      } else {
        gradeSel.value = "";
      }

      saveScope(prefix, {
        stageId: stageSel.value,
        gradeId: gradeSel.value,
        sectionId: "",
        subjectId: "",
      });
      gradeSel.dispatchEvent(new Event("change"));
    });

    gradeSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;
      const gradeId = gradeSel.value;

      const sections = uniqBy(
        scopes.filter(
          (x) =>
            String(x.stage_id) === String(stageId) &&
            String(x.grade_id) === String(gradeId)
        ),
        (x) => String(x.section_id)
      ).map((x) => ({
        id: x.section_id,
        name: x.section_name || `Section ${x.section_id}`,
      }));
      setOptions(sectionSel, sections, "اختر الشعبة", "id", "name");

      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      subjectSel.disabled = true;

      const saved = readScope(prefix);
      if (saved.sectionId && hasOption(sectionSel, saved.sectionId)) {
        sectionSel.value = String(saved.sectionId);
      } else if (sections.length) {
        sectionSel.value = String(sections[0].id);
      } else {
        sectionSel.value = "";
      }

      saveScope(prefix, {
        stageId,
        gradeId,
        sectionId: sectionSel.value,
        subjectId: "",
      });
      sectionSel.dispatchEvent(new Event("change"));
    });

    sectionSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;
      const gradeId = gradeSel.value;
      const sectionId = sectionSel.value;

      const subjects = uniqBy(
        scopes.filter(
          (x) =>
            String(x.stage_id) === String(stageId) &&
            String(x.grade_id) === String(gradeId) &&
            String(x.section_id) === String(sectionId)
        ),
        (x) => String(x.subject_id)
      ).map((x) => ({
        id: x.subject_id,
        name: x.subject_name || `Subject ${x.subject_id}`,
      }));
      setOptions(subjectSel, subjects, "اختر المادة", "id", "name");

      const saved = readScope(prefix);
      if (saved.subjectId && hasOption(subjectSel, saved.subjectId)) {
        subjectSel.value = String(saved.subjectId);
      } else if (subjects.length) {
        subjectSel.value = String(subjects[0].id);
      } else {
        subjectSel.value = "";
      }

      saveScope(prefix, {
        stageId,
        gradeId,
        sectionId,
        subjectId: subjectSel.value,
      });
    });

    subjectSel.addEventListener("change", () => {
      saveScope(prefix, {
        stageId: stageSel.value,
        gradeId: gradeSel.value,
        sectionId: sectionSel.value,
        subjectId: subjectSel.value,
      });
    });

    applyFromCache();
  }

  function getTeachingScope(prefix) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);
    return {
      stageId: Number(stageSel?.value || 0),
      gradeId: Number(gradeSel?.value || 0),
      sectionId: Number(sectionSel?.value || 0),
      subjectId: Number(subjectSel?.value || 0),

      stageName: stageSel?.selectedOptions?.[0]?.textContent || "",
      gradeName: gradeSel?.selectedOptions?.[0]?.textContent || "",
      sectionName: sectionSel?.selectedOptions?.[0]?.textContent || "",
      subjectName: subjectSel?.selectedOptions?.[0]?.textContent || "",
    };
  }

  function hookAttendanceLessonFiltering() {
    const dateInput = $("att-date");
    const sectionSel = $("att-section");
    const subjectSel = $("att-subject");
    const lessonSel = $("att-lesson");

    const run = async () => {
      await filterLessonsByTeacherDay(lessonSel, getTeachingScope("att"));
    };

    dateInput?.addEventListener("change", run);
    sectionSel?.addEventListener("change", run);
    subjectSel?.addEventListener("change", run);
  }

  function setTeachingScope(prefix, scope) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);
    if (!stageSel || !gradeSel || !sectionSel || !subjectSel) return;

    if (scope.stageId && hasOption(stageSel, scope.stageId))
      stageSel.value = String(scope.stageId);
    stageSel.dispatchEvent(new Event("change"));

    // بعد change سيتم إعادة بناء القوائم، نؤخر خطوة واحدة:
    setTimeout(() => {
      if (scope.gradeId && hasOption(gradeSel, scope.gradeId))
        gradeSel.value = String(scope.gradeId);
      gradeSel.dispatchEvent(new Event("change"));

      setTimeout(() => {
        if (scope.sectionId && hasOption(sectionSel, scope.sectionId))
          sectionSel.value = String(scope.sectionId);
        sectionSel.dispatchEvent(new Event("change"));

        setTimeout(() => {
          if (scope.subjectId && hasOption(subjectSel, scope.subjectId))
            subjectSel.value = String(scope.subjectId);
          subjectSel.dispatchEvent(new Event("change"));
        }, 0);
      }, 0);
    }, 0);
  }

  // ===============================
  // ✅ Attendance Context (Active lesson/session -> lock Attendance UI)
  // ===============================
  const ATT_CTX_KEY = "teacher_att_active_ctx";
  let __ATT_CTX = null;

  function saveAttCtx(ctx) {
    __ATT_CTX = ctx || null;
    try {
      if (ctx) localStorage.setItem(ATT_CTX_KEY, JSON.stringify(ctx));
      else localStorage.removeItem(ATT_CTX_KEY);
    } catch {}
  }

  function loadAttCtx() {
    if (__ATT_CTX) return __ATT_CTX;
    try {
      const raw = localStorage.getItem(ATT_CTX_KEY);
      if (!raw) return null;
      __ATT_CTX = JSON.parse(raw) || null;
      return __ATT_CTX;
    } catch {
      return null;
    }
  }

  function lockAttendancePickers(lock) {
    const d = $("att-date");
    const lesson = $("att-lesson");

    const st = $("att-stage");
    const gr = $("att-grade");
    const sec = $("att-section");
    const sub = $("att-subject");

    // ✅ التاريخ والسيلكت مقفول
    if (d) {
      d.disabled = !!lock;
      d.readOnly = !!lock;
      d.style.pointerEvents = lock ? "none" : "";
    }
    if (lesson) {
      lesson.disabled = !!lock;
      lesson.style.pointerEvents = lock ? "none" : "";
    }

    // ✅ نطاق الغيابات مقفول أيضاً لما نكون داخل جلسة
    [st, gr, sec, sub].forEach((el) => {
      if (!el) return;
      el.disabled = !!lock;
      el.style.pointerEvents = lock ? "none" : "";
      el.style.opacity = lock ? ".9" : "";
    });
  }

  // يطبق ctx على واجهة الغياب (ويعمل lock)
  async function applyAttCtxToUI(ctx) {
    if (!ctx) {
      lockAttendancePickers(false);
      return;
    }

    // 1) نطاق
    if (ctx.scope) {
      initTeachingPicker("att");
      setTeachingScope("att", ctx.scope);
    }

    // 2) تاريخ
    const d = $("att-date");
    if (d && ctx.date) d.value = String(ctx.date).slice(0, 10);

    // 3) الحصة
    const lesson = $("att-lesson");
    if (lesson) {
      await ensureLessonSelectOptions(lesson, "اختر الحصة");
      if (ctx.periodId) lesson.value = String(ctx.periodId);
    }

    lockAttendancePickers(true);
  }

  // ✅ دالة عامة تُستدعى عند فتح مودالات الحضور/الحصص
  window.__loadTeacherTeachingScopes = async () => {
    initTeachingPicker("att");
    initTeachingPicker("ls");
    ensureAttendanceMeta().catch(() => {});

    // ✅ تعبئة قائمة الحصص تلقائياً إن كانت فارغة
    ensureLessonSelectOptions($("att-lesson"), "اختر الحصة").catch(() => {});
    ensureLessonSelectOptions($("ls-lesson"), "اختر الحصة").catch(() => {});

    hookAttendanceLessonFiltering();

    setTimeout(() => {
      filterLessonsByTeacherDay($("att-lesson"), getTeachingScope("att"));
    }, 0);

    // ✅ لو فيه Session نشطة محفوظة، طبّقها واقفل
    const savedCtx = loadAttCtx();
    if (savedCtx) {
      applyAttCtxToUI(savedCtx).catch(() => {});
    } else {
      lockAttendancePickers(false);
    }
  };

  // ===============================
  // ✅ Attendance (Session-based DB)
  // ===============================
  (function initAttendanceDB() {
    const loadBtn = $("att-load");
    const tbody = $("att-table-body");

    const allPresentBtn = $("att-all-present");
    const allAbsentBtn = $("att-all-absent");
    const saveBtn = $("att-save");
    const saveSoftBtn = $("att-save-soft"); // إن وجد زر حفظ بدون اعتماد

    const dateInput = $("att-date");
    const lessonSelect = $("att-lesson");
    const scopeSummaryEl = $("att-scope-summary");

    const onlyIssuesChk = $("att-only-issues");
    const searchInput = $("att-search");
    const countsEl = $("att-counts");

    // Tabs
    const tabTake = $("att-tab-take");
    const tabHist = $("att-tab-history");
    const viewTake = $("att-view-take");
    const viewHist = $("att-view-history");

    const historySearchInput = $("att-history-search");
    const historyShowBtn = $("att-history-show");
    const historyBody = $("att-history-body");
    const historyEmpty = $("att-history-empty");

    if (!tbody) return;

    // ✅ تهيئة نطاقات DB
    initTeachingPicker("att");
    ensureAttendanceMeta().catch(() => {});
    ensureLessonSelectOptions(lessonSelect, "اختر الحصة").catch(() => {});

    // افتراضي التاريخ = اليوم + ✅ اقفاله
    if (dateInput && !dateInput.value) dateInput.value = todayISO();
    if (dateInput) {
      dateInput.disabled = true;
      dateInput.readOnly = true;
      dateInput.style.pointerEvents = "none";
    }

    // ✅ لو في جلسة نشطة محفوظة، طبّقها واقفل السيلكت
    const savedCtx = loadAttCtx();
    if (savedCtx) {
      applyAttCtxToUI(savedCtx).catch(() => {});
    } else {
      lockAttendancePickers(false);
    }

    // (اختياري) إذا أردت تركه — لن يعمل إذا التاريخ مقفول
    dateInput?.addEventListener("change", async () => {
      const scope = getTeachingScope("att");
      await filterLessonsByTeacherDay($("att-lesson"), scope);
    });

    const STATUS = ["present", "absent", "late", "excused"];
    const STATUS_LABEL = {
      present: "حاضر",
      absent: "غائب",
      late: "متأخر",
      excused: "بعذر",
    };

    function setAttendanceTab(tab) {
      const t = tab === "history" ? "history" : "take";
      tabTake?.classList.toggle("is-active", t === "take");
      tabHist?.classList.toggle("is-active", t === "history");
      if (viewTake) viewTake.style.display = t === "take" ? "" : "none";
      if (viewHist) viewHist.style.display = t === "history" ? "" : "none";
    }
    tabTake?.addEventListener("click", () => setAttendanceTab("take"));
    tabHist?.addEventListener("click", () => setAttendanceTab("history"));

    let ACTIVE_SESSION_ID = null;
    let ACTIVE_LOCKED = false;

    function updateCounts() {
      if (!countsEl) return;
      const rows = tbody.querySelectorAll("tr.att-row");
      const total = rows.length;
      let present = 0,
        absent = 0,
        late = 0,
        excused = 0;

      rows.forEach((row) => {
        const st =
          row.querySelector(".att-status-btn.is-active")?.dataset?.status ||
          "present";
        if (st === "present") present++;
        else if (st === "absent") absent++;
        else if (st === "late") late++;
        else if (st === "excused") excused++;
      });

      countsEl.textContent = `الإجمالي: ${total} — حاضر: ${present} — غائب: ${absent} — متأخر: ${late} — بعذر: ${excused}`;
    }

    function applyFilters() {
      const q = (searchInput?.value || "").trim().toLowerCase();
      const onlyIssues = !!onlyIssuesChk?.checked;

      tbody.querySelectorAll("tr.att-row").forEach((row) => {
        const name = String(row.dataset.studentName || "").toLowerCase();
        const code = String(row.dataset.studentCode || "").toLowerCase();
        const st =
          row.querySelector(".att-status-btn.is-active")?.dataset?.status ||
          "present";

        const matchText = !q || name.includes(q) || code.includes(q);
        const matchIssues = !onlyIssues || st !== "present";
        row.style.display = matchText && matchIssues ? "" : "none";
      });
    }

    function reasonOptionsHTML(selectedId) {
      const list = __ATT_META?.reasons || [];
      const opts =
        `<option value="">بدون سبب</option>` +
        list
          .map((r) => {
            const id = r.id ?? r.value;
            const name = r.name ?? r.label ?? `سبب ${id}`;
            const sel = String(id) === String(selectedId) ? "selected" : "";
            return `<option value="${escapeHtml(id)}" ${sel}>${escapeHtml(
              name
            )}</option>`;
          })
          .join("");
      return opts;
    }

    function rowTemplate(s) {
      const status = s.status || "present";
      const note = s.note || "";
      const reasonId = s.reasonId ?? null;
      const lateMinutes = s.lateMinutes ?? "";

      return `
      <tr class="att-row"
          data-student-id="${s.id}"
          data-student-name="${escapeHtml(s.name)}"
          data-student-code="${escapeHtml(s.code || "")}">
        <td>
          <div class="att-student">
            <div class="att-student__name"><i class="ri-user-line"></i> ${escapeHtml(
              s.name
            )}</div>
            <div class="att-student__meta">
              ${
                s.code
                  ? `<span class="att-chip">${escapeHtml(s.code)}</span>`
                  : ``
              }
            </div>
          </div>
        </td>

        <td>
          <div class="att-status" role="group" aria-label="حالة الحضور">
            ${STATUS.map(
              (k) => `
              <button type="button" class="att-status-btn ${
                k === status ? "is-active" : ""
              }"
                data-status="${k}">
                ${escapeHtml(STATUS_LABEL[k])}
              </button>
            `
            ).join("")}
          </div>
        </td>

        <td>
          <div class="att-details">
            <select class="att-reason" ${
              status === "absent" || status === "excused"
                ? ""
                : 'style="display:none"'
            }>
              ${reasonOptionsHTML(reasonId)}
            </select>

            <input class="att-late-min" type="number" min="1" placeholder="دقائق التأخر"
              value="${escapeHtml(lateMinutes)}"
              ${status === "late" ? "" : 'style="display:none"'} />
          </div>
        </td>

        <td>
          <input class="att-note" type="text" placeholder="ملاحظة..." value="${escapeHtml(
            note
          )}" />
        </td>
      </tr>
    `;
    }

    function setRowStatus(row, status) {
      row.querySelectorAll(".att-status-btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.status === status);
        b.disabled = ACTIVE_LOCKED;
      });

      const reasonSel = row.querySelector(".att-reason");
      const lateInp = row.querySelector(".att-late-min");
      const noteInp = row.querySelector(".att-note");

      if (reasonSel) {
        const show = status === "absent" || status === "excused";
        reasonSel.style.display = show ? "" : "none";
        reasonSel.disabled = ACTIVE_LOCKED;
        if (!show) reasonSel.value = "";
      }

      if (lateInp) {
        const show = status === "late";
        lateInp.style.display = show ? "" : "none";
        lateInp.disabled = ACTIVE_LOCKED;
        if (!show) lateInp.value = "";
      }

      if (noteInp) noteInp.disabled = ACTIVE_LOCKED;
    }

    function setLockedUI(locked) {
      ACTIVE_LOCKED = !!locked;

      // أزرار عامة
      allPresentBtn && (allPresentBtn.disabled = ACTIVE_LOCKED);
      allAbsentBtn && (allAbsentBtn.disabled = ACTIVE_LOCKED);
      saveBtn && (saveBtn.disabled = ACTIVE_LOCKED);
      saveSoftBtn && (saveSoftBtn.disabled = ACTIVE_LOCKED);
      loadBtn && (loadBtn.disabled = false); // تحميل مسموح

      // جدول
      tbody.querySelectorAll("tr.att-row").forEach((row) => {
        const st =
          row.querySelector(".att-status-btn.is-active")?.dataset?.status ||
          "present";
        setRowStatus(row, st);
      });
    }

    async function startOrGetSession({ startNow }) {
      const { yearId, term } = getYearTermForTeacher();
      const scope = getTeachingScope("att");

      const dateVal = (dateInput?.value || "").slice(0, 10) || todayISO();

      await ensureLessonSelectOptions(lessonSelect, "اختر الحصة");
      const periodId = Number(lessonSelect?.value || 0);
      const lessonNo = Number(
        lessonSelect?.selectedOptions?.[0]?.dataset?.lesson || periodId
      );

      if (
        !scope.stageId ||
        !scope.gradeId ||
        !scope.sectionId ||
        !scope.subjectId
      ) {
        showToast("اختر المرحلة والصف والشعبة والمادة أولاً.");
        return null;
      }
      if (!periodId) {
        showToast("اختر رقم الحصة أولاً.");
        return null;
      }

      const r = await apiPost("/teacher/sessions/start", {
        academicYearId: yearId,
        term,
        date: dateVal,
        periodId,
        lesson: lessonNo,
        sectionId: scope.sectionId,
        subjectId: scope.subjectId,
        lessonNote: null,
        source: "manual",
        startNow: startNow !== false,
      });

      return r?.data || r;
    }

    async function loadSession(sessionId) {
      const r = await apiGet(
        `/teacher/sessions/${encodeURIComponent(sessionId)}/students`
      );
      const data = r?.data || r || {};
      const sess = data.session || {};
      const list = Array.isArray(data.students) ? data.students : [];

      ACTIVE_SESSION_ID = Number(sess.id || sessionId);
      setLockedUI(!!sess.is_locked);

      // ✅ ثبّت (التاريخ + الحصة + النطاق) بناءً على بيانات الجلسة
      try {
        const sessDate = String(sess.attendance_date || "").slice(0, 10);
        const sessPeriodId = Number(sess.period_id || 0);
        const sessLessonNo = Number(sess.lesson || sessPeriodId || 0);

        // حاول نستنتج scope كامل من teaching scopes (stage/grade/section/subject)
        let scope = null;
        try {
          const scopes = await loadTeachingScopes();
          const hit = (scopes || []).find(
            (x) =>
              String(x.section_id) === String(sess.section_id) &&
              String(x.subject_id) === String(sess.subject_id)
          );
          if (hit) {
            scope = {
              stageId: Number(hit.stage_id || 0),
              gradeId: Number(hit.grade_id || 0),
              sectionId: Number(hit.section_id || 0),
              subjectId: Number(hit.subject_id || 0),
            };
          }
        } catch {}

        const ctx = {
          sessionId: Number(sess.id || sessionId),
          date: sessDate || todayISO(),
          periodId: sessPeriodId,
          lessonNo: sessLessonNo,
          scope: scope || getTeachingScope("att"),
        };

        saveAttCtx(ctx);
        await applyAttCtxToUI(ctx);
      } catch (e) {
        console.warn("apply session ctx failed:", e);
      }

      if (scopeSummaryEl) {
        const scopeNow = getTeachingScope("att");
        const d = String(sess.attendance_date || dateInput?.value || "").slice(
          0,
          10
        );
        const p =
          sess.lesson ||
          sess.period_id ||
          Number(lessonSelect?.selectedOptions?.[0]?.dataset?.lesson || 0) ||
          (lessonSelect?.value || "");
        scopeSummaryEl.textContent =
          `حضور: ${scopeNow.stageName} — ${scopeNow.gradeName} / ${scopeNow.sectionName} — ${scopeNow.subjectName} — ${d} — الحصة ${p}` +
          (sess.is_locked ? " — (معتمد)" : "");
      }

      tbody.innerHTML = list
        .map((s) =>
          rowTemplate({
            id: s.id,
            code: s.code,
            name: s.name,
            status: s.status,
            note: s.note,
            reasonId: s.reasonId,
            lateMinutes: s.lateMinutes,
          })
        )
        .join("");

      // ضبط الواجهات
      tbody.querySelectorAll("tr.att-row").forEach((row) => {
        const st =
          row.querySelector(".att-status-btn.is-active")?.dataset?.status ||
          "present";
        setRowStatus(row, st);
      });

      updateCounts();
      applyFilters();

      if (ACTIVE_LOCKED) {
        showToast("هذه الجلسة معتمدة ولا يمكن تعديلها.");
      }
    }

    function collectEntries() {
      const rows = Array.from(tbody.querySelectorAll("tr.att-row"));
      return rows.map((row) => {
        const studentId = Number(row.dataset.studentId || 0);
        const status =
          row.querySelector(".att-status-btn.is-active")?.dataset?.status ||
          "present";
        const note = (row.querySelector(".att-note")?.value || "").trim();

        const reasonIdRaw = (row.querySelector(".att-reason")?.value || "").trim();
        const lateRaw = (row.querySelector(".att-late-min")?.value || "").trim();

        const reasonId = reasonIdRaw ? Number(reasonIdRaw) : null;
        const lateMinutes = lateRaw ? Number(lateRaw) : null;

        return { studentId, status, note, reasonId, lateMinutes };
      });
    }

    async function saveAttendance({ lock }) {
      if (!ACTIVE_SESSION_ID) return showToast("لا توجد جلسة حضور نشطة.");
      if (ACTIVE_LOCKED) return showToast("الجلسة معتمدة ولا يمكن تعديلها.");

      const entries = collectEntries();
      await apiPost(
        `/teacher/sessions/${encodeURIComponent(ACTIVE_SESSION_ID)}/attendance`,
        {
          entries,
          lock: lock === true,
        }
      );

      showToast(lock ? "تم حفظ واعتماد الحضور ✅" : "تم حفظ الحضور ✅");
      if (lock) {
        setLockedUI(true);
      }
    }

    // أحداث الجدول
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest(".att-status-btn");
      if (!btn) return;
      if (ACTIVE_LOCKED) return;

      const row = btn.closest("tr.att-row");
      if (!row) return;

      const st = btn.dataset.status || "present";
      setRowStatus(row, st);
      updateCounts();
      applyFilters();
    });

    tbody.addEventListener("input", (e) => {
      if (ACTIVE_LOCKED) return;
      if (
        e.target.closest(".att-note") ||
        e.target.closest(".att-reason") ||
        e.target.closest(".att-late-min")
      ) {
        // لا شيء إضافي هنا
      }
    });

    searchInput?.addEventListener("input", applyFilters);
    onlyIssuesChk?.addEventListener("change", applyFilters);

    // تحميل الطلاب (ينشئ/يفتح session ثم يجلب الطلاب)
    loadBtn?.addEventListener("click", async () => {
      try {
        await filterLessonsByTeacherDay(lessonSelect, getTeachingScope("att"));

        const info = await startOrGetSession({ startNow: false });
        if (!info?.sessionId) return;
        await loadSession(info.sessionId);
        setAttendanceTab("take");
      } catch (e) {
        console.error(e);
        showToast("فشل تحميل قائمة الطلاب: " + (e.message || ""));
      }
    });

    allPresentBtn?.addEventListener("click", () => {
      if (ACTIVE_LOCKED) return;
      tbody
        .querySelectorAll("tr.att-row")
        .forEach((row) => setRowStatus(row, "present"));
      updateCounts();
      applyFilters();
    });

    allAbsentBtn?.addEventListener("click", () => {
      if (ACTIVE_LOCKED) return;
      tbody
        .querySelectorAll("tr.att-row")
        .forEach((row) => setRowStatus(row, "absent"));
      updateCounts();
      applyFilters();
    });

    saveSoftBtn?.addEventListener("click", () => saveAttendance({ lock: false }));
    saveBtn?.addEventListener("click", () => saveAttendance({ lock: true }));

    // ✅ كشف الغياب من DB
    function renderHistory(rows) {
      const list = Array.isArray(rows) ? rows : [];
      if (!historyBody || !historyEmpty) return;

      if (!list.length) {
        historyBody.innerHTML = "";
        historyEmpty.style.display = "block";
        historyEmpty.textContent = "لا توجد نتائج.";
        return;
      }

      historyEmpty.style.display = "none";
      historyBody.innerHTML = list
        .map(
          (x) => `
      <tr>
        <td>${escapeHtml(x.student_name || "")} (${escapeHtml(
            x.student_code || ""
          )})</td>
        <td>${escapeHtml(String(x.attendance_date || "").slice(0, 10))}</td>
        <td>${escapeHtml(String(x.lesson || ""))}</td>
        <td>${escapeHtml(x.subject_name || "")}</td>
        <td>${escapeHtml(x.status || "")}</td>
        <td>${escapeHtml(x.note || "-")}</td>
      </tr>
    `
        )
        .join("");
    }

    historyShowBtn?.addEventListener("click", async () => {
      const q = (historySearchInput?.value || "").trim();
      if (!q) return showToast("أدخل اسم الطالب أو كوده للبحث.");

      try {
        const r = await apiGet(
          `/teacher/attendance/history?search=${encodeURIComponent(q)}`
        );
        const rows = r?.data?.rows || r?.rows || r?.data || [];
        renderHistory(rows);
        setAttendanceTab("history");
      } catch (e) {
        console.error(e);
        showToast("فشل البحث في كشف الغياب: " + (e.message || ""));
      }
    });

    // ✅ فتح جلسة حضور مباشرة من إدارة الحصص
    window.__openAttendanceForSession = async (sessionId) => {
      openModal("modal-attendance");
      try {
        await loadSession(sessionId);
        setAttendanceTab("take");
      } catch (e) {
        console.error(e);
        showToast("فشل فتح جلسة الحضور: " + (e.message || ""));
      }
    };
  })();

  // ====== الدرجات والتقييم ======
  (function initGrades() {
    const loadBtn = $("gr-load");
    const tbody = $("gr-table-body");
    const saveBtn = $("gr-save");
    const exportBtn = $("gr-export");
    const typeSelect = $("gr-type");
    const scopeSummaryEl = $("gr-scope-summary");

    initScopeSelectorsFor("gr");
    if (!loadBtn || !tbody) return;

    loadBtn.addEventListener("click", () => {
      const scope = ensureScopeSelected("gr");
      if (!scope) return;

      const type = typeSelect ? typeSelect.value : "شهري";
      const maxScore = type === "نهائي" ? 50 : 20;

      if (scopeSummaryEl) {
        scopeSummaryEl.textContent = `إدخال الدرجات لـ: ${scope.stage} — الصف ${scope.grade} / ${scope.section} — مادة ${scope.subject} — نوع التقييم: ${type}. الحد الأعلى: ${maxScore} درجة.`;
      }

      const students = getStudentsForScope(scope);
      tbody.innerHTML = students
        .map(
          (s) => `
        <tr>
          <td><i class="ri-book-open-line"></i> ${escapeHtml(s.name)}</td>
          <td><input type="number" min="0" max="${maxScore}" style="width:80px;"></td>
          <td>${maxScore}</td>
        </tr>
      `
        )
        .join("");
    });

    saveBtn?.addEventListener("click", () => {
      const scope = ensureScopeSelected("gr");
      if (!scope) return;
      showToast(`تم حفظ الدرجات (تجريبي) لـ ${scope.grade} / ${scope.section}`);
    });

    exportBtn?.addEventListener("click", () => {
      const scope = ensureScopeSelected("gr");
      if (!scope) return;
      showToast(
        `سيتم لاحقًا توليد تقرير PDF للدرجات لـ ${scope.grade} / ${scope.section}`
      );
    });
  })();

  // ====== الإشعارات (كما هي تجريبية) ======
  (function initNotifications() {
    const btnSend = $("nt-send");
    const btnInbox = $("nt-show-inbox");
    const btnSent = $("nt-show-sent");
    const tbody = $("nt-table-body");
    const titleInput = $("nt-title");
    const targetType = $("nt-target-type");
    const targetValue = $("nt-target-value");
    const bodyInput = $("nt-body");
    const notifBtn = $("notifications-btn");
    const notifDot = notifBtn ? notifBtn.querySelector(".badge-dot") : null;

    if (!tbody) return;

    let inbox = [
      {
        title: "شكر وتقدير",
        fromTo: "ولي أمر الطالب: خالد",
        kind: "رسالة واردة",
        status: "مقروء",
        date: "2025-01-01",
      },
    ];
    let sent = [];

    function render(list) {
      if (!list.length) {
        tbody.innerHTML =
          '<tr><td colspan="5">لا توجد رسائل في هذا القسم (تجريبي).</td></tr>';
        return;
      }
      tbody.innerHTML = list
        .map(
          (n) => `
        <tr>
          <td>${escapeHtml(n.title)}</td>
          <td>${escapeHtml(n.fromTo)}</td>
          <td>${escapeHtml(n.kind)}</td>
          <td>${escapeHtml(n.status)}</td>
          <td>${escapeHtml(n.date)}</td>
        </tr>
      `
        )
        .join("");
    }

    btnSend?.addEventListener("click", () => {
      if (!titleInput.value.trim() || !bodyInput.value.trim())
        return showToast("أدخل عنوان الإشعار والنص.");

      const kindMap = {
        class: "لصف / شعبة",
        student: "لطالب",
        parent: "لولي أمر",
        all: "للجميع",
      };
      const kindLabel = kindMap[targetType.value] || targetType.value;
      const tv = (targetValue.value || "").trim();

      sent.unshift({
        title: titleInput.value.trim(),
        fromTo: "من المعلّم → " + (tv || kindLabel),
        kind: kindLabel,
        status: "مرسل",
        date: new Date().toLocaleString("ar-EG", { hour12: false }),
      });

      showToast("تم إرسال الإشعار (تجريبي).");
      titleInput.value = "";
      targetValue.value = "";
      bodyInput.value = "";
      if (notifDot) notifDot.style.display = "block";
    });

    btnInbox?.addEventListener("click", () => render(inbox));
    btnSent?.addEventListener("click", () => render(sent));

    notifBtn?.addEventListener("click", () => {
      openModal("modal-notifications");
      if (notifDot) notifDot.style.display = "none";
    });

    render(inbox);
  })();

  // ====== الاختبارات والأنشطة (تجريبي) ======
  (function initExams() {
    const createBtn = $("ex-create");
    const tbody = $("ex-table-body");
    const titleInput = $("ex-title");
    const typeSelect = $("ex-type");
    const datetimeInput = $("ex-datetime");
    const maxInput = $("ex-max");

    if (!createBtn || !tbody) return;

    const exams = [];

    function render() {
      if (!exams.length) {
        tbody.innerHTML =
          '<tr><td colspan="4">لا توجد اختبارات / أنشطة مسجلة (تجريبي).</td></tr>';
        return;
      }
      tbody.innerHTML = exams
        .map(
          (ex) => `
        <tr>
          <td>${escapeHtml(ex.title)}</td>
          <td>${ex.type === "exam" ? "اختبار" : "نشاط"}</td>
          <td>${escapeHtml(ex.date)}</td>
          <td>${escapeHtml(ex.max)}</td>
        </tr>
      `
        )
        .join("");
    }

    createBtn.addEventListener("click", () => {
      const title = titleInput.value.trim();
      if (!title) return showToast("أدخل عنوان الاختبار / النشاط.");

      const dateStr =
        datetimeInput.value ||
        new Date().toLocaleString("ar-EG", { hour12: false });
      const max = Number(maxInput.value || "20");

      exams.unshift({ title, type: typeSelect.value, date: dateStr, max });

      titleInput.value = "";
      datetimeInput.value = "";
      maxInput.value = "20";
      showToast("تم حفظ الاختبار / النشاط (تجريبي).");
      render();
    });

    render();
  })();

  // ============================================================
  // ✅ قوائم الطلاب (✅ من DB) — بدون اختيار مادة + يعرض فقط شعب المعلم + تحديد تلقائي + تحميل تلقائي
  // ============================================================
  (function initStudentsReal() {
    const loadBtn = $("st-load");
    const searchInput = $("st-search");
    const tbody = $("st-table-body");

    const yearSel = $("st-year"); // قد يكون غير موجود
    const termSel = $("st-term"); // قد يكون غير موجود

    const stageSel = $("st-stage");
    const gradeSel = $("st-grade");
    const sectionSel = $("st-section");

    if (!loadBtn || !tbody || !stageSel || !gradeSel || !sectionSel) return;

    // نخزن آخر سنة/ترم للمودال (لو أضفتهم)
    const ST_LS_YEAR = "ST_YEAR_ID";
    const ST_LS_TERM = "ST_TERM";

    // ✅ نحفظ آخر اختيار نطاق (مرحلة/صف/شعبة) لتسهيل الرجوع
    const ST_LS_STAGE = "ST_STAGE_ID";
    const ST_LS_GRADE = "ST_GRADE_ID";
    const ST_LS_SECTION = "ST_SECTION_ID";

    // list of {stage_id, stage_name, grade_id, grade_name, section_id, section_name, subject_id?, subject_name?}
    let scopesCache = [];
    let currentList = [];

    function setDisabled(sel, dis) {
      if (!sel) return;
      sel.disabled = !!dis;
    }

    function setOptions(sel, items, placeholderText, valueKey, labelKey) {
      if (!sel) return;
      sel.innerHTML = `<option value="">${placeholderText}</option>`;
      (items || []).forEach((x) => {
        const v = x[valueKey];
        const t = x[labelKey];
        sel.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`
        );
      });
      setDisabled(sel, !(items && items.length));
    }

    function uniqBy(arr, keyFn) {
      const m = new Map();
      for (const x of arr || []) {
        const k = keyFn(x);
        if (!m.has(k)) m.set(k, x);
      }
      return Array.from(m.values());
    }

    function hasOption(sel, value) {
      if (!sel) return false;
      return Array.from(sel.options).some(
        (o) => String(o.value) === String(value)
      );
    }

    // ✅ اختر قيمة محفوظة إن وجدت، وإلا اختر أول عنصر من القائمة
    function chooseSavedOrFirst(sel, savedValue, items) {
      if (!sel) return;
      if (savedValue && hasOption(sel, savedValue)) {
        sel.value = String(savedValue);
      } else if (items && items.length) {
        sel.value = String(items[0].id);
      } else {
        sel.value = "";
      }
      sel.dispatchEvent(new Event("change"));
    }

    function getYearTerm() {
      const y1 = yearSel?.value || localStorage.getItem(ST_LS_YEAR);
      const t1 = termSel?.value || localStorage.getItem(ST_LS_TERM);

      const y2 = localStorage.getItem("TT_YEAR_ID");
      const t2 = localStorage.getItem("TT_TERM");

      const yearId = Number(y1 || y2 || 1);
      const term = Number(t1 || t2 || 1);
      return { yearId, term };
    }

    async function loadYearsIfNeeded() {
      if (!yearSel) return;
      try {
        const r = await apiGet("/teacher/timetables/meta");
        const meta = r?.data || r || {};
        const years = meta?.years || meta?.data?.years || [];

        yearSel.innerHTML = "";
        if (!years.length) {
          yearSel.innerHTML = `<option value="1">سنة افتراضية</option>`;
        } else {
          years.forEach((y) => {
            const id = y.id ?? y.academic_year_id ?? y.value;
            const name = y.name ?? y.year_name ?? `سنة ${id}`;
            yearSel.insertAdjacentHTML(
              "beforeend",
              `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`
            );
          });
        }

        const saved =
          localStorage.getItem(ST_LS_YEAR) || localStorage.getItem("TT_YEAR_ID");
        if (saved && hasOption(yearSel, saved)) yearSel.value = String(saved);

        if (termSel) {
          const savedTerm =
            localStorage.getItem(ST_LS_TERM) ||
            localStorage.getItem("TT_TERM") ||
            "1";
          termSel.value = savedTerm === "2" ? "2" : "1";
        }
      } catch (e) {
        console.warn("students years meta failed:", e);
      }
    }

    // ====== ملخص تكليف المعلم (مراحل/شعب/مواد) ======
    function buildTeachingMap(scopes) {
      const map = new Map(); // key => { stage, grade, section, subjects:Set }
      for (const x of scopes || []) {
        const stage = x.stage_name || `Stage ${x.stage_id}`;
        const grade = x.grade_name || `Grade ${x.grade_id}`;
        const section = x.section_name || `Section ${x.section_id}`;
        const subject = x.subject_name || "";

        const key = `${stage}||${grade}||${section}`;
        if (!map.has(key)) {
          map.set(key, { stage, grade, section, subjects: new Set() });
        }
        if (subject) map.get(key).subjects.add(subject);
      }
      return Array.from(map.values()).map((g) => ({
        ...g,
        subjectsText: Array.from(g.subjects).join("، ") || "—",
      }));
    }

    function ensureSummaryBox(anchorEl, id) {
      let box = document.getElementById(id);
      if (box) return box;

      box = document.createElement("div");
      box.id = id;
      box.style.cssText =
        "margin:10px 0;padding:10px 12px;border-radius:12px;" +
        "background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.08);" +
        "font-size:14px;line-height:1.6";
      anchorEl.insertAdjacentElement("beforebegin", box);
      return box;
    }

    function renderTeachingSummary(scopes) {
      const { yearId, term } = getYearTerm();
      const groups = buildTeachingMap(scopes);

      // 1) داخل مودال الطلاب (فوق زر العرض)
      const stBox = ensureSummaryBox(loadBtn, "st-teaching-summary");
      stBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <b>تكليفك الدراسي</b>
          <span style="opacity:.8">السنة: ${escapeHtml(
            yearId
          )} — الترم: ${escapeHtml(term)}</span>
        </div>
        <div style="margin-top:6px;opacity:.9">عدد الشعب المسندة: <b>${
          groups.length
        }</b></div>
        <div style="margin-top:8px">
          ${
            groups.length
              ? groups
                  .map(
                    (g) => `
              <div style="padding:6px 0;border-top:1px dashed rgba(0,0,0,.12)">
                <b>${escapeHtml(g.stage)}</b> — ${escapeHtml(
                      g.grade
                    )} / ${escapeHtml(g.section)}
                <div style="opacity:.9">المواد: ${escapeHtml(
                  g.subjectsText
                )}</div>
              </div>
            `
                  )
                  .join("")
              : `<div style="opacity:.8">لا توجد شعب مسندة لك في هذه السنة/الترم.</div>`
          }
        </div>
      `;

      // 2) داخل الملف الشخصي (إن وجد)
      const prof = $("profile-modal");
      if (prof) {
        const anchor = prof.querySelector(".modal-content") || prof;
        let pBox = document.getElementById("profile-teaching-summary");
        if (!pBox) {
          pBox = document.createElement("div");
          pBox.id = "profile-teaching-summary";
          pBox.style.cssText = stBox.style.cssText;
          anchor.appendChild(pBox);
        }
        pBox.innerHTML = stBox.innerHTML.replace(
          "تكليفك الدراسي",
          "تكليفي التدريسي"
        );
      }
    }

    async function loadTeacherScopes() {
      await loadYearsIfNeeded();

      const { yearId, term } = getYearTerm();

      const r = await apiGet(
        `/teacher/timetables/students/scopes?academicYearId=${encodeURIComponent(
          yearId
        )}&term=${encodeURIComponent(term)}`
      );

      const scopes = r?.data?.scopes || r?.scopes || r?.data || [];
      scopesCache = Array.isArray(scopes) ? scopes : [];

      // ✅ عرض ملخص ماذا يدرس المعلم
      renderTeachingSummary(scopesCache);

      // تعبئة المرحلة (فقط مراحل/صفوف/شعب هذا المعلم)
      const stages = uniqBy(scopesCache, (x) => String(x.stage_id)).map(
        (x) => ({
          id: x.stage_id,
          name: x.stage_name || `Stage ${x.stage_id}`,
        })
      );

      setOptions(stageSel, stages, "اختر المرحلة", "id", "name");

      // reset باقي القوائم
      gradeSel.innerHTML = `<option value="">اختر الصف</option>`;
      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      setDisabled(gradeSel, true);
      setDisabled(sectionSel, true);

      tbody.innerHTML = `<tr><td colspan="4">اختر الشعبة لعرض الطلاب.</td></tr>`;
      currentList = [];

      if (!stages.length) {
        showToast(
          "لا توجد شعب مسندة لك في هذه السنة/الترم، أو لا يوجد جدول منشور."
        );
        return;
      }

      // ✅ اختيار تلقائي (المحفوظ أو أول خيار) ثم تحميل تلقائي عبر السلسلة
      const savedStage = localStorage.getItem(ST_LS_STAGE);
      chooseSavedOrFirst(stageSel, savedStage, stages);
    }

    stageSel.addEventListener("change", () => {
      const stageId = stageSel.value;
      localStorage.setItem(ST_LS_STAGE, String(stageId || ""));

      gradeSel.innerHTML = `<option value="">اختر الصف</option>`;
      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      setDisabled(gradeSel, true);
      setDisabled(sectionSel, true);

      if (!stageId) return;

      const grades = uniqBy(
        scopesCache.filter((x) => String(x.stage_id) === String(stageId)),
        (x) => String(x.grade_id)
      ).map((x) => ({
        id: x.grade_id,
        name: x.grade_name || `Grade ${x.grade_id}`,
      }));

      setOptions(gradeSel, grades, "اختر الصف", "id", "name");

      // ✅ اختيار تلقائي (المحفوظ أو أول خيار)
      const savedGrade = localStorage.getItem(ST_LS_GRADE);
      if (savedGrade && hasOption(gradeSel, savedGrade)) {
        gradeSel.value = String(savedGrade);
        gradeSel.dispatchEvent(new Event("change"));
      } else if (grades.length) {
        gradeSel.value = String(grades[0].id);
        gradeSel.dispatchEvent(new Event("change"));
      }
    });

    gradeSel.addEventListener("change", () => {
      const stageId = stageSel.value;
      const gradeId = gradeSel.value;
      localStorage.setItem(ST_LS_GRADE, String(gradeId || ""));

      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      setDisabled(sectionSel, true);

      if (!stageId || !gradeId) return;

      const sections = uniqBy(
        scopesCache.filter(
          (x) =>
            String(x.stage_id) === String(stageId) &&
            String(x.grade_id) === String(gradeId)
        ),
        (x) => String(x.section_id)
      ).map((x) => ({
        id: x.section_id,
        name: x.section_name || `Section ${x.section_id}`,
      }));

      setOptions(sectionSel, sections, "اختر الشعبة", "id", "name");

      // ✅ اختيار تلقائي (المحفوظ أو أول خيار)
      const savedSection = localStorage.getItem(ST_LS_SECTION);
      if (savedSection && hasOption(sectionSel, savedSection)) {
        sectionSel.value = String(savedSection);
      } else if (sections.length) {
        sectionSel.value = String(sections[0].id);
      }

      // ✅ تحميل تلقائي عند تحديد الشعبة
      if (sectionSel.value) {
        sectionSel.dispatchEvent(new Event("change"));
      }
    });

    // ✅ عند تغيير الشعبة: خزّن + حمّل الطلاب تلقائياً  (هذا هو الشرط الذي طلبته)
    sectionSel.addEventListener("change", () => {
      localStorage.setItem(ST_LS_SECTION, String(sectionSel.value || ""));
      if (sectionSel.value) loadBtn.click();
    });

    function render(list) {
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="4">لا يوجد طلاب لهذا النطاق.</td></tr>`;
        return;
      }
      tbody.innerHTML = list
        .map(
          (s) => `
      <tr>
        <td>${escapeHtml(s.student_code || s.code || "")}</td>
        <td>${escapeHtml(s.full_name || s.name || "")}</td>
        <td>${escapeHtml(s.class_label || s.classLabel || "")}</td>
        <td>${escapeHtml(s.parent_phone || s.parentPhone || "")}</td>
      </tr>
    `
        )
        .join("");
    }

    loadBtn.addEventListener("click", async () => {
      const { yearId, term } = getYearTerm();

      const stageId = stageSel.value;
      const gradeId = gradeSel.value;
      const sectionId = sectionSel.value;

      if (!yearId || !stageId || !gradeId || !sectionId) {
        return showToast("اختر السنة (إن وجدت) والمرحلة والصف والشعبة أولاً.");
      }

      // ✅ حماية: لا يسمح بطلب شعبة خارج نطاق المعلم
      const match = scopesCache.find(
        (x) =>
          String(x.stage_id) === String(stageId) &&
          String(x.grade_id) === String(gradeId) &&
          String(x.section_id) === String(sectionId)
      );

      if (!match) {
        showToast("هذه الشعبة ليست ضمن شعب هذا المعلّم");
        tbody.innerHTML = `<tr><td colspan="4">لا يمكن عرض طلاب لشعبة غير مسندة لك.</td></tr>`;
        return;
      }

      const q = (searchInput?.value || "").trim();

      try {
        const qs = new URLSearchParams();
        qs.set("academicYearId", String(yearId));
        qs.set("term", String(term));
        qs.set("stageId", String(stageId));
        qs.set("gradeId", String(gradeId));
        qs.set("sectionId", String(sectionId));
        if (q) qs.set("search", q);

        // ✅ توافق إضافي: لو الباك-إند ما زال يتحقق بالمادة، نرسل subjectId تلقائياً بدون إظهارها
        if (match.subject_id) qs.set("subjectId", String(match.subject_id));

        const r = await apiGet("/teacher/timetables/students?" + qs.toString());
        const rows = r?.data?.students || r?.students || r?.data || [];
        currentList = Array.isArray(rows) ? rows : [];
        render(currentList);
      } catch (e) {
        console.error(e);
        showToast("فشل تحميل الطلاب من قاعدة البيانات: " + (e.message || ""));
        render([]);
      }
    });

    // بحث محلي داخل القائمة الحالية
    searchInput?.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = currentList.filter(
        (s) =>
          String(s.full_name || s.name || "")
            .toLowerCase()
            .includes(q) ||
          String(s.student_code || s.code || "")
            .toLowerCase()
            .includes(q)
      );
      render(filtered);
    });

    // لو أضفت st-year/st-term نحفظهم
    yearSel?.addEventListener("change", () =>
      localStorage.setItem(ST_LS_YEAR, String(yearSel.value || "1"))
    );
    termSel?.addEventListener("change", () =>
      localStorage.setItem(ST_LS_TERM, String(termSel.value || "1"))
    );

    // ✅ عند فتح المودال: حمّل نطاق المعلم (وسيختار تلقائياً ويحمل الطلاب)
    window.__loadTeacherStudentScopes = () => loadTeacherScopes();
  })();

  // ====== إدارة الحصص (DB Sessions) ======
  (function initLessonsDB() {
    const lessonSelect = $("ls-lesson");
    const noteInput = $("ls-note");
    const startBtn = $("ls-start");
    const endBtn = $("ls-end");
    const timelineBox = $("ls-timeline");
    const statusSmall = $("lesson-status-small");

    const dateInput = $("ls-date"); // إن وجد
    if (!lessonSelect || !startBtn || !endBtn) return;

    // ✅ نطاق DB
    initTeachingPicker("ls");
    ensureLessonSelectOptions(lessonSelect, "اختر الحصة").catch(() => {});

    let ACTIVE_SESSION_ID = null;

    function getLessonDate() {
      const d = (dateInput?.value || "").slice(0, 10);
      return d || ($("att-date")?.value || "").slice(0, 10) || todayISO();
    }

    function syncAttendanceInputsFromLesson(scope, dateVal, periodId, lessonNo) {
      // تأكد أن مودال الحضور جاهز بالنطاق
      initTeachingPicker("att");
      setTeachingScope("att", scope);

      const attDate = $("att-date");
      const attLesson = $("att-lesson");
      if (attDate) attDate.value = dateVal;

      // نعتمد periodId كقيمة select، والـ lessonNo كـ dataset
      if (attLesson) {
        attLesson.value = String(periodId || "");
      }
    }

    startBtn.addEventListener("click", async () => {
      try {
        const scope = getTeachingScope("ls");
        const { yearId, term } = getYearTermForTeacher();

        await ensureLessonSelectOptions(lessonSelect, "اختر الحصة");
        const periodId = Number(lessonSelect.value || 0);
        const lessonNo = Number(
          lessonSelect.selectedOptions?.[0]?.dataset?.lesson || periodId
        );

        if (
          !scope.stageId ||
          !scope.gradeId ||
          !scope.sectionId ||
          !scope.subjectId
        ) {
          return showToast("اختر المرحلة والصف والشعبة والمادة أولاً.");
        }
        if (!periodId) return showToast("اختر رقم الحصة أولاً.");

        const dateVal = getLessonDate();
        const note = (noteInput?.value || "").trim();

        const r = await apiPost("/teacher/sessions/start", {
          academicYearId: yearId,
          term,
          date: dateVal,
          periodId,
          lesson: lessonNo,
          sectionId: scope.sectionId,
          subjectId: scope.subjectId,
          lessonNote: note || null,
          source: "manual",
          startNow: true,
        });

        const sessionId = r?.data?.sessionId || r?.sessionId;
        const locked = !!(r?.data?.isLocked || r?.isLocked);

        if (!sessionId) return showToast("لم يتم إنشاء جلسة الحصة.");

        ACTIVE_SESSION_ID = sessionId;

        if (timelineBox) {
          timelineBox.textContent =
            `بدأت الحصة ${lessonNo || periodId} — ${scope.gradeName} / ${
              scope.sectionName
            } — ${scope.subjectName}` +
            ` — تاريخ ${dateVal}` +
            (note ? ` — ملاحظة: ${note}` : "") +
            (locked ? " — (معتمدة)" : "");
        }
        if (statusSmall)
          statusSmall.textContent = locked ? "حصة معتمدة" : "حصة جارية الآن ✅";

        // ✅ حدّث Context للغيابات (يثبت التاريخ/الحصة/النطاق ويقفلهم)
        saveAttCtx({
          sessionId: Number(sessionId),
          date: dateVal,
          periodId: Number(periodId),
          lessonNo: Number(lessonNo || periodId),
          scope: {
            stageId: Number(scope.stageId || 0),
            gradeId: Number(scope.gradeId || 0),
            sectionId: Number(scope.sectionId || 0),
            subjectId: Number(scope.subjectId || 0),
          },
        });

        // ✅ (إبقاء التوافق)
        syncAttendanceInputsFromLesson(scope, dateVal, periodId, lessonNo);

        // ✅ افتح الحضور على نفس الجلسة
        if (typeof window.__openAttendanceForSession === "function") {
          window.__openAttendanceForSession(sessionId);
        } else {
          openModal("modal-attendance");
        }
      } catch (e) {
        console.error(e);
        showToast("فشل بدء الحصة: " + (e.message || ""));
      }
    });

    endBtn.addEventListener("click", async () => {
      try {
        if (!ACTIVE_SESSION_ID) return showToast("لا توجد حصة جارية لإنهائها.");

        await apiPost(
          `/teacher/sessions/${encodeURIComponent(ACTIVE_SESSION_ID)}/end`,
          {}
        );

        if (timelineBox)
          timelineBox.textContent = `تم إنهاء الحصة (جلسة #${ACTIVE_SESSION_ID}).`;
        if (statusSmall) statusSmall.textContent = "لا توجد حصة جارية الآن.";

        ACTIVE_SESSION_ID = null;

        // ✅ (اختياري) فك السياق عند إنهاء الحصة
        saveAttCtx(null);
        lockAttendancePickers(false);
      } catch (e) {
        console.error(e);
        showToast("فشل إنهاء الحصة: " + (e.message || ""));
      }
    });
  })();

  // ====== التقارير (PDF) ======
  (function initReports() {
    const typeSelect = $("rp-type");
    const classInput = $("rp-class");
    const downloadBtn = $("rp-download");
    if (!downloadBtn) return;

    downloadBtn.addEventListener("click", () => {
      if (!classInput.value.trim())
        return showToast("أدخل الصف / الشعبة أولًا (مثال: 2 / ب).");
      const type = typeSelect ? typeSelect.value : "grades";
      const typeLabel = type === "grades" ? "درجات" : "حضور";
      showToast(
        `سيتم لاحقًا توليد تقرير ${typeLabel} لـ ${classInput.value.trim()} كملف PDF.`
      );
    });
  })();

  // ====== تغيير كلمة المرور (تجريبي) ======
  (function initChangePassword() {
    const form = $("changePasswordForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const current = $("currentPassword");
      const p1 = $("newPassword");
      const p2 = $("confirmNewPassword");
      if (!current.value || !p1.value || !p2.value)
        return showToast("يرجى إدخال جميع الحقول.");
      if (p1.value !== p2.value)
        return showToast("كلمة المرور الجديدة غير متطابقة.");
      if (p1.value.length < 8)
        return showToast("يجب أن تكون كلمة المرور من 8 أحرف على الأقل.");
      showToast("تم تحديث كلمة المرور (تجريبي فقط).");
      current.value = "";
      p1.value = "";
      p2.value = "";
      closeModal($("change-password-modal"));
    });
  })();

  // ====== تغيير البريد الإلكتروني (تجريبي) ======
  (function initChangeEmail() {
    const form = $("changeEmailForm");
    const profileEmail = $("profile-email");
    const currentEmailInput = $("currentEmail");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const newEmailInput = $("newEmail");
      const mail = newEmailInput.value.trim();
      if (!mail) return showToast("أدخل البريد الجديد.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail))
        return showToast("صيغة بريد غير صحيحة.");
      if (profileEmail) profileEmail.textContent = mail;
      if (currentEmailInput) currentEmailInput.value = mail;
      localStorage.setItem("teacher_email", mail);
      showToast("تم تحديث البريد الإلكتروني (تجريبي).");
      newEmailInput.value = "";
      closeModal($("change-email-modal"));
    });

    const stored = localStorage.getItem("teacher_email");
    if (stored) {
      if (profileEmail) profileEmail.textContent = stored;
      if (currentEmailInput) currentEmailInput.value = stored;
    }
  })();

  // ✅ تجهيز تبويب افتراضي عند أول تشغيل (بدون فتح مودال)
  (function initDefaultTab() {
    const savedTab = localStorage.getItem(TT_TAB_KEY) || "weekly";
    if (ttViewWeekly && ttViewExams) {
      ttViewWeekly.style.display = savedTab === "weekly" ? "" : "none";
      ttViewExams.style.display = savedTab === "exams" ? "" : "none";
    }
  })();
})();
