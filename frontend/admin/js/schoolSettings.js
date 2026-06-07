(function () {
  "use strict";

 const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");
const SERVER_URL = String(window.API_ORIGIN || window.location.origin).replace(/\/+$/, "");

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;

  const cleanPath = String(path).startsWith("/") ? String(path) : `/${path}`;
  return `${SERVER_URL}${cleanPath}`;
}
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  // دالة مخصصة لإرسال FormData (تُستخدم لرفع الصورة)
async function apiFetchFormData(path, formData) {
  const url = apiUrl(path);
    const r = await fetch(url, {
      method: "POST", // أو PUT حسب الباك إند
      headers: { ...authHeaders() },
      body: formData,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
    return data;
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

    if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
    return data;
  }

  // جرّب أكثر من مسار endpoint (عشان مشروعك فيه أكثر من نسخة routes)
  async function apiTry(paths, opts) {
    let lastErr = null;
    for (const p of paths) {
      try {
        return await apiFetch(p, opts);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("تعذر الاتصال بالـ API");
  }

  function pickRows(res) {
    // يقبل: {data:[...]} أو {data:{data:[...]}} أو [...]
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (Array.isArray(res.data)) return res.data;
    if (res.data && Array.isArray(res.data.data)) return res.data.data;
    if (Array.isArray(res.rows)) return res.rows;
    return [];
  }

function toast(msg, type = "info") {
  if (window.AppUI?.toast) {
    window.AppUI.toast(msg, type);
    return;
  }

  if (window.showToast) return window.showToast(msg);

  console.warn(msg);
}

async function ssConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  console.warn("AppUI.confirm غير متاح");
  return false;
}
function dateOnly(value) {
  return String(value || "").slice(0, 10);
}
async function showWarning(message) {
  await ssConfirm({
    title: "تنبيه",
    message: `⚠️ ${message}`,
    confirmText: "حسنًا",
    cancelText: "إغلاق",
    type: "warning",
  });
}
  function boot() {
    const root = $("#schoolSettingsPage");
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";
    init(root).catch((e) => toast(e.message));
  }

  let META = null;

  // Curriculum state
  let CURR_ACTIVE = new Set();
  let CURR_DIRTY = false;

  // Qualifications (teacher_subjects) state
  let QUAL_TEACHERS = [];
  let QUAL_ACTIVE = new Set();
  let QUAL_DIRTY = false;

  async function init(root) {
    // NAV switching
    $$(".ss-nav-item", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".ss-nav-item", root).forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const key = btn.dataset.target;
        $$(".ss-panel", root).forEach((p) => p.classList.remove("is-active"));
        const panel = $(`.ss-panel[data-panel="${key}"]`, root);
        if (panel) panel.classList.add("is-active");
        const sum = $("#ssSummary", root);
        if (sum) sum.textContent = summaryText(key);

        if (key === "backups") {
          initBackupsSection(root);
        }
      });
    });

    // modal
    $("#ssModalClose", root)?.addEventListener("click", () => closeModal(root));
    $("#ssModal", root)?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "ssModal") closeModal(root);
    });
    bindAcademicTotals(root);
// --- حفظ الإعدادات الأكاديمية ---
    $("#btnSaveAcademic", root)?.addEventListener("click", async () => {
      const btn = $("#btnSaveAcademic", root);
      btn.disabled = true;
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري الحفظ...`;

      try {
        // جمع أيام العمل المختارة من الـ Checkboxes
        const selectedDays = $$('input[name="workDays"]:checked', root).map(el => el.value);

      recalcAcademicTotals(root);

const payload = {
  week_start_day: $("#acadWeekStart", root).value,
  working_days: selectedDays,

  monthly_exam_max: readNumber(root, "#acadMonthlyExamMax", 20),

  midterm_exam_max: readNumber(root, "#acadMidtermExamMax", 30),
  midterm_muhassala_max: readNumber(root, "#acadMidtermMuhassalaMax", 20),
  midterm_max: readNumber(root, "#acadMidMax", 50),
  midterm_pass: readNumber(root, "#acadMidPass", 20),

  final_exam_max: readNumber(root, "#acadFinalExamMax", 30),
  final_muhassala_max: readNumber(root, "#acadFinalMuhassalaMax", 20),
  final_term_max: readNumber(root, "#acadFinalTermMax", 50),
  final_max: readNumber(root, "#acadFinalMax", 100),
  final_pass: readNumber(root, "#acadFinalPass", 50),

  annual_failure_subjects_limit: readPositiveInt(
    root,
    "#acadAnnualFailureSubjectsLimit",
    1
  ),
};
        await apiFetch("/admin/school-settings/academic", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        toast("تم حفظ الإعدادات الأكاديمية بنجاح ✅");
      } catch (error) {
        toast(error.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-save-3-line"></i> حفظ الإعدادات الأكاديمية`;
      }
    });
    $("#ssRefresh", root)?.addEventListener("click", async () => {
      await loadMeta(root, { keepActivePanel: true });
      toast("تم التحديث ✅");
    });

    // ==========================================
    // 🆕 Profile Handlers (إعدادات هوية المدرسة)
    // ==========================================
    const logoInput = $("#profileLogoInput", root);
    const logoPreview = $("#profileLogoPreview", root);
    const logoText = $("#profileLogoText", root);

    // معاينة الصورة قبل الحفظ
    logoInput?.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          if(logoPreview) {
             logoPreview.src = e.target.result;
             logoPreview.style.display = "block";
             if(logoText) logoText.style.display = "none";
          }
        };
        reader.readAsDataURL(file);
      }
    });

    // حفظ التعديلات
    $("#btnSaveProfile", root)?.addEventListener("click", async () => {
        const btn = $("#btnSaveProfile", root);
        btn.disabled = true;
        btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري الحفظ...`;

        try {
            const formData = new FormData();
            formData.append('name_ar', $("#profileNameAr", root)?.value || '');
            formData.append('name_en', $("#profileNameEn", root)?.value || '');
            formData.append('phone', $("#profilePhone", root)?.value || '');
            formData.append('email', $("#profileEmail", root)?.value || '');
            formData.append('address', $("#profileAddress", root)?.value || '');

            const file = logoInput?.files[0];
            if (file) {
                formData.append('logo', file);
            }

            // إرسال البيانات (ستحتاج لإنشاء هذا الراوت في الباك إند لاحقاً)
            const res = await apiFetchFormData("/admin/school-settings/profile", formData);
            
            // تحديث البيانات في LocalStorage لكي ينعكس الشعار في الشريط العلوي فوراً
            const userStr = localStorage.getItem("user");
            if (userStr && res.data) {
                const user = JSON.parse(userStr);
                user.school_name_ar = res.data.name_ar || user.school_name_ar;
                user.logo_url = res.data.logo_url || user.logo_url;
                localStorage.setItem("user", JSON.stringify(user));
                
                // إذا كانت لديك الدالة updateSchoolBranding تعمل في الصفحة، قم بمناداتها هنا (اختياري)
                if(typeof window.setupSchoolBranding === 'function') {
                    window.setupSchoolBranding(); 
                }
            }

            toast("تم تحديث هوية المدرسة بنجاح ✅");
        } catch (error) {
            toast(error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="ri-save-3-line"></i> حفظ التعديلات`;
        }
    });
    // ==========================================


    // Add buttons
    $("#btnAddYear", root)?.addEventListener("click", () => openYearModal(root));
    $("#btnAddStage", root)?.addEventListener("click", () => openStageModal(root));
    $("#btnAddGrade", root)?.addEventListener("click", () => openGradeModal(root));
    $("#btnAddSection", root)?.addEventListener("click", () => openSectionModal(root));
    $("#btnAddSubject", root)?.addEventListener("click", () => openSubjectModal(root));
    $("#btnAddPeriod", root)?.addEventListener("click", () => openPeriodModal(root));

    $("#searchSubjects", root)?.addEventListener("input", () => renderSubjects(root));

    // Curriculum handlers
    $("#curStage", root)?.addEventListener("change", () => {
      fillCurGrades(root);
      clearCurr(root);
    });
    $("#curGrade", root)?.addEventListener("change", async () => {
      await loadCurriculum(root);
    });
    $("#curSearch", root)?.addEventListener("input", () => renderCurriculum(root));
    $("#btnSaveCurr", root)?.addEventListener("click", async () => {
      await saveCurriculum(root);
    });

    $("#fltStageForGrades", root)?.addEventListener("change", () => renderGrades(root));
    $("#fltGradeForSections", root)?.addEventListener("change", () => renderSections(root));

    // Qualifications handlers (وجودها اختياري حسب HTML)
    $("#qualStage", root)?.addEventListener("change", async () => {
      fillQualGrades(root);
      fillSelect($("#qualSubject", root), [{ id: "", name: "اختر المادة" }], "id", "name");
      clearQual(root);
    });

    $("#qualGrade", root)?.addEventListener("change", async () => {
      await fillQualSubjectsFromCurriculum(root);
      clearQual(root);
    });

    $("#qualSubject", root)?.addEventListener("change", async () => {
      await loadQualifications(root);
    });

    $("#qualSearch", root)?.addEventListener("input", () => renderQualifications(root));

    $("#btnSaveQual", root)?.addEventListener("click", async () => {
      await saveQualifications(root);
    });
// --- حفظ الإعدادات المالية والنظام ---
    $("#btnSaveFinance", root)?.addEventListener("click", async () => {
      const btn = $("#btnSaveFinance", root);
      btn.disabled = true;
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري الحفظ...`;

      try {
        const payload = {
          currency: $("#setCurrency", root).value,
          invoice_prefix: $("#setInvoicePrefix", root).value,
          student_prefix: $("#setStudentPrefix", root).value,
          language: $("#setLanguage", root).value
        };

        await apiFetch("/admin/school-settings/finance", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        toast("تم حفظ الإعدادات المالية والنظام بنجاح ✅");
      } catch (error) {
        toast(error.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-save-3-line"></i> حفظ الإعدادات المالية`;
      }
    });
    // --- منطق أزرار التفعيل والتعطيل (البوابات) ---
    const tTeacher = $("#toggleTeacherPortal", root);
    const tParent = $("#toggleParentPortal", root);

    [tTeacher, tParent].forEach(btn => {
        if (btn) {
            btn.addEventListener("click", () => {
                btn.classList.toggle("is-on");
                btn.setAttribute("aria-checked", btn.classList.contains("is-on"));
            });
        }
    });

    // --- حفظ إعدادات البوابات ---
    $("#btnSavePortals", root)?.addEventListener("click", async () => {
      const btn = $("#btnSavePortals", root);
      btn.disabled = true;
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري الحفظ...`;

      try {
        const payload = {
          teacher_portal: tTeacher.classList.contains("is-on"),
          parent_portal: tParent.classList.contains("is-on")
        };
        await apiFetch("/admin/school-settings/portals", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast("تم حفظ صلاحيات البوابات بنجاح ✅");
      } catch (error) {
        toast(error.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-save-3-line"></i> حفظ الصلاحيات`;
      }
    });
    await loadMeta(root, { keepActivePanel: false });
  }
function readNumber(root, selector, fallback = 0) {
  const el = $(selector, root);
  const n = Number(el?.value || fallback);
  return Number.isFinite(n) ? n : fallback;
}
function readPositiveInt(root, selector, fallback = 1) {
  const el = $(selector, root);
  const n = Number(el?.value || fallback);

  if (!Number.isFinite(n)) return fallback;

  const value = Math.trunc(n);
  return value >= 1 ? value : fallback;
}
function setNumber(root, selector, value) {
  const el = $(selector, root);
  if (el) el.value = String(value);
}

function recalcAcademicTotals(root) {
  const midtermExam = readNumber(root, "#acadMidtermExamMax", 30);
  const midtermMuhassala = readNumber(root, "#acadMidtermMuhassalaMax", 20);
  const finalExam = readNumber(root, "#acadFinalExamMax", 30);
  const finalMuhassala = readNumber(root, "#acadFinalMuhassalaMax", 20);

  const midtermTotal = midtermExam + midtermMuhassala;
  const finalTermTotal = finalExam + finalMuhassala;
  const finalTotal = midtermTotal + finalTermTotal;

  setNumber(root, "#acadMidMax", midtermTotal);
  setNumber(root, "#acadFinalTermMax", finalTermTotal);
  setNumber(root, "#acadFinalMax", finalTotal);
}

function bindAcademicTotals(root) {
  [
    "#acadMidtermExamMax",
    "#acadMidtermMuhassalaMax",
    "#acadFinalExamMax",
    "#acadFinalMuhassalaMax",
  ].forEach((selector) => {
    const el = $(selector, root);
    if (el) el.addEventListener("input", () => recalcAcademicTotals(root));
  });

  recalcAcademicTotals(root);
}
  function summaryText(key) {
    const map = {
      profile: "تحديث الشعار والاسم ومعلومات التواصل الخاصة بمدرستك.",
      academic: "ضبط التقويم الدراسي (بداية الأسبوع وأيام العمل) ونظام درجات النجاح والرسوب.",
      years: "إدارة السنوات الدراسية (تفعيل/تعطيل) — يفضّل وجود سنة واحدة فعّالة.",
      stages: "إدارة مراحل المدرسة (ابتدائي/متوسط/ثانوي) مع ترتيبها.",
      grades: "إدارة الصفوف وربطها بالمراحل. يمكن تعطيل الصف بدل الحذف.",
      sections: "إدارة الشعب وربطها بالصفوف (أ/ب/…)، مع السعة.",
      subjects: "إدارة المواد العامة. تعطيل المادة لا يحذفها من الجداول القديمة.",
      periods: "إدارة فترات اليوم (الحصص) المستخدمة في الجدول الأسبوعي.",
      curriculum: "منهج الصفوف: فعّل مواد كل صف. هذه تحدد ما يظهر في تعيين المدرسين.",
      qualifications:
        "تأهيل المدرسين: حدِّد أي المدرسين مسموح لهم بتدريس كل مادة (هذا الذي يحدد من يظهر داخل سيلكت تعيين المدرسين).",
      backups: "إدارة إعدادات النسخ الاحتياطي اليدوي والتلقائي لسجلات المدرسة وقاعدة البيانات.",
    };
    return map[key] || "جاهز ✅";
  }

  async function loadMeta(root, { keepActivePanel } = { keepActivePanel: true }) {
    // حفظ البانل الحالي إن رغبت
    const activeKey =
      keepActivePanel ? ($(".ss-nav-item.is-active", root)?.dataset?.target || "profile") : "profile";

    // 🆕 تعبئة فورم هوية المدرسة من LocalStorage ليكون سريعاً جداً
    const userStr = localStorage.getItem("user");
    if (userStr) {
        const user = JSON.parse(userStr);
        const sName = user.school_name_ar || user.school?.name_ar || "مدرستي";
        
        if($("#profileNameAr", root)) $("#profileNameAr", root).value = sName;
        if($("#profileSlug", root)) $("#profileSlug", root).value = user.school_slug || "";
        
        // جلب الشعار إن وجد
        const logoUrl = user.logo_url || user.school?.logo_url;
        if (logoUrl && $("#profileLogoPreview", root) && $("#profileLogoText", root)) {
const fullLogoUrl = assetUrl(logoUrl);            $("#profileLogoPreview", root).src = fullLogoUrl;
            $("#profileLogoPreview", root).style.display = "block";
            $("#profileLogoText", root).style.display = "none";
        } else if ($("#profileLogoText", root)) {
            $("#profileLogoText", root).textContent = sName.charAt(0);
        }

        // إذا أردت جلب رقم الهاتف والإيميل من الباك إند، يمكنك عمل fetch بسيط هنا لبيانات المدرسة
        // await fillSchoolProfileFromServer(root);
    }

    const r = await apiFetch("/admin/school-settings/meta");
    META = r.data;

    // Counters
    $("#cntYears", root).textContent = META.years?.length || 0;
    $("#cntStages", root).textContent = META.stages?.length || 0;
    $("#cntGrades", root).textContent = META.grades?.length || 0;
    $("#cntSections", root).textContent = META.sections?.length || 0;
    $("#cntSubjects", root).textContent = META.subjects?.length || 0;
    $("#cntPeriods", root).textContent = META.periods?.length || 0;

    // Filters
    fillSelect(
      $("#fltStageForGrades", root),
      [{ id: "", name: "كل المراحل" }, ...(META.stages || [])],
      "id",
      "name"
    );

    fillSelect(
      $("#fltGradeForSections", root),
      [
        { id: "", name: "كل الصفوف" },
        ...(META.grades || []).map((g) => ({
          id: g.id,
          name: `${g.name} (${stageName(g.stage_id)})`,
        })),
      ],
      "id",
      "name"
    );

    // Curriculum dropdowns
    fillSelect(
      $("#curStage", root),
      [{ id: "", name: "اختر المرحلة" }, ...(META.stages || [])],
      "id",
      "name"
    );
    fillSelect($("#curGrade", root), [{ id: "", name: "اختر الصف" }], "id", "name");

    // Qualifications dropdowns (اختياري)
    if ($("#qualStage", root)) {
      fillSelect(
        $("#qualStage", root),
        [{ id: "", name: "اختر المرحلة" }, ...(META.stages || [])],
        "id",
        "name"
      );
      fillSelect($("#qualGrade", root), [{ id: "", name: "اختر الصف" }], "id", "name");
      fillSelect($("#qualSubject", root), [{ id: "", name: "اختر المادة" }], "id", "name");
    }

    // Ensure teachers list for qualifications (مرة واحدة)
    await ensureTeachers(root);

    // Render tables
    renderYears(root);
    renderStages(root);
    renderGrades(root);
    renderSections(root);
    renderSubjects(root);
    renderPeriods(root);

    // Summary + keep active panel
    const navBtn = $(`.ss-nav-item[data-target="${activeKey}"]`, root);
    if (navBtn) navBtn.click();
    else $("#ssSummary", root).textContent = summaryText("profile");

    // --- جلب الإعدادات الأكاديمية الحالية وتعبئتها في الفورم ---
    try {
      const acadRes = await apiFetch("/admin/school-settings/academic");
      if (acadRes.data) {
        const s = acadRes.data;
        // تعبئة المنسدلة والحقول النصية
        if ($("#acadWeekStart", root)) {
            // تحويل الرقم القادم من الداتابيز (0-6) إلى الكلمة المناسبة للمنسدلة
            const daysRevMap = { 6: 'saturday', 0: 'sunday', 1: 'monday' };
            $("#acadWeekStart", root).value = daysRevMap[s.week_start_day] || 'saturday';
        }
    setNumber(root, "#acadMonthlyExamMax", s.monthly_exam_max_grade ?? s.monthly_exam_max ?? 20);
setNumber(root, "#acadMidtermExamMax", s.midterm_exam_max_grade ?? s.midterm_exam_max ?? 30);
setNumber(root, "#acadMidtermMuhassalaMax", s.midterm_muhassala_max_grade ?? s.midterm_muhassala_max ?? 20);
setNumber(root, "#acadMidPass", s.midterm_pass_mark ?? s.midterm_pass ?? 20);
setNumber(root, "#acadFinalExamMax", s.final_exam_max_grade ?? s.final_exam_max ?? 30);
setNumber(root, "#acadFinalMuhassalaMax", s.final_muhassala_max_grade ?? s.final_muhassala_max ?? 20);
setNumber(root, "#acadFinalPass", s.final_pass_mark ?? s.final_pass ?? 50);

setNumber(
  root,
  "#acadAnnualFailureSubjectsLimit",
  s.annual_failure_subjects_limit ??
    s.annualFailureSubjectsLimit ??
    1
);

recalcAcademicTotals(root);
        // تفعيل مربعات الاختيار للأيام (Checkboxes)
        const workingDays = s.working_days || [];
        $$('input[name="workDays"]', root).forEach(cb => {
          cb.checked = workingDays.includes(cb.value);
        });
      }
    } catch (e) {
      console.warn("تعذر جلب الإعدادات الأكاديمية:", e.message);
    }
    // --- جلب الإعدادات المالية الحالية وتعبئتها ---
  // --- ✅ جلب الإعدادات المالية الحالية وتعبئتها (تم التصحيح) ---
    try {
      // الرابط الصحيح الذي أنشأناه في الباك إند
      const financeRes = await apiFetch("/admin/school-settings/finance"); 
      if (financeRes.data) {
          const s = financeRes.data;
          
          // 1. تعبئة بادئة الفواتير
          if ($("#setInvoicePrefix", root)) $("#setInvoicePrefix", root).value = s.invoice_prefix || "";
          
          // 2. تعبئة بادئة الطلاب (التي كانت تختفي)
          if ($("#setStudentPrefix", root)) {
              // نستخدم student_prefix لأن هذا هو الاسم القادم من الباك إند
              $("#setStudentPrefix", root).value = s.student_prefix || "";
          }
          
          // 3. تعبئة اللغة الافتراضية
          if ($("#setLanguage", root)) $("#setLanguage", root).value = s.language || "ar";
          
          // 4. تعبئة العملة
          if ($("#setCurrency", root)) $("#setCurrency", root).value = s.currency || "YER";
      }
    } catch (e) { 
      console.warn("فشل جلب الإعدادات المالية:", e.message); 
    }
// --- جلب حالة البوابات الحالية وتعبئتها ---
    try {
      const portalsRes = await apiFetch("/admin/school-settings/portals");
      if (portalsRes.data) {
          const tTeacher = $("#toggleTeacherPortal", root);
          const tParent = $("#toggleParentPortal", root);
          
          if (tTeacher) {
              if (portalsRes.data.allow_teacher_portal) tTeacher.classList.add("is-on");
              else tTeacher.classList.remove("is-on");
          }
          if (tParent) {
              if (portalsRes.data.allow_parent_portal) tParent.classList.add("is-on");
              else tParent.classList.remove("is-on");
          }
      }
    } catch (e) { console.warn("تعذر جلب إعدادات البوابات", e.message); }

  }

  async function ensureTeachers(root) {
    // لو موجودة بالـ META خلاص
    if (Array.isArray(META?.teachers) && META.teachers.length) {
      QUAL_TEACHERS = META.teachers.slice();
      refreshQualTotals(root);
      return;
    }

    // جرّب جلب المدرسين من أكثر endpoint محتمل
    try {
      const res = await apiTry(
        [
          "/admin/teachers",
          "/admin/teachers/list",
          "/admin/staff/teachers"
        ],
        { method: "GET" }
      );

      const rows = pickRows(res);
      QUAL_TEACHERS = rows.map((t) => ({
        id: Number(t.id),
        full_name: t.full_name || t.name || t.teacher_name || t.username || `Teacher #${t.id}`,
        is_active: t.is_active !== false,
      }));
      META.teachers = QUAL_TEACHERS.slice();
      refreshQualTotals(root);
    } catch (e) {
      // لا نوقف باقي الصفحة
      QUAL_TEACHERS = [];
      refreshQualTotals(root);
    }
  }

  function refreshQualTotals(root) {
    if ($("#qualTotal", root)) $("#qualTotal", root).textContent = String(QUAL_TEACHERS.length || 0);
    if ($("#qualCount", root)) $("#qualCount", root).textContent = String(QUAL_ACTIVE.size || 0);
  }

  function stageName(stageId) {
    const s = (META?.stages || []).find((x) => String(x.id) === String(stageId));
    return s ? s.name : "—";
  }
  function gradeName(gradeId) {
    const g = (META?.grades || []).find((x) => String(x.id) === String(gradeId));
    return g ? g.name : "—";
  }

  function fillSelect(sel, items, valKey, labelKey) {
    if (!sel) return;
    sel.innerHTML = "";
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it[valKey];
      o.textContent = it[labelKey];
      sel.appendChild(o);
    }
  }

  // ---------- RENDER TABLES ----------
  function renderYears(root) {
    const tb = $("#tbYears", root);
    const rows = META?.years || [];
    tb.innerHTML =
      rows
        .map(
          (y) => `
      <tr>
        <td>${y.id}</td>
        <td>${escapeHtml(y.name)}</td>
<td>${escapeHtml(dateOnly(y.start_date))} → ${escapeHtml(dateOnly(y.end_date))}</td>        <td>${y.is_active ? pill("نشط", "ok") : pill("متوقف", "off")}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-year" data-id="${y.id}">تعديل</button>
            <button class="ss-miniBtn ${y.is_active ? "ss-miniBtn--danger" : ""}" data-act="toggle-year" data-id="${y.id}">
              ${y.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="5" class="ss-empty">لا توجد سنوات</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-year") openYearModal(root, META.years.find((x) => x.id === id));
        if (btn.dataset.act === "toggle-year") await toggleItem(root, "years", id);
      });
    });
  }

  function renderStages(root) {
    const tb = $("#tbStages", root);
    const rows = META?.stages || [];
    tb.innerHTML =
      rows
        .map(
          (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.order_index ?? "—"}</td>
        <td>${s.is_active ? pill("نشط", "ok") : pill("متوقف", "off")}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-stage" data-id="${s.id}">تعديل</button>
            <button class="ss-miniBtn ${s.is_active ? "ss-miniBtn--danger" : ""}" data-act="toggle-stage" data-id="${s.id}">
              ${s.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="5" class="ss-empty">لا توجد مراحل</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-stage")
          openStageModal(root, META.stages.find((x) => x.id === id));
        if (btn.dataset.act === "toggle-stage") await toggleItem(root, "stages", id);
      });
    });
  }

  function renderGrades(root) {
    const tb = $("#tbGrades", root);
    const flt = $("#fltStageForGrades", root).value;
    let rows = META?.grades || [];
    if (flt) rows = rows.filter((g) => String(g.stage_id) === String(flt));

    tb.innerHTML =
      rows
        .map(
          (g) => `
      <tr>
        <td>${g.id}</td>
        <td>${escapeHtml(g.name)}</td>
        <td>${escapeHtml(stageName(g.stage_id))}</td>
        <td>${g.order_index ?? "—"}</td>
        <td>${g.is_active ? pill("نشط", "ok") : pill("متوقف", "off")}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-grade" data-id="${g.id}">تعديل</button>
            <button class="ss-miniBtn ${g.is_active ? "ss-miniBtn--danger" : ""}" data-act="toggle-grade" data-id="${g.id}">
              ${g.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="6" class="ss-empty">لا توجد صفوف</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-grade") openGradeModal(root, META.grades.find((x) => x.id === id));
        if (btn.dataset.act === "toggle-grade") await toggleItem(root, "grades", id);
      });
    });
  }

  function renderSections(root) {
    const tb = $("#tbSections", root);
    const flt = $("#fltGradeForSections", root).value;
    let rows = META?.sections || [];
    if (flt) rows = rows.filter((s) => String(s.grade_id) === String(flt));

    tb.innerHTML =
      rows
        .map(
          (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(gradeName(s.grade_id))}</td>
        <td>${s.capacity ?? "—"}</td>
        <td>${s.is_active ? pill("نشط", "ok") : pill("متوقف", "off")}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-section" data-id="${s.id}">تعديل</button>
            <button class="ss-miniBtn ${s.is_active ? "ss-miniBtn--danger" : ""}" data-act="toggle-section" data-id="${s.id}">
              ${s.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="6" class="ss-empty">لا توجد شعب</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-section")
          openSectionModal(root, META.sections.find((x) => x.id === id));
        if (btn.dataset.act === "toggle-section") await toggleItem(root, "sections", id);
      });
    });
  }

  function renderSubjects(root) {
    const tb = $("#tbSubjects", root);
    const q = ($("#searchSubjects", root).value || "").trim().toLowerCase();
    let rows = META?.subjects || [];
    if (q) rows = rows.filter((s) => String(s.name || "").toLowerCase().includes(q));

    tb.innerHTML =
      rows
        .map(
          (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.is_active ? pill("نشط", "ok") : pill("متوقف", "off")}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-subject" data-id="${s.id}">تعديل</button>
            <button class="ss-miniBtn ${s.is_active ? "ss-miniBtn--danger" : ""}" data-act="toggle-subject" data-id="${s.id}">
              ${s.is_active ? "تعطيل" : "تفعيل"}
            </button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="4" class="ss-empty">لا توجد مواد</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-subject")
          openSubjectModal(root, META.subjects.find((x) => x.id === id));
        if (btn.dataset.act === "toggle-subject") await toggleItem(root, "subjects", id);
      });
    });
  }

  function renderPeriods(root) {
    const tb = $("#tbPeriods", root);
    const rows = (META?.periods || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    tb.innerHTML =
      rows
        .map(
          (p) => `
      <tr>
        <td>${p.id}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.start_time)} → ${escapeHtml(p.end_time)}</td>
        <td>${p.sort_order ?? "—"}</td>
        <td>
          <div class="ss-row-actions">
            <button class="ss-miniBtn ss-miniBtn--accent" data-act="edit-period" data-id="${p.id}">تعديل</button>
          </div>
        </td>
      </tr>
    `
        )
        .join("") || `<tr><td colspan="5" class="ss-empty">لا توجد فترات</td></tr>`;

    tb.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        if (btn.dataset.act === "edit-period")
          openPeriodModal(root, META.periods.find((x) => x.id === id));
      });
    });
  }

  // ---------- CURRICULUM ----------
  function fillCurGrades(root) {
    const stageId = Number($("#curStage", root).value || 0);
    const grades = (META?.grades || []).filter((g) => Number(g.stage_id) === stageId);
    fillSelect($("#curGrade", root), [{ id: "", name: "اختر الصف" }, ...grades], "id", "name");
  }

  function clearCurr(root) {
    CURR_ACTIVE = new Set();
    CURR_DIRTY = false;
    $("#btnSaveCurr", root).disabled = true;
    $("#curSubjectsBox", root).innerHTML = `<div class="ss-empty">اختر صفًا…</div>`;
    $("#curCount", root).textContent = "0";
    $("#curTotal", root).textContent = String((META?.subjects || []).length);
  }

  async function loadCurriculum(root) {
    const gradeId = Number($("#curGrade", root).value || 0);
    if (!gradeId) return clearCurr(root);

    const r = await apiFetch(`/admin/school-settings/curriculum?gradeId=${gradeId}`);
    CURR_ACTIVE = new Set((r.data.subject_ids || []).map(Number));
    CURR_DIRTY = false;
    $("#btnSaveCurr", root).disabled = true;
    renderCurriculum(root);
  }

  function renderCurriculum(root) {
    const box = $("#curSubjectsBox", root);
    const q = ($("#curSearch", root).value || "").trim().toLowerCase();
    const subs = (META?.subjects || []).filter((s) => s.is_active);

    const filtered = q ? subs.filter((s) => String(s.name || "").toLowerCase().includes(q)) : subs;

    $("#curTotal", root).textContent = String(subs.length);
    $("#curCount", root).textContent = String(CURR_ACTIVE.size);

    if (!Number($("#curGrade", root).value || 0)) {
      box.innerHTML = `<div class="ss-empty">اختر مرحلة ثم صف…</div>`;
      return;
    }

    if (!filtered.length) {
      box.innerHTML = `<div class="ss-empty">لا توجد نتائج</div>`;
      return;
    }

    box.innerHTML = filtered
      .map((s) => {
        const on = CURR_ACTIVE.has(s.id);
        return `
        <div class="ss-subjectItem" data-subject-id="${s.id}">
          <div>
            <div style="font-weight:900">${escapeHtml(s.name)}</div>
            <div style="opacity:.75;font-size:12px">ID: ${s.id}</div>
          </div>
          <div class="ss-toggle ${on ? "is-on" : ""}" role="switch" aria-checked="${on}"></div>
        </div>
      `;
      })
      .join("");

    box.querySelectorAll(".ss-subjectItem").forEach((card) => {
      const id = Number(card.dataset.subjectId);
      const toggle = card.querySelector(".ss-toggle");
      toggle.addEventListener("click", () => {
        if (CURR_ACTIVE.has(id)) CURR_ACTIVE.delete(id);
        else CURR_ACTIVE.add(id);

        toggle.classList.toggle("is-on");
        CURR_DIRTY = true;
        $("#btnSaveCurr", root).disabled = false;
        $("#curCount", root).textContent = String(CURR_ACTIVE.size);
      });
    });
  }

  async function saveCurriculum(root) {
    const gradeId = Number($("#curGrade", root).value || 0);
    if (!gradeId) return toast("اختر الصف أولًا");

    const subject_ids = Array.from(CURR_ACTIVE);
    await apiFetch("/admin/school-settings/curriculum", {
      method: "POST",
      body: JSON.stringify({ grade_id: gradeId, subject_ids }),
    });

    CURR_DIRTY = false;
    $("#btnSaveCurr", root).disabled = true;
    toast("تم حفظ منهج الصف ✅");

    // refresh meta
    await loadMeta(root, { keepActivePanel: true });

    // restore selections
    const grade = (META?.grades || []).find((g) => Number(g.id) === gradeId);
    if (grade) {
      $(`.ss-nav-item[data-target="curriculum"]`, root)?.click();
      $("#curStage", root).value = String(grade.stage_id || "");
      fillCurGrades(root);
      $("#curGrade", root).value = String(gradeId);
      await loadCurriculum(root);
    }
  }

  // ---------- QUALIFICATIONS (teacher_subjects) ----------
  function fillQualGrades(root) {
    const stageId = Number($("#qualStage", root).value || 0);
    const grades = (META?.grades || []).filter((g) => Number(g.stage_id) === stageId);
    fillSelect($("#qualGrade", root), [{ id: "", name: "اختر الصف" }, ...grades], "id", "name");
  }

  async function fillQualSubjectsFromCurriculum(root) {
    const gradeId = Number($("#qualGrade", root).value || 0);
    if (!gradeId) {
      fillSelect($("#qualSubject", root), [{ id: "", name: "اختر المادة" }], "id", "name");
      return;
    }

    // نجيب مواد هذا الصف من منهج الصفوف
    try {
      const r = await apiFetch(`/admin/school-settings/curriculum?gradeId=${gradeId}`);
      const ids = new Set((r.data.subject_ids || []).map(Number));
      const subs = (META?.subjects || []).filter((s) => s.is_active && ids.has(Number(s.id)));

      fillSelect(
        $("#qualSubject", root),
        [{ id: "", name: "اختر المادة" }, ...subs],
        "id",
        "name"
      );
    } catch (e) {
      // لو فشل، نعرض كل المواد المفعلة
      const subs = (META?.subjects || []).filter((s) => s.is_active);
      fillSelect(
        $("#qualSubject", root),
        [{ id: "", name: "اختر المادة" }, ...subs],
        "id",
        "name"
      );
    }
  }

  function clearQual(root) {
    QUAL_ACTIVE = new Set();
    QUAL_DIRTY = false;
    const btn = $("#btnSaveQual", root);
    if (btn) btn.disabled = true;
    const box = $("#qualTeachersBox", root);
    if (box) box.innerHTML = `<div class="ss-empty">اختر مادة لعرض المدرسين…</div>`;
    refreshQualTotals(root);
  }

  async function loadQualifications(root) {
    const subjectId = Number($("#qualSubject", root)?.value || 0);
    if (!subjectId) return clearQual(root);

    // GET teacher_ids for this subject
    // جرّب endpoints محتملة
    const r = await apiTry(
      [
        `/admin/school-settings/teacher-subjects?subjectId=${subjectId}`,
        `/admin/school-settings/qualifications?subjectId=${subjectId}`,
      ],
      { method: "GET" }
    );

    const teacher_ids = (r?.data?.teacher_ids || r?.data?.teachers || r?.teacher_ids || []).map(Number);
    QUAL_ACTIVE = new Set(teacher_ids);
    QUAL_DIRTY = false;
    $("#btnSaveQual", root).disabled = true;
    renderQualifications(root);
  }

  function renderQualifications(root) {
    const box = $("#qualTeachersBox", root);
    if (!box) return;

    const subjectId = Number($("#qualSubject", root)?.value || 0);
    if (!subjectId) {
      box.innerHTML = `<div class="ss-empty">اختر مادة لعرض المدرسين…</div>`;
      refreshQualTotals(root);
      return;
    }

    const q = ($("#qualSearch", root)?.value || "").trim().toLowerCase();

    // عرض فقط المدرسين النشطين
    let list = (QUAL_TEACHERS || []).filter((t) => t && t.id);
    list = list.filter((t) => t.is_active !== false);

    if (q) {
      list = list.filter((t) => String(t.full_name || "").toLowerCase().includes(q));
    }

    $("#qualTotal", root).textContent = String(list.length || 0);
    $("#qualCount", root).textContent = String(QUAL_ACTIVE.size || 0);

    if (!list.length) {
      box.innerHTML = `<div class="ss-empty">لا يوجد مدرسون مطابقون</div>`;
      return;
    }

    box.innerHTML = list
      .map((t) => {
        const on = QUAL_ACTIVE.has(Number(t.id));
        return `
          <div class="ss-subjectItem" data-teacher-id="${t.id}">
            <div>
              <div style="font-weight:900">${escapeHtml(t.full_name)}</div>
              <div style="opacity:.75;font-size:12px">ID: ${t.id}</div>
            </div>
            <div class="ss-toggle ${on ? "is-on" : ""}" role="switch" aria-checked="${on}"></div>
          </div>
        `;
      })
      .join("");

    box.querySelectorAll(".ss-subjectItem").forEach((card) => {
      const id = Number(card.dataset.teacherId);
      const toggle = card.querySelector(".ss-toggle");
      toggle.addEventListener("click", () => {
        if (QUAL_ACTIVE.has(id)) QUAL_ACTIVE.delete(id);
        else QUAL_ACTIVE.add(id);

        toggle.classList.toggle("is-on");
        QUAL_DIRTY = true;
        const btn = $("#btnSaveQual", root);
        if (btn) btn.disabled = false;
        $("#qualCount", root).textContent = String(QUAL_ACTIVE.size);
      });
    });
  }

  async function saveQualifications(root) {
    const subjectId = Number($("#qualSubject", root)?.value || 0);
    if (!subjectId) return toast("اختر المادة أولًا");

    const teacher_ids = Array.from(QUAL_ACTIVE);

    // POST set teachers for subject
    await apiTry(
      ["/admin/school-settings/teacher-subjects", "/admin/school-settings/qualifications"],
      {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId, teacher_ids }),
      }
    );

    QUAL_DIRTY = false;
    $("#btnSaveQual", root).disabled = true;
    toast("تم حفظ تأهيل المدرسين ✅");

    // تحديث الميتا (اختياري)
    await loadMeta(root, { keepActivePanel: true });

    // إعادة تحميل تأهيل نفس المادة
    $(`.ss-nav-item[data-target="qualifications"]`, root)?.click();
    await loadQualifications(root);
  }

  // ---------- MODALS ----------
  function openModal(root, title, bodyHtml, footHtml) {
    $("#ssModalTitle", root).textContent = title;
    $("#ssModalBody", root).innerHTML = bodyHtml;
    $("#ssModalFoot", root).innerHTML = footHtml;
    $("#ssModal", root).classList.add("is-open");
    $("#ssModal", root).setAttribute("aria-hidden", "false");
  }

  function closeModal(root) {
    $("#ssModal", root).classList.remove("is-open");
    $("#ssModal", root).setAttribute("aria-hidden", "true");
  }

  function openYearModal(root, item = null) {
    const isEdit = !!item;
    openModal(
      root,
      isEdit ? "تعديل سنة" : "إضافة سنة",
      `
      <form class="ss-form" id="fYear">
        <label class="full">اسم السنة
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="مثال: 2025/2026" required />
        </label>
     <label>تاريخ البداية
  <input
    name="start_date"
    type="date"
    value="${escapeAttr(dateOnly(item?.start_date))}"
    required
  />
</label>

<label>تاريخ النهاية
  <input
    name="end_date"
    type="date"
    value="${escapeAttr(dateOnly(item?.end_date))}"
    required
  />
</label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );

    $("#mCancel", root).onclick = () => closeModal(root);
  $("#mSave", root).onclick = async () => {
  const f = $("#fYear", root);

  // تشغيل التحقق الافتراضي للحقول المطلوبة
  if (!f.reportValidity()) return;

  const payload = Object.fromEntries(new FormData(f).entries());

  const name = String(payload.name || "").trim();
  const startDate = String(payload.start_date || "").trim();
  const endDate = String(payload.end_date || "").trim();

  // التأكد من تعبئة جميع الحقول
  if (!name || !startDate || !endDate) {
    await showWarning("يرجى تعبئة اسم السنة وتاريخ البداية وتاريخ النهاية.");
    return;
  }

  // منع الحفظ عندما تكون النهاية قبل البداية أو مساوية لها
  if (endDate <= startDate) {
    await showWarning("تاريخ نهاية السنة الدراسية يجب أن يكون بعد تاريخ البداية.");
    return;
  }

  const btn = $("#mSave", root);
  btn.disabled = true;
  btn.textContent = "جاري الحفظ...";

  try {
    await apiFetch(
      "/admin/school-settings/years" + (isEdit ? `/${item.id}` : ""),
      {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify({
          name,
          start_date: startDate,
          end_date: endDate,
        }),
      }
    );

    closeModal(root);
    await loadMeta(root, { keepActivePanel: true });

    toast(
      isEdit
        ? "تم تعديل السنة الدراسية بنجاح ✅"
        : "تمت إضافة السنة الدراسية بنجاح ✅",
      "success"
    );
  } catch (error) {
    await showWarning(error.message || "تعذر حفظ السنة الدراسية.");
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "حفظ" : "إضافة";
  }
};
  }

  function openStageModal(root, item = null) {
    const isEdit = !!item;
    openModal(
      root,
      isEdit ? "تعديل مرحلة" : "إضافة مرحلة",
      `
      <form class="ss-form" id="fStage">
        <label class="full">اسم المرحلة
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="ابتدائي" required />
        </label>
        <label>الترتيب (order_index)
          <input name="order_index" type="number" value="${escapeAttr(item?.order_index ?? 1)}" required />
        </label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );

    $("#mCancel", root).onclick = () => closeModal(root);
    $("#mSave", root).onclick = async () => {
      const f = $("#fStage", root);
      const fd = Object.fromEntries(new FormData(f).entries());
      const payload = { ...fd, order_index: Number(fd.order_index || 1) };
      await apiFetch("/admin/school-settings/stages" + (isEdit ? `/${item.id}` : ""), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeModal(root);
      await loadMeta(root, { keepActivePanel: true });
      toast("تم ✅");
    };
  }

  function openGradeModal(root, item = null) {
    const isEdit = !!item;

    const stageOptions = (META?.stages || [])
      .map(
        (s) =>
          `<option value="${s.id}" ${String(item?.stage_id) === String(s.id) ? "selected" : ""}>${escapeHtml(
            s.name
          )}</option>`
      )
      .join("");

    openModal(
      root,
      isEdit ? "تعديل صف" : "إضافة صف",
      `
      <form class="ss-form" id="fGrade">
        <label class="full">اسم الصف
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="أول ثانوي" required />
        </label>
        <label>المرحلة
          <select name="stage_id" required>
            ${stageOptions}
          </select>
        </label>
        <label>الترتيب (order_index)
          <input name="order_index" type="number" value="${escapeAttr(item?.order_index ?? 1)}" required />
        </label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );

    $("#mCancel", root).onclick = () => closeModal(root);
    $("#mSave", root).onclick = async () => {
      const f = $("#fGrade", root);
      const fd = Object.fromEntries(new FormData(f).entries());
      const payload = {
        name: fd.name,
        stage_id: Number(fd.stage_id),
        order_index: Number(fd.order_index || 1),
      };

      await apiFetch("/admin/school-settings/grades" + (isEdit ? `/${item.id}` : ""), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeModal(root);
      await loadMeta(root, { keepActivePanel: true });
      toast("تم ✅");
    };
  }

  function openSectionModal(root, item = null) {
    const isEdit = !!item;

    const gradeOptions = (META?.grades || [])
      .map(
        (g) =>
          `<option value="${g.id}" ${String(item?.grade_id) === String(g.id) ? "selected" : ""}>${escapeHtml(
            g.name
          )} (${escapeHtml(stageName(g.stage_id))})</option>`
      )
      .join("");

    openModal(
      root,
      isEdit ? "تعديل شعبة" : "إضافة شعبة",
      `
      <form class="ss-form" id="fSection">
        <label class="full">اسم الشعبة
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="أ" required />
        </label>
        <label class="full">الصف
          <select name="grade_id" required>${gradeOptions}</select>
        </label>
        <label>السعة (اختياري)
          <input name="capacity" type="number" value="${escapeAttr(item?.capacity ?? "")}" placeholder="30" />
        </label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );

    $("#mCancel", root).onclick = () => closeModal(root);
    $("#mSave", root).onclick = async () => {
      const f = $("#fSection", root);
      const fd = Object.fromEntries(new FormData(f).entries());
      const cap = String(fd.capacity || "").trim();
      const payload = {
        name: fd.name,
        grade_id: Number(fd.grade_id),
        capacity: cap === "" ? null : Number(cap),
      };

      await apiFetch("/admin/school-settings/sections" + (isEdit ? `/${item.id}` : ""), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeModal(root);
      await loadMeta(root, { keepActivePanel: true });
      toast("تم ✅");
    };
  }

  function openSubjectModal(root, item = null) {
    const isEdit = !!item;
    openModal(
      root,
      isEdit ? "تعديل مادة" : "إضافة مادة",
      `
      <form class="ss-form" id="fSubject">
        <label class="full">اسم المادة
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="رياضيات" required />
        </label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );
    $("#mCancel", root).onclick = () => closeModal(root);
    $("#mSave", root).onclick = async () => {
      const f = $("#fSubject", root);
      const payload = Object.fromEntries(new FormData(f).entries());
      await apiFetch("/admin/school-settings/subjects" + (isEdit ? `/${item.id}` : ""), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeModal(root);
      await loadMeta(root, { keepActivePanel: true });
      toast("تم ✅");
    };
  }

  function nextPeriodSortOrder() {
    const arr = META?.periods || [];
    const max = arr.reduce((m, p) => Math.max(m, Number(p.sort_order || 0)), 0);
    return max + 1;
  }

  function isSortOrderTaken(sortOrder, excludeId = null) {
    const n = Number(sortOrder);
    if (!Number.isFinite(n)) return false;
    return (META?.periods || []).some((p) => {
      if (excludeId != null && Number(p.id) === Number(excludeId)) return false;
      return Number(p.sort_order) === n;
    });
  }

  function openPeriodModal(root, item = null) {
    const isEdit = !!item;
    const defaultOrder = isEdit ? item?.sort_order ?? 1 : nextPeriodSortOrder();

    openModal(
      root,
      isEdit ? "تعديل فترة" : "إضافة فترة",
      `
      <form class="ss-form" id="fPeriod">
        <label class="full">اسم الفترة
          <input name="name" value="${escapeAttr(item?.name || "")}" placeholder="الحصة الأولى" required />
        </label>
        <label>وقت البداية
          <input name="start_time" type="time" value="${escapeAttr(item?.start_time || "")}" required />
        </label>
        <label>وقت النهاية
          <input name="end_time" type="time" value="${escapeAttr(item?.end_time || "")}" required />
        </label>
        <label class="full">الترتيب (sort_order)
          <input name="sort_order" type="number" value="${escapeAttr(defaultOrder)}" required />
        </label>
      </form>
      `,
      `
      <button class="ss-btn ss-btn-ghost" id="mCancel">إلغاء</button>
      <button class="ss-btn ss-btn-primary" id="mSave">${isEdit ? "حفظ" : "إضافة"}</button>
      `
    );
    $("#mCancel", root).onclick = () => closeModal(root);
    $("#mSave", root).onclick = async () => {
      const f = $("#fPeriod", root);
      const fd = Object.fromEntries(new FormData(f).entries());
      const sort_order = Number(fd.sort_order || 1);

      // ✅ منع تكرار sort_order قبل الإرسال (لتفادي خطأ unique)
      if (isSortOrderTaken(sort_order, isEdit ? item.id : null)) {
        return toast("الترتيب مستخدم بالفعل. غيّر sort_order لتجنب التكرار.");
      }

      const payload = {
        name: fd.name,
        start_time: fd.start_time,
        end_time: fd.end_time,
        sort_order,
      };

      await apiFetch("/admin/school-settings/periods" + (isEdit ? `/${item.id}` : ""), {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeModal(root);
      await loadMeta(root, { keepActivePanel: true });
      toast("تم ✅");
    };
  }

  let backupPage = 1;
  const backupLimit = 10;

  async function initBackupsSection(root) {
    if (root.dataset.backupsInited === "1") {
      await loadBackupSettings(root);
      await loadBackupLogs(root, 1);
      return;
    }
    root.dataset.backupsInited = "1";

    const tAuto = $("#toggleAutoBackup", root);
    if (tAuto) {
      tAuto.addEventListener("click", () => {
        tAuto.classList.toggle("is-on");
        tAuto.setAttribute("aria-checked", tAuto.classList.contains("is-on"));
      });
    }

    const freqSelect = $("#backupFreq", root);
    if (freqSelect) {
      freqSelect.addEventListener("change", () => {
        const freq = freqSelect.value;
        $("#fieldBackupDay", root).style.display = freq === "weekly" ? "block" : "none";
        $("#fieldBackupInterval", root).style.display = freq === "custom" ? "block" : "none";
        $("#fieldBackupTime", root).style.display = (freq === "hourly" || freq === "custom") ? "none" : "block";
      });
    }

    $("#btnSaveBackupSettings", root)?.addEventListener("click", async () => {
      const btn = $("#btnSaveBackupSettings", root);
      btn.disabled = true;
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري الحفظ...`;
      try {
        const payload = {
          auto_backup_enabled: tAuto.classList.contains("is-on"),
          auto_backup_frequency: $("#backupFreq", root).value,
          auto_backup_day: parseInt($("#backupDay", root).value || 0, 10),
          auto_backup_interval_hours: parseInt($("#backupInterval", root).value || 24, 10),
          auto_backup_time: $("#backupTime", root).value || "02:00",
          backup_path: $("#backupPath", root).value || "backups",
          keep_backups_count: parseInt($("#backupKeepCount", root).value || 10, 10),
        };
        await apiFetch("/admin/backups/settings", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        toast("تم حفظ إعدادات النسخ الاحتياطي بنجاح ✅");
        await loadBackupSettings(root);
      } catch (err) {
        toast("فشل حفظ الإعدادات: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-save-3-line"></i> حفظ الإعدادات التلقائية`;
      }
    });

    $("#btnRunManualBackup", root)?.addEventListener("click", async () => {
      const btn = $("#btnRunManualBackup", root);
      btn.disabled = true;
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> جاري النسخ...`;
      try {
        await apiFetch("/admin/backups/run-manual", { method: "POST" });
        toast("تم إنشاء النسخة الاحتياطية بنجاح ✅");
        await loadBackupSettings(root);
        await loadBackupLogs(root, 1);
      } catch (err) {
        toast("فشل النسخ الاحتياطي: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ri-database-2-line"></i> إنشاء نسخة احتياطية الآن`;
      }
    });

    // لم نعد نقبل رفع ملف SQL من المتصفح مباشرةً.
    // تتم الاستعادة من نسخة محفوظة وموثقة ضمن سجل المدرسة فقط.
    const restoreInput = $("#restoreBackupFile", root);
    const triggerBtn = $("#btnTriggerRestoreBackup", root);
    const restoreMode = $("#restoreMode", root);

    if (restoreInput) restoreInput.style.display = "none";
    if (triggerBtn) triggerBtn.style.display = "none";
    if (restoreMode) restoreMode.style.display = "none";

    $("#btnPrevBackupPage", root)?.addEventListener("click", async () => {
      if (backupPage > 1) {
        backupPage--;
        await loadBackupLogs(root, backupPage);
      }
    });

    $("#btnNextBackupPage", root)?.addEventListener("click", async () => {
      backupPage++;
      await loadBackupLogs(root, backupPage);
    });

    // ربط أحداث مستعرض المجلدات بالسيرفر
    $("#btnBrowseBackupPath", root)?.addEventListener("click", () => openDirPicker(root));
    $("#backupPath", root)?.addEventListener("click", () => openDirPicker(root));
    $("#btnDirPickerClose", root)?.addEventListener("click", () => closeDirPicker(root));
    $("#btnDirPickerCancel", root)?.addEventListener("click", () => closeDirPicker(root));
    $("#btnDirPickerSelect", root)?.addEventListener("click", () => {
      if (selectedDirPath) {
        if ($("#backupPath", root)) {
          $("#backupPath", root).value = selectedDirPath;
        }
        closeDirPicker(root);
      }
    });
    // يتم ضبط سلوك زر Google Drive داخل checkGoogleDriveConnection
    // حتى لا يعمل الربط والفصل معًا عند الضغط على الزر.
    // 🟢 فحص حالة الربط مع قوقل درايف فوراً عند فتح تبويب النسخ الاحتياطي
    await checkGoogleDriveConnection(root);
    await loadBackupSettings(root);
    await loadBackupLogs(root, 1);
  }

  let selectedDirPath = "";

  async function openDirPicker(root) {
    const modal = $("#dirPickerModal", root);
    if (!modal) return;
    
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    
    let initialPath = $("#backupPath", root).value || "";
    if (initialPath === "backups") {
      initialPath = "";
    }
    
    await loadDirectory(root, initialPath);
  }

  function closeDirPicker(root) {
    const modal = $("#dirPickerModal", root);
    if (modal) {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  async function loadDirectory(root, path) {
    try {
      const url = `/admin/backups/browse-directories` + (path ? `?path=${encodeURIComponent(path)}` : '');
      const res = await apiFetch(url);
      if (res && res.data) {
        const d = res.data;
        selectedDirPath = d.currentPath;
        
        if ($("#dirPickerCurrentPath", root)) {
          $("#dirPickerCurrentPath", root).value = d.currentPath;
        }
        
        const btnUp = $("#btnDirPickerUp", root);
        if (btnUp) {
          btnUp.disabled = !d.parentPath;
          btnUp.onclick = d.parentPath ? () => loadDirectory(root, d.parentPath) : null;
        }
        
        const listContainer = $("#dirPickerList", root);
        if (listContainer) {
          listContainer.innerHTML = "";
          
          if (d.directories.length === 0) {
            listContainer.innerHTML = `<div class="ss-empty">لا توجد مجلدات فرعية في هذا المسار</div>`;
          } else {
            d.directories.forEach(dir => {
              const item = document.createElement("div");
              item.className = "dir-item";
              item.innerHTML = `<i class="ri-folder-fill"></i> <span>${escapeHtml(dir.name)}</span>`;
              item.addEventListener("click", () => {
                loadDirectory(root, dir.path);
              });
              listContainer.appendChild(item);
            });
          }
        }
        
        const drivesBox = $("#dirPickerDrivesBox", root);
        const drivesContainer = $("#dirPickerDrives", root);
        if (drivesBox && drivesContainer) {
          if (d.drives && d.drives.length > 0) {
            drivesBox.style.display = "flex";
            drivesContainer.innerHTML = "";
            d.drives.forEach(drive => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "ss-btn ss-btn-ghost ss-btn-sm";
              btn.style.padding = "4px 8px";
              btn.style.fontSize = "12px";
              btn.innerHTML = `<i class="ri-drive-line"></i> ${drive}`;
              btn.addEventListener("click", () => {
                loadDirectory(root, drive);
              });
              drivesContainer.appendChild(btn);
            });
          } else {
            drivesBox.style.display = "none";
          }
        }
      }
    } catch (err) {
      toast("خطأ أثناء تصفح المجلدات: " + err.message);
    }
  }

  async function loadBackupSettings(root) {
    try {
      const res = await apiFetch("/admin/backups/settings");
      if (res && res.data) {
        const s = res.data;
        const tAuto = $("#toggleAutoBackup", root);
        if (tAuto) {
          if (s.auto_backup_enabled) tAuto.classList.add("is-on");
          else tAuto.classList.remove("is-on");
          tAuto.setAttribute("aria-checked", s.auto_backup_enabled);
        }
        
        if ($("#backupFreq", root)) $("#backupFreq", root).value = s.auto_backup_frequency || "daily";
        if ($("#backupDay", root)) $("#backupDay", root).value = String(s.auto_backup_day ?? 0);
        if ($("#backupInterval", root)) $("#backupInterval", root).value = String(s.auto_backup_interval_hours ?? 24);
        
        if ($("#backupTime", root)) {
          let t = s.auto_backup_time || "02:00:00";
          $("#backupTime", root).value = t.slice(0, 5);
        }
        
        if ($("#backupPath", root)) $("#backupPath", root).value = s.backup_path || "backups";
        if ($("#backupKeepCount", root)) $("#backupKeepCount", root).value = String(s.keep_backups_count ?? 10);
        
        $("#backupFreq", root)?.dispatchEvent(new Event("change"));

        const summary = $("#lastBackupSummary", root);
        if (summary) {
          if (s.last_backup_status) {
            summary.style.display = "block";
            const statusEl = $("#lastBackupStatus", root);
            if (statusEl) {
              if (s.last_backup_status === "success") {
                statusEl.innerHTML = pill("نجاح ✅", "ok");
              } else {
                statusEl.innerHTML = pill("فشل ❌", "off");
              }
            }
            if ($("#lastBackupTime", root)) {
              $("#lastBackupTime", root).textContent = new Date(s.last_backup_at).toLocaleString('ar-YE');
            }
            if ($("#lastBackupSize", root)) {
              $("#lastBackupSize", root).textContent = s.last_backup_path ? pathBasename(s.last_backup_path) : "—";
            }
            
            const errorInfo = $("#lastBackupErrorInfo", root);
            if (errorInfo) {
              if (s.last_backup_status === "failed" && s.last_backup_error) {
                errorInfo.style.display = "block";
                errorInfo.textContent = "السبب: " + s.last_backup_error;
              } else {
                errorInfo.style.display = "none";
              }
            }
          } else {
            summary.style.display = "none";
          }
        }
      }
    } catch (e) {
      console.warn("Could not load backup settings", e.message);
    }
  }

  function pathBasename(p) {
    if (!p) return "";
    return p.split(/[\\/]/).pop();
  }

  async function downloadBackupFile(backupId) {
    const response = await fetch(
      apiUrl(`/admin/backups/download/${backupId}`),
      {
        method: "GET",
        headers: {
          ...authHeaders()
        }
      }
    );

    if (!response.ok) {
      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      throw new Error(
        data?.error ||
        data?.message ||
        `تعذر تحميل النسخة الاحتياطية (HTTP ${response.status})`
      );
    }

    const blob = await response.blob();
    const disposition =
      response.headers.get("content-disposition") || "";

    const utf8Match = disposition.match(
      /filename\*=UTF-8''([^;]+)/i
    );

    const plainMatch = disposition.match(
      /filename="?([^";]+)"?/i
    );

    const fileName = decodeURIComponent(
      utf8Match?.[1] ||
      plainMatch?.[1] ||
      `school-backup-${backupId}.sql`
    );

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(objectUrl);
  }

  async function restoreSavedBackup(root, backupId) {
    const confirmed = await ssConfirm({
      title: "استعادة نسخة احتياطية",
      message:
        "سيتم إنشاء نسخة أمان تلقائيًا للحالة الحالية، ثم استعادة النسخة المختارة لهذه المدرسة فقط. هل تريد المتابعة؟",
      confirmText: "نعم، استعد النسخة",
      cancelText: "إلغاء",
      type: "warning"
    });

    if (!confirmed) return;

    try {
      const result = await apiFetch(
        `/admin/backups/${backupId}/restore`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );

      toast(
        result?.message ||
        "تمت استعادة نسخة المدرسة بنجاح ✅"
      );

      await loadBackupSettings(root);
      await loadBackupLogs(root, 1);

      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (error) {
      toast(
        "فشلت عملية الاستعادة: " + error.message
      );
    }
  }

  function getBackupTypeMeta(type) {
    if (type === "manual") {
      return {
        label: "يدوي",
        cssClass: "ss-pill--ok"
      };
    }

    if (type === "auto") {
      return {
        label: "تلقائي",
        cssClass: "ss-pill--off"
      };
    }

    if (type === "restore") {
      return {
        label: "استعادة",
        cssClass: ""
      };
    }

    return {
      label: escapeHtml(type || "غير معروف"),
      cssClass: ""
    };
  }

  async function loadBackupLogs(root, page) {
    try {
      const res = await apiFetch(
        `/admin/backups/logs?page=${page}&limit=${backupLimit}`
      );

      const tb = $("#tbBackupLogs", root);

      if (!tb) return;

      const rows = pickRows(res);

      const pag =
        res.pagination ||
        {
          page: 1,
          limit: backupLimit,
          total: 0,
          totalPages: 1
        };

      backupPage = pag.page;

      if (rows.length === 0) {
        tb.innerHTML =
          `<tr><td colspan="6" class="ss-empty">لا توجد سجلات نسخ احتياطي</td></tr>`;
      } else {
        tb.innerHTML = rows
          .map((log) => {
            const typeMeta =
              getBackupTypeMeta(log.backup_type);

            const isRestorableBackup =
              log.status === "success" &&
              (
                log.backup_type === "manual" ||
                log.backup_type === "auto"
              );

            const timeStr = new Date(
              log.started_at
            ).toLocaleString("ar-YE");

            const sizeStr = log.file_size
              ? formatBytes(log.file_size)
              : "—";

            let statusPill = "";

            if (log.status === "success") {
              statusPill =
                `<span class="ss-pill ss-pill--ok">نجاح ✅</span>`;
            } else if (log.status === "failed") {
              statusPill =
                `<span class="ss-pill ss-pill--off" style="cursor:pointer;" title="${escapeAttr(log.error_message || "")}">فشل ❌</span>`;
            } else {
              statusPill =
                `<span class="ss-pill" style="background:var(--accent);color:#fff;">جاري التشغيل...</span>`;
            }

            let actions = "—";

            if (isRestorableBackup) {
              actions = `
                <button class="ss-miniBtn ss-miniBtn--accent" data-act="download-backup" data-id="${log.id}">تحميل</button>
                <button class="ss-miniBtn" data-act="restore-backup" data-id="${log.id}">استعادة</button>
                <button class="ss-miniBtn ss-miniBtn--danger" data-act="delete-backup" data-id="${log.id}">حذف</button>
              `;
            } else if (log.status === "failed") {
              actions = `
                <button class="ss-miniBtn" data-act="show-error" data-error="${escapeAttr(log.error_message || "")}">التفاصيل</button>
                <button class="ss-miniBtn ss-miniBtn--danger" data-act="delete-backup" data-id="${log.id}">حذف</button>
              `;
            } else if (log.backup_type === "restore") {
              actions = `
                <button class="ss-miniBtn ss-miniBtn--danger" data-act="delete-backup" data-id="${log.id}">حذف السجل</button>
              `;
            }

            return `
              <tr>
                <td><span class="ss-pill ${typeMeta.cssClass}">${typeMeta.label}</span></td>
                <td>${timeStr}</td>
                <td>${sizeStr}</td>
                <td>${statusPill}</td>
                <td>${escapeHtml(log.created_by_name || "النظام")}</td>
                <td>
                  <div class="ss-row-actions">
                    ${actions}
                  </div>
                </td>
              </tr>
            `;
          })
          .join("");

        tb
          .querySelectorAll("[data-act]")
          .forEach((btn) => {
            btn.addEventListener("click", async () => {
              const id = btn.dataset.id;

              if (
                btn.dataset.act ===
                "download-backup"
              ) {
                try {
                  await downloadBackupFile(id);
                } catch (error) {
                  toast(
                    "فشل التحميل: " +
                    error.message
                  );
                }
              }

              if (
                btn.dataset.act ===
                "restore-backup"
              ) {
                await restoreSavedBackup(
                  root,
                  id
                );
              }

              if (
                btn.dataset.act ===
                "delete-backup"
              ) {
                const confirmed =
                  await ssConfirm({
                    title:
                      "حذف النسخة الاحتياطية",
                    message:
                      "هل أنت متأكد من حذف ملف وسجل هذه النسخة نهائيًا؟",
                    confirmText:
                      "حذف نهائي",
                    cancelText: "إلغاء",
                    type: "danger"
                  });

                if (confirmed) {
                  try {
                    await apiFetch(
                      `/admin/backups/${id}`,
                      {
                        method: "DELETE"
                      }
                    );

                    toast(
                      "تم حذف النسخة الاحتياطية بنجاح ✅"
                    );

                    await loadBackupLogs(
                      root,
                      backupPage
                    );

                    await loadBackupSettings(
                      root
                    );
                  } catch (error) {
                    toast(
                      "فشل الحذف: " +
                      error.message
                    );
                  }
                }
              }

              if (
                btn.dataset.act ===
                "show-error"
              ) {
                window.AppUI?.alert({
                  title: "تفاصيل الخطأ",
                  message:
                    btn.dataset.error ||
                    "لا توجد تفاصيل خطأ",
                  type: "error",
                });
              }
            });
          });
      }

      if ($("#backupPaginationText", root)) {
        $("#backupPaginationText", root).textContent =
          `عرض الصفحة ${pag.page} من ${pag.totalPages} (إجمالي ${pag.total} سجل)`;
      }

      const btnPrev =
        $("#btnPrevBackupPage", root);

      const btnNext =
        $("#btnNextBackupPage", root);

      if (btnPrev) {
        btnPrev.disabled = pag.page <= 1;
      }

      if (btnNext) {
        btnNext.disabled =
          pag.page >= pag.totalPages;
      }
    } catch (error) {
      console.warn(
        "Could not load backup logs",
        error.message
      );
    }
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
  function connectGoogleDrive() {
    const token = localStorage.getItem("token");

    if (!token) {
      toast("انتهت جلسة الدخول. سجّل الدخول مجددًا.");
      return;
    }

    // متوافق مع مسار OAuth الحالي في المشروع.
    // يفضّل لاحقًا استبدال token بحالة OAuth قصيرة العمر.
    window.location.href = apiUrl(
      `/public/auth/google?token=${encodeURIComponent(token)}`
    );
  }

  // فحص حالة الربط مع Google Drive وتحديث المؤشر مرئيًا
  async function checkGoogleDriveConnection(root) {
    try {
      const res = await apiFetch(
        "/admin/backups/google-drive-status"
      );

      const statusSpan =
        $("#gDriveStatus", root);

      const linkBtn =
        $("#btnLinkGoogleDrive", root);

      if (res?.connected) {
        if (statusSpan) {
          statusSpan.textContent =
            `متصل 🟢 (${res.email})`;

          statusSpan.style.color =
            "#22c55e";
        }

        if (linkBtn) {
          linkBtn.innerHTML =
            '<i class="ri-link-unlink"></i> إلغاء ربط الحساب';

          linkBtn.style.background =
            "#ef4444";

          linkBtn.onclick = () =>
            disconnectGoogleDrive(root);
        }

        return;
      }

      if (statusSpan) {
        statusSpan.textContent =
          "غير متصل";

        statusSpan.style.color = "";
      }

      if (linkBtn) {
        linkBtn.innerHTML =
          '<i class="ri-google-line"></i> ربط Google Drive';

        linkBtn.style.background = "";

        linkBtn.onclick =
          connectGoogleDrive;
      }
    } catch (error) {
      console.warn(
        "تعذر جلب حالة Google Drive السحابية:",
        error.message
      );
    }
  }

  // 🟢 دالة فصل الحساب السحابي وإلغاء الربط بأمان
  async function disconnectGoogleDrive(root) {
    const ok = await ssConfirm({
      title: "فصل حساب Google Drive",
      message: "هل أنت متأكد من فصل حساب Google Drive الخاص بالمدرسة؟ سيتوقف الرفع السحابي التلقائي فوراً.",
      confirmText: "نعم، افصل الحساب",
      cancelText: "إلغاء",
      type: "danger"
    });
    
    if (!ok) return;
    
    try {
      await apiFetch("/admin/backups/google-drive-disconnect", { method: "POST" });
      toast("تم فصل الحساب السحابي بنجاح ✅");
      window.location.reload();
    } catch (err) {
      toast("فشل إلغاء ربط الحساب: " + err.message);
    }
  }
  // ---------- ACTIONS ----------
async function toggleItem(root, type, id) {
  const labels = {
    years: "السنة الدراسية",
    stages: "المرحلة",
    grades: "الصف",
    sections: "الشعبة",
    subjects: "المادة",
    periods: "الفترة",
  };

  const label = labels[type] || "العنصر";

  const ok = await ssConfirm({
    title: `تفعيل / تعطيل ${label}`,
    message:
      `سيتم تغيير حالة ${label} رقم #${id}.\n` +
      "التعطيل لا يحذف البيانات القديمة، لكنه يمنع استخدامها كعنصر نشط في النظام.",
    confirmText: "تأكيد التغيير",
    cancelText: "إلغاء",
    type: "warning",
  });

  if (!ok) return;

  await apiFetch(`/admin/school-settings/${type}/${id}/toggle`, {
    method: "PATCH",
  });

  await loadMeta(root, { keepActivePanel: true });
  toast("تم تحديث الحالة بنجاح ✅", "success");
}

  function pill(text, kind) {
    const cls = kind === "ok" ? "ss-pill ss-pill--ok" : "ss-pill ss-pill--off";
    return `<span class="${cls}">${text}</span>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("\n", " ");
  }

  // boot for injected pages
  document.addEventListener("DOMContentLoaded", boot);
  new MutationObserver(boot).observe(document.body, { childList: true, subtree: true });
})();
// منع تغيير حقول الأرقام عند تمرير عجلة الماوس
document.addEventListener(
  "wheel",
  function (e) {
    if (e.target && e.target.matches("input[type='number']")) {
      e.target.blur();
    }
  },
  { passive: true }
);
