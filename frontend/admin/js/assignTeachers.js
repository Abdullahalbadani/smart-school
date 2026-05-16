// frontend/admin/js/assignTeachers.js
(function () {
  "use strict";

const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const apiUrl =
  typeof window.apiUrl === "function"
    ? window.apiUrl
    : function (path = "") {
        if (/^https?:\/\//i.test(path)) return path;

        let cleanPath = String(path || "").replace(/^\/+/, "");

        if (cleanPath.startsWith("api/")) {
          cleanPath = cleanPath.slice(4);
        }

        return `${API_BASE}/${cleanPath}`;
      };
        const $ = (sel, root = document) => root.querySelector(sel);

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

 async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);

  const r = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  });

  const text = await r.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg = data?.error || data?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  return data;
}
  function showToast(msg) {
    // لو عندك Toast عام في admin استخدمه. وإلا fallback:
    if (window.showToast) return window.showToast(msg);
    alert(msg);
  }

  let META = null;
  let CURRENT = null; // rows الحالية من السيرفر
  let DIRTY = false;

  function markDirty(v) {
    DIRTY = !!v;
    const saveBtn = $("#atSave");
    if (saveBtn) saveBtn.disabled = !DIRTY;
    const sum = $("#atSummary");
    if (sum && DIRTY) sum.textContent = "يوجد تغييرات غير محفوظة…";
  }

  function boot() {
    const root = $("#assignTeachersPage");
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";
    init(root).catch((e) => showToast(e.message));
  }

  async function init(root) {
    // fetch meta
    const meta = await apiFetch("/admin/assign-teachers/meta");
    META = meta.data;

    const yearSel = $("#atYear", root);
    const termSel = $("#atTerm", root);
    const stageSel = $("#atStage", root);
    const gradeSel = $("#atGrade", root);
    const sectionSel = $("#atSection", root);
    const reloadBtn = $("#atReload", root);
    const saveBtn = $("#atSave", root);
    const searchInp = $("#atSearch", root);

    // fill years
    fillSelect(yearSel, META.years, "اختر السنة", (x) => x.id, (x) => x.name);

    // fill stages
    fillSelect(stageSel, META.stages, "اختر المرحلة", (x) => x.id, (x) => x.name);

    // start empty
    fillSelect(gradeSel, [], "اختر الصف", (x) => x.id, (x) => x.name);
    fillSelect(sectionSel, [], "اختر الشعبة", (x) => x.id, (x) => x.name);

    stageSel.addEventListener("change", () => {
      const stageId = Number(stageSel.value || 0);
      const grades = META.grades.filter((g) => g.stage_id === stageId);
      fillSelect(gradeSel, grades, "اختر الصف", (x) => x.id, (x) => x.name);
      fillSelect(sectionSel, [], "اختر الشعبة", (x) => x.id, (x) => x.name);
      CURRENT = null;
      renderEmpty("اختر الصف ثم الشعبة…");
      markDirty(false);
    });

    gradeSel.addEventListener("change", () => {
      const gradeId = Number(gradeSel.value || 0);
      const sections = META.sections.filter((s) => s.grade_id === gradeId);
      fillSelect(sectionSel, sections, "اختر الشعبة", (x) => x.id, (x) => x.name);
      CURRENT = null;
      renderEmpty("اختر الشعبة…");
      markDirty(false);
    });

    async function tryLoad() {
      const yearId = Number(yearSel.value || 0);
      const term = Number(termSel.value || 0);
      const sectionId = Number(sectionSel.value || 0);
      if (!yearId || !term || !sectionId) return;

      const r = await apiFetch(
        `/admin/assign-teachers/section?academicYearId=${yearId}&term=${term}&sectionId=${sectionId}`
      );

      CURRENT = r.data;
      markDirty(false);

      const sum = $("#atSummary", root);
      const secName = CURRENT.section?.name || "";
      sum.textContent = `الشعبة: ${secName} | عدد المواد: ${CURRENT.rows.length}`;

      renderRows(root, CURRENT.rows);
    }

    yearSel.addEventListener("change", tryLoad);
    termSel.addEventListener("change", tryLoad);
    sectionSel.addEventListener("change", tryLoad);

    reloadBtn.addEventListener("click", tryLoad);

    saveBtn.addEventListener("click", async () => {
      if (!CURRENT) return;

      const yearId = Number(yearSel.value || 0);
      const term = Number(termSel.value || 0);
      const sectionId = Number(sectionSel.value || 0);

      const assignments = [];
      const tbody = $("#atTbody", root);
      tbody.querySelectorAll("tr[data-subject-id]").forEach((tr) => {
        const subjectId = Number(tr.dataset.subjectId);
        const sel = tr.querySelector("select");
        const teacherId = Number(sel.value || 0);
        const status = tr.querySelector("input[type=checkbox]")?.checked
          ? "active"
          : "inactive";

        assignments.push({ subject_id: subjectId, teacher_id: teacherId, status });
      });

      // basic check: teacher chosen for active rows
      const missing = assignments.find((a) => a.status === "active" && !a.teacher_id);
      if (missing) {
        showToast("يوجد مادة بدون مدرس (ضمن مواد فعالة).");
        return;
      }

      await apiFetch("/admin/assign-teachers/section", {
        method: "POST",
        body: JSON.stringify({
          academic_year_id: yearId,
          term,
          section_id: sectionId,
          assignments,
        }),
      });

      showToast("تم الحفظ ✅");
      markDirty(false);
      await tryLoad();
    });

    searchInp.addEventListener("input", () => {
      const q = (searchInp.value || "").trim();
      filterRows(q);
    });

    renderEmpty("اختر السنة/الترم/المرحلة/الصف/الشعبة…");
  }

  function fillSelect(sel, items, placeholder, getVal, getLabel) {
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    sel.appendChild(opt0);

    for (const it of items) {
      const o = document.createElement("option");
      o.value = getVal(it);
      o.textContent = getLabel(it);
      sel.appendChild(o);
    }
  }

  function renderEmpty(msg) {
    const tbody = document.querySelector("#atTbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="at-empty">${msg}</td></tr>`;
  }

  function renderRows(root, rows) {
    const tbody = $("#atTbody", root);
    tbody.innerHTML = "";

    rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.subjectId = row.subject_id;
      tr.dataset.subjectName = row.subject_name;

      const eligible = row.eligible_teachers || [];

      const teacherSelect = document.createElement("select");
      teacherSelect.innerHTML = `<option value="">— اختر مدرس —</option>`;
      for (const t of eligible) {
        const o = document.createElement("option");
        o.value = t.id;
        o.textContent = t.full_name;
        teacherSelect.appendChild(o);
      }

      // set current
      if (row.assigned_teacher_id) {
        teacherSelect.value = String(row.assigned_teacher_id);
      }

      teacherSelect.addEventListener("change", () => markDirty(true));

      // status toggle
      const statusWrap = document.createElement("div");
      statusWrap.style.display = "flex";
      statusWrap.style.alignItems = "center";
      statusWrap.style.gap = "10px";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = (row.status || "active") === "active";
      chk.addEventListener("change", () => markDirty(true));

      const pill = document.createElement("span");
      pill.className = "at-pill";
      pill.textContent = chk.checked ? "نشط" : "موقوف";

      chk.addEventListener("change", () => {
        pill.textContent = chk.checked ? "نشط" : "موقوف";
      });

      statusWrap.appendChild(chk);
      statusWrap.appendChild(pill);

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="at-subject">${row.subject_name}</td>
        <td></td>
        <td></td>
      `;
      tr.children[2].appendChild(teacherSelect);
      tr.children[3].appendChild(statusWrap);

      tbody.appendChild(tr);
    });
  }

  function filterRows(q) {
    const tbody = document.querySelector("#atTbody");
    if (!tbody) return;
    const term = q.toLowerCase();
    tbody.querySelectorAll("tr[data-subject-id]").forEach((tr) => {
      const name = (tr.dataset.subjectName || "").toLowerCase();
      tr.style.display = !term || name.includes(term) ? "" : "none";
    });
  }

  // boot on load + watch injections
  document.addEventListener("DOMContentLoaded", boot);
  const mo = new MutationObserver(boot);
  mo.observe(document.body, { childList: true, subtree: true });
})();
