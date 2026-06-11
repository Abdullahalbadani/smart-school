(() => {
  "use strict";

  if (window.__STUDENT_FEES_MODAL_LOADED__) return;
  window.__STUDENT_FEES_MODAL_LOADED__ = true;

  const API_BASE = String(
    window.API_BASE || localStorage.getItem("API_BASE") || "/api"
  ).replace(/\/+$/, "");

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiGet(path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = path.startsWith("http") ? path : API_BASE + normalizedPath;

    const r = await fetch(url, {
      headers: {
        ...authHeaders(),
      },
    });

    const text = await r.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!r.ok) {
      throw new Error(data?.message || `Request failed: ${r.status}`);
    }

    return data;
  }

  function fmt(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  function fmtDate(iso) {
    if (!iso) return "—";

    const d = new Date(iso);

    if (Number.isNaN(d.getTime())) {
      return String(iso);
    }

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
      return (
        document.querySelector(target) ||
        document.getElementById(target.replace(/^#/, ""))
      );
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
    if (typeof window.showToast === "function") {
      return window.showToast(msg);
    }

    console.log(msg);
  }

  function activateTab(modal, tabName) {
    const tabs = $$(".fees-tab", modal);
    const panels = $$(".fees-panel", modal);

    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === tabName);
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tabName;
    });
  }

  function wireTabs(modal) {
    const tabs = $$(".fees-tab", modal);

    tabs.forEach((tab) => {
      tab.addEventListener("click", async () => {
        const tabName = tab.dataset.tab;

        activateTab(modal, tabName);

        if (tabName === "installments" || tabName === "payments") {
          try {
            await loadAndRender();
          } catch (e) {
            console.error("[student fees] tab load error:", e);
            toast(e.message || "تعذر تحميل بيانات الرسوم.");
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
        <div class="s">
          ${
            summary.nextDueDate
              ? `القسط القادم: ${fmtDate(summary.nextDueDate)}`
              : "—"
          }
        </div>
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
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="fees-empty">لا توجد أقساط.</td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const balance = Math.max(
          0,
          (Number(row.amount) || 0) - (Number(row.paidAmount) || 0)
        );

        return `
          <tr>
            <td>${row.installmentNo}</td>
            <td>${fmtDate(row.dueDate)}</td>
            <td>${fmt(row.amount)}</td>
            <td>${fmt(row.paidAmount)}</td>
            <td>${fmt(balance)}</td>
            <td>${statusLabel(row.status)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderPayments(tbody, rows) {
    if (!rows?.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="fees-empty">لا توجد دفعات.</td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML = rows
      .map((payment) => {
        const attachment = payment.attachmentUrl
          ? `<a href="${payment.attachmentUrl}" target="_blank" rel="noopener noreferrer">عرض</a>`
          : "—";

        return `
          <tr>
            <td>${fmtDate(payment.paidAt)}</td>
            <td>${fmt(payment.amount)}</td>
            <td>${methodLabel(payment.method)}</td>
            <td>${payment.provider || "—"}</td>
            <td>${payment.reference || "—"}</td>
            <td>${statusLabel(payment.status)}</td>
            <td>${attachment}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadAndRender() {
    console.log("[student fees] loadAndRender");

    // API_BASE يحتوي مسبقًا على /api
    // الرابط النهائي الصحيح:
    // /api/student/fees/overview
    const data = await apiGet("/student/fees/overview");

    console.log("[student fees] overview response =", data);

    const subEl = $("#feesStudentSub");
    const summaryEl = $("#stFeesSummary");
    const installmentsEl = $("#stInstallmentsBody");
    const paymentsEl = $("#stPaymentsBody");

    if (!subEl || !summaryEl || !installmentsEl || !paymentsEl) {
      throw new Error("عناصر نافذة رسوم الطالب غير مكتملة في الصفحة.");
    }

    subEl.textContent = data?.year?.name
      ? `السنة: ${data.year.name}`
      : "—";

    renderSummary(summaryEl, data.summary || {}, data?.year?.name);
    renderInstallments(installmentsEl, data.installments || []);
    renderPayments(paymentsEl, data.payments || []);

    const oldMsg = document.getElementById("fees-celebration-msg");

    if (oldMsg) {
      oldMsg.remove();
    }

    if (
      data?.summary &&
      Number(data.summary.totalAnnual) > 0 &&
      Number(data.summary.remaining) <= 0
    ) {
      const msgHtml = `
        <div
          id="fees-celebration-msg"
          style="
            text-align: center;
            margin-top: 15px;
            margin-bottom: 5px;
            color: #34d399;
            font-size: 15px;
            font-weight: 600;
          "
        >
          🎉 تم سداد الرسوم بالكامل! الوالد دفع الفلوس وما قصر، روح حب راسه وادعي له! 🤲
        </div>
      `;

      summaryEl.insertAdjacentHTML("afterend", msgHtml);
    }
  }

  function initStudentFeesModal() {
    const modal = $("#modal-fees-student");

    if (!modal) return;

    wireTabs(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
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

        // تفعيل التبويب بدون تنفيذ طلب إضافي مكرر
        activateTab(opened, "installments");

        // تحميل البيانات مرة واحدة فقط عند فتح النافذة
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