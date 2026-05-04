/* teacher/js/features/gradesModal.js */
(() => {
  "use strict";

  // =========================================================
  // Helpers
  // =========================================================
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const toast = (msg, type = "info") => {
    const fn = window.toast || window.Toast || window.showToast || null;
    if (typeof fn === "function") return fn(msg, type);
    if (type === "error") console.error(msg);
    else console.log(msg);
  };

  const API_BASE = window.__API_BASE__ || "http://127.0.0.1:5000";

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("token") ||
    "";

  const api = async (method, url, body) => {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const token = getToken();

    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(fullUrl, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => ({})) : null;

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  };

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fmtDT = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  };

  const badge = (text, kind = "soft") => {
    const cls =
      kind === "danger"
        ? "ss-badge ss-badge--danger"
        : kind === "success"
        ? "ss-badge ss-badge--success"
        : kind === "warning"
        ? "ss-badge ss-badge--warning"
        : "ss-badge ss-badge--soft";

    return `<span class="${cls}">${escapeHtml(text)}</span>`;
  };

  const normalizeAssessmentMeta = (item) => {
    if (!item) {
      return {
        rawType: null,
        canonicalType: null,
        examKind: null,
        aggregateKind: null,
        sequenceNo: null,
      };
    }

    const rawType = item.type || null;
    let canonicalType = item.canonical_type || item.type || null;
    let examKind = item.exam_kind || null;
    let aggregateKind = item.aggregate_kind || null;
    let sequenceNo = item.sequence_no ?? null;

    // Fallback للأنواع القديمة
    if (!item.canonical_type) {
      if (rawType === "monthly_exam" || rawType === "quiz") {
        canonicalType = "exam";
        examKind = "monthly";
        sequenceNo = sequenceNo ?? 1;
      } else if (rawType === "midterm_exam") {
        canonicalType = "exam";
        examKind = "midterm";
      } else if (rawType === "final_exam") {
        canonicalType = "exam";
        examKind = "final";
      } else if (rawType === "midterm_muhassala") {
        canonicalType = "aggregate";
        aggregateKind = "midterm";
      } else if (rawType === "final_muhassala") {
        canonicalType = "aggregate";
        aggregateKind = "final";
      }
    }

    return {
      rawType,
      canonicalType,
      examKind,
      aggregateKind,
      sequenceNo,
    };
  };

  const isAssessmentExam = (item, kind = null) => {
    const meta = normalizeAssessmentMeta(item);
    if (meta.canonicalType !== "exam") return false;
    if (!kind) return true;
    return meta.examKind === kind;
  };

  const isAssessmentAggregate = (item, kind = null) => {
    const meta = normalizeAssessmentMeta(item);
    if (meta.canonicalType !== "aggregate") return false;
    if (!kind) return true;
    return meta.aggregateKind === kind;
  };

  const typeLabel = (itemOrType) => {
    if (typeof itemOrType === "string") {
      const map = {
        classwork: "نشاط صفي",
        homework: "واجب منزلي",
        quiz: "اختبار قصير",
        monthly_exam: "اختبار شهري",
        midterm_exam: "اختبار نصفي",
        final_exam: "اختبار نهائي",
        continuous_assessment: "المحصلة",
        midterm_muhassala: "محصلة النصفي",
        final_muhassala: "محصلة النهائي",
        activity: "نشاط",
        project: "مشروع",
        oral: "شفهي",
        exam: "اختبار",
        aggregate: "محصلة",
        live_online: "أونلاين مباشر",
      };
      return map[itemOrType] || itemOrType || "—";
    }

    const meta = normalizeAssessmentMeta(itemOrType);

    if (meta.canonicalType === "exam") {
      if (meta.examKind === "monthly") {
        return meta.sequenceNo ? `اختبار شهري ${meta.sequenceNo}` : "اختبار شهري";
      }
      if (meta.examKind === "midterm") return "اختبار نصفي";
      if (meta.examKind === "final") return "اختبار نهائي";
      return "اختبار";
    }

    if (meta.canonicalType === "aggregate") {
      if (meta.aggregateKind === "midterm") return "محصلة النصفي";
      if (meta.aggregateKind === "final") return "محصلة النهائي";
      return "محصلة";
    }

    return typeLabel(meta.rawType);
  };

  const statusLabel = (status) => {
    const map = {
      draft: "مسودة",
      active: "نشط",
      published: "منشور",
      closed: "مغلق",
      reopened: "مفتوح للتعديل",
      graded: "تم التقييم",
      absent: "غائب",
      missing: "لم يسلّم",
      excused: "معذور",
    };
    return map[status] || status || "—";
  };

  const isGradesFullyPublished = (students) =>
    Array.isArray(students) &&
    students.length > 0 &&
    students.every((s) => !!s.is_published);

  const openModal = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("is-open");
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(() => el.focus?.(), 0);
  };

  const closeModal = (modalEl) => {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    modalEl.style.display = "none";
    modalEl.setAttribute("aria-hidden", "true");

    if (!document.querySelector(".modal.is-open")) {
      document.body.classList.remove("modal-open");
    }
  };

  const exportTableToPrint = (title, tableEl) => {
    if (!tableEl) return toast("لا يوجد جدول للتصدير.", "error");

    const w = window.open("", "_blank");
    if (!w) return toast("المتصفح منع فتح نافذة جديدة.", "error");

    const css = `
      body{font-family:Arial,sans-serif;direction:rtl;padding:18px;}
      h1{font-size:18px;margin:0 0 14px;}
      table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #ddd;padding:8px;font-size:12px;vertical-align:top;text-align:right;}
      th{background:#f3f4f6;}
      small{color:#666;}
      .print-hide{display:none !important;}
      input[type="number"] {border:none; font-family:inherit; font-size:inherit;}
    `;

    const tableClone = tableEl.cloneNode(true);
    qsa("input[type='number']", tableClone).forEach((inp) => {
      const span = document.createElement("span");
      span.textContent = inp.value;
      inp.parentNode.replaceChild(span, inp);
    });

    w.document.write(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(title)}</title>
          <style>${css}</style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          ${tableClone.outerHTML}
        </body>
      </html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const reviewPreviewHTML = (submission) => {
    if (!submission || (!submission.text && !submission.file_url && !submission.preview_url)) {
      return `<div class="empty-state">لا يوجد تسليم حاليًا.</div>`;
    }

    const fileUrl = submission.file_url || submission.preview_url || submission.url || submission.link_url || "";
    const text = submission.text || submission.answer_text || submission.submitted_text || "";
    const lower = String(fileUrl).toLowerCase();
    const fullFileUrl = fileUrl ? (fileUrl.startsWith("http") ? fileUrl : `${API_BASE}${fileUrl}`) : "";

    let html = `<div style="display:flex; flex-direction:column; gap:1.5rem; height:100%; padding: 1rem;">`;

    if (text) {
      html += `
        <div style="background: var(--bg-surface, #1e293b); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color, #334155);">
          <strong style="color: var(--color-primary); display: block; margin-bottom: 8px;">الإجابة النصية:</strong>
          <pre style="white-space: pre-wrap; font-family: inherit; margin: 0; line-height: 1.6; font-size:14px;">${escapeHtml(text)}</pre>
        </div>
      `;
    }

    if (fullFileUrl) {
      html += `<div style="flex-grow:1; display:flex; justify-content:center; align-items:center; min-height:200px;">`;

      if (
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".gif")
      ) {
        html += `<img src="${escapeHtml(fullFileUrl)}" alt="submission" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; border:1px solid var(--border-color, #334155);" />`;
      } else if (lower.endsWith(".pdf")) {
        html += `<iframe src="${escapeHtml(fullFileUrl)}" title="PDF Preview" style="width:100%; height:100%; border:1px solid var(--border-color, #334155); border-radius:8px;"></iframe>`;
      } else {
        html += `
          <div style="text-align:center;">
            <p style="margin:0 0 .8rem;color:var(--color-muted);">تم إرفاق ملف (${escapeHtml(fileUrl.split('/').pop())})</p>
            <a href="${escapeHtml(fullFileUrl)}" target="_blank" rel="noopener" class="primary-btn" style="text-decoration:none;">
              <i class="ri-download-2-line"></i> <span>تحميل المرفق</span>
            </a>
          </div>
        `;
      }

      html += `</div>`;
    }

    html += `</div>`;
    return html;
  };

  // =========================================================
  // State
  // =========================================================
  const state = {
    scopesByTerm: new Map(),
    entryAssessment: null,
    entryStudents: [],
    entryAssessmentList: [],
    reviewRows: [],
    reviewIndex: -1,
    termWorkControlStatus: null,
    midMuhassalaId: null,
    finMuhassalaId: null,
    midMuhassalaMax: 20,
    finMuhassalaMax: 20,
    midtermExamMax: 30,
    finalExamMax: 30,
  };

  // =========================================================
  // DOM refs
  // =========================================================
  const modal = () => qs("#modal-grades");
  const reviewModal = () => qs("#modal-grade-review");

  const tabEntry = () => qs("#grd-tab-entry");
  const tabSheet = () => qs("#grd-tab-sheet");
  const tabLog = () => qs("#grd-tab-log");

  const viewEntry = () => qs("#grd-view-entry");
  const viewSheet = () => qs("#grd-view-sheet");
  const viewLog = () => qs("#grd-view-log");

  const entryTerm = () => qs("#grd-entry-term");
  const entryScope = () => qs("#grd-entry-scope");
  const entryAssessmentSelect = () => qs("#grd-assessment-id");
  const loadStudentsBtn = () => qs("#grd-load-students");
  const fillSequenceBtn = () => qs("#grd-fill-sequence");
  const entryBody = () => qs("#grd-entry-body");
  const entryEmpty = () => qs("#grd-entry-empty");
  const saveDraftBtn = () => qs("#grd-save-draft");
  const publishGradesBtn = () => qs("#grd-publish-grades");
  const closeAssessmentBtn = () => qs("#grd-close-assessment");
  const openAssessmentIdInput = () => qs("#grd-open-assessment-id");

  const infoTitle = () => qs("#grd-info-title");
  const infoMax = () => qs("#grd-info-max");
  const infoSubmissions = () => qs("#grd-info-submissions");
  const infoStatus = () => qs("#grd-info-status");

  const lockBox = () => qs("#grd-lock-state-box");
  const lockText = () => qs("#grd-lock-state-text");

  const sheetTerm = () => qs("#grd-sheet-term");
  const sheetScope = () => qs("#grd-sheet-scope");
  const sheetStudentSearch = () => qs("#grd-sheet-student-search");
  const sheetVisibility = () => qs("#grd-sheet-visibility");
  const loadSheetBtn = () => qs("#grd-load-sheet");
  const exportSheetBtn = () => qs("#grd-export-sheet");
  const sheetHead = () => qs("#grd-sheet-head");
  const sheetBody = () => qs("#grd-sheet-body");
  const sheetEmpty = () => qs("#grd-sheet-empty");
  const sheetStudentsCount = () => qs("#grd-sheet-students-count");
  const sheetAssessmentsCount = () => qs("#grd-sheet-assessments-count");
  const sheetMuhassalaInfo = () => qs("#grd-sheet-muhassala-info");
  const sheetStatusInfo = () => qs("#grd-sheet-status-info");

  const reopenTerm = () => qs("#grd-reopen-term");
  const reopenScope = () => qs("#grd-reopen-scope");
  const reopenAssessment = () => qs("#grd-reopen-assessment-id");
  const reopenReason = () => qs("#grd-reopen-reason");
  const sendReopenBtn = () => qs("#grd-send-reopen-request");
  const reopenLogBody = () => qs("#grd-reopen-log-body");
  const reopenEmpty = () => qs("#grd-reopen-empty");

  const reviewTitleMeta = () => qs("#gvr-student-meta");
  const reviewLateBadge = () => qs("#gvr-late-badge");
  const reviewPreviewFrame = () => qs("#gvr-preview-frame");
  const reviewSubmissionMeta = () => qs("#gvr-submission-meta");
  const reviewStatus = () => qs("#gvr-status");
  const reviewScore = () => qs("#gvr-score");
  const reviewFeedback = () => qs("#gvr-feedback");
  const reviewSaveBtn = () => qs("#gvr-save-grade");
  const reviewPrevBtn = () => qs("#gvr-prev-student");
  const reviewNextBtn = () => qs("#gvr-next-student");

  // =========================================================
  // Tabs
  // =========================================================
  const setTab = (tab) => {
    const isEntry = tab === "entry";
    const isSheet = tab === "sheet";
    const isLog = tab === "log";

    tabEntry()?.classList.toggle("is-active", isEntry);
    tabSheet()?.classList.toggle("is-active", isSheet);
    tabLog()?.classList.toggle("is-active", isLog);

    if (viewEntry()) viewEntry().hidden = !isEntry;
    if (viewSheet()) viewSheet().hidden = !isSheet;
    if (viewLog()) viewLog().hidden = !isLog;
  };

  // =========================================================
  // Scopes
  // =========================================================
  const scopeText = (scope) => {
    const parts = [];
    if (scope.stage_name) parts.push(scope.stage_name);
    if (scope.grade_name) parts.push(scope.grade_name);
    if (scope.section_name) parts.push(`شعبة: ${scope.section_name}`);
    if (scope.subject_name) parts.push(`مادة: ${scope.subject_name}`);
    return parts.join(" • ");
  };

  const fillScopeSelect = (selectEl, items, placeholder = "— اختر —") => {
    if (!selectEl) return;

    selectEl.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);

    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = String(item.teacher_assignment_id);
      opt.textContent = scopeText(item);
      opt.dataset.scope = JSON.stringify(item);
      selectEl.appendChild(opt);
    }
  };

  const getSelectedScopeId = (selectEl) => {
    if (!selectEl?.value) return null;
    const n = Number(selectEl.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const loadScopesForTerm = async (term) => {
    if (!term) return [];
    if (state.scopesByTerm.has(term)) return state.scopesByTerm.get(term);

    const data = await api("GET", `/api/teacher/scopes?term=${encodeURIComponent(term)}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    state.scopesByTerm.set(term, items);
    return items;
  };

  const onTermChange = async (termEl, scopeEl) => {
    if (!termEl || !scopeEl) return;

    const term = Number(termEl.value || 0) || null;
    scopeEl.disabled = true;
    fillScopeSelect(scopeEl, [], "— اختر الفصل أولًا —");

    if (!term) return;

    try {
      const items = await loadScopesForTerm(term);
      fillScopeSelect(scopeEl, items, "— اختر من نطاقاتك —");
      scopeEl.disabled = false;
    } catch (err) {
      toast(err.message || "فشل تحميل نطاقات التدريس", "error");
    }
  };

  // =========================================================
  // Assessments loading
  // =========================================================
  const loadAssessmentsForScope = async (teacher_assignment_id, status = "all") => {
    const params = new URLSearchParams();
    params.set("teacher_assignment_id", String(teacher_assignment_id));
    params.set("status", status);
    const data = await api("GET", `/api/teacher/assessments?${params.toString()}`);
    return Array.isArray(data?.items) ? data.items : [];
  };

  const fillAssessmentSelect = (items, selectedId = null) => {
    const sel = entryAssessmentSelect();
    if (!sel) return;

    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— اختر تقييمًا —";
    sel.appendChild(opt0);

    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.textContent = `${item.title} (${typeLabel(item)} • من ${item.max_score})`;
      opt.dataset.item = JSON.stringify(item);
      sel.appendChild(opt);
    }

    if (selectedId) sel.value = String(selectedId);
  };

  const fillReopenAssessmentSelect = (items) => {
    const sel = reopenAssessment();
    if (!sel) return;

    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— اختر تقييمًا منشورًا أو مغلقًا —";
    sel.appendChild(opt0);

    for (const item of items.filter((x) => x.status === "published" || x.status === "closed")) {
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.textContent = `${item.title} (${statusLabel(item.status)})`;
      sel.appendChild(opt);
    }
  };

  // =========================================================
  // Entry
  // =========================================================
  const setEntryMeta = (assessment, students) => {
    infoTitle() && (infoTitle().textContent = assessment?.title || "—");
    infoMax() && (infoMax().textContent = assessment?.max_score != null ? String(assessment.max_score) : "—");
    infoStatus() && (infoStatus().textContent = statusLabel(assessment?.status || ""));
    infoSubmissions() &&
      (infoSubmissions().textContent = `${students.filter((s) => hasSubmission(s)).length}/${students.length}`);

    const gradesPublished = isGradesFullyPublished(students);
    const isClosed = assessment?.status === "closed";
    const locked = gradesPublished || isClosed;

    if (lockBox()) lockBox().style.display = locked ? "" : "none";

    if (lockText()) {
      if (isClosed) {
        lockText().textContent =
          "هذا التقييم مغلق نهائيًا. يمكنك فقط إرسال طلب إعادة فتح من تبويب إعادة فتح النشاط.";
      } else if (gradesPublished) {
        lockText().textContent =
          "تم نشر الدرجات. لا يمكن تعديلها الآن إلا بعد إعادة الفتح من الإدارة، ويمكنك إغلاق التقييم نهائيًا عند الحاجة.";
      } else {
        lockText().textContent = "";
      }
    }

    saveDraftBtn() && (saveDraftBtn().disabled = !!locked);
    publishGradesBtn() && (publishGradesBtn().disabled = !!locked);
closeAssessmentBtn() &&
  (closeAssessmentBtn().disabled = !(assessment?.status === "published" && gradesPublished));  };

  const hasSubmission = (studentRow) => {
    return !!(
      studentRow?.submission ||
      studentRow?.submission_id ||
      studentRow?.file_url ||
      studentRow?.preview_url ||
      studentRow?.answer_text ||
      studentRow?.submitted_text
    );
  };

  const buildSubmissionObject = (row) => {
    if (row?.submission && typeof row.submission === "object") return row.submission;

    return {
      id: row.submission_id || null,
      file_url: row.file_url || row.preview_url || row.attachment_url || row.link_url || "",
      text: row.answer_text || row.submitted_text || row.text || "",
      submitted_at: row.submitted_at || row.created_at || null,
      is_late: !!(row.is_late || row.late || row.late_submission),
      kind: row.submission_kind || row.kind || null,
    };
  };

  const renderEntryTable = (assessment, students) => {
    const tbody = entryBody();
    const empty = entryEmpty();
    if (!tbody || !empty) return;

    tbody.innerHTML = "";
    state.entryAssessment = assessment;
    state.entryStudents = students;
    state.reviewRows = [];

    setEntryMeta(assessment, students);

    if (!assessment || !students.length) {
      empty.style.display = "";
      return;
    }

    empty.style.display = "none";

    const gradesPublished = isGradesFullyPublished(students);
    const locked = !!assessment && (assessment.status === "closed" || gradesPublished);

    students.forEach((student, index) => {
      const tr = document.createElement("tr");
      const submission = buildSubmissionObject(student);
      const published = !!student.is_published;

      const statusSelect = document.createElement("select");
      statusSelect.className = "grd-status";
      ["graded", "missing", "excused", "absent"].forEach((value) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = statusLabel(value);
        statusSelect.appendChild(opt);
      });

      statusSelect.value =
        student.status && ["graded", "missing", "excused", "absent"].includes(student.status)
          ? student.status
          : student.score != null
          ? "graded"
          : "missing";

      const absentCheck = document.createElement("input");
      absentCheck.type = "checkbox";
      absentCheck.checked = statusSelect.value === "absent";

      const scoreInput = document.createElement("input");
      scoreInput.type = "number";
      scoreInput.min = "0";
      scoreInput.step = "0.01";
      scoreInput.max = String(assessment.max_score || 100);
      scoreInput.value = student.score == null ? "" : String(student.score);

      scoreInput.addEventListener("input", () => {
        const max = Number(assessment.max_score || 100);
        const currentVal = Number(scoreInput.value);

        if (scoreInput.value !== "" && (currentVal > max || currentVal < 0)) {
          scoreInput.style.borderColor = "#ef4444";
          scoreInput.style.color = "#ef4444";
          scoreInput.style.fontWeight = "bold";
        } else {
          scoreInput.style.borderColor = "";
          scoreInput.style.color = "";
          scoreInput.style.fontWeight = "normal";
          scoreInput.style.backgroundColor = "";
        }
      });

      const feedbackInput = document.createElement("input");
      feedbackInput.type = "text";
      feedbackInput.value = student.feedback || "";
      feedbackInput.placeholder = "ملاحظة...";

      const reviewBtn = document.createElement("button");
      reviewBtn.type = "button";
      reviewBtn.className = "primary-btn";
      reviewBtn.innerHTML = `<i class="ri-file-search-line"></i><span>مراجعة</span>`;

      const applyRowRules = () => {
        if (absentCheck.checked) {
          statusSelect.value = "absent";
        }

        const isAbsent = absentCheck.checked || statusSelect.value === "absent";
        const rowLocked = locked || published;

        scoreInput.disabled = rowLocked || isAbsent;
        feedbackInput.disabled = rowLocked;
        statusSelect.disabled = rowLocked;
        absentCheck.disabled = rowLocked;

        if (isAbsent) scoreInput.value = "";
      };

      absentCheck.addEventListener("change", applyRowRules);
      statusSelect.addEventListener("change", () => {
        absentCheck.checked = statusSelect.value === "absent";
        applyRowRules();
      });

      reviewBtn.addEventListener("click", () => openReviewByIndex(index));

      applyRowRules();

      const submissionHtml = hasSubmission(student)
        ? `
            <div style="display:flex;flex-direction:column;gap:.3rem;">
              ${badge(submission.is_late ? "تسليم متأخر" : "تم التسليم", submission.is_late ? "danger" : "success")}
              <small class="muted">${escapeHtml(fmtDT(submission.submitted_at))}</small>
            </div>
          `
        : `<span class="muted">لا يوجد تسليم</span>`;

      tr.innerHTML = `
        <td>
          <div style="display:flex;flex-direction:column;gap:.15rem;">
            <strong>${escapeHtml(student.full_name || "")}</strong>
            <small class="muted">${escapeHtml(student.student_code || "")}</small>
          </div>
        </td>
        <td>${submissionHtml}</td>
        <td></td>
        <td></td>
        <td style="text-align:center;"></td>
        <td></td>
        <td></td>
      `;

      tr.children[2].appendChild(reviewBtn);
      tr.children[3].appendChild(statusSelect);
      tr.children[4].appendChild(absentCheck);
      tr.children[5].appendChild(scoreInput);
      tr.children[6].appendChild(feedbackInput);

      tr.dataset.studentId = String(student.student_id);
      tr.dataset.studentName = student.full_name || "";
      tr.dataset.studentCode = student.student_code || "";
      tr.dataset.submission = JSON.stringify(submission || {});
      tr.dataset.isPublished = published ? "1" : "0";

      tbody.appendChild(tr);

      state.reviewRows.push({
        tr,
        student,
        statusSelect,
        absentCheck,
        scoreInput,
        feedbackInput,
        reviewBtn,
      });
    });
  };

  const loadEntry = async (assessmentId) => {
    if (!assessmentId) throw new Error("اختر تقييمًا أولًا.");

    const data = await api("GET", `/api/teacher/grades/entry?assessment_id=${encodeURIComponent(assessmentId)}`);
    renderEntryTable(data?.assessment || null, Array.isArray(data?.students) ? data.students : []);
  };

  const collectEntryItems = () => {
    if (!state.entryAssessment) throw new Error("لا يوجد تقييم محمّل.");

    const rows = qsa("tr", entryBody());
    const items = [];
    const maxScore = Number(state.entryAssessment.max_score || 100);

    qsa('input[type="number"]', entryBody()).forEach((inp) => {
      inp.style.borderColor = "";
      inp.style.backgroundColor = "";
    });

    for (const tr of rows) {
      const student_id = Number(tr.dataset.studentId || 0);
      const studentName = tr.dataset.studentName || "طالب";
      const status = qs("select.grd-status", tr)?.value || "missing";
      const scoreInput = qs('input[type="number"]', tr);
      const scoreRaw = scoreInput?.value ?? "";
      const feedback = qs('input[type="text"]', tr)?.value ?? "";

      let score = null;

      if (status === "graded") {
        if (scoreRaw === "") {
          if (scoreInput) {
            scoreInput.style.borderColor = "#ef4444";
            scoreInput.style.backgroundColor = "#fef2f2";
            scoreInput.focus();
          }
          throw new Error(`نسيت إدخال الدرجة للطالب: ${studentName}`);
        }

        score = Number(scoreRaw);

        if (!Number.isFinite(score)) {
          if (scoreInput) {
            scoreInput.style.borderColor = "#ef4444";
            scoreInput.focus();
          }
          throw new Error(`الدرجة غير صحيحة للطالب: ${studentName}`);
        }

        if (score < 0 || score > maxScore) {
          if (scoreInput) {
            scoreInput.style.borderColor = "#ef4444";
            scoreInput.style.backgroundColor = "#fef2f2";
            scoreInput.focus();
          }
          throw new Error(`عفوًا، الدرجة للطالب (${studentName}) أكبر من الدرجة النهائية (${maxScore})!`);
        }
      }

      items.push({
        student_id,
        status,
        score,
        feedback,
      });
    }

    return items;
  };

  const saveEntryDraft = async () => {
    const assessment_id = Number(entryAssessmentSelect()?.value || 0);
    if (!assessment_id) throw new Error("اختر تقييمًا.");

    const items = collectEntryItems();
    await api("POST", "/api/teacher/grades/entry/save", { assessment_id, items });
  };

  const publishEntryGrades = async () => {
    const assessment_id = Number(entryAssessmentSelect()?.value || 0);
    if (!assessment_id) throw new Error("اختر تقييمًا.");

    await api("POST", "/api/teacher/grades/entry/publish", { assessment_id });
  };

const closeEntryAssessment = async () => {
  const assessment_id = Number(entryAssessmentSelect()?.value || 0);
  if (!assessment_id) throw new Error("اختر تقييمًا.");

  if (!isGradesFullyPublished(state.entryStudents)) {
    throw new Error("لا يمكن إغلاق التقييم قبل نشر الدرجات.");
  }

  await api("POST", `/api/teacher/assessments/${assessment_id}/close`);
};

  // =========================================================
  // Review modal
  // =========================================================
  const openReviewByIndex = (index) => {
    const row = state.reviewRows[index];
    if (!row) return;

    state.reviewIndex = index;

    const submission = buildSubmissionObject(row.student);
    const studentName = row.student.full_name || "";
    const studentCode = row.student.student_code || "";

    reviewTitleMeta() &&
      (reviewTitleMeta().textContent = `${studentName}${studentCode ? ` • ${studentCode}` : ""}`);

    if (reviewLateBadge()) {
      reviewLateBadge().style.display = submission.is_late ? "" : "none";
    }

    if (reviewPreviewFrame()) {
      reviewPreviewFrame().innerHTML = reviewPreviewHTML(submission);
    }

    if (reviewSubmissionMeta()) {
      const parts = [];
      if (submission.kind) parts.push(`نوع التسليم: ${submission.kind}`);
      if (submission.submitted_at) parts.push(`وقت التسليم: ${fmtDT(submission.submitted_at)}`);
      if (submission.is_late) parts.push("تم بعد الموعد المحدد");
      reviewSubmissionMeta().textContent = parts.length ? parts.join(" • ") : "لا توجد بيانات إضافية.";
    }

    if (reviewStatus()) reviewStatus().value = row.statusSelect.value || "missing";
    if (reviewScore()) reviewScore().value = row.scoreInput.value || "";
    if (reviewFeedback()) reviewFeedback().value = row.feedbackInput.value || "";

    openModal("modal-grade-review");
  };

  const saveReviewToRow = () => {
    const row = state.reviewRows[state.reviewIndex];
    if (!row) return;

    const status = String(reviewStatus()?.value || "missing");
    const score = reviewScore()?.value ?? "";
    const feedback = reviewFeedback()?.value ?? "";

    row.statusSelect.value = status;
    row.absentCheck.checked = status === "absent";
    row.scoreInput.value = status === "absent" ? "" : score;
    row.feedbackInput.value = feedback;
    row.statusSelect.dispatchEvent(new Event("change"));

    toast("تم تحديث بيانات الطالب داخل النموذج. لا تنس حفظ المسودة أو نشر الدرجات.", "success");
    closeModal(reviewModal());
  };

  // =========================================================
  // Sheet (Master Score Sheet)
  // =========================================================

function controlStatusLabel(status) {
  if (status === "approved") return "معتمدة من الكنترول";
  if (status === "returned") return "مرجعة من الكنترول";
  return "غير معتمدة";
}

function renderControlStatusBanner(statusData) {
  const status = statusData?.status || "pending";

  if (status === "pending") {
    return "";
  }

  if (status === "approved") {
    return `
      <div class="grd-control-banner grd-control-approved">
        <div class="grd-control-title">تم اعتماد أعمال هذا الفصل من الكنترول</div>
        <div class="grd-control-text">
          لا تحتاج هذه المادة لأي تعديل جديد إلا إذا فتحت الإدارة التعديل لاحقًا.
        </div>
      </div>
    `;
  }

  if (status === "returned") {
    return `
      <div class="grd-control-banner grd-control-returned">
        <div class="grd-control-title">هذه المادة مرجعة من الكنترول</div>
        <div class="grd-control-text">
          السبب: ${escapeHtml(statusData?.return_note || "لم يتم كتابة سبب الإرجاع.")}
        </div>
      </div>
    `;
  }

  return "";
}
function showControlStatusBanner() {
  const html = renderControlStatusBanner(state.termWorkControlStatus);

  let box = qs("#grd-control-status-box");

  if (!box) {
    box = document.createElement("div");
    box.id = "grd-control-status-box";

    const target =
      sheetMuhassalaInfo()?.closest(".info-card, .card, div") ||
      sheetHead()?.closest("table") ||
      sheetEmpty()?.parentElement;

    if (target?.parentElement) {
      target.parentElement.insertBefore(box, target);
    }
  }

  if (!box) return;

  box.innerHTML = html;
  box.style.display = html ? "" : "none";
}
async function loadTermWorkControlStatus(teacherAssignmentId, term) {
  if (!teacherAssignmentId || !term) {
    return {
      status: "pending",
      return_note: null,
    };
  }

  try {
    const data = await api(
      "GET",
      `/api/teacher/grades/term-work-status?teacher_assignment_id=${encodeURIComponent(
        teacherAssignmentId
      )}&term=${encodeURIComponent(term)}`
    );

    console.log("Term work control status:", data);

    return data || {
      status: "pending",
      return_note: null,
    };
  } catch (err) {
    console.error("Failed to load term work control status:", err);
    return {
      status: "pending",
      return_note: null,
    };
  }
}

  const buildSheet = async () => {
const term = Number(sheetTerm()?.value || 0) || null;
const teacher_assignment_id = getSelectedScopeId(sheetScope());

if (!term) throw new Error("اختر الفصل الدراسي.");
if (!teacher_assignment_id) throw new Error("اختر نطاق التدريس.");

state.termWorkControlStatus = await loadTermWorkControlStatus(
  teacher_assignment_id,
  term
);

const onlyPublished = String(sheetVisibility()?.value || "published_only") === "published_only";
const studentQ = String(sheetStudentSearch()?.value || "").trim().toLowerCase();
    if (sheetHead()) sheetHead().innerHTML = "";
    if (sheetBody()) sheetBody().innerHTML = "";
    if (sheetEmpty()) sheetEmpty().style.display = "none";
showControlStatusBanner();
    const btnMidMuhassala = qs("#grd-submit-midterm-muhassala");
    const btnFinMuhassala = qs("#grd-submit-final-muhassala");
    if (btnMidMuhassala) btnMidMuhassala.style.display = "none";
    if (btnFinMuhassala) btnFinMuhassala.style.display = "none";

    const allAssessments = await loadAssessmentsForScope(teacher_assignment_id, "all");
    const assessments = onlyPublished
      ? allAssessments.filter((a) => a.status === "published" || a.status === "closed")
      : allAssessments;

    const midMuhassalaAssm = assessments.find((a) => isAssessmentAggregate(a, "midterm"));
    const finMuhassalaAssm = assessments.find((a) => isAssessmentAggregate(a, "final"));
    const midtermExamAssm = assessments.find((a) => isAssessmentExam(a, "midterm"));
    const finalExamAssm = assessments.find((a) => isAssessmentExam(a, "final"));

    state.midMuhassalaId = midMuhassalaAssm ? midMuhassalaAssm.id : null;
    state.finMuhassalaId = finMuhassalaAssm ? finMuhassalaAssm.id : null;

    state.midMuhassalaMax = Number(midMuhassalaAssm?.max_score ?? 20);
    state.finMuhassalaMax = Number(finMuhassalaAssm?.max_score ?? 20);
    state.midtermExamMax = Number(midtermExamAssm?.max_score ?? 30);
    state.finalExamMax = Number(finalExamAssm?.max_score ?? 30);

    const isMidMuhassalaLocked =
      !!midMuhassalaAssm && (midMuhassalaAssm.status === "published" || midMuhassalaAssm.status === "closed");

    const isFinMuhassalaLocked =
      !!finMuhassalaAssm && (finMuhassalaAssm.status === "published" || finMuhassalaAssm.status === "closed");

    if (!assessments.length && !allAssessments.length) {
      sheetEmpty() && (sheetEmpty().style.display = "");
      return;
    }

    const detailAssessments = assessments.filter((a) => {
      if (isAssessmentAggregate(a)) return false;
      if (isAssessmentExam(a, "midterm")) return false;
      if (isAssessmentExam(a, "final")) return false;
      return true;
    });

    const studentMap = new Map();

    for (const assessment of assessments) {
      const entry = await api(
        "GET",
        `/api/teacher/grades/entry?assessment_id=${encodeURIComponent(assessment.id)}`
      );
      const students = Array.isArray(entry?.students) ? entry.students : [];

      for (const student of students) {
        const id = Number(student.student_id);
        if (!studentMap.has(id)) {
          studentMap.set(id, {
            student_id: id,
            full_name: student.full_name || "",
            student_code: student.student_code || "",
            grades: new Map(),
          });
        }

        studentMap.get(id).grades.set(Number(assessment.id), {
          status: student.status || (student.score != null ? "graded" : "missing"),
          score: student.score,
          is_published: !!student.is_published,
          assessment,
        });
      }
    }

    if ((!midMuhassalaAssm || !finMuhassalaAssm) && assessments.length > 0) {
      const firstEntry = await api(
        "GET",
        `/api/teacher/grades/entry?assessment_id=${encodeURIComponent(assessments[0].id)}`
      );
      const firstStudents = Array.isArray(firstEntry?.students) ? firstEntry.students : [];
      for (const student of firstStudents) {
        const id = Number(student.student_id);
        if (!studentMap.has(id)) {
          studentMap.set(id, {
            student_id: id,
            full_name: student.full_name || "",
            student_code: student.student_code || "",
            grades: new Map(),
          });
        }
      }
    }

    const students = Array.from(studentMap.values()).filter((s) => {
      if (!studentQ) return true;
      return (
        String(s.full_name).toLowerCase().includes(studentQ) ||
        String(s.student_code).toLowerCase().includes(studentQ)
      );
    });

    if (!students.length) {
      sheetEmpty() && (sheetEmpty().style.display = "");
      return;
    }

    sheetStudentsCount() && (sheetStudentsCount().textContent = String(students.length));
    sheetAssessmentsCount() && (sheetAssessmentsCount().textContent = String(detailAssessments.length));

    if (sheetMuhassalaInfo()) {
      const parts = [];
      parts.push(`محصلة النصفي: ${state.midMuhassalaMax}`);
      parts.push(`محصلة النهائي: ${state.finMuhassalaMax}`);
      sheetMuhassalaInfo().textContent = parts.join(" • ");
    }

    if (sheetStatusInfo()) {
      const parts = [];
      if (midMuhassalaAssm) parts.push(`محصلة النصفي: ${statusLabel(midMuhassalaAssm.status)}`);
      if (finMuhassalaAssm) parts.push(`محصلة النهائي: ${statusLabel(finMuhassalaAssm.status)}`);
      sheetStatusInfo().textContent = parts.length ? parts.join(" • ") : "لا توجد محصلات معتمدة بعد.";
    }

    const headRow = document.createElement("tr");
    let headHTML = `<th>الطالب</th>`;

    for (const assessment of detailAssessments) {
      headHTML += `<th>${escapeHtml(assessment.title)}<br><small class="muted">${escapeHtml(
        typeLabel(assessment)
      )}</small></th>`;
    }

    headHTML += `
      <th style="background-color:rgba(245, 158, 11, 0.1);">محصلة النصفي / ${escapeHtml(String(state.midMuhassalaMax))}</th>
      <th>النصفي / ${escapeHtml(String(state.midtermExamMax))}</th>
      <th style="background-color:rgba(16, 185, 129, 0.1);">محصلة النهائي / ${escapeHtml(String(state.finMuhassalaMax))}</th>
      <th>النهائي / ${escapeHtml(String(state.finalExamMax))}</th>
      <th>المجموع / ${escapeHtml(
        String(state.midMuhassalaMax + state.midtermExamMax + state.finMuhassalaMax + state.finalExamMax)
      )}</th>
    `;
    headRow.innerHTML = headHTML;
    sheetHead()?.appendChild(headRow);

    const getSingleScore = (gradesMap, predicate) => {
      for (const assessment of assessments) {
        if (!predicate(assessment)) continue;
        const g = gradesMap.get(Number(assessment.id));
        if (!g) continue;
        if (onlyPublished && !g.is_published) continue;
        if (g.score != null && Number.isFinite(Number(g.score))) return Number(g.score);
      }
      return null;
    };

    for (const student of students) {
      const tr = document.createElement("tr");
      let rowHTML = `<td><div style="display:flex;flex-direction:column;gap:.15rem;"><strong>${escapeHtml(
        student.full_name
      )}</strong><small class="muted">${escapeHtml(student.student_code)}</small></div></td>`;

      for (const assessment of detailAssessments) {
        const g = student.grades.get(Number(assessment.id));
        if (!g || (onlyPublished && !g.is_published)) {
          rowHTML += `<td class="muted">—</td>`;
          continue;
        }

        const display =
          g.status === "graded"
            ? String(g.score ?? "—")
            : g.status === "absent"
            ? "غائب"
            : g.status === "excused"
            ? "معذور"
            : "—";

        rowHTML += `<td>${escapeHtml(display)}</td>`;
      }

      const midMuhassala = getSingleScore(student.grades, (a) => isAssessmentAggregate(a, "midterm"));
      const midtermExam = getSingleScore(student.grades, (a) => isAssessmentExam(a, "midterm"));
      const finMuhassala = getSingleScore(student.grades, (a) => isAssessmentAggregate(a, "final"));
      const finalExam = getSingleScore(student.grades, (a) => isAssessmentExam(a, "final"));

      const total = [midMuhassala, midtermExam, finMuhassala, finalExam].reduce(
        (sum, n) => sum + (Number.isFinite(n) ? n : 0),
        0
      );

      const midCell = isMidMuhassalaLocked
        ? `<strong>${midMuhassala != null ? escapeHtml(String(midMuhassala)) : "—"}</strong>`
        : `<input type="number" class="mid-muh-input" data-student-id="${student.student_id}" min="0" max="${escapeHtml(
            String(state.midMuhassalaMax)
          )}" step="0.01" style="width:70px; text-align:center;" value="${
            midMuhassala != null ? escapeHtml(String(midMuhassala)) : ""
          }" placeholder="0" />`;

      const finCell = isFinMuhassalaLocked
        ? `<strong>${finMuhassala != null ? escapeHtml(String(finMuhassala)) : "—"}</strong>`
        : `<input type="number" class="fin-muh-input" data-student-id="${student.student_id}" min="0" max="${escapeHtml(
            String(state.finMuhassalaMax)
          )}" step="0.01" style="width:70px; text-align:center;" value="${
            finMuhassala != null ? escapeHtml(String(finMuhassala)) : ""
          }" placeholder="0" />`;

      rowHTML += `
        <td style="background-color:rgba(245, 158, 11, 0.05);">${midCell}</td>
        <td>${midtermExam != null ? escapeHtml(String(midtermExam)) : "—"}</td>
        <td style="background-color:rgba(16, 185, 129, 0.05);">${finCell}</td>
        <td>${finalExam != null ? escapeHtml(String(finalExam)) : "—"}</td>
        <td><strong style="color:var(--color-primary);">${escapeHtml(String(total || 0))}</strong></td>
      `;

      tr.innerHTML = rowHTML;
      sheetBody()?.appendChild(tr);
    }

    if (!isMidMuhassalaLocked && btnMidMuhassala) btnMidMuhassala.style.display = "inline-flex";
    if (!isFinMuhassalaLocked && btnFinMuhassala) btnFinMuhassala.style.display = "inline-flex";
  };

  const submitMuhassalaRequest = async (type, inputClass, assessmentId, btnEl) => {
    const term = Number(sheetTerm()?.value || 0) || null;
    const teacher_assignment_id = getSelectedScopeId(sheetScope());
    const studentSearch = String(sheetStudentSearch()?.value || "").trim();

if (studentSearch) {
  return toast("امسح بحث الطالب قبل اعتماد المحصلة حتى يتم اعتمادها لكل الطلاب.", "error");
}
    if (!term || !teacher_assignment_id) {
      return toast("اختر الفصل والنطاق أولاً.", "error");
    }

    const maxAllowed = inputClass === "mid-muh-input" ? state.midMuhassalaMax : state.finMuhassalaMax;
    const inputs = qsa(`.${inputClass}`, sheetBody());
    const grades = [];

    for (const inp of inputs) {
      const score = Number(inp.value);
      inp.style.borderColor = "";

      if (inp.value !== "" && (score < 0 || score > maxAllowed)) {
        inp.style.borderColor = "#ef4444";
        inp.focus();
        return toast(`يجب أن تكون الدرجة بين 0 و ${maxAllowed}`, "error");
      }

     if (inp.value === "") {
  inp.style.borderColor = "#ef4444";
  inp.focus();
  return toast("يجب إدخال درجة المحصلة لكل الطلاب قبل الاعتماد.", "error");
}

grades.push({
  student_id: Number(inp.dataset.studentId),
  score,
});
    }

    if (grades.length === 0) return toast("لم تقم بإدخال أي درجة!", "error");

    if (!confirm("تأكيد اعتماد المحصلة؟ بعد الاعتماد ستصبح منشورة ولا يمكن تعديلها إلا بعد إعادة فتحها.")) {
      return;
    }

    btnEl.disabled = true;
    const oldText = btnEl.innerHTML;
    btnEl.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> جاري الاعتماد...';

    try {
      await api("POST", "/api/teacher/grades/muhassala/submit", {
        teacher_assignment_id,
        term,
        type,
        grades,
        assessment_id: assessmentId,
      });
      toast("تم اعتماد المحصلة بنجاح!", "success");
      await buildSheet();
    } catch (err) {
      toast(err.message || "فشل إرسال المحصلة", "error");
      btnEl.innerHTML = oldText;
      btnEl.disabled = false;
    }
  };

  const bindSheetActions = () => {
    loadSheetBtn()?.addEventListener("click", async () => {
      try {
        loadSheetBtn().disabled = true;
        await buildSheet();
      } catch (err) {
        toast(err.message || "فشل تحميل كشف المادة", "error");
      } finally {
        loadSheetBtn() && (loadSheetBtn().disabled = false);
      }
    });

    exportSheetBtn()?.addEventListener("click", () => {
      const table = qs("#grd-sheet-table");
      exportTableToPrint("كشف المادة ودرجات الأعمال", table);
    });

    qs("#grd-submit-midterm-muhassala")?.addEventListener("click", function () {
      submitMuhassalaRequest("midterm", "mid-muh-input", state.midMuhassalaId, this);
    });

    qs("#grd-submit-final-muhassala")?.addEventListener("click", function () {
      submitMuhassalaRequest("final", "fin-muh-input", state.finMuhassalaId, this);
    });
  };

  // =========================================================
  // Reopen requests
  // =========================================================
  const loadReopenAssessmentOptions = async () => {
    const teacher_assignment_id = getSelectedScopeId(reopenScope());
    if (!teacher_assignment_id) {
      fillReopenAssessmentSelect([]);
      return;
    }

    try {
      const items = await loadAssessmentsForScope(teacher_assignment_id, "all");
      fillReopenAssessmentSelect(items);
    } catch (err) {
      toast(err.message || "فشل تحميل التقييمات لطلب إعادة الفتح", "error");
    }
  };

  const loadReopenLog = async () => {
    const teacher_assignment_id = getSelectedScopeId(reopenScope());
    if (!teacher_assignment_id || !reopenLogBody() || !reopenEmpty()) return;

    reopenLogBody().innerHTML = "";
    reopenEmpty().style.display = "none";

    try {
      const data = await api(
        "GET",
        `/api/teacher/grades/reopen-requests?teacher_assignment_id=${encodeURIComponent(teacher_assignment_id)}`
      );

      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        reopenEmpty().style.display = "";
        return;
      }

      for (const item of items) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(item.assessment_title || item.title || "—")}</td>
          <td>${escapeHtml(fmtDT(item.created_at))}</td>
          <td>${escapeHtml(item.reason || "—")}</td>
          <td>${escapeHtml(statusLabel(item.status || ""))}</td>
          <td>${escapeHtml(item.admin_note || item.decision_note || "—")}</td>
        `;
        reopenLogBody().appendChild(tr);
      }
    } catch {
      reopenEmpty().style.display = "";
    }
  };

  const sendReopenRequest = async () => {
    const assessment_id = Number(reopenAssessment()?.value || 0);
    const reason = String(reopenReason()?.value || "").trim();

    if (!assessment_id) throw new Error("اختر تقييمًا.");
    if (!reason) throw new Error("اكتب سبب طلب إعادة الفتح.");

    await api("POST", "/api/teacher/grades/reopen-requests", {
      assessment_id,
      reason,
    });
  };

  // =========================================================
  // Events
  // =========================================================
  const bindModalClose = () => {
    [modal(), reviewModal()].forEach((m) => {
      if (!m) return;

      qsa("[data-close-modal]", m).forEach((btn) => {
        btn.addEventListener("click", () => closeModal(m));
      });

      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m);
      });

      m.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal(m);
      });
    });
  };

  const bindTabs = () => {
    tabEntry()?.addEventListener("click", () => setTab("entry"));
    tabSheet()?.addEventListener("click", () => setTab("sheet"));
    tabLog()?.addEventListener("click", async () => {
      setTab("log");
      await loadReopenLog();
    });

    setTab("entry");
  };

  const bindScopeFilters = () => {
    entryTerm()?.addEventListener("change", () => onTermChange(entryTerm(), entryScope()));
    sheetTerm()?.addEventListener("change", () => onTermChange(sheetTerm(), sheetScope()));
    reopenTerm()?.addEventListener("change", () => onTermChange(reopenTerm(), reopenScope()));

    entryScope()?.addEventListener("change", async () => {
      const teacher_assignment_id = getSelectedScopeId(entryScope());
      if (!teacher_assignment_id) {
        fillAssessmentSelect([], null);
        return;
      }

      try {
        const items = await loadAssessmentsForScope(teacher_assignment_id, "all");
        state.entryAssessmentList = items;
        fillAssessmentSelect(items, Number(openAssessmentIdInput()?.value || 0) || null);
      } catch (err) {
        toast(err.message || "فشل تحميل قائمة التقييمات", "error");
      }
    });

    reopenScope()?.addEventListener("change", async () => {
      await loadReopenAssessmentOptions();
      await loadReopenLog();
    });
  };

  const bindEntryActions = () => {
    loadStudentsBtn()?.addEventListener("click", async () => {
      try {
        const assessmentId = Number(entryAssessmentSelect()?.value || 0);
        if (!assessmentId) return toast("اختر تقييمًا.", "error");
        loadStudentsBtn().disabled = true;
        await loadEntry(assessmentId);
      } catch (err) {
        toast(err.message || "فشل تحميل الطلاب", "error");
      } finally {
        loadStudentsBtn() && (loadStudentsBtn().disabled = false);
      }
    });

    fillSequenceBtn()?.addEventListener("click", () => {
      const rows = qsa("tr", entryBody());
      if (!rows.length) return toast("حمّل الطلاب أولًا.", "error");

      let next = 1;
      for (const tr of rows) {
        const statusSel = qs("select.grd-status", tr);
        const scoreInput = qs('input[type="number"]', tr);
        const absent = qs('input[type="checkbox"]', tr)?.checked;

        if (!statusSel || !scoreInput || absent || scoreInput.disabled) continue;

        statusSel.value = "graded";
        scoreInput.value = String(next);
        next += 1;
      }

      toast("تمت التعبئة المتسلسلة داخل الجدول.", "success");
    });

    saveDraftBtn()?.addEventListener("click", async () => {
      try {
        saveDraftBtn().disabled = true;
        await saveEntryDraft();
        toast("تم حفظ المسودة.", "success");
        const id = Number(entryAssessmentSelect()?.value || 0);
        if (id) await loadEntry(id);
      } catch (err) {
        toast(err.message || "فشل حفظ المسودة", "error");
      } finally {
        saveDraftBtn() && (saveDraftBtn().disabled = false);
      }
    });

    publishGradesBtn()?.addEventListener("click", async () => {
      try {
        publishGradesBtn().disabled = true;
        await saveEntryDraft();
        await publishEntryGrades();
        toast("تم حفظ ونشر الدرجات بنجاح.", "success");
        const id = Number(entryAssessmentSelect()?.value || 0);
        if (id) await loadEntry(id);
      } catch (err) {
        toast(err.message || "فشل نشر الدرجات", "error");
      } finally {
        publishGradesBtn() && (publishGradesBtn().disabled = false);
      }
    });

    closeAssessmentBtn()?.addEventListener("click", async () => {
      try {
        closeAssessmentBtn().disabled = true;
        await closeEntryAssessment();
        toast("تم إغلاق التقييم.", "success");
        const id = Number(entryAssessmentSelect()?.value || 0);
        if (id) await loadEntry(id);
      } catch (err) {
        toast(err.message || "فشل إغلاق التقييم", "error");
      } finally {
        closeAssessmentBtn() && (closeAssessmentBtn().disabled = false);
      }
    });
  };

  const bindReopenActions = () => {
    sendReopenBtn()?.addEventListener("click", async () => {
      try {
        sendReopenBtn().disabled = true;
        await sendReopenRequest();
        toast("تم إرسال الطلب للإدارة.", "success");
        reopenReason() && (reopenReason().value = "");
        await loadReopenLog();
      } catch (err) {
        toast(err.message || "فشل إرسال الطلب", "error");
      } finally {
        sendReopenBtn() && (sendReopenBtn().disabled = false);
      }
    });
  };

  const bindReviewActions = () => {
    reviewSaveBtn()?.addEventListener("click", saveReviewToRow);

    reviewPrevBtn()?.addEventListener("click", () => {
      if (state.reviewIndex <= 0) return;
      openReviewByIndex(state.reviewIndex - 1);
    });

    reviewNextBtn()?.addEventListener("click", () => {
      if (state.reviewIndex >= state.reviewRows.length - 1) return;
      openReviewByIndex(state.reviewIndex + 1);
    });
  };

  // =========================================================
  // Open grades for selected assessment
  // =========================================================
  const openForAssessment = async ({ term, teacher_assignment_id, assessment_id }) => {
    openModal("modal-grades");
    setTab("entry");

    if (entryTerm()) {
      entryTerm().value = term ? String(term) : "";
      await onTermChange(entryTerm(), entryScope());
    }

    if (entryScope() && teacher_assignment_id) {
      entryScope().value = String(teacher_assignment_id);
      const items = await loadAssessmentsForScope(Number(teacher_assignment_id), "all");
      state.entryAssessmentList = items;
      fillAssessmentSelect(items, Number(assessment_id || 0) || null);
    }

    if (entryAssessmentSelect() && assessment_id) {
      entryAssessmentSelect().value = String(assessment_id);
      openAssessmentIdInput() && (openAssessmentIdInput().value = String(assessment_id));
      await loadEntry(Number(assessment_id));
    }
  };

  // =========================================================
  // Init
  // =========================================================
  const init = () => {
    if (window.__teacherGradesModalInit) return;
    window.__teacherGradesModalInit = true;

    qsa("form", modal()).forEach((f) => f.addEventListener("submit", (e) => e.preventDefault()));
    qsa("form", reviewModal()).forEach((f) => f.addEventListener("submit", (e) => e.preventDefault()));

    if (!modal()) return;

    bindModalClose();
    bindTabs();
    bindScopeFilters();
    bindEntryActions();
    bindSheetActions();
    bindReopenActions();
    bindReviewActions();

    window.addEventListener("teacher:openGradesForAssessment", async (e) => {
      const detail = e?.detail || {};
      if (!detail.assessment_id) return;
      await openForAssessment(detail);
    });

    window.TeacherGradesModal = {
      open: () => openModal("modal-grades"),
      openForAssessment,
    };
  };

  document.addEventListener("DOMContentLoaded", init);
})();