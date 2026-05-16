// frontend/admin/js/fees-settings.js
(function () {
  "use strict";

  if (window.__FEES_SETTINGS_LOADED__) return;
  window.__FEES_SETTINGS_LOADED__ = true;

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function toApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;

  let cleanPath = String(url || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getToken() { return localStorage.getItem("token"); }

  async function safeJson(res) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) return await res.json();
    const text = await res.text();
    throw new Error(`الرد ليس JSON (Status ${res.status}). جزء: ${text.slice(0, 120)}...`);
  }

  async function apiGet(url) {
    const token = getToken();
    const res = await fetch(toApiUrl(url), { headers: { Authorization: `Bearer ${token}` } });
    const data = await safeJson(res);
if (!res.ok) throw new Error(data.message || data.error || "API error");    return data;
  }

  async function apiSend(method, url, body) {
    const token = getToken();
    const res = await fetch(toApiUrl(url), {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : null,
    });
    const data = await safeJson(res);
if (!res.ok) throw new Error(data.message || data.error || "API error");    return data;
  }

  function fillSelect(selectEl, items, opts = {}) {
    if (!selectEl) return;
    const { valueKey = "id", labelKey = "name", placeholder = "اختر" } = opts;
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    selectEl.appendChild(ph);
    (items || []).forEach((it) => {
      const op = document.createElement("option");
      op.value = it[valueKey];
      op.textContent = it[labelKey];
      selectEl.appendChild(op);
    });
    selectEl.disabled = false;
  }

  function msg(box, text, ok = true) {
    if (!box) return;
    box.hidden = false;
    box.className = "fs-msg " + (ok ? "ok" : "err");
    box.textContent = text;
    setTimeout(() => (box.hidden = true), 3500);
  }

  function scopeLabel(s) {
    const map = {
      DEFAULT: "عامة",
      STAGE: "مرحلة",
      GRADE: "صف",
      SECTION: "شعبة",
      STUDENT: "طالب",
    };
    return map[s] || s || "—";
  }

  function targetLabel(r) {
    if (r.scope === "DEFAULT") return "كل الطلاب";
    if (r.scope === "STAGE") return r.stage_name || `Stage#${r.stage_id}`;
    if (r.scope === "GRADE") return r.grade_name || `Grade#${r.grade_id}`;
    if (r.scope === "SECTION") return r.section_name || `Section#${r.section_id}`;
    if (r.scope === "STUDENT") return (r.student_name ? `${r.student_name} (${r.student_code || r.student_id})` : `Student#${r.student_id}`);
    return "—";
  }

  function applyTargetsUI(root) {
    const scope = $("#fsScope", root)?.value || "";
    const stage = $("#fsStage", root);
    const grade = $("#fsGrade", root);
    const section = $("#fsSection", root);
    const studentSearch = $("#fsStudentSearch", root);
    const studentResults = $("#fsStudentResults", root);

    // افتراض: الكل غير مطلوب ثم نحدده حسب scope
    [stage, grade, section].forEach(el => { if (el) el.required = false; });
    if (studentSearch) studentSearch.required = false;

    // تعطيل افتراضي
    if (stage) stage.disabled = !(scope === "STAGE" || scope === "GRADE" || scope === "SECTION");
    if (grade) grade.disabled = !(scope === "GRADE" || scope === "SECTION");
    if (section) section.disabled = !(scope === "SECTION");

    // إظهار/إخفاء البحث
    if (studentSearch) {
      studentSearch.disabled = !(scope === "STUDENT");
      if (scope !== "STUDENT") studentSearch.value = "";
    }
    if (studentResults) studentResults.hidden = true;

    if (scope === "STAGE" && stage) stage.required = true;
    if ((scope === "GRADE" || scope === "SECTION") && stage) stage.required = true;
    if ((scope === "GRADE" || scope === "SECTION") && grade) grade.required = true;
    if (scope === "SECTION" && section) section.required = true;
  }

  async function loadYears(root) {
    const yearEl = $("#fsYear", root);
    const years = await apiGet("/api/academic-years");
    fillSelect(yearEl, years, { placeholder: "السنة الدراسية" });

    const active = (years || []).find(y => y.is_active === true) || years?.[0];
    if (active) yearEl.value = active.id;
  }

  async function loadStagesTo(root, sel) {
    const stages = await apiGet("/api/stages");
    fillSelect(sel, stages, { placeholder: "اختر المرحلة" });
  }

  async function loadGradesTo(root, stageId, gradeSel) {
    if (!stageId) {
      gradeSel.innerHTML = `<option value="">اختر الصف</option>`;
      gradeSel.disabled = true;
      return;
    }
    const grades = await apiGet(`/api/grades?stage_id=${encodeURIComponent(stageId)}`);
    fillSelect(gradeSel, grades, { placeholder: "اختر الصف" });
  }

  async function loadSectionsTo(root, gradeId, sectionSel) {
    if (!gradeId) {
      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      sectionSel.disabled = true;
      return;
    }
    const sections = await apiGet(`/api/sections?grade_id=${encodeURIComponent(gradeId)}`);
    fillSelect(sectionSel, sections, { placeholder: "اختر الشعبة" });
  }

  // ===== Rules CRUD =====
  async function fetchRules(root) {
    const yearId = $("#fsYear", root)?.value;
    const res = await apiGet(`/api/admin/fee-rules?academic_year_id=${encodeURIComponent(yearId)}`);
    return res.data || [];
  }

  function renderRules(root, rules) {
    const tbody = $("#fsRulesBody", root);
    if (!tbody) return;

    if (!rules.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="fs-empty">لا توجد قواعد بعد.</td></tr>`;
      return;
    }

    tbody.innerHTML = rules.map(r => `
      <tr>
        <td>${scopeLabel(r.scope)}</td>
        <td>${targetLabel(r)}</td>
        <td>${Number(r.annual_amount || 0).toLocaleString("en-US")}</td>
        <td>${r.installments_count}</td>
        <td>${(r.first_due_date || "").slice(0,10) || "—"}</td>
        <td>${r.is_active ? "نعم" : "لا"}</td>
        <td>
          <button class="fs-btn" data-act="edit" data-id="${r.id}">تعديل</button>
          <button class="fs-btn" data-act="del" data-id="${r.id}">حذف</button>
        </td>
      </tr>
    `).join("");
  }

  function clearForm(root) {
    $("#fsRuleId", root).value = "";
    $("#fsScope", root).value = "";
    $("#fsStage", root).value = "";
    $("#fsGrade", root).value = "";
    $("#fsSection", root).value = "";
    $("#fsStudentSearch", root).value = "";
    $("#fsStudentId", root).value = "";
    $("#fsAnnual", root).value = "";
    $("#fsInstallments", root).value = "";
    $("#fsFirstDue", root).value = "";
    $("#fsInterval", root).value = "1";
    $("#fsReason", root).value = "";
    $("#fsNotes", root).value = "";
    $("#fsIsActive", root).checked = true;
    applyTargetsUI(root);
  }

  function fillForm(root, rule) {
    $("#fsRuleId", root).value = rule.id;
    $("#fsScope", root).value = rule.scope;

    $("#fsAnnual", root).value = rule.annual_amount;
    $("#fsInstallments", root).value = rule.installments_count;
    $("#fsFirstDue", root).value = (rule.first_due_date || "").slice(0, 10);
    $("#fsInterval", root).value = rule.interval_months || 1;
    $("#fsReason", root).value = rule.reason_code || "";
    $("#fsNotes", root).value = rule.notes || "";
    $("#fsIsActive", root).checked = rule.is_active !== false;

    applyTargetsUI(root);

    // targets
    if (rule.scope === "STAGE") $("#fsStage", root).value = rule.stage_id || "";
    if (rule.scope === "GRADE") $("#fsGrade", root).value = rule.grade_id || "";
    if (rule.scope === "SECTION") $("#fsSection", root).value = rule.section_id || "";
    if (rule.scope === "STUDENT") {
      $("#fsStudentId", root).value = rule.student_id || "";
      $("#fsStudentSearch", root).value = rule.student_name ? `${rule.student_name} (${rule.student_code || rule.student_id})` : String(rule.student_id || "");
    }
  }

  async function saveRule(root) {
    const msgBox = $("#fsMsg", root);

    const yearId = Number($("#fsYear", root).value);
    const id = $("#fsRuleId", root).value ? Number($("#fsRuleId", root).value) : null;

    const scope = $("#fsScope", root).value;
    const stageId = $("#fsStage", root).value ? Number($("#fsStage", root).value) : null;
    const gradeId = $("#fsGrade", root).value ? Number($("#fsGrade", root).value) : null;
    const sectionId = $("#fsSection", root).value ? Number($("#fsSection", root).value) : null;
    const studentId = $("#fsStudentId", root).value ? Number($("#fsStudentId", root).value) : null;

    const payload = {
      academic_year_id: yearId,
      scope,
      stage_id: stageId,
      grade_id: gradeId,
      section_id: sectionId,
      student_id: studentId,
      annual_amount: Number($("#fsAnnual", root).value),
      installments_count: Number($("#fsInstallments", root).value),
      first_due_date: $("#fsFirstDue", root).value,
      interval_months: Number($("#fsInterval", root).value || 1),
      reason_code: $("#fsReason", root).value.trim() || null,
      notes: $("#fsNotes", root).value.trim() || null,
      is_active: $("#fsIsActive", root).checked,
    };

    if (!scope) return msg(msgBox, "اختر نوع القاعدة.", false);

    try {
      if (id) await apiSend("PUT", `/api/admin/fee-rules/${id}`, payload);
      else await apiSend("POST", `/api/admin/fee-rules`, payload);

      msg(msgBox, "تم الحفظ ✅", true);
      clearForm(root);
      await refreshRules(root);
    } catch (e) {
      msg(msgBox, e.message || "فشل الحفظ", false);
    }
  }

  async function refreshRules(root) {
    const rules = await fetchRules(root);
    root.__fsRules = rules;
    renderRules(root, rules);
  }

  // ===== Student search for STUDENT scope =====
  let studentSearchTimer = null;

  async function studentSearch(root, q) {
    // يعتمد على /api/students (يتطلب admission.view_students)
    const yearId = $("#fsYear", root).value;
    const res = await apiGet(`/api/students?q=${encodeURIComponent(q)}&limit=10&academic_year_id=${encodeURIComponent(yearId)}`);
    const list = res.data || res || [];
    return Array.isArray(list) ? list : [];
  }

  function renderStudentResults(root, list) {
    const box = $("#fsStudentResults", root);
    if (!box) return;

    if (!list.length) {
      box.innerHTML = `<div style="padding:10px 12px;opacity:.8">لا توجد نتائج</div>`;
      box.hidden = false;
      return;
    }

    box.innerHTML = list.map(s => `
      <button type="button" data-id="${s.id}" data-name="${(s.full_name || "").replace(/"/g,'&quot;')}" data-code="${(s.student_code || "").replace(/"/g,'&quot;')}">
        ${s.full_name || "—"} <span style="opacity:.7">(${s.student_code || s.id})</span>
      </button>
    `).join("");
    box.hidden = false;
  }

  // ===== Students tab =====
  const studentsState = { page: 1, pages: 1, limit: 20 };

  async function fetchStudentsView(root) {
    const yearId = $("#fsYear", root).value;
    const q = ($("#fsQ", root).value || "").trim();

    const st = $("#fsFStage", root).value || "";
    const gr = $("#fsFGrade", root).value || "";
    const sc = $("#fsFSection", root).value || "";

    const hasEx = $("#fsOnlyExceptions", root).checked ? "true" : "";
    const missC = $("#fsOnlyMissingContracts", root).checked ? "true" : "";

    const url =
      `/api/admin/fee-rules/students?academic_year_id=${encodeURIComponent(yearId)}`
      + `&q=${encodeURIComponent(q)}`
      + `&stage_id=${encodeURIComponent(st)}&grade_id=${encodeURIComponent(gr)}&section_id=${encodeURIComponent(sc)}`
      + `&has_exception=${encodeURIComponent(hasEx)}&missing_contract=${encodeURIComponent(missC)}`
      + `&page=${studentsState.page}&limit=${studentsState.limit}`;

    return await apiGet(url);
  }

  function renderStudentsView(root, payload) {
    const tbody = $("#fsStudentsBody", root);
    const info = $("#fsPageInfo", root);

    const rows = payload.data || [];
    studentsState.pages = payload.pages || 1;

    if (info) info.textContent = `صفحة ${payload.page || 1} من ${payload.pages || 1} — إجمالي ${payload.total || 0}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="fs-empty">لا توجد بيانات</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><b>${r.full_name || "—"}</b><div style="opacity:.75">${r.student_code || ""}</div></td>
        <td>${r.stage_name || "—"} / ${r.grade_name || "—"} / ${r.section_name || "—"}</td>
        <td>${r.has_contract ? `✅ (${r.contract_id})` : "❌"}</td>
        <td>${scopeLabel(r.applied_scope)}</td>
        <td>${Number(r.annual_amount || 0).toLocaleString("en-US")}</td>
        <td>${r.installments_count || "—"}</td>
        <td>${(r.first_due_date || "").slice(0,10) || "—"}</td>
        <td>${r.has_student_exception ? "✅" : "—"}</td>
      </tr>
    `).join("");
  }

  async function doStudentsSearch(root) {
    const payload = await fetchStudentsView(root);
    renderStudentsView(root, payload);
  }

  // ===== Tabs =====
  function initTabs(root) {
    const tabs = $$(".fs-tab", root);
    const panels = $$(".fs-panel", root);

    tabs.forEach(t => {
      t.addEventListener("click", () => {
        tabs.forEach(x => x.classList.toggle("is-active", x === t));
        const key = t.dataset.tab;
        panels.forEach(p => p.hidden = (p.dataset.panel !== key));
      });
    });
  }

  async function initFeesSettings(root) {
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";

    initTabs(root);

    // years
    await loadYears(root);

    // rule targets selects
    await loadStagesTo(root, $("#fsStage", root));
    fillSelect($("#fsGrade", root), [], { placeholder: "اختر الصف" });
    fillSelect($("#fsSection", root), [], { placeholder: "اختر الشعبة" });

    // filters selects
    await loadStagesTo(root, $("#fsFStage", root));
    fillSelect($("#fsFGrade", root), [], { placeholder: "اختر الصف" });
    fillSelect($("#fsFSection", root), [], { placeholder: "اختر الشعبة" });

    // bind change stage -> grades (rule)
    $("#fsStage", root)?.addEventListener("change", async () => {
      await loadGradesTo(root, $("#fsStage", root).value, $("#fsGrade", root));
      await loadSectionsTo(root, $("#fsGrade", root).value, $("#fsSection", root));
    });

    // bind change grade -> sections (rule)
    $("#fsGrade", root)?.addEventListener("change", async () => {
      await loadSectionsTo(root, $("#fsGrade", root).value, $("#fsSection", root));
    });

    // bind scope
    $("#fsScope", root)?.addEventListener("change", () => applyTargetsUI(root));
    applyTargetsUI(root);

    // student search
    $("#fsStudentSearch", root)?.addEventListener("input", () => {
      const scope = $("#fsScope", root).value;
      if (scope !== "STUDENT") return;

      const q = ($("#fsStudentSearch", root).value || "").trim();
      const box = $("#fsStudentResults", root);
      $("#fsStudentId", root).value = "";

      if (!q || q.length < 2) { if (box) box.hidden = true; return; }

      clearTimeout(studentSearchTimer);
      studentSearchTimer = setTimeout(async () => {
        try {
          const list = await studentSearch(root, q);
          renderStudentResults(root, list);
        } catch (e) {
          if (box) { box.innerHTML = `<div style="padding:10px 12px;opacity:.8">فشل البحث</div>`; box.hidden = false; }
        }
      }, 250);
    });

    $("#fsStudentResults", root)?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-id]");
      if (!btn) return;
      $("#fsStudentId", root).value = btn.dataset.id;
      $("#fsStudentSearch", root).value = `${btn.dataset.name} (${btn.dataset.code || btn.dataset.id})`;
      $("#fsStudentResults", root).hidden = true;
    });

    // rules table actions
    $("#fsRulesBody", root)?.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const id = Number(b.dataset.id);
      const act = b.dataset.act;

      const rules = root.__fsRules || [];
      const rule = rules.find(x => Number(x.id) === id);

      if (act === "edit" && rule) {
        // load grade/section for edit if needed
        if (rule.scope === "GRADE" || rule.scope === "SECTION") {
          $("#fsStage", root).value = rule.stage_id || "";
          await loadGradesTo(root, $("#fsStage", root).value, $("#fsGrade", root));
        }
        if (rule.scope === "SECTION") {
          $("#fsGrade", root).value = rule.grade_id || "";
          await loadSectionsTo(root, $("#fsGrade", root).value, $("#fsSection", root));
        }
        fillForm(root, rule);
      }

      if (act === "del") {
        if (!confirm("حذف القاعدة؟")) return;
        try {
          await apiSend("DELETE", `/api/admin/fee-rules/${id}`);
          await refreshRules(root);
        } catch (err) {
          alert(err.message || "فشل الحذف");
        }
      }
    });

    // save rule
    $("#fsRuleForm", root)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveRule(root);
    });

    $("#fsClear", root)?.addEventListener("click", () => clearForm(root));
    $("#fsRefresh", root)?.addEventListener("click", async () => {
      await refreshRules(root);
    });

    // filters binds
    $("#fsFStage", root)?.addEventListener("change", async () => {
      await loadGradesTo(root, $("#fsFStage", root).value, $("#fsFGrade", root));
      await loadSectionsTo(root, $("#fsFGrade", root).value, $("#fsFSection", root));
    });

    $("#fsFGrade", root)?.addEventListener("change", async () => {
      await loadSectionsTo(root, $("#fsFGrade", root).value, $("#fsFSection", root));
    });

    $("#fsSearch", root)?.addEventListener("click", async () => {
      studentsState.page = 1;
      await doStudentsSearch(root);
    });

    $("#fsPrev", root)?.addEventListener("click", async () => {
      if (studentsState.page <= 1) return;
      studentsState.page -= 1;
      await doStudentsSearch(root);
    });

    $("#fsNext", root)?.addEventListener("click", async () => {
      if (studentsState.page >= studentsState.pages) return;
      studentsState.page += 1;
      await doStudentsSearch(root);
    });

    // initial load
    await refreshRules(root);
  }

  function boot() {
    const root = document.getElementById("feesSettingsPage");
    if (root) initFeesSettings(root);
  }

  document.addEventListener("DOMContentLoaded", boot);

  // لما يتم حقن section داخل admin/index
  const obs = new MutationObserver(boot);
  obs.observe(document.body, { childList: true, subtree: true });
})();