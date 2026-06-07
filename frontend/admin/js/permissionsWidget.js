// frontend/admin/js/permissionsWidget.js
(function () {
  "use strict";

const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

 const $ = (id) => document.getElementById(id);

  const toast = (msg) =>
    typeof window.showToast === "function" ? window.showToast(msg) : console.warn(msg);

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiFetch(path, opts = {}) {
const cleanPath = String(path).replace(/^\/+/, "");
const url = path.startsWith("http") ? path : `${API_BASE}/${cleanPath}`;
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
    } catch (_) {}

    if (!r.ok) {
      const msg = data?.message || data?.error || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function isoLocal(any) {
    const dt = new Date(any);
    if (!isNaN(dt.getTime())) {
      return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
    }
    return String(any || "").slice(0, 10);
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    if (s === "APPROVED") return `<span class="admPermBadge ok">مقبول</span>`;
    if (s === "REJECTED") return `<span class="admPermBadge bad">مرفوض</span>`;
    return `<span class="admPermBadge wait">بانتظار</span>`;
  }

  let __ALL = [];

  function renderStats(rows) {
    const el = $("admPermStats");
    if (!el) return;

    const pending = rows.filter((x) => String(x.status).toUpperCase() === "PENDING").length;
    const approved = rows.filter((x) => String(x.status).toUpperCase() === "APPROVED").length;
    const rejected = rows.filter((x) => String(x.status).toUpperCase() === "REJECTED").length;

    el.innerHTML = `
      <span class="admPermChip wait">بانتظار: <b>${pending}</b></span>
      <span class="admPermChip ok">مقبول: <b>${approved}</b></span>
      <span class="admPermChip bad">مرفوض: <b>${rejected}</b></span>
      <span class="admPermChip">الإجمالي: <b>${rows.length}</b></span>
    `;
  }

  function currentFilter() {
    return String($("admPermFilter")?.value || "PENDING").toUpperCase();
  }

  function filteredRows() {
    const f = currentFilter();
    if (f === "ALL") return __ALL;
    return __ALL.filter((x) => String(x.status || "").toUpperCase() === f);
  }

  function renderTable() {
    const tbody = $("admPermTbody");
    const empty = $("admPermEmpty");
    if (!tbody || !empty) return;

    const rows = filteredRows();
    if (!rows.length) {
      tbody.innerHTML = "";
      empty.style.display = "flex";
      return;
    }
    empty.style.display = "none";

    tbody.innerHTML = rows
      .map((x) => {
        const id = x.id;
        const student = esc(x.student_name || `طالب #${x.student_id}`);
        const date = isoLocal(x.request_date);
        const type = esc(typeLabel(x.type));
        const reason = esc(x.reason_text || "—");
        const status = String(x.status || "").toUpperCase();

        let actions = "";
        if (status === "PENDING") {
          actions = `
            <button class="primary-btn admPermMini ok" data-act="approve" data-id="${id}">قبول</button>
            <button class="primary-btn admPermMini bad" data-act="reject" data-id="${id}">رفض</button>
          `;
        } else {
          actions = `
            <button class="primary-btn admPermMini" data-act="pending" data-id="${id}">إرجاع للانتظار</button>
          `;
        }

        return `
          <tr>
            <td class="admPermStrong">${student}</td>
            <td>${date}</td>
            <td>${type}</td>
            <td class="admPermReason" title="${reason}">${reason}</td>
            <td>${statusBadge(x.status)}</td>
            <td class="admPermActions">${actions}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function load() {
    const date = $("admPermDate")?.value || todayISO();
    const r = await apiFetch(`/admin/permissions?date=${encodeURIComponent(date)}`);
    __ALL = Array.isArray(r?.data) ? r.data : [];
    renderStats(__ALL);
    renderTable();
  }

  async function decide(id, action) {
    const note =
      (await window.AppUI.prompt({
        title: action === "APPROVE" ? "قبول الإذن" : "رفض الإذن",
        message: action === "APPROVE" ? "أضف ملاحظة القبول إذا رغبت." : "أضف سبب الرفض إذا رغبت.",
        defaultValue: "",
        confirmText: action === "APPROVE" ? "قبول الإذن" : "رفض الإذن",
        cancelText: "إلغاء",
      })) || null;

    await apiFetch(`/admin/permissions/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    });

    toast(action === "APPROVE" ? "تم قبول الإذن ✅" : "تم رفض الإذن ✅");
    await load();
  }

  async function backToPending(id) {
    const note =
      (await window.AppUI.prompt({
        title: "إرجاع الإذن للانتظار",
        message: "أضف ملاحظة الإرجاع إذا رغبت.",
        defaultValue: "",
        confirmText: "إرجاع للانتظار",
        cancelText: "إلغاء",
      })) || null;

    await apiFetch(`/admin/permissions/${id}/override`, {
      method: "POST",
      body: JSON.stringify({ status: "PENDING", note }),
    });

    toast("تم الإرجاع للانتظار ✅");
    await load();
  }

  function bind() {
    $("admPermDate")?.addEventListener("change", load);
    $("admPermFilter")?.addEventListener("change", renderTable);
    $("admPermRefresh")?.addEventListener("click", load);

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest?.("button[data-act][data-id]");
      if (!btn) return;

      const act = btn.getAttribute("data-act");
      const id = Number(btn.getAttribute("data-id") || 0);
      if (!id) return;

      btn.disabled = true;
      try {
        if (act === "approve") await decide(id, "APPROVE");
        else if (act === "reject") await decide(id, "REJECT");
        else if (act === "pending") await backToPending(id);
      } catch (err) {
        toast(err.message || "تعذر تنفيذ العملية");
      } finally {
        btn.disabled = false;
      }
    });
  }

  (function init() {
    if (!$("admPermWidget")) return;
    if ($("admPermDate") && !$("admPermDate").value) $("admPermDate").value = todayISO();
    bind();
    load().catch((e) => toast(e.message || "تعذر تحميل أذونات اليوم"));
  })();
})();
