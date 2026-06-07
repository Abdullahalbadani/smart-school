(function () {
  "use strict";

const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}

  const state = {
    meta: {
      academic_years: [],
      stages: [],
      grades: [],
      sections: [],
    },
    students: [],
  };

  function root() {
    return document.getElementById("continuingStudentsPage");
  }

  function qs(selector, base = root()) {
    return base ? base.querySelector(selector) : null;
  }

  function qsa(selector, base = root()) {
    return base ? Array.from(base.querySelectorAll(selector)) : [];
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getToken() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }

  async function apiRequest(method, path, body) {
    const token = getToken();

   const res = await fetch(apiUrl(path), {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.message || `فشل الطلب (${res.status})`);
    }

    return data;
  }

  const apiGet = (path) => apiRequest("GET", path);
  const apiPost = (path, body) => apiRequest("POST", path, body);

  function showAlert(message, type = "info") {
    const el = qs("#csAlert");
    if (!el) return;

    if (!message) {
      el.className = "cs-alert";
      el.textContent = "";
      return;
    }

    el.className = `cs-alert show ${type}`;
    el.textContent = message;
  }
async function csConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  console.warn("AppUI.confirm غير متاح");
  return false;
}
  function setLoading(btn, loading, text) {
    if (!btn) return;

    if (loading) {
      btn.dataset.oldText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = text || "جاري التنفيذ...";
      return;
    }

    btn.disabled = false;

    if (btn.dataset.oldText) {
      btn.innerHTML = btn.dataset.oldText;
      delete btn.dataset.oldText;
    }
  }

  function selectedNumber(selector) {
    const value = qs(selector)?.value;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
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

  function fillYears() {
    const years = state.meta.academic_years || [];

    fillSelect(qs("#csFromYear"), years, "اختر السنة", (x) => x.name || `سنة ${x.id}`);
    fillSelect(qs("#csToYear"), years, "اختر السنة الجديدة", (x) => x.name || `سنة ${x.id}`);

    const active = years.find((x) => x.is_active) || years[0];

    if (active && qs("#csFromYear")) {
      qs("#csFromYear").value = String(active.id);
    }

    if (qs("#csToYear")) {
      qs("#csToYear").value = "";
    }
  }

  function fillStages() {
    const stages = state.meta.stages || [];

    fillSelect(qs("#csFromStage"), stages, "اختر المرحلة", (x) => x.name || `مرحلة ${x.id}`);
    fillSelect(qs("#csPromoteStage"), stages, "اختر المرحلة", (x) => x.name || `مرحلة ${x.id}`);
    fillSelect(qs("#csRepeatStage"), stages, "اختر المرحلة", (x) => x.name || `مرحلة ${x.id}`);
  }

  function fillGrades(prefix) {
    const stageId = selectedNumber(`#cs${prefix}Stage`);

    const grades = (state.meta.grades || []).filter((g) => {
      if (!stageId) return true;
      return Number(g.stage_id) === stageId;
    });

    fillSelect(
      qs(`#cs${prefix}Grade`),
      grades,
      "اختر الصف",
      (x) => x.name || x.grade_name || `صف ${x.id}`
    );

    fillSections(prefix);
  }

  function fillSections(prefix) {
    const gradeId = selectedNumber(`#cs${prefix}Grade`);

    const sections = (state.meta.sections || []).filter((s) => {
      if (!gradeId) return true;
      return Number(s.grade_id) === gradeId;
    });

    fillSelect(
      qs(`#cs${prefix}Section`),
      sections,
      "اختر الشعبة",
      (x) => x.name || `شعبة ${x.id}`
    );
  }

  function copySourceToRepeat() {
    const fromStage = qs("#csFromStage")?.value || "";
    const fromGrade = qs("#csFromGrade")?.value || "";
    const fromSection = qs("#csFromSection")?.value || "";

    if (fromStage && qs("#csRepeatStage")) {
      qs("#csRepeatStage").value = fromStage;
      fillGrades("Repeat");

      if (fromGrade && qs("#csRepeatGrade")) {
        qs("#csRepeatGrade").value = fromGrade;
        fillSections("Repeat");
      }

      if (fromSection && qs("#csRepeatSection")) {
        qs("#csRepeatSection").value = fromSection;
      }
    }
  }

  function getFilters() {
    return {
      from_academic_year_id: selectedNumber("#csFromYear"),
      from_stage_id: selectedNumber("#csFromStage"),
      from_grade_id: selectedNumber("#csFromGrade"),
      from_section_id: selectedNumber("#csFromSection"),

      to_academic_year_id: selectedNumber("#csToYear"),

      promote_stage_id: selectedNumber("#csPromoteStage"),
      promote_grade_id: selectedNumber("#csPromoteGrade"),
      promote_section_id: selectedNumber("#csPromoteSection"),

      repeat_stage_id: selectedNumber("#csRepeatStage"),
      repeat_grade_id: selectedNumber("#csRepeatGrade"),
      repeat_section_id: selectedNumber("#csRepeatSection"),
    };
  }

  function validateFilters() {
    const f = getFilters();

    const labels = {
      from_academic_year_id: "اختر السنة الحالية.",
      from_stage_id: "اختر المرحلة الحالية.",
      from_grade_id: "اختر الصف الحالي.",
      from_section_id: "اختر الشعبة الحالية.",

      to_academic_year_id: "اختر السنة الجديدة.",

      promote_stage_id: "اختر مرحلة الناجحين.",
      promote_grade_id: "اختر صف الناجحين.",
      promote_section_id: "اختر شعبة الناجحين.",

      repeat_stage_id: "اختر مرحلة الراسبين.",
      repeat_grade_id: "اختر صف الراسبين.",
      repeat_section_id: "اختر شعبة الراسبين.",
    };

    for (const [key, message] of Object.entries(labels)) {
      if (!f[key]) throw new Error(message);
    }

    if (f.from_academic_year_id === f.to_academic_year_id) {
      throw new Error("السنة الجديدة يجب أن تكون مختلفة عن السنة الحالية.");
    }

    return f;
  }

  function buildQuery(filters) {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      params.set(key, String(value));
    });

    return params.toString();
  }

  function statusClass(status) {
    if (status === "ready") return "ready";
    if (status === "already_registered") return "already";
    if (status === "needs_review") return "review";
    return "blocked";
  }

  function decisionClass(decision) {
    if (decision === "promote") return "ready";
    if (decision === "repeat") return "already";
    return "review";
  }

  function renderSummary(summary = {}) {
    qs("#csTotalCount") && (qs("#csTotalCount").textContent = String(summary.total || 0));
    qs("#csReadyCount") && (qs("#csReadyCount").textContent = String(summary.ready || 0));
    qs("#csPassedCount") && (qs("#csPassedCount").textContent = String(summary.passed || 0));
    qs("#csFailedCount") && (qs("#csFailedCount").textContent = String(summary.failed || 0));
    qs("#csReviewCount") && (qs("#csReviewCount").textContent = String(summary.needs_review || 0));
    qs("#csAlreadyCount") && (qs("#csAlreadyCount").textContent = String(summary.already_registered || 0));
    updateSelectedCount();
  }

  function updateSelectedCount() {
    const checked = qsa(".cs-row-check").filter((x) => x.checked).length;
    qs("#csSelectedCount") && (qs("#csSelectedCount").textContent = String(checked));

    const btn = qs("#csRegisterBtn");
    if (btn) btn.disabled = checked <= 0;
  }

  function destinationLabel(student) {
    if (!student.can_register) return student.target_label || "—";

    if (student.decision === "promote") return "وجهة الناجحين";
    if (student.decision === "repeat") return "وجهة الراسبين";

    return "—";
  }

  function renderStudents(payload) {
    const body = qs("#csStudentsBody");
    const wrap = qs("#csTableWrap");
    const empty = qs("#csEmpty");
    const meta = qs("#csStudentsMeta");

    state.students = Array.isArray(payload?.students) ? payload.students : [];

    renderSummary(payload?.summary || {});

    if (!body || !wrap || !empty) return;

    if (!state.students.length) {
      body.innerHTML = "";
      wrap.style.display = "none";
      empty.style.display = "";
      empty.textContent = "لا يوجد طلاب في المصدر المحدد.";
      if (meta) meta.textContent = "لا توجد بيانات.";
      return;
    }

    wrap.style.display = "";
    empty.style.display = "none";
    if (meta) meta.textContent = `${state.students.length} طالب في القائمة.`;

    body.innerHTML = state.students
      .map((student, index) => {
        const disabled = student.can_register ? "" : "disabled";

        return `
          <tr>
            <td data-label="اختيار">
              <input
                type="checkbox"
                class="cs-row-check"
                data-id="${escapeHtml(student.student_id)}"
                data-decision="${escapeHtml(student.decision || "")}"
                ${disabled}
              />
            </td>

            <td data-label="م">${index + 1}</td>
            <td data-label="الكود">${escapeHtml(student.student_code || "—")}</td>
            <td data-label="الطالب">
              <strong>${escapeHtml(student.full_name || "—")}</strong>
            </td>
            <td data-label="الرقم">${escapeHtml(student.source_roll_number || "—")}</td>

            <td data-label="نتيجة نهاية السنة">
              <span class="cs-badge ${decisionClass(student.decision)}">
                ${escapeHtml(student.result_label || "—")}
              </span>
            </td>

            <td data-label="القرار">
              ${escapeHtml(student.decision_label || "—")}
            </td>

            <td data-label="الوجهة">
              ${escapeHtml(destinationLabel(student))}
            </td>

            <td data-label="الحالة">
              <span class="cs-badge ${statusClass(student.status)}">
                ${escapeHtml(student.status_label || "—")}
              </span>
            </td>

            <td data-label="ملاحظة">${escapeHtml(student.note || "—")}</td>
          </tr>
        `;
      })
      .join("");

    qsa(".cs-row-check").forEach((check) => {
      check.addEventListener("change", updateSelectedCount);
    });

    const checkAll = qs("#csCheckAll");
    if (checkAll) checkAll.checked = false;

    updateSelectedCount();
  }

  async function loadMeta() {
    showAlert("جاري تحميل بيانات الصفحة...");

    const data = await apiGet("/continuing-students/meta");

    state.meta = {
      academic_years: data.academic_years || [],
      stages: data.stages || [],
      grades: data.grades || [],
      sections: data.sections || [],
    };

    fillYears();
    fillStages();
    fillGrades("From");
    fillGrades("Promote");
    fillGrades("Repeat");

    showAlert("");
  }

  async function loadStudents() {
    const btn = qs("#csLoadBtn");

    try {
      const filters = validateFilters();

      setLoading(btn, true, "جاري العرض...");

      const data = await apiGet(`/continuing-students/students?${buildQuery(filters)}`);
      renderStudents(data);

      showAlert("تم عرض الطلاب.", "success");
    } catch (e) {
      showAlert(e.message || "تعذر عرض الطلاب.", "error");
    } finally {
      setLoading(btn, false);
    }
  }

  function selectByDecision(decision) {
    qsa(".cs-row-check").forEach((check) => {
      if (!check.disabled) {
        check.checked = !decision || check.dataset.decision === decision;
      }
    });

    updateSelectedCount();
  }

  function selectReady() {
    selectByDecision(null);
  }

  function selectPassed() {
    selectByDecision("promote");
  }

  function selectFailed() {
    selectByDecision("repeat");
  }

  function clearSelection() {
    qsa(".cs-row-check").forEach((check) => {
      check.checked = false;
    });

    const all = qs("#csCheckAll");
    if (all) all.checked = false;

    updateSelectedCount();
  }
async function registerStudents() {
  const btn = qs("#csRegisterBtn");

  try {
    const filters = validateFilters();

    const student_ids = qsa(".cs-row-check")
      .filter((check) => check.checked)
      .map((check) => Number(check.dataset.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!student_ids.length) {
      throw new Error("اختر طالبًا واحدًا على الأقل.");
    }

    const ok = await csConfirm({
      title: "تسجيل الطلاب في السنة الجديدة",
      message:
        `سيتم تسجيل ${student_ids.length} طالب/طلاب في السنة الجديدة.\n\n` +
        "الناجحون سيتم ترحيلهم إلى وجهة الناجحين.\n" +
        "الراسبون سيتم تسجيلهم في وجهة الراسبين.\n\n" +
        "هل تريد تنفيذ العملية الآن؟",
      confirmText: "تسجيل الطلاب",
      cancelText: "إلغاء",
      type: "success",
    });

    if (!ok) return;

    setLoading(btn, true, "جاري التسجيل...");

    const data = await apiPost("/continuing-students/register", {
      ...filters,
      student_ids,
    });

    showAlert(
      `${data.message || "تم التسجيل."} تم تخطي ${data.skipped_count || 0}.`,
      "success"
    );

    if (window.AppUI?.toast) {
      window.AppUI.toast(
        `${data.message || "تم تسجيل الطلاب بنجاح."} تم تخطي ${data.skipped_count || 0}.`,
        "success"
      );
    }

    await loadStudents();
  } catch (e) {
    showAlert(e.message || "تعذر تسجيل المستمرين.", "error");

    if (window.AppUI?.toast) {
      window.AppUI.toast(e.message || "تعذر تسجيل المستمرين.", "error");
    }
  } finally {
    setLoading(btn, false);
  }
}
  function bindEvents() {
    qs("#csFromStage")?.addEventListener("change", () => {
      fillGrades("From");
      copySourceToRepeat();
    });

    qs("#csFromGrade")?.addEventListener("change", () => {
      fillSections("From");
      copySourceToRepeat();
    });

    qs("#csFromSection")?.addEventListener("change", copySourceToRepeat);

    qs("#csPromoteStage")?.addEventListener("change", () => fillGrades("Promote"));
    qs("#csPromoteGrade")?.addEventListener("change", () => fillSections("Promote"));

    qs("#csRepeatStage")?.addEventListener("change", () => fillGrades("Repeat"));
    qs("#csRepeatGrade")?.addEventListener("change", () => fillSections("Repeat"));

    qs("#csLoadBtn")?.addEventListener("click", loadStudents);
    qs("#csSelectReadyBtn")?.addEventListener("click", selectReady);
    qs("#csSelectPassedBtn")?.addEventListener("click", selectPassed);
    qs("#csSelectFailedBtn")?.addEventListener("click", selectFailed);
    qs("#csClearBtn")?.addEventListener("click", clearSelection);
    qs("#csRegisterBtn")?.addEventListener("click", registerStudents);

    qs("#csCheckAll")?.addEventListener("change", (ev) => {
      qsa(".cs-row-check").forEach((check) => {
        if (!check.disabled) check.checked = ev.target.checked;
      });

      updateSelectedCount();
    });
  }

  window.initContinuingStudentsScreen = async function () {
    const page = root();
    if (!page) return;

    if (page.dataset.ready === "1") return;
    page.dataset.ready = "1";

    bindEvents();

    try {
      await loadMeta();
      showAlert("اختر المصدر والسنة الجديدة ووجهات الناجحين والراسبين ثم اضغط عرض الطلاب.");
    } catch (e) {
      showAlert(e.message || "تعذر تحميل الصفحة.", "error");
    }
  };

  if (document.readyState !== "loading") {
    if (root()) window.initContinuingStudentsScreen();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (root()) window.initContinuingStudentsScreen();
    });
  }
})();