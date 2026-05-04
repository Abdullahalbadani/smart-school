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

  const api = async (method, url) => {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const token = getToken();

    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(fullUrl, {
      method,
      credentials: "include",
      headers,
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

  const modal = () => qs("#modal-grades");
  const tableBody = () => qs("#stu-gr-table-body");
  const emptyState = () => qs("#stu-gr-empty");

  const filterType = () => qs("#stu-gr-filter-type");
  const filterSubject = () => qs("#stu-gr-filter-subject");
  const filterSearch = () => qs("#stu-gr-filter-search");
  const refreshBtn = () => qs("#stu-gr-refresh");

  const countTotal = () => qs("#stu-gr-count-total");
  const avgEl = () => qs("#stu-gr-average");
  const highestEl = () => qs("#stu-gr-highest");
  const lastPublishedEl = () => qs("#stu-gr-last-published");
  const listBadge = () => qs("#stu-gr-list-badge");

  const detailEmpty = () => qs("#stu-gr-detail-empty");
  const detailContent = () => qs("#stu-gr-detail-content");
  const detailBadge = () => qs("#stu-gr-detail-badge");
  const detailTitle = () => qs("#stu-gr-detail-title");
  const detailSubject = () => qs("#stu-gr-detail-subject");
  const detailTeacher = () => qs("#stu-gr-detail-teacher");
  const detailType = () => qs("#stu-gr-detail-type");
  const detailPublished = () => qs("#stu-gr-detail-published");
  const detailScore = () => qs("#stu-gr-detail-score");
  const detailMax = () => qs("#stu-gr-detail-max");
  const detailPercent = () => qs("#stu-gr-detail-percent");
  const detailWord = () => qs("#stu-gr-detail-grade-word");
  const detailFeedback = () => qs("#stu-gr-detail-feedback");
  const detailStatus = () => qs("#stu-gr-detail-status");

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
      monthly_exam: "شهري",
      midterm_exam: "نصفي",
      final_exam: "نهائي",
      continuous_assessment: "المحصلة",
      midterm_muhassala: "محصلة النصفي",
      final_muhassala: "محصلة النهائي",
    };
    return map[type] || type || "—";
  }

  function gradeWord(percent) {
    const p = Number(percent || 0);
    if (p >= 90) return "ممتاز";
    if (p >= 80) return "جيد جدًا";
    if (p >= 70) return "جيد";
    if (p >= 60) return "مقبول";
    return "ضعيف";
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
    const numeric = items.filter((x) => Number.isFinite(Number(x.percentage)));
    const avg = numeric.length
      ? (numeric.reduce((sum, x) => sum + Number(x.percentage), 0) / numeric.length).toFixed(1)
      : "0.0";

    const highest = numeric.length
      ? Math.max(...numeric.map((x) => Number(x.score || 0)))
      : 0;

    const lastPublished = items.length
      ? items
          .map((x) => x.published_at)
          .filter(Boolean)
          .sort()
          .slice(-1)[0]
      : null;

    countTotal() && (countTotal().textContent = String(total));
    avgEl() && (avgEl().textContent = `${avg}%`);
    highestEl() && (highestEl().textContent = String(highest));
    lastPublishedEl() && (lastPublishedEl().textContent = fmtDT(lastPublished));
    listBadge() && (listBadge().textContent = `${total} نتيجة`);
  }

  function resetDetail() {
    state.current = null;
    detailEmpty() && (detailEmpty().style.display = "");
    detailContent() && (detailContent().style.display = "none");
  }

  function renderDetail(item) {
    state.current = item;

    detailEmpty() && (detailEmpty().style.display = "none");
    detailContent() && (detailContent().style.display = "");

    detailBadge() && (detailBadge().textContent = gradeWord(item.percentage));
    detailTitle() && (detailTitle().textContent = item.assessment_title || "—");
    detailSubject() && (detailSubject().textContent = `المادة: ${item.subject_name || "—"}`);
    detailTeacher() && (detailTeacher().textContent = `المعلم: ${item.teacher_name || "—"}`);
    detailType() && (detailType().textContent = `النوع: ${typeLabel(item.type)}`);
    detailPublished() && (detailPublished().textContent = `تاريخ النشر: ${fmtDT(item.published_at)}`);
    detailScore() && (detailScore().textContent = item.score != null ? String(item.score) : "—");
    detailMax() && (detailMax().textContent = `/ ${item.max_score ?? "—"}`);
    detailPercent() && (detailPercent().textContent = `${item.percentage ?? 0}%`);
    detailWord() && (detailWord().textContent = gradeWord(item.percentage));
    detailFeedback() && (detailFeedback().textContent = item.feedback || "لا توجد ملاحظات.");
    detailStatus() && (detailStatus().textContent = item.status_label || "تم نشر الدرجة.");
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
        <td>${item.subject_name || "—"}</td>
        <td>${item.assessment_title || "—"}</td>
        <td>${typeLabel(item.type)}</td>
        <td>${item.score != null ? `${item.score} / ${item.max_score}` : "—"}</td>
        <td>${gradeWord(item.percentage)}</td>
        <td></td>
      `;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary-btn";
      btn.innerHTML = `<i class="ri-eye-line"></i><span>تفاصيل</span>`;
      btn.addEventListener("click", () => renderDetail(item));

      tr.lastElementChild.appendChild(btn);
      tbody.appendChild(tr);
    }
  }

  async function loadGrades() {
    try {
      refreshBtn() && (refreshBtn().disabled = true);

      const params = new URLSearchParams();
      const type = filterType()?.value || "";
      const subjectId = filterSubject()?.value || "";
      const q = (filterSearch()?.value || "").trim();

      if (type) params.set("type", type);
      if (subjectId) params.set("subject_id", subjectId);
      if (q) params.set("q", q);

      const data = await api("GET", `/api/student/learning/grades?${params.toString()}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      state.items = items;

      buildSubjectFilter(items);
      renderTable(items);
      resetDetail();
    } catch (e) {
      toast(e.message || "فشل تحميل الدرجات", "error");
    } finally {
      refreshBtn() && (refreshBtn().disabled = false);
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
    refreshBtn()?.addEventListener("click", loadGrades);
    filterType()?.addEventListener("change", loadGrades);
    filterSubject()?.addEventListener("change", loadGrades);
    filterSearch()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadGrades();
      }
    });

    qsa('[data-open-modal="modal-grades"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        openModal("modal-grades");
        await loadGrades();
      });
    });

    window.addEventListener("student:openGrades", async () => {
      openModal("modal-grades");
      await loadGrades();
    });
  }

  function init() {
    if (window.__studentGradesInit) return;
    window.__studentGradesInit = true;

    if (!modal()) return;

    bindModal();
    bindActions();

    window.StudentGradesModal = {
      open: async () => {
        openModal("modal-grades");
        await loadGrades();
      },
      reload: loadGrades,
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();