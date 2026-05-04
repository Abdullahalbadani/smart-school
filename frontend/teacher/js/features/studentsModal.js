(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";
  const byId = (id) => document.getElementById(id);

  const esc = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");



      
  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiGet(path) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const r = await fetch(url, { headers: { ...authHeaders() } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.message || "API Error");
    return data;
  }

  function setStatus(msg) {
    const el = byId("st-status");
    if (!el) return;
    el.style.display = msg ? "block" : "none";
    el.textContent = msg || "";
  }

  function fillSelect(el, items, valueKey, labelKey, placeholder) {
    if (!el) return;
    const opts = [];
    if (placeholder) opts.push(`<option value="">${esc(placeholder)}</option>`);
    for (const it of items || []) {
      opts.push(`<option value="${esc(it[valueKey])}">${esc(it[labelKey])}</option>`);
    }
    el.innerHTML = opts.join("");
  }

  function uniqueByKey(list, key) {
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
      const v = String(item[key]);
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(item);
    }
    return out;
  }

  function resetGradeSection() {
    const elGrade = byId("st-grade");
    const elSection = byId("st-section");
    if (elGrade) {
      elGrade.disabled = true;
      elGrade.innerHTML = `<option value="">اختر الصف</option>`;
    }
    if (elSection) {
      elSection.disabled = true;
      elSection.innerHTML = `<option value="">اختر الشعبة</option>`;
    }
  }

  function renderRows(rows) {
    const tbody = byId("st-table-body");
    const empty = byId("st-empty");
    if (!tbody) return;

    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = rows
      .map((r) => {
        const code = r.student_code ?? "";
        const name = r.full_name ?? "";
        const cls = [r.grade_name, r.section_name].filter(Boolean).join(" / ");
        const phone = r.guardian_phone ?? "—";
        return `
          <tr>
            <td>${esc(code)}</td>
            <td>${esc(name)}</td>
            <td>${esc(cls)}</td>
            <td>${esc(phone)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function initTeacherStudentsModal() {
    const elYear = byId("st-year");
    const elTerm = byId("st-term");
    const elStage = byId("st-stage");
    const elGrade = byId("st-grade");
    const elSection = byId("st-section");
    const elSearch = byId("st-search");
    const elLoad = byId("st-load");

    if (!elYear || !elTerm || !elStage || !elGrade || !elSection || !elLoad) return;

    let scopes = [];
    let lastRows = [];

    // meta
    setStatus("جارٍ تحميل البيانات...");
    try {
      const r = await apiGet("/teacher/students/meta");
      fillSelect(elYear, r?.data?.years || [], "id", "name", "اختر السنة");
      fillSelect(elStage, r?.data?.stages || [], "id", "name", "اختر المرحلة");
      setStatus("");
    } catch (e) {
      setStatus(e.message || "فشل تحميل بيانات الفلاتر");
      return;
    }

    async function loadScopes() {
      resetGradeSection();
      renderRows([]);
      lastRows = [];
      scopes = [];

      const academicYearId = elYear.value;
      const term = elTerm.value || "1";

      if (!academicYearId) {
        setStatus("اختر السنة الدراسية أولاً.");
        return;
      }

      setStatus("جارٍ تحميل نطاقاتك...");
      try {
        const r = await apiGet(
          `/teacher/students/scopes?academicYearId=${encodeURIComponent(academicYearId)}&term=${encodeURIComponent(term)}`
        );
        scopes = Array.isArray(r?.data) ? r.data : [];
        setStatus(scopes.length ? "" : "لا توجد شعب/صفوف لهذا المعلم في هذا العام/الترم.");

        // stage من scopes فقط
    // استبدل الجزء الخاص بـ stageItems داخل دالة loadScopes بهذا الكود:
const stageItems = uniqueByKey(scopes, "stage_name") // التوحيد بالاسم لضمان عدم التكرار
  .filter(x => x.stage_name && x.stage_id) // ضمان وجود بيانات صحيحة
  .map((x) => ({
    id: x.stage_id,
    name: x.stage_name,
  }));
fillSelect(elStage, stageItems, "id", "name", "اختر المرحلة");
      } catch (e) {
        setStatus(e.message || "فشل تحميل نطاقات المعلم");
      }
    }

    function fillGradesFromScopes() {
      const stageId = elStage.value || "";
      const filtered = scopes.filter((s) => (stageId ? String(s.stage_id) === String(stageId) : true));
      const grades = uniqueByKey(filtered, "grade_id").map((x) => ({ id: x.grade_id, name: x.grade_name }));
      fillSelect(elGrade, grades, "id", "name", "اختر الصف");
      elGrade.disabled = grades.length === 0;

      elSection.disabled = true;
      elSection.innerHTML = `<option value="">اختر الشعبة</option>`;
    }

    function fillSectionsFromScopes() {
      const stageId = elStage.value || "";
      const gradeId = elGrade.value || "";
      const filtered = scopes.filter((s) => {
        if (stageId && String(s.stage_id) !== String(stageId)) return false;
        if (gradeId && String(s.grade_id) !== String(gradeId)) return false;
        return true;
      });

      const sections = uniqueByKey(filtered, "section_id").map((x) => ({ id: x.section_id, name: x.section_name }));
      fillSelect(elSection, sections, "id", "name", "اختر الشعبة");
      elSection.disabled = sections.length === 0;
    }

    async function loadStudents() {
      const academicYearId = elYear.value;
      const term = elTerm.value || "1";
      const stageId = elStage.value || "";
      const gradeId = elGrade.value || "";
      const sectionId = elSection.value || "";
      const q = String(elSearch?.value || "").trim();

      if (!academicYearId) {
        setStatus("اختر السنة الدراسية أولاً.");
        return;
      }

      setStatus("جارٍ تحميل الطلاب...");
      try {
        const url =
          `/teacher/students/list?academicYearId=${encodeURIComponent(academicYearId)}` +
          `&term=${encodeURIComponent(term)}` +
          `&stageId=${encodeURIComponent(stageId)}` +
          `&gradeId=${encodeURIComponent(gradeId)}` +
          `&sectionId=${encodeURIComponent(sectionId)}` +
          `&q=${encodeURIComponent(q)}`;

        const r = await apiGet(url);
        lastRows = Array.isArray(r?.data) ? r.data : [];
        renderRows(lastRows);
        setStatus(`تم تحميل ${lastRows.length} طالب.`);
      } catch (e) {
        setStatus(e.message || "فشل تحميل الطلاب");
      }
    }

    elYear.addEventListener("change", loadScopes);
    elTerm.addEventListener("change", loadScopes);

    elStage.addEventListener("change", function () {
      fillGradesFromScopes();
      renderRows([]);
      lastRows = [];
    });

    elGrade.addEventListener("change", function () {
      fillSectionsFromScopes();
      renderRows([]);
      lastRows = [];
    });

    elLoad.addEventListener("click", loadStudents);

    resetGradeSection();
    renderRows([]);
    setStatus("اختر السنة ثم سيتم تحميل نطاقاتك.");
  }

  window.initTeacherStudentsModal = initTeacherStudentsModal;
})();
