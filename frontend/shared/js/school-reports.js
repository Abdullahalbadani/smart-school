(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");
  const REPORTS_UI_VERSION = "6.0.0";

  const CONFIGS = {
    students: {
      api: `${API_BASE}/admin/school-reports/students`,
      dialogTitle: "إعداد كشف الطلاب",
      dialogAria: "إعداد كشف الطلاب",
      entityLabel: "الطلاب",
      previewFallback: "كشف الطلاب",
      fallbackFileName: "students-report.pdf",
      note: "مربع البحث داخل شاشة الطلاب مخصص للعثور السريع فقط، ولا يؤثر على الكشف المدرسي الرسمي.",
      statusesTitle: "حالة الطلاب المراد إدراجهم",
      statuses: [
        ["active", "النشطون"],
        ["inactive", "غير النشطين"],
        ["graduated", "المتخرجون"],
        ["withdrawn", "المنسحبون"],
        ["suspended", "الموقوفون"],
      ],
      columns: [
        ["student_code", "رقم القيد"],
        ["full_name", "اسم الطالب"],
        ["gender", "الجنس"],
        ["birth_date", "تاريخ الميلاد"],
        ["phone", "هاتف الطالب"],
        ["stage_name", "المرحلة"],
        ["grade_name", "الصف"],
        ["section_name", "الشعبة"],
        ["guardian_name", "اسم ولي الأمر"],
        ["guardian_phone", "هاتف ولي الأمر"],
        ["status", "الحالة"],
        ["admission_date", "تاريخ الالتحاق"],
        ["address", "العنوان"],
        ["roll_number", "الرقم في الصف"],
      ],
      presets: {
        short: ["student_code", "full_name", "grade_name", "section_name"],
        detailed: [
          "student_code",
          "full_name",
          "gender",
          "birth_date",
          "phone",
          "grade_name",
          "section_name",
          "guardian_name",
          "guardian_phone",
          "status",
          "admission_date",
          "address",
        ],
      },
      makeExtraPayload(filters) {
        return {
          stage_id: filters.stage_id || null,
          grade_id: filters.grade_id || null,
          section_id: filters.section_id || null,
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} طالبًا في الكشف`;
      },
    },

    staff: {
      api: `${API_BASE}/admin/school-reports/staff`,
      dialogTitle: "إعداد كشف العاملين",
      dialogAria: "إعداد كشف العاملين",
      entityLabel: "العاملين",
      previewFallback: "كشف العاملين",
      fallbackFileName: "staff-report.pdf",
      note: "مربع البحث داخل شاشة العرض مخصص للعثور السريع فقط، ولا يؤثر على الكشف المدرسي الرسمي.",
      statusesTitle: "حالة العاملين المراد إدراجهم",
      statuses: [
        ["active", "النشطون"],
        ["inactive", "الموقوفون"],
      ],
      scopesTitle: "الفئة التي ستظهر داخل الكشف",
      scopes: [
        ["teachers", "المعلمون"],
        ["employees", "الموظفون"],
        ["all", "جميع العاملين"],
      ],
      columns: [
        ["full_name", "الاسم"],
        ["phone", "رقم الجوال"],
        ["job_title", "المسمى الوظيفي"],
        ["staff_type", "النوع"],
        ["account_status", "حالة الحساب"],
        ["username", "اسم المستخدم"],
        ["email", "البريد الإلكتروني"],
        ["roles", "الأدوار"],
        ["status", "الحالة"],
        ["notes", "ملاحظات"],
      ],
      presets: {
        short: ["full_name", "phone", "job_title", "status"],
        detailed: [
          "full_name",
          "phone",
          "job_title",
          "staff_type",
          "account_status",
          "username",
          "email",
          "roles",
          "status",
          "notes",
        ],
      },
      makeExtraPayload(filters, overlay) {
        return {
          scope:
            overlay.querySelector('input[name="schoolReportScope"]:checked')?.value ||
            filters.scope ||
            "teachers",
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} سجلًا في الكشف`;
      },
    },

    attendanceStudents: {
      api: `${API_BASE}/admin/school-reports/attendance/students`,
      dialogTitle: "إعداد كشف حضور وغياب الطلاب",
      dialogAria: "إعداد كشف حضور وغياب الطلاب",
      entityLabel: "الطلاب",
      previewFallback: "كشف حضور وغياب الطلاب",
      fallbackFileName: "students-attendance-report.pdf",
      note: "البحث السريع داخل شاشة تقارير الحضور مخصص للعرض فقط، ولا يؤثر على الكشف المدرسي الرسمي.",
      requireStatuses: false,
      statuses: [],
      columns: [
        ["student_name", "اسم الطالب"],
        ["student_code", "الكود"],
        ["grade_section", "الصف / الشعبة"],
        ["total_sessions", "إجمالي الحصص"],
        ["present_count", "حاضر"],
        ["total_absent", "غياب"],
        ["total_late", "تأخير"],
        ["total_excused", "بعذر"],
        ["late_minutes_total", "دقائق التأخير"],
        ["attendance_percent", "نسبة الحضور"],
      ],
      presets: {
        short: [
          "student_name",
          "student_code",
          "grade_section",
          "total_sessions",
          "present_count",
          "total_absent",
          "total_late",
          "total_excused",
          "attendance_percent",
        ],
        detailed: [
          "student_name",
          "student_code",
          "grade_section",
          "total_sessions",
          "present_count",
          "total_absent",
          "total_late",
          "total_excused",
          "late_minutes_total",
          "attendance_percent",
        ],
      },
      makeExtraPayload(filters) {
        return {
          year_id: filters.year_id || null,
          term_id: filters.term_id || null,
          from: filters.from || null,
          to: filters.to || null,
          stage_id: filters.stage_id || null,
          grade_id: filters.grade_id || null,
          section_id: filters.section_id || null,
          method: filters.method || null,
          sort: filters.sort || "name_asc",
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} طالبًا في الكشف`;
      },
    },

    attendanceTeachers: {
      api: `${API_BASE}/admin/school-reports/attendance/teachers`,
      dialogTitle: "إعداد كشف حضور وغياب المعلمين",
      dialogAria: "إعداد كشف حضور وغياب المعلمين",
      entityLabel: "المعلمين",
      previewFallback: "كشف حضور وغياب المعلمين",
      fallbackFileName: "teachers-attendance-report.pdf",
      note: "البحث السريع داخل شاشة تقارير الحضور مخصص للعرض فقط، ولا يؤثر على الكشف المدرسي الرسمي.",
      requireStatuses: false,
      statuses: [],
      columns: [
        ["teacher_name", "اسم المعلم"],
        ["total_days", "إجمالي الأيام"],
        ["present_days", "حاضر"],
        ["total_absent", "غائب"],
        ["late_days", "متأخر"],
        ["method", "طريقة التسجيل"],
        ["presence_percent", "نسبة الالتزام"],
      ],
      presets: {
        short: [
          "teacher_name",
          "total_days",
          "present_days",
          "total_absent",
          "late_days",
          "presence_percent",
        ],
        detailed: [
          "teacher_name",
          "total_days",
          "present_days",
          "total_absent",
          "late_days",
          "method",
          "presence_percent",
        ],
      },
      makeExtraPayload(filters) {
        return {
          year_id: filters.year_id || null,
          month: filters.month || null,
          from: filters.from || null,
          to: filters.to || null,
          teacher_id: filters.teacher_id || null,
          method: filters.method || null,
          sort: filters.sort || "name_asc",
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} معلمًا في الكشف`;
      },
    },

    feesCollections: {
      api: `${API_BASE}/admin/school-reports/fees/collections`,
      dialogTitle: "إعداد كشف تحصيل الرسوم",
      dialogAria: "إعداد كشف تحصيل الرسوم",
      entityLabel: "عمليات التحصيل",
      previewFallback: "كشف تحصيل الرسوم المدرسية",
      fallbackFileName: "fees-collections-report.pdf",
      note: "يُنشأ الكشف من جميع عمليات التحصيل المطابقة للسنة والصف والشعبة والفترة وطريقة الدفع المحددة في الشاشة.",
      requireStatuses: false,
      statuses: [],
      columns: [
        ["paid_at", "التاريخ"],
        ["student_name", "اسم الطالب"],
        ["student_code", "رقم القيد"],
        ["grade_name", "الصف"],
        ["section_name", "الشعبة"],
        ["amount", "المبلغ"],
        ["method", "طريقة الدفع"],
        ["provider", "الجهة"],
        ["reference", "المرجع"],
        ["receipt_no", "رقم الإيصال"],
      ],
      presets: {
        short: [
          "paid_at",
          "student_name",
          "student_code",
          "grade_name",
          "section_name",
          "amount",
          "method",
          "receipt_no",
        ],
        detailed: [
          "paid_at",
          "student_name",
          "student_code",
          "grade_name",
          "section_name",
          "amount",
          "method",
          "provider",
          "reference",
          "receipt_no",
        ],
      },
      makeExtraPayload(filters) {
        return {
          year_id: filters.year_id || null,
          grade_id: filters.grade_id || null,
          section_id: filters.section_id || null,
          from: filters.from || null,
          to: filters.to || null,
          method: filters.method || null,
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} عملية تحصيل في الكشف`;
      },
    },

    feesOutstanding: {
      api: `${API_BASE}/admin/school-reports/fees/outstanding`,
      dialogTitle: "إعداد كشف متأخرات الرسوم",
      dialogAria: "إعداد كشف متأخرات الرسوم",
      entityLabel: "الطلاب المتأخرين",
      previewFallback: "كشف الطلاب المتأخرين في سداد الرسوم",
      fallbackFileName: "fees-outstanding-report.pdf",
      note: "يُنشأ الكشف من جميع الطلاب الذين لديهم مبالغ متبقية ضمن السنة والصف والشعبة المحددة في الشاشة.",
      requireStatuses: false,
      statuses: [],
      columns: [
        ["student_name", "اسم الطالب"],
        ["student_code", "رقم القيد"],
        ["grade_name", "الصف"],
        ["section_name", "الشعبة"],
        ["annual_amount", "الإجمالي السنوي"],
        ["paid_total", "المدفوع"],
        ["remaining", "المتبقي"],
        ["next_due_date", "موعد القسط القادم"],
      ],
      presets: {
        short: [
          "student_name",
          "student_code",
          "grade_name",
          "section_name",
          "annual_amount",
          "paid_total",
          "remaining",
        ],
        detailed: [
          "student_name",
          "student_code",
          "grade_name",
          "section_name",
          "annual_amount",
          "paid_total",
          "remaining",
          "next_due_date",
        ],
      },
      makeExtraPayload(filters) {
        return {
          year_id: filters.year_id || null,
          grade_id: filters.grade_id || null,
          section_id: filters.section_id || null,
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} طالبًا في الكشف`;
      },
    },

    monthlyWorks: {
      api: `${API_BASE}/admin/control/monthly-works/report`,
      dialogTitle: "إعداد كشف الأعمال الشهرية",
      dialogAria: "إعداد كشف الأعمال الشهرية",
      entityLabel: "الطلاب",
      previewFallback: "كشف مراجعة درجات الأعمال الشهرية",
      fallbackFileName: "monthly-works-report.pdf",
      note: "يُنشأ الكشف من الاختبار الشهري المعروض حاليًا في شاشة الكنترول، ويُذكر داخل الملف ما إذا كان الكشف معتمدًا أو ما يزال قيد المراجعة.",
      requireStatuses: false,
      statuses: [],
      columns: [
        ["student_code", "كود الطالب"],
        ["roll_number", "رقم القيد"],
        ["student_name", "اسم الطالب"],
        ["score", "الدرجة"],
        ["attendance_status", "حالة الحضور"],
        ["excuse_reason", "العذر"],
        ["status_label", "حالة الطالب"],
        ["publication_label", "حالة النشر"],
        ["note", "ملاحظة"],
      ],
      presets: {
        short: ["roll_number", "student_name", "score", "status_label"],
        detailed: [
          "student_code",
          "roll_number",
          "student_name",
          "score",
          "attendance_status",
          "excuse_reason",
          "status_label",
          "publication_label",
          "note",
        ],
      },
      makeExtraPayload(filters) {
        return {
          assessment_id: filters.assessment_id || null,
        };
      },
      previewInfo(data) {
        return `العام الدراسي: ${data?.academic_year || "—"} • سيتم إدراج ${data?.total ?? 0} طالبًا في الكشف`;
      },
    },

  };

  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("authToken") ||
      sessionStorage.getItem("token") ||
      ""
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function notify(message, type = "info") {
    if (window.AppUI?.toast) return window.AppUI.toast(message, type);
    if (window.showToast) return window.showToast(message, type);
    console.log(message);
  }

  function getDownloadFileName(response, fallback) {
    const disposition = String(response.headers.get("Content-Disposition") || "");
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
    return basicMatch?.[1] || fallback;
  }

  async function showError(message) {
    if (window.AppUI?.alert) {
      await window.AppUI.alert({ title: "تعذر إنشاء الكشف", message, type: "error" });
      return;
    }
    window.alert(message);
  }

  async function request(config, path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetch(`${config.api}${path}`, { ...options, headers });
    } catch {
      throw new Error("تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.");
    }

    if (!response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      throw new Error(data?.message || "تعذر إنشاء الكشف حاليًا.");
    }

    return response;
  }

  function makePayload(overlay, config, filters) {
    const preset = overlay.querySelector('input[name="schoolReportPreset"]:checked')?.value || "short";
    const statuses = [...overlay.querySelectorAll('input[name="schoolReportStatus"]:checked')].map((input) => input.value);
    const columns = [...overlay.querySelectorAll('input[name="schoolReportColumn"]:checked')].map((input) => input.value);

    return {
      preset,
      statuses,
      columns,
      ...(config.makeExtraPayload?.(filters, overlay) || {}),
    };
  }

  function syncAllStatuses(overlay, source) {
    const boxes = [...overlay.querySelectorAll('input[name="schoolReportStatus"]')];
    const all = overlay.querySelector("#schoolReportAllStatuses");

    if (source === all) {
      boxes.forEach((box) => {
        box.checked = !!all.checked;
      });
      return;
    }

    all.checked = boxes.every((box) => box.checked);
  }

  function applyPreset(overlay, config, preset) {
    const selected = new Set(config.presets[preset] || []);
    overlay.querySelectorAll('input[name="schoolReportColumn"]').forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function setBusy(overlay, busy) {
    overlay.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    const submit = overlay.querySelector("[data-report-submit]");
    if (submit) {
      submit.innerHTML = busy
        ? '<i class="ri-loader-4-line"></i><span>جاري التجهيز...</span>'
        : submit.dataset.originalHtml;
    }
  }

  async function updatePreview(overlay, config, filters) {
    const previewTitle = overlay.querySelector("[data-report-preview-title]");
    const previewInfo = overlay.querySelector("[data-report-preview-info]");
    const payload = makePayload(overlay, config, filters);

    if (config.requireStatuses !== false && !payload.statuses.length) {
      previewTitle.textContent = "اختر حالة واحدة على الأقل";
      previewInfo.textContent = "لن يتم إنشاء كشف قبل تحديد البيانات المراد إدراجها.";
      return;
    }

    previewInfo.textContent = "جاري حساب عدد السجلات...";

    try {
      const response = await request(config, "/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      previewTitle.textContent = result.data?.title || config.previewFallback;
      previewInfo.textContent = config.previewInfo(result.data);
    } catch (error) {
      previewTitle.textContent = "تعذر تحميل معاينة الكشف";
      previewInfo.textContent = error.message;
    }
  }

  function createScopeSection(config, filters) {
    if (!config.scopes?.length) return "";
    const selected = config.scopes.some(([value]) => value === filters.scope) ? filters.scope : config.scopes[0][0];

    return `
      <section class="school-report-section">
        <h4>${escapeHtml(config.scopesTitle || "نطاق الكشف")}</h4>
        <div class="school-report-options">
          ${config.scopes
            .map(
              ([value, label]) => `
                <label class="school-report-option">
                  <input type="radio" name="schoolReportScope" value="${escapeHtml(value)}" ${value === selected ? "checked" : ""} />
                  ${escapeHtml(label)}
                </label>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function createStatusesSection(config) {
    if (!config.statuses?.length) return "";

    return `
      <section class="school-report-section">
        <h4>${escapeHtml(config.statusesTitle || "الحالات المراد إدراجها")}</h4>
        <div class="school-report-options">
          <label class="school-report-option"><input type="checkbox" id="schoolReportAllStatuses" /> جميع الحالات</label>
          ${config.statuses
            .map(
              ([value, label], index) => `
                <label class="school-report-option">
                  <input type="checkbox" name="schoolReportStatus" value="${escapeHtml(value)}" ${index === 0 ? "checked" : ""} />
                  ${escapeHtml(label)}
                </label>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function createOverlay(action, config, filters) {
    const overlay = document.createElement("div");
    overlay.className = "school-report-overlay";

    const actionLabel = action === "print" ? "فتح الطباعة" : "تنزيل PDF";
    const actionIcon = action === "print" ? "ri-printer-line" : "ri-file-pdf-2-line";

    overlay.innerHTML = `
      <section class="school-report-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(config.dialogAria)}">
        <header class="school-report-head">
          <div class="school-report-heading">
            <div class="school-report-icon"><i class="ri-file-list-3-line"></i></div>
            <div>
              <h3 class="school-report-title">${escapeHtml(config.dialogTitle)}</h3>
              <div class="school-report-subtitle">حدد شكل الكشف والمعلومات التي تريد ظهورها قبل التنفيذ.</div>
            </div>
          </div>
          <button type="button" class="school-report-close" data-report-close aria-label="إغلاق">×</button>
        </header>

        <div class="school-report-body">
          <div class="school-report-preview">
            <strong data-report-preview-title>جاري تجهيز المعاينة...</strong>
            <span data-report-preview-info>جاري حساب عدد السجلات...</span>
          </div>

          <div class="school-report-grid">
            <section class="school-report-section">
              <h4>نوع الكشف</h4>
              <div class="school-report-options">
                <label class="school-report-option"><input type="radio" name="schoolReportPreset" value="short" checked /> كشف مختصر</label>
                <label class="school-report-option"><input type="radio" name="schoolReportPreset" value="detailed" /> كشف تفصيلي</label>
                <label class="school-report-option"><input type="radio" name="schoolReportPreset" value="manual" /> اختيار الأعمدة يدويًا</label>
              </div>
            </section>

            ${createScopeSection(config, filters)}

            ${createStatusesSection(config)}

            <section class="school-report-section school-report-section--full">
              <h4>الأعمدة التي ستظهر داخل الكشف</h4>
              <div class="school-report-options school-report-options--columns">
                ${config.columns
                  .map(
                    ([value, label]) => `
                      <label class="school-report-option">
                        <input type="checkbox" name="schoolReportColumn" value="${escapeHtml(value)}" />
                        ${escapeHtml(label)}
                      </label>
                    `
                  )
                  .join("")}
              </div>
              <p class="school-report-note">${escapeHtml(config.note)}</p>
            </section>
          </div>
        </div>

        <footer class="school-report-actions">
          <button type="button" class="school-report-btn school-report-btn--primary" data-report-submit>
            <i class="${actionIcon}"></i><span>${actionLabel}</span>
          </button>
          <button type="button" class="school-report-btn school-report-btn--ghost" data-report-close>إلغاء</button>
        </footer>
      </section>
    `;

    const submit = overlay.querySelector("[data-report-submit]");
    submit.dataset.originalHtml = submit.innerHTML;
    applyPreset(overlay, config, "short");

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-report-close]")) overlay.remove();
    });

    overlay.querySelectorAll('input[name="schoolReportPreset"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked && radio.value !== "manual") applyPreset(overlay, config, radio.value);
        clearTimeout(overlay.__previewTimer);
        overlay.__previewTimer = setTimeout(() => updatePreview(overlay, config, filters), 100);
      });
    });

    overlay.querySelectorAll('input[name="schoolReportColumn"]').forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const manual = overlay.querySelector('input[name="schoolReportPreset"][value="manual"]');
        if (manual) manual.checked = true;
        clearTimeout(overlay.__previewTimer);
        overlay.__previewTimer = setTimeout(() => updatePreview(overlay, config, filters), 100);
      });
    });

    overlay.querySelectorAll('input[name="schoolReportStatus"], #schoolReportAllStatuses, input[name="schoolReportScope"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.name === "schoolReportStatus" || input.id === "schoolReportAllStatuses") {
          syncAllStatuses(overlay, input);
        }
        clearTimeout(overlay.__previewTimer);
        overlay.__previewTimer = setTimeout(() => updatePreview(overlay, config, filters), 150);
      });
    });

    submit.addEventListener("click", async () => {
      const payload = makePayload(overlay, config, filters);
      if (config.requireStatuses !== false && !payload.statuses.length) return showError("اختر حالة واحدة على الأقل للبيانات المراد إدراجها.");
      if (!payload.columns.length) return showError("اختر عمودًا واحدًا على الأقل ليظهر داخل الكشف.");

      let printWindow = null;
      if (action === "print") {
        printWindow = window.open("", "_blank");
        if (!printWindow) return showError("تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.");
        printWindow.document.write("<p dir='rtl' style='font-family:Tahoma;padding:20px'>جاري تجهيز الكشف للطباعة...</p>");
      }

      setBusy(overlay, true);
      try {
        if (action === "print") {
          const response = await request(config, "/print", { method: "POST", body: JSON.stringify(payload) });
          const html = await response.text();
          printWindow.document.open();
          printWindow.document.write(html);
          printWindow.document.close();
          notify("تم فتح الكشف للطباعة بنجاح.", "success");
        } else {
          const response = await request(config, "/pdf", { method: "POST", body: JSON.stringify(payload) });
          const blob = await response.blob();
          const href = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = href;
          link.download = getDownloadFileName(response, config.fallbackFileName);
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(href), 1200);
          notify("تم تجهيز ملف PDF وتنزيله بنجاح.", "success");
        }
        overlay.remove();
      } catch (error) {
        printWindow?.close?.();
        setBusy(overlay, false);
        await showError(error.message || "تعذر إنشاء الكشف.");
      }
    });

    return overlay;
  }

  async function openReport(type, { action = "pdf", filters = {} } = {}) {
    const config = CONFIGS[type];
    if (!config) return showError("نوع الكشف المطلوب غير مدعوم.");

    document.querySelectorAll(".school-report-overlay").forEach((node) => node.remove());
    const overlay = createOverlay(action, config, filters);
    document.body.appendChild(overlay);
    await updatePreview(overlay, config, filters);
  }

  window.SchoolReports = {
    version: REPORTS_UI_VERSION,
    openStudentsReport(options) {
      return openReport("students", options);
    },
    openStaffReport(options) {
      return openReport("staff", options);
    },
    openAttendanceStudentsReport(options) {
      return openReport("attendanceStudents", options);
    },
    openAttendanceTeachersReport(options) {
      return openReport("attendanceTeachers", options);
    },
    openFeesCollectionsReport(options) {
      return openReport("feesCollections", options);
    },
    openFeesOutstandingReport(options) {
      return openReport("feesOutstanding", options);
    },
    openMonthlyWorksReport(options) {
      return openReport("monthlyWorks", options);
    },
  };
})();
