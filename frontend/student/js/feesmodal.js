(() => {
  "use strict";

  if (window.__STUDENT_FEES_MODAL_LOADED__) return;
  window.__STUDENT_FEES_MODAL_LOADED__ = true;

  const API_BASE = String(
    window.API_BASE || localStorage.getItem("API_BASE") || "http://127.0.0.1:5000/api"
  ).replace(/\/+$/, "");

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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!r.ok) throw new Error(data?.message || `Request failed: ${r.status}`);
    return data;
  }

  function fmt(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function statusLabel(s) {
    const map = {
      unpaid: "غير مدفوع",
      partial: "جزئي",
      paid: "مدفوع",
      pending: "قيد المراجعة",
      confirmed: "مؤكد",
      voided: "ملغى",
    };
    return map[s] || s || "—";
  }

  function methodLabel(m) {
    const map = {
      cash: "نقدًا",
      transfer: "حوالة",
      wallet: "محفظة",
      card: "بطاقة",
      other: "أخرى",
    };
    return map[m] || m || "—";
  }

  function resolveModal(target) {
    if (!target) return null;

    if (typeof target === "string") {
      return document.querySelector(target) || document.getElementById(target.replace(/^#/, ""));
    }

    if (target instanceof Element) {
      return target;
    }

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

  function toast(msg) {
    if (typeof window.showToast === "function") return window.showToast(msg);
    console.log(msg);
  }

  function wireTabs(modal) {
    const tabs = $$(".fees-tab", modal);
    const panels = $$(".fees-panel", modal);

    tabs.forEach((t) => {
      t.addEventListener("click", async () => {
        tabs.forEach((x) => x.classList.toggle("is-active", x === t));
        const tab = t.dataset.tab;
        panels.forEach((p) => (p.hidden = p.dataset.panel !== tab));

        if (tab === "installments" || tab === "payments") {
          try {
            await loadAndRender();
          } catch (e) {
            toast(e.message);
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

    tbody.innerHTML = rows
      .map((r) => {
        const bal = Math.max(0, (Number(r.amount) || 0) - (Number(r.paidAmount) || 0));
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
      })
      .join("");
  }

  function renderPayments(tbody, rows) {
    if (!rows?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="fees-empty">لا توجد دفعات.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((p) => {
        const attachment = p.attachmentUrl
          ? `<a href="${p.attachmentUrl}" target="_blank" rel="noopener noreferrer">عرض</a>`
          : "—";

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
      })
      .join("");
  }

 async function loadAndRender() {
    console.log("[student fees] loadAndRender");

    const data = await apiGet(`http://127.0.0.1:5000/api/student/fees/overview`);
    console.log("[student fees] overview response =", data);

    const subEl = $("#feesStudentSub");
    const summaryEl = $("#stFeesSummary");
    const installmentsEl = $("#stInstallmentsBody");
    const paymentsEl = $("#stPaymentsBody");

    if (!subEl || !summaryEl || !installmentsEl || !paymentsEl) {
      throw new Error("عناصر نافذة رسوم الطالب غير مكتملة في الصفحة.");
    }

    subEl.textContent = data?.year?.name ? `السنة: ${data.year.name}` : "—";
    
    // رسم البيانات الأصلية
    renderSummary(summaryEl, data.summary || {}, data?.year?.name);
    renderInstallments(installmentsEl, data.installments || []);
    renderPayments(paymentsEl, data.payments || []);

    // 🧹 1. إزالة أي رسالة قديمة حتى لا تتكرر عند التنقل بين التبويبات
    const oldMsg = document.getElementById("fees-celebration-msg");
    if (oldMsg) oldMsg.remove();

    // 🎉 2. إضافة الرسالة الفكاهية كنص أنيق يندمج مع التصميم (إذا اكتملت الرسوم)
    if (data && data.summary && data.summary.totalAnnual > 0 && data.summary.remaining <= 0) {
      const msgHtml = `
        <div id="fees-celebration-msg" style="text-align: center; margin-top: 15px; margin-bottom: 5px; color: #34d399; font-size: 15px; font-weight: 600;">
          🎉 تم سداد الرسوم بالكامل! الوالد دفع الفلوس وما قصر، روح حب راسه وادعي له! 🤲
        </div>
      `;
      // إدراج النص مباشرة تحت بطاقات الملخص وقبل جدول الأقساط
      summaryEl.insertAdjacentHTML("afterend", msgHtml);
    }
  }
  function initStudentFeesModal() {
    const modal = $("#modal-fees-student");
    if (!modal) return;

    wireTabs(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });

    modal.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(modal));
    });

    window.openStudentFeesModal = async () => {
      try {
        const opened = openModal("#modal-fees-student");
        if (!opened) {
          toast("نافذة الرسوم غير موجودة.");
          return;
        }

        opened.querySelector('.fees-tab[data-tab="installments"]')?.click();
        await loadAndRender();
      } catch (e) {
        console.error("[student fees] openStudentFeesModal error:", e);
        toast(e.message || "تعذر تحميل بيانات الرسوم.");
      }
    };

    window.reloadStudentFeesData = async () => {
      try {
        await loadAndRender();
      } catch (e) {
        console.error("[student fees] reloadStudentFeesData error:", e);
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStudentFeesModal);
  } else {
    initStudentFeesModal();
  }
})();