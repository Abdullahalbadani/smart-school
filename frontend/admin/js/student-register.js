// frontend/admin/js/student-register.js
(function () {
  "use strict";


  /* ===================== CONFIG ===================== */
/* ===================== CONFIG ===================== */
const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function toApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;

  let cleanPath = String(url || "").replace(/^\/+/, "");

  // يمنع تكرار /api/api لأن بعض الاستدعاءات في هذا الملف تبدأ بـ /api
  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}

  /* ===================== Helpers ===================== */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function showEl(el) {
    if (!el) return;
    el.classList.remove("sr-hidden", "hidden");
  }

  function hideEl(el) {
    if (!el) return;
    el.classList.add("sr-hidden");
  }

  function showAlert(type, message) {
    if (window.AppUI) {
      if (type === "error") {
        window.AppUI.alert({
          title: "تعذر تسجيل الطالب",
          message,
          type: "danger",
        });
      } else {
        window.AppUI.toast(message, "success");
      }
      return;
    }

    const box = $("#sr-alert");
    if (!box) return;
    box.classList.remove("sr-alert-hidden", "sr-alert-success", "sr-alert-error");
    box.classList.add(type === "error" ? "sr-alert-error" : "sr-alert-success");
    box.textContent = message;
    setTimeout(() => box.classList.add("sr-alert-hidden"), 6000);
  }

  function debounce(fn, ms = 250) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function escHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setSectionEnabled(sectionEl, enabled) {
    if (!sectionEl) return;
    sectionEl.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!enabled) {
        el.dataset.wasRequired = el.required ? "1" : "0";
        el.required = false;
        el.disabled = true;
      } else {
        el.disabled = false;
        if (el.dataset.wasRequired === "1") el.required = true;
      }
    });
  }

  /* ===================== API helpers ===================== */
  function getToken() {
    return localStorage.getItem("token");
  }

  async function safeJson(res) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) return await res.json();

    const text = await res.text();
    throw new Error(
      `الرد ليس JSON (Status ${res.status}). غالبًا Endpoint غير موجود أو CORS غير مفعّل. جزء من الرد: ${text.slice(
        0,
        120
      )}...`
    );
  }

  async function apiGet(url) {
    const token = getToken();
    if (!token) throw new Error("لا يوجد Token. سجّل دخول مرة أخرى.");

    const res = await fetch(toApiUrl(url), {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await safeJson(res);
   if (!res.ok) throw new Error(data.message || data.error || "API error");
    return data;
  }

  async function apiPost(url, body) {
    const token = getToken();
    if (!token) throw new Error("لا يوجد Token. سجّل دخول مرة أخرى.");

    const res = await fetch(toApiUrl(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.message || data.error || "API error");
    return data;
  }

  /* ===================== Select helpers ===================== */
  function fillSelect(selectEl, items, opts = {}) {
    if (!selectEl) return;
    const { valueKey = "id", labelKey = "name", placeholder = "اختر" } = opts;

    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    selectEl.appendChild(ph);

    (items || []).forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item[valueKey];
      opt.textContent = item[labelKey];
      selectEl.appendChild(opt);
    });

    selectEl.disabled = false;
  }

  /* ===================== Load lookups ===================== */
  async function loadAcademicYears() {
    const yearEl = $("#academicYear");
    if (!yearEl) return;

    const years = await apiGet("/api/academic-years");
    fillSelect(yearEl, years, { placeholder: "اختر السنة الدراسية" });

    const statYear = $("#sr-stat-year");
    const active = (years || []).find((y) => y.is_active === true) || years?.[0];
    if (statYear && active) statYear.textContent = active.name;
  }

  async function loadStages() {
    const stageEl = $("#studentStage");
    if (!stageEl) return;

    const stages = await apiGet("/api/stages");
    fillSelect(stageEl, stages, { placeholder: "اختر المرحلة" });
  }

  function bindStageToGrades() {
    const stageEl = $("#studentStage");
    const gradeEl = $("#studentClass");
    if (!stageEl || !gradeEl) return;

    stageEl.addEventListener("change", async () => {
      gradeEl.innerHTML = `<option value="">اختر الصف</option>`;
      gradeEl.disabled = true;

      const sectionEl = $("#studentSection");
      if (sectionEl) {
        sectionEl.innerHTML = `<option value="">اختر الشعبة</option>`;
        sectionEl.disabled = true;
      }

      const stageId = stageEl.value;
      if (!stageId) return;

      try {
        const grades = await apiGet(`/api/grades?stage_id=${encodeURIComponent(stageId)}`);
        fillSelect(gradeEl, grades, { placeholder: "اختر الصف" });
      } catch (err) {
        showAlert("error", err.message);
      }
    });
  }

  function bindGradeToSections() {
    const gradeEl = $("#studentClass");
    const sectionEl = $("#studentSection");
    const sectionTypeEl = $("#sectionType");
    if (!gradeEl || !sectionEl || !sectionTypeEl) return;

    gradeEl.addEventListener("change", async () => {
      sectionEl.innerHTML = `<option value="">اختر الشعبة</option>`;
      sectionEl.disabled = true;

      const gradeId = gradeEl.value;
      if (!gradeId) return;

      try {
        const sections = await apiGet(`/api/sections?grade_id=${encodeURIComponent(gradeId)}`);
        fillSelect(sectionEl, sections, { placeholder: "اختر الشعبة" });

        if (sectionTypeEl.value === "manual") sectionEl.disabled = false;
      } catch (err) {
        showAlert("error", err.message);
      }
    });
  }

  /* ===================== Section type toggle ===================== */
  function initSectionType() {
    const sectionTypeEl = $("#sectionType");
    const sectionWrapper = $("#sectionSelectWrapper");
    const sectionEl = $("#studentSection");
    if (!sectionTypeEl || !sectionWrapper || !sectionEl) return;

    function apply() {
      const isManual = sectionTypeEl.value === "manual";

      if (isManual) {
        showEl(sectionWrapper);
        sectionEl.disabled = !$("#studentClass")?.value;
        sectionEl.required = true;
      } else {
        hideEl(sectionWrapper);
        sectionEl.disabled = true;
        sectionEl.required = false;
        sectionEl.value = "";
      }
    }

    sectionTypeEl.addEventListener("change", apply);
    apply();
  }

  /* ===================== Parent option (existing/new) ===================== */
  function setParentRequired(mode) {
    const parentName = $("#parentName");
    const parentPhone = $("#parentPhone");
    if (!parentName || !parentPhone) return;

    const isNew = mode === "new";
    parentName.required = isNew;
    parentPhone.required = isNew;

    if (!isNew) {
      parentName.value = "";
      parentPhone.value = "";
      $("#parentGender") && ($("#parentGender").value = "");
      $("#parentRelation") && ($("#parentRelation").value = "");
      $("#parentEmail") && ($("#parentEmail").value = "");
      $("#parentAddress") && ($("#parentAddress").value = "");
      $("#parentPassword") && ($("#parentPassword").value = "");
    }
  }

  function clearExistingParentSelection() {
    const idEl = $("#existingParentId");
    const searchEl = $("#existingParentSearch");
    const picked = $("#existingParentPicked");
    const results = $("#existingParentResults");

    if (idEl) idEl.value = "";
    if (searchEl) searchEl.value = "";
    if (picked) {
      picked.innerHTML = "";
      hideEl(picked);
    }
    if (results) {
      results.innerHTML = "";
      hideEl(results);
    }
  }

  function updateParentAccountState() {
    const parentOptionEl = $("#parentOption");
    const parentToggle = $("#createParentAccount");
    const parentPass = $("#parentPassword");

    if (!parentPass) return;
    if (!parentPass.name) parentPass.name = "parentPassword";

    const mode = parentOptionEl?.value || "";
    const enabled = mode === "new" && !!parentToggle?.checked;

    parentPass.disabled = !enabled;
    parentPass.required = enabled;

    if (!enabled) parentPass.value = "";
  }

  function initParentOptionUI() {
    const parentOptionEl = $("#parentOption");
    const existingBox = document.querySelector(".sr-parent-existing");
    const newBox = document.querySelector(".sr-parent-new");
    if (!parentOptionEl || !existingBox || !newBox) return;

    function apply() {
      const mode = parentOptionEl.value;

      if (mode === "existing") {
        showEl(existingBox);
        hideEl(newBox);
        setSectionEnabled(existingBox, true);
        setSectionEnabled(newBox, false);

        const t = $("#createParentAccount");
        if (t) t.checked = false;

        setParentRequired("existing");
      } else if (mode === "new") {
        hideEl(existingBox);
        showEl(newBox);
        setSectionEnabled(existingBox, false);
        setSectionEnabled(newBox, true);

        clearExistingParentSelection();
        setParentRequired("new");
      } else {
        hideEl(existingBox);
        hideEl(newBox);
        setSectionEnabled(existingBox, false);
        setSectionEnabled(newBox, false);

        const t = $("#createParentAccount");
        if (t) t.checked = false;

        clearExistingParentSelection();
        setParentRequired("");
      }

      updateParentAccountState();
    }

    parentOptionEl.addEventListener("change", apply);
    $("#createParentAccount")?.addEventListener("change", apply);

    apply();
  }

  /* ===================== Existing parent search ===================== */
  function normalizeParent(item) {
    if (!item || typeof item !== "object") return null;
    const id = item.id ?? item.parent_id ?? item.guardian_id ?? item.user_id;
    if (id == null) return null;

    const full_name =
      item.full_name ?? item.name ?? item.parent_name ?? item.guardian_name ?? "";
    const phone =
      item.phone ?? item.mobile ?? item.parent_phone ?? item.guardian_phone ?? "";
    const email = item.email ?? "";

    return {
      id: String(id),
      full_name: String(full_name || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim()
    };
  }

  function extractList(res) {
    if (Array.isArray(res)) return res;
    if (res?.data && Array.isArray(res.data)) return res.data;
    if (res?.parents && Array.isArray(res.parents)) return res.parents;
    if (res?.guardians && Array.isArray(res.guardians)) return res.guardians;
    if (res?.items && Array.isArray(res.items)) return res.items;
    return [];
  }

  async function searchParents(q) {
    const res = await apiGet(`/api/parents?search=${encodeURIComponent(q)}&limit=10`);
    const list = (Array.isArray(res) ? res : extractList(res))
      .map(normalizeParent)
      .filter(Boolean);

    const seen = new Set();
    const uniq = [];
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      uniq.push(p);
    }
    return uniq.slice(0, 10);
  }

  function initExistingParentSearch() {
    const wrap = $("#existingParentWrap") || document.querySelector(".sr-parent-existing");
    const input = $("#existingParentSearch");
    const idEl = $("#existingParentId");
    const results = $("#existingParentResults");
    const picked = $("#existingParentPicked");
    const clearBtn = $("#existingParentClear");
    const parentOption = $("#parentOption");

    if (!wrap || !input || !idEl || !results || !picked) return;
    if (wrap.dataset.bound === "1") return;
    wrap.dataset.bound = "1";

    function renderResults(list) {
      if (!list.length) {
        results.innerHTML = `<div class="sr-parent-empty">لا توجد نتائج</div>`;
        showEl(results);
        return;
      }

      results.innerHTML = list
        .map((p) => {
          const name = escHtml(p.full_name || "—");
          const phone = escHtml(p.phone || "—");
          const email = p.email ? `<small>${escHtml(p.email)}</small>` : "";
          return `
            <button type="button" class="sr-parent-item" data-id="${escHtml(p.id)}">
              <div class="sr-parent-item-main">
                <b>${name}</b>
                <span class="sr-parent-item-phone">${phone}</span>
              </div>
              ${email}
            </button>
          `;
        })
        .join("");

      showEl(results);
    }

    function setPicked(p) {
      idEl.value = p.id;
      input.value = `${p.full_name}${p.phone ? " — " + p.phone : ""}`;

      picked.innerHTML = `
        <div class="sr-parent-picked-card">
          <div class="sr-parent-picked-title">✅ تم اختيار ولي الأمر</div>
          <div class="sr-parent-picked-row"><b>الاسم:</b> ${escHtml(p.full_name || "—")}</div>
          <div class="sr-parent-picked-row"><b>الهاتف:</b> ${escHtml(p.phone || "—")}</div>
        </div>
      `;
      showEl(picked);
      hideEl(results);
    }

    const doSearch = debounce(async () => {
      if (parentOption?.value !== "existing") return;

      const q = (input.value || "").trim();
      idEl.value = "";
      hideEl(picked);

      if (q.length < 2) {
        results.innerHTML = "";
        hideEl(results);
        return;
      }

      results.innerHTML = `<div class="sr-parent-loading">جاري البحث...</div>`;
      showEl(results);

      try {
        const list = await searchParents(q);
        renderResults(list);
      } catch (e) {
        results.innerHTML = `<div class="sr-parent-empty">فشل البحث: ${escHtml(e.message || "خطأ")}</div>`;
        showEl(results);
      }
    }, 280);

    input.addEventListener("input", doSearch);

    results.addEventListener("click", (e) => {
      const btn = e.target.closest(".sr-parent-item");
      if (!btn) return;

      const name = btn.querySelector("b")?.textContent || "";
      const phone = btn.querySelector(".sr-parent-item-phone")?.textContent || "";
      setPicked({ id: btn.dataset.id, full_name: name, phone });
    });

    clearBtn?.addEventListener("click", () => {
      clearExistingParentSelection();
      input.focus();
    });

    if (!window.__srParentOutsideBound) {
      window.__srParentOutsideBound = true;
      document.addEventListener("click", (e) => {
        const box = $("#existingParentWrap") || document.querySelector(".sr-parent-existing");
        if (!box) return;
        if (!box.contains(e.target)) hideEl(results);
      });
    }
  }

  /* ===================== Accounts toggles ===================== */
  function initAccountToggles() {
    const studentToggle = $("#createStudentAccount");
    const parentToggle = $("#createParentAccount");
    const studentEmail = $("#studentEmail");
    const studentPass = $("#studentPassword");
    const parentPass = $("#parentPassword");

    function updateStudentAccount() {
      if (!studentToggle || !studentEmail || !studentPass) return;
      const enabled = !!studentToggle.checked;

      studentEmail.disabled = !enabled;
      studentPass.disabled = !enabled;

      studentEmail.required = false;
      studentPass.required = enabled;

      if (!enabled) {
        studentEmail.value = "";
        studentPass.value = "";
      }
    }

    function updateParentAccount() {
      updateParentAccountState();
      if (parentPass && parentPass.disabled) parentPass.value = "";
    }

    if (studentToggle) {
      studentToggle.addEventListener("change", updateStudentAccount);
      updateStudentAccount();
    }

    if (parentToggle) {
      parentToggle.addEventListener("change", updateParentAccount);
      updateParentAccount();
    }

    $("#parentOption")?.addEventListener("change", updateParentAccount);
  }

  /* ===================== 🚀 جلب الرقم التلقائي للطالب 🚀 ===================== */
  async function fetchNextStudentCode() {
    const codeInput = $("#studentCode");
    if (!codeInput) return;

    try {
      const res = await apiGet("/api/students/next-code");
      if (res?.data?.nextCode) {
        codeInput.value = res.data.nextCode;
        // codeInput.readOnly = true; // يمكنك تفعيل هذا السطر إذا أردت منع الموظف من تعديل الرقم يدوياً
      }
    } catch (err) {
      console.warn("لم يتم جلب رقم الطالب التلقائي:", err.message);
    }
  }

  /* ===================== Submit ===================== */
  async function registerStudent(e) {
    e.preventDefault();

    const form = $("#studentForm");
    if (!form) return;

    const mode = $("#parentOption")?.value || "";
    if (mode === "existing") {
      const pid = ($("#existingParentId")?.value || "").trim();
      if (!pid) {
        showAlert("error", "اختر ولي أمر موجود من نتائج البحث أولاً.");
        $("#existingParentSearch")?.focus?.();
        return;
      }
    }

    updateParentAccountState();

    if (!form.checkValidity()) {
      showAlert("error", "رجاءً تأكد من تعبئة الحقول المطلوبة.");
      form.reportValidity();
      return;
    }

    const guardian = {
      mode: mode || null,
      existing_id: null,
      full_name: null,
      gender: null,
      phone: null,
      relation: null,
      email: null,
      address: null,
      create_account: false,
      password: null
    };

    if (mode === "existing") {
      guardian.existing_id = $("#existingParentId")?.value || null;
      guardian.create_account = false;
      guardian.password = null;
    } else if (mode === "new") {
      guardian.full_name = $("#parentName")?.value?.trim() || null;
      guardian.gender = $("#parentGender")?.value || null;
      guardian.phone = $("#parentPhone")?.value?.trim() || null;
      guardian.relation = $("#parentRelation")?.value?.trim() || null;
      guardian.email = $("#parentEmail")?.value?.trim() || null;
      guardian.address = $("#parentAddress")?.value?.trim() || null;

      guardian.create_account = $("#createParentAccount")?.checked || false;
      guardian.password = guardian.create_account ? ($("#parentPassword")?.value || null) : null;
    }

    const payload = {
      student: {
        student_code: $("#studentCode")?.value.trim(),
        admission_date: $("#admissionDate")?.value,
        full_name: $("#studentName")?.value.trim(),
        gender: $("#studentGender")?.value,
        birth_date: $("#studentBirth")?.value,
        birth_place: $("#studentBirthPlace")?.value.trim() || null,
        status: $("#studentStatus")?.value || "active",
        address: $("#studentAddress")?.value.trim() || null,
        phone: $("#studentPhone")?.value.trim() || null,
        phone2: $("#studentPhone2")?.value.trim() || null
      },
      academic: {
        academic_year_id: Number($("#academicYear")?.value),
        stage_id: Number($("#studentStage")?.value),
        grade_id: Number($("#studentClass")?.value),
        section_id: $("#sectionType")?.value === "manual" ? Number($("#studentSection")?.value) : null,
        roll_number: $("#rollNumber")?.value.trim() || null
      },
      guardian,
      account: {
        create_student_account: $("#createStudentAccount")?.checked || false,
        email: $("#studentEmail")?.value?.trim() || null,
        password: $("#studentPassword")?.value || null
      }
    };

    try {
      const result = await apiPost("/api/students/register", payload);

      showAlert("success", `✅ تم تسجيل الطالب بنجاح (ID: ${result.student_id || "—"})`);

      form.reset();

      const gradeEl = $("#studentClass");
      const sectionEl = $("#studentSection");
      if (gradeEl) gradeEl.disabled = true;
      if (sectionEl) sectionEl.disabled = true;

      clearExistingParentSelection();

      initSectionType();
      initParentOptionUI();
      initExistingParentSearch();
      initAccountToggles();
      updateParentAccountState();

      // ✅ 🚀 جلب رقم جديد للطالب القادم بعد نجاح التسجيل
      await fetchNextStudentCode();

    } catch (err) {
      showAlert("error", err.message);
    }
  }

  /* ===================== Init ===================== */
  async function initStudentRegisterPage() {
    const form = $("#studentForm");
    if (!form || form.dataset.srInit === "1") return;
    form.dataset.srInit = "1";

    const pp = $("#parentPassword");
    if (pp && !pp.name) pp.name = "parentPassword";

    try {
      await loadAcademicYears();
      await loadStages();
      
      // ✅ 🚀 جلب الرقم التلقائي بمجرد فتح الصفحة
      await fetchNextStudentCode();

    } catch (err) {
      showAlert("error", err.message);
    }

    bindStageToGrades();
    bindGradeToSections();
    initSectionType();
    initParentOptionUI();
    initExistingParentSearch();
    initAccountToggles();

    form.addEventListener("submit", registerStudent);
  }

  document.addEventListener("DOMContentLoaded", initStudentRegisterPage);

  const observer = new MutationObserver(() => initStudentRegisterPage());
  observer.observe(document.body, { childList: true, subtree: true });
})();