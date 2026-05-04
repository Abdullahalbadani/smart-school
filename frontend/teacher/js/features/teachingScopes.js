// teacher/features/teachingScopes.js
(function () {
  "use strict";

  // ✅ Safe local $ (IDs only)
  const $ = (id) => document.getElementById(id);

  // ✅ Safe apiGet (منع ReferenceError)
  const apiGet =
    window.apiGet ||
    window.TeacherAPI?.get ||
    (async () => {
      throw new Error("apiGet غير موجود. تأكد أن core/api.js محمّل قبل teachingScopes.js");
    });

  // ✅ Safe escapeHtml (لو مش موجودة عالميًا)
  const escapeHtml =
    typeof window.escapeHtml === "function"
      ? window.escapeHtml
      : (str) =>
          String(str ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

  const TT_LS_YEAR = "TT_YEAR_ID";
  const TT_LS_TERM = "TT_TERM";

  function getYearTermForTeacher() {
    const yearId = Number(localStorage.getItem(TT_LS_YEAR) || 1);
    const term = Number(localStorage.getItem(TT_LS_TERM) || 1);
    return { yearId, term };
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ===== periods meta =====
  let __PERIODS_META = null;
  let __PERIODS_LOADED = false;

  async function ensurePeriodsMeta() {
    if (__PERIODS_LOADED) return Array.isArray(__PERIODS_META) ? __PERIODS_META : [];
    __PERIODS_LOADED = true;
    try {
      const r = await apiGet("/teacher/timetables/meta");
      const meta = r?.data || r || {};
      const periods = meta?.periods || meta?.data?.periods || [];
      __PERIODS_META = Array.isArray(periods) ? periods : [];
    } catch {
      __PERIODS_META = [];
    }
    return Array.isArray(__PERIODS_META) ? __PERIODS_META : [];
  }

  async function ensureLessonSelectOptions(selectEl, placeholder = "اختر الحصة") {
    if (!selectEl) return;

    const hasMetaOptions = Array.from(selectEl.options || []).some(
      (o) => o && o.dataset && typeof o.dataset.lesson !== "undefined"
    );
    if (hasMetaOptions) return;

    const periods = (await ensurePeriodsMeta()).slice().sort((a, b) => {
      const aa = Number(a.sort_order || a.order || a.lesson || a.id || 0);
      const bb = Number(b.sort_order || b.order || b.lesson || b.id || 0);
      return aa - bb;
    });

    if (!periods.length) return;

    selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;

    periods.forEach((p) => {
      const id = p.id ?? p.period_id ?? p.value;
      const lessonNo = Number(p.sort_order || p.order || p.lesson || id || 0);
      const name = p.name || `الحصة ${lessonNo || id}`;
      const st = String(p.start_time || "").slice(0, 5);
      const en = String(p.end_time || "").slice(0, 5);
      const time = st && en ? ` (${st}-${en})` : "";

      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = String(name) + time;
      opt.dataset.lesson = String(lessonNo || id);
      selectEl.appendChild(opt);
    });
  }

  // ✅ تعديل: يحافظ على القيمة السابقة + يعطل عند عدم وجود حصص
  async function filterLessonsByTeacherDay(selectEl, scope, dateOverride) {
    if (!selectEl) return;

    const prevValue = String(selectEl.value || "");

    const dateVal =
      String(dateOverride || "").slice(0, 10) ||
      String($("att-date")?.value || "").slice(0, 10) ||
      String($("ls-date")?.value || "").slice(0, 10) ||
      todayISO();

    if (!dateVal) return;

    if (!scope?.sectionId || !scope?.subjectId) {
      selectEl.innerHTML = `<option value="">اختر الشعبة والمادة أولاً</option>`;
      selectEl.disabled = true;
      return;
    }

    const jsDay = new Date(dateVal + "T00:00:00").getDay();
    const mapToSchoolDay = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
    const dayId = mapToSchoolDay[jsDay];
    if (!dayId) return;

    const { yearId, term } = getYearTermForTeacher();

    const periodsMeta = (await ensurePeriodsMeta()).slice();
    const periodById = new Map(periodsMeta.map((p) => [String(p.id), p]));

    const pickPeriodId = (e) => Number(e?.period_id ?? e?.periodId ?? e?.period ?? 0);

    try {
      const r = await apiGet(
        `/teacher/timetables?academicYearId=${encodeURIComponent(yearId)}&term=${encodeURIComponent(
          term
        )}&day=${encodeURIComponent(dayId)}&sectionId=${encodeURIComponent(
          scope.sectionId
        )}&subjectId=${encodeURIComponent(scope.subjectId)}`
      );

      let entries = r?.data?.entries || r?.entries || [];
      if (!Array.isArray(entries)) entries = [];

      entries = entries.filter((e) => {
        const d = Number(e?.day_of_week ?? e?.day_id ?? e?.day ?? 0);
        return !d || d === dayId;
      });

      if (!entries.length) {
        selectEl.innerHTML = `<option value="">لا توجد حصص لك هذا اليوم</option>`;
        selectEl.disabled = true;
        return;
      }

      const uniq = new Map();
      for (const e of entries) {
        const pid = pickPeriodId(e);
        if (!pid) continue;
        if (!uniq.has(pid)) uniq.set(pid, { periodId: pid });
      }

      const lessons = Array.from(uniq.values()).sort((a, b) => {
        const pa = periodById.get(String(a.periodId));
        const pb = periodById.get(String(b.periodId));
        const oa = Number(pa?.sort_order ?? pa?.order ?? pa?.lesson ?? pa?.id ?? a.periodId);
        const ob = Number(pb?.sort_order ?? pb?.order ?? pb?.lesson ?? pb?.id ?? b.periodId);
        return oa - ob;
      });

      selectEl.disabled = false;
      selectEl.innerHTML =
        `<option value="">اختر الحصة</option>` +
        lessons
          .map((l) => {
            const p = periodById.get(String(l.periodId));
            const lessonNo = Number(p?.sort_order ?? p?.order ?? p?.lesson ?? p?.id ?? l.periodId);
            const name = p?.name || `الحصة ${lessonNo}`;
            const st = String(p?.start_time || "").slice(0, 5);
            const en = String(p?.end_time || "").slice(0, 5);
            const time = st && en ? ` (${st}-${en})` : "";
            return `<option value="${l.periodId}" data-lesson="${lessonNo}">${escapeHtml(
              name + time
            )}</option>`;
          })
          .join("");

      if (prevValue && Array.from(selectEl.options).some((o) => String(o.value) === prevValue)) {
        selectEl.value = prevValue;
      }
    } catch (e) {
      console.warn("lesson filtering failed:", e);
      selectEl.innerHTML = `<option value="">تعذر جلب حصص اليوم</option>`;
      selectEl.disabled = true;
    }
  }

  // ===== Attendance meta =====
  let __ATT_META = null;
  let __ATT_META_LOADED = false;

  async function ensureAttendanceMeta() {
    if (__ATT_META_LOADED) return __ATT_META || { reasons: [] };
    __ATT_META_LOADED = true;
    try {
      const r = await apiGet("/teacher/attendance/meta");
      const data = r?.data || r || {};
      __ATT_META = { reasons: Array.isArray(data.reasons) ? data.reasons : [] };
    } catch {
      __ATT_META = { reasons: [] };
    }

    try {
      window.TeachingScopes.__ATT_META = __ATT_META;
    } catch {}

    return __ATT_META || { reasons: [] };
  }

  // ===== Teaching scopes picker =====
  const __TEACHING_CACHE = { key: "", rows: [], loaded: false };

  async function loadTeachingScopes() {
    const { yearId, term } = getYearTermForTeacher();
    const key = `${yearId}-${term}`;
    if (__TEACHING_CACHE.loaded && __TEACHING_CACHE.key === key) return __TEACHING_CACHE.rows;

    try {
      const r = await apiGet(
        `/teacher/attendance/scopes?academicYearId=${encodeURIComponent(yearId)}&term=${encodeURIComponent(term)}`
      );
      const rows = r?.data?.scopes || r?.scopes || r?.data || [];
      __TEACHING_CACHE.key = key;
      __TEACHING_CACHE.rows = Array.isArray(rows) ? rows : [];
      __TEACHING_CACHE.loaded = true;
      return __TEACHING_CACHE.rows;
    } catch {
      try {
        const r2 = await apiGet(
          `/teacher/timetables/students/scopes?academicYearId=${encodeURIComponent(yearId)}&term=${encodeURIComponent(
            term
          )}`
        );
        const rows2 = r2?.data?.scopes || r2?.scopes || r2?.data || [];
        __TEACHING_CACHE.key = key;
        __TEACHING_CACHE.rows = Array.isArray(rows2) ? rows2 : [];
        __TEACHING_CACHE.loaded = true;
        return __TEACHING_CACHE.rows;
      } catch {
        __TEACHING_CACHE.key = key;
        __TEACHING_CACHE.rows = [];
        __TEACHING_CACHE.loaded = true;
        return [];
      }
    }
  }

  function uniqBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr || []) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, x);
    }
    return Array.from(m.values());
  }

  function setOptions(sel, items, placeholder, valueKey, labelKey) {
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    (items || []).forEach((x) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeHtml(x[valueKey])}">${escapeHtml(x[labelKey])}</option>`
      );
    });
    sel.disabled = !(items && items.length);
  }

  function hasOption(sel, v) {
    if (!sel) return false;
    return Array.from(sel.options).some((o) => String(o.value) === String(v));
  }

  function saveScope(prefix, obj) {
    try {
      localStorage.setItem(`teacher_scope_${prefix}`, JSON.stringify(obj || {}));
    } catch {}
  }

  function readScope(prefix) {
    try {
      return JSON.parse(localStorage.getItem(`teacher_scope_${prefix}`) || "{}") || {};
    } catch {
      return {};
    }
  }

  function initTeachingPicker(prefix) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);

    if (!stageSel || !gradeSel || !sectionSel || !subjectSel) return;

    const getKey = () => {
      const { yearId, term } = getYearTermForTeacher();
      return `${yearId}-${term}`;
    };

    const currentKey = getKey();

    // ✅ FIX: لا تعيد applyFromCache كل مرة (هذا كان يرجع الفلاتر)
    if (stageSel.dataset.inited === "1") {
      const oldKey = stageSel.dataset.tsKey || "";
      const hasStages = (stageSel.options?.length || 0) > 1;

      // فقط إذا تغيّر year/term أو الخيارات فاضية
      if ((oldKey && oldKey !== currentKey) || !hasStages) {
        if (typeof stageSel.__applyFromCache === "function") stageSel.__applyFromCache();
      }
      return;
    }

    stageSel.dataset.inited = "1";

    const applyFromCache = async () => {
      const scopes = await loadTeachingScopes();
      stageSel.dataset.tsKey = getKey(); // ✅ FIX: لا تستخدم currentKey القديم

      const stages = uniqBy(scopes, (x) => String(x.stage_id)).map((x) => ({
        id: x.stage_id,
        name: x.stage_name || `Stage ${x.stage_id}`,
      }));
      setOptions(stageSel, stages, "اختر المرحلة", "id", "name");

      gradeSel.innerHTML = `<option value="">اختر الصف</option>`;
      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      gradeSel.disabled = true;
      sectionSel.disabled = true;
      subjectSel.disabled = true;

      if (!stages.length) return;

      const saved = readScope(prefix);

      if (stageSel.value && hasOption(stageSel, stageSel.value)) {
        // اتركها
      } else if (saved.stageId && hasOption(stageSel, saved.stageId)) {
        stageSel.value = String(saved.stageId);
      } else {
        stageSel.value = String(stages[0].id);
      }

      stageSel.dispatchEvent(new Event("change"));
    };

    stageSel.__applyFromCache = applyFromCache;

    stageSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;

      const grades = uniqBy(
        scopes.filter((x) => String(x.stage_id) === String(stageId)),
        (x) => String(x.grade_id)
      ).map((x) => ({ id: x.grade_id, name: x.grade_name || `Grade ${x.grade_id}` }));

      setOptions(gradeSel, grades, "اختر الصف", "id", "name");

      sectionSel.innerHTML = `<option value="">اختر الشعبة</option>`;
      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      sectionSel.disabled = true;
      subjectSel.disabled = true;

      const saved = readScope(prefix);
      if (saved.gradeId && hasOption(gradeSel, saved.gradeId)) gradeSel.value = String(saved.gradeId);
      else if (grades.length) gradeSel.value = String(grades[0].id);
      else gradeSel.value = "";

      saveScope(prefix, { stageId: stageSel.value, gradeId: gradeSel.value, sectionId: "", subjectId: "" });
      gradeSel.dispatchEvent(new Event("change"));
    });

    gradeSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;
      const gradeId = gradeSel.value;

      const sections = uniqBy(
        scopes.filter((x) => String(x.stage_id) === String(stageId) && String(x.grade_id) === String(gradeId)),
        (x) => String(x.section_id)
      ).map((x) => ({ id: x.section_id, name: x.section_name || `Section ${x.section_id}` }));

      setOptions(sectionSel, sections, "اختر الشعبة", "id", "name");

      subjectSel.innerHTML = `<option value="">اختر المادة</option>`;
      subjectSel.disabled = true;

      const saved = readScope(prefix);
      if (saved.sectionId && hasOption(sectionSel, saved.sectionId)) sectionSel.value = String(saved.sectionId);
      else if (sections.length) sectionSel.value = String(sections[0].id);
      else sectionSel.value = "";

      saveScope(prefix, { stageId, gradeId, sectionId: sectionSel.value, subjectId: "" });
      sectionSel.dispatchEvent(new Event("change"));
    });

    sectionSel.addEventListener("change", async () => {
      const scopes = await loadTeachingScopes();
      const stageId = stageSel.value;
      const gradeId = gradeSel.value;
      const sectionId = sectionSel.value;

      const subjects = uniqBy(
        scopes.filter(
          (x) =>
            String(x.stage_id) === String(stageId) &&
            String(x.grade_id) === String(gradeId) &&
            String(x.section_id) === String(sectionId)
        ),
        (x) => String(x.subject_id)
      ).map((x) => ({ id: x.subject_id, name: x.subject_name || `Subject ${x.subject_id}` }));

      setOptions(subjectSel, subjects, "اختر المادة", "id", "name");

      const saved = readScope(prefix);
      if (saved.subjectId && hasOption(subjectSel, saved.subjectId)) subjectSel.value = String(saved.subjectId);
      else if (subjects.length) subjectSel.value = String(subjects[0].id);
      else subjectSel.value = "";

      saveScope(prefix, { stageId, gradeId, sectionId, subjectId: subjectSel.value });
    });

    subjectSel.addEventListener("change", () => {
      saveScope(prefix, {
        stageId: stageSel.value,
        gradeId: gradeSel.value,
        sectionId: sectionSel.value,
        subjectId: subjectSel.value,
      });
    });

    applyFromCache();
  }

  function getTeachingScope(prefix) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);
    return {
      stageId: Number(stageSel?.value || 0),
      gradeId: Number(gradeSel?.value || 0),
      sectionId: Number(sectionSel?.value || 0),
      subjectId: Number(subjectSel?.value || 0),

      stageName: stageSel?.selectedOptions?.[0]?.textContent || "",
      gradeName: gradeSel?.selectedOptions?.[0]?.textContent || "",
      sectionName: sectionSel?.selectedOptions?.[0]?.textContent || "",
      subjectName: subjectSel?.selectedOptions?.[0]?.textContent || "",
    };
  }

  function setTeachingScope(prefix, scope) {
    const stageSel = $(`${prefix}-stage`);
    const gradeSel = $(`${prefix}-grade`);
    const sectionSel = $(`${prefix}-section`);
    const subjectSel = $(`${prefix}-subject`);
    if (!stageSel || !gradeSel || !sectionSel || !subjectSel) return;

    if (scope.stageId && hasOption(stageSel, scope.stageId)) stageSel.value = String(scope.stageId);
    stageSel.dispatchEvent(new Event("change"));

    setTimeout(() => {
      if (scope.gradeId && hasOption(gradeSel, scope.gradeId)) gradeSel.value = String(scope.gradeId);
      gradeSel.dispatchEvent(new Event("change"));

      setTimeout(() => {
        if (scope.sectionId && hasOption(sectionSel, scope.sectionId)) sectionSel.value = String(scope.sectionId);
        sectionSel.dispatchEvent(new Event("change"));

        setTimeout(() => {
          if (scope.subjectId && hasOption(subjectSel, scope.subjectId)) subjectSel.value = String(scope.subjectId);
          subjectSel.dispatchEvent(new Event("change"));
        }, 0);
      }, 0);
    }, 0);
  }

  function hookAttendanceLessonFiltering() {
    const dateInput = $("att-date");
    const sectionSel = $("att-section");
    const subjectSel = $("att-subject");
    const lessonSel = $("att-lesson");

    const run = async () => {
      await filterLessonsByTeacherDay(lessonSel, getTeachingScope("att"), String(dateInput?.value || "").slice(0, 10));
    };

    dateInput?.addEventListener("change", run);
    sectionSel?.addEventListener("change", run);
    subjectSel?.addEventListener("change", run);
  }

  // ===== Attendance Context (lock UI) =====
  const ATT_CTX_KEY = "teacher_att_active_ctx";
  let __ATT_CTX = null;

  function saveAttCtx(ctx) {
    __ATT_CTX = ctx || null;
    try {
      if (ctx) localStorage.setItem(ATT_CTX_KEY, JSON.stringify(ctx));
      else localStorage.removeItem(ATT_CTX_KEY);
    } catch {}
  }

  function loadAttCtx() {
    if (__ATT_CTX) return __ATT_CTX;
    try {
      const raw = localStorage.getItem(ATT_CTX_KEY);
      if (!raw) return null;
      __ATT_CTX = JSON.parse(raw) || null;
      return __ATT_CTX;
    } catch {
      return null;
    }
  }

  function lockAttendancePickers(lock) {
    const d = $("att-date");
    const lesson = $("att-lesson");

    const st = $("att-stage");
    const gr = $("att-grade");
    const sec = $("att-section");
    const sub = $("att-subject");

    if (d) {
      d.disabled = !!lock;
      d.readOnly = !!lock;
      d.style.pointerEvents = lock ? "none" : "";
    }
    if (lesson) {
      lesson.disabled = !!lock;
      lesson.style.pointerEvents = lock ? "none" : "";
    }

    [st, gr, sec, sub].forEach((el) => {
      if (!el) return;
      el.disabled = !!lock;
      el.style.pointerEvents = lock ? "none" : "";
      el.style.opacity = lock ? ".9" : "";
    });
  }

  // ✅ FIX: استخدم filterLessonsByTeacherDay بدل ensureLessonSelectOptions
  async function applyAttCtxToUI(ctx) {
    if (!ctx) {
      lockAttendancePickers(false);
      return;
    }

    if (ctx.scope) {
      initTeachingPicker("att");
      setTeachingScope("att", ctx.scope);
      await delay(120);
    }

    const d = $("att-date");
    if (d && ctx.date) d.value = String(ctx.date).slice(0, 10);

    const lesson = $("att-lesson");
    if (lesson) {
      await filterLessonsByTeacherDay(lesson, getTeachingScope("att"), ctx.date);
      if (ctx.periodId) lesson.value = String(ctx.periodId);
    }

    lockAttendancePickers(true);
  }

  // ✅ تُستدعى من modals.js
  window.__loadTeacherTeachingScopes = async () => {
    initTeachingPicker("att");
    initTeachingPicker("ls");
    ensureAttendanceMeta().catch(() => {});

    hookAttendanceLessonFiltering();

    setTimeout(() => {
      filterLessonsByTeacherDay(
        $("att-lesson"),
        getTeachingScope("att"),
        String($("att-date")?.value || "").slice(0, 10)
      );
    }, 0);

    const savedCtx = loadAttCtx();
    if (savedCtx) {
      applyAttCtxToUI(savedCtx).catch(() => {});
    } else {
      lockAttendancePickers(false);
    }
  };

  window.TeachingScopes = {
    getYearTermForTeacher,
    todayISO,
    ensurePeriodsMeta,
    ensureLessonSelectOptions,
    filterLessonsByTeacherDay,
    ensureAttendanceMeta,
    loadTeachingScopes,
    initTeachingPicker,
    getTeachingScope,
    setTeachingScope,
    hookAttendanceLessonFiltering,
    saveAttCtx,
    loadAttCtx,
    lockAttendancePickers,
    applyAttCtxToUI,
    get ATT_META() {
      return __ATT_META;
    },
  };
})();
