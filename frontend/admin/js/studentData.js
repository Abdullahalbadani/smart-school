// frontend/admin/js/studentReports.js
(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

  const state = {
    meta: {},
    rows: [],
    summary: {},
    page: 1,
    pages: 1,
    total: 0,
    limit: 20,
    loading: false,
  };

  function apiUrl(path = "") {
    if (/^https?:\/\//i.test(path)) return path;
    let clean = String(path || "").replace(/^\/+/, "");
    if (clean.startsWith("api/")) clean = clean.slice(4);
    return `${API_BASE}/${clean}`;
  }

  function root() {
    return document.getElementById("studentReportsPage");
  }

  function qs(selector, base = root()) {
    return base ? base.querySelector(selector) : null;
  }

  function qsa(selector, base = root()) {
    return base ? Array.from(base.querySelectorAll(selector)) : [];
  }

  function token() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }

  async function apiGet(path) {
    const res = await fetch(apiUrl(path), {
      headers: {
        Accept: "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.message || `فشل الاتصال: ${res.status}`);
    }

    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(value) {
    const n = Number(value || 0);
    return n.toLocaleString("en-US");
  }

  function fmt(value) {
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
  }

  function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
function enrollmentStatusLabel(value) {
  const v = String(value || "").toLowerCase();

  if (v === "enrolled") return "مقيد";
  if (v === "transferred") return "منقول";
  if (v === "withdrawn") return "منسحب";
  if (v === "graduated") return "متخرج";
  if (v === "inactive") return "غير نشط";
  if (v === "active") return "نشط";

  return value || "—";
}
  function percent(value) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(1)}%`;
  }

  function showAlert(message, type = "info") {
    const el = qs("#srAlert");
    if (!el) return;

    if (!message) {
      el.className = "sr-alert";
      el.textContent = "";
      return;
    }

    el.className = `sr-alert show ${type}`;
    el.textContent = message;
  }

  function setLoading(loading) {
    state.loading = loading;
    const btn = qs("#srLoadBtn");

    if (btn) {
      btn.disabled = loading;
      btn.innerHTML = loading
        ? `<i class="ri-loader-4-line"></i> جاري التحميل...`
        : `<i class="ri-search-line"></i> عرض التقرير`;
    }
  }

  function getMetaArray(names) {
    for (const name of names) {
      const value = state.meta?.[name];
      if (Array.isArray(value)) return value;
    }
    return [];
  }
function genderLabel(value) {
  const v = String(value || "").toLowerCase();

  if (v === "male" || v === "ذكر") return "ذكر";
  if (v === "female" || v === "أنثى" || v === "انثى") return "أنثى";

  return value || "—";
}
  function fillSelect(select, items, placeholder, labelFn) {
    if (!select) return;

    select.innerHTML = "";

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);

    for (const item of items) {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = labelFn(item);
      select.appendChild(option);
    }
  }

  function selectedNumber(selector) {
    const n = Number(qs(selector)?.value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function fillAcademicYears() {
    const years = getMetaArray(["academicYears", "academic_years", "years"]);

    fillSelect(qs("#srAcademicYear"), years, "اختر السنة الدراسية", (x) => {
      return x.name || x.title || `سنة ${x.id}`;
    });

    const active = years.find((x) => x.is_active) || years[0];
    if (active && qs("#srAcademicYear")) {
      qs("#srAcademicYear").value = String(active.id);
    }
  }

  function fillStages() {
    const stages = getMetaArray(["stages"]);

    fillSelect(qs("#srStage"), stages, "كل المراحل", (x) => {
      return x.name || `مرحلة ${x.id}`;
    });
  }

  function fillGrades() {
    const stageId = selectedNumber("#srStage");

    const grades = getMetaArray(["grades"]).filter((x) => {
      if (!stageId) return true;
      return Number(x.stage_id) === stageId;
    });

    fillSelect(qs("#srGrade"), grades, "كل الصفوف", (x) => {
      return x.grade_name || x.name || `صف ${x.id}`;
    });
  }

  function fillSections() {
    const gradeId = selectedNumber("#srGrade");

    const sections = getMetaArray(["sections"]).filter((x) => {
      if (!gradeId) return true;
      return Number(x.grade_id) === gradeId;
    });

    fillSelect(qs("#srSection"), sections, "كل الشعب", (x) => {
      return x.name || `شعبة ${x.id}`;
    });
  }

  function filters() {
    const academicYearId = selectedNumber("#srAcademicYear");

    const params = new URLSearchParams();

    if (academicYearId) params.set("academic_year_id", academicYearId);

    const fields = {
      term: "#srTerm",
      stage_id: "#srStage",
      grade_id: "#srGrade",
      section_id: "#srSection",
      q: "#srSearch",
      gender: "#srGender",
      fee_status: "#srFeeStatus",
      has_guardian: "#srHasGuardian",
      missing_phone: "#srMissingPhone",
      attendance_flag: "#srAttendanceFlag",
      has_certificates: "#srHasCertificates",
    };

    Object.entries(fields).forEach(([key, selector]) => {
      const value = String(qs(selector)?.value || "").trim();
      if (value) params.set(key, value);
    });

    return params;
  }

  function ensureYearSelected() {
    if (!selectedNumber("#srAcademicYear")) {
      throw new Error("اختر السنة الدراسية أولًا.");
    }
  }

  async function loadMeta() {
    const payload = await apiGet("/timetables/meta");
    state.meta = payload?.data || payload || {};

    fillAcademicYears();
    fillStages();
    fillGrades();
    fillSections();
  }

  function renderSummary(data = {}) {
    qs("#srTotalStudents") && (qs("#srTotalStudents").textContent = money(data.total_students));
    qs("#srMaleCount") && (qs("#srMaleCount").textContent = money(data.male_count));
    qs("#srFemaleCount") && (qs("#srFemaleCount").textContent = money(data.female_count));
    qs("#srDueFeesCount") && (qs("#srDueFeesCount").textContent = money(data.due_fees_count));
    qs("#srNoContractCount") && (qs("#srNoContractCount").textContent = money(data.no_contract_count));
    qs("#srRemainingAmount") && (qs("#srRemainingAmount").textContent = money(data.total_remaining_amount));
    qs("#srHighAbsenceCount") && (qs("#srHighAbsenceCount").textContent = money(data.high_absence_count));
    qs("#srMissingGuardianCount") && (qs("#srMissingGuardianCount").textContent = money(data.missing_guardian_count));
    qs("#srWithCertificatesCount") && (qs("#srWithCertificatesCount").textContent = money(data.students_with_certificates_count));
    qs("#srWithTransfersCount") && (qs("#srWithTransfersCount").textContent = money(data.students_with_transfers_count));
  }

  function feeBadge(row) {
    if (row.fee_status === "paid") {
      return `<span class="sr-badge sr-badge-ok">مسدد</span>`;
    }

    if (row.fee_status === "due") {
      return `<span class="sr-badge sr-badge-warn">متبقي ${money(row.remaining_amount)}</span>`;
    }

    return `<span class="sr-badge sr-badge-danger">بدون عقد</span>`;
  }

  function issuesHTML(row) {
    const issues = [];

    if (row.missing_guardian) issues.push("بدون ولي أمر");
    if (row.missing_student_phone) issues.push("هاتف الطالب ناقص");
    if (row.missing_guardian_phone) issues.push("هاتف ولي الأمر ناقص");
    if (row.missing_fee_contract) issues.push("بدون عقد رسوم");

    if (!issues.length) {
      return `<span class="sr-badge sr-badge-ok">مكتملة</span>`;
    }

    return issues
      .map((x) => `<span class="sr-badge sr-badge-danger">${escapeHtml(x)}</span>`)
      .join(" ");
  }

  function renderRows() {
    const body = qs("#srTableBody");
    const wrap = qs("#srTableWrap");
    const empty = qs("#srEmpty");
    const info = qs("#srTableInfo");
    const pageInfo = qs("#srPageInfo");

    if (!body || !wrap || !empty) return;

    if (info) {
      info.textContent = state.total
        ? `يعرض ${state.rows.length} طالب من أصل ${state.total}.`
        : "لا توجد بيانات.";
    }

    if (pageInfo) {
      pageInfo.textContent = `صفحة ${state.page} من ${state.pages || 1}`;
    }

    if (!state.rows.length) {
      body.innerHTML = "";
      wrap.style.display = "none";
      empty.style.display = "";
      empty.textContent = "لا توجد بيانات حسب الفلاتر المحددة.";
      return;
    }

    empty.style.display = "none";
    wrap.style.display = "";

    body.innerHTML = state.rows
      .map((row, index) => {
        const number = (state.page - 1) * state.limit + index + 1;

        return `
          <tr>
            <td data-label="م">${number}</td>

            <td data-label="الطالب">
              <div class="sr-name">${escapeHtml(row.full_name)}</div>
              <div class="sr-muted">${escapeHtml(row.student_code || "—")} | ${escapeHtml(genderLabel(row.gender))}</div>
            </td>

            <td data-label="الموقع الدراسي">
              <div>${escapeHtml(row.stage_name || "—")}</div>
              <div class="sr-muted">${escapeHtml(row.grade_name || "—")} / ${escapeHtml(row.section_name || "—")}</div>
            </td>

            <td data-label="ولي الأمر">
              <div>${escapeHtml(row.guardian_name || "—")}</div>
              <div class="sr-muted">${escapeHtml(row.guardian_phone || "—")}</div>
            </td>

            <td data-label="الرسوم">
              ${feeBadge(row)}
              <div class="sr-muted">مدفوع: ${money(row.paid_amount)} / إجمالي: ${money(row.total_due)}</div>
            </td>

            <td data-label="الحضور">
              <div>
                <span class="sr-badge sr-badge-ok">حضور ${money(row.present_count)}</span>
                <span class="sr-badge sr-badge-danger">غياب ${money(row.absent_count)}</span>
                <span class="sr-badge sr-badge-warn">تأخير ${money(row.late_count)}</span>
              </div>
              <div class="sr-muted">النسبة: ${percent(row.attendance_rate)}</div>
            </td>

            <td data-label="الشهادات">
              <div>${money(row.certificates_count)} شهادة</div>
              <div class="sr-muted">
                شهرية ${money(row.monthly_certificates_count)} /
                نصفية ${money(row.midterm_certificates_count)} /
                نهائية ${money(row.final_certificates_count)}
              </div>
            </td>

            <td data-label="النقل">
              <div>${money(row.transfer_requests_count)} طلب</div>
              <div class="sr-muted">${escapeHtml(row.last_transfer_status || "—")}</div>
            </td>

            <td data-label="النواقص">
              <div class="sr-issues">${issuesHTML(row)}</div>
            </td>

            <td data-label="تفاصيل">
              <button type="button" class="sr-btn sr-btn-primary sr-profile-btn" data-id="${escapeHtml(row.student_id)}">
                عرض
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".sr-profile-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openProfile(Number(btn.dataset.id));
      });
    });
  }

  async function loadReport() {
    if (state.loading) return;

    try {
      ensureYearSelected();
      setLoading(true);
      showAlert("");

      const params = filters();

      const summaryPromise = apiGet(`/admin/reports/students/summary?${params.toString()}`);

      params.set("page", state.page);
      params.set("limit", state.limit);

      const listPromise = apiGet(`/admin/reports/students?${params.toString()}`);

      const [summary, list] = await Promise.all([summaryPromise, listPromise]);

      state.summary = summary.data || {};
      state.rows = Array.isArray(list.data) ? list.data : [];
      state.page = list.page || 1;
      state.pages = list.pages || 1;
      state.total = list.total || 0;

      renderSummary(state.summary);
      renderRows();

      showAlert("تم تحميل التقرير الشامل بنجاح.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل التقرير.", "error");
    } finally {
      setLoading(false);
    }
  }

  function profileCard(title, content) {
    return `
      <section class="sr-profile-card">
        <h4>${escapeHtml(title)}</h4>
        ${content}
      </section>
    `;
  }

  function keyValue(label, value) {
    return `
      <div class="sr-kv">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(fmt(value))}</strong>
      </div>
    `;
  }

  function renderProfile(data) {
    const student = data.student || {};
    const guardians = Array.isArray(data.guardians) ? data.guardians : [];
    const certificates = Array.isArray(data.certificates) ? data.certificates : [];
    const transfers = Array.isArray(data.transfers) ? data.transfers : [];
    const fees = data.fees || {};
    const attendance = data.attendance || {};

    const guardiansHTML = guardians.length
      ? guardians
          .map((g) => `
            <div class="sr-list-item">
              <strong>${escapeHtml(g.full_name || "—")}</strong>
              <span>${escapeHtml(g.relation || "—")} | ${escapeHtml(g.phone || "—")}</span>
            </div>
          `)
          .join("")
      : `<div class="sr-muted">لا يوجد ولي أمر مرتبط.</div>`;

    const certificatesHTML = certificates.length
      ? certificates
          .map((c) => `
            <div class="sr-list-item">
              <strong>${escapeHtml(c.title || c.certificate_type || "شهادة")}</strong>
              <span>${escapeHtml(c.certificate_type)} | ${escapeHtml(c.status)} | ${fmtDate(c.issued_at)}</span>
            </div>
          `)
          .join("")
      : `<div class="sr-muted">لا توجد شهادات محفوظة.</div>`;

    const transfersHTML = transfers.length
      ? transfers
          .map((t) => `
            <div class="sr-list-item">
              <strong>${escapeHtml(t.status || "—")}</strong>
              <span>
                ${escapeHtml(t.from_grade_name || "—")} / ${escapeHtml(t.from_section_name || "—")}
                ←
                ${escapeHtml(t.to_grade_name || "—")} / ${escapeHtml(t.to_section_name || "—")}
              </span>
              <small>${escapeHtml(t.reason || "")}</small>
            </div>
          `)
          .join("")
      : `<div class="sr-muted">لا توجد طلبات نقل.</div>`;

    return `
      <header class="sr-profile-header">
        <div>
          <h3>${escapeHtml(student.full_name || "—")}</h3>
          <p>${escapeHtml(student.student_code || "—")} | ${escapeHtml(student.gender || "—")}</p>
        </div>
      </header>

      ${profileCard(
        "بيانات الطالب",
        `
          <div class="sr-kv-grid">
            ${keyValue("تاريخ الميلاد", fmtDate(student.birth_date))}
            ${keyValue("مكان الميلاد", student.birth_place)}
            ${keyValue("الهاتف", student.phone)}
            ${keyValue("العنوان", student.address)}
${keyValue("الحالة", enrollmentStatusLabel(student.status))}
   
         ${keyValue("تاريخ القبول", fmtDate(student.admission_date))}
          </div>
        `
      )}

      ${profileCard(
        "الموقع الدراسي الحالي",
        `
          <div class="sr-kv-grid">
            ${keyValue("المرحلة", student.stage_name)}
            ${keyValue("الصف", student.grade_name)}
            ${keyValue("الشعبة", student.section_name)}
            ${keyValue("رقم الطالب", student.roll_number)}
${keyValue("حالة التسجيل", enrollmentStatusLabel(student.enrollment_status))}          </div>
        `
      )}

      ${profileCard("أولياء الأمور", `<div class="sr-list">${guardiansHTML}</div>`)}

      ${profileCard(
        "ملخص الرسوم",
        `
          <div class="sr-kv-grid">
            ${keyValue("إجمالي الرسوم", money(fees.total_due))}
            ${keyValue("الخصم", money(fees.discount_amount))}
            ${keyValue("المدفوع", money(fees.paid_amount))}
            ${keyValue("المتبقي", money(fees.remaining_amount))}
            ${keyValue("عدد الأقساط", fees.installments_count)}
            ${keyValue("الأقساط غير المسددة", fees.unpaid_installments)}
          </div>
        `
      )}

      ${profileCard(
        "ملخص الحضور",
        `
          <div class="sr-kv-grid">
            ${keyValue("سجلات الحضور", attendance.attendance_records)}
            ${keyValue("حضور", attendance.present_count)}
            ${keyValue("غياب", attendance.absent_count)}
            ${keyValue("تأخير", attendance.late_count)}
            ${keyValue("دقائق التأخير", attendance.late_minutes)}
            ${keyValue("آخر غياب", fmtDate(attendance.last_absence_date))}
          </div>
        `
      )}

      ${profileCard("الشهادات", `<div class="sr-list">${certificatesHTML}</div>`)}
      ${profileCard("سجل النقل", `<div class="sr-list">${transfersHTML}</div>`)}
    `;
  }

  async function openProfile(studentId) {
    const drawer = qs("#srProfileDrawer");
    const content = qs("#srProfileContent");
    const yearId = selectedNumber("#srAcademicYear");

    if (!drawer || !content || !studentId || !yearId) return;

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");

    content.innerHTML = `<div class="sr-empty">جاري تحميل ملف الطالب...</div>`;

    try {
      const data = await apiGet(
        `/admin/reports/students/${studentId}/profile?academic_year_id=${encodeURIComponent(yearId)}`
      );

      content.innerHTML = renderProfile(data.data || {});
    } catch (err) {
      content.innerHTML = `<div class="sr-empty">${escapeHtml(err.message || "تعذر تحميل الملف.")}</div>`;
    }
  }

  function closeProfile() {
    const drawer = qs("#srProfileDrawer");
    if (!drawer) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }

  function exportCsv() {
    if (!state.rows.length) {
      showAlert("لا توجد بيانات للتصدير.", "error");
      return;
    }

    const headers = [
      "رقم الطالب",
      "اسم الطالب",
      "الجنس",
      "المرحلة",
      "الصف",
      "الشعبة",
      "ولي الأمر",
      "هاتف ولي الأمر",
      "إجمالي الرسوم",
      "المدفوع",
      "المتبقي",
      "حضور",
      "غياب",
      "تأخير",
      "الشهادات",
      "طلبات النقل",
    ];

    const lines = state.rows.map((r) => [
      r.student_code,
      r.full_name,
      r.gender,
      r.stage_name,
      r.grade_name,
      r.section_name,
      r.guardian_name,
      r.guardian_phone,
      r.total_due,
      r.paid_amount,
      r.remaining_amount,
      r.present_count,
      r.absent_count,
      r.late_count,
      r.certificates_count,
      r.transfer_requests_count,
    ]);

    const csv = [headers, ...lines]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student-report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
async function printStudentNamesSheet() {
  try {
    ensureYearSelected();

    const params = filters();
    params.set("page", 1);
    params.set("limit", 1000);

    const payload = await apiGet(`/admin/reports/students?${params.toString()}`);
    const rows = Array.isArray(payload.data) ? payload.data : [];

    if (!rows.length) {
      showAlert("لا توجد أسماء طلاب للطباعة حسب الفلاتر المحددة.", "error");
      return;
    }

    const yearText = qs("#srAcademicYear")?.selectedOptions?.[0]?.textContent || "—";
    const stageText = qs("#srStage")?.selectedOptions?.[0]?.textContent || "كل المراحل";
    const gradeText = qs("#srGrade")?.selectedOptions?.[0]?.textContent || "كل الصفوف";
    const sectionText = qs("#srSection")?.selectedOptions?.[0]?.textContent || "كل الشعب";

    const printedAt = new Date().toLocaleString("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const rowsHtml = rows
      .map((r, index) => {
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(r.student_code || "—")}</td>
            <td class="name">${escapeHtml(r.full_name || "—")}</td>
            <td>${escapeHtml(r.stage_name || "—")}</td>
            <td>${escapeHtml(r.grade_name || "—")}</td>
            <td>${escapeHtml(r.section_name || "—")}</td>
            <td></td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>كشف أسماء الطلاب</title>

        <style>
          @page {
            size: A4 portrait;
            margin: 12mm;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: Arial, Tahoma, sans-serif;
            color: #111827;
            background: #ffffff;
            direction: rtl;
          }

          .sheet {
            width: 100%;
          }

          .header {
            text-align: center;
            border-bottom: 2px solid #111827;
            padding-bottom: 12px;
            margin-bottom: 14px;
          }

          .school {
            font-size: 18px;
            font-weight: 900;
            margin-bottom: 6px;
          }

          .title {
            font-size: 24px;
            font-weight: 900;
            margin: 0;
          }

          .meta {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin: 14px 0;
            font-size: 12px;
            font-weight: 700;
          }

          .meta div {
            border: 1px solid #d1d5db;
            padding: 8px;
            border-radius: 8px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }

          th,
          td {
            border: 1px solid #111827;
            padding: 7px 6px;
            text-align: center;
            vertical-align: middle;
          }

          th {
            background: #f3f4f6;
            font-weight: 900;
          }

          td.name {
            text-align: right;
            font-weight: 800;
          }

          .footer {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-top: 30px;
            font-size: 13px;
            font-weight: 800;
          }

          .sign {
            text-align: center;
            padding-top: 35px;
            border-top: 1px solid #111827;
          }

          .no-print {
            margin-bottom: 14px;
            text-align: center;
          }

          .print-btn {
            border: 0;
            background: #2563eb;
            color: white;
            padding: 10px 22px;
            border-radius: 999px;
            font-size: 14px;
            font-weight: 900;
            cursor: pointer;
          }

          @media print {
            .no-print {
              display: none;
            }
          }
        </style>
      </head>

      <body>
        <div class="no-print">
          <button class="print-btn" onclick="window.print()">طباعة الكشف</button>
        </div>

        <main class="sheet">
          <header class="header">
            <div class="school">إدارة المدرسة</div>
            <h1 class="title">كشف أسماء الطلاب</h1>
          </header>

          <section class="meta">
            <div>السنة الدراسية: ${escapeHtml(yearText)}</div>
            <div>المرحلة: ${escapeHtml(stageText)}</div>
            <div>الصف: ${escapeHtml(gradeText)}</div>
            <div>الشعبة: ${escapeHtml(sectionText)}</div>
            <div>عدد الطلاب: ${rows.length}</div>
            <div>تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
          </section>

          <table>
            <thead>
              <tr>
                <th style="width: 45px;">م</th>
                <th style="width: 100px;">رقم الطالب</th>
                <th>اسم الطالب</th>
                <th style="width: 120px;">المرحلة</th>
                <th style="width: 120px;">الصف</th>
                <th style="width: 80px;">الشعبة</th>
                <th style="width: 110px;">ملاحظات</th>
              </tr>
            </thead>

            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <footer class="footer">
            <div class="sign">مسؤول التسجيل</div>
            <div class="sign">وكيل المدرسة</div>
            <div class="sign">مدير المدرسة</div>
          </footer>
        </main>
      </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      showAlert("المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.", "error");
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    win.focus();

    setTimeout(() => {
      win.print();
    }, 500);
  } catch (err) {
    showAlert(err.message || "تعذر طباعة كشف الطلاب.", "error");
  }
}
  function bindEvents() {
    qs("#srStage")?.addEventListener("change", () => {
      fillGrades();
      fillSections();
    });

    qs("#srGrade")?.addEventListener("change", fillSections);

    qs("#srLoadBtn")?.addEventListener("click", () => {
      state.page = 1;
      loadReport();
    });

    qs("#srPrevBtn")?.addEventListener("click", () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadReport();
    });

    qs("#srNextBtn")?.addEventListener("click", () => {
      if (state.page >= state.pages) return;
      state.page += 1;
      loadReport();
    });
    qs("#srPrintBtn")?.addEventListener("click", () => window.print());
    qs("#srExportBtn")?.addEventListener("click", exportCsv);
qs("#srPrintNamesBtn")?.addEventListener("click", printStudentNamesSheet);
    qs("#srCloseProfileBtn")?.addEventListener("click", closeProfile);
    qs("#srCloseBackdrop")?.addEventListener("click", closeProfile);

    qs("#srSearch")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        state.page = 1;
        loadReport();
      }
    });
  }

  window.initStudentReportsScreen = async function () {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    bindEvents();

    try {
      await loadMeta();
      showAlert("اختر الفلاتر ثم اضغط عرض التقرير.");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل بيانات التقرير.", "error");
    }
  };

  if (document.readyState !== "loading") {
    if (root()) window.initStudentReportsScreen();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (root()) window.initStudentReportsScreen();
    });
  }
})();