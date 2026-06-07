// frontend/student/js/student.js
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "/api";
  const $ = (sel, root = document) => root.querySelector(sel);

  // =========================
  // Helpers: Auth + API
  // =========================
  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiGet(path) {
    const r = await fetch(API_BASE + path, { headers: { ...authHeaders() } });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) throw new Error(data?.message || text.slice(0, 200) || "API Error");
    return data;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // =========================
  // Toast
  // =========================
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

  // =========================
  // Theme (Light/Dark)
  // =========================
  const htmlEl = document.documentElement;
  const themeToggle = $("#theme-toggle");
  const savedTheme = localStorage.getItem("stu-theme") || "light";
  htmlEl.setAttribute("data-theme", savedTheme);

  if (themeToggle) {
    const icon = themeToggle.querySelector("i");
    if (icon) icon.className = savedTheme === "dark" ? "ri-sun-line" : "ri-moon-line";

    themeToggle.addEventListener("click", () => {
      const cur = htmlEl.getAttribute("data-theme") || "light";
      const next = cur === "light" ? "dark" : "light";
      htmlEl.setAttribute("data-theme", next);
      localStorage.setItem("stu-theme", next);

      const ic = themeToggle.querySelector("i");
      if (ic) ic.className = next === "dark" ? "ri-sun-line" : "ri-moon-line";
      showToast(next === "dark" ? "تم التبديل إلى الوضع الليلي" : "تم التبديل إلى الوضع النهاري");
    });
  }
async function loadStudentHeroStats() {
  try {
    const data = await apiGet("/student/hero-stats");

    const attEl = document.getElementById("st-year-att-rate");
    const avgEl = document.getElementById("st-avg-grade");
    const feesEl = document.getElementById("st-remaining-fees");

    if (attEl) {
      attEl.textContent = `${Number(data.attendanceRate ?? 0).toFixed(2)}%`;
    }

    if (avgEl) {
      attEl;
      avgEl.textContent = `${Number(data.averageGrade ?? 0).toFixed(2)} / 100`;
    }

    if (feesEl) {
      feesEl.textContent = `${Number(data.remainingFees ?? 0).toLocaleString("ar-SA")} ر.ي`;
    }
  } catch (error) {
    console.error("loadStudentHeroStats error:", error);

    const attEl = document.getElementById("st-year-att-rate");
    const avgEl = document.getElementById("st-avg-grade");
    const feesEl = document.getElementById("st-remaining-fees");

    if (attEl) attEl.textContent = "غير متاح";
    if (avgEl) avgEl.textContent = "غير متاح";
    if (feesEl) feesEl.textContent = "غير متاح";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadStudentHeroStats();
});
  // =========================
  // Clock
  // =========================
  function updateClock() {
    const now = new Date();
    const tEl = $("#clock-time");
    const dEl = $("#clock-date");
    if (tEl) tEl.textContent = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    if (dEl) dEl.textContent = now.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  updateClock();
  setInterval(updateClock, 60000);

  // =========================
  // Account dropdown
  // =========================
  const accountToggle = $("#account-menu-toggle");
  const accountDropdown = $("#account-dropdown");

  if (accountToggle && accountDropdown) {
    accountToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = accountDropdown.style.display === "flex";
      accountDropdown.style.display = open ? "none" : "flex";
      accountDropdown.style.flexDirection = "column";
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".account-wrapper")) accountDropdown.style.display = "none";
    });
  }

  // =========================
  // Modals
  // =========================
  const overlay = $("#modal-overlay");

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = "flex";
  if (overlay) overlay.style.display = "flex";
  if (accountDropdown) accountDropdown.style.display = "none";

  // ✅ تحميل الامتحانات عند فتح المودال
  if (id === "modal-exams") loadStudentExams({ silent: true });
  if (id === "modal-timetable") loadAndRenderStudentTimetable({ silent: true });
}



  function closeModalByElement(modal) {
    if (!modal) return;
    modal.style.display = "none";
    const anyOpen = [...document.querySelectorAll(".modal")].some((m) => m.style.display === "flex");
    if (!anyOpen && overlay) overlay.style.display = "none";
  }

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal");
      closeModalByElement(modal);
    });
  });

  if (overlay) {
    overlay.addEventListener("click", () => {
      document.querySelectorAll(".modal").forEach((m) => (m.style.display = "none"));
      overlay.style.display = "none";
    });
  }

  document.querySelectorAll(".card[data-modal]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-modal");
      if (id) openModal(id);
    });
  });

  // =========================
  // Avatar
  // =========================
  const avatarInput = $("#avatar-input");
  const changeAvatarBtn = $("#change-avatar-btn");
  const avatarImg = $("#student-avatar-img");
  const avatarLetter = $("#student-avatar-letter");

  const savedAvatar = localStorage.getItem("stu-avatar");
  if (savedAvatar && avatarImg && avatarLetter) {
    avatarImg.src = savedAvatar;
    avatarImg.style.display = "block";
    avatarLetter.style.display = "none";
  }

  if (changeAvatarBtn && avatarInput) {
    changeAvatarBtn.addEventListener("click", () => avatarInput.click());
    avatarInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        if (avatarImg && avatarLetter) {
          avatarImg.src = dataUrl;
          avatarImg.style.display = "block";
          avatarLetter.style.display = "none";
        }
        localStorage.setItem("stu-avatar", dataUrl);
        showToast("تم تحديث الصورة الشخصية");
      };
      reader.readAsDataURL(file);
    });
  }

  // =========================
  // Command (Ctrl+K)
  // =========================
  const cmdInput = $("#command-input");
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      cmdInput?.focus();
      cmdInput?.select?.();
    }
  });

  // =========================
  // Student Pill/Profile (from localStorage user)
  // =========================
  const pillName = $("#student-name-pill");
  const pillClass = $("#student-class-pill");
  const profileName = $("#profile-name");
  const profileEmail = $("#profile-email");
  const profileRole = $("#profile-role");

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();

  if (pillName && user?.name) pillName.textContent = user.name;
  if (profileName && user?.name) profileName.textContent = user.name;
  if (profileEmail && user?.email) profileEmail.textContent = user.email;

  // =========================
  // Timetable (REAL from DB via student portal)
  // =========================
  const ttBody = $("#tt-table-body");
  const ttTerm = $("#tt-term");
  const ttClass = $("#tt-class");
  const ttRefresh = $("#tt-refresh");
  const nextSmall = $("#next-class-small");
  const nextInfo = $("#next-class-info");

  const DAY_NAME_BY_ID = { 1: "السبت", 2: "الأحد", 3: "الاثنين", 4: "الثلاثاء", 5: "الأربعاء", 6: "الخميس", 7: "الجمعة" };

  function getTermNumber() {
    const raw = String(ttTerm?.value || "1").trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    if (raw.includes("الثاني")) return 2;
    return 1;
  }

  function jsDayToOurId(jsDay) {
    if (jsDay === 6) return 1;
    if (jsDay === 0) return 2;
    if (jsDay === 1) return 3;
    if (jsDay === 2) return 4;
    if (jsDay === 3) return 5;
    if (jsDay === 4) return 6;
    return 7;
  }

  function parseTimeToMin(t) {
    if (!t) return null;
    const s = String(t).slice(0, 5);
    const [h, m] = s.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }
// ====== Week helpers (عشان overrides تظهر مثل المعلم) ======
function toISODate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function weekStartSaturday(anyDate) {
  const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // Sunday=0 ... Saturday=6
  const back = (dow + 1) % 7; // السبت => 0
  d.setDate(d.getDate() - back);
  return d;
}
  // ==========================================================
  // ✅ قصّ الأعمدة الفارغة من النهاية حسب آخر حصة مستخدمة
  // ==========================================================
  function trimPeriodsToLastUsed(periods, entries) {
    const ps = Array.isArray(periods) ? periods.slice() : [];
    if (!ps.length) return [];

    ps.sort((a, b) => {
      const ao = Number(a.sort_order ?? a.id ?? 0);
      const bo = Number(b.sort_order ?? b.id ?? 0);
      return ao - bo;
    });

    const orderById = new Map();
    ps.forEach((p, idx) => {
      const pid = Number(p.id);
      const ord = Number(p.sort_order ?? (idx + 1));
      if (Number.isFinite(pid)) orderById.set(pid, Number.isFinite(ord) ? ord : (idx + 1));
    });

    let maxOrdUsed = 0;
    (Array.isArray(entries) ? entries : []).forEach((e) => {
      const pid = Number(e.period_id ?? e.periodId ?? e.period);
      if (!Number.isFinite(pid)) return;
      const ord = orderById.get(pid);
      if (Number.isFinite(ord) && ord > maxOrdUsed) maxOrdUsed = ord;
    });

    if (!maxOrdUsed) return ps;
    return ps.filter((p, idx) => Number(p.sort_order ?? (idx + 1)) <= maxOrdUsed);
  }

  function renderTimetable(periods, entries) {
    if (!ttBody) return;

    const days = [
      { id: 1, name: "السبت" },
      { id: 2, name: "الأحد" },
      { id: 3, name: "الاثنين" },
      { id: 4, name: "الثلاثاء" },
      { id: 5, name: "الأربعاء" },
      { id: 6, name: "الخميس" },
    ];

    const map = new Map();
    (entries || []).forEach((e) => map.set(`${e.day_of_week}-${e.period_id}`, e));

    const headRow = document.querySelector("#modal-timetable thead tr");
    if (headRow) {
      headRow.innerHTML =
        `<th>اليوم</th>` +
        (periods || [])
          .map((p) => {
            const st = String(p.start_time || "").slice(0, 5);
            const en = String(p.end_time || "").slice(0, 5);
            const time = st && en ? `${st}-${en}` : "";
            return `<th>
              <div class="tt-period-head">
                <strong>الحصة ${escapeHtml(p.name || p.sort_order || p.id)}</strong>
                <small>${escapeHtml(time)}</small>
              </div>
            </th>`;
          })
          .join("");
    }

    ttBody.innerHTML = days
      .map((d) => {
        const tds = (periods || [])
          .map((p) => {
            const e = map.get(`${d.id}-${p.id}`);
            if (!e) return `<td class="tt-cell"><div class="tt-empty">—</div></td>`;
         const type = String(e.type || "lesson").toLowerCase();
const room = e.room ? ` • ${escapeHtml(e.room)}` : "";
const teacher = escapeHtml(e.teacher_name || "—");
const subject = escapeHtml(e.subject_name || "—");

if (type === "cancel") {
  return `<td class="tt-cell">
    <div class="tt-lesson" style="border-color:rgba(239,68,68,.55); background:rgba(239,68,68,.10);">
      <div class="tt-subject">🚫 ملغاة</div>
      <div class="tt-teacher">${subject} • ${teacher}${room}</div>
    </div>
  </td>`;
}

if (type === "exam") {
  const title = escapeHtml(e.exam_title || "اختبار");
  return `<td class="tt-cell">
    <div class="tt-lesson" style="border-color:rgba(245,158,11,.65); background:rgba(245,158,11,.12);">
      <div class="tt-subject">📝 ${title}</div>
      <div class="tt-teacher">المادة: ${subject} • ${teacher}${room}</div>
    </div>
  </td>`;
}

// lesson
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
      })
      .join("");
  }

  function updateNextClass(periods, entries) {
    if (!nextSmall && !nextInfo) return;

    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      if (nextSmall) nextSmall.textContent = "لا توجد حصص منشورة.";
      if (nextInfo) nextInfo.textContent = "لا توجد حصص منشورة.";
      return;
    }

    const now = new Date();
    const nowDay = jsDayToOurId(now.getDay());
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const byDay = new Map();
    list.forEach((e) => {
      if (!byDay.has(e.day_of_week)) byDay.set(e.day_of_week, []);
      byDay.get(e.day_of_week).push(e);
    });

    const periodOrder = new Map((periods || []).map((p, idx) => [p.id, p.sort_order ?? idx + 1]));
    for (const [d, arr] of byDay.entries()) {
      arr.sort((a, b) => (periodOrder.get(a.period_id) || 0) - (periodOrder.get(b.period_id) || 0));
    }

    function fmt(e) {
      const dayName = DAY_NAME_BY_ID[e.day_of_week] || "";
      const p = (periods || []).find((x) => x.id === e.period_id);
      const st = String(p?.start_time || e.start_time || "").slice(0, 5);
      const perLabel = p?.name || e.period_id;
      return `${dayName} — الحصة ${perLabel} — ${e.subject_name || "—"} (${e.teacher_name || "—"})${st ? " • " + st : ""}`;
    }

    const today = byDay.get(nowDay) || [];
    for (const e of today) {
      const p = (periods || []).find((x) => x.id === e.period_id);
      const stMin = parseTimeToMin(p?.start_time || e.start_time);
      if (stMin != null && stMin > nowMin) {
        const txt = fmt(e);
        if (nextSmall) nextSmall.textContent = txt;
        if (nextInfo) nextInfo.textContent = "الحصة القادمة: " + txt;
        return;
      }
    }

    const daySeq = [1, 2, 3, 4, 5, 6, 7];
    const startIdx = Math.max(0, daySeq.indexOf(nowDay));
    for (let i = 1; i <= 7; i++) {
      const d = daySeq[(startIdx + i) % 7];
      const arr = byDay.get(d);
      if (arr && arr.length) {
        const txt = fmt(arr[0]);
        if (nextSmall) nextSmall.textContent = txt;
        if (nextInfo) nextInfo.textContent = "الحصة القادمة: " + txt;
        return;
      }
    }

    if (nextSmall) nextSmall.textContent = "لا توجد حصص منشورة.";
    if (nextInfo) nextInfo.textContent = "لا توجد حصص منشورة.";
  }

  // ✅ نخزن enrollment هنا لاستخدام الامتحانات
  let STU_ENROLLMENT = null;

  async function loadAndRenderStudentTimetable({ silent = false } = {}) {
    if (!ttBody) return;

    const term = getTermNumber();

    let metaRes = null;
    try {
      metaRes = await apiGet("/student/meta");
    } catch (e) {
      console.error(e);
      if (!silent) showToast(e.message || "فشل تحميل بيانات الجدول (meta)");
      metaRes = { data: { periods: [], years: [], days: [] } };
    }

    const allPeriods = (metaRes?.data?.periods || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    let sch = null;
    try {
     const weekStart = toISODate(weekStartSaturday(new Date()));
sch = await apiGet(`/student/timetable?term=${term}&weekStart=${encodeURIComponent(weekStart)}`);
    } catch (e) {
      console.error(e);
      if (!silent) showToast(e.message || "فشل تحميل جدول الطالب");
      renderTimetable(allPeriods, []);
      updateNextClass(allPeriods, []);
      return;
    }

    const enrollment = sch?.data?.enrollment || null;
    STU_ENROLLMENT = enrollment || STU_ENROLLMENT;

    if (enrollment) {
      const clsText = `${enrollment.grade_name || enrollment.grade_id || ""} / ${enrollment.section_name || enrollment.section_id || ""}`.trim() || "—";
      if (pillClass) pillClass.textContent = clsText;
      if (profileRole) profileRole.textContent = clsText;

      if (ttClass) {
        ttClass.innerHTML = `<option value="">${escapeHtml(clsText)}</option>`;
        ttClass.value = "";
      }
    }

    const entries = sch?.data?.entries || [];
    const visiblePeriods = trimPeriodsToLastUsed(allPeriods, entries);

    renderTimetable(visiblePeriods, entries);
    updateNextClass(visiblePeriods, entries);

    if (!sch?.data?.timetable) {
      if (!silent) showToast("لا يوجد جدول منشور لهذه الشعبة في هذا الترم.");
    }
  }

  if (ttRefresh) {
    ttRefresh.addEventListener("click", () => {
      loadAndRenderStudentTimetable({ silent: false }).catch((e) => {
        console.error(e);
        showToast(e.message || "فشل تحميل الجدول");
      });
    });
  }

  loadAndRenderStudentTimetable({ silent: true }).catch((e) => console.error(e));

  // =========================
  // ✅ Exams (NEW + Robust)
   // =========================
  // Exams (REAL from DB via student portal) ✅
  // =========================
  const exTypeSel = $("#ex-type");
  const exMonthWrap = $("#ex-month-wrap");
  const exMonthSel = $("#ex-month");
  const exSubjectSel = $("#ex-subject");
  const exFilterBtn = $("#ex-filter");
  const exBody = $("#ex-table-body");
  const exNextSmall = $("#ex-next-small"); // اختياري لو موجود بالواجهة

  let exMeta = null;

  function monthNameById(id) {
    const m = (exMeta?.months || []).find((x) => String(x.id) === String(id));
    return m?.name || String(id || "");
  }

  function examTypeName(t, month) {
    const tt = String(t || "");
    if (tt === "monthly") return `شهري${month ? " - " + monthNameById(month) : ""}`;
    if (tt === "midyear") return "نصف العام";
    if (tt === "final") return "آخر العام";
    return tt || "—";
  }

  function syncExamMonthUI() {
    const t = String(exTypeSel?.value || "");
    if (exMonthWrap) exMonthWrap.style.display = t === "monthly" ? "" : "none";
    if (t !== "monthly" && exMonthSel) exMonthSel.value = "";
  }

  async function loadExamMetaOnce() {
    if (exMeta) return exMeta;

    const r = await apiGet("/student/exams/meta");
    exMeta = r?.data || r || {};

    // months
    if (exMonthSel) {
      const months = Array.isArray(exMeta.months) ? exMeta.months : [];
      exMonthSel.innerHTML = `<option value="">كل الأشهر</option>`;
      months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = String(m.id);
        opt.textContent = m.name;
        exMonthSel.appendChild(opt);
      });

      // لو ما رجّع أشهر، نخفي حقل الشهر (حتى لا يربك المستخدم)
      if (exMonthWrap) exMonthWrap.style.display = months.length ? "" : "none";
    }

    // subjects
    if (exSubjectSel) {
      const subs = Array.isArray(exMeta.subjects) ? exMeta.subjects : [];
      exSubjectSel.innerHTML = `<option value="">كل المواد</option>`;
      subs.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(s.id);
        opt.textContent = s.name;
        exSubjectSel.appendChild(opt);
      });
    }

    syncExamMonthUI();
    return exMeta;
  }

  function fmtDate(d) {
  if (!d) return "—";
  // يعالج ISO مثل 2025-12-31T21:00:00.000Z ويعرض تاريخ محلي مرتب
  try {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  } catch {}
  // fallback
  return String(d).slice(0, 10) || "—";
}

const AR_DAYS = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
function arabicDayFromDate(d) {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) return AR_DAYS[dt.getDay()] || "—";
  } catch {}
  return "—";
}

function renderExams(rows) {
  if (!exBody) return;

  const list = Array.isArray(rows) ? rows : [];

  if (!list.length) {
    exBody.innerHTML = `
      <tr><td colspan="7" style="text-align:center; opacity:.8; padding:14px;">
        لا يوجد أي جداول امتحانات منشورة لهذه الشعبة/الصف.
      </td></tr>
    `;
    return;
  }

  exBody.innerHTML = list.map((x) => {
    const rawDate = x.exam_date || x.date || "—";
    const date = fmtDate(rawDate);
    const day = arabicDayFromDate(rawDate);

    const subject = x.subject_name || x.subjectName || "—";
    const type = examTypeName(x.exam_type || x.examType, x.month);

    const st = String(x.start_time || x.startTime || "—").slice(0, 5);
    const en = String(x.end_time || x.endTime || "—").slice(0, 5);
    const time = `${st} - ${en}`;

    const room = (x.room ?? "—");
    const notesBase = String(x.notes || "").trim();
    const apply =
      (x.scope === "grade" && x.apply_to_section_id)
        ? ` (شعبة: ${x.apply_to_section_name || x.apply_to_section_id})`
        : "";
    const notes = (notesBase ? notesBase : "—") + apply;

    return `
      <tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(day)}</td>
        <td>${escapeHtml(subject)}</td>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(time)}</td>
        <td>${escapeHtml(room)}</td>
        <td>${escapeHtml(notes)}</td>
      </tr>
    `;
  }).join("");
}


  async function loadStudentExams({ silent = false } = {}) {
    try {
      await loadExamMetaOnce();

      const qs = new URLSearchParams();
      const t = String(exTypeSel?.value || "");
      const m = String(exMonthSel?.value || "");
      const s = String(exSubjectSel?.value || "");

      if (t) qs.set("examType", t);
      if (t === "monthly" && m) qs.set("month", m);
      if (s) qs.set("subjectId", s);

      const r = await apiGet("/student/exams" + (qs.toString() ? "?" + qs.toString() : ""));

      // يدعم أكثر من شكل للاستجابة
      const rows =
        r?.data?.exams ||
        r?.data?.rows ||
        r?.data ||
        r?.exams ||
        [];

      renderExams(rows);
    } catch (e) {
      console.error(e);
      if (!silent) showToast(e.message || "فشل تحميل الامتحانات");

      if (exBody) {
        exBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:14px;">تعذر تحميل الامتحانات</td></tr>`;
      }
      if (exNextSmall) exNextSmall.textContent = "تعذر تحميل الامتحانات.";
    }
  }

  exTypeSel?.addEventListener("change", () => {
    syncExamMonthUI();
  });

  exFilterBtn?.addEventListener("click", () => {
    loadStudentExams({ silent: false });
  });


  // =========================
  // Notifications + Account buttons
  // =========================
  $("#notifications-btn")?.addEventListener("click", () => openModal("modal-inbox"));

  $("#open-profile-modal")?.addEventListener("click", () => openModal("profile-modal"));
  $("#open-change-password-modal")?.addEventListener("click", () => openModal("change-password-modal"));
  $("#open-change-email-modal")?.addEventListener("click", () => openModal("change-email-modal"));
  $("#open-change-avatar-modal")?.addEventListener("click", () => openModal("change-avatar-modal"));

  $("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    showToast("تم تسجيل الخروج");
  });
})();
