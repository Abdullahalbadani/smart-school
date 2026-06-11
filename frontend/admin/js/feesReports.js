(() => {
  "use strict";

const CONFIG = {
  API_BASE: String(window.API_BASE || "/api").replace(/\/+$/, ""),

  ENDPOINTS: {
      academicYears: "/api/academic-years",
      grades: "/api/grades",
      classes: "/api/classes?gradeId=",
      collections: "/api/fees/reports/collections",
      outstanding: "/api/fees/reports/outstanding",
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const toInt = (v) => (Number.isFinite(parseInt(v || "0", 10)) ? parseInt(v || "0", 10) : 0);
  const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const safe = (v) => (v ?? "").toString();
  const fmt = (n) => toNum(n).toLocaleString("en-US");
function toApiUrl(path) {
  if (!path) return CONFIG.API_BASE;
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path).replace(/^\/+/, "");

  // يمنع تكرار /api/api لأن ENDPOINTS تبدأ بـ /api
  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${CONFIG.API_BASE}/${cleanPath}`;
}

  function fmtDatePretty(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safe(iso);
    return d.toLocaleDateString("ar-YE", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
function getStoredToken() {
  const possibleKeys = ["token", "accessToken", "authToken", "adminToken", "jwt"];
  for (const key of possibleKeys) {
    const ls = window.localStorage?.getItem(key);
    if (ls) return ls;
    const ss = window.sessionStorage?.getItem(key);
    if (ss) return ss;
  }
  return null;
}

function getAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
async function httpGet(path) {
  const url = toApiUrl(path);
const res = await fetch(url, {
  credentials: "include",
  headers: getAuthHeaders({ Accept: "application/json" })
});  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

  class FeesReportsPage {
    constructor(section) {
      this.el = section;
      this.state = { years: [], grades: [], classes: [], lastRows: [], lastType: "collections" };
    }
    applyPreset(preset) {
      const fromEl = this.qs("#frFrom");
      const toEl = this.qs("#frTo");
      if (!fromEl || !toEl) return;

      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00
      const start = new Date(end.getTime());

      if (preset === "today") {
        // start = today
      } else if (preset === "week") {
        // week start (Sat as start for Yemen? we choose Sunday=0? We'll use Monday-style? better: last 6 days + today)
        start.setDate(start.getDate() - 6);
      } else if (preset === "month") {
        start.setDate(1);
      } else if (preset === "term") {
        // term = 90 days default (يمكن تعديلها لاحقًا حسب نظام المدرسة)
        start.setDate(start.getDate() - 89);
      }

      const iso = (d) => d.toISOString().slice(0, 10);
      fromEl.value = iso(start);
      toEl.value = iso(new Date());

      this.toast("تم تطبيق الفترة السريعة.", "success");
    }
    qs(sel) { return this.el.querySelector(sel); }

    toast(msg, type = "info") {
      const t = this.qs("#frToast");
      if (!t) return;
      t.hidden = false;
      t.textContent = msg;
      t.style.borderColor =
        type === "success" ? "rgba(34,197,94,0.65)" :
        type === "error" ? "rgba(239,68,68,0.65)" :
        "rgba(229,231,235,0.9)";
      clearTimeout(this._tt);
      this._tt = setTimeout(() => (t.hidden = true), 2600);
    }

    setState(text) { this.qs("#frState").textContent = text; }

    async init() {
      this.qs("#frReload")?.addEventListener("click", () => this.reload());
      this.qs("#frRun")?.addEventListener("click", () => this.run());
      this.qs("#frExportCsv")?.addEventListener("click", () => this.openSchoolReport("pdf"));
      this.qs("#frPrint")?.addEventListener("click", () => this.openSchoolReport("print"));
      this.qs("#frBackToPay")?.addEventListener("click", () => {
        if (typeof window.openAdminPage === "function") return window.openAdminPage("feesPay.html");
        location.href = "feesPay.html";
      });
      // Preset buttons (collections only)
      this.qsAll(".fr-preset").forEach((btn) => {
        btn.addEventListener("click", () => this.applyPreset(btn.dataset.preset));
      });
      this.qs("#frGrade")?.addEventListener("change", () => this.onGradeChange());

      // Tabs
      this.qsAll(".fr-tab").forEach((btn) => {
        btn.addEventListener("click", () => this.setType(btn.dataset.type));
      });

      await this.loadMeta();
      this.setDefaultDates();
      this.setType("collections");
      this.toast("جاهز للتقارير.", "success");
    }

    qsAll(sel) { return Array.from(this.el.querySelectorAll(sel)); }

    setDefaultDates() {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const frFrom = this.qs("#frFrom");
      const frTo = this.qs("#frTo");
      frFrom.value = frFrom.value || from.toISOString().slice(0, 10);
      frTo.value = frTo.value || now.toISOString().slice(0, 10);
    }

    setType(type) {
      this.state.lastType = type;
      this.qs("#frReportType").value = type;

      // toggle active tab
      this.qsAll(".fr-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.type === type));

      // show/hide collection-only filters
      this.qsAll(".fr-only-collections").forEach((el) => {
        el.style.display = type === "collections" ? "" : "none";
      });

      // titles
      this.qs("#frTableTitle").textContent = type === "collections" ? "تقرير التحصيل" : "تقرير المتأخرات";
      this.qs("#frBreakTitle").textContent = type === "collections" ? "تفصيل التحصيل" : "تفصيل المتأخرات";

      // break card titles
      this.qs("#frBreak1Title").textContent = type === "collections" ? "حسب طريقة الدفع" : "حسب الصف";
      this.qs("#frBreak2Title").textContent = type === "collections" ? "Top الصفوف" : "حسب الشعبة";
      this.qs("#frBreak3Title").textContent = type === "collections" ? "Top الشعب" : "أعلى متأخرات (طلاب)";

      this.renderEmpty();
      this.renderBreakdowns(type, null);
      this.applyKpis({});
    }

    async loadMeta() {
      this.setState("تحميل...");
      const [years, grades] = await Promise.all([
        httpGet(CONFIG.ENDPOINTS.academicYears),
        httpGet(CONFIG.ENDPOINTS.grades),
      ]);
      this.state.years = years || [];
      this.state.grades = grades || [];

      const ySel = this.qs("#frAcademicYear");
      ySel.innerHTML = `<option value="">اختر...</option>`;
      for (const y of this.state.years) {
        const opt = document.createElement("option");
        opt.value = y.id;
        opt.textContent = y.name;
        ySel.appendChild(opt);
      }
      if (this.state.years[0]) ySel.value = this.state.years[0].id;

      const gSel = this.qs("#frGrade");
      gSel.innerHTML = `<option value="">الكل</option>`;
      for (const g of this.state.grades) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        gSel.appendChild(opt);
      }

      await this.loadClassesForGrade(toInt(gSel.value));
      this.setState("جاهز");
    }

    async loadClassesForGrade(gradeId) {
      const cSel = this.qs("#frClass");
      cSel.innerHTML = `<option value="">الكل</option>`;
      this.state.classes = [];
      if (!gradeId) return;

      const rows = await httpGet(`${CONFIG.ENDPOINTS.classes}${encodeURIComponent(gradeId)}`);
      this.state.classes = rows || [];
      for (const c of this.state.classes) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        cSel.appendChild(opt);
      }
    }

    async onGradeChange() {
      const gradeId = toInt(this.qs("#frGrade").value);
      this.qs("#frClass").value = "";
      await this.loadClassesForGrade(gradeId);
    }

    getFilters() {
      return {
        yearId: toInt(this.qs("#frAcademicYear").value),
        gradeId: toInt(this.qs("#frGrade").value),
        classId: toInt(this.qs("#frClass").value),
        from: this.qs("#frFrom").value,
        to: this.qs("#frTo").value,
        method: this.qs("#frMethod").value || "",
        type: this.state.lastType,
      };
    }

    applyKpis(k = {}) {
      this.qs("#frKpiTotalCollected").textContent = fmt(k.totalCollected || 0);
      this.qs("#frKpiPaymentsCount").textContent = fmt(k.paymentsCount || 0);
      this.qs("#frKpiOutstanding").textContent = fmt(k.totalOutstanding || 0);
      this.qs("#frKpiStudentsOutstanding").textContent = fmt(k.studentsOutstanding || 0);

      this.qs("#frKpiHint1").textContent = safe(k.hint1 || "—");
      this.qs("#frKpiHint2").textContent = safe(k.hint2 || "—");
      this.qs("#frKpiHint3").textContent = safe(k.hint3 || "—");
      this.qs("#frKpiHint4").textContent = safe(k.hint4 || "—");
    }

    renderEmpty() {
      this.qs("#frThead").innerHTML = "";
      this.qs("#frTbody").innerHTML = `
        <tr class="fr-emptyRow">
          <td>
            <div class="fr-empty">
              <i class="ri-information-line"></i>
              <span>اختر الفلاتر ثم اضغط “عرض التقرير”.</span>
            </div>
          </td>
        </tr>
      `;
      this.qs("#frRowsCount").textContent = "0 صف";
    }

    renderBreakdowns(type, data) {
      // data.breakdowns expected
      const b1h = this.qs("#frBreak1Head");
      const b1b = this.qs("#frBreak1Body");
      const b2h = this.qs("#frBreak2Head");
      const b2b = this.qs("#frBreak2Body");
      const b3h = this.qs("#frBreak3Head");
      const b3b = this.qs("#frBreak3Body");

      const hint1 = this.qs("#frBreak1Hint");
      const hint2 = this.qs("#frBreak2Hint");
      const hint3 = this.qs("#frBreak3Hint");

      const emptyMini = (tbody, cols, msg) => {
        tbody.innerHTML = `<tr><td colspan="${cols}" style="color:var(--text-muted);padding:12px;">${msg}</td></tr>`;
      };

      if (!data || !data.breakdowns) {
        // headers default per type
        if (type === "collections") {
          b1h.innerHTML = `<tr><th>الطريقة</th><th>عدد</th><th>الإجمالي</th></tr>`;
          b2h.innerHTML = `<tr><th>الصف</th><th>الإجمالي</th></tr>`;
          b3h.innerHTML = `<tr><th>الشعبة</th><th>الإجمالي</th></tr>`;
          emptyMini(b1b, 3, "—");
          emptyMini(b2b, 2, "—");
          emptyMini(b3b, 2, "—");
        } else {
          b1h.innerHTML = `<tr><th>الصف</th><th>طلاب</th><th>المتأخرات</th></tr>`;
          b2h.innerHTML = `<tr><th>الشعبة</th><th>طلاب</th><th>المتأخرات</th></tr>`;
          b3h.innerHTML = `<tr><th>الطالب</th><th>المتبقي</th></tr>`;
          emptyMini(b1b, 3, "—");
          emptyMini(b2b, 3, "—");
          emptyMini(b3b, 2, "—");
        }
        hint1.textContent = "—"; hint2.textContent = "—"; hint3.textContent = "—";
        return;
      }

      const bd = data.breakdowns;

      if (type === "collections") {
        // By Method
             // By Method (table + bars)
        b1h.innerHTML = `<tr><th>الطريقة</th><th>عدد</th><th>الإجمالي</th></tr>`;
        const byMethod = bd.byMethod || [];
        if (!byMethod.length) {
          emptyMini(b1b, 3, "لا يوجد");
          // remove bars if exists
          this.qs("#frMethodBars")?.remove();
        } else {
          b1b.innerHTML = byMethod.map(x => `
            <tr><td>${safe(x.method)}</td><td>${fmt(x.count)}</td><td>${fmt(x.total)}</td></tr>
          `).join("");

          // Bars UI (Top 5)
          const top = byMethod.slice(0, 5);
          const max = Math.max(...top.map(x => Number(x.total || 0)), 1);

          // container (inject under card)
          const card = this.qs("#frBreak1Body")?.closest(".fr-breakCard");
          if (card) {
            // remove existing
            card.querySelector("#frMethodBars")?.remove();

            const wrap = document.createElement("div");
            wrap.id = "frMethodBars";
            wrap.className = "fr-methodBars";
            wrap.style.marginTop = "12px";

            wrap.innerHTML = top.map(x => {
              const pct = Math.round((Number(x.total || 0) / max) * 100);
              return `
                <div class="fr-barRow">
                  <div class="fr-barLabel">${safe(x.method)}</div>
                  <div class="fr-barTrack"><div class="fr-barFill" style="width:${pct}%"></div></div>
                  <div class="fr-barValue">${fmt(x.total)}</div>
                </div>
              `;
            }).join("");

            card.appendChild(wrap);
          }
        }

        // Top Grades
        b2h.innerHTML = `<tr><th>الصف</th><th>الإجمالي</th></tr>`;
        const byGrade = bd.byGrade || [];
        if (!byGrade.length) emptyMini(b2b, 2, "لا يوجد");
        else b2b.innerHTML = byGrade.map(x => `
          <tr><td>${safe(x.gradeName || "—")}</td><td>${fmt(x.total)}</td></tr>
        `).join("");

        // Top Sections
        b3h.innerHTML = `<tr><th>الشعبة</th><th>الإجمالي</th></tr>`;
        const bySection = bd.bySection || [];
        if (!bySection.length) emptyMini(b3b, 2, "لا يوجد");
        else b3b.innerHTML = bySection.map(x => `
          <tr><td>${safe(x.className || "—")}</td><td>${fmt(x.total)}</td></tr>
        `).join("");

        hint1.textContent = "Confirmed فقط";
        hint2.textContent = "Top 5";
        hint3.textContent = "Top 5";
      } else {
        // Outstanding by Grade
        b1h.innerHTML = `<tr><th>الصف</th><th>طلاب</th><th>المتأخرات</th></tr>`;
        const og = bd.byGrade || [];
        if (!og.length) emptyMini(b1b, 3, "لا يوجد");
        else b1b.innerHTML = og.map(x => `
          <tr><td>${safe(x.gradeName || "—")}</td><td>${fmt(x.studentsCount)}</td><td>${fmt(x.totalOutstanding)}</td></tr>
        `).join("");

        // Outstanding by Section
        b2h.innerHTML = `<tr><th>الشعبة</th><th>طلاب</th><th>المتأخرات</th></tr>`;
        const os = bd.bySection || [];
        if (!os.length) emptyMini(b2b, 3, "لا يوجد");
        else b2b.innerHTML = os.map(x => `
          <tr><td>${safe(x.className || "—")}</td><td>${fmt(x.studentsCount)}</td><td>${fmt(x.totalOutstanding)}</td></tr>
        `).join("");

        // Top students
        b3h.innerHTML = `<tr><th>الطالب</th><th>المتبقي</th></tr>`;
        const topStudents = bd.topStudents || [];
        if (!topStudents.length) emptyMini(b3b, 2, "لا يوجد");
        else b3b.innerHTML = topStudents.map(x => `
          <tr><td>${safe(x.studentName)}</td><td>${fmt(x.remaining)}</td></tr>
        `).join("");

        hint1.textContent = "Top 10";
        hint2.textContent = "Top 10";
        hint3.textContent = "Top 10";
      }
    }

    renderCollections(rows) {
      this.qs("#frThead").innerHTML = `
        <tr>
          <th>التاريخ</th><th>الطالب</th><th>الكود</th><th>الصف</th><th>الشعبة</th>
          <th>المبلغ</th><th>الطريقة</th><th>الجهة</th><th>المرجع</th><th>الإيصال</th>
        </tr>
      `;

      if (!rows.length) {
        this.qs("#frTbody").innerHTML = `
          <tr class="fr-emptyRow">
            <td colspan="10"><div class="fr-empty"><i class="ri-information-line"></i><span>لا توجد بيانات.</span></div></td>
          </tr>
        `;
        this.qs("#frRowsCount").textContent = "0 صف";
        return;
      }

      this.qs("#frTbody").innerHTML = rows.map(r => `
        <tr>
          <td>${fmtDatePretty(r.paidAt)}</td>
          <td>${safe(r.studentName)}</td>
          <td>${safe(r.studentCode || "")}</td>
          <td>${safe(r.gradeName || "—")}</td>
          <td>${safe(r.className || "—")}</td>
          <td>${fmt(r.amount)}</td>
          <td>${safe(r.method)}</td>
          <td>${safe(r.provider || "—")}</td>
          <td>${safe(r.reference || "—")}</td>
          <td>${safe(r.receiptNo || "—")}</td>
        </tr>
      `).join("");

      this.qs("#frRowsCount").textContent = `${rows.length} صف`;
    }

   renderOutstanding(rows) {
  this.qs("#frThead").innerHTML = `
    <tr>
      <th>الطالب</th><th>الكود</th><th>الصف</th><th>الشعبة</th>
      <th>الإجمالي السنوي</th><th>المدفوع</th><th>المتبقي</th><th>القسط القادم</th>
      <th>فتح السداد</th>
    </tr>
  `;

  if (!rows.length) {
    this.qs("#frTbody").innerHTML = `
      <tr class="fr-emptyRow">
        <td colspan="9"><div class="fr-empty"><i class="ri-information-line"></i><span>لا توجد متأخرات.</span></div></td>
      </tr>
    `;
    this.qs("#frRowsCount").textContent = "0 صف";
    return;
  }

  this.qs("#frTbody").innerHTML = rows.map(r => `
    <tr>
      <td>
        <button class="fr-linkBtn fr-openPay" type="button"
                data-student-id="${r.studentId || ""}"
                data-student-name="${(r.studentName || "").replaceAll('"','&quot;')}">
          <i class="ri-user-line"></i><span>${safe(r.studentName)}</span>
        </button>
      </td>
      <td>${safe(r.studentCode || "")}</td>
      <td>${safe(r.gradeName || "—")}</td>
      <td>${safe(r.className || "—")}</td>
      <td>${fmt(r.annualAmount)}</td>
      <td>${fmt(r.paidTotal)}</td>
      <td>${fmt(r.remaining)}</td>
      <td>${r.nextDueDate ? fmtDatePretty(r.nextDueDate) : "—"}</td>
      <td>
        <button class="fr-btn fr-btn-ghost fr-openPay"
                type="button"
                data-student-id="${r.studentId || ""}"
                title="فتح صفحة السداد">
          <i class="ri-external-link-line"></i><span>فتح</span>
        </button>
      </td>
    </tr>
  `).join("");

  this.qs("#frRowsCount").textContent = `${rows.length} صف`;

  // bind click
  this.qsAll(".fr-openPay").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sid = btn.dataset.studentId;
      if (!sid) return this.toast("معرّف الطالب غير موجود في التقرير.", "error");

      // خزّن للانتقال
      localStorage.setItem("feesPay_selectedStudentId", sid);
      localStorage.setItem("feesPay_openFromReports", "1");

      // افتح صفحة السداد
      if (typeof window.openAdminPage === "function") {
        window.openAdminPage("feesPay.html");
      } else {
        location.href = "feesPay.html";
      }
    });
  });
}

    async run() {
      const f = this.getFilters();
      if (!f.yearId) return this.toast("اختر السنة الدراسية.", "error");

      this.setState("تحميل...");
      try {
        if (f.type === "collections") {
          const q = new URLSearchParams({
            yearId: String(f.yearId),
            gradeId: f.gradeId ? String(f.gradeId) : "",
            classId: f.classId ? String(f.classId) : "",
            from: f.from || "",
            to: f.to || "",
            method: f.method || "",
          }).toString();

          const data = await httpGet(`${CONFIG.ENDPOINTS.collections}?${q}`);
          this.applyKpis(data.kpis || {});
          this.renderBreakdowns("collections", data);
          this.renderCollections(data.rows || []);
          this.state.lastRows = data.rows || [];
        } else {
          const q = new URLSearchParams({
            yearId: String(f.yearId),
            gradeId: f.gradeId ? String(f.gradeId) : "",
            classId: f.classId ? String(f.classId) : "",
          }).toString();

          const data = await httpGet(`${CONFIG.ENDPOINTS.outstanding}?${q}`);
          this.applyKpis(data.kpis || {});
          this.renderBreakdowns("outstanding", data);
          this.renderOutstanding(data.rows || []);
          this.state.lastRows = data.rows || [];
        }

        this.setState("تم");
      } catch (e) {
        this.setState("فشل");
        this.toast(e.message, "error");
      }
    }

    openSchoolReport(action = "pdf") {
      const filters = this.getFilters();
      if (!filters.yearId) return this.toast("اختر السنة الدراسية.", "error");

      const apiMethod =
        this.state.lastType === "outstanding"
          ? "openFeesOutstandingReport"
          : "openFeesCollectionsReport";

      if (typeof window.SchoolReports?.[apiMethod] !== "function") {
        return this.toast("تعذر تحميل نظام الكشوف الرسمية. أعد تحديث الصفحة.", "error");
      }

      return window.SchoolReports[apiMethod]({
        action,
        filters: {
          year_id: filters.yearId || null,
          grade_id: filters.gradeId || null,
          section_id: filters.classId || null,
          from: this.state.lastType === "collections" ? (filters.from || null) : null,
          to: this.state.lastType === "collections" ? (filters.to || null) : null,
          method: this.state.lastType === "collections" ? (filters.method || null) : null,
        },
      });
    }

    exportCsv() {
      const rows = this.state.lastRows || [];
      if (!rows.length) return this.toast("لا توجد بيانات للتصدير.", "error");

      const type = this.state.lastType;
      const headers =
        type === "collections"
          ? ["paidAt","studentName","studentCode","gradeName","className","amount","method","provider","reference","receiptNo"]
          : ["studentName","studentCode","gradeName","className","annualAmount","paidTotal","remaining","nextDueDate"];

      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => `"${safe(r[h] ?? "").replaceAll('"','""')}"`).join(",")),
      ].join("\n");

  // إضافة \uFEFF في البداية لحل مشكلة اللغة العربية في الإكسل
const blob = new Blob(['\uFEFF' + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = type === "collections" ? "fees_collections.csv" : "fees_outstanding.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      this.toast("تم التصدير.", "success");
    }

    async reload() {
      await this.loadMeta();
      this.toast("تم التحديث.", "success");

    }
  }

  function initIfExists() {
    const section = document.getElementById("feesReportsPage");
    if (!section) return false;

    if (window.__feesReportsInstance && window.__feesReportsInstance.el === section) return true;

    const page = new FeesReportsPage(section);
    window.__feesReportsInstance = page;
    page.init().catch((e) => console.error("feesReports init error:", e));
    return true;
  }

  window.initFeesReportsPage = initIfExists;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIfExists);
  } else {
    initIfExists();
  }

  const mo = new MutationObserver(() => initIfExists());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();