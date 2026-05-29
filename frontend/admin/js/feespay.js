/* frontend/admin/js/feesPay.js
   صفحة: سداد الرسوم (feesPay.html)
   - يدعم: البحث عن الطالب + إنشاء عقد (المبلغ السنوي + عدد الأقساط) + توليد الأقساط + تسجيل دفعة + توزيع تلقائي + سجل مدفوعات + طباعة كشف
   - ملاحظة: هذا الملف جاهز للعمل حتى بدون باك-إند (Mock Mode) ويمكن ربطه بـ API بسهولة من خلال CONFIG أدناه.
*/

(() => {
  "use strict";
  /***********************
   * CONFIG (API + OPTIONS)
   ***********************/
 const CONFIG = {
  API_BASE: String(window.API_BASE || "/api").replace(/\/+$/, ""),
  USE_MOCK_IF_API_FAILS: false,
    // لو تحب أن مدفوعات غير النقد (حوالة/محفظة) تكون Pending حتى يعتمدها الأدمن:
    REQUIRE_CONFIRM_FOR_NON_CASH: true,

    ENDPOINTS: {
      academicYears: "/api/academic-years",
      grades: "/api/grades",
      classes: "/api/classes", // ?gradeId=
      studentsSearch: "/api/students/search", // ?q=&yearId=&gradeId=&classId=
      feeContract: "/api/fees/contract", // ?studentId=&yearId=
      createContract: "/api/fees/contracts", // POST
      installments: "/api/fees/installments", // ?contractId=
      payments: "/api/fees/payments", // ?contractId=
createPayment: "/api/fees/payments",
feeAdjustmentRequests: "/api/admin/fee-adjustment-requests",    },
  };

  /***********************
   * UTILITIES
   ***********************/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function toApiUrl(path) {
  if (!path) return CONFIG.API_BASE;
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path).replace(/^\/+/, "");

  // يمنع مشكلة /api/api لأن بعض المسارات داخل هذا الملف تبدأ بـ /api
  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${CONFIG.API_BASE}/${cleanPath}`;
}

  // (اختياري) لو نظامك يستخدم JWT مثل ملف الجرس
  function getStoredToken() {
    const possibleKeys = [
      "token",
      "accessToken",
      "authToken",
      "adminToken",
      "jwt",
    ];
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
  function debounce(fn, wait = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function safeText(v) {
    return (v ?? "").toString();
  }
  function normalizeArabicText(v) {
    return safeText(v)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي");
  }

  function studentMatchesQuery(student, q) {
    const nq = normalizeArabicText(q);
    if (!nq) return true;

    const haystack = [
      student.name,
      student.id,
      student.studentId,
      student.guardianName,
      student.guardianPhone,
      student.phone,
      student.mobile,
      student.parentPhone,
      student.fatherPhone,
    ]
      .map(normalizeArabicText)
      .join(" | ");

    return haystack.includes(nq);
  }
  function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber(n) {
    const x = toNumber(n);
    return x.toLocaleString("en-US");
  }

  function formatDateISO(d) {
    // d: Date
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDatePretty(iso) {
    if (!iso) return "—";
    // iso: YYYY-MM-DD or ISO string
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function addMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);

    // Fix overflow (e.g. Jan 31 -> Mar 3) by snapping back to last day of prev month
    if (d.getDate() !== day) d.setDate(0);
    return d;
  }

  function methodLabel(m) {
    const map = {
      cash: "نقدًا (يدوي)",
      transfer: "حوالة/تحويل",
      wallet: "محفظة",
      card: "بطاقة",
      other: "أخرى",
    };
    return map[m] || "—";
  }

  function statusLabel(s) {
    const map = {
      unpaid: "غير مدفوع",
      partial: "جزئي",
      paid: "مدفوع",
      voided: "ملغى",
      pending: "قيد المراجعة",
      confirmed: "مؤكد",
      failed: "فشل",
      refunded: "مسترجع",
    };
    return map[s] || safeText(s) || "—";
  }

  function computeInstallmentStatus(amount, paid) {
    amount = toNumber(amount);
    paid = toNumber(paid);
    if (paid <= 0) return "unpaid";
    if (paid >= amount) return "paid";
    return "partial";
  }

  function computeContractSummary(annualAmount, installments, payments) {
    const totalAnnual = toNumber(annualAmount);
    const paidTotal = (payments || []).reduce(
      (s, p) => s + toNumber(p.amount),
      0
    );
    const remaining = Math.max(0, totalAnnual - paidTotal);
    const credit = Math.max(0, paidTotal - totalAnnual);

    // next installment: earliest with balance > 0
    const next = (installments || [])
      .slice()
      .sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0))
      .find((x) => toNumber(x.amount) - toNumber(x.paidAmount) > 0);

    return {
      totalAnnual,
      paidTotal,
      remaining,
      credit,
      nextInstallmentText: next
        ? `قسط #${next.installmentNo} — ${formatDatePretty(
            next.dueDate
          )} — المتبقي: ${formatNumber(
            toNumber(next.amount) - toNumber(next.paidAmount)
          )}`
        : "—",
    };
  }

  function makeId(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function genReceiptNo() {
    // رقم إيصال بسيط (استبدله بتوليد من السيرفر لاحقًا)
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    const r = Math.floor(Math.random() * 9000) + 1000;
    return `RC-${y}${m}${d}-${r}`;
  }

  async function httpGet(url) {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: getAuthHeaders({ Accept: "application/json" }),
    });

    // اقرأ الرد حتى لو كان خطأ
    const contentType = res.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");

    if (!res.ok) {
      const msg =
        (payload && payload.message) ||
        (payload && payload.error) ||
        (typeof payload === "string" ? payload : "");
      throw new Error(
        `GET ${url} failed: ${res.status}${msg ? " — " + msg : ""}`
      );
    }

    return payload;
  }

  async function httpPost(url, body, isForm = false) {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: isForm
        ? getAuthHeaders({ Accept: "application/json" }) // لا تضع Content-Type مع FormData
        : getAuthHeaders({
            Accept: "application/json",
            "Content-Type": "application/json",
          }),
      body: isForm ? body : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    return res.json();
  }
  async function httpPatch(url, body) {
    const res = await fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: getAuthHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body || {}),
    });

    const ct = res.headers.get("content-type") || "";
    const payload = ct.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");
    if (!res.ok) {
      const msg = payload?.message || payload?.error || payload || "";
      throw new Error(
        `PATCH ${url} failed: ${res.status}${msg ? " — " + msg : ""}`
      );
    }
    return payload;
  }
  /***********************
   * MOCK DATA (fallback)
   ***********************/
  const MOCK_DB = {
    academicYears: [
      {
        id: "ay1",
        name: "2025-2026",
        startDate: "2025-09-01",
        endDate: "2026-06-30",
      },
    ],
    grades: [
      { id: "g1", name: "الصف الأول" },
      { id: "g2", name: "الصف الثاني" },
    ],
    classes: {
      g1: [
        { id: "c1", name: "أ" },
        { id: "c2", name: "ب" },
      ],
      g2: [{ id: "c3", name: "أ" }],
    },
    students: [
      {
        id: "st1001",
        name: "أحمد محمد",
        gradeId: "g1",
        gradeName: "الصف الأول",
        classId: "c1",
        className: "أ",
        guardianName: "محمد أحمد",
      },
      {
        id: "st1002",
        name: "سارة علي",
        gradeId: "g2",
        gradeName: "الصف الثاني",
        classId: "c3",
        className: "أ",
        guardianName: "علي حسن",
      },
    ],
    contracts: [
      // مثال عقد جاهز
      // { id, studentId, yearId, annualAmount, installmentsCount, createdAt }
    ],
    installments: [
      // { id, contractId, installmentNo, dueDate, amount, paidAmount }
    ],
    payments: [
      // { id, contractId, studentId, paidAt, amount, method, provider, reference, receiptNo, status }
    ],
  };

  function mockSearchStudents({ q, yearId, gradeId, classId }) {
    return MOCK_DB.students.filter((s) => {
      const matchQ = studentMatchesQuery(s, q);
      const matchYear = !yearId || !s.yearId || s.yearId === yearId;
      const matchG = !gradeId || s.gradeId === gradeId;
      const matchC = !classId || s.classId === classId;
      return matchQ && matchYear && matchG && matchC;
    });
  }
  function mockGetContract(studentId, yearId) {
    return (
      MOCK_DB.contracts.find(
        (c) => c.studentId === studentId && c.yearId === yearId
      ) || null
    );
  }

  function mockGetInstallments(contractId) {
    return MOCK_DB.installments.filter((x) => x.contractId === contractId);
  }

  function mockGetPayments(contractId) {
    return MOCK_DB.payments.filter((x) => x.contractId === contractId);
  }

  function mockCreateContract({
    studentId,
    yearId,
    annualAmount,
    installmentsCount,
    firstDueDate,
  }) {
    const existing = mockGetContract(studentId, yearId);
    if (existing)
      throw new Error("يوجد عقد رسوم موجود لهذا الطالب في هذه السنة.");

    const contract = {
      id: makeId("ct"),
      studentId,
      yearId,
      annualAmount: toNumber(annualAmount),
      installmentsCount: toNumber(installmentsCount),
      status: "active",
      createdAt: new Date().toISOString(),
    };
    MOCK_DB.contracts.push(contract);

    const count = toNumber(installmentsCount);
    const total = toNumber(annualAmount);

    // توزيع المبلغ على الأقساط (مع باقي)
    const base = Math.floor(total / count);
    const rem = total - base * count;

    const start = new Date(firstDueDate);
    for (let i = 0; i < count; i++) {
      const amount = base + (i < rem ? 1 : 0);
      const due = addMonths(start, i);

      MOCK_DB.installments.push({
        id: makeId("inv"),
        contractId: contract.id,
        installmentNo: i + 1,
        dueDate: formatDateISO(due),
        amount,
        paidAmount: 0,
      });
    }

    return contract;
  }

  function allocatePaymentToInstallments(contractId, paymentAmount) {
    let remaining = toNumber(paymentAmount);
    const installments = mockGetInstallments(contractId)
      .slice()
      .sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0));

    const allocations = [];

    for (const inst of installments) {
      if (remaining <= 0) break;
      const balance = Math.max(
        0,
        toNumber(inst.amount) - toNumber(inst.paidAmount)
      );
      if (balance <= 0) continue;

      const take = Math.min(balance, remaining);
      inst.paidAmount = toNumber(inst.paidAmount) + take;
      remaining -= take;

      allocations.push({ installmentId: inst.id, allocatedAmount: take });
    }

    return { allocations, leftover: remaining };
  }

  function mockCreatePayment({
    contractId,
    studentId,
    amount,
    method,
    provider,
    reference,
    status,
  }) {
    const paidAt = new Date().toISOString();
    const receiptNo = genReceiptNo();

    const p = {
      id: makeId("pay"),
      contractId,
      studentId,
      paidAt,
      amount: toNumber(amount),
      method,
      provider: safeText(provider),
      reference: safeText(reference),
      receiptNo,
      status,
    };

    MOCK_DB.payments.push(p);

    // لو confirmed نوزع على الأقساط
    if (status === "confirmed") {
      allocatePaymentToInstallments(contractId, p.amount);
    }

    return p;
  }

  /***********************
   * MAIN PAGE CLASS
   ***********************/
  class FeesPayPage {
    async autoOpenFromReports() {
      const sid = localStorage.getItem("feesPay_selectedStudentId");
      const flag = localStorage.getItem("feesPay_openFromReports");

      if (!sid || flag !== "1") return;

      // لا تكرر
      localStorage.removeItem("feesPay_openFromReports");

      // لازم تكون السنة مختارة
      if (!this.state.selectedYearId) return;

      // نجيب الطالب من API search (بالـ id)
      const yearId = this.state.selectedYearId;

      // نستخدم نفس endpoint search لكن نبحث بالـ sid
      const url = `${CONFIG.ENDPOINTS.studentsSearch}?q=${encodeURIComponent(
        sid
      )}&yearId=${encodeURIComponent(yearId)}&gradeId=&classId=`;

      let students = [];
      try {
        students = await this.apiGet(url);
      } catch (e) {
        if (CONFIG.USE_MOCK_IF_API_FAILS) {
          students = []; // في الموك ما مهم الآن
        } else {
          throw e;
        }
      }

      const found =
        (students || []).find((s) => String(s.id) === String(sid)) ||
        (students || [])[0];
      if (!found) {
        this.toast("لم يتم العثور على الطالب من التقارير.", "error");
        return;
      }

      await this.selectStudent(found);
      this.toast("تم فتح ملف الطالب من التقارير.", "success");
    }
  async confirmPayment(paymentId) {
  if (!paymentId) return;

  const ok = await this.confirmDialog({
    title: "اعتماد الدفعة",
    message:
      "سيتم اعتماد هذه الدفعة وتحديث الأقساط والرصيد المالي للطالب.\nهل تريد المتابعة؟",
    confirmText: "اعتماد الدفعة",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!ok) return;

  try {
    this.toast("جاري اعتماد الدفعة...", "info");

    await this.apiPatch(
      `/api/fees/payments/${encodeURIComponent(paymentId)}/confirm`,
      {}
    );

    this.toast("تم اعتماد الدفعة ✅", "success");

    if (this.state.selectedStudent) {
      await this.loadStudentFinance(this.state.selectedStudent);
    }
  } catch (e) {
    console.error(e);
    this.toast(`فشل اعتماد الدفعة: ${e.message}`, "error");
  }
}
    constructor(sectionEl) {
      this.el = sectionEl;
      this.abort = new AbortController();
      this.state = {
        academicYears: [],
        grades: [],
        classes: [],
        selectedYearId: "",
        selectedGradeId: "",
        selectedClassId: "",
        selectedStudent: null,
        searchResults: [],
        lastSearchQuery: "",
        contract: null,
        installments: [],
        payments: [],
      };
    }

    qs(id) {
      return this.el.querySelector(id);
    }

   toast(msg, type = "info") {
  if (window.AppUI?.toast) {
    window.AppUI.toast(msg, type);
    return;
  }

  const toastEl = this.qs("#fpToast");
  if (!toastEl) return;

  toastEl.hidden = false;
  toastEl.textContent = msg;

  toastEl.style.borderColor =
    type === "success"
      ? "rgba(34,197,94,0.65)"
      : type === "error"
      ? "rgba(239,68,68,0.65)"
      : "rgba(229,231,235,0.9)";

  clearTimeout(this._toastTimer);
  this._toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2600);
}

async confirmDialog(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  return confirm(options.message || "هل تريد المتابعة؟");
}

    setBadge(text, kind = "muted") {
      const b = this.qs("#fpStudentBadge");
      if (!b) return;
      b.textContent = text;
      b.classList.toggle("fp-badge-muted", kind === "muted");
    }

    setPaymentState(text, kind = "muted") {
      const b = this.qs("#fpPaymentState");
      if (!b) return;
      b.textContent = text;
      b.classList.toggle("fp-badge-muted", kind === "muted");
    }

    enable(el, v) {
      if (!el) return;
      el.disabled = !v;
    }

    show(el, v) {
      if (!el) return;
      el.hidden = !v;
    }

    async init() {
      // Buttons
      this.qs("#fpReload")?.addEventListener("click", () => this.reloadAll(), {
        signal: this.abort.signal,
      });
      this.qs("#fpOpenReports")?.addEventListener(
        "click",
        () => this.openReports(),
        { signal: this.abort.signal }
      );

      // Selects
      this.qs("#fpAcademicYear")?.addEventListener(
        "change",
        () => this.onYearChanged(),
        { signal: this.abort.signal }
      );
      this.qs("#fpGrade")?.addEventListener(
        "change",
        () => this.onGradeChanged(),
        { signal: this.abort.signal }
      );
      this.qs("#fpClass")?.addEventListener(
        "change",
        () => this.onClassChanged(),
        { signal: this.abort.signal }
      );

      // Search
      const qInput = this.qs("#fpStudentQuery");
      const clearBtn = this.qs("#fpClearStudent");

      const debouncedSearch = debounce(() => this.searchStudents(), 300);

      qInput?.addEventListener("input", debouncedSearch, {
        signal: this.abort.signal,
      });
      qInput?.addEventListener("focus", () => debouncedSearch(), {
        signal: this.abort.signal,
      });
      clearBtn?.addEventListener(
        "click",
        () => {
          if (qInput) qInput.value = "";
          this.searchStudents().catch(() => {});
        },
        { signal: this.abort.signal }
      );

      // Close results when clicking outside
      document.addEventListener(
        "click",
        (e) => {
          if (!this.el.contains(e.target)) return;
          const results = this.qs("#fpStudentResults");
          if (!results || results.hidden) return;

          const searchWrap = this.qs(".fp-field-search");
          if (searchWrap && !searchWrap.contains(e.target)) {
            this.hideResults();
          }
        },
        { signal: this.abort.signal }
      );

      // Contract actions
      this.qs("#fpCreateContractBtn")?.addEventListener(
        "click",
        () => this.openContractForm(),
        { signal: this.abort.signal }
      );
      this.qs("#fpCancelContract")?.addEventListener(
        "click",
        () => this.closeContractForm(),
        { signal: this.abort.signal }
      );
      this.qs("#fpGenerateInstallments")?.addEventListener(
        "click",
        () => this.createContractAndInstallments(),
        { signal: this.abort.signal }
      );
this.qs("#fpRequestDiscountApproval")?.addEventListener(
  "click",
  () => this.requestDiscountApproval(),
  { signal: this.abort.signal }
);

["#fpDiscountAmount", "#fpDiscountReason"].forEach((id) => {
  this.qs(id)?.addEventListener(
    "input",
    () => this.updateDiscountApprovalButton(),
    { signal: this.abort.signal }
  );

  this.qs(id)?.addEventListener(
    "change",
    () => this.updateDiscountApprovalButton(),
    { signal: this.abort.signal }
  );
});
      // Payment
      this.qs("#fpPaymentForm")?.addEventListener(
        "submit",
        (e) => this.submitPayment(e),
        { signal: this.abort.signal }
      );
      this.qs("#fpResetPayment")?.addEventListener(
        "click",
        () => this.resetPaymentForm(),
        { signal: this.abort.signal }
      );

      // Print statement
      this.qs("#fpPrintStatement")?.addEventListener(
        "click",
        () => this.printStatement(),
        { signal: this.abort.signal }
      );

      // Validate payment fields to enable submit
      ["#fpPayAmount", "#fpPayMethod"].forEach((id) => {
        this.qs(id)?.addEventListener(
          "input",
          () => this.updatePaymentSubmitEnabled(),
          { signal: this.abort.signal }
        );
        this.qs(id)?.addEventListener(
          "change",
          () => this.updatePaymentSubmitEnabled(),
          { signal: this.abort.signal }
        );
      });

      await this.loadMeta();
      this.updateUIEmpty();
      await this.autoOpenFromReports();
      this.setPaymentState("اختر طالبًا", "muted");
      this.toast("تم تجهيز صفحة سداد الرسوم.", "success");
    }

    destroy() {
      this.abort.abort();
    }

    openReports() {
      // لو عندك Router خاص استعمله
      if (typeof window.openAdminPage === "function") {
        window.openAdminPage("feesReports.html");
        return;
      }
      // أو لو تستخدم hash routing
      if (location.hash) {
        location.hash = "#feesReports";
        return;
      }
      // fallback
      location.href = "feesReports.html";
    }

    async reloadAll() {
      try {
        await this.loadMeta(true);
        if (this.state.selectedStudent) {
          await this.loadStudentFinance(this.state.selectedStudent);
        }
        this.toast("تم التحديث.", "success");
      } catch (e) {
        this.toast(`تعذر التحديث: ${e.message}`, "error");
      }
    }

    async loadMeta(force = false) {
      // Academic years, grades, classes (based on grade)
      try {
        const [years, grades] = await Promise.all([
          this.apiGet(CONFIG.ENDPOINTS.academicYears),
          this.apiGet(CONFIG.ENDPOINTS.grades),
        ]);

        this.state.academicYears = years || [];
        this.state.grades = grades || [];

        this.renderYears();
        this.renderGrades();

        // اختر سنة افتراضيًا إذا غير محددة
        if (!this.state.selectedYearId) {
          const firstYear = this.state.academicYears[0];
          this.state.selectedYearId = firstYear?.id || "";
          if (this.qs("#fpAcademicYear"))
            this.qs("#fpAcademicYear").value = this.state.selectedYearId;
        }

        // جلب الشعب حسب الصف
        await this.loadClassesForGrade(this.state.selectedGradeId);
      } catch (e) {
        if (CONFIG.USE_MOCK_IF_API_FAILS) {
          // fallback to mock
          this.state.academicYears = MOCK_DB.academicYears;
          this.state.grades = MOCK_DB.grades;
          this.renderYears();
          this.renderGrades();

          if (!this.state.selectedYearId) {
            this.state.selectedYearId = MOCK_DB.academicYears[0]?.id || "";
            if (this.qs("#fpAcademicYear"))
              this.qs("#fpAcademicYear").value = this.state.selectedYearId;
          }

          await this.loadClassesForGrade(this.state.selectedGradeId, true);
          this.toast("تم تشغيل وضع تجريبي (Mock) لعدم توفر API.", "info");
          return;
        }
        throw e;
      }
    }

    renderYears() {
      const sel = this.qs("#fpAcademicYear");
      if (!sel) return;

      sel.innerHTML = `<option value="">اختر...</option>`;
      for (const y of this.state.academicYears) {
        const opt = document.createElement("option");
        opt.value = y.id;
        opt.textContent =
          y.name || `${y.startDate || ""} - ${y.endDate || ""}` || "سنة";
        sel.appendChild(opt);
      }
    }

    renderGrades() {
      const sel = this.qs("#fpGrade");
      if (!sel) return;

      sel.innerHTML = `<option value="">الكل</option>`;
      for (const g of this.state.grades) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name || "صف";
        sel.appendChild(opt);
      }
    }

    async loadClassesForGrade(gradeId, forceMock = false) {
      const sel = this.qs("#fpClass");
      if (!sel) return;

      this.state.classes = [];
      sel.innerHTML = `<option value="">الكل</option>`;

      if (!gradeId) return;

      try {
        let classes;
        if (forceMock) {
          classes = MOCK_DB.classes[gradeId] || [];
        } else {
          classes = await this.apiGet(
            `${CONFIG.ENDPOINTS.classes}?gradeId=${encodeURIComponent(gradeId)}`
          );
        }

        this.state.classes = classes || [];
        for (const c of this.state.classes) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.name || "شعبة";
          sel.appendChild(opt);
        }
      } catch (e) {
        if (CONFIG.USE_MOCK_IF_API_FAILS) {
          const classes = MOCK_DB.classes[gradeId] || [];
          this.state.classes = classes;
          for (const c of classes) {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.name || "شعبة";
            sel.appendChild(opt);
          }
          return;
        }
        throw e;
      }
    }

    onYearChanged() {
      this.state.selectedYearId = this.qs("#fpAcademicYear")?.value || "";

      if (this.state.selectedStudent) {
        this.loadStudentFinance(this.state.selectedStudent).catch((e) =>
          this.toast(e.message, "error")
        );
      }

      this.searchStudents().catch((e) => {
        console.error("search on year change failed", e);
      });
    }

    async onGradeChanged() {
      this.state.selectedGradeId = this.qs("#fpGrade")?.value || "";
      this.state.selectedClassId = "";

      if (this.qs("#fpClass")) this.qs("#fpClass").value = "";

      try {
        await this.loadClassesForGrade(this.state.selectedGradeId);
        await this.searchStudents();
      } catch (e) {
        this.toast(e.message, "error");
      }
    }

    onClassChanged() {
      this.state.selectedClassId = this.qs("#fpClass")?.value || "";
      this.searchStudents().catch((e) => {
        console.error("search on class change failed", e);
      });
    }

    hideResults() {
      const res = this.qs("#fpStudentResults");
      if (!res) return;
      res.hidden = true;
      res.innerHTML = "";
    }

    async searchStudents() {
      const q = (this.qs("#fpStudentQuery")?.value || "").trim();
      const yearId = this.state.selectedYearId;
      const gradeId = this.state.selectedGradeId || "";
      const classId = this.state.selectedClassId || "";

      const resultsEl = this.qs("#fpStudentResults");
      if (!resultsEl) return;

      this.state.lastSearchQuery = q;

      if (!yearId) {
        this.hideResults();
        return;
      }

      try {
        const url = `${CONFIG.ENDPOINTS.studentsSearch}?q=${encodeURIComponent(
          q
        )}&yearId=${encodeURIComponent(yearId)}&gradeId=${encodeURIComponent(
          gradeId
        )}&classId=${encodeURIComponent(classId)}`;

        let students = [];
        try {
          students = await this.apiGet(url);
        } catch (e) {
          if (!CONFIG.USE_MOCK_IF_API_FAILS) throw e;
          students = mockSearchStudents({ q, yearId, gradeId, classId });
        }

        const filtered = (students || []).filter((s) => {
          const matchGrade = !gradeId || String(s.gradeId) === String(gradeId);
          const matchClass = !classId || String(s.classId) === String(classId);
          const matchQuery = studentMatchesQuery(s, q);
          return matchGrade && matchClass && matchQuery;
        });

        this.state.searchResults = filtered;
        this.renderStudentResults(filtered);
      } catch (e) {
        console.error("searchStudents failed:", e);
        this.toast(`فشل البحث: ${e.message}`, "error");
      }
    }

    renderStudentResults(students) {
      const resultsEl = this.qs("#fpStudentResults");
      if (!resultsEl) return;

      resultsEl.innerHTML = "";

      if (!students || !students.length) {
        resultsEl.hidden = false;
        resultsEl.innerHTML = `
      <div class="fp-resultItem" style="cursor:default;">
        <div>
          <div>لا توجد نتائج</div>
          <div class="fp-resultMeta">لا يوجد طلاب مطابقون للفلاتر أو البحث</div>
        </div>
      </div>
    `;
        return;
      }

      for (const s of students) {
        const item = document.createElement("div");
        item.className = "fp-resultItem";
        item.innerHTML = `
      <div>
        <div style="font-weight:800;">
          ${safeText(s.name)}
          <span style="font-weight:700;color:var(--text-muted);">
(${safeText(s.studentCode || s.studentId || s.id || "")})          </span>
        </div>
        <div class="fp-resultMeta">
          ${safeText(s.gradeName || "")}${
          s.className ? " — " + safeText(s.className) : ""
        }
        </div>
      </div>
      <div class="fp-resultMeta">
        ${safeText(s.guardianName || "")}${
          s.guardianPhone ? " — " + safeText(s.guardianPhone) : ""
        }
      </div>
    `;
        item.addEventListener("click", () => this.selectStudent(s), {
          signal: this.abort.signal,
        });
        resultsEl.appendChild(item);
      }

      resultsEl.hidden = false;
    }
    async selectStudent(student) {
      this.hideResults();
      this.state.selectedStudent = student;

      this.setBadge("تم اختيار طالب", "muted");
      this.renderStudentCard(student);

      // enable create contract button (بعد التأكد أن في سنة مختارة)
      this.enable(this.qs("#fpCreateContractBtn"), !!this.state.selectedYearId);

      // load finance
      await this.loadStudentFinance(student);

      this.updatePaymentSubmitEnabled();
    }

    renderStudentCard(s) {
      this.qs("#fpStudentName").textContent = safeText(s.name) || "—";
      this.qs("#fpStudentId").textContent =
        safeText(s.studentCode || s.studentId || s.id) || "—";
      this.qs("#fpStudentClass").textContent = `${safeText(
        s.gradeName || "—"
      )}${s.className ? " / " + safeText(s.className) : ""}`;
      this.qs("#fpGuardian").textContent = safeText(s.guardianName || "—");
    }

    updateUIEmpty() {
      this.setBadge("لم يتم اختيار طالب", "muted");

      const setT = (id, val) => {
        const el = this.qs(id);
        if (el) el.textContent = val;
      };

      setT("#fpStudentName", "—");
      setT("#fpStudentId", "—");
      setT("#fpStudentClass", "—");
      setT("#fpGuardian", "—");
      setT("#fpTotalAnnual", "0");
      setT("#fpTotalDiscount", "0"); // تصفير الخصم
      setT("#fpPaidTotal", "0");
      setT("#fpRemaining", "0");
      setT("#fpCredit", "0");
      setT("#fpNextInstallment", "—");
      setT("#fpContractStatus", "—");

      this.closeContractForm();
      this.renderInstallments([]);
      this.renderPayments([]);

      const btnC = this.qs("#fpCreateContractBtn");
      if (btnC) btnC.disabled = true;
      const btnP = this.qs("#fpSubmitPayment");
      if (btnP) btnP.disabled = true;
      this.enable(this.qs("#fpRequestDiscountApproval"), false);
    }

    async loadStudentFinance(student) {
      const yearId = this.state.selectedYearId;
      if (!yearId) {
        this.toast("اختر السنة الدراسية أولاً.", "error");
        return;
      }

      this.setPaymentState("جاري التحميل...", "muted");
      try {
        let contract = null;
        try {
          const url = `${
            CONFIG.ENDPOINTS.feeContract
          }?studentId=${encodeURIComponent(
            student.id
          )}&yearId=${encodeURIComponent(yearId)}`;
          contract = await this.apiGet(url);
        } catch (e) {
          if (!CONFIG.USE_MOCK_IF_API_FAILS) throw e;
          contract = mockGetContract(student.id, yearId);
        }

        this.state.contract = contract || null;
        const btnCreate = this.qs("#fpCreateContractBtn");

        if (!this.state.contract) {
          this.qs("#fpContractStatus").textContent = "غير موجود";
          btnCreate.innerHTML = `<i class="ri-file-add-line"></i><span>إنشاء عقد</span>`;
          this.enable(btnCreate, true);
          this.renderInstallments([]);
          this.renderPayments([]);
          this.renderSummary(0, [], []);
          this.setPaymentState("أنشئ عقد الرسوم أولاً", "muted");
          this.enable(this.qs("#fpSubmitPayment"), false);
          return;
        }

        // ✅ التعديل هنا: عرض (الصافي) وقيمة الخصم بوضوح في الواجهة
        const annualAmt = toNumber(this.state.contract.annualAmount);
        const discountAmt = toNumber(
          this.state.contract.discountAmount ||
            this.state.contract.discount_amount ||
            0
        );
        const netAmt = annualAmt - discountAmt;
        const discText =
          discountAmt > 0 ? ` (خصم: ${formatNumber(discountAmt)})` : "";

        this.qs(
          "#fpContractStatus"
        ).textContent = `موجود — الصافي: ${formatNumber(
          netAmt
        )}${discText} / أقساط: ${this.state.contract.installmentsCount}`;

        const contractId = this.state.contract.id;
        let installments = [];
        let payments = [];

        try {
          [installments, payments] = await Promise.all([
            this.apiGet(
              `${CONFIG.ENDPOINTS.installments}?contractId=${encodeURIComponent(
                contractId
              )}`
            ),
            this.apiGet(
              `${CONFIG.ENDPOINTS.payments}?contractId=${encodeURIComponent(
                contractId
              )}`
            ),
          ]);
        } catch (e) {
          if (!CONFIG.USE_MOCK_IF_API_FAILS) throw e;
          installments = mockGetInstallments(contractId);
          payments = mockGetPayments(contractId);
        }

        this.state.installments = (installments || []).map((x) => ({
          id: x.id,
          installmentNo: x.installmentNo ?? x.installment_no ?? x.no ?? 0,
          dueDate: x.dueDate ?? x.due_date ?? "",
          amount: toNumber(x.amount),
          paidAmount: toNumber(x.paidAmount ?? x.paid_amount),
        }));
const installmentsTotalForStatus = this.state.installments.reduce((sum, it) => {
  return sum + toNumber(it.amount);
}, 0);

const effectiveDiscountAmount = Math.max(
  discountAmt,
  annualAmt > 0 && installmentsTotalForStatus > 0
    ? Math.max(0, annualAmt - installmentsTotalForStatus)
    : 0
);

const effectiveNetAmount = Math.max(0, annualAmt - effectiveDiscountAmount);

const effectiveDiscountText =
  effectiveDiscountAmount > 0
    ? ` (خصم: ${formatNumber(effectiveDiscountAmount)})`
    : "";

this.qs("#fpContractStatus").textContent = `موجود — الصافي: ${formatNumber(
  effectiveNetAmount
)}${effectiveDiscountText} / أقساط: ${
  this.state.contract.installmentsCount ||
  this.state.contract.installments_count ||
  this.state.installments.length
}`;
        this.state.payments = (payments || []).map((p) => ({
          id: p.id,
          paidAt: p.paidAt ?? p.paid_at ?? p.date ?? "",
          amount: toNumber(p.amount),
          method: p.method ?? p.method_type ?? "",
          provider: p.provider ?? "",
          reference: p.reference ?? p.external_reference ?? "",
          receiptNo: p.receiptNo ?? p.receipt_number ?? "",
          status: p.status ?? "confirmed",
          attachmentUrl: p.attachmentUrl ?? p.attachmentPath ?? null,
        }));

        const totalPaid = this.state.installments.reduce(
          (sum, it) => sum + it.paidAmount,
          0
        );

        if (totalPaid === 0) {
          btnCreate.innerHTML = `<i class="ri-edit-line"></i><span>تعديل العقد</span>`;
          this.enable(btnCreate, true);
        } else {
          btnCreate.innerHTML = `<i class="ri-lock-line"></i><span>مغلق للتعديل</span>`;
          this.enable(btnCreate, false);
        }

        this.renderInstallments(this.state.installments);
        this.renderPayments(this.state.payments);

        // ✅ التعديل هنا: نرسل (الصافي) لدالة الملخص لكي تحسب المتبقي بشكل صحيح
        // ابحث عن هذا السطر في نهاية loadStudentFinance وتأكد أنه هكذا:
        this.renderSummary(
          this.state.contract.annualAmount, // نرسل المبلغ الأصلي والدالة تطرح الخصم
          this.state.installments,
          this.state.payments
        );
this.updateDiscountApprovalButton();
        this.setPaymentState("جاهز", "muted");
        this.updatePaymentSubmitEnabled();
      } catch (e) {
        this.toast(`فشل تحميل بيانات الرسوم: ${e.message}`, "error");
        this.setPaymentState("فشل", "muted");
      }
    }
   renderSummary(annualAmount, installments, payments) {
  const totalAnnualBasis = toNumber(annualAmount);

  // الخصم قد يأتي من العقد، أو نستنتجه من مجموع الأقساط بعد قبول المدير
  const contractDiscountAmount = toNumber(
    this.state.contract?.discount_amount ||
      this.state.contract?.discountAmount ||
      this.state.contract?.discount ||
      0
  );

  const installmentsTotal = (installments || []).reduce((sum, it) => {
    return sum + toNumber(it.amount);
  }, 0);

  const inferredDiscountAmount =
    totalAnnualBasis > 0 && installmentsTotal > 0
      ? Math.max(0, totalAnnualBasis - installmentsTotal)
      : 0;

  const discountAmount = Math.max(
    contractDiscountAmount,
    inferredDiscountAmount
  );

  const netRequired = Math.max(0, totalAnnualBasis - discountAmount);

  // الأصح هنا أن نحسب المدفوع من الأقساط، لأن الأقساط هي التي تظهر حقيقة السداد
  const paidFromInstallments = (installments || []).reduce((sum, it) => {
    return sum + toNumber(it.paidAmount);
  }, 0);

  const paidFromConfirmedPayments = (payments || []).reduce((sum, p) => {
    return p.status === "confirmed" ? sum + toNumber(p.amount) : sum;
  }, 0);

  const paidTotal = Math.max(paidFromInstallments, paidFromConfirmedPayments);

  const remaining = Math.max(0, netRequired - paidTotal);
  const credit = Math.max(0, paidTotal - netRequired);

  const setT = (id, val) => {
    const el = this.qs(id);
    if (el) el.textContent = val;
  };

  setT("#fpTotalAnnual", formatNumber(totalAnnualBasis));
  setT("#fpTotalDiscount", formatNumber(discountAmount));
  setT("#fpPaidTotal", formatNumber(paidTotal));
  setT("#fpRemaining", formatNumber(remaining));
  setT("#fpCredit", formatNumber(credit));

  const next = (installments || []).find(
    (x) => toNumber(x.amount) - toNumber(x.paidAmount) > 0
  );

  setT(
    "#fpNextInstallment",
    next
      ? `قسط #${next.installmentNo} — المتبقي: ${formatNumber(
          toNumber(next.amount) - toNumber(next.paidAmount)
        )}`
      : "تم سداد كامل المستحقات ✅"
  );
}
    renderInstallments(items) {
      const body = this.qs("#fpInstallmentsBody");
      if (!body) return;

      body.innerHTML = "";

      if (!items || !items.length) {
        body.innerHTML = `
          <tr class="fp-emptyRow">
            <td colspan="6">
              <div class="fp-empty">
                <i class="ri-information-line"></i>
                <span>لا توجد أقساط. (أنشئ عقد رسوم أولاً)</span>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      const sorted = items
        .slice()
        .sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0));

      for (const it of sorted) {
        const bal = Math.max(0, toNumber(it.amount) - toNumber(it.paidAmount));
        const st = computeInstallmentStatus(it.amount, it.paidAmount);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${it.installmentNo}</td>
          <td>${formatDatePretty(it.dueDate)}</td>
          <td>${formatNumber(it.amount)}</td>
          <td>${formatNumber(it.paidAmount)}</td>
          <td>${formatNumber(bal)}</td>
          <td>${statusLabel(st)}</td>
        `;
        body.appendChild(tr);
      }
    }

    renderPayments(items) {
      const body = this.qs("#fpPaymentsBody");
      if (!body) return;

      body.innerHTML = "";

      if (!items || !items.length) {
        body.innerHTML = `
          <tr class="fp-emptyRow">
            <td colspan="8"> <div class="fp-empty">
                <i class="ri-information-line"></i>
                <span>لا توجد مدفوعات بعد.</span>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      const sorted = items
        .slice()
        .sort(
          (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()
        );

      // ✅ هنا تم وضع الكود الخاص بك الذي يعرض زر المرفق
      for (const p of sorted) {
        // بناء زر المرفق إذا كان موجوداً
        const attachmentHtml = p.attachmentUrl
          ? `<a href="${p.attachmentUrl}" target="_blank" class="fp-btn fp-btn-ghost" title="عرض السند" style="color:#3b82f6;"><i class="ri-image-line"></i></a>`
          : "—";

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatDatePretty(p.paidAt)}</td>
          <td>${formatNumber(p.amount)}</td>
          <td>${methodLabel(p.method)}</td>
          <td>${safeText(p.provider) || "—"}</td>
          <td>${safeText(p.reference) || "—"}</td>
          <td>${attachmentHtml}</td> <td>${
          p.receiptNo
            ? `<button class="fp-btn fp-btn-ghost fp-receiptBtn" data-receipt="${safeText(
                p.receiptNo
              )}" type="button"><i class="ri-file-text-line"></i><span>${safeText(
                p.receiptNo
              )}</span></button>`
            : "—"
        }</td>
          <td>
            <div style="display:flex;gap:8px;align-items:center;justify-content:flex-start;flex-wrap:wrap;">
              <span>${statusLabel(p.status)}</span>
              ${
                p.status === "pending"
                  ? `<button class="fp-btn fp-btn-ghost fp-confirmPay" data-id="${safeText(
                      p.id
                    )}" type="button">اعتماد</button>`
                  : ""
              }
            </div>
          </td>
        `;

        // تفعيل زر الاعتماد
        const confirmBtn = tr.querySelector(".fp-confirmPay");
        confirmBtn?.addEventListener("click", () => this.confirmPayment(p.id), {
          signal: this.abort.signal,
        });

        // تفعيل زر الإيصال
        const btn = tr.querySelector(".fp-receiptBtn");
        btn?.addEventListener("click", () => this.printReceipt(p), {
          signal: this.abort.signal,
        });

        body.appendChild(tr);
      }
    }

    openContractForm() {
      if (!this.state.selectedStudent)
        return this.toast("اختر طالبًا أولاً.", "error");
      if (!this.state.selectedYearId)
        return this.toast("اختر السنة الدراسية أولاً.", "error");

      this.show(this.qs("#fpContractForm"), true);

      if (this.state.contract) {
        this.qs("#fpAnnualAmount").value = this.state.contract.annualAmount;
        // ✅ تعبئة بيانات الخصم
        if (this.qs("#fpDiscountAmount"))
          this.qs("#fpDiscountAmount").value =
            this.state.contract.discountAmount ||
            this.state.contract.discount_amount ||
            0;
        if (this.qs("#fpDiscountReason"))
          this.qs("#fpDiscountReason").value =
            this.state.contract.discountReason ||
            this.state.contract.discount_reason ||
            "";

        this.qs("#fpInstallmentsCount").value =
          this.state.contract.installmentsCount;
        const d =
          this.state.contract.firstDueDate ||
          this.state.contract.first_due_date;
        this.qs("#fpFirstDueDate").value = d ? d.split("T")[0] : "";
        this.qs(
          "#fpGenerateInstallments"
        ).innerHTML = `<i class="ri-refresh-line"></i><span>إعادة الجدولة</span>`;
      } else {
        const year = this.state.academicYears.find(
          (y) => y.id === this.state.selectedYearId
        );
        this.qs("#fpFirstDueDate").value = year?.startDate
          ? year.startDate.split("T")[0]
          : formatDateISO(new Date());
        this.qs("#fpAnnualAmount").value = "";

        // ✅ تصفير بيانات الخصم
        if (this.qs("#fpDiscountAmount"))
          this.qs("#fpDiscountAmount").value = "0";
        if (this.qs("#fpDiscountReason"))
          this.qs("#fpDiscountReason").value = "";

        this.qs("#fpInstallmentsCount").value = "";
        this.qs(
          "#fpGenerateInstallments"
        ).innerHTML = `<i class="ri-magic-line"></i><span>توليد الأقساط</span>`;
      }
      this.updateDiscountApprovalButton();
    }
    closeContractForm() {
      this.show(this.qs("#fpContractForm"), false);
    }
    updateDiscountApprovalButton() {
  const btn = this.qs("#fpRequestDiscountApproval");
  if (!btn) return;

  const hasStudent = !!this.state.selectedStudent;
  const hasContract = !!this.state.contract;

  const amount = toNumber(this.qs("#fpDiscountAmount")?.value);
  const reason = String(this.qs("#fpDiscountReason")?.value || "").trim();

  this.enable(btn, hasStudent && hasContract && amount > 0 && !!reason);
}

async requestDiscountApproval() {
  if (!this.state.selectedStudent) {
    return this.toast("اختر طالبًا أولاً.", "error");
  }

  if (!this.state.contract) {
    return this.toast("لا يوجد عقد رسوم لهذا الطالب.", "error");
  }

  const amount = toNumber(this.qs("#fpDiscountAmount")?.value);
  const reason = String(this.qs("#fpDiscountReason")?.value || "").trim();

  if (amount <= 0) {
    return this.toast("أدخل مبلغ خصم صحيح.", "error");
  }

  if (!reason) {
    return this.toast("سبب الخصم مطلوب.", "error");
  }

 const ok = await this.confirmDialog({
  title: "إرسال طلب خصم",
  message:
    `سيتم إرسال طلب خصم بقيمة ${formatNumber(amount)} إلى المدير.\n` +
    "لن يتم تطبيق الخصم إلا بعد موافقة المدير.\n\n" +
    "هل تريد إرسال الطلب الآن؟",
  confirmText: "إرسال الطلب",
  cancelText: "إلغاء",
  type: "warning",
});

if (!ok) return;
  if (!ok) return;

  try {
    this.setPaymentState("جاري إرسال طلب الخصم...", "muted");
    this.enable(this.qs("#fpRequestDiscountApproval"), false);

    const result = await this.apiPost(CONFIG.ENDPOINTS.feeAdjustmentRequests, {
      student_id: this.state.selectedStudent.id,
      contract_id: this.state.contract.id,
      amount,
      reason,
    });

    this.toast(
      result?.message || "تم إرسال طلب الخصم إلى المدير.",
      "success"
    );

    this.setPaymentState("جاهز", "muted");
    this.updateDiscountApprovalButton();
  } catch (e) {
    this.setPaymentState("فشل", "muted");
    this.toast(`فشل إرسال طلب الخصم: ${e.message}`, "error");
    this.updateDiscountApprovalButton();
  }
}
    async createContractAndInstallments() {
      if (!this.state.selectedStudent)
        return this.toast("اختر طالبًا أولاً.", "error");
      if (!this.state.selectedYearId)
        return this.toast("اختر السنة الدراسية أولاً.", "error");

      const annualAmount = toNumber(this.qs("#fpAnnualAmount")?.value);
      const discountAmount = toNumber(this.qs("#fpDiscountAmount")?.value); // ✅
      const discountReason = this.qs("#fpDiscountReason")?.value || "";
      const installmentsCount = toNumber(
        this.qs("#fpInstallmentsCount")?.value
      );
      const firstDueDate = this.qs("#fpFirstDueDate")?.value;

      if (annualAmount <= 0) return this.toast("أدخل مبلغ سنوي صحيح.", "error");
      if (installmentsCount <= 0)
        return this.toast("أدخل عدد أقساط صحيح.", "error");
      if (!firstDueDate) return this.toast("اختر تاريخ أول قسط.", "error");

      try {
        this.setPaymentState("جاري التنفيذ...", "muted");

    const currentDiscountAmount = toNumber(
  this.state.contract?.discountAmount ||
    this.state.contract?.discount_amount ||
    0
);

const currentDiscountReason =
  this.state.contract?.discountReason ||
  this.state.contract?.discount_reason ||
  "";

const payload = {
  studentId: this.state.selectedStudent.id,
  yearId: this.state.selectedYearId,

  // عند وجود عقد سابق لا نسمح بتعديل الخصم مباشرة.
  // الخصم الجديد يذهب عبر طلب اعتماد المدير فقط.
  discountAmount: this.state.contract ? currentDiscountAmount : discountAmount,
  discountReason: this.state.contract ? currentDiscountReason : discountReason,

  annualAmount,
  installmentsCount,
  firstDueDate,
};

        // ✅ إذا كان العقد موجود نرسل (PUT)، وإذا غير موجود نرسل (POST)
        if (this.state.contract) {
          await this.apiPut(
            `/api/fees/contracts/${this.state.contract.id}`,
            payload
          );
          this.toast("تم تعديل العقد وإعادة الجدولة بنجاح.", "success");
        } else {
          await this.apiPost(CONFIG.ENDPOINTS.createContract, payload);
          this.toast("تم إنشاء عقد الرسوم وتوليد الأقساط.", "success");
        }

        this.closeContractForm();
        await this.loadStudentFinance(this.state.selectedStudent);
      } catch (e) {
        this.setPaymentState("فشل", "muted");
        this.toast(`العملية فشلت: ${e.message}`, "error");
      }
    }

    updatePaymentSubmitEnabled() {
      const btn = this.qs("#fpSubmitPayment");
      if (!btn) return;

      const hasStudent = !!this.state.selectedStudent;
      const hasContract = !!this.state.contract;
      const amount = toNumber(this.qs("#fpPayAmount")?.value);
      const method = this.qs("#fpPayMethod")?.value;

      this.enable(btn, hasStudent && hasContract && amount > 0 && !!method);
    }

    resetPaymentForm() {
      if (this.qs("#fpPayAmount")) this.qs("#fpPayAmount").value = "";
      if (this.qs("#fpPayMethod")) this.qs("#fpPayMethod").value = "";
      if (this.qs("#fpProvider")) this.qs("#fpProvider").value = "";
      if (this.qs("#fpReference")) this.qs("#fpReference").value = "";
      if (this.qs("#fpNote")) this.qs("#fpNote").value = "";
      if (this.qs("#fpAttachment")) this.qs("#fpAttachment").value = "";
      this.updatePaymentSubmitEnabled();
      this.toast("تم تفريغ الحقول.", "info");
    }

    async submitPayment(e) {
      e.preventDefault();

      if (!this.state.selectedStudent)
        return this.toast("اختر طالبًا أولاً.", "error");
      if (!this.state.contract)
        return this.toast("أنشئ عقد الرسوم أولاً.", "error");

      const amount = toNumber(this.qs("#fpPayAmount")?.value);
      const method = this.qs("#fpPayMethod")?.value;
      const provider = this.qs("#fpProvider")?.value || "";
      const reference = this.qs("#fpReference")?.value || "";
      const note = this.qs("#fpNote")?.value || "";
      const file = this.qs("#fpAttachment")?.files?.[0] || null;

      if (amount <= 0) return this.toast("أدخل مبلغ صحيح.", "error");
      if (!method) return this.toast("اختر طريقة الدفع.", "error");

      let status = "confirmed";
      if (CONFIG.REQUIRE_CONFIRM_FOR_NON_CASH && method !== "cash")
        status = "pending";

      // في حال تريد أن أي دفع فيه مرفق يصبح pending تلقائيًا:
      // if (method !== "cash" && file) status = "pending";

      try {
        this.setPaymentState("جاري تسجيل الدفعة...", "muted");
        this.enable(this.qs("#fpSubmitPayment"), false);

        const contractId = this.state.contract.id;
        const studentId = this.state.selectedStudent.id;

        let payment;

        try {
          // إن كان يوجد مرفق: FormData
          if (file) {
            const fd = new FormData();
            fd.append("contractId", contractId);
            fd.append("studentId", studentId);
            fd.append("amount", String(amount));
            fd.append("method", method);
            fd.append("provider", provider);
            fd.append("reference", reference);
            fd.append("note", note);
            fd.append("status", status);
            fd.append("attachment", file);

            payment = await this.apiPostForm(
              CONFIG.ENDPOINTS.createPayment,
              fd
            );
          } else {
            const payload = {
              contractId,
              studentId,
              amount,
              method,
              provider,
              reference,
              note,
              status,
            };
            payment = await this.apiPost(
              CONFIG.ENDPOINTS.createPayment,
              payload
            );
          }
        } catch (e) {
          if (!CONFIG.USE_MOCK_IF_API_FAILS) throw e;

          payment = mockCreatePayment({
            contractId,
            studentId,
            amount,
            method,
            provider,
            reference,
            status,
          });
        }

        this.toast(
          status === "confirmed"
            ? "تم تسجيل الدفعة بنجاح."
            : "تم تسجيل الدفعة (قيد المراجعة).",
          "success"
        );
        this.resetPaymentForm();

        // reload finance to update installments + summary + history
        await this.loadStudentFinance(this.state.selectedStudent);

        // print receipt quick
        this.printReceipt({
          ...payment,
          method,
          provider,
          reference,
          status,
        });

        this.setPaymentState("جاهز", "muted");
      } catch (err) {
        this.toast(`فشل تسجيل الدفعة: ${err.message}`, "error");
        this.setPaymentState("فشل", "muted");
      } finally {
        this.updatePaymentSubmitEnabled();
      }
    }

    printReceipt(payment) {
      // طباعة إيصال بسيط (يمكنك استبداله بـ PDF لاحقًا)
      const student = this.state.selectedStudent;
      const year = this.state.academicYears.find(
        (y) => y.id === this.state.selectedYearId
      );
      const receiptNo =
        payment.receiptNo || payment.receipt_number || genReceiptNo();

      const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>إيصال ${receiptNo}</title>
  <style>
    body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
    .box{border:1px solid #ddd;border-radius:12px;padding:16px;max-width:720px;margin:auto}
    h2{margin:0 0 12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .row{padding:10px;border:1px dashed #ddd;border-radius:10px}
    .muted{color:#666;font-size:12px}
    .big{font-size:22px;font-weight:900}
    .footer{margin-top:14px;font-size:12px;color:#666}
    @media print{button{display:none}}
  </style>
</head>
<body>
  <div class="box">
    <h2>إيصال سداد رسوم</h2>
    <div class="muted">رقم الإيصال: <b>${receiptNo}</b></div>
    <div class="muted">التاريخ: <b>${formatDatePretty(
      payment.paidAt || new Date().toISOString()
    )}</b></div>

    <div style="height:10px"></div>
    <div class="grid">
      <div class="row">
        <div class="muted">الطالب</div>
        <div><b>${safeText(student?.name)}</b> <span class="muted">(${safeText(
        student?.id
      )})</span></div>
      </div>
      <div class="row">
        <div class="muted">السنة الدراسية</div>
        <div><b>${safeText(year?.name || this.state.selectedYearId)}</b></div>
      </div>
      <div class="row">
        <div class="muted">طريقة الدفع</div>
        <div><b>${methodLabel(payment.method)}</b></div>
      </div>
      <div class="row">
        <div class="muted">الجهة / المزوّد</div>
        <div><b>${safeText(payment.provider) || "—"}</b></div>
      </div>
      <div class="row">
        <div class="muted">رقم المرجع</div>
        <div><b>${safeText(payment.reference) || "—"}</b></div>
      </div>
      <div class="row">
        <div class="muted">الحالة</div>
        <div><b>${statusLabel(payment.status || "confirmed")}</b></div>
      </div>
    </div>

    <div style="height:12px"></div>
    <div class="row">
      <div class="muted">المبلغ</div>
      <div class="big">${formatNumber(payment.amount)}</div>
    </div>

    <div class="footer">هذا الإيصال تم إنشاؤه من نظام المدرسة.</div>
    <div style="height:10px"></div>
    <button onclick="window.print()">طباعة</button>
  </div>
</body>
</html>`;

      const w = window.open(
        "",
        "_blank",
        "noopener,noreferrer,width=900,height=700"
      );
      if (!w) {
        this.toast(
          "تعذر فتح نافذة الطباعة (قد يكون المتصفح يمنع النوافذ المنبثقة).",
          "error"
        );
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
    }

    printStatement() {
      if (!this.state.selectedStudent || !this.state.contract) {
        this.toast("اختر طالبًا ثم تأكد من وجود عقد.", "error");
        return;
      }

      const student = this.state.selectedStudent;
      const year = this.state.academicYears.find(
        (y) => y.id === this.state.selectedYearId
      );

      const sum = computeContractSummary(
        this.state.contract.annualAmount,
        this.state.installments,
        this.state.payments
      );

      const instRows = (this.state.installments || [])
        .slice()
        .sort((a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0))
        .map((it) => {
          const bal = Math.max(
            0,
            toNumber(it.amount) - toNumber(it.paidAmount)
          );
          const st = computeInstallmentStatus(it.amount, it.paidAmount);
          return `
            <tr>
              <td>${it.installmentNo}</td>
              <td>${formatDatePretty(it.dueDate)}</td>
              <td>${formatNumber(it.amount)}</td>
              <td>${formatNumber(it.paidAmount)}</td>
              <td>${formatNumber(bal)}</td>
              <td>${statusLabel(st)}</td>
            </tr>
          `;
        })
        .join("");

      const payRows = (this.state.payments || [])
        .slice()
        .sort(
          (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()
        )
        .map((p) => {
          return `
            <tr>
              <td>${formatDatePretty(p.paidAt)}</td>
              <td>${formatNumber(p.amount)}</td>
              <td>${methodLabel(p.method)}</td>
              <td>${safeText(p.provider) || "—"}</td>
              <td>${safeText(p.reference) || "—"}</td>
              <td>${safeText(p.receiptNo) || "—"}</td>
              <td>${statusLabel(p.status)}</td>
            </tr>
          `;
        })
        .join("");

      const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>كشف حساب الطالب</title>
  <style>
    body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
    .box{border:1px solid #ddd;border-radius:12px;padding:16px;max-width:980px;margin:auto}
    h2{margin:0 0 8px}
    .muted{color:#666;font-size:12px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}
    .kpi{border:1px dashed #ddd;border-radius:10px;padding:10px}
    .kpi .v{font-size:18px;font-weight:900;margin-top:6px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #e5e7eb;padding:10px;font-size:12px;text-align:right}
    th{background:#f3f4f6}
    @media print{button{display:none}}
    @media (max-width:900px){.kpis{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body>
  <div class="box">
    <h2>كشف حساب الرسوم</h2>
    <div class="muted">الطالب: <b>${safeText(student.name)}</b> (${safeText(
        student.id
      )})</div>
    <div class="muted">السنة الدراسية: <b>${safeText(
      year?.name || this.state.selectedYearId
    )}</b></div>

    <div class="kpis">
      <div class="kpi"><div class="muted">الإجمالي السنوي</div><div class="v">${formatNumber(
        sum.totalAnnual
      )}</div></div>
      <div class="kpi"><div class="muted">المدفوع</div><div class="v">${formatNumber(
        sum.paidTotal
      )}</div></div>
      <div class="kpi"><div class="muted">المتبقي</div><div class="v">${formatNumber(
        sum.remaining
      )}</div></div>
      <div class="kpi"><div class="muted">رصيد مقدّم</div><div class="v">${formatNumber(
        sum.credit
      )}</div></div>
    </div>

    <h3 style="margin:16px 0 6px;">الأقساط</h3>
    <table>
      <thead>
        <tr>
          <th>#</th><th>الاستحقاق</th><th>قيمة القسط</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${instRows || ""}</tbody>
    </table>

    <h3 style="margin:16px 0 6px;">المدفوعات</h3>
    <table>
      <thead>
        <tr>
          <th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>الجهة</th><th>المرجع</th><th>الإيصال</th><th>الحالة</th>
        </tr>
      </thead>
      <tbody>${payRows || ""}</tbody>
    </table>

    <div style="height:10px"></div>
    <button onclick="window.print()">طباعة</button>
  </div>
</body>
</html>`;

      const w = window.open(
        "",
        "_blank",
        "noopener,noreferrer,width=1100,height=800"
      );
      if (!w) {
        this.toast(
          "تعذر فتح نافذة الطباعة (قد يكون المتصفح يمنع النوافذ المنبثقة).",
          "error"
        );
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
    }

    /***********************
     * API HELPERS with base
     ***********************/
    async apiGet(path) {
      const url = toApiUrl(path);
      return httpGet(url);
    }

    async apiPost(path, payload) {
      const url = toApiUrl(path);
      return httpPost(url, payload, false);
    }

    async apiPostForm(path, formData) {
      const url = toApiUrl(path);
      return httpPost(url, formData, true);
    } // ✅ إضافة دالة الـ PUT المطلوبة للتعديل
    async apiPut(path, payload) {
      const url = toApiUrl(path);
      const res = await fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: getAuthHeaders({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(payload || {}),
      });

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await res.json().catch(() => null)
        : await res.text().catch(() => "");

      if (!res.ok) {
        const msg = data?.message || data?.error || data || "";
        throw new Error(
          `PUT ${url} failed: ${res.status}${msg ? " — " + msg : ""}`
        );
      }
      return data;
    }
    async apiPatch(path, payload) {
      const url = toApiUrl(path);
      return httpPatch(url, payload);
    }
  }

  /***********************
   * BOOTSTRAP (init when section exists)
   ***********************/
  function initIfExists() {
    const section = document.getElementById("feesPayPage");
    if (!section) return false;

    // منع تكرار التهيئة
    if (window.__feesPayInstance && window.__feesPayInstance.el === section)
      return true;

    // destroy old
    try {
      window.__feesPayInstance?.destroy?.();
    } catch (_) {}

    const page = new FeesPayPage(section);
    window.__feesPayInstance = page;
    page.init().catch((e) => console.error("feesPay init error:", e));
    return true;
  }

  // طريقة نداء يدوية بعد حقن الـ section
  window.initFeesPayPage = initIfExists;

  // auto on DOMContentLoaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIfExists);
  } else {
    initIfExists();
  }

  // دعم الـ SPA injection: نراقب إذا أضيف الـ section لاحقًا
  const mo = new MutationObserver(() => {
    initIfExists();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
