/* ===========================
   /frontend/admin/js/adminTeacherAttendance.js
   Admin - Teacher Attendance
   - Auto focus on scan input
   - Camera scan with fallback (BarcodeDetector OR ZXing)
   - No need for admin api.js
=========================== */
(function () {
  "use strict";
  if (window.__ADMIN_TEACHER_ATTENDANCE_LOADED__) return;

  const $ = (id) => document.getElementById(id);

  /* =========================
     API (بدون api.js)
     - Live Server 5501/5500 => backend 5000
     - مهم: credentials OMIT لتجنب CORS (لأننا نعتمد على Authorization token)
  ========================= */
/* =========================
   API
   يعتمد على frontend/shared/config.js
========================= */
const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const getToken = () =>
  localStorage.getItem("token") ||
  localStorage.getItem("access_token") ||
  localStorage.getItem("accessToken") ||
  localStorage.getItem("jwt") ||
  localStorage.getItem("auth_token") ||
  "";

const buildUrl = (path) => {
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
};

  const apiFetch = async (path, opts = {}) => {
    const url = buildUrl(path);
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };

    const tok = getToken();
    if (tok && !headers.Authorization) headers.Authorization = `Bearer ${tok}`;

    const res = await fetch(url, {
      // ✅ تجنب CORS مشكلة allow-credentials
      credentials: "omit",
      mode: "cors",
      ...opts,
      headers,
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        data?.message ||
        data?.error ||
        (text ? text.slice(0, 200) : "") ||
        `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  };

  /* =========================
     ENDPOINTS (بدون /api)
  ========================= */
  const ENDPOINTS = {
    daySummary: "/admin/teacher-attendance/day", // GET ?date=YYYY-MM-DD
    openDay: "/admin/teacher-attendance/day/open", // POST {date}
    lockDay: (dayId) => `/admin/teacher-attendance/day/${dayId}/lock`,
    unlockDay: (dayId) => `/admin/teacher-attendance/day/${dayId}/unlock`,
    scan: "/admin/teacher-attendance/scan", // POST {date, code}
    entryCreate: "/admin/teacher-attendance/entries",
    entryUpdate: (entryId) => `/admin/teacher-attendance/entries/${entryId}`,
    pendingPermitsCount: "/admin/teacher-permits",
  };

  /* =========================
     Helpers
  ========================= */
  const toast = (msg, type) => {
    if (typeof window.showToast === "function") return window.showToast(msg, type);
    if (typeof window.toast === "function") return window.toast(msg, type);
    console.log(`[${type || "info"}] ${msg}`);
  };

  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isISODate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  const pad2 = (n) => String(n).padStart(2, "0");

  const fmtTime = (v) => {
    if (!v) return "—";
    const s = String(v);
    if (s.includes("T")) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      return s;
    }
    if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
    return s;
  };

  // ✅ نفس الطالب: نطبّع الكود بقوة (يشيل المسافات والرموز مثل - _)
  const normalizeCode = (s) =>
    String(s || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9]+/g, "");

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /* =========================
     Boot (استنى السكشن لو ينضاف لاحقاً)
  ========================= */
  function bootWhenReady() {
    const elDate = $("ta-date");
    const elBody = $("ta-teachers-body");
    const elScanInput = $("ta-scan-input");
    if (!elDate || !elBody || !elScanInput) return false;

    window.__ADMIN_TEACHER_ATTENDANCE_LOADED__ = true;

    /* DOM */
    const elDateView = $("ta-date-view");
    const elOpenDay = $("ta-open-day");
    const elLockToggle = $("ta-lock-toggle");
    const elDayState = $("ta-day-state");
    const elRefresh = $("ta-refresh");

    const elScanSubmit = $("ta-scan-submit");
    const elScanFocus = $("ta-scan-focus");
    const elScanCamera = $("ta-scan-camera");
    const elScanImageBtn = $("ta-scan-image");
const elImageFile = $("ta-image-file");

    const elLastResult = $("ta-last-result");

    const elSearch = $("ta-search");
    const elFilter = $("ta-filter");
    const elPendingPermits = $("ta-pending-permits");

    /* State */
    const state = {
      date: isISODate(elDate.value) ? elDate.value : isoToday(),
      dayId: null,
      isLocked: false,
      dayExists: false,
      rawTeachers: [],
      viewTeachers: [],
    };

    /* Focus helpers */
    function ensureScanFocus(force) {
      if (!elScanInput) return;
      if (force || document.activeElement !== elScanInput) {
        try {
          elScanInput.focus({ preventScroll: true });
        } catch {
          elScanInput.focus();
        }
      }
    }

    /* UI helpers */
    function setLastResult(text, kind) {
      if (!elLastResult) return;
      elLastResult.classList.remove("is-ok", "is-bad");
      if (kind === "ok") elLastResult.classList.add("is-ok");
      if (kind === "bad") elLastResult.classList.add("is-bad");
      elLastResult.textContent = text || "—";
    }

    function setDayStateUI() {
      if (!state.dayExists) {
        if (elDayState) elDayState.textContent = "غير مفتوح";
        if (elLockToggle) {
          elLockToggle.disabled = true;
          elLockToggle.innerHTML = `<i class="ri-lock-2-line"></i><span>قفل / فتح</span>`;
        }
        return;
      }

      if (elDayState) elDayState.textContent = state.isLocked ? "مقفول" : "مفتوح";
      if (elLockToggle) {
        elLockToggle.disabled = false;
        elLockToggle.innerHTML = state.isLocked
          ? `<i class="ri-lock-unlock-line"></i><span>فتح القفل</span>`
          : `<i class="ri-lock-2-line"></i><span>قفل اليوم</span>`;
      }
    }

    function statusBadge(status) {
      const s = String(status || "").toLowerCase();
      if (s === "present") return { cls: "ta-status is-present", icon: "ri-check-line", text: "حاضر" };
      if (s === "absent") return { cls: "ta-status is-absent", icon: "ri-close-line", text: "غائب" };
      if (s === "late") return { cls: "ta-status", icon: "ri-time-line", text: "متأخر" };
      if (s === "excused") return { cls: "ta-status", icon: "ri-shield-check-line", text: "بعذر" };
      if (!s) return { cls: "ta-status", icon: "ri-question-line", text: "غير مسجل" };
      return { cls: "ta-status", icon: "ri-question-line", text: s };
    }

    function methodLabel(m) {
      const s = String(m || "").toLowerCase();
      if (s === "scan" || s === "scanner") return "Scan";
      if (s === "manual") return "Manual";
      return s ? s : "—";
    }

    function canEdit() {
      return state.dayExists && !state.isLocked;
    }

    /* =========================
       Render
    ========================= */
    function renderTable() {
      elBody.innerHTML = "";
      const items = state.viewTeachers;

      if (!items || items.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td colspan="7" style="padding:12px; color: var(--text-muted); font-weight:800;">` +
          `لا يوجد معلمين لديهم حصص في هذا اليوم.</td>`;
        elBody.appendChild(tr);
        return;
      }

      for (const t of items) {
        const teacherId = t.teacher_id ?? t.teacherId ?? t.id;
        const name = t.full_name ?? t.fullName ?? t.name ?? "—";
        const isActive = t.is_active ?? t.isActive ?? true;

        const entryId = t.entry_id ?? t.entryId ?? null;
        const status = (t.status || "").toLowerCase();
        const method = t.method || "";
        const recordedAt = t.recorded_at || t.recordedAt || t.updated_at || t.updatedAt || null;

        const todayLessons = Number(t.today_lessons ?? t.todayLessons ?? 0) || 0;
        const taught = Number(t.taught_count ?? t.taughtCount ?? 0) || 0;
        const missed = Number(t.missed_count ?? t.missedCount ?? 0) || 0;
        const excused = Number(t.excused_count ?? t.excusedCount ?? 0) || 0;

        const badge = statusBadge(status);
        const editDisabled = canEdit() ? "" : "disabled";

        const tr = document.createElement("tr");
        tr.dataset.teacherId = String(teacherId);

        tr.innerHTML = `
          <td data-label="المعلم">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span style="font-weight:900;">${esc(name)}</span>
              <span style="font-size:12px; color: var(--text-muted); font-weight:800;">
                ${isActive ? "نشط" : "غير نشط"}
                <span style="margin-inline:8px;">•</span>
                #${esc(teacherId)}
              </span>
            </div>
          </td>

          <td data-label="حالة اليوم">
            <span class="${esc(badge.cls)}"><i class="${esc(badge.icon)}"></i> ${esc(badge.text)}</span>
          </td>

          <td data-label="الطريقة">
            <span style="font-weight:900;">${esc(methodLabel(method))}</span>
          </td>

          <td data-label="وقت التسجيل">
            <span style="font-weight:900; direction:ltr;">${esc(fmtTime(recordedAt))}</span>
          </td>

          <td data-label="حصص اليوم">
            <span style="font-weight:900;">${todayLessons}</span>
          </td>

          <td data-label="نفّذ/غاب/بعذر">
            <span style="font-weight:900; direction:ltr;">${taught}/${missed}/${excused}</span>
          </td>

          <td data-label="إجراءات">
            <div class="ta-actions">
              <button type="button" class="ta-btn ta-btn--primary" data-action="mark-present" ${editDisabled}
                style="padding:8px 10px; border-radius:12px;">
                <i class="ri-check-line"></i><span>حاضر</span>
              </button>
              <button type="button" class="ta-btn ta-btn--danger" data-action="mark-absent" ${editDisabled}
                style="padding:8px 10px; border-radius:12px;">
                <i class="ri-close-line"></i><span>غائب</span>
              </button>
              <button type="button" class="ta-btn" data-action="toggle-details"
                style="padding:8px 10px; border-radius:12px;">
                <i class="ri-information-line"></i><span>تفاصيل</span>
              </button>
            </div>
          </td>
        `;
        elBody.appendChild(tr);

        const tr2 = document.createElement("tr");
        tr2.dataset.teacherId = String(teacherId);
        tr2.dataset.detailRow = "1";
        tr2.style.display = "none";
        tr2.innerHTML = `
          <td colspan="7" style="padding: 10px 12px;">
            <div class="ta-panel" style="box-shadow:none; padding:12px; border-radius: var(--radius-lg); background: var(--bg-panel-soft);">
              <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <strong style="color:var(--text-main);">${esc(name)}</strong>
                  <span style="color:var(--text-muted); font-weight:800;">
                    حالة اليوم: <span style="color:var(--text-main); font-weight:900;">${esc(badge.text)}</span>
                    <span style="margin-inline:8px;">•</span>
                    طريقة: <span style="color:var(--text-main); font-weight:900;">${esc(methodLabel(method))}</span>
                    <span style="margin-inline:8px;">•</span>
                    وقت: <span style="direction:ltr; font-weight:900;">${esc(fmtTime(recordedAt))}</span>
                  </span>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <span class="ta-chip"><i class="ri-calendar-schedule-line"></i> حصص اليوم: <strong>${todayLessons}</strong></span>
                  <span class="ta-chip"><i class="ri-check-double-line"></i> نفّذ: <strong>${taught}</strong></span>
                  <span class="ta-chip"><i class="ri-close-circle-line"></i> غاب: <strong>${missed}</strong></span>
                  <span class="ta-chip"><i class="ri-shield-check-line"></i> بعذر: <strong>${excused}</strong></span>
                </div>
              </div>
              <div style="margin-top:10px; color:var(--text-muted); font-weight:800;">
                ${entryId ? `معرّف التحضير: <span style="direction:ltr; font-weight:900; color:var(--text-main);">#${esc(entryId)}</span>` : "لا يوجد Entry بعد"}
              </div>
            </div>
          </td>
        `;
        elBody.appendChild(tr2);
      }
    }

    function applyFilters() {
      const q = String(elSearch?.value || "").trim().toLowerCase();
      const f = String(elFilter?.value || "");

      let items = Array.isArray(state.rawTeachers) ? state.rawTeachers.slice() : [];

      // ✅ لا نعرض إلا من لديه حصص اليوم (أو تم تسجيله بالفعل)
      items = items.filter((t) => {
        const lessons = Number(t.today_lessons ?? t.todayLessons ?? 0) || 0;
        const hasEntry = !!(t.entry_id ?? t.entryId);
        return lessons > 0 || hasEntry;
      });

      if (q) {
        items = items.filter((t) =>
          String(t.full_name ?? t.fullName ?? t.name ?? "").toLowerCase().includes(q)
        );
      }

      if (f) {
        if (f === "unmarked") items = items.filter((t) => !String(t.status || "").trim());
        else items = items.filter((t) => String(t.status || "").toLowerCase() === f);
      }

      state.viewTeachers = items;
      renderTable();
    }

    /* =========================
       Data
    ========================= */
    function mapSummaryResponse(data) {
      const day = data?.day || null;
      state.dayExists = !!day;
      state.dayId = day?.id ?? null;
      state.isLocked = Boolean(day?.is_locked ?? false);

      let teachers = data?.teachers || data?.items || data?.rows || data?.data || [];
      if (!Array.isArray(teachers)) teachers = [];
      state.rawTeachers = teachers;

      const pending = data?.pending_permits ?? null;
      if (typeof pending === "number" && elPendingPermits) elPendingPermits.textContent = String(pending);
    }

    async function loadPendingPermitsCount() {
      if (!elPendingPermits) return;
      try {
        const data = await apiFetch(`${ENDPOINTS.pendingPermitsCount}?status=pending&count=1`);
        const count =
          data?.count ??
          data?.pending ??
          data?.total ??
          (Array.isArray(data?.items) ? data.items.length : Array.isArray(data) ? data.length : null);
        if (typeof count === "number") elPendingPermits.textContent = String(count);
      } catch {}
    }

    async function loadDay(date) {
      if (!isISODate(date)) date = isoToday();
      state.date = date;

      elDate.value = date;
      if (elDateView) elDateView.textContent = date;

      setLastResult("جارِ التحميل...", null);

      const data = await apiFetch(`${ENDPOINTS.daySummary}?date=${encodeURIComponent(date)}`);
      mapSummaryResponse(data);
      setDayStateUI();

      if (elPendingPermits && (elPendingPermits.textContent === "0" || elPendingPermits.textContent === "—")) {
        loadPendingPermitsCount();
      }

      applyFilters();
      setLastResult("— جاهز للمسح", null);

      // ✅ رجّع الفوكس بعد التحميل
      ensureScanFocus(true);
    }

    /* =========================
       Actions
    ========================= */
    async function openDay() {
      try {
        elOpenDay && (elOpenDay.disabled = true);
        await apiFetch(ENDPOINTS.openDay, {
          method: "POST",
          body: JSON.stringify({ date: state.date }),
        });
        toast("تم فتح اليوم ✅", "success");
        await loadDay(state.date);
      } catch (e) {
        toast(e?.message || "فشل فتح اليوم", "error");
        setLastResult(`❌ ${e?.message || "فشل فتح اليوم"}`, "bad");
      } finally {
        elOpenDay && (elOpenDay.disabled = false);
        ensureScanFocus(true);
      }
    }

    async function toggleLock() {
      if (!state.dayId) {
        toast("افتح اليوم أولاً", "warn");
        ensureScanFocus(true);
        return;
      }
      try {
        elLockToggle && (elLockToggle.disabled = true);
        if (state.isLocked) {
          await apiFetch(ENDPOINTS.unlockDay(state.dayId), { method: "PATCH" });
          toast("تم فتح القفل ✅", "success");
        } else {
          await apiFetch(ENDPOINTS.lockDay(state.dayId), { method: "PATCH" });
          toast("تم قفل اليوم ✅", "success");
        }
        await loadDay(state.date);
      } catch (e) {
        toast(e?.message || "فشل تغيير حالة القفل", "error");
        setLastResult(`❌ ${e?.message || "فشل تغيير القفل"}`, "bad");
      } finally {
        elLockToggle && (elLockToggle.disabled = false);
        ensureScanFocus(true);
      }
    }

    function findTeacherRowData(teacherId) {
      return state.rawTeachers.find((x) => String(x.teacher_id ?? x.teacherId ?? x.id) === String(teacherId)) || null;
    }

    async function markTeacher(teacherId, newStatus) {
      if (!canEdit()) {
        toast(state.dayExists ? "اليوم مقفول — لا يمكن التعديل" : "افتح اليوم أولاً", "warn");
        ensureScanFocus(true);
        return;
      }

      const t = findTeacherRowData(teacherId);
      const entryId = t?.entry_id ?? t?.entryId ?? null;

      try {
        setLastResult(`جارِ تسجيل ${newStatus === "present" ? "حاضر" : "غائب"}...`, null);

        if (entryId) {
          await apiFetch(ENDPOINTS.entryUpdate(entryId), {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus, method: "manual" }),
          });
        } else {
          await apiFetch(ENDPOINTS.entryCreate, {
            method: "POST",
            body: JSON.stringify({
              date: state.date,
              teacher_id: Number(teacherId),
              status: newStatus,
              method: "manual",
            }),
          });
        }

        setLastResult(`✅ تم تسجيل ${newStatus === "present" ? "حاضر" : "غائب"} (يدويًا)`, "ok");
        await loadDay(state.date);
      } catch (e) {
        setLastResult(`❌ فشل التسجيل: ${e?.message || "خطأ"}`, "bad");
        toast(e?.message || "فشل التسجيل", "error");
      } finally {
        ensureScanFocus(true);
      }
    }

function pickTeacherCode(rawCode) {
  const s = String(rawCode || "").trim();
  if (!s) return "";

  // لو ZXing/BarcodeDetector رجّع نص فيه زيادة، نلتقط التوكن نفسه
  const mTT = s.match(/TT-[A-Za-z0-9_-]+/);
  if (mTT) return mTT[0]; // نخليه كما هو (Case + _ + -)

  const mT = s.match(/T-\d+/i);
  if (mT) return mT[0].toUpperCase(); // ID ثابت ما يضر

  // fallback: لا تطبّع بقوة، فقط trim
  return s;
}

async function submitScanWithCode(rawCode) {
  const code = pickTeacherCode(rawCode);
  if (!code) return toast("الكود فارغ", "warn");

  if (!isISODate(state.date)) state.date = isoToday();

  try {
    elScanSubmit && (elScanSubmit.disabled = true);
    setLastResult("جارِ معالجة المسح...", null);

    const data = await apiFetch(ENDPOINTS.scan, {
      method: "POST",
      body: JSON.stringify({ date: state.date, code }), // ✅ نرسل الخام
    });

    const name =
      data?.teacher?.full_name ||
      data?.teacher?.fullName ||
      data?.full_name ||
      data?.fullName ||
      data?.name ||
      "المعلم";

    const st = data?.status || data?.entry?.status || "present";

    setLastResult(`✅ تم تسجيل ${esc(name)} — ${st === "absent" ? "غائب" : "حاضر"} (Scan)`, "ok");
    elScanInput.value = "";
    await loadDay(state.date);
  } catch (e) {
    const msg = e?.message || "فشل المسح";
    setLastResult(`❌ فشل المسح: ${msg}`, "bad");
    toast(msg, "error");
  } finally {
    elScanSubmit && (elScanSubmit.disabled = false);
    ensureScanFocus(true);
  }
}


    async function submitScan() {
      const raw = elScanInput?.value || "";
      if (!raw.trim()) return toast("أدخل/امسح كود أولاً", "warn");
      return submitScanWithCode(raw);
    }

    function toggleDetails(teacherId) {
      const rows = elBody.querySelectorAll(`tr[data-teacher-id="${CSS.escape(String(teacherId))}"]`);
      if (!rows || rows.length < 2) return;
      const detail = Array.from(rows).find((r) => r.dataset.detailRow === "1");
      if (!detail) return;
      detail.style.display = detail.style.display === "none" ? "" : "none";
    }

    /* =========================
       Camera Scan (Modal + BarcodeDetector OR ZXing fallback)
    ========================= */
    const cam = {
      open: false,
      stream: null,
      stopZXing: null,
    };

    function ensureCamModal() {
      let modal = document.getElementById("ta-cam-modal");
      if (modal) return modal;

      modal = document.createElement("div");
      modal.id = "ta-cam-modal";
      modal.style.cssText =
        "position:fixed;inset:0;z-index:9999;display:none;background:rgba(0,0,0,.55);backdrop-filter:blur(8px);";
      modal.innerHTML = `
        <div style="position:absolute;inset:24px;max-width:860px;margin:auto;background:rgba(10,18,35,.92);border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.10);">
            <div style="display:flex;gap:10px;align-items:center;">
              <i class="ri-camera-line" style="font-size:18px;"></i>
              <strong>مسح بالكاميرا</strong>
              <span style="opacity:.75;font-size:12px;">وجّه الكود داخل الإطار</span>
            </div>
            <button id="ta-cam-close" type="button" class="ta-btn" style="border-radius:12px;padding:8px 10px;">
              <i class="ri-close-line"></i><span>إغلاق</span>
            </button>
          </div>

          <div style="position:relative;flex:1;min-height:320px;display:grid;place-items:center;padding:14px;">
            <video id="ta-cam-video" autoplay playsinline muted
              style="width:100%;height:100%;max-height:560px;object-fit:cover;border-radius:16px;border:1px solid rgba(255,255,255,.12);"></video>

            <div style="position:absolute;inset:40px;border:2px dashed rgba(255,255,255,.22);border-radius:18px;pointer-events:none;"></div>

            <div id="ta-cam-hint"
              style="position:absolute;left:14px;right:14px;bottom:14px;padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);font-weight:800;">
              جاهز…
            </div>
          </div>

          <div style="padding:12px 14px;border-top:1px solid rgba(255,255,255,.10);display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
            <small style="opacity:.8">يدعم QR و Barcode (CODE128). إذا لم يعمل على جهازك، ثبّت Chrome حديث أو فعّل إذن الكاميرا للموقع.</small>
            <button id="ta-cam-flip" type="button" class="ta-btn" style="border-radius:12px;padding:8px 10px;">
              <i class="ri-refresh-line"></i><span>إعادة تشغيل</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      return modal;
    }

    function setCamHint(msg, ok) {
      const hint = document.getElementById("ta-cam-hint");
      if (!hint) return;
      hint.textContent = msg || "—";
      hint.style.borderColor = ok ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)";
    }

    async function stopCamera() {
      cam.open = false;

      try {
        if (typeof cam.stopZXing === "function") cam.stopZXing();
      } catch {}
      cam.stopZXing = null;

      if (cam.stream) {
        try {
          cam.stream.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      cam.stream = null;

      const modal = document.getElementById("ta-cam-modal");
      if (modal) modal.style.display = "none";
      ensureScanFocus(true);
    }

    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-src="${src}"]`);
        if (existing) return resolve(true);

        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.dataset.src = src;
        s.onload = () => resolve(true);
        s.onerror = () => reject(new Error("Failed to load script"));
        document.head.appendChild(s);
      });
    }

    async function startZXing(videoEl) {
      // ✅ تحميل ZXing UMD (Fallback)
      if (!window.ZXing) {
        await loadScriptOnce("https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js");
      }
      if (!window.ZXing) throw new Error("ZXing not available");

      const ZX = window.ZXing;
      const codeReader = new ZX.BrowserMultiFormatReader();

      // decode continuously
      cam.stopZXing = () => {
        try {
          codeReader.reset();
        } catch {}
      };

      setCamHint("جارِ المسح…", true);

      codeReader.decodeFromVideoElementContinuously(videoEl, (result, err) => {
        if (!cam.open) return;
        if (result && result.getText) {
          const text = result.getText();
          if (text) {
            setCamHint("✅ تم التقاط الكود", true);
            stopCamera();
            submitScanWithCode(text);
          }
        }
      });
    }

    async function startBarcodeDetector(videoEl) {
      const formats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"];
      const detector = new window.BarcodeDetector({ formats });

      setCamHint("جارِ المسح…", true);

      const tick = async () => {
        if (!cam.open) return;
        try {
          if (videoEl.readyState >= 2) {
            const codes = await detector.detect(videoEl);
            if (codes && codes.length) {
              const raw = codes[0]?.rawValue;
              if (raw) {
                setCamHint("✅ تم التقاط الكود", true);
                stopCamera();
                submitScanWithCode(raw);
                return;
              }
            }
          }
        } catch {}
        requestAnimationFrame(tick);
      };
      tick();
    }

    async function openCamera() {
      const modal = ensureCamModal();
      const videoEl = document.getElementById("ta-cam-video");
      const closeBtn = document.getElementById("ta-cam-close");
      const flipBtn = document.getElementById("ta-cam-flip");

      modal.style.display = "block";
      cam.open = true;

      closeBtn.onclick = stopCamera;
      flipBtn.onclick = async () => {
        await stopCamera();
        setTimeout(openCamera, 250);
      };

      setCamHint("اطلب إذن الكاميرا…", true);

      // ✅ لازم سياق آمن: localhost/127.0.0.1 OK
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCamHint("❌ جهازك لا يدعم getUserMedia", false);
        return;
      }

      try {
        cam.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        videoEl.srcObject = cam.stream;

        // انتظر الفيديو يشتغل
        await new Promise((r) => setTimeout(r, 300));

        // ✅ إذا BarcodeDetector غير موجود… fallback ZXing
        if (window.BarcodeDetector) {
          await startBarcodeDetector(videoEl);
        } else {
          await startZXing(videoEl);
        }
      } catch (e) {
        setCamHint("❌ فشل فتح الكاميرا: تأكد من السماح للموقع", false);
        toast(e?.message || "Camera error", "error");
      }
    }

    /* =========================
       Events
    ========================= */
    function wireEvents() {
      elDate.addEventListener("change", () => loadDay(elDate.value));

      elOpenDay && elOpenDay.addEventListener("click", openDay);
      elLockToggle && elLockToggle.addEventListener("click", toggleLock);
      elRefresh && elRefresh.addEventListener("click", () => loadDay(state.date));

      elSearch && elSearch.addEventListener("input", applyFilters);
      elFilter && elFilter.addEventListener("change", applyFilters);

      // ✅ زر تركيز
      elScanFocus && elScanFocus.addEventListener("click", () => ensureScanFocus(true));

      // ✅ Enter = Scan
      elScanInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitScan();
        }
      });
// زر رفع صورة
elScanImageBtn && elScanImageBtn.addEventListener("click", () => {
  elImageFile && elImageFile.click();
});

elImageFile && elImageFile.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) scanImageFile(file);
});

      // ✅ زر تسجيل
      elScanSubmit && elScanSubmit.addEventListener("click", submitScan);

      // ✅ زر كاميرا
      elScanCamera && elScanCamera.addEventListener("click", openCamera);

      // table actions
      elBody.addEventListener("click", (e) => {
        const btn = e.target?.closest("button[data-action]");
        if (!btn) return;
        const tr = btn.closest("tr");
        const teacherId = tr?.dataset?.teacherId;
        if (!teacherId) return;

        const action = btn.dataset.action;
        if (action === "mark-present") return markTeacher(teacherId, "present");
        if (action === "mark-absent") return markTeacher(teacherId, "absent");
        if (action === "toggle-details") return toggleDetails(teacherId);
      });

      // ✅ فوكس تلقائي دائم (بدون إزعاج أثناء المودال)
      document.addEventListener(
        "click",
        (e) => {
          const inModal = e.target && e.target.closest && e.target.closest("#ta-cam-modal");
          if (!inModal) ensureScanFocus(false);
        },
        true
      );
      window.addEventListener("focus", () => ensureScanFocus(false));
    }
async function scanImageFile(file) {
  try {
    setLastResult("جارِ قراءة الصورة...", null);

    // تحميل ZXing إذا لم يكن موجود
    if (!window.ZXing) {
      await loadScriptOnce("https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js");
    }

    const ZX = window.ZXing;
    const reader = new ZX.BrowserMultiFormatReader();

    // نحول الملف إلى صورة مؤقتة
    const img = new Image();
    img.src = URL.createObjectURL(file);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    // قراءة الكود من الصورة
    const result = await reader.decodeFromImageElement(img);

    if (!result || !result.getText()) {
      throw new Error("لم يتم العثور على كود داخل الصورة");
    }

    const text = result.getText();

    setLastResult("✅ تم قراءة الكود من الصورة", "ok");

    // نرسل الكود للنظام نفسه
    submitScanWithCode(text);

  } catch (err) {
    console.error(err);
    setLastResult("❌ فشل قراءة الصورة", "bad");
    toast("الصورة لا تحتوي QR/Barcode واضح", "error");
  }
}

    /* =========================
       Init
    ========================= */
    (async function init() {
      state.date = isISODate(elDate.value) ? elDate.value : isoToday();
      elDate.value = state.date;
      if (elDateView) elDateView.textContent = state.date;

      wireEvents();

      // ✅ فوكس فورًا
      ensureScanFocus(true);

      try {
        await loadDay(state.date);
      } catch (e) {
        setLastResult(`❌ تعذر التحميل: ${e?.message || "خطأ"}`, "bad");
        toast(e?.message || "تعذر تحميل اليوم", "error");
        ensureScanFocus(true);
      }
    })();

    return true;
  }

  // حاول الآن
  if (bootWhenReady()) return;

  // لو عناصر السكشن تنضاف لاحقاً
  const obs = new MutationObserver(() => {
    if (bootWhenReady()) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
