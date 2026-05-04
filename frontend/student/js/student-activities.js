(() => {
  "use strict";

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

    const headers = {};
    if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(fullUrl, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await res.json().catch(() => ({})) : null;

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
      throw new Error(msg);
    }

    return data;
  };

  const modal = () => qs("#modal-activities");
  const tableBody = () => qs("#stu-act-table-body");
  const emptyState = () => qs("#stu-act-empty");

  const filterStatus = () => qs("#stu-act-filter-status");
  const filterSubject = () => qs("#stu-act-filter-subject");
  const filterSearch = () => qs("#stu-act-filter-search");
  const refreshBtn = () => qs("#stu-act-refresh");

  const countTotal = () => qs("#stu-act-count-total");
  const countPending = () => qs("#stu-act-count-pending");
  const countSubmitted = () => qs("#stu-act-count-submitted");
  const countGraded = () => qs("#stu-act-count-graded");
  const listBadge = () => qs("#stu-act-list-badge");

  const detailEmpty = () => qs("#stu-act-detail-empty");
  const detailContent = () => qs("#stu-act-detail-content");
  const detailBadge = () => qs("#stu-act-detail-badge");
  const detailTitle = () => qs("#stu-act-detail-title");
  const detailSubject = () => qs("#stu-act-detail-subject");
  const detailTeacher = () => qs("#stu-act-detail-teacher");
  const detailDeadline = () => qs("#stu-act-detail-deadline");
  const detailStatus = () => qs("#stu-act-detail-status");
  const detailDesc = () => qs("#stu-act-detail-desc");
  const attachmentsBox = () => qs("#stu-act-attachments");
  const submitState = () => qs("#stu-act-submit-state");
  const answerText = () => qs("#stu-act-answer-text");
  const answerFile = () => qs("#stu-act-answer-file");
  const submitBtn = () => qs("#stu-act-submit-btn");
  const currentId = () => qs("#stu-act-current-id");

  const state = {
    items: [],
    current: null,
  };

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("is-open");
    el.style.display = "flex";
    document.body.classList.add("modal-open");
  }

  function closeModal(el) {
    if (!el) return;
    el.classList.remove("is-open");
    el.style.display = "none";
    document.body.classList.remove("modal-open");
  }

  function fmtDT(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ar-EG");
  }

  function typeLabel(type) {
    const map = {
      classwork: "نشاط صفي",
      homework: "واجب منزلي",
      quiz: "اختبار قصير",
      monthly_exam: "اختبار شهري",
      midterm_exam: "اختبار نصفي",
      final_exam: "اختبار نهائي",
      project: "مشروع",
      oral: "شفهي",
    };
    return map[type] || type || "—";
  }

  function statusLabel(status) {
    const map = {
      pending: "بانتظار الحل",
      submitted: "تم الإرسال",
      graded: "تم التصحيح",
      missed: "فات الموعد",
    };
    return map[status] || status || "—";
  }

  function statusBadge(status) {
    if (status === "graded") return `<span class="ss-badge ss-badge--success">تم التصحيح</span>`;
    if (status === "submitted") return `<span class="ss-badge ss-badge--warning">تم الإرسال</span>`;
    if (status === "missed") return `<span class="ss-badge ss-badge--danger">فات الموعد</span>`;
    return `<span class="ss-badge ss-badge--soft">بانتظار الحل</span>`;
  }

  function buildSubjectFilter(items) {
    const sel = filterSubject();
    if (!sel) return;

    const current = sel.value;
    const unique = new Map();

    for (const item of items) {
      if (!item.subject_id) continue;
      unique.set(String(item.subject_id), item.subject_name);
    }

    sel.innerHTML = `<option value="">كل المواد</option>`;
    for (const [id, name] of unique) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      sel.appendChild(opt);
    }

    if ([...unique.keys()].includes(current)) sel.value = current;
  }

  function updateSummary(items) {
    const total = items.length;
    const pending = items.filter((x) => x.student_status === "pending").length;
    const submitted = items.filter((x) => x.student_status === "submitted").length;
    const graded = items.filter((x) => x.student_status === "graded").length;

    countTotal() && (countTotal().textContent = String(total));
    countPending() && (countPending().textContent = String(pending));
    countSubmitted() && (countSubmitted().textContent = String(submitted));
    countGraded() && (countGraded().textContent = String(graded));
    listBadge() && (listBadge().textContent = `${total} عنصر`);
  }

 function resetDetail() {
    state.current = null;
    currentId() && (currentId().value = "");
    detailEmpty() && (detailEmpty().style.display = "");
    detailContent() && (detailContent().style.display = "none");
    answerText() && (answerText().value = "");
    answerFile() && (answerFile().value = "");
    
    // إيقاف العداد الزمني السابق إذا كان يعمل
    if (window.activeStudentTimer) {
        clearInterval(window.activeStudentTimer);
    }
  }

  function renderTable(items) {
    const tbody = tableBody();
    if (!tbody) return;

    tbody.innerHTML = "";
    updateSummary(items);

    if (!items.length) {
      emptyState() && (emptyState().style.display = "");
      return;
    }

    emptyState() && (emptyState().style.display = "none");

    for (const item of items) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="display:flex;flex-direction:column;gap:.15rem;">
            <strong>${item.title}</strong>
            <small class="muted">${typeLabel(item.type)}</small>
          </div>
        </td>
        <td>${item.subject_name || "—"}</td>
        <td>${item.teacher_name || "—"}</td>
        <td>${fmtDT(item.due_at)}</td>
        <td>${statusBadge(item.student_status)}</td>
        <td></td>
      `;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.innerHTML = `<i class="ri-eye-line"></i><span>فتح</span>`;
      btn.addEventListener("click", () => loadDetail(item.id));

      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    }
  }

  async function loadActivities() {
    try {
      refreshBtn() && (refreshBtn().disabled = true);

      const params = new URLSearchParams();
      const status = filterStatus()?.value || "all";
      const subjectId = filterSubject()?.value || "";
      const q = (filterSearch()?.value || "").trim();

      if (status && status !== "all") params.set("status", status);
      if (subjectId) params.set("subject_id", subjectId);
      if (q) params.set("q", q);

      const data = await api("GET", `/api/student/learning/activities?${params.toString()}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      state.items = items;

      buildSubjectFilter(items);
      renderTable(items);
    } catch (e) {
      toast(e.message || "فشل تحميل النشاطات", "error");
    } finally {
      refreshBtn() && (refreshBtn().disabled = false);
    }
  }

  async function loadDetail(id) {
    try {
      const data = await api("GET", `/api/student/learning/activities/${id}`);
      const item = data?.item;
      if (!item) throw new Error("لم يتم العثور على تفاصيل النشاط.");

      state.current = item;
      currentId() && (currentId().value = String(item.id));

      detailEmpty() && (detailEmpty().style.display = "none");
      detailContent() && (detailContent().style.display = "");

      detailBadge() && (detailBadge().textContent = statusLabel(item.student_status));
      detailTitle() && (detailTitle().textContent = item.title || "—");
      detailSubject() && (detailSubject().textContent = `المادة: ${item.subject_name || "—"}`);
      detailTeacher() && (detailTeacher().textContent = `المعلم: ${item.teacher_name || "—"}`);
      detailDeadline() && (detailDeadline().textContent = `آخر موعد: ${fmtDT(item.due_at)}`);
      detailStatus() && (detailStatus().textContent = `الحالة: ${statusLabel(item.student_status)}`);
      detailDesc() && (detailDesc().textContent = item.description || "لا توجد تعليمات إضافية.");
// --- إضافة عرض الدرجة وملاحظات المعلم ---
      const gradesBox = qs("#stu-act-grade-info"); 
      if (gradesBox) {
        // نتحقق أن الحالة "مصحح" والدرجة موجودة
        if (item.student_status === "graded" && item.score !== null) {
          gradesBox.style.display = "block";
          gradesBox.innerHTML = `
            <div class="ss-banner ss-banner--success" style="margin-top: 1rem; border: 1px solid #10b981;">
              <div class="ss-banner-content">
                <strong style="font-size: 1.1rem;">النتيجة: ${item.score} / ${item.max_score}</strong>
                ${item.feedback ? `<p style="margin-top: 0.5rem; border-top: 1px dashed #ccc; padding-top: 0.5rem;">ملاحظة المعلم: ${item.feedback}</p>` : ''}
              </div>
            </div>
          `;
        } else {
          gradesBox.style.display = "none";
        }
      }

      // --- إضافة تشغيل عداد الوقت التحفيزي ---
      const timerDisplay = qs("#stu-act-timer");
      if (timerDisplay) {
        // يعمل العداد إذا وجدت "مدة تنفيذ" والنشاط ليس مغلقاً والطالب لم يسلم بعد
        if (item.duration_minutes && item.status !== 'closed' && !alreadySubmitted) {
          timerDisplay.style.display = "inline-flex";
          startStudentTimer(item.duration_minutes, timerDisplay);
        } else {
          timerDisplay.style.display = "none";
          if (window.activeStudentTimer) clearInterval(window.activeStudentTimer);
        }
      }
      const files = Array.isArray(item.attachments) ? item.attachments : [];
      if (attachmentsBox()) {
        if (!files.length) {
          attachmentsBox().innerHTML = `<div class="muted-box">لا توجد مرفقات.</div>`;
        } else {
          attachmentsBox().innerHTML = files
            .map(
              (f) => `
               <a class="stu-attachment-link" href="${f.file_url.startsWith('http') ? f.file_url : API_BASE + f.file_url}" target="_blank" rel="noopener">
                  <span>${f.file_name || "مرفق"}</span>
                  <i class="ri-download-2-line"></i>
                </a>
              `
            )
            .join("");
        }
      }

      const alreadySubmitted = !!item.submission;
      const canSubmit = !!item.can_submit;

      if (submitState()) {
        if (alreadySubmitted) {
          submitState().innerHTML = `تم إرسال الحل بتاريخ <strong>${fmtDT(item.submission.submitted_at)}</strong> ولا يمكن الإرسال مرة أخرى.`;
        } else if (!canSubmit) {
          submitState().textContent = item.submit_block_reason || "التسليم غير متاح حاليًا لهذا النشاط.";
        } else {
          submitState().textContent = "يمكنك كتابة الإجابة نصيًا أو رفع ملف واحد. يسمح النظام بتسليم واحد فقط.";
        }
      }

      answerText() && (answerText().value = "");
      answerFile() && (answerFile().value = "");
      if (answerText()) answerText().disabled = alreadySubmitted || !canSubmit;
      if (answerFile()) answerFile().disabled = alreadySubmitted || !canSubmit;
      if (submitBtn()) submitBtn().disabled = alreadySubmitted || !canSubmit;
    } catch (e) {
      toast(e.message || "فشل تحميل تفاصيل النشاط", "error");
    }
  }

  async function submitActivity() {
    try {
      const id = Number(currentId()?.value || 0);
      if (!id) return toast("اختر نشاطًا أولًا.", "error");

      const text = (answerText()?.value || "").trim();
      const file = answerFile()?.files?.[0] || null;

      if (!text && !file) {
        return toast("أدخل إجابة نصية أو ارفع ملفًا واحدًا على الأقل.", "error");
      }

      const formData = new FormData();
      formData.append("text", text);
      if (file) formData.append("file", file);

      submitBtn() && (submitBtn().disabled = true);
      await api("POST", `/api/student/learning/activities/${id}/submit`, formData);

      toast("تم إرسال الحل بنجاح.", "success");
      await loadActivities();
      await loadDetail(id);
    } catch (e) {
      toast(e.message || "فشل إرسال الحل", "error");
    } finally {
      if (submitBtn() && state.current) {
        const canSubmit = !state.current?.submission && !!state.current?.can_submit;
        submitBtn().disabled = !canSubmit;
      }
    }
  }

  function bindModal() {
    const m = modal();
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
  }

  function bindActions() {
    refreshBtn()?.addEventListener("click", loadActivities);
    filterStatus()?.addEventListener("change", loadActivities);
    filterSubject()?.addEventListener("change", loadActivities);
    filterSearch()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadActivities();
      }
    });

    submitBtn()?.addEventListener("click", submitActivity);

    qsa('[data-open-modal="modal-activities"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        openModal("modal-activities");
        resetDetail();
        await loadActivities();
      });
    });

    window.addEventListener("student:openActivities", async () => {
      openModal("modal-activities");
      resetDetail();
      await loadActivities();
    });
  }

  function init() {
    if (window.__studentActivitiesInit) return;
    window.__studentActivitiesInit = true;

    if (!modal()) return;

    bindModal();
    bindActions();

    window.StudentActivitiesModal = {
      open: async () => {
        openModal("modal-activities");
        resetDetail();
        await loadActivities();
      },
      reload: loadActivities,
    };
  }

  document.addEventListener("DOMContentLoaded", init);
  // دالة تشغيل العداد التنازلي للطلاب
  function startStudentTimer(minutes, displayEl) {
    let seconds = minutes * 60;
    if (window.activeStudentTimer) clearInterval(window.activeStudentTimer);

    window.activeStudentTimer = setInterval(() => {
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      
      displayEl.innerHTML = `<i class="ri-time-line"></i> <span>الوقت المتبقي: ${h}:${m}:${s}</span>`;
      
      if (seconds <= 0) {
        clearInterval(window.activeStudentTimer);
        displayEl.innerHTML = `<i class="ri-time-fill"></i> <span>انتهى الوقت المحدد!</span>`;
        displayEl.classList.replace("ss-badge--warning", "ss-badge--danger");
      }
      seconds--;
    }, 1000);
  }
})();