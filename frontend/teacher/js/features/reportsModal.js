
(function () {
  "use strict";

const DEFAULT_OPTIONS = {
  apiBase: "/api",
  endpoints: {
    initialMeta: "/api/teacher/reports/meta",
    scopes: "/api/teacher/reports/scopes",
    context: "/api/teacher/reports/context",
    generate: "/api/teacher/reports/generate"
  },
  attendanceRequiresSubject: true
};

  const REPORT_DEFINITIONS = {
    class_grades_report: {
      title: "كشف درجات الصف",
      fields: ["subject", "period", "evaluationType"]
    },
    student_performance_report: {
      title: "تقرير أداء طالب",
      fields: ["subject", "period", "student"]
    },
    attendance_report: {
      title: "تقرير الحضور والغياب",
      fields: ["period", "attendanceScope"]
    },
    exam_results_summary: {
      title: "ملخص نتائج اختبار",
      fields: ["subject", "period", "exam"]
    },
    assignments_report: {
      title: "تقرير الواجبات والتكليفات",
      fields: ["subject", "period", "assignment"]
    },
    struggling_students_report: {
      title: "تقرير الطلاب المتعثرين",
      fields: ["subject", "period", "strugglingCriteria"]
    },
    top_students_report: {
      title: "تقرير الطلاب المتميزين",
      fields: ["subject", "period", "topCriteria"]
    },
    grade_entry_sheet: {
      title: "كشف رصد الدرجات",
      fields: ["subject", "period", "gradeSheetType", "evaluationType"]
    }
  };

  function initTeacherReportsModal(userOptions = {}) {
    const options = mergeDeep(DEFAULT_OPTIONS, userOptions);

    const els = {
      modal: byId("modal-reports"),
      form: byId("reports-form"),

      close: byId("reports-close"),
      cancel: byId("rp-cancel"),

      type: byId("rp-type"),
      year: byId("rp-year"),
      term: byId("rp-term"),
      stage: byId("rp-stage"),
      grade: byId("rp-grade"),
      section: byId("rp-section"),
      subject: byId("rp-subject"),
      period: byId("rp-period"),
      fromDate: byId("rp-from-date"),
      toDate: byId("rp-to-date"),
      evaluationType: byId("rp-evaluation-type"),
      student: byId("rp-student"),
      attendanceScope: byId("rp-attendance-scope"),
      exam: byId("rp-exam"),
      assignment: byId("rp-assignment"),
      strugglingCriteria: byId("rp-struggling-criteria"),
      topCriteria: byId("rp-top-criteria"),
      gradeSheetType: byId("rp-grade-sheet-type"),
      notes: byId("rp-notes"),

      generate: byId("rp-generate"),
      preview: byId("rp-preview"),
      download: byId("rp-download"),

      status: byId("rp-status"),
      error: byId("rp-error"),
      success: byId("rp-success"),

      previewSection: byId("rp-preview-section"),
      previewBox: byId("rp-preview-box"),
      previewFrame: byId("rp-preview-frame")
    };

    if (!isDomReady(els)) {
      console.warn("Teacher reports modal: required DOM elements are missing.");
      return null;
    }

    const state = {
      scopes: [],
      currentContext: {
        subjects: [],
        students: [],
        assessments: [],
        assignments: []
      },
      lastGenerated: {
        objectUrl: "",
        fileName: "",
        downloadUrl: "",
        previewUrl: ""
      }
    };

    const fields = {
      type: createFieldDescriptor(els.type),
      year: createFieldDescriptor(els.year),
      term: createFieldDescriptor(els.term),
      stage: createFieldDescriptor(els.stage),
      grade: createFieldDescriptor(els.grade),
      section: createFieldDescriptor(els.section),
      subject: createFieldDescriptor(els.subject),
      period: createFieldDescriptor(els.period),
      fromDate: createFieldDescriptor(els.fromDate),
      toDate: createFieldDescriptor(els.toDate),
      evaluationType: createFieldDescriptor(els.evaluationType),
      student: createFieldDescriptor(els.student),
      attendanceScope: createFieldDescriptor(els.attendanceScope),
      exam: createFieldDescriptor(els.exam),
      assignment: createFieldDescriptor(els.assignment),
      strugglingCriteria: createFieldDescriptor(els.strugglingCriteria),
      topCriteria: createFieldDescriptor(els.topCriteria),
      gradeSheetType: createFieldDescriptor(els.gradeSheetType),
      notes: createFieldDescriptor(els.notes)
    };

    bindEvents();
    initializeUi();
    loadInitialMeta();

    return {
      open: openModal,
      close: closeModal,
      reload: loadInitialMeta
    };

    function bindEvents() {
      if (els.close) els.close.addEventListener("click", closeModal);
      if (els.cancel) els.cancel.addEventListener("click", closeModal);

      if (els.modal) {
        els.modal.addEventListener("click", function (e) {
          if (e.target === els.modal) {
            closeModal();
          }
        });
      }

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && els.modal && !els.modal.hasAttribute("hidden")) {
          closeModal();
        }
      });

      els.year.addEventListener("change", onYearOrTermChange);
      els.term.addEventListener("change", onYearOrTermChange);

      els.stage.addEventListener("change", function () {
        fillGradesFromScopes();
        resetSectionSelect();
        resetContextSelects();
        updateDynamicFields();
      });

      els.grade.addEventListener("change", function () {
        fillSectionsFromScopes();
        resetContextSelects();
        updateDynamicFields();
      });

      els.section.addEventListener("change", async function () {
        resetContextSelects();
        await loadContext();
        updateDynamicFields();
      });

      els.subject.addEventListener("change", async function () {
        if (needsSubjectDependentContext()) {
          await loadContext();
        }
        updateDynamicFields();
      });

      els.type.addEventListener("change", async function () {
        clearMessages();
        resetPreview();
        updateDynamicFields();

        if (requiresContextReloadOnTypeChange()) {
          await loadContext();
        }
      });

      els.period.addEventListener("change", function () {
        updateDynamicFields();
      });

      els.attendanceScope.addEventListener("change", function () {
        updateDynamicFields();
      });

      els.gradeSheetType.addEventListener("change", function () {
        updateDynamicFields();
      });

      els.generate.addEventListener("click", generateReport);
      els.preview.addEventListener("click", previewReportInNewTab);
      els.download.addEventListener("click", downloadLastReport);
    }

    function initializeUi() {
      setStatus('اختر نوع التقرير وحدد البيانات المطلوبة ثم اضغط على "إنشاء التقرير".');
      clearMessages();
      resetHierarchy();
      resetContextSelects();
      hideAllDynamicFields();
      resetPreview();

      if (els.preview) els.preview.hidden = true;
      if (els.download) els.download.hidden = true;
    }

    function openModal() {
      if (!els.modal) return;
      els.modal.removeAttribute("hidden");
      els.modal.setAttribute("aria-hidden", "false");
      els.modal.classList.add("is-open");
    }

    function closeModal() {
      if (!els.modal) return;
      els.modal.setAttribute("aria-hidden", "true");
      els.modal.setAttribute("hidden", "hidden");
      els.modal.classList.remove("is-open");
    }

    async function loadInitialMeta() {
      setLoadingState(true, "جارٍ تحميل البيانات الأساسية...");
      clearMessages();

      try {
        resetHierarchy();
        resetContextSelects();

        const result = await apiRequest(buildUrl(options.endpoints.initialMeta), {
          method: "GET"
        });

        const data = result?.data || result || {};

        fillSelect(els.year, data.years || [], {
          placeholder: "اختر السنة الدراسية",
          valueKey: "id",
          labelKey: "name"
        });

        if (Array.isArray(data.terms) && data.terms.length) {
          fillSelect(els.term, data.terms, {
            placeholder: "اختر الفصل الدراسي",
            valueKey: "value",
            labelKey: "label",
            preserveIfPossible: false
          });
        }

        setStatus("تم تحميل البيانات الأساسية. اختر السنة والفصل الدراسي ثم أكمل بقية الحقول.");
      } catch (error) {
        showError(error.message || "فشل تحميل البيانات الأساسية.");
      } finally {
        setLoadingState(false);
      }
    }

    async function onYearOrTermChange() {
      resetHierarchy();
      resetContextSelects();
      clearMessages();
      resetPreview();
      hideAllDynamicFields();

      const academicYearId = valueOf(els.year);
      const term = valueOf(els.term);

      if (!academicYearId) {
        setStatus("اختر السنة الدراسية أولًا.");
        return;
      }

      if (!term) {
        setStatus("اختر الفصل الدراسي.");
        return;
      }

      await loadScopes();
      updateDynamicFields();
    }

    async function loadScopes() {
      setLoadingState(true, "جارٍ تحميل نطاقات المعلم...");
      state.scopes = [];

      try {
        const url = buildUrl(options.endpoints.scopes, {
          academicYearId: valueOf(els.year),
          term: valueOf(els.term)
        });

        const result = await apiRequest(url, { method: "GET" });
        state.scopes = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];

        const stages = uniqueBy(state.scopes, "stage_id").map(function (item) {
          return { id: item.stage_id, name: item.stage_name };
        });

        fillSelect(els.stage, stages, {
          placeholder: "اختر المرحلة",
          valueKey: "id",
          labelKey: "name"
        });

        els.stage.disabled = stages.length === 0;
        els.grade.disabled = true;
        els.section.disabled = true;

        if (!state.scopes.length) {
          setStatus("لا توجد نطاقات متاحة لك في هذه السنة والفصل.");
          return;
        }

        setStatus("تم تحميل نطاقاتك. اختر المرحلة ثم الصف ثم الشعبة.");
      } catch (error) {
        showError(error.message || "فشل تحميل نطاقات المعلم.");
      } finally {
        setLoadingState(false);
      }
    }

    function fillGradesFromScopes() {
      const stageId = valueOf(els.stage);

      const filtered = state.scopes.filter(function (item) {
        if (!stageId) return true;
        return String(item.stage_id) === String(stageId);
      });

      const grades = uniqueBy(filtered, "grade_id").map(function (item) {
        return { id: item.grade_id, name: item.grade_name };
      });

      fillSelect(els.grade, grades, {
        placeholder: "اختر الصف",
        valueKey: "id",
        labelKey: "name"
      });

      els.grade.disabled = grades.length === 0;
    }

    function fillSectionsFromScopes() {
      const stageId = valueOf(els.stage);
      const gradeId = valueOf(els.grade);

      const filtered = state.scopes.filter(function (item) {
        if (stageId && String(item.stage_id) !== String(stageId)) return false;
        if (gradeId && String(item.grade_id) !== String(gradeId)) return false;
        return true;
      });

      const sections = uniqueBy(filtered, "section_id").map(function (item) {
        return { id: item.section_id, name: item.section_name };
      });

      fillSelect(els.section, sections, {
        placeholder: "اختر الشعبة",
        valueKey: "id",
        labelKey: "name"
      });

      els.section.disabled = sections.length === 0;
    }

    async function loadContext() {
      const academicYearId = valueOf(els.year);
      const term = valueOf(els.term);
      const stageId = valueOf(els.stage);
      const gradeId = valueOf(els.grade);
      const sectionId = valueOf(els.section);
      const subjectId = valueOf(els.subject);

      if (!academicYearId || !term || !stageId || !gradeId || !sectionId) {
        return;
      }

      setLoadingState(true, "جارٍ تحميل بيانات التقرير...");
      clearMessages();

      try {
        const url = buildUrl(options.endpoints.context, {
          academicYearId,
          term,
          stageId,
          gradeId,
          sectionId,
          subjectId
        });

        const result = await apiRequest(url, { method: "GET" });
        const data = result?.data || result || {};

        state.currentContext.subjects = Array.isArray(data.subjects) ? data.subjects : [];
        state.currentContext.students = Array.isArray(data.students) ? data.students : [];
        state.currentContext.assessments = Array.isArray(data.assessments) ? data.assessments : [];
        state.currentContext.assignments = Array.isArray(data.assignments) ? data.assignments : [];

        fillSelect(els.subject, state.currentContext.subjects, {
          placeholder: "اختر المادة",
          valueKey: "id",
          labelKey: "name",
          preserveIfPossible: true
        });

        fillSelect(els.student, state.currentContext.students, {
          placeholder: "اختر الطالب",
          valueKey: "id",
          labelKey: "name",
          preserveIfPossible: true
        });

        fillSelect(els.exam, state.currentContext.assessments, {
          placeholder: "اختر الاختبار",
          valueKey: "id",
          labelKey: "name",
          preserveIfPossible: true
        });

        fillSelect(els.assignment, state.currentContext.assignments, {
          placeholder: "اختر الواجب أو التكليف",
          valueKey: "id",
          labelKey: "name",
          preserveIfPossible: false,
          extraFirstOptions: [{ value: "all", label: "جميع الواجبات" }]
        });

        setStatus("تم تحميل بيانات التقرير. يمكنك الآن إنشاء التقرير.");
      } catch (error) {
        showError(error.message || "فشل تحميل بيانات التقرير.");
      } finally {
        setLoadingState(false);
      }
    }

    function updateDynamicFields() {
      hideAllDynamicFields();

      const reportType = valueOf(els.type);
      const reportDef = REPORT_DEFINITIONS[reportType];

      if (!reportDef) {
        return;
      }

      const requestedFields = new Set(reportDef.fields);

      if (reportType === "attendance_report" && options.attendanceRequiresSubject) {
        requestedFields.add("subject");
      }

      requestedFields.forEach(function (fieldKey) {
        showField(fieldKey);
      });

      if (requestedFields.has("period")) {
        const period = valueOf(els.period);
        const shouldShowDateRange = period === "custom" || period === "month";
        toggleField("fromDate", shouldShowDateRange);
        toggleField("toDate", shouldShowDateRange);
      }

      if (reportType === "attendance_report") {
        const scope = valueOf(els.attendanceScope);
        toggleField("student", scope === "student");
      }

      if (reportType === "grade_entry_sheet") {
        const gradeSheetType = valueOf(els.gradeSheetType);
        if (gradeSheetType === "assessment_type") {
          showField("evaluationType");
        }
      }

      applyRequirements(reportType);
    }

    function applyRequirements(reportType) {
      const requiredMap = {
        year: true,
        term: true,
        stage: true,
        grade: true,
        section: true,

        type: true,
        subject: false,
        period: false,
        fromDate: false,
        toDate: false,
        evaluationType: false,
        student: false,
        attendanceScope: false,
        exam: false,
        assignment: false,
        strugglingCriteria: false,
        topCriteria: false,
        gradeSheetType: false
      };

      switch (reportType) {
        case "class_grades_report":
          requiredMap.subject = true;
          requiredMap.period = true;
          break;

        case "student_performance_report":
          requiredMap.subject = true;
          requiredMap.period = true;
          requiredMap.student = true;
          break;

        case "attendance_report":
          requiredMap.period = true;
          requiredMap.attendanceScope = true;
          if (options.attendanceRequiresSubject) {
            requiredMap.subject = true;
          }
          if (valueOf(els.attendanceScope) === "student") {
            requiredMap.student = true;
          }
          break;

        case "exam_results_summary":
          requiredMap.subject = true;
          requiredMap.period = true;
          requiredMap.exam = true;
          break;

        case "assignments_report":
          requiredMap.subject = true;
          requiredMap.period = true;
          break;

        case "struggling_students_report":
          requiredMap.subject = true;
          requiredMap.period = true;
          requiredMap.strugglingCriteria = true;
          break;

        case "top_students_report":
          requiredMap.subject = true;
          requiredMap.period = true;
          requiredMap.topCriteria = true;
          break;

        case "grade_entry_sheet":
          requiredMap.subject = true;
          requiredMap.period = true;
          requiredMap.gradeSheetType = true;
          if (valueOf(els.gradeSheetType) === "assessment_type") {
            requiredMap.evaluationType = true;
          }
          break;
      }

      const period = valueOf(els.period);
      if (period === "custom" || period === "month") {
        requiredMap.fromDate = true;
        requiredMap.toDate = true;
      }

      Object.keys(fields).forEach(function (fieldKey) {
        setFieldRequired(fieldKey, !!requiredMap[fieldKey]);
      });
    }

    function validateForm() {
      const reportType = valueOf(els.type);
      const missing = [];

      if (!reportType) missing.push(getFieldLabel("type"));
      if (!valueOf(els.year)) missing.push(getFieldLabel("year"));
      if (!valueOf(els.term)) missing.push(getFieldLabel("term"));
      if (!valueOf(els.stage)) missing.push(getFieldLabel("stage"));
      if (!valueOf(els.grade)) missing.push(getFieldLabel("grade"));
      if (!valueOf(els.section)) missing.push(getFieldLabel("section"));

      const reportDef = REPORT_DEFINITIONS[reportType];
      if (!reportDef) {
        missing.push("نوع التقرير");
      }

      if (fieldIsVisible("subject") && isFieldRequired("subject") && !valueOf(els.subject)) {
        missing.push(getFieldLabel("subject"));
      }

      if (fieldIsVisible("period") && isFieldRequired("period") && !valueOf(els.period)) {
        missing.push(getFieldLabel("period"));
      }

      if (fieldIsVisible("fromDate") && isFieldRequired("fromDate") && !valueOf(els.fromDate)) {
        missing.push(getFieldLabel("fromDate"));
      }

      if (fieldIsVisible("toDate") && isFieldRequired("toDate") && !valueOf(els.toDate)) {
        missing.push(getFieldLabel("toDate"));
      }

      if (fieldIsVisible("evaluationType") && isFieldRequired("evaluationType") && !valueOf(els.evaluationType)) {
        missing.push(getFieldLabel("evaluationType"));
      }

      if (fieldIsVisible("student") && isFieldRequired("student") && !valueOf(els.student)) {
        missing.push(getFieldLabel("student"));
      }

      if (fieldIsVisible("attendanceScope") && isFieldRequired("attendanceScope") && !valueOf(els.attendanceScope)) {
        missing.push(getFieldLabel("attendanceScope"));
      }

      if (fieldIsVisible("exam") && isFieldRequired("exam") && !valueOf(els.exam)) {
        missing.push(getFieldLabel("exam"));
      }

      if (fieldIsVisible("assignment") && isFieldRequired("assignment") && !valueOf(els.assignment)) {
        missing.push(getFieldLabel("assignment"));
      }

      if (fieldIsVisible("strugglingCriteria") && isFieldRequired("strugglingCriteria") && !valueOf(els.strugglingCriteria)) {
        missing.push(getFieldLabel("strugglingCriteria"));
      }

      if (fieldIsVisible("topCriteria") && isFieldRequired("topCriteria") && !valueOf(els.topCriteria)) {
        missing.push(getFieldLabel("topCriteria"));
      }

      if (fieldIsVisible("gradeSheetType") && isFieldRequired("gradeSheetType") && !valueOf(els.gradeSheetType)) {
        missing.push(getFieldLabel("gradeSheetType"));
      }

      if (
        fieldIsVisible("fromDate") &&
        fieldIsVisible("toDate") &&
        valueOf(els.fromDate) &&
        valueOf(els.toDate) &&
        valueOf(els.fromDate) > valueOf(els.toDate)
      ) {
        showError("تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية.");
        return false;
      }

      if (missing.length) {
        showError("يرجى تعبئة الحقول التالية: " + missing.join("، "));
        return false;
      }

      clearMessages();
      return true;
    }

    async function generateReport() {
      resetPreview();
      clearMessages();

      updateDynamicFields();

      if (!validateForm()) {
        return;
      }

      const payload = buildPayload();
      setLoadingState(true, "جاري تجهيز التقرير...");

      try {
        const response = await apiRawRequest(buildUrl(options.endpoints.generate), {
          method: "POST",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json"
          }
        });

        const contentType = (response.headers.get("Content-Type") || "").toLowerCase();

        if (contentType.includes("application/json")) {
          const json = await response.json();

          if (!response.ok) {
            throw new Error(json.message || "فشل إنشاء التقرير.");
          }

          handleJsonGenerateResponse(json);
        } else {
          if (!response.ok) {
            const text = await response.text().catch(function () { return ""; });
            throw new Error(text || "فشل إنشاء التقرير.");
          }

          const blob = await response.blob();
          handleBlobGenerateResponse(blob, response);
        }

        showSuccess("تم إنشاء التقرير بنجاح. يمكنك الآن معاينته أو تحميله.");
        setStatus("تم إنشاء التقرير بنجاح.");
      } catch (error) {
        showError(error.message || "حدث خطأ أثناء إنشاء التقرير.");
      } finally {
        setLoadingState(false);
      }
    }

    function handleJsonGenerateResponse(json) {
      revokeLastObjectUrl();

      state.lastGenerated.previewUrl = json.previewUrl || json.url || "";
      state.lastGenerated.downloadUrl = json.downloadUrl || json.url || "";
      state.lastGenerated.fileName = json.fileName || defaultFileName();

      if (state.lastGenerated.previewUrl) {
        els.previewFrame.src = state.lastGenerated.previewUrl;
        els.previewSection.hidden = false;
      }

      els.preview.hidden = !state.lastGenerated.previewUrl;
      els.download.hidden = !state.lastGenerated.downloadUrl;
    }

    function handleBlobGenerateResponse(blob, response) {
      revokeLastObjectUrl();

      const objectUrl = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileName = extractFileNameFromDisposition(disposition) || defaultFileName();

      state.lastGenerated.objectUrl = objectUrl;
      state.lastGenerated.previewUrl = objectUrl;
      state.lastGenerated.downloadUrl = objectUrl;
      state.lastGenerated.fileName = fileName;

      els.previewFrame.src = objectUrl;
      els.previewSection.hidden = false;
      els.preview.hidden = false;
      els.download.hidden = false;
    }

    function previewReportInNewTab() {
      const previewUrl = state.lastGenerated.previewUrl || state.lastGenerated.objectUrl;
      if (!previewUrl) {
        showError("لا توجد معاينة متاحة حاليًا.");
        return;
      }
      window.open(previewUrl, "_blank", "noopener,noreferrer");
    }

    function downloadLastReport() {
      const url = state.lastGenerated.downloadUrl || state.lastGenerated.objectUrl;
      if (!url) {
        showError("لا يوجد تقرير جاهز للتحميل.");
        return;
      }

      const link = document.createElement("a");
      link.href = url;
      link.download = state.lastGenerated.fileName || defaultFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    function buildPayload() {
      const reportType = valueOf(els.type);

      return {
        reportType,
        reportTitle: REPORT_DEFINITIONS[reportType]?.title || "",
        academicYearId: valueOf(els.year),
        term: valueOf(els.term),
        stageId: valueOf(els.stage),
        gradeId: valueOf(els.grade),
        sectionId: valueOf(els.section),

        subjectId: fieldIsVisible("subject") ? valueOf(els.subject) : "",
        period: fieldIsVisible("period") ? valueOf(els.period) : "",
        fromDate: fieldIsVisible("fromDate") ? valueOf(els.fromDate) : "",
        toDate: fieldIsVisible("toDate") ? valueOf(els.toDate) : "",
        evaluationType: fieldIsVisible("evaluationType") ? valueOf(els.evaluationType) : "",
        studentId: fieldIsVisible("student") ? valueOf(els.student) : "",
        attendanceScope: fieldIsVisible("attendanceScope") ? valueOf(els.attendanceScope) : "",
        assessmentId: fieldIsVisible("exam") ? valueOf(els.exam) : "",
        assignmentId: fieldIsVisible("assignment") ? valueOf(els.assignment) : "",
        strugglingCriteria: fieldIsVisible("strugglingCriteria") ? valueOf(els.strugglingCriteria) : "",
        topCriteria: fieldIsVisible("topCriteria") ? valueOf(els.topCriteria) : "",
        gradeSheetType: fieldIsVisible("gradeSheetType") ? valueOf(els.gradeSheetType) : "",
        notes: valueOf(els.notes)
      };
    }

    function resetHierarchy() {
      fillSelect(els.stage, [], { placeholder: "اختر المرحلة" });
      fillSelect(els.grade, [], { placeholder: "اختر الصف" });
      fillSelect(els.section, [], { placeholder: "اختر الشعبة" });

      els.stage.disabled = true;
      els.grade.disabled = true;
      els.section.disabled = true;
    }

    function resetSectionSelect() {
      fillSelect(els.section, [], { placeholder: "اختر الشعبة" });
      els.section.disabled = true;
    }

    function resetContextSelects() {
      fillSelect(els.subject, [], { placeholder: "اختر المادة" });
      fillSelect(els.student, [], { placeholder: "اختر الطالب" });
      fillSelect(els.exam, [], { placeholder: "اختر الاختبار" });
      fillSelect(els.assignment, [], {
        placeholder: "اختر الواجب أو التكليف",
        extraFirstOptions: [{ value: "all", label: "جميع الواجبات" }]
      });

      state.currentContext.subjects = [];
      state.currentContext.students = [];
      state.currentContext.assessments = [];
      state.currentContext.assignments = [];
    }

    function hideAllDynamicFields() {
      [
        "subject",
        "period",
        "fromDate",
        "toDate",
        "evaluationType",
        "student",
        "attendanceScope",
        "exam",
        "assignment",
        "strugglingCriteria",
        "topCriteria",
        "gradeSheetType",
        "notes"
      ].forEach(function (fieldKey) {
        hideField(fieldKey);
      });
    }

    function showField(fieldKey) {
      const field = fields[fieldKey];
      if (!field || !field.wrapper || !field.element) return;
      field.wrapper.hidden = false;
      field.element.disabled = false;
    }

    function hideField(fieldKey) {
      const field = fields[fieldKey];
      if (!field || !field.wrapper || !field.element) return;
      field.wrapper.hidden = true;
      field.element.disabled = true;
    }

    function toggleField(fieldKey, shouldShow) {
      if (shouldShow) showField(fieldKey);
      else hideField(fieldKey);
    }

    function fieldIsVisible(fieldKey) {
      const field = fields[fieldKey];
      if (!field || !field.wrapper) return false;
      return !field.wrapper.hidden;
    }

    function setFieldRequired(fieldKey, required) {
      const field = fields[fieldKey];
      if (!field || !field.element) return;
      field.required = required;
      field.element.required = required;
      field.element.setAttribute("aria-required", required ? "true" : "false");
    }

    function isFieldRequired(fieldKey) {
      return !!fields[fieldKey]?.required;
    }

    function getFieldLabel(fieldKey) {
      return fields[fieldKey]?.label || "";
    }

    function setLoadingState(isLoading, statusText) {
      if (typeof statusText === "string") {
        setStatus(statusText);
      }

      const shouldDisableGenerate = isLoading;
      if (els.generate) els.generate.disabled = shouldDisableGenerate;
      if (els.preview) els.preview.disabled = isLoading;
      if (els.download) els.download.disabled = isLoading;
    }

    function setStatus(message) {
      if (els.status) {
        els.status.textContent = message || "";
      }
    }

    function clearMessages() {
      if (els.error) {
        els.error.textContent = "";
        els.error.hidden = true;
      }
      if (els.success) {
        els.success.textContent = "";
        els.success.hidden = true;
      }
    }

    function showError(message) {
      clearMessages();
      setStatus(message || "حدث خطأ.");
      if (els.error) {
        els.error.textContent = message || "حدث خطأ.";
        els.error.hidden = false;
      }
    }

    function showSuccess(message) {
      clearMessages();
      if (els.success) {
        els.success.textContent = message || "";
        els.success.hidden = false;
      }
    }

    function resetPreview() {
      revokeLastObjectUrl();

      state.lastGenerated = {
        objectUrl: "",
        fileName: "",
        downloadUrl: "",
        previewUrl: ""
      };

      if (els.previewFrame) {
        els.previewFrame.src = "about:blank";
      }
      if (els.previewSection) {
        els.previewSection.hidden = true;
      }
      if (els.preview) {
        els.preview.hidden = true;
      }
      if (els.download) {
        els.download.hidden = true;
      }
    }

    function revokeLastObjectUrl() {
      if (state.lastGenerated.objectUrl) {
        URL.revokeObjectURL(state.lastGenerated.objectUrl);
      }
    }

    function defaultFileName() {
      const type = valueOf(els.type) || "teacher-report";
      const now = new Date();
      const stamp =
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0") +
        "_" +
        String(now.getHours()).padStart(2, "0") +
        "-" +
        String(now.getMinutes()).padStart(2, "0");

      return type + "-" + stamp + ".pdf";
    }

    function needsSubjectDependentContext() {
      const reportType = valueOf(els.type);
      return [
        "exam_results_summary",
        "assignments_report",
        "class_grades_report",
        "grade_entry_sheet",
        "student_performance_report"
      ].includes(reportType);
    }

    function requiresContextReloadOnTypeChange() {
      return !!valueOf(els.section);
    }
  }

  function apiRequest(url, options) {
    return apiRawRequest(url, options).then(async function (response) {
      const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
      const isJson = contentType.includes("application/json");
      const payload = isJson ? await response.json() : null;

      if (!response.ok) {
        throw new Error(payload?.message || "فشل الطلب.");
      }

      return payload;
    });
  }

  function apiRawRequest(url, options = {}) {
    const token = getToken();

    const headers = Object.assign({}, options.headers || {});
    if (token && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }

    return fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body,
      credentials: "same-origin"
    });
  }

  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("accessToken") ||
      localStorage.getItem("authToken") ||
      ""
    );
  }

  function fillSelect(select, items, config = {}) {
    if (!select) return;

    const placeholder = config.placeholder || "اختر";
    const valueKey = config.valueKey || "id";
    const labelKey = config.labelKey || "name";
    const preserveIfPossible = !!config.preserveIfPossible;
    const extraFirstOptions = Array.isArray(config.extraFirstOptions) ? config.extraFirstOptions : [];

    const oldValue = preserveIfPossible ? select.value : "";

    const optionsHtml = [];

    optionsHtml.push('<option value="">' + escapeHtml(placeholder) + "</option>");

    extraFirstOptions.forEach(function (item) {
      optionsHtml.push(
        '<option value="' + escapeHtml(String(item.value)) + '">' +
          escapeHtml(String(item.label)) +
        "</option>"
      );
    });

    (items || []).forEach(function (item) {
      const value = item?.[valueKey] ?? item?.value ?? "";
      const label = item?.[labelKey] ?? item?.label ?? "";
      optionsHtml.push(
        '<option value="' + escapeHtml(String(value)) + '">' +
          escapeHtml(String(label)) +
        "</option>"
      );
    });

    select.innerHTML = optionsHtml.join("");

    if (preserveIfPossible && oldValue) {
      const hasOldValue = Array.from(select.options).some(function (opt) {
        return String(opt.value) === String(oldValue);
      });
      if (hasOldValue) {
        select.value = oldValue;
      }
    }

    select.disabled = (items || []).length === 0 && extraFirstOptions.length === 0;
  }

  function uniqueBy(arr, key) {
    const seen = new Set();
    const output = [];

    (arr || []).forEach(function (item) {
      const value = item?.[key];
      if (value === undefined || value === null || seen.has(String(value))) return;
      seen.add(String(value));
      output.push(item);
    });

    return output;
  }

  function createFieldDescriptor(element) {
    const wrapper = element ? element.closest(".form-group") : null;
    const labelEl = wrapper ? wrapper.querySelector("label") : null;

    return {
      element,
      wrapper,
      required: false,
      label: labelEl ? labelEl.textContent.replace(/\*/g, "").trim() : ""
    };
  }

  function buildUrl(path, query) {
    const url = new URL(path, window.location.origin);

    if (query && typeof query === "object") {
      Object.keys(query).forEach(function (key) {
        const value = query[key];
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      });
    }

    return url.pathname + url.search;
  }

  function valueOf(element) {
    return element ? String(element.value || "").trim() : "";
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function isDomReady(els) {
    return !!(
      els.modal &&
      els.form &&
      els.type &&
      els.year &&
      els.term &&
      els.stage &&
      els.grade &&
      els.section &&
      els.subject &&
      els.period &&
      els.generate &&
      els.preview &&
      els.download &&
      els.status &&
      els.previewSection &&
      els.previewFrame
    );
  }

  function mergeDeep(target, source) {
    const output = Object.assign({}, target);

    Object.keys(source || {}).forEach(function (key) {
      const targetValue = target?.[key];
      const sourceValue = source?.[key];

      if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
        output[key] = mergeDeep(targetValue, sourceValue);
      } else {
        output[key] = sourceValue;
      }
    });

    return output;
  }

  function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function extractFileNameFromDisposition(disposition) {
    if (!disposition) return null;

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (_) {}
    }

    const asciiMatch = disposition.match(/filename="?([^"]+)"?/i);
    if (asciiMatch && asciiMatch[1]) {
      return asciiMatch[1];
    }

    return null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.initTeacherReportsModal = initTeacherReportsModal;

  function bootstrap() {
    const instance = initTeacherReportsModal();

    window.teacherReportsModal = instance;

    window.openTeacherReportsModal = function () {
      if (window.teacherReportsModal && typeof window.teacherReportsModal.open === "function") {
        window.teacherReportsModal.open();
      }
    };

    window.closeTeacherReportsModal = function () {
      if (window.teacherReportsModal && typeof window.teacherReportsModal.close === "function") {
        window.teacherReportsModal.close();
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();