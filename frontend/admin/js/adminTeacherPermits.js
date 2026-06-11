/* ===========================
   /frontend/admin/js/features/adminTeacherPermits.js
   Admin - Teacher Permits
   Review + approve/reject + substitute teacher assignment
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
    if (typeof window.showToast === "function") {
      return window.showToast(msg, type);
    }

    if (typeof window.toast === "function") {
      return window.toast(msg, type);
    }

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

  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const statusText = (status) => {
    const value = String(status || "").toLowerCase();

    if (value === "pending") {
      return { cls: "pending", text: "معلّق" };
    }

    if (value === "approved") {
      return { cls: "approved", text: "مقبول" };
    }

    if (value === "rejected") {
      return { cls: "rejected", text: "مرفوض" };
    }

    return { cls: "", text: value || "—" };
  };

  const scopeText = (scope) =>
    String(scope || "") === "slots" ? "حصص محددة" : "اليوم كامل";

  /* =========================
     DOM Variables
  ========================= */

  let elStatus;
  let elFrom;
  let elTo;
  let elSearch;
  let elRefresh;

  let elStatPending;
  let elStatApproved;
  let elStatRejected;

  let elList;
  let elEmpty;

  let elModal;
  let elModalClose;
  let elModalBack;
  let elModalSummary;
  let elModalSlotsBox;
  let elModalSlotsList;
  let elDecisionNote;
  let elApprove;
  let elReject;

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

  const state = {
    items: [],
    selected: null,
    busy: false,
  };

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

    if (elDecisionNote) {
      elDecisionNote.value = "";
    }

    if (elModalSlotsList) {
      elModalSlotsList.innerHTML = "";
    }

    if (elModalSlotsBox) {
      elModalSlotsBox.style.display = "none";
    }
  }

  /* =========================
     Render statistics
  ========================= */

  function renderStats(items) {
    const counts = items.reduce(
      (acc, item) => {
        const status = String(item.status || "").toLowerCase();

        if (status === "pending") acc.pending++;
        else if (status === "approved") acc.approved++;
        else if (status === "rejected") acc.rejected++;

        return acc;
      },
      {
        pending: 0,
        approved: 0,
        rejected: 0,
      }
    );

    if (elStatPending) {
      elStatPending.textContent = String(counts.pending);
    }

    if (elStatApproved) {
      elStatApproved.textContent = String(counts.approved);
    }

    if (elStatRejected) {
      elStatRejected.textContent = String(counts.rejected);
    }
  }

  /* =========================
     Render permits list
  ========================= */

  function renderList(items) {
    if (!elList) return;

    elList.innerHTML = "";

    if (!items || items.length === 0) {
      if (elEmpty) {
        elEmpty.style.display = "";
      }

      renderStats([]);
      return;
    }

    if (elEmpty) {
      elEmpty.style.display = "none";
    }

    renderStats(items);

    for (const item of items) {
      const id = item.id;

      const teacherName =
        item.teacher_name ||
        item.teacherName ||
        item.teacher?.full_name ||
        item.teacher?.fullName ||
        item.full_name ||
        item.fullName ||
        "—";

      const date = String(
        item.request_date || item.requestDate || "—"
      ).slice(0, 10);

      const scope = item.scope || "full_day";
      const status = statusText(item.status);
      const reason = item.reason_text || item.reasonText || "";
      const notes = item.notes || "";
      const requestedAt = item.requested_at || item.requestedAt || "";

      const card = document.createElement("div");

      card.className = "tp-card";
      card.dataset.id = String(id);

      const actions =
        String(item.status || "").toLowerCase() === "pending"
          ? `
            <button
              type="button"
              class="tp-btn tp-btn--ok"
              data-action="approve"
            >
              <i class="ri-check-line"></i>
              <span>قبول</span>
            </button>

            <button
              type="button"
              class="tp-btn tp-btn--no"
              data-action="reject"
            >
              <i class="ri-close-line"></i>
              <span>رفض</span>
            </button>
          `
          : "";

      card.innerHTML = `
        <div class="tp-card-top">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div class="tp-name">${esc(teacherName)}</div>

            <div class="tp-meta">
              <span style="direction:ltr; font-weight:900;">
                ${esc(date)}
              </span>

              <span style="margin-inline:8px;">•</span>

              <span>${esc(scopeText(scope))}</span>

              ${
                requestedAt
                  ? `
                    <span style="margin-inline:8px;">•</span>
                    <span style="direction:ltr;">${esc(requestedAt)}</span>
                  `
                  : ""
              }
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="tp-badge ${esc(status.cls)}">
              <i class="ri-flag-line"></i>
              ${esc(status.text)}
            </span>

            <small
              style="
                direction:ltr;
                color:var(--text-muted);
                font-weight:900;
              "
            >
              #${esc(id)}
            </small>
          </div>
        </div>

        ${
          reason
            ? `
              <div
                style="
                  margin-top:8px;
                  color:var(--text-main);
                  font-weight:800;
                "
              >
                <strong>السبب:</strong>
                ${esc(reason)}
              </div>
            `
            : ""
        }

        ${
          notes
            ? `
              <div
                style="
                  margin-top:6px;
                  color:var(--text-muted);
                  font-weight:800;
                "
              >
                <strong>ملاحظة:</strong>
                ${esc(notes)}
              </div>
            `
            : ""
        }

        <div class="tp-actions">
          <button
            type="button"
            class="tp-btn tp-btn--pri"
            data-action="open"
          >
            <i class="ri-file-list-3-line"></i>
            <span>تفاصيل</span>
          </button>

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
    const query = String(elSearch?.value || "").trim();

    const params = new URLSearchParams();

    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (query) params.set("q", query);

    const queryString = params.toString();

    return queryString ? `?${queryString}` : "";
  }

  function normalizeItemsPayload(data) {
    let items =
      data?.items ||
      data?.rows ||
      data?.data ||
      data?.list ||
      data ||
      [];

    if (!Array.isArray(items)) {
      items = [];
    }

    items.sort((a, b) => (b.id || 0) - (a.id || 0));

    return items;
  }

  async function loadPermits() {
    if (!elList) return;

    try {
      if (elRefresh) {
        elRefresh.disabled = true;
      }

      elList.innerHTML = `
        <div style="padding:20px; text-align:center;">
          ⏳ جاري تحميل الأذونات...
        </div>
      `;

      const data = await apiFetch(ENDPOINTS.list + buildQuery());

      state.items = normalizeItemsPayload(data);

      renderList(state.items);
    } catch (error) {
      toast(error?.message || "تعذر تحميل الأذونات", "error");
      renderList([]);
    } finally {
      if (elRefresh) {
        elRefresh.disabled = false;
      }
    }
  }

  /* =========================
     Load permit details
  ========================= */

  async function loadPermitDetails(id) {
    const base =
      state.items.find((item) => String(item.id) === String(id)) || null;

    try {
      const data = await apiFetch(ENDPOINTS.details(id));

      const permit = data?.permit || data?.item || data;
      const slots = data?.slots || permit?.slots || [];
      const teachers = data?.teachers || [];

      return {
        permit: permit || base,
        slots: Array.isArray(slots) ? slots : [],
        teachers: Array.isArray(teachers) ? teachers : [],
      };
} catch (error) {
  console.error("loadPermitDetails error:", error);
  throw error;
}
  }

  /* =========================
     Render modal
  ========================= */

  function renderModal(permit, slots, teachers = []) {
    if (!permit) {
      toast("الطلب غير موجود", "warn");
      return;
    }

    state.selected = permit;

    const teacherName =
      permit.teacher_name ||
      permit.teacherName ||
      permit.full_name ||
      "—";

    const date = String(permit.request_date || "—").slice(0, 10);
    const scope = permit.scope || "full_day";
    const status = statusText(permit.status);
    const reason = permit.reason_text || "";
    const notes = permit.notes || "";

    let badgeColor = "#94a3b8";
    let badgeBg = "rgba(148, 163, 184, 0.1)";

    if (permit.status === "pending") {
      badgeColor = "#f59e0b";
      badgeBg = "rgba(245, 158, 11, 0.1)";
    } else if (permit.status === "approved") {
      badgeColor = "#10b981";
      badgeBg = "rgba(16, 185, 129, 0.1)";
    } else if (permit.status === "rejected") {
      badgeColor = "#ef4444";
      badgeBg = "rgba(239, 68, 68, 0.1)";
    }

    if (!document.getElementById("modal-scroll-fix")) {
      document.head.insertAdjacentHTML(
        "beforeend",
        `
          <style id="modal-scroll-fix">
            .tp-modal-box {
              max-height: 85vh;
              overflow-y: auto;
              overflow-x: hidden;
            }

            .tp-substitute-select option {
              background: #1e293b;
              color: #fff;
              padding: 5px;
            }
          </style>
        `
      );
    }

    if (elModalSummary) {
      elModalSummary.innerHTML = `
        <div
          style="
            background:var(--bg-card, #1e293b);
            border:1px solid var(--border-color, #334155);
            border-radius:8px;
            padding:15px;
            margin-bottom:15px;
          "
        >
          <div
            style="
              display:flex;
              justify-content:space-between;
              align-items:center;
              margin-bottom:15px;
              border-bottom:1px solid var(--border-color, #334155);
              padding-bottom:10px;
            "
          >
            <strong
              style="
                font-size:1.15rem;
                color:var(--text-main, #f8fafc);
              "
            >
              ${esc(teacherName)}
            </strong>

            <span
              style="
                background:${badgeBg};
                color:${badgeColor};
                padding:4px 12px;
                border-radius:20px;
                font-weight:bold;
                font-size:0.85rem;
              "
            >
              ${esc(status.text)}
            </span>
          </div>

          <div
            style="
              display:grid;
              grid-template-columns:1fr 1fr;
              gap:10px;
              font-size:0.95rem;
              color:var(--text-muted, #94a3b8);
            "
          >
            <div>
              <i class="ri-calendar-line"></i>
              <strong>التاريخ:</strong>
              <span style="direction:ltr;">${esc(date)}</span>
            </div>

            <div>
              <i class="ri-focus-2-line"></i>
              <strong>النوع:</strong>
              ${esc(scopeText(scope))}
            </div>
          </div>

          ${
            reason
              ? `
                <div
                  style="
                    margin-top:15px;
                    background:rgba(0,0,0,0.2);
                    padding:10px;
                    border-radius:6px;
                    border-right:3px solid #3b82f6;
                  "
                >
                  <strong style="color:var(--text-main, #f8fafc);">
                    السبب:
                  </strong>

                  ${esc(reason)}
                </div>
              `
              : ""
          }

          ${
            notes
              ? `
                <div
                  style="
                    margin-top:10px;
                    background:rgba(0,0,0,0.2);
                    padding:10px;
                    border-radius:6px;
                    border-right:3px solid #64748b;
                  "
                >
                  <strong style="color:var(--text-main, #f8fafc);">
                    ملاحظة:
                  </strong>

                  ${esc(notes)}
                </div>
              `
              : ""
          }
        </div>
      `;
    }

    /*
      مهم:
      نعرض الحصص سواء كان الإذن لحصص محددة أو لليوم الكامل.
      سابقًا كانت الحصص تظهر فقط عند scope = slots.
    */
    if (elModalSlotsBox && elModalSlotsList) {
      const shouldShowSlots =
        String(scope) === "slots" || String(scope) === "full_day";

      if (shouldShowSlots) {
        elModalSlotsBox.style.display = "block";
        elModalSlotsList.innerHTML = "";

        if (Array.isArray(slots) && slots.length > 0) {
          elModalSlotsList.innerHTML = slots
            .map((slot) => {
              const periodName = String(slot.period_name || "?").trim();

              const periodLabel = /^\d+$/.test(periodName)
                ? `الحصة ${periodName}`
                : periodName;

              const time =
                slot.start_time && slot.end_time
                  ? `${String(slot.start_time).slice(0, 5)} - ${String(
                      slot.end_time
                    ).slice(0, 5)}`
                  : "غير محدد";

              const isPending = permit.status === "pending";
              const isApproved = permit.status === "approved";

              const substituteStatus = String(
                slot.sub_status || ""
              ).toLowerCase();

              const needsNewSubstitute =
                isApproved &&
                (!slot.substitute_name ||
                  substituteStatus === "rejected" ||
                  substituteStatus === "expired");

              let substituteHtml = "";

              if (isPending || needsNewSubstitute) {
                let options = `
                  <option value="">
                    -- اختياري: اختر معلم احتياط --
                  </option>
                `;

                if (
                  Array.isArray(slot.available_teachers) &&
                  slot.available_teachers.length > 0
                ) {
                  options += slot.available_teachers
                    .map((teacher) => {
                      return `
                        <option value="${esc(teacher.id)}">
                          ${esc(teacher.full_name || teacher.fullName || "—")}
                        </option>
                      `;
                    })
                    .join("");
                } else {
                  options = `
                    <option value="" disabled>
                      ⚠️ لا يوجد أي معلم متفرغ في هذه الحصة
                    </option>
                  `;
                }

                let warningTag = "";

                if (substituteStatus === "rejected") {
                  warningTag = `
                    <span
                      style="
                        color:#ef4444;
                        font-size:0.8rem;
                        font-weight:bold;
                      "
                    >
                      المعلم السابق اعتذر، اختر بديلاً
                    </span>
                  `;
                }

                if (substituteStatus === "expired") {
                  warningTag = `
                    <span
                      style="
                        color:#f59e0b;
                        font-size:0.8rem;
                        font-weight:bold;
                      "
                    >
                      انتهت المهلة، اختر بديلاً
                    </span>
                  `;
                }

                substituteHtml = `
                  <div
                    style="
                      margin-top:12px;
                      padding-top:12px;
                      border-top:1px dashed var(--border-color, #334155);
                    "
                  >
                    <label
                      style="
                        font-size:0.85rem;
                        color:var(--text-muted, #94a3b8);
                        margin-bottom:6px;
                        display:block;
                      "
                    >
                      <i
                        class="ri-radar-line"
                        style="color:#10b981;"
                      ></i>

                      تعيين معلم احتياط متفرغ:

                      ${warningTag}
                    </label>

                    <select
                      class="tp-substitute-select"
                      data-entry-id="${esc(slot.timetable_entry_id)}"
                      style="
                        width:100%;
                        padding:8px;
                        margin-bottom:12px;
                        background:rgba(0,0,0,0.2);
                        border:1px solid var(--border-color, #334155);
                        color:var(--text-main, #f8fafc);
                        border-radius:4px;
                        outline:none;
                      "
                    >
                      ${options}
                    </select>

                    <label
                      style="
                        font-size:0.8rem;
                        color:#f59e0b;
                        display:block;
                        margin-bottom:6px;
                      "
                    >
                      <i class="ri-timer-flash-line"></i>
                      مهلة الرد المطلوبة بالدقائق:
                    </label>

                    <div
                      style="
                        display:flex;
                        align-items:center;
                        gap:10px;
                        flex-wrap:wrap;
                      "
                    >
                      <input
                        type="number"
                        class="tp-timeout-input"
                        data-entry-id="${esc(slot.timetable_entry_id)}"
                        value="15"
                        min="1"
                        placeholder="مثال: 10"
                        style="
                          width:120px;
                          padding:8px;
                          background:rgba(0,0,0,0.2);
                          border:1px solid var(--border-color, #334155);
                          color:var(--text-main, #f8fafc);
                          border-radius:4px;
                          outline:none;
                          text-align:center;
                          font-weight:bold;
                        "
                      />

                      <span
                        style="
                          font-size:0.85rem;
                          color:#94a3b8;
                        "
                      >
                        دقيقة، وسيظهر تنبيه للإدارة بعد انتهاء المهلة
                      </span>
                    </div>
                  </div>
                `;
              } else if (slot.substitute_name) {
                let subStatusColor = "#f59e0b";
                let subStatusText = "⏳ بانتظار رد المعلم";

                if (substituteStatus === "accepted") {
                  subStatusColor = "#10b981";
                  subStatusText = "✅ وافق على التغطية";
                }

                substituteHtml = `
                  <div
                    style="
                      margin-top:12px;
                      padding-top:12px;
                      border-top:1px dashed var(--border-color, #334155);
                      display:flex;
                      justify-content:space-between;
                      align-items:center;
                      gap:8px;
                      flex-wrap:wrap;
                    "
                  >
                    <span
                      style="
                        font-size:0.95rem;
                        color:var(--text-main, #f8fafc);
                      "
                    >
                      <i
                        class="ri-user-shared-2-line"
                        style="color:#3b82f6;"
                      ></i>

                      الاحتياط:

                      <strong>${esc(slot.substitute_name)}</strong>
                    </span>

                    <span
                      style="
                        font-size:0.85rem;
                        background:${subStatusColor}20;
                        color:${subStatusColor};
                        padding:4px 10px;
                        border-radius:6px;
                        font-weight:bold;
                      "
                    >
                      ${subStatusText}
                    </span>
                  </div>
                `;
              }

              return `
                <div
                  style="
                    background:var(--bg-card, #1e293b);
                    border:1px solid var(--border-color, #334155);
                    padding:12px 15px;
                    border-radius:6px;
                    margin-bottom:8px;
                  "
                >
                  <div
                    style="
                      display:flex;
                      justify-content:space-between;
                      gap:8px;
                      flex-wrap:wrap;
                    "
                  >
                    <strong
                      style="
                        color:var(--text-main, #f8fafc);
                        font-size:1.05rem;
                      "
                    >
                      <i
                        class="ri-bookmark-3-line"
                        style="color:#8b5cf6;"
                      ></i>

                      ${esc(periodLabel)}
                    </strong>

                    <span
                      style="
                        direction:ltr;
                        color:var(--text-muted, #94a3b8);
                        font-size:0.9rem;
                      "
                    >
                      ${esc(time)}
                    </span>
                  </div>

                  ${substituteHtml}
                </div>
              `;
            })
            .join("");
        } else {
          /*
            إذا ظهرت هذه الرسالة فالمشكلة من استجابة الباك إند:
            مسار تفاصيل الإذن لا يعيد حصص اليوم الكامل.
          */
          elModalSlotsList.innerHTML = `
            <div
              class="ta-mini"
              style="
                padding:12px;
                color:#f59e0b;
                border:1px dashed rgba(245, 158, 11, 0.55);
                border-radius:6px;
              "
            >
              <i class="ri-alert-line"></i>

              لم تصل قائمة الحصص المتأثرة من الخادم لهذا الطلب.
              أعد تحميل الصفحة، وإذا استمرت المشكلة يجب مراجعة
              استجابة تفاصيل الإذن في الباك إند.
            </div>
          `;
        }
      } else {
        elModalSlotsBox.style.display = "none";
        elModalSlotsList.innerHTML = "";
      }
    }

    const isPending =
      String(permit.status || "").toLowerCase() === "pending";

    const isApproved =
      String(permit.status || "").toLowerCase() === "approved";

    /*
      لا نظهر زر تحديث الاحتياط بعد اكتمال جميع التعيينات.
    */
    const needsSubstituteAssignment =
      Array.isArray(slots) &&
      slots.some((slot) => {
        const substituteStatus = String(
          slot.sub_status || ""
        ).toLowerCase();

        return (
          !slot.substitute_name ||
          substituteStatus === "rejected" ||
          substituteStatus === "expired"
        );
      });

    if (elApprove) {
      if (isPending) {
        elApprove.style.display = "inline-flex";
        elApprove.innerHTML = `
          <i class="ri-check-line"></i>
          <span>قبول</span>
        `;
      } else if (isApproved && needsSubstituteAssignment) {
        elApprove.style.display = "inline-flex";
        elApprove.innerHTML = `
          <i class="ri-save-line"></i>
          <span>تحديث وتعيين الاحتياط</span>
        `;
      } else {
        elApprove.style.display = "none";
      }
    }

    if (elReject) {
      elReject.style.display = isPending ? "inline-flex" : "none";
    }

    if (elDecisionNote?.parentElement) {
      elDecisionNote.parentElement.style.display = isPending
        ? "block"
        : "none";
    }

    openModal();
  }

 async function openDetails(id) {
  try {
    const { permit, slots, teachers } = await loadPermitDetails(id);

    renderModal(permit, slots, teachers);
  } catch (error) {
    toast(
      error?.message || "تعذر تحميل تفاصيل الإذن من الخادم",
      "error"
    );
  }
}

  /* =========================
     Decision
  ========================= */

  async function decide(decision) {
    const permit = state.selected;

    if (!permit) return;

    const current = String(permit.status || "").toLowerCase();

    if (current !== "pending" && current !== "approved") {
      toast("تم اتخاذ قرار نهائي في هذا الطلب مسبقًا", "warn");
      return;
    }

    const note = String(elDecisionNote?.value || "").trim();

    /*
      نبحث داخل نافذة أذونات المعلمين نفسها فقط.
      سابقًا كان البحث قد يلتقط نافذة أخرى في الصفحة.
    */
    const modalBox = elModal || document.body;

    const substituteNodes = modalBox.querySelectorAll(
      ".tp-substitute-select"
    );

    const substitutes = Array.from(substituteNodes)
      .map((node) => {
        const entryId = Number.parseInt(
          node.getAttribute("data-entry-id"),
          10
        );

        const timeInput = modalBox.querySelector(
          `.tp-timeout-input[data-entry-id="${entryId}"]`
        );

        let timeoutMinutes = Number.parseInt(timeInput?.value, 10);

        if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1) {
          timeoutMinutes = 15;
        }

        const substituteId = Number.parseInt(node.value, 10);

        return {
          entry_id: entryId,
          substitute_id: Number.isInteger(substituteId)
            ? substituteId
            : null,
          timeout_minutes: timeoutMinutes,
        };
      })
      .filter(
        (item) =>
          Number.isInteger(item.entry_id) &&
          item.substitute_id !== null
      );

    /*
      عند إعادة تعيين الاحتياط لطلب مقبول:
      لا نرسل نجاحًا وهميًا إذا لم تصل الحصص من الخادم.
    */
    if (
      decision === "approved" &&
      current === "approved" &&
      substituteNodes.length === 0
    ) {
      toast(
        "تعذر عرض الحصص التي تحتاج إلى معلم احتياط. أعد فتح التفاصيل وحاول مرة أخرى.",
        "error"
      );

      return;
    }

    /*
      عند تحديث طلب مقبول يجب تحديد معلم احتياط فعليًا
      قبل إرسال الطلب إلى الباك إند.
    */
    if (
      decision === "approved" &&
      current === "approved" &&
      substitutes.length === 0
    ) {
      toast(
        "اختر معلمًا احتياطًا واحدًا على الأقل قبل الحفظ.",
        "warn"
      );

      if (substituteNodes[0]) {
        substituteNodes[0].focus();
      }

      return;
    }

    try {
      if (state.busy) return;

      state.busy = true;

      if (elApprove) {
        elApprove.disabled = true;
      }

      if (elReject) {
        elReject.disabled = true;
      }

      const newStatus =
        decision === "approved" ? "approved" : "rejected";

      await apiFetch(ENDPOINTS.decision(permit.id), {
        method: "PATCH",
        body: JSON.stringify({
          status: newStatus,
          decision_note: note,
          substitutes,
        }),
      });

      if (current === "approved") {
        toast(
          "تم تحديث تعيين الاحتياط بنجاح، وسيبدأ المؤقت التنازلي ✅",
          "success"
        );
      } else {
        toast("تمت العملية بنجاح ✅", "success");
      }

      closeModal();

      await loadPermits();

      const alertBox = document.getElementById(
        "admin-eagle-eye-alerts"
      );

      if (alertBox) {
        alertBox.style.display = "none";
      }

      if (typeof window.refreshEagleEye === "function") {
        window.refreshEagleEye();
      }
    } catch (error) {
      toast(error?.message || "فشل تنفيذ القرار", "error");
    } finally {
      if (elApprove) {
        elApprove.disabled = false;
      }

      if (elReject) {
        elReject.disabled = false;
      }

      state.busy = false;
    }
  }

  /* =========================
     Events
  ========================= */

  function wireEvents() {
    if (elRefresh) {
      elRefresh.onclick = loadPermits;
    }

    const refreshSoft = () => loadPermits();

    if (elStatus) {
      elStatus.onchange = refreshSoft;
    }

    if (elFrom) {
      elFrom.onchange = refreshSoft;
    }

    if (elTo) {
      elTo.onchange = refreshSoft;
    }

    let timer = null;

    if (elSearch) {
      elSearch.oninput = () => {
        clearTimeout(timer);

        timer = setTimeout(refreshSoft, 250);
      };
    }

    if (elList) {
      elList.onclick = (event) => {
        const button = event.target?.closest("button[data-action]");

        if (!button) return;

        const card = button.closest("[data-id]");
        const id = card?.dataset?.id;

        if (!id) return;

        const action = button.dataset.action;

        if (action === "open") {
          openDetails(id);
          return;
        }

        if (action === "approve") {
          openDetails(id);
          return;
        }

        if (action === "reject") {
          openDetails(id);
        }
      };
    }

    if (elModalClose) {
      elModalClose.onclick = closeModal;
    }

    if (elModalBack) {
      elModalBack.onclick = closeModal;
    }

    if (elModal) {
      elModal.onclick = (event) => {
        if (event.target === elModal) {
          closeModal();
        }
      };
    }

    if (elApprove) {
      elApprove.onclick = () => decide("approved");
    }

    if (elReject) {
      elReject.onclick = () => decide("rejected");
    }
  }

  /* =========================
     Init
  ========================= */

  window.initAdminTeacherPermits = async function () {
    refreshDOMElements();

    if (!elList || !elStatus) return;

    wireEvents();

    if (elStatus && !elStatus.value) {
      elStatus.value = "pending";
    }

    try {
      const searchParams = new URLSearchParams(location.search);

      const status = searchParams.get("status");

      if (status && elStatus) {
        elStatus.value = status;
      }

      const from = searchParams.get("from");

      if (from && elFrom) {
        elFrom.value = from;
      }

      const to = searchParams.get("to");

      if (to && elTo) {
        elTo.value = to;
      }

      const query = searchParams.get("q");

      if (query && elSearch) {
        elSearch.value = query;
      }
    } catch (error) {
      console.error("Teacher permits query params error:", error);
    }

    await loadPermits();
  };

  /* =========================
     SPA Watcher
  ========================= */

  const observer = new MutationObserver(() => {
    const listElement = document.getElementById("tp-list");

    if (listElement && !listElement.dataset.isLoaded) {
      listElement.dataset.isLoaded = "true";

      window.initAdminTeacherPermits();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();