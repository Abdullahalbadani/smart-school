// js/features/teacherPermits.js
(function () {
  "use strict";
  if (window.__TEACHER_PERMITS_LOADED__) return;
  window.__TEACHER_PERMITS_LOADED__ = true;

  /* =========================
     Safe helpers
  ========================= */
  const $ = (id) => document.getElementById(id);
  const nowISO = () => new Date().toISOString().slice(0, 10);

  const toast = (msg, type) => {
    if (typeof window.showToast === "function") return window.showToast(msg, type);
    if (typeof window.toast === "function") return window.toast(msg, type);
    console.warn(msg);
  };

  /* =========================
     API wrapper (يمنع /api/api + يدعم LiveServer)
  ========================= */
  const coreApiFetch = typeof window.apiFetch === "function" ? window.apiFetch : null;

  const BACKEND_ORIGIN =
    window.__BACKEND_ORIGIN__ ||
    localStorage.getItem("BACKEND_ORIGIN") ||
    (location.port === "5501" ? window.location.origin : location.origin);

  const buildUrl = (path) => {
    let p = String(path || "");
    if (!p.startsWith("/")) p = "/" + p;
    if (p.startsWith("/api/")) p = p.slice(4);
    if (coreApiFetch) return p;
    return BACKEND_ORIGIN.replace(/\/+$/, "") + "/api" + p;
  };

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken") ||
    localStorage.getItem("jwt") ||
    "";

  const apiFetch = async (path, opts = {}) => {
    if (coreApiFetch) return coreApiFetch(buildUrl(path), opts);

    const url = buildUrl(path);
    const headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };
    const tok = getToken();
    if (tok && !headers.Authorization) headers.Authorization = `Bearer ${tok}`;

    const res = await fetch(url, { credentials: "include", headers, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || "Request failed");
    return data;
  };

  const normalize = (v) =>
    String(v || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();

  const statusBadge = (status) => {
    const map = {
      pending: { text: "معلّق", cls: "badge badge-warn" },
      approved: { text: "مقبول", cls: "badge badge-ok" },
      rejected: { text: "مرفوض", cls: "badge badge-danger" },
    };
    return map[status] || { text: status || "—", cls: "badge" };
  };

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  /* =========================
     DOM references
  ========================= */
  const tcardStatus = $("tcard-status");
  const tcardCode = $("tcard-code");
  const tcardVisual = $("tcard-visual");
  const tcardCopy = $("tcard-copy");

  const tpCardInline = $("tp-card-inline");
  const tpCardCopyInline = $("tp-card-copy-inline");

  const tpDate = $("tp-date");
  const tpScope = $("tp-scope");
  const tpSlotsWrap = $("tp-slots-wrap");
  const tpSlots = $("tp-slots");
  const tpSlotsEmpty = $("tp-slots-empty");
  const tpLoadSlots = $("tp-load-slots");
  const tpSelectAll = $("tp-select-all");
  const tpClearAll = $("tp-clear-all");
  const tpReason = $("tp-reason");
  const tpNotes = $("tp-notes");
  const tpSubmit = $("tp-submit");
  const tpRefresh = $("tp-refresh");
  const tpSummary = $("tp-summary");
  const tpList = $("tp-list");
  const tpEmpty = $("tp-empty");
  const tpMiniStatus = $("tp-mini-status");

  if (!tpDate && !tcardCode) return;

  /* =========================
     State
  ========================= */
  let __teacherCard = null;        // بيانات ثابتة
  let __teacherToken = null;       // token متغير
  let __tokenTimer = null;
  const __slotsCache = new Map();

  /* =========================
     Card rendering
  ========================= */
  function renderTeacherCard(code, noteText) {
    if (!tcardVisual) return;

    if (!code) {
      tcardVisual.innerHTML = `<div class="empty-state" style="padding:10px;">لا يوجد كود</div>`;
      return;
    }

    tcardVisual.innerHTML = `
      <div style="display:grid;gap:.8rem;justify-items:center;width:100%;padding:.2rem;">
        <div id="tcard-qr" style="background:#fff;padding:10px;border-radius:14px;"></div>
        <div style="width:100%;background:#fff;border-radius:14px;padding:10px;display:flex;align-items:center;justify-content:center;">
          <svg id="tcard-barcode" style="width:100%;max-width:520px;"></svg>
        </div>
        <div style="font-weight:800; direction:ltr; user-select:all;">${esc(code)}</div>
        <small style="opacity:.75;">${esc(noteText || "QR + Barcode (CODE128)")}</small>
      </div>
    `;

    // QR
    try {
      if (window.QRCode) {
        const el = document.getElementById("tcard-qr");
        if (el) {
          el.innerHTML = "";
          new window.QRCode(el, {
            text: code,
            width: 220,
            height: 220,
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : undefined,
          });
        }
      }
    } catch {}

    // Barcode
    try {
      if (window.JsBarcode) {
        window.JsBarcode("#tcard-barcode", code, {
          format: "CODE128",
          displayValue: false,
          height: 70,
          margin: 0,
        });
      }
    } catch {}
  }

  async function loadTeacherCardStatic() {
    const data = await apiFetch("/teacher/me/card");
    __teacherCard = data;
    return data;
  }

  async function refreshTeacherToken() {
    // token مؤقت مثل الطالب
    const data = await apiFetch("/teacher/me/token");
    __teacherToken = data;

    const token = data?.token || "";
    const validFor = Number(data?.valid_for_seconds || 60);
    const refreshAfter = Number(data?.refresh_after_seconds || 55);

    // عرض الكود في أماكن النص (نخليها token لأنه هو اللي ينمسح)
    if (tcardCode) tcardCode.textContent = token || "—";
    if (tpCardInline) tpCardInline.textContent = token || "—";

    if (tcardStatus) {
      tcardStatus.innerHTML = `<i class="ri-shield-check-line"></i> رمز آمن يتغير تلقائيًا — صالح لمدة ${validFor} ثانية`;
    }

    renderTeacherCard(token, `هذا الرمز يتحدث تلقائيًا — صالح ${validFor} ثانية`);

    // جدولة التحديث
    if (__tokenTimer) clearTimeout(__tokenTimer);
    __tokenTimer = setTimeout(() => {
      refreshTeacherToken().catch(() => {});
    }, Math.max(20, refreshAfter) * 1000);
  }

  async function loadTeacherCard() {
    try {
      await loadTeacherCardStatic(); // لو احتجتها لاحقًا
      await refreshTeacherToken();   // الأهم: token
    } catch (e) {
      const msg = e?.message || "تعذر تحميل بطاقة التحضير";
      if (tcardStatus) tcardStatus.innerHTML = `<i class="ri-error-warning-line"></i> ${esc(msg)}`;
      if (tcardCode) tcardCode.textContent = "—";
      if (tpCardInline) tpCardInline.textContent = "—";
      if (tcardVisual) tcardVisual.innerHTML = `<div class="empty-state" style="padding:10px;">تعذر تحميل البطاقة</div>`;
    }
  }

  async function copyCardCode() {
    const token = normalize(__teacherToken?.token || "");
    const fallback = normalize(__teacherCard?.card_uid || __teacherCard?.cardUid || "");
    const code = token || fallback;
    if (!code) return toast("لا يوجد كود لنسخه", "warn");

    try {
      await navigator.clipboard.writeText(code);
      toast("تم نسخ الرمز ✅", "success");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("تم نسخ الرمز ✅", "success");
    }
  }

  /* =========================
     Permits UI
  ========================= */
  function toggleSlotsUI() {
    if (!tpScope || !tpSlotsWrap) return;
    tpSlotsWrap.style.display = tpScope.value === "slots" ? "" : "none";
  }

  function renderSlots(date, slots) {
    if (!tpSlots) return;

    tpSlots.innerHTML = "";
    if (!Array.isArray(slots) || slots.length === 0) {
      if (tpSlotsEmpty) tpSlotsEmpty.style.display = "";
      return;
    }
    if (tpSlotsEmpty) tpSlotsEmpty.style.display = "none";

    for (const s of slots) {
      const id = s.timetable_entry_id ?? s.timetableEntryId ?? s.id;
      const label =
        s.label ||
        `${s.period_name ?? s.periodName ?? "حصة"} — ${s.subject_name ?? s.subjectName ?? ""} ${s.section_name ?? s.sectionName ?? ""}`.trim();

      const time =
        s.time ||
        [s.start_time ?? s.startTime, s.end_time ?? s.endTime].filter(Boolean).join(" → ");

      const row = document.createElement("label");
      row.className = "muted-box";
      row.style.margin = "0";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = ".5rem";
      row.innerHTML = `
        <input type="checkbox" class="tp-slot" value="${esc(id)}" />
        <div style="display:flex;flex-direction:column;gap:.15rem;">
          <strong>${esc(label)}</strong>
          <small style="opacity:.85; direction:ltr;">${esc(time || "")}</small>
        </div>
      `;
      tpSlots.appendChild(row);
    }
  }

  async function loadSlotsForDate(date) {
    const d = date || (tpDate ? tpDate.value : "") || nowISO();
    if (!d) return;

    if (__slotsCache.has(d)) {
      renderSlots(d, __slotsCache.get(d));
      return;
    }

    try {
      const data = await apiFetch(`/teacher/permits/available-slots?date=${encodeURIComponent(d)}`);
      const slots = Array.isArray(data?.slots) ? data.slots : Array.isArray(data) ? data : [];
      __slotsCache.set(d, slots);
      renderSlots(d, slots);
    } catch (e) {
      toast(e?.message || "تعذر تحميل حصص هذا اليوم", "error");
      renderSlots(d, []);
    }
  }

  function getSelectedSlotIds() {
    const nodes = document.querySelectorAll(".tp-slot:checked");
    return Array.from(nodes)
      .map((n) => Number(n.value))
      .filter((x) => Number.isFinite(x));
  }

  async function submitPermit() {
    const date = tpDate?.value || nowISO();
    const scope = tpScope?.value || "full_day";
    const reason_text = (tpReason?.value || "").trim();
    const notes = (tpNotes?.value || "").trim();

    if (!date) return toast("اختر التاريخ", "warn");

    let slots = [];
    if (scope === "slots") {
      slots = getSelectedSlotIds();
      if (slots.length === 0) return toast("اختر حصصًا على الأقل", "warn");
    }

    try {
      if (tpSubmit) tpSubmit.disabled = true;

      const payload = {
        request_date: date,
        scope,
        reason_text,
        notes,
        timetable_entry_ids: slots,
      };

      await apiFetch("/teacher/permits", { method: "POST", body: JSON.stringify(payload) });

      toast("تم إرسال/تحديث طلب الإذن ✅", "success");
      if (tpReason) tpReason.value = "";
      if (tpNotes) tpNotes.value = "";
      if (scope === "slots") document.querySelectorAll(".tp-slot").forEach((c) => (c.checked = false));
      await refreshPermits();
    } catch (e) {
      toast(e?.message || "فشل إرسال الطلب", "error");
    } finally {
      if (tpSubmit) tpSubmit.disabled = false;
    }
  }

  function renderPermits(items) {
    if (!tpList || !tpEmpty || !tpSummary) return;

    tpList.innerHTML = "";
    const arr = Array.isArray(items) ? items : [];

    if (arr.length === 0) {
      tpEmpty.style.display = "";
      tpSummary.textContent = "لا توجد طلبات.";
      if (tpMiniStatus) tpMiniStatus.textContent = "آخر حالة: —";
      return;
    }
    tpEmpty.style.display = "none";

    const last = arr[0];
    const b = statusBadge(last?.status);
    if (tpMiniStatus) tpMiniStatus.textContent = `آخر حالة: ${b.text}`;

    const counts = arr.reduce(
      (acc, it) => {
        acc[it.status] = (acc[it.status] || 0) + 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0 }
    );

    tpSummary.innerHTML = `
      <strong>الإجمالي:</strong> ${arr.length}
      <span style="margin-inline:10px;">|</span>
      <strong>معلّق:</strong> ${counts.pending || 0}
      <span style="margin-inline:10px;">|</span>
      <strong>مقبول:</strong> ${counts.approved || 0}
      <span style="margin-inline:10px;">|</span>
      <strong>مرفوض:</strong> ${counts.rejected || 0}
    `;

    for (const it of arr) {
      const id = it.id;
      const date = it.request_date || it.requestDate || "—";
      const scopeTxt = it.scope === "slots" ? "حصص محددة" : "اليوم كامل";
      const badge = statusBadge(it.status);

      const reason = it.reason_text || it.reasonText || "";
      const notes = it.notes || "";
      const decisionNote = it.decision_note || it.decisionNote || "";
      const decidedAt = it.decided_at || it.decidedAt || "";

      const card = document.createElement("div");
      card.className = "muted-box";
      card.style.margin = "0";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center;">
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
            <span class="${esc(badge.cls)}" style="padding:.2rem .5rem;border-radius:999px;font-weight:800;">
              ${esc(badge.text)}
            </span>
            <strong style="direction:ltr;">${esc(date)}</strong>
            <span style="opacity:.85;">(${esc(scopeTxt)})</span>
          </div>
          <small style="opacity:.85; direction:ltr;">#${esc(id)}</small>
        </div>

        ${reason ? `<div style="margin-top:.45rem;"><strong>السبب:</strong> ${esc(reason)}</div>` : ""}
        ${notes ? `<div style="margin-top:.25rem;"><strong>ملاحظة:</strong> ${esc(notes)}</div>` : ""}

        ${
          it.status !== "pending"
            ? `<div style="margin-top:.45rem; opacity:.9;">
                <strong>قرار الإدارة:</strong>
                ${esc(decisionNote || (it.status === "approved" ? "تم القبول" : "تم الرفض"))}
                ${decidedAt ? `<small style="display:block;direction:ltr;opacity:.8;margin-top:.2rem;">${esc(decidedAt)}</small>` : ""}
               </div>`
            : `<div style="margin-top:.45rem; opacity:.85;">
                <i class="ri-time-line"></i> بانتظار قرار الإدارة
               </div>`
        }
      `;
      tpList.appendChild(card);
    }
  }

  async function refreshPermits() {
    try {
      const data = await apiFetch("/teacher/permits");
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      items.sort((a, b) => (b.id || 0) - (a.id || 0));
      renderPermits(items);
    } catch (e) {
      toast(e?.message || "تعذر تحميل الطلبات", "error");
      renderPermits([]);
    }
  }

  function init() {
    if (tpDate) tpDate.value = nowISO();
    toggleSlotsUI();

    loadTeacherCard();
    refreshPermits();

    if (tcardCopy) tcardCopy.addEventListener("click", copyCardCode);
    if (tpCardCopyInline) tpCardCopyInline.addEventListener("click", copyCardCode);

    if (tpScope) {
      tpScope.addEventListener("change", () => {
        toggleSlotsUI();
        if (tpScope.value === "slots") loadSlotsForDate(tpDate?.value || nowISO());
      });
    }

    if (tpDate) {
      tpDate.addEventListener("change", () => {
        if (tpScope?.value === "slots") loadSlotsForDate(tpDate.value);
      });
    }

    if (tpLoadSlots) tpLoadSlots.addEventListener("click", () => loadSlotsForDate(tpDate?.value || nowISO()));
    if (tpSelectAll) tpSelectAll.addEventListener("click", () => document.querySelectorAll(".tp-slot").forEach((c) => (c.checked = true)));
    if (tpClearAll) tpClearAll.addEventListener("click", () => document.querySelectorAll(".tp-slot").forEach((c) => (c.checked = false)));

    if (tpSubmit) tpSubmit.addEventListener("click", submitPermit);
    if (tpRefresh) tpRefresh.addEventListener("click", refreshPermits);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
