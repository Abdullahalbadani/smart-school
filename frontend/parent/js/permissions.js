// frontend/parent/js/features/permissions.js
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "/api";
  const ACTIVE_CHILD_KEY = "parent_active_child_id";

  const $ = (id) => document.getElementById(id);

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
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (!r.ok) {
      const msg = (data && (data.message || data.error)) || ("HTTP " + r.status);
      const err = new Error(msg);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayLocalISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function toLocalISODate(any) {
    const dt = new Date(any);
    if (!isNaN(dt.getTime())) {
      return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
    }
    return String(any || "").slice(0, 10);
  }

  function showMsg(msg, ok) {
    const el = $("pp-msg");
    if (!el) return;
    el.style.display = msg ? "block" : "none";
    el.classList.remove("ok", "err");
    if (msg) el.classList.add(ok ? "ok" : "err");
    el.textContent = msg || "";
  }

  function permissionToast(message, type = "info") {
    if (window.AppUI?.toast) window.AppUI.toast(message, type);
  }

  function typeLabel(t) {
    t = String(t || "").toUpperCase();
    if (t === "ABSENCE") return "غياب";
    if (t === "LATE") return "تأخر";
    if (t === "EARLY_LEAVE") return "انصراف مبكر";
    return t;
  }

  function statusBadge(s) {
    s = String(s || "").toUpperCase();
    const cls = s === "APPROVED" ? "approved" : s === "REJECTED" ? "rejected" : "pending";
    const label = s === "APPROVED" ? "مقبول" : s === "REJECTED" ? "مرفوض" : "بانتظار الإدارة";
    return `<span class="badge ${cls}"><i class="ri-shield-check-line"></i>${label}</span>`;
  }

  function fillFromSelChild() {
    const source = $("selChild");        // ✅ موجود عندك
    const target = $("pp-student");
    const manualWrap = $("pp-student-manual-wrap");
    if (!target) return;

    target.innerHTML = "";

    if (!source || !source.options || source.options.length === 0) {
      if (manualWrap) manualWrap.style.display = "block";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— اختر —";
      target.appendChild(opt);
      return;
    }

    if (manualWrap) manualWrap.style.display = "none";

    for (const opt of Array.from(source.options)) {
      const id = Number(opt.value || 0);
      if (!id) continue;
      const o = document.createElement("option");
      o.value = String(id);
      o.textContent = opt.textContent || ("طالب #" + id);
      target.appendChild(o);
    }

    // اختار الابن النشط إن وجد
    const active = Number(localStorage.getItem(ACTIVE_CHILD_KEY) || 0);
    if (active) target.value = String(active);
    if (!target.value && target.options.length) target.selectedIndex = 0;
  }

  function getSelectedStudentId() {
    const sel = $("pp-student");
    const manual = $("pp-student-manual");
    const v = Number(sel && sel.value ? sel.value : 0);
    if (v) return v;
    const mv = Number(manual && manual.value ? manual.value : 0);
    return mv || 0;
  }

  function toggleTimeFields() {
    const type = String($("pp-type")?.value || "ABSENCE").toUpperCase();
    $("pp-time-from-wrap") && ($("pp-time-from-wrap").style.display = type === "LATE" ? "block" : "none");
    $("pp-time-to-wrap") && ($("pp-time-to-wrap").style.display = type === "EARLY_LEAVE" ? "block" : "none");
  }

  function renderPermissionCard(p) {
    const elCard = $("pp-card");
    const elEmpty = $("pp-status");
    if (!elCard || !elEmpty) return;

    if (!p) {
      elCard.style.display = "none";
      elEmpty.style.display = "flex";
      $("pp-submit") && ($("pp-submit").disabled = false);
      return;
    }

    elEmpty.style.display = "none";
    elCard.style.display = "block";

    const d = toLocalISODate(p.request_date);
    const tf = p.time_from ? String(p.time_from).slice(0,5) : "";
    const tt = p.time_to ? String(p.time_to).slice(0,5) : "";

    elCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div>
          <strong>إذن #${p.id}</strong>
          <div class="muted">التاريخ: ${d} — النوع: ${typeLabel(p.type)}</div>
        </div>
        <div>${statusBadge(p.status)}</div>
      </div>

      <div class="kv">
        <div class="muted">الوقت</div>
        <div>${p.type === "LATE" ? ("وصول: " + (tf || "—")) : p.type === "EARLY_LEAVE" ? ("انصراف: " + (tt || "—")) : "—"}</div>

        <div class="muted">السبب</div>
        <div>${p.reason_text ? String(p.reason_text) : "—"}</div>

        <div class="muted">ملاحظة الإدارة</div>
        <div>${p.decision_note ? String(p.decision_note) : "—"}</div>
      </div>
    `;

    // ✅ قرارك: إذن واحد باليوم مهما كانت النتيجة
    $("pp-submit") && ($("pp-submit").disabled = true);
  }

  async function refreshStatus() {
    showMsg("", true);

    const studentId = getSelectedStudentId();
    const date = $("pp-date")?.value || "";

    if (!studentId || !date) {
      renderPermissionCard(null);
      return;
    }

    try {
      const r = await apiFetch(`/parent/permissions?studentId=${encodeURIComponent(studentId)}&date=${encodeURIComponent(date)}`);
      renderPermissionCard(r?.data || null);
    } catch (e) {
      renderPermissionCard(null);
      showMsg(e.message || "تعذر جلب الحالة", false);
      permissionToast(e.message || "تعذر جلب الحالة", "error");
    }
  }

  async function submitPermission(ev) {
    ev.preventDefault();
    showMsg("", true);

    const studentId = getSelectedStudentId();
    const date = $("pp-date")?.value || "";
    const type = String($("pp-type")?.value || "ABSENCE").toUpperCase();

    const timeFrom = $("pp-time-from")?.value || "";
    const timeTo = $("pp-time-to")?.value || "";
    const reasonText = $("pp-reason")?.value || "";
    const attachmentUrl = $("pp-attachment")?.value || "";

    if (!studentId) {
      permissionToast("اختر الطالب أولاً", "warning");
      return showMsg("اختر الطالب أولاً", false);
    }
    if (!date) {
      permissionToast("اختر التاريخ أولاً", "warning");
      return showMsg("اختر التاريخ أولاً", false);
    }
    if (type === "LATE" && !timeFrom) {
      permissionToast("اختر وقت الوصول المتوقع للتأخر", "warning");
      return showMsg("اختر وقت الوصول المتوقع للتأخر", false);
    }
    if (type === "EARLY_LEAVE" && !timeTo) {
      permissionToast("اختر وقت الانصراف المتوقع", "warning");
      return showMsg("اختر وقت الانصراف المتوقع", false);
    }

    try {
      const payload = {
        studentId,
        date,
        type,
        reasonText: reasonText || null,
        attachmentUrl: attachmentUrl || null,
      };
      if (type === "LATE") payload.timeFrom = timeFrom;
      if (type === "EARLY_LEAVE") payload.timeTo = timeTo;

      const r = await apiFetch("/parent/permissions", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      showMsg("تم إرسال الإذن بنجاح. بانتظار قرار الإدارة.", true);
      permissionToast("تم إرسال الإذن بنجاح. بانتظار قرار الإدارة.", "success");
      renderPermissionCard(r?.data || null);
    } catch (e) {
      if (e.status === 409) {
        showMsg("يوجد إذن مسجل لهذا اليوم بالفعل. تم عرض حالته.", false);
        permissionToast("يوجد إذن مسجل لهذا اليوم بالفعل. تم عرض حالته.", "warning");
        await refreshStatus();
        return;
      }
      showMsg(e.message || "فشل إرسال الإذن", false);
      permissionToast(e.message || "فشل إرسال الإذن", "error");
    }
  }

  function bind() {
    if (!$("parent-permissions")) return;

    const dateEl = $("pp-date");
    if (dateEl && !dateEl.value) dateEl.value = todayLocalISO();

    toggleTimeFields();

    $("pp-type")?.addEventListener("change", toggleTimeFields);

    $("pp-student")?.addEventListener("change", async () => {
      const id = Number($("pp-student")?.value || 0);
      if (id) localStorage.setItem(ACTIVE_CHILD_KEY, String(id));
      await refreshStatus();
    });

    $("pp-student-manual")?.addEventListener("input", refreshStatus);
    $("pp-date")?.addEventListener("change", refreshStatus);
    $("pp-refresh")?.addEventListener("click", refreshStatus);
    $("pp-form")?.addEventListener("submit", submitPermission);

// عند فتح مودال الأذونات، انسخ الأبناء من selChild
document.addEventListener("click", (e) => {
  const card = e.target.closest && e.target.closest('[data-modal="modal-permissions"]');
  if (!card) return;
  setTimeout(() => { // بعد فتح المودال بشوي
    fillFromSelChild();
    refreshStatus();
  }, 50);
});


  }

  (async function init() {
    if (!$("parent-permissions")) return;
    bind();

    // ✅ اقرأ الأبناء من القائمة الأساسية selChild
    fillFromSelChild();

    // لو parent.js يملأ selChild بعد قليل، أعد تعبئة pp-student مرة أخرى
 let tries = 0;
const t = setInterval(() => {
  tries++;
  fillFromSelChild();
  const src = document.getElementById("selChild");
  const ok = src && src.options && src.options.length > 0;
  if (ok || tries >= 20) { // 20 محاولة = حوالي 4 ثواني
    clearInterval(t);
    refreshStatus();
  }
}, 200);


    await refreshStatus();
  })();
})();
