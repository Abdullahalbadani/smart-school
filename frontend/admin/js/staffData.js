// frontend/admin/js/staffReports.js
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
    return document.getElementById("staffReportsPage");
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

  function percent(value) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(1)}%`;
  }

  function activeLabel(value) {
    if (value === true || value === "true") return "نشط";
    if (value === false || value === "false") return "غير نشط";
    if (value === "active") return "نشط";
    if (value === "inactive") return "غير نشط";
    return value || "—";
  }

  function attendanceStatusLabel(value) {
    const v = String(value || "").toLowerCase();

    if (v === "present") return "حاضر";
    if (v === "absent") return "غائب";

    return value || "—";
  }

  function typeLabel(row) {
    return row.is_teacher ? "معلم" : "إداري";
  }

  function showAlert(message, type = "info") {
    const el = qs("#strAlert");
    if (!el) return;

    if (!message) {
      el.className = "str-alert";
      el.textContent = "";
      return;
    }

    el.className = `str-alert show ${type}`;
    el.textContent = message;
  }

  function setLoading(loading) {
    state.loading = loading;
    const btn = qs("#strLoadBtn");

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

  function fillAcademicYears() {
    const years = getMetaArray(["academicYears", "academic_years", "years"]);

    fillSelect(qs("#strAcademicYear"), years, "كل السنوات", (x) => {
      return x.name || x.title || `سنة ${x.id}`;
    });

    const active = years.find((x) => x.is_active) || years[0];

    if (active && qs("#strAcademicYear")) {
      qs("#strAcademicYear").value = String(active.id);
    }
  }

  async function loadMeta() {
    try {
      const payload = await apiGet("/timetables/meta");
      state.meta = payload?.data || payload || {};
      fillAcademicYears();
    } catch (_) {
      state.meta = {};
    }
  }

  function filters() {
    const params = new URLSearchParams();

    const fields = {
      academic_year_id: "#strAcademicYear",
      q: "#strSearch",
      employee_type: "#strEmployeeType",
      is_active: "#strIsActive",
      has_user: "#strHasUser",
      missing_phone: "#strMissingPhone",
      attendance_flag: "#strAttendanceFlag",
    };

    Object.entries(fields).forEach(([key, selector]) => {
      const value = String(qs(selector)?.value || "").trim();
      if (value) params.set(key, value);
    });

    return params;
  }

  function renderSummary(data = {}) {
    qs("#strTotalEmployees") && (qs("#strTotalEmployees").textContent = money(data.total_employees));
    qs("#strTeachersCount") && (qs("#strTeachersCount").textContent = money(data.teachers_count));
    qs("#strAdminsCount") && (qs("#strAdminsCount").textContent = money(data.admins_count));
    qs("#strActiveCount") && (qs("#strActiveCount").textContent = money(data.active_count));
    qs("#strInactiveCount") && (qs("#strInactiveCount").textContent = money(data.inactive_count));
    qs("#strMissingUserCount") && (qs("#strMissingUserCount").textContent = money(data.missing_user_account_count));
    qs("#strMissingPhoneCount") && (qs("#strMissingPhoneCount").textContent = money(data.missing_phone_count));
    qs("#strWithAttendanceCount") && (qs("#strWithAttendanceCount").textContent = money(data.employees_with_attendance_count));
    qs("#strWithAbsenceCount") && (qs("#strWithAbsenceCount").textContent = money(data.employees_with_absence_count));
    qs("#strTotalAbsentCount") && (qs("#strTotalAbsentCount").textContent = money(data.total_absent_count));
  }

  function statusBadge(row) {
    if (row.is_active) {
      return `<span class="str-badge str-badge-ok">نشط</span>`;
    }

    return `<span class="str-badge str-badge-danger">غير نشط</span>`;
  }

  function accountBadge(row) {
    if (row.user_id) {
      return `
        <span class="str-badge str-badge-ok">لديه حساب</span>
        <div class="str-muted">${escapeHtml(row.username || row.email || "—")}</div>
      `;
    }

    return `<span class="str-badge str-badge-danger">بدون حساب</span>`;
  }

  function issuesHTML(row) {
    const issues = [];

    if (row.missing_phone) issues.push("رقم الهاتف ناقص");
    if (row.missing_user_account) issues.push("بدون حساب دخول");
    if (row.missing_teacher_link) issues.push("رابط المعلم ناقص");

    if (!issues.length) {
      return `<span class="str-badge str-badge-ok">مكتملة</span>`;
    }

    return issues
      .map((x) => `<span class="str-badge str-badge-danger">${escapeHtml(x)}</span>`)
      .join(" ");
  }

  function renderRows() {
    const body = qs("#strTableBody");
    const wrap = qs("#strTableWrap");
    const empty = qs("#strEmpty");
    const info = qs("#strTableInfo");
    const pageInfo = qs("#strPageInfo");

    if (!body || !wrap || !empty) return;

    if (info) {
      info.textContent = state.total
        ? `يعرض ${state.rows.length} موظف من أصل ${state.total}.`
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
        const profileKey = row.profile_key || row.staff_id;

        return `
          <tr>
            <td data-label="م">${number}</td>

            <td data-label="الموظف">
              <div class="str-name">${escapeHtml(row.full_name || "—")}</div>
              <div class="str-muted">ID: ${escapeHtml(profileKey)}</div>
            </td>

            <td data-label="النوع / الوظيفة">
              <span class="str-badge ${row.is_teacher ? "str-badge-primary" : "str-badge-warn"}">${escapeHtml(typeLabel(row))}</span>
              <div class="str-muted">${escapeHtml(row.job_title || "—")}</div>
            </td>

            <td data-label="الهاتف">${escapeHtml(row.phone || "—")}</td>

            <td data-label="حساب الدخول">
              ${accountBadge(row)}
            </td>

            <td data-label="الأدوار">
              <div>${escapeHtml(row.roles_names || "—")}</div>
              <div class="str-muted">${money(row.roles_count)} دور</div>
            </td>

            <td data-label="الحضور">
              <div>
                <span class="str-badge str-badge-ok">حضور ${money(row.present_count)}</span>
                <span class="str-badge str-badge-danger">غياب ${money(row.absent_count)}</span>
              </div>
              <div class="str-muted">النسبة: ${percent(row.attendance_rate)}</div>
            </td>

            <td data-label="الحالة">
              ${statusBadge(row)}
            </td>

            <td data-label="النواقص">
              <div class="str-issues">${issuesHTML(row)}</div>
            </td>

            <td data-label="تفاصيل">
              <button type="button" class="str-btn str-btn-primary str-profile-btn" data-key="${escapeHtml(profileKey)}">
                عرض
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    qsa(".str-profile-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openProfile(btn.dataset.key);
      });
    });
  }

  async function loadReport() {
    if (state.loading) return;

    try {
      setLoading(true);
      showAlert("");

      const params = filters();

      const summaryPromise = apiGet(`/admin/reports/staff/summary?${params.toString()}`);

      params.set("page", state.page);
      params.set("limit", state.limit);

      const listPromise = apiGet(`/admin/reports/staff?${params.toString()}`);

      const [summary, list] = await Promise.all([summaryPromise, listPromise]);

      state.summary = summary.data || {};
      state.rows = Array.isArray(list.data) ? list.data : [];
      state.page = list.page || 1;
      state.pages = list.pages || 1;
      state.total = list.total || 0;

      renderSummary(state.summary);
      renderRows();

      showAlert("تم تحميل تقرير الموظفين بنجاح.", "success");
    } catch (err) {
      showAlert(err.message || "تعذر تحميل تقرير الموظفين.", "error");
    } finally {
      setLoading(false);
    }
  }

  function profileCard(title, content) {
    return `
      <section class="str-profile-card">
        <h4>${escapeHtml(title)}</h4>
        ${content}
      </section>
    `;
  }

  function keyValue(label, value) {
    return `
      <div class="str-kv">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(fmt(value))}</strong>
      </div>
    `;
  }

  function renderProfile(data) {
    const employee = data.employee || {};
    const roles = Array.isArray(data.roles) ? data.roles : [];
    const attendance = data.attendance || {};
    const recent = Array.isArray(data.recent_attendance) ? data.recent_attendance : [];

    const rolesHTML = roles.length
      ? roles
          .map((r) => `
            <div class="str-list-item">
              <strong>${escapeHtml(r.name || "—")}</strong>
              <span>${escapeHtml(r.description || "")}</span>
            </div>
          `)
          .join("")
      : `<div class="str-muted">لا توجد أدوار مرتبطة.</div>`;

    const attendanceHTML = recent.length
      ? recent
          .map((a) => `
            <div class="str-list-item">
              <strong>${escapeHtml(attendanceStatusLabel(a.status))}</strong>
              <span>${fmtDate(a.attendance_date)} | ${escapeHtml(a.method || "—")}</span>
              ${a.notes ? `<small>${escapeHtml(a.notes)}</small>` : ""}
            </div>
          `)
          .join("")
      : `<div class="str-muted">لا توجد سجلات حضور حديثة.</div>`;

    return `
      <header class="str-profile-header">
        <div>
          <h3>${escapeHtml(employee.full_name || "—")}</h3>
          <p>${escapeHtml(typeLabel(employee))} | ${escapeHtml(employee.job_title || "—")}</p>
        </div>
      </header>

      ${profileCard(
        "بيانات الموظف",
        `
          <div class="str-kv-grid">
            ${keyValue("النوع", typeLabel(employee))}
            ${keyValue("الوظيفة", employee.job_title)}
            ${keyValue("الهاتف", employee.phone)}
            ${keyValue("الحالة", activeLabel(employee.is_active))}
            ${keyValue("مصدر البيانات", employee.source_type === "teacher" ? "جدول المعلمين" : "جدول الموظفين")}
            ${keyValue("تاريخ الإضافة", fmtDate(employee.created_at))}
          </div>
        `
      )}

      ${profileCard(
        "حساب الدخول",
        `
          <div class="str-kv-grid">
            ${keyValue("اسم الحساب", employee.username)}
            ${keyValue("البريد", employee.email)}
            ${keyValue("حالة الحساب", activeLabel(employee.user_status))}
            ${keyValue("معرّف المستخدم", employee.user_id)}
          </div>
        `
      )}

      ${profileCard("الأدوار والصلاحيات", `<div class="str-list">${rolesHTML}</div>`)}

      ${profileCard(
        "ملخص الحضور",
        `
          <div class="str-kv-grid">
            ${keyValue("سجلات الحضور", attendance.attendance_records)}
            ${keyValue("الحضور", attendance.present_count)}
            ${keyValue("الغياب", attendance.absent_count)}
            ${keyValue("آخر حضور", fmtDate(attendance.last_attendance_date))}
            ${keyValue("آخر غياب", fmtDate(attendance.last_absence_date))}
          </div>
        `
      )}

      ${profileCard("آخر سجلات الحضور", `<div class="str-list">${attendanceHTML}</div>`)}

      ${employee.notes ? profileCard("ملاحظات", `<p class="str-muted">${escapeHtml(employee.notes)}</p>`) : ""}
    `;
  }

  async function openProfile(profileKey) {
    const drawer = qs("#strProfileDrawer");
    const content = qs("#strProfileContent");

    if (!drawer || !content || !profileKey) return;

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");

    content.innerHTML = `<div class="str-empty">جاري تحميل ملف الموظف...</div>`;

    try {
      const params = new URLSearchParams();
      const year = String(qs("#strAcademicYear")?.value || "").trim();
      if (year) params.set("academic_year_id", year);

      const data = await apiGet(
        `/admin/reports/staff/${encodeURIComponent(profileKey)}/profile?${params.toString()}`
      );

      content.innerHTML = renderProfile(data.data || {});
    } catch (err) {
      content.innerHTML = `<div class="str-empty">${escapeHtml(err.message || "تعذر تحميل الملف.")}</div>`;
    }
  }

  function closeProfile() {
    const drawer = qs("#strProfileDrawer");
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
      "الاسم",
      "النوع",
      "الوظيفة",
      "الهاتف",
      "حالة الموظف",
      "اسم المستخدم",
      "البريد",
      "الأدوار",
      "حضور",
      "غياب",
      "نسبة الحضور",
      "آخر حضور",
    ];

    const lines = state.rows.map((r) => [
      r.full_name,
      typeLabel(r),
      r.job_title,
      r.phone,
      activeLabel(r.is_active),
      r.username,
      r.email,
      r.roles_names,
      r.present_count,
      r.absent_count,
      r.attendance_rate,
      r.last_attendance_date,
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
    a.download = "staff-report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
async function printStaffNamesSheet() {
  try {
    const params = filters();
    params.set("page", 1);
    params.set("limit", 1000);

    const payload = await apiGet(`/admin/reports/staff?${params.toString()}`);
    const rows = Array.isArray(payload.data) ? payload.data : [];

    if (!rows.length) {
      showAlert("لا توجد أسماء موظفين للطباعة حسب الفلاتر المحددة.", "error");
      return;
    }

    const yearText = qs("#strAcademicYear")?.selectedOptions?.[0]?.textContent || "كل السنوات";
    const typeText = qs("#strEmployeeType")?.selectedOptions?.[0]?.textContent || "الكل";
    const activeText = qs("#strIsActive")?.selectedOptions?.[0]?.textContent || "الكل";

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
            <td class="name">${escapeHtml(r.full_name || "—")}</td>
            <td>${escapeHtml(typeLabel(r))}</td>
            <td>${escapeHtml(r.job_title || "—")}</td>
            <td>${escapeHtml(r.phone || "—")}</td>
            <td>${escapeHtml(activeLabel(r.is_active))}</td>
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
        <title>كشف أسماء الموظفين</title>

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
            <h1 class="title">كشف أسماء الموظفين</h1>
          </header>

          <section class="meta">
            <div>السنة الدراسية للحضور: ${escapeHtml(yearText)}</div>
            <div>نوع الموظف: ${escapeHtml(typeText)}</div>
            <div>الحالة: ${escapeHtml(activeText)}</div>
            <div>عدد الموظفين: ${rows.length}</div>
            <div>تاريخ الطباعة: ${escapeHtml(printedAt)}</div>
            <div>نوع الكشف: موظفون ومعلمون</div>
          </section>

          <table>
            <thead>
              <tr>
                <th style="width: 45px;">م</th>
                <th>اسم الموظف</th>
                <th style="width: 90px;">النوع</th>
                <th style="width: 140px;">الوظيفة</th>
                <th style="width: 120px;">الهاتف</th>
                <th style="width: 90px;">الحالة</th>
                <th style="width: 120px;">ملاحظات</th>
              </tr>
            </thead>

            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <footer class="footer">
            <div class="sign">شؤون الموظفين</div>
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
    showAlert(err.message || "تعذر طباعة كشف الموظفين.", "error");
  }
}
  function bindEvents() {
    qs("#strLoadBtn")?.addEventListener("click", () => {
      state.page = 1;
      loadReport();
    });

    qs("#strPrevBtn")?.addEventListener("click", () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadReport();
    });

    qs("#strNextBtn")?.addEventListener("click", () => {
      if (state.page >= state.pages) return;
      state.page += 1;
      loadReport();
    });

    qs("#strPrintBtn")?.addEventListener("click", () => window.print());
    qs("#strExportBtn")?.addEventListener("click", exportCsv);
qs("#strPrintNamesBtn")?.addEventListener("click", printStaffNamesSheet);
    qs("#strCloseProfileBtn")?.addEventListener("click", closeProfile);
    qs("#strCloseBackdrop")?.addEventListener("click", closeProfile);

    qs("#strSearch")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        state.page = 1;
        loadReport();
      }
    });
  }

  window.initStaffReportsScreen = async function () {
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

  function bootStaffReportsScreen() {
    const page = root();
    if (!page) return;
    window.initStaffReportsScreen();
  }

  if (document.readyState !== "loading") {
    bootStaffReportsScreen();
  } else {
    document.addEventListener("DOMContentLoaded", bootStaffReportsScreen);
  }

  const staffReportsObserver = new MutationObserver(() => {
    bootStaffReportsScreen();
  });

  staffReportsObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();