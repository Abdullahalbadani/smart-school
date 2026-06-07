(() => {
  "use strict";

  if (window.__PARENT_FEES_MODAL_LOADED__) return;
  window.__PARENT_FEES_MODAL_LOADED__ = true;

  const API_BASE = "/api";
  const ACTIVE_CHILD_KEY = "parent_active_child_id";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiGet(path) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const r = await fetch(url, { headers: { ...authHeaders() } });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error(data?.message || `Request failed: ${r.status}`);
    return data;
  }

  async function apiPostForm(path, formData) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const r = await fetch(url, { method:"POST", headers: { ...authHeaders() }, body: formData });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error(data?.message || `Request failed: ${r.status}`);
    return data;
  }

  function fmt(n) { return (Number(n) || 0).toLocaleString("en-US"); }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("ar-YE", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  function statusLabel(s) {
    const map = { unpaid:"غير مدفوع", partial:"جزئي", paid:"مدفوع", pending:"قيد المراجعة", confirmed:"مؤكد", voided:"ملغى" };
    return map[s] || s || "—";
  }
  function methodLabel(m) {
    const map = { cash:"نقدًا", transfer:"حوالة", wallet:"محفظة", card:"بطاقة", other:"أخرى" };
    return map[m] || m || "—";
  }

  function resolveModal(target) {
    if (!target) return null;
    if (typeof target === "string") return document.querySelector(target) || document.getElementById(target.replace(/^#/, ""));
    if (target instanceof Element) return target;
    return null;
  }

  function openModal(target) {
    const modal = resolveModal(target);
    if (!modal) return null;
    modal.classList.add("is-open");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    return modal;
  }

  function closeModal(target) {
    const modal = resolveModal(target);
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.style.display = "";
    modal.setAttribute("aria-hidden", "true");
  }

  window.openModal = openModal;
  window.closeModal = closeModal;

  function getActiveStudentId(explicitId = null) {
    return explicitId || localStorage.getItem(ACTIVE_CHILD_KEY) || "";
  }

  function toast(msg, type = "info") {
    if (window.AppUI?.toast) return window.AppUI.toast(msg, type);
    const t = $("#feesToast");
    if (t) {
      t.hidden = false;
      t.textContent = msg;
      clearTimeout(window.__feesToastTimer);
      window.__feesToastTimer = setTimeout(() => (t.hidden = true), 2600);
      return;
    }
    if (typeof window.showToast === "function") return window.showToast(msg);
    console.warn(msg);
  }

  function wireTabs(modal) {
    const tabs = $$(".fees-tab", modal);
    const panels = $$(".fees-panel", modal);

    tabs.forEach(t => {
      t.addEventListener("click", async () => {
        tabs.forEach(x => x.classList.toggle("is-active", x === t));
        const tab = t.dataset.tab;
        panels.forEach(p => p.hidden = (p.dataset.panel !== tab));

        if (tab === "installments" || tab === "payments") {
          const sid = getActiveStudentId();
          if (!sid) return;
          try {
            await loadAndRender(sid);
          } catch (e) {
            console.error("[fees] tab reload error:", e);
          }
        }
      });
    });
  }

  function renderSummary(el, summary, yearName) {
    el.innerHTML = `
      <div class="fees-chip">
        <div class="k">الإجمالي السنوي</div>
        <div class="v">${fmt(summary.totalAnnual)}</div>
        <div class="s">${yearName || "—"}</div>
      </div>
      <div class="fees-chip">
        <div class="k">المدفوع (مؤكد)</div>
        <div class="v">${fmt(summary.paidConfirmed)}</div>
        <div class="s">Confirmed</div>
      </div>
      <div class="fees-chip is-soft">
        <div class="k">المتبقي</div>
        <div class="v">${fmt(summary.remaining)}</div>
        <div class="s">${summary.nextDueDate ? `القسط القادم: ${fmtDate(summary.nextDueDate)}` : "—"}</div>
      </div>
      <div class="fees-chip">
        <div class="k">طلبات قيد المراجعة</div>
        <div class="v">${fmt(summary.pendingTotal || 0)}</div>
        <div class="s">Pending</div>
      </div>
    `;
  }

  function renderInstallments(tbody, rows) {
    if (!rows?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="fees-empty">لا توجد أقساط.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const bal = Math.max(0, (Number(r.amount)||0) - (Number(r.paidAmount)||0));
      return `
        <tr>
          <td>${r.installmentNo}</td>
          <td>${fmtDate(r.dueDate)}</td>
          <td>${fmt(r.amount)}</td>
          <td>${fmt(r.paidAmount)}</td>
          <td>${fmt(bal)}</td>
          <td>${statusLabel(r.status)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderPayments(tbody, rows) {
    if (!rows?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="fees-empty">لا توجد دفعات.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(p => {
      const attachment = p.attachmentUrl ? `<a href="${p.attachmentUrl}" target="_blank">عرض</a>` : "—";
      return `
        <tr>
          <td>${fmtDate(p.paidAt)}</td>
          <td>${fmt(p.amount)}</td>
          <td>${methodLabel(p.method)}</td>
          <td>${p.provider || "—"}</td>
          <td>${p.reference || "—"}</td>
          <td>${statusLabel(p.status)}</td>
          <td>${attachment}</td>
        </tr>
      `;
    }).join("");
  }

  function methodHelp(method) {
    const tips = {
      wallet: "قم بالدفع عبر المحفظة ثم أدخل رقم العملية وارفع السند. الأفضل رفع صورة واضحة.",
      transfer: "قم بالتحويل البنكي/الحوالة ثم أدخل رقم المرجع وارفع السند (صورة/ PDF).",
      cash: "إذا سلّمت المبلغ للمدرسة نقدًا، اكتب ملاحظة (اختياري).",
      card: "إذا استخدمت بطاقة، أدخل المرجع/رقم العملية (إن وجد).",
      other: "اختر هذا الخيار لأي طريقة غير موجودة، واكتب التفاصيل في الملاحظة."
    };
    return tips[method] || "اختر نوع الدفع لإظهار النصائح.";
  }

  function updateSendEnabled() {
    const amount = Number($("#paPayAmount")?.value || 0);
    const method = $("#paPayMethod")?.value || "";
    const btn = $("#paSendRequest");
    if (!btn) return;
    btn.disabled = !(amount > 0 && method);
  }

  function resetForm() {
    $("#paPayAmount").value = "";
    $("#paPayMethod").value = "";
    $("#paProvider").value = "";
    $("#paReference").value = "";
    $("#paNote").value = "";
    $("#paAttachment").value = "";
    $("#paMethodDetails").textContent = "اختر نوع الدفع لإظهار ملاحظات/نصائح.";
    updateSendEnabled();
  }

  async function loadAndRender(studentId) {
    console.log("[fees] loadAndRender studentId =", studentId);

    const data = await apiGet(`/parent/fees/overview?studentId=${encodeURIComponent(studentId)}`);
    console.log("[fees] overview response =", data);

    const subEl = $("#feesParentSub");
    const summaryEl = $("#paFeesSummary");
    const installmentsEl = $("#paInstallmentsBody");
    const paymentsEl = $("#paPaymentsBody");

    if (!subEl || !summaryEl || !installmentsEl || !paymentsEl) {
      throw new Error("بعض عناصر نافذة الرسوم غير موجودة في الصفحة.");
    }

    subEl.textContent = data?.year?.name ? `السنة: ${data.year.name}` : "—";
    
    const summary = data.summary || {};
    renderSummary(summaryEl, summary, data?.year?.name);
    renderInstallments(installmentsEl, data.installments || []);
    renderPayments(paymentsEl, data.payments || []);

    // ✅ إخفاء نموذج الدفع إذا اكتملت الرسوم لحماية النظام
    const isFullyPaid = summary.totalAnnual > 0 && summary.remaining === 0 && (summary.pendingTotal || 0) === 0;
    
    const formCard = $("#paPaymentFormCard");
    const paidMsg = $("#paFullyPaidMsg");

    if (formCard && paidMsg) {
      if (isFullyPaid) {
        formCard.hidden = true;  
        paidMsg.hidden = false;  
      } else {
        formCard.hidden = false; 
        paidMsg.hidden = true;   
      }
    }
  }

  window.reloadParentFeesData = async (studentId = null) => {
    try {
      const sid = getActiveStudentId(studentId);
      if (!sid) return;
      await loadAndRender(sid);
    } catch (e) {
      console.error("[fees] reloadParentFeesData error:", e);
    }
  };

  async function sendPaymentRequest(studentId) {
    const amount = Number($("#paPayAmount").value || 0);
    const method = $("#paPayMethod").value || "";
    const provider = $("#paProvider").value || "";
    const reference = $("#paReference").value || "";
    const note = $("#paNote").value || "";
    const file = $("#paAttachment").files?.[0] || null;

    if (!(amount > 0)) return toast("أدخل مبلغ صحيح.");
    if (!method) return toast("اختر نوع الدفع.");

    if ((method === "wallet" || method === "transfer") && !file) {
      toast("يفضّل رفع سند للحوالة/المحفظة لتسريع اعتماد الطلب.");
    }

    const fd = new FormData();
    fd.append("studentId", String(studentId));
    fd.append("amount", String(amount));
    fd.append("method", method);
    fd.append("provider", provider);
    fd.append("reference", reference);
    fd.append("note", note);
    if (file) fd.append("attachment", file);

    $("#paSendRequest").disabled = true;

    try {
      await apiPostForm(`/parent/fees/payment-request`, fd);
      toast("تم إرسال طلب الدفع (قيد المراجعة).");
      resetForm();
      await loadAndRender(studentId);
      document.querySelector('#modal-fees-parent .fees-tab[data-tab="payments"]')?.click();
    } catch (e) {
      toast(e.message);
    } finally {
      updateSendEnabled();
    }
  }

  function initParentFeesModal() {
    const modal = $("#modal-fees-parent");
    if (!modal) return;

    wireTabs(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
    modal.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", () => closeModal(modal)));

    $("#paPayMethod")?.addEventListener("change", () => {
      $("#paMethodDetails").textContent = methodHelp($("#paPayMethod").value);
      updateSendEnabled();
    });

    $("#paPayAmount")?.addEventListener("input", updateSendEnabled);
    $("#paProvider")?.addEventListener("input", updateSendEnabled);
    $("#paReference")?.addEventListener("input", updateSendEnabled);

    $("#paReset")?.addEventListener("click", resetForm);

    $("#paSendRequest")?.addEventListener("click", async () => {
      const studentId = getActiveStudentId(); // ✅ تم الاعتماد على هذه الدالة لتجنب الخطأ
      if (!studentId) return toast("لم يتم تحديد طالب. اختر ابنًا أولاً.");
      await sendPaymentRequest(studentId);
    });

    window.openParentFeesModal = async (studentId = null) => {
      try {
        const sid = getActiveStudentId(studentId);
        if (!sid) {
          toast("لم يتم تحديد طالب.");
          return;
        }

        const modal = openModal("#modal-fees-parent");
        if (!modal) {
          toast("نافذة الرسوم غير موجودة.");
          return;
        }

        resetForm();
        modal.querySelector('.fees-tab[data-tab="installments"]')?.click();
        await loadAndRender(sid);
      } catch (e) {
        console.error("[fees] openParentFeesModal error:", e);
        toast(e.message || "تعذر تحميل بيانات الرسوم.");
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initParentFeesModal);
  } else {
    initParentFeesModal();
  }
})();