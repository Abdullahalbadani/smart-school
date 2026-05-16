/* ===========================
   /frontend/admin/js/features/adminTeacherPermits.js
   Admin - Teacher Permits (review + approve/reject + modal)
=========================== */
(function () {
  "use strict";
 if (window.__ADMIN_TEACHER_PERMITS_LOADED__) return;
window.__ADMIN_TEACHER_PERMITS_LOADED__ = true;

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


const ENDPOINTS = {
  list: "/admin/teacher-permits",
  details: (id) => `/admin/teacher-permits/${id}`,
  decision: (id) => `/admin/teacher-permits/${id}/decision`,
};
  /* =========================
     Helpers
  ========================= */
  const $ = (id) => document.getElementById(id);

  const toast = (msg, type) => {
    if (typeof window.showToast === "function") return window.showToast(msg, type);
    if (typeof window.toast === "function") return window.toast(msg, type);
    console.log(`[${type || "info"}] ${msg}`);
  };

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("auth_token") ||
    "";

  const apiFetch = async (path, opts = {}) => {
  const fullUrl = apiUrl(path);

  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  const token = getToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(fullUrl, {
    ...opts,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
};
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const statusText = (s) => {
    const v = String(s || "").toLowerCase();
    if (v === "pending") return { cls: "pending", text: "معلّق" };
    if (v === "approved") return { cls: "approved", text: "مقبول" };
    if (v === "rejected") return { cls: "rejected", text: "مرفوض" };
    return { cls: "", text: v || "—" };
  };

  const scopeText = (s) => (String(s || "") === "slots" ? "حصص محددة" : "اليوم كامل");

  /* =========================
     DOM Variables
  ========================= */
  let elStatus, elFrom, elTo, elSearch, elRefresh;
  let elStatPending, elStatApproved, elStatRejected;
  let elList, elEmpty;
  let elModal, elModalClose, elModalBack, elModalSummary, elModalSlotsBox, elModalSlotsList, elDecisionNote, elApprove, elReject;

  function refreshDOMElements() {
    elStatus = $("tp-status");
    elFrom = $("tp-from");
    elTo = $("tp-to");
    elSearch = $("tp-search");
    elRefresh = $("tp-refresh");
    elStatPending = $("tp-stat-pending");
    elStatApproved = $("tp-stat-approved");
    elStatRejected = $("tp-stat-rejected");
    elList = $("tp-list");
    elEmpty = $("tp-empty");
    elModal = $("tp-modal");
    elModalClose = $("tp-modal-close");
    elModalBack = $("tp-modal-back");
    elModalSummary = $("tp-modal-summary");
    elModalSlotsBox = $("tp-modal-slots");
    elModalSlotsList = $("tp-modal-slots-list");
    elDecisionNote = $("tp-decision-note");
    elApprove = $("tp-approve");
    elReject = $("tp-reject");
  }

  const state = { items: [], selected: null, busy: false };

  /* =========================
     Modal
  ========================= */
  function openModal() {
    if (!elModal) return;
    elModal.classList.add("is-open");
    elModal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!elModal) return;
    elModal.classList.remove("is-open");
    elModal.setAttribute("aria-hidden", "true");
    state.selected = null;
    if (elDecisionNote) elDecisionNote.value = "";
    if (elModalSlotsList) elModalSlotsList.innerHTML = "";
    if (elModalSlotsBox) elModalSlotsBox.style.display = "none";
  }

  /* =========================
     Render
  ========================= */
  function renderStats(items) {
    const counts = items.reduce(
      (acc, it) => {
        const s = String(it.status || "").toLowerCase();
        if (s === "pending") acc.pending++;
        else if (s === "approved") acc.approved++;
        else if (s === "rejected") acc.rejected++;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0 }
    );

    if (elStatPending) elStatPending.textContent = String(counts.pending);
    if (elStatApproved) elStatApproved.textContent = String(counts.approved);
    if (elStatRejected) elStatRejected.textContent = String(counts.rejected);
  }

  function renderList(items) {
    if (!elList) return;
    elList.innerHTML = "";

    if (!items || items.length === 0) {
      if (elEmpty) elEmpty.style.display = "";
      renderStats([]);
      return;
    }
    if (elEmpty) elEmpty.style.display = "none";

    renderStats(items);

    for (const it of items) {
      const id = it.id;
      const teacherName = it.teacher_name || it.teacherName || it.teacher?.full_name || it.teacher?.fullName || it.full_name || it.fullName || "—";
      const date = String(it.request_date || it.requestDate || "—").slice(0, 10);
      const sc = it.scope || "full_day";
      const st = statusText(it.status);
      const reason = it.reason_text || it.reasonText || "";
      const notes = it.notes || "";
      const requestedAt = it.requested_at || it.requestedAt || "";

      const card = document.createElement("div");
      card.className = "tp-card";
      card.dataset.id = String(id);

      const actions =
        String(it.status || "").toLowerCase() === "pending"
          ? `<button type="button" class="tp-btn tp-btn--ok" data-action="approve"><i class="ri-check-line"></i><span>قبول</span></button>
             <button type="button" class="tp-btn tp-btn--no" data-action="reject"><i class="ri-close-line"></i><span>رفض</span></button>`
          : ``;

      card.innerHTML = `
        <div class="tp-card-top">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div class="tp-name">${esc(teacherName)}</div>
            <div class="tp-meta">
              <span style="direction:ltr; font-weight:900;">${esc(date)}</span>
              <span style="margin-inline:8px;">•</span>
              <span>${esc(scopeText(sc))}</span>
              ${requestedAt ? `<span style="margin-inline:8px;">•</span><span style="direction:ltr;">${esc(requestedAt)}</span>` : ""}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="tp-badge ${esc(st.cls)}"><i class="ri-flag-line"></i> ${esc(st.text)}</span>
            <small style="direction:ltr; color: var(--text-muted); font-weight:900;">#${esc(id)}</small>
          </div>
        </div>
        ${reason ? `<div style="margin-top:8px; color:var(--text-main); font-weight:800;"><strong>السبب:</strong> ${esc(reason)}</div>` : ""}
        ${notes ? `<div style="margin-top:6px; color:var(--text-muted); font-weight:800;"><strong>ملاحظة:</strong> ${esc(notes)}</div>` : ""}
        <div class="tp-actions">
          <button type="button" class="tp-btn tp-btn--pri" data-action="open"><i class="ri-file-list-3-line"></i><span>تفاصيل</span></button>
          ${actions}
        </div>
      `;
      elList.appendChild(card);
    }
  }

  /* =========================
     Load data
  ========================= */
  function buildQuery() {
    const status = String(elStatus?.value || "");
    const from = String(elFrom?.value || "");
    const to = String(elTo?.value || "");
    const q = String(elSearch?.value || "").trim();

    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);

    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  function normalizeItemsPayload(data) {
    let items = data?.items || data?.rows || data?.data || data?.list || data || [];
    if (!Array.isArray(items)) items = [];
    items.sort((a, b) => (b.id || 0) - (a.id || 0));
    return items;
  }

  async function loadPermits() {
    if (!elList) return;
    try {
      if (elRefresh) elRefresh.disabled = true;
      elList.innerHTML = '<div style="padding:20px; text-align:center;">⏳ جاري تحميل الأذونات...</div>';
      
      const data = await apiFetch(ENDPOINTS.list + buildQuery());
      state.items = normalizeItemsPayload(data);
      renderList(state.items);
    } catch (e) {
      toast(e?.message || "تعذر تحميل الأذونات", "error");
      renderList([]);
    } finally {
      if (elRefresh) elRefresh.disabled = false;
    }
  }

  /* =========================
     Details + Decision
  ========================= */
  async function loadPermitDetails(id) {
    const base = state.items.find((x) => String(x.id) === String(id)) || null;
    try {
      const data = await apiFetch(ENDPOINTS.details(id));
      const permit = data?.permit || data?.item || data;
      const slots = data?.slots || permit?.slots || [];
      const teachers = data?.teachers || []; 
      return { permit: permit || base, slots: Array.isArray(slots) ? slots : [], teachers };
    } catch {
      return { permit: base, slots: [], teachers: [] };
    }
  }

  function renderModal(permit, slots, teachers = []) {
    if (!permit) { toast("الطلب غير موجود", "warn"); return; }
    state.selected = permit;

    const teacherName = permit.teacher_name || permit.teacherName || permit.full_name || "—";
    const date = String(permit.request_date || "—").slice(0, 10); 
    const sc = permit.scope || "full_day";
    const st = statusText(permit.status);
    const reason = permit.reason_text || "";
    const notes = permit.notes || "";

    let badgeColor = "#94a3b8", badgeBg = "rgba(148, 163, 184, 0.1)";
    if(permit.status === 'pending') { badgeColor = "#f59e0b"; badgeBg = "rgba(245, 158, 11, 0.1)"; }
    else if(permit.status === 'approved') { badgeColor = "#10b981"; badgeBg = "rgba(16, 185, 129, 0.1)"; }
    else if(permit.status === 'rejected') { badgeColor = "#ef4444"; badgeBg = "rgba(239, 68, 68, 0.1)"; }

    if (!document.getElementById("modal-scroll-fix")) {
      document.head.insertAdjacentHTML('beforeend', '<style id="modal-scroll-fix">.tp-modal-box { max-height: 85vh; overflow-y: auto; overflow-x: hidden; } .tp-substitute-select option { background: #1e293b; color: #fff; padding: 5px; }</style>');
    }

    if (elModalSummary) {
      elModalSummary.innerHTML = `
        <div style="background: var(--bg-card, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 10px;">
            <strong style="font-size:1.15rem; color: var(--text-main, #f8fafc);">${esc(teacherName)}</strong>
            <span style="background:${badgeBg}; color:${badgeColor}; padding:4px 12px; border-radius:20px; font-weight:bold; font-size:0.85rem;">${esc(st.text)}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.95rem; color: var(--text-muted, #94a3b8);">
            <div><i class="ri-calendar-line"></i> <strong>التاريخ:</strong> <span style="direction:ltr;">${esc(date)}</span></div>
            <div><i class="ri-focus-2-line"></i> <strong>النوع:</strong> ${esc(scopeText(sc))}</div>
          </div>
          ${reason ? `<div style="margin-top:15px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border-right: 3px solid #3b82f6;"><strong style="color:var(--text-main, #f8fafc);">السبب:</strong> ${esc(reason)}</div>` : ""}
          ${notes ? `<div style="margin-top:10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; border-right: 3px solid #64748b;"><strong style="color:var(--text-main, #f8fafc);">ملاحظة:</strong> ${esc(notes)}</div>` : ""}
        </div>
      `;
    }

    if (elModalSlotsBox && elModalSlotsList) {
      if (String(sc) === "slots") {
        elModalSlotsBox.style.display = "block";
        if (Array.isArray(slots) && slots.length > 0) {
          elModalSlotsList.innerHTML = slots.map(s => {
            const pName = String(s.period_name || "?").trim();
            const periodLabel = /^\d+$/.test(pName) ? `الحصة ${pName}` : pName; 
            const time = (s.start_time && s.end_time) ? `${s.start_time.slice(0,5)} - ${s.end_time.slice(0,5)}` : "غير محدد";
            
            let substituteHtml = "";
            const isPending = permit.status === "pending";
            const isApproved = permit.status === "approved";
            // 🟢 إذا رفض المعلم أو انتهى وقته (تجاهل) أو معلق جديد
            const needsNewSub = isApproved && (!s.substitute_name || s.sub_status === "rejected" || s.sub_status === "expired");

            if (isPending || needsNewSub) {
              let radarOptions = `<option value="">-- اختياري: اختر معلم احتياط --</option>`;
              if (s.available_teachers && s.available_teachers.length > 0) {
                s.available_teachers.forEach(t => {
                  radarOptions += `<option value="${t.id}">${esc(t.full_name || t.fullName)}</option>`;
                });
              } else {
                radarOptions = `<option value="" disabled>⚠️ لا يوجد أي معلم متفرغ في هذه الحصة!</option>`;
              }

              let warningTag = "";
              if (s.sub_status === "rejected") warningTag = `<span style="color:#ef4444; font-size:0.8rem; font-weight:bold;">(المعلم السابق اعتذر، اختر بديلاً)</span>`;
              if (s.sub_status === "expired") warningTag = `<span style="color:#f59e0b; font-size:0.8rem; font-weight:bold;">(تجاهل الطلب - انتهى الوقت ⏱️)</span>`;

              substituteHtml = `
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color, #334155);">
                  <label style="font-size: 0.85rem; color: var(--text-muted, #94a3b8); margin-bottom: 6px; display: block;">
                     <i class="ri-radar-line" style="color: #10b981;"></i> تعيين معلم احتياط (متفرغ): ${warningTag}
                  </label>
                  <select class="tp-substitute-select" data-entry-id="${s.timetable_entry_id}" style="width: 100%; padding: 8px; margin-bottom: 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color, #334155); color: var(--text-main, #f8fafc); border-radius: 4px; outline: none;">
                    ${radarOptions}
                  </select>
                  
                  <label style="font-size: 0.8rem; color: #f59e0b; display: block; margin-bottom: 6px;">
                    <i class="ri-timer-flash-line"></i> مهلة الرد المطلوبة (بالدقائق):
                  </label>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="number" class="tp-timeout-input" data-entry-id="${s.timetable_entry_id}" value="15" min="1" placeholder="مثال: 10" style="width: 120px; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color, #334155); color: var(--text-main, #f8fafc); border-radius: 4px; outline: none; text-align: center; font-weight: bold;">
                    <span style="font-size: 0.85rem; color: #94a3b8;">دقيقة (سينطلق الإنذار بعدها إذا تجاهل الطلب)</span>
                  </div>
                </div>
              `;
            } else if (s.substitute_name) {
              let subStatusColor = "#f59e0b"; let subStatusText = "⏳ بانتظار رد المعلم";
              if (s.sub_status === "accepted") { subStatusColor = "#10b981"; subStatusText = "✅ وافق على التغطية"; }
              
              substituteHtml = `
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color, #334155); display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.95rem; color: var(--text-main, #f8fafc);"><i class="ri-user-shared-2-line" style="color: #3b82f6;"></i> الاحتياط: <strong>${esc(s.substitute_name)}</strong></span>
                  <span style="font-size: 0.85rem; background: ${subStatusColor}20; color: ${subStatusColor}; padding: 4px 10px; border-radius: 6px; font-weight: bold;">${subStatusText}</span>
                </div>
              `;
            }

            return `
              <div style="background: var(--bg-card, #1e293b); border: 1px solid var(--border-color, #334155); padding: 12px 15px; border-radius: 6px; margin-bottom: 8px;">
                <div style="display:flex; justify-content:space-between;">
                  <strong style="color: var(--text-main, #f8fafc); font-size: 1.05rem;"><i class="ri-bookmark-3-line" style="color:#8b5cf6;"></i> ${esc(periodLabel)}</strong>
                  <span style="direction:ltr; color:var(--text-muted, #94a3b8); font-size: 0.9rem;">${esc(time)}</span>
                </div>
                ${substituteHtml}
              </div>
            `;
          }).join('');
        }
      } else { elModalSlotsBox.style.display = "none"; }
    }

    const isPending = String(permit.status || "").toLowerCase() === "pending";
    const isApproved = String(permit.status || "").toLowerCase() === "approved";

    if (elApprove) {
      if (isPending) {
        elApprove.style.display = "inline-flex";
        elApprove.innerHTML = `<i class="ri-check-line"></i><span>قبول</span>`;
      } else if (isApproved) {
        elApprove.style.display = "inline-flex";
        elApprove.innerHTML = `<i class="ri-save-line"></i><span>تحديث وتعيين الاحتياط</span>`;
      } else {
        elApprove.style.display = "none";
      }
    }
    
    if (elReject) elReject.style.display = isPending ? "inline-flex" : "none";
    if (elDecisionNote) elDecisionNote.parentElement.style.display = isPending ? "block" : "none";

    openModal();
  }

  async function openDetails(id) {
    const { permit, slots, teachers } = await loadPermitDetails(id);
    renderModal(permit, slots, teachers); 
  }

  // PATCH /api/admin/teacher-permits/:id/decision
  async function decide(decision) {
    const permit = state.selected;
    if (!permit) return;

    const current = String(permit.status || "").toLowerCase();
    if (current !== "pending" && current !== "approved") {
      toast("تم اتخاذ قرار نهائي في هذا الطلب مسبقاً", "warn"); 
      return;
    }

    const note = String(elDecisionNote?.value || "").trim();
    const modalBox = document.getElementById("modal-teacher-permits") || document.querySelector(".tp-modal-box") || document.body;
    
    // 🟢 تجميع المعلمين مع الوقت الذي حددته الإدارة
    const substituteNodes = modalBox.querySelectorAll(".tp-substitute-select");
    const substitutes = Array.from(substituteNodes).map(node => {
      const entryId = parseInt(node.getAttribute("data-entry-id"));
      const timeInput = modalBox.querySelector(`.tp-timeout-input[data-entry-id="${entryId}"]`);
      
      let timeoutVal = timeInput && timeInput.value ? parseInt(timeInput.value) : 15;
      if (timeoutVal < 1) timeoutVal = 15; 

      return {
        entry_id: entryId,
        substitute_id: parseInt(node.value) || null,
        timeout_minutes: timeoutVal 
      };
    }).filter(sub => sub.substitute_id !== null);

    try {
      if (state.busy) return;
      state.busy = true;
      if (elApprove) elApprove.disabled = true;
      if (elReject) elReject.disabled = true;

      const newStatus = decision === "approved" ? "approved" : "rejected";
      
      await apiFetch(ENDPOINTS.decision(permit.id), {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, decision_note: note, substitutes }), 
      });

      toast(current === "approved" ? "تم التحديث بنجاح، وسيبدأ المؤقت التنازلي ✅" : "تمت العملية بنجاح ✅", "success");
      closeModal();
      await loadPermits();
      
      const alertBox = document.getElementById("admin-eagle-eye-alerts");
      if(alertBox) alertBox.style.display = "none";
      if (typeof window.refreshEagleEye === "function") {
          window.refreshEagleEye();
      }
      
    } catch (e) {
      toast(e?.message || "فشل تنفيذ القرار", "error");
    } finally {
      if (elApprove) elApprove.disabled = false;
      if (elReject) elReject.disabled = false;
      state.busy = false;
    }
  }

  /* =========================
     Events
  ========================= */
  function wireEvents() {
    if (elRefresh) elRefresh.onclick = loadPermits;

    const refreshSoft = () => loadPermits();
    if (elStatus) elStatus.onchange = refreshSoft;
    if (elFrom) elFrom.onchange = refreshSoft;
    if (elTo) elTo.onchange = refreshSoft;

    let tmr = null;
    if (elSearch) {
      elSearch.oninput = () => {
        clearTimeout(tmr);
        tmr = setTimeout(refreshSoft, 250);
      };
    }

    if (elList) {
      elList.onclick = (e) => {
        const btn = e.target?.closest("button[data-action]");
        if (!btn) return;
        const card = btn.closest("[data-id]");
        const id = card?.dataset?.id;
        if (!id) return;

        const action = btn.dataset.action;
        if (action === "open") return openDetails(id);
        if (action === "approve") { openDetails(id); return; }
        if (action === "reject") { openDetails(id); return; }
      };
    }

    if (elModalClose) elModalClose.onclick = closeModal;
    if (elModalBack) elModalBack.onclick = closeModal;
    if (elModal) {
      elModal.onclick = (e) => {
        if (e.target === elModal) closeModal();
      };
    }

    if (elApprove) elApprove.onclick = () => decide("approved");
    if (elReject) elReject.onclick = () => decide("rejected");
  }

  /* =========================
     Init
  ========================= */
  window.initAdminTeacherPermits = async function () {
    refreshDOMElements(); 
    
    if (!elList || !elStatus) return; 

    wireEvents();

    if (elStatus && !elStatus.value) elStatus.value = "pending";

    try {
      const sp = new URLSearchParams(location.search);
      const st = sp.get("status");
      if (st && elStatus) elStatus.value = st;
      
      const from = sp.get("from");
      if (from && elFrom) elFrom.value = from;
      
      const to = sp.get("to");
      if (to && elTo) elTo.value = to;
      
      const q = sp.get("q");
      if (q && elSearch) elSearch.value = q;
    } catch {}

    await loadPermits();
  };

  /* =========================
     SPA Magic Watcher
  ========================= */
  const observer = new MutationObserver(() => {
    const listEl = document.getElementById("tp-list");
    if (listEl && !listEl.dataset.isLoaded) {
      listEl.dataset.isLoaded = "true"; 
      window.initAdminTeacherPermits();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });

})();