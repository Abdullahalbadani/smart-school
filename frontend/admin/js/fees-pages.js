/* frontend/admin/js/fees-pay.js */
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://localhost:5000/api";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getToken() {
    return localStorage.getItem("token") || "";
  }

  async function apiGet(path) {
    const res = await fetch(API_BASE + path, {
      headers: { Authorization: "Bearer " + getToken() },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || "Request failed");
    return json.data ?? json;
  }

  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || "Request failed");
    return json.data ?? json;
  }

  function money(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function dayNameAr(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return new Intl.DateTimeFormat("ar", { weekday: "long" }).format(d);
  }

  function toast(msg) {
    alert(msg);
  }

  function openModal(modal, open) {
    modal.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function getRange(range, fromEl, toEl) {
    const now = new Date();
    let from = "", to = "";
    if (range === "today") {
      const d = now.toISOString().slice(0, 10);
      from = d; to = d;
    } else if (range === "thisMonth") {
      const y = now.getFullYear();
      const m = now.getMonth();
      from = new Date(y, m, 1).toISOString().slice(0, 10);
      to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    } else {
      from = fromEl.value;
      to = toEl.value;
    }
    return { from, to };
  }

  async function fillYears(sel) {
    const years = await apiGet("/academic-years"); // عدّل إذا مسارك مختلف
    sel.innerHTML = `<option value="">اختر السنة</option>`;
    (years || []).forEach((y) => {
      const opt = document.createElement("option");
      opt.value = y.id;
      opt.textContent = y.name || y.title || `Year ${y.id}`;
      sel.appendChild(opt);
    });
  }
  async function fillStages(sel) {
    const list = await apiGet("/stages");
    const keep = sel.querySelector("option")?.outerHTML || `<option value="">الكل</option>`;
    sel.innerHTML = keep;
    (list || []).forEach((x) => {
      const opt = document.createElement("option");
      opt.value = x.id; opt.textContent = x.name;
      sel.appendChild(opt);
    });
  }
  async function fillGrades(sel, stageId) {
    const url = stageId ? `/grades?stage_id=${stageId}` : `/grades`;
    const list = await apiGet(url);
    const keep = sel.querySelector("option")?.outerHTML || `<option value="">الكل</option>`;
    sel.innerHTML = keep;
    (list || []).forEach((x) => {
      const opt = document.createElement("option");
      opt.value = x.id; opt.textContent = x.name;
      sel.appendChild(opt);
    });
  }
  async function fillSections(sel, gradeId) {
    const url = gradeId ? `/sections?grade_id=${gradeId}` : `/sections`;
    const list = await apiGet(url);
    const keep = sel.querySelector("option")?.outerHTML || `<option value="">الكل</option>`;
    sel.innerHTML = keep;
    (list || []).forEach((x) => {
      const opt = document.createElement("option");
      opt.value = x.id; opt.textContent = x.name;
      sel.appendChild(opt);
    });
  }

  // ===== Tabs =====
  function setTab(root, tab) {
    $$(".fpTab", root).forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
    $$(".fpView", root).forEach((v) => v.classList.toggle("is-active", v.dataset.view === tab));

    // sub filters
    $("#fpRequestsSub", root).style.display = tab === "requests" ? "" : "none";
    $("#fpLedgerSub", root).style.display = tab === "ledger" ? "" : "none";
  }

  // ===== Requests =====
  async function loadRequests(root) {
    const year = $("#fpYear", root).value;
    if (!year) {
      $("#fpRequestsList", root).innerHTML = `<div class="fpEmpty">اختر السنة أولاً.</div>`;
      return;
    }

    const stage = $("#fpStage", root).value;
    const grade = $("#fpGrade", root).value;
    const section = $("#fpSection", root).value;
    const search = ($("#fpSearch", root).value || "").trim();

    const status = $("#fpReqStatus", root).value;
    const method = $("#fpReqMethod", root).value;
    const range = $("#fpReqRange", root).value;

    $$(".fpReqCustom", root).forEach((x) => (x.style.display = range === "custom" ? "" : "none"));
    const { from, to } = getRange(range, $("#fpReqFrom", root), $("#fpReqTo", root));

    // ✅ Endpoint مقترح (سنربطه بالباكند لاحقًا)
    // GET /fees/requests?academic_year_id=...&status=pending&from=...&to=...
    const q = new URLSearchParams();
    q.set("academic_year_id", year);
    if (stage) q.set("stage_id", stage);
    if (grade) q.set("grade_id", grade);
    if (section) q.set("section_id", section);
    if (search) q.set("search", search);
    if (status) q.set("status", status);
    if (method) q.set("method", method);
    if (from) q.set("from", from);
    if (to) q.set("to", to);

    $("#fpRequestsList", root).innerHTML = `<div class="fpEmpty">جاري التحميل...</div>`;

    let data;
    try {
      data = await apiGet(`/fees/requests?${q.toString()}`);
    } catch (e) {
      $("#fpRequestsList", root).innerHTML = `<div class="fpEmpty">⚠️ لم يتم ربط API طلبات الدفع بعد. (fees/requests)</div>`;
      $("#fpReqCount", root).textContent = "—";
      return;
    }

    const items = data.requests || [];
    $("#fpReqCount", root).textContent = items.length;

    if (!items.length) {
      $("#fpRequestsList", root).innerHTML = `<div class="fpEmpty">لا توجد طلبات.</div>`;
      return;
    }

    $("#fpRequestsList", root).innerHTML = items
      .map((r) => {
        const pillClass =
          r.status === "approved" ? "fpPill--approved" :
          r.status === "rejected" ? "fpPill--rejected" : "fpPill--pending";

        const when = r.created_at ? new Date(r.created_at) : null;
        const date = when ? when.toISOString().slice(0, 10) : "—";
        const time = when ? when.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "";
        const note = (r.note || "").slice(0, 90);

        return `
          <article class="fpCard">
            <div class="fpCard__main">
              <div class="fpCard__title">
                <b>${r.student_name}</b>
                <span class="fpPill ${pillClass}">${r.status || "pending"}</span>
                <span class="fpPill">${r.method || "—"}</span>
              </div>
              <div class="fpCard__meta">
                <div>الكود: <b>${r.student_code || "—"}</b> • القيد: <b>${r.enrollment_id}</b></div>
                <div>التاريخ: <b>${date}</b> • الوقت: <b>${time}</b></div>
                <div>${note ? `ملاحظة: ${note}` : ""}</div>
              </div>
            </div>

            <div class="fpCard__right">
              <div class="fpAmt">${money(r.amount)}</div>
              <button class="fpLink" data-open-req="${r.id}">عرض</button>
            </div>
          </article>
        `;
      })
      .join("");

    $$("[data-open-req]", root).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-open-req");
        await openRequestModal(root, id);
      });
    });
  }

  async function openRequestModal(root, reqId) {
    const modal = $("#fpReqModal", root);
    const body = $("#fpReqModalBody", root);

    openModal(modal, true);
    body.innerHTML = `<div class="fpEmpty">جاري التحميل...</div>`;

    let data;
    try {
      data = await apiGet(`/fees/requests/${reqId}`);
    } catch {
      body.innerHTML = `<div class="fpEmpty">⚠️ لم يتم ربط تفاصيل الطلب بعد. (fees/requests/:id)</div>`;
      $("#fpApproveBtn", root).disabled = true;
      $("#fpRejectBtn", root).disabled = true;
      return;
    }

    const r = data.request;
    $("#fpApproveBtn", root).disabled = r.status !== "pending";
    $("#fpRejectBtn", root).disabled = r.status !== "pending";

    body.innerHTML = `
      <div class="fpMiniInfo">
        <div>الطالب: <b>${r.student_name}</b> (${r.student_code || "—"})</div>
        <div>المبلغ: <b>${money(r.amount)}</b></div>
        <div>الطريقة: <b>${r.method || "—"}</b></div>
        <div>الحالة: <b>${r.status}</b></div>
      </div>
      <div style="margin-top:12px; color:var(--text-muted); line-height:1.8">
        <div><b>ملاحظة:</b> ${r.note || "—"}</div>
        <div><b>رقم إيصال:</b> ${r.receipt_no || "—"}</div>
      </div>

     <div style="margin-top:12px">
  <b>المرفقات:</b>
  <div class="fpAttachGrid">
    ${
      (r.attachments || []).length
        ? r.attachments.map(a => `
            <a class="fpAttach" href="${a.url}" target="_blank" title="${a.original_name || ''}">
              <img src="${a.url}" alt="attachment" />
            </a>
          `).join("")
        : `<span class="fpPill">لا يوجد</span>`
    }
  </div>
</div>

    `;

    // bind approve/reject
    $("#fpApproveBtn", root).onclick = async () => {
      try {
        await apiPost(`/fees/requests/${reqId}/approve`, {});
        toast("تم اعتماد الطلب وتحويله إلى دفعة ✅");
        openModal(modal, false);
        await refreshAll(root);
      } catch (e) {
        toast(e.message);
      }
    };

    $("#fpRejectBtn", root).onclick = async () => {
      const reason = prompt("سبب الرفض (اختياري):") || "";
      try {
        await apiPost(`/fees/requests/${reqId}/reject`, { reason });
        toast("تم رفض الطلب ✅");
        openModal(modal, false);
        await refreshAll(root);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  // ===== Ledger (approved payments only) =====
  async function loadLedger(root) {
    const year = $("#fpYear", root).value;
    if (!year) {
      $("#fpLedgerDays", root).innerHTML = `<div class="fpEmpty">اختر السنة أولاً.</div>`;
      return;
    }

    const stage = $("#fpStage", root).value;
    const grade = $("#fpGrade", root).value;
    const section = $("#fpSection", root).value;
    const search = ($("#fpSearch", root).value || "").trim();
    const method = $("#fpLedMethod", root).value;
    const range = $("#fpLedRange", root).value;

    $$(".fpLedCustom", root).forEach((x) => (x.style.display = range === "custom" ? "" : "none"));
    const { from, to } = getRange(range, $("#fpLedFrom", root), $("#fpLedTo", root));

    const q = new URLSearchParams();
    q.set("academic_year_id", year);
    if (stage) q.set("stage_id", stage);
    if (grade) q.set("grade_id", grade);
    if (section) q.set("section_id", section);
    if (search) q.set("search", search);
    if (method) q.set("method", method);
    if (from) q.set("from", from);
    if (to) q.set("to", to);

    $("#fpLedgerDays", root).innerHTML = `<div class="fpEmpty">جاري التحميل...</div>`;

    let data;
    try {
      data = await apiGet(`/fees/payments/daily?${q.toString()}`);
    } catch (e) {
      $("#fpLedgerDays", root).innerHTML = `<div class="fpEmpty">${e.message}</div>`;
      return;
    }

    const days = data.days || [];
    $("#fpLedCount", root).textContent = days.reduce((a, d) => a + Number(d.payments_count || 0), 0);

    const totalAll = days.reduce((a, d) => a + Number(d.total_amount || 0), 0);
    const countAll = days.reduce((a, d) => a + Number(d.payments_count || 0), 0);
    const studentsSet = new Set();
    days.forEach((d) => (d.payments || []).forEach((p) => studentsSet.add(p.student_id)));

    $("#fpSumTotal", root).textContent = money(totalAll);
    $("#fpSumCount", root).textContent = money(countAll);
    $("#fpSumStudents", root).textContent = money(studentsSet.size);

    if (!days.length) {
      $("#fpLedgerDays", root).innerHTML = `<div class="fpEmpty">لا توجد دفعات ضمن هذه الفلاتر.</div>`;
      return;
    }

    // newest day first + newest payment first
    $("#fpLedgerDays", root).innerHTML = days
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((d) => {
        const w = dayNameAr(d.date);
        const rows = (d.payments || [])
          .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at))
          .map((p) => {
            const t = new Date(p.paid_at);
            const time = t.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
            const alloc = (p.allocations || [])
              .map((x) => `${x.title}: ${money(x.amount)}`)
              .join(" • ");

            return `
              <tr>
                <td>${time}</td>
                <td><b>${p.student_name}</b><div style="color:var(--text-muted); font-size:12px">${p.student_code || ""}</div></td>
                <td>${money(p.amount)}</td>
                <td>${p.method || ""}</td>
                <td>${p.receipt_no || "—"}</td>
                <td>${alloc || "—"}</td>
                <td>${p.note || "—"}</td>
              </tr>
            `;
          })
          .join("");

        return `
          <article class="fpDay">
            <div class="fpDay__head">
              <div><b>${w} ${d.date}</b></div>
              <div class="fpChips">
                <span class="fpChip">إجمالي: ${money(d.total_amount)}</span>
                <span class="fpChip">دفعات: ${money(d.payments_count)}</span>
                <span class="fpChip">طلاب: ${money(d.students_count)}</span>
              </div>
            </div>
            <div class="fpTableWrap">
              <table class="fpTable">
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>الطالب</th>
                    <th>المبلغ</th>
                    <th>الطريقة</th>
                    <th>الإيصال</th>
                    <th>توزيع الدفعة</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || `<tr><td colspan="7" style="padding:14px; color:var(--text-muted)">لا توجد دفعات</td></tr>`}
                </tbody>
              </table>
            </div>
          </article>
        `;
      })
      .join("");
  }

  // ===== Manual payment modal =====
  async function bindManualPayment(root) {
    const modal = $("#fpPayModal", root);

    $("#fpManualPayBtn", root).addEventListener("click", () => openModal(modal, true));

    $("#fpStuSearch", root).addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const q = (e.target.value || "").trim();
      const year = $("#fpYear", root).value;
      if (!q) return;
      if (!year) return toast("اختر السنة أولاً");

      const params = new URLSearchParams({ academic_year_id: year, search: q });
      const stage = $("#fpStage", root).value;
      const grade = $("#fpGrade", root).value;
      const section = $("#fpSection", root).value;
      if (stage) params.set("stage_id", stage);
      if (grade) params.set("grade_id", grade);
      if (section) params.set("section_id", section);

      const data = await apiGet(`/fees/students?${params.toString()}`);
      const list = data.students || [];

      const pick = $("#fpStuPick", root);
      pick.innerHTML = `<option value="">— اختر —</option>`;
      list.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.enrollment_id;
        opt.textContent = `${s.student_name} — ${s.student_code || ""}`;
        opt.dataset.total = s.total_amount;
        opt.dataset.paid = s.paid_amount;
        opt.dataset.rem = s.remaining_amount;
        pick.appendChild(opt);
      });
    });

    $("#fpStuPick", root).addEventListener("change", (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      $("#fpITotal", root).textContent = money(opt.dataset.total);
      $("#fpIPaid", root).textContent = money(opt.dataset.paid);
      $("#fpIRem", root).textContent = money(opt.dataset.rem);
    });

    $("#fpSubmitPay", root).addEventListener("click", async () => {
      const enrollment_id = $("#fpStuPick", root).value;
      const amount = Number($("#fpAmount", root).value || 0);
      const method = $("#fpMethod", root).value;
      const receipt_no = $("#fpReceipt", root).value || null;
      const note = $("#fpNote", root).value || null;

      if (!enrollment_id) return toast("اختر الطالب أولاً");
      if (!amount || amount <= 0) return toast("أدخل مبلغ صحيح");

      try {
        await apiPost("/fees/payments", { enrollment_id, amount, method, receipt_no, note });
        toast("تم تسجيل الدفعة ✅");
        openModal(modal, false);
        await refreshAll(root);
      } catch (e) {
        toast(e.message);
      }
    });
  }

  async function refreshAll(root) {
    const activeTab = $(".fpTab.is-active", root)?.dataset.tab || "requests";
    // في تبويب الطلبات: الملخص ليس مهم (نتركه), وفي التحصيل نحدّث الملخص
    if (activeTab === "requests") {
      $("#fpSumTotal", root).textContent = "—";
      $("#fpSumCount", root).textContent = "—";
      $("#fpSumStudents", root).textContent = "—";
      await loadRequests(root);
    } else {
      await loadLedger(root);
    }
  }

  // ===== Public init =====
  window.initFeesPayPage = async function initFeesPayPage() {
    const root = document.getElementById("feesPayPage");
    if (!root) return;

    // modal close
    $$(".fpModal", root).forEach((m) => {
      m.addEventListener("click", (e) => {
        if (e.target && e.target.getAttribute("data-close") === "1") openModal(m, false);
      });
    });

    // tabs
    $$(".fpTab", root).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tab = btn.dataset.tab;
        setTab(root, tab);
        await refreshAll(root);
      });
    });

    // load shared filters
    await fillYears($("#fpYear", root));
    await fillStages($("#fpStage", root));
    await fillGrades($("#fpGrade", root), "");
    await fillSections($("#fpSection", root), "");

    $("#fpStage", root).addEventListener("change", async () => {
      await fillGrades($("#fpGrade", root), $("#fpStage", root).value);
      await fillSections($("#fpSection", root), "");
    });
    $("#fpGrade", root).addEventListener("change", async () => {
      await fillSections($("#fpSection", root), $("#fpGrade", root).value);
    });

    // refresh
    $("#fpRefreshBtn", root).addEventListener("click", () => refreshAll(root));

    // sub filters re-load
    $("#fpReqRange", root).addEventListener("change", () => loadRequests(root));
    $("#fpReqStatus", root).addEventListener("change", () => loadRequests(root));
    $("#fpReqMethod", root).addEventListener("change", () => loadRequests(root));

    $("#fpLedRange", root).addEventListener("change", () => loadLedger(root));
    $("#fpLedMethod", root).addEventListener("change", () => loadLedger(root));

    // search quick
    $("#fpSearch", root).addEventListener("keydown", (e) => {
      if (e.key === "Enter") refreshAll(root);
    });

    await bindManualPayment(root);

    // start on requests
    setTab(root, "requests");
    await refreshAll(root);
  };
})();
