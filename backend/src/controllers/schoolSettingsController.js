import {
  metaAll,
  updateSchoolProfile,
  createYear, updateYear, toggleYear,
  createStage, updateStage, toggleStage,
  createGrade, updateGrade, toggleGrade,
  createSection, updateSection, toggleSection,
  createSubject, updateSubject, toggleSubject,
  createPeriod, updatePeriod, togglePeriod,
  getCurriculum, setCurriculum,
  getPortalsSettings,
  updatePortalsSettings,
  updateFinanceSettings,
  getFinanceSettings,      // ✅ أضفنا استيراد دالة الجلب هنا
  getTeacherSubjectTeachers,
  setTeacherSubjectTeachers,
  getAcademicSettings,
  updateAcademicSettings,
} from "../modules/schoolSettingsModel.js";

function reqStr(v) { return String(v ?? "").trim(); }
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function mustId(v) {
  const n = toInt(v);
  return n && n > 0 ? n : null;
}
/**
 * تحويل التاريخ إلى رقم يمثل اليوم فقط دون التأثر بالمنطقة الزمنية.
 * تقبل الدالة:
 * 2026-06-06
 * أو:
 * 2026-06-06T00:00:00.000Z
 */
function toDateOnlyTimestamp(value) {
  const text = reqStr(value);

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  // التأكد من أن التاريخ حقيقي، وليس مثل 2026-02-31
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function validateYearDates(startDate, endDate) {
  const startTimestamp = toDateOnlyTimestamp(startDate);
  const endTimestamp = toDateOnlyTimestamp(endDate);

  if (startTimestamp === null || endTimestamp === null) {
    return "صيغة تاريخ بداية السنة أو نهايتها غير صحيحة";
  }

  if (endTimestamp <= startTimestamp) {
    return "تاريخ نهاية السنة الدراسية يجب أن يكون بعد تاريخ البداية";
  }

  return null;
}
/* =========================
    FINANCE & SYSTEM SETTINGS
========================= */

// ✅ دالة جديدة لجلب الإعدادات المالية (البادئة والعملة) لكي تظهر في المربعات
export async function financeGet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const data = await getFinanceSettings(schoolId);
    return res.json({ data });
  } catch (e) {
    console.error("financeGet error:", e);
    return res.status(500).json({ error: e.message });
  }
}

export async function financeUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const payload = {
      currency: reqStr(req.body.currency),
      invoice_prefix: reqStr(req.body.invoice_prefix),
      student_prefix: reqStr(req.body.student_prefix), // هذه هي البادئة (Sep)
      language: reqStr(req.body.language)
    };

    const row = await updateFinanceSettings(schoolId, payload);
    return res.json({ message: "تم تحديث الإعدادات المالية بنجاح ✅", data: row });
  } catch (e) {
    console.error("financeUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل التحديث" });
  }
}

/* =========================
    PORTALS SETTINGS
========================= */
export async function portalsGet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const data = await getPortalsSettings(schoolId);
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export async function portalsUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const payload = {
      teacher_portal: Boolean(req.body.teacher_portal),
      parent_portal: Boolean(req.body.parent_portal)
    };
    const row = await updatePortalsSettings(schoolId, payload);
    return res.json({ message: "تم تحديث صلاحيات البوابات بنجاح ✅", data: row });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

/* =========================
    SCHOOL PROFILE (هوية المدرسة)
========================= */
export async function profileUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const payload = {
      name_ar: reqStr(req.body.name_ar),
      name_en: reqStr(req.body.name_en),
      phone: reqStr(req.body.phone),
      email: reqStr(req.body.email),
      address: reqStr(req.body.address),
      logo_url: req.file ? `/uploads/${req.file.filename}` : null 
    };

    const row = await updateSchoolProfile(schoolId, payload);
    if (!row) return res.status(404).json({ error: "المدرسة غير موجودة" });

    return res.json({ 
      message: "تم تحديث بيانات المدرسة بنجاح ✅", 
      data: row 
    });
  } catch (e) {
    console.error("profileUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل التحديث" });
  }
}

/* باقي الدوال (meta, years, stages... إلخ) تبقى كما هي بدون تغيير */
/* ... (أكمل بقية الملف كما هو لديك) ... */
/* =========================
   META
========================= */
export async function meta(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const data = await metaAll(schoolId);
    return res.json({ data });
  } catch (e) {
    console.error("schoolSettings meta error:", e);
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}

/* =========================
   YEARS
========================= */
export async function yearsCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const name = reqStr(req.body.name);
    const start_date = reqStr(req.body.start_date);
    const end_date = reqStr(req.body.end_date);

    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    const dateError = validateYearDates(start_date, end_date);

    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    const row = await createYear(schoolId, {
      name,
      start_date,
      end_date
    });

    return res.status(201).json({
      message: "تمت إضافة السنة الدراسية بنجاح ✅",
      data: row
    });
  } catch (e) {
    console.error("yearsCreate error:", e);

    return res.status(400).json({
      error: e.message || "فشل إنشاء السنة الدراسية"
    });
  }
}

export async function yearsUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const id = mustId(req.params.id);
    const name = reqStr(req.body.name);
    const start_date = reqStr(req.body.start_date);
    const end_date = reqStr(req.body.end_date);

    if (!id || !name || !start_date || !end_date) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    const dateError = validateYearDates(start_date, end_date);

    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    const row = await updateYear(schoolId, id, {
      name,
      start_date,
      end_date
    });

    if (!row) {
      return res.status(404).json({ error: "السنة الدراسية غير موجودة" });
    }

    return res.json({
      message: "تم تعديل السنة الدراسية بنجاح ✅",
      data: row
    });
  } catch (e) {
    console.error("yearsUpdate error:", e);

    return res.status(400).json({
      error: e.message || "فشل تعديل السنة الدراسية"
    });
  }
}

export async function yearsToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await toggleYear(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("yearsToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   STAGES
========================= */
export async function stagesCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const name = reqStr(req.body.name);
    const order_index = toInt(req.body.order_index) ?? 1;

    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });

    const row = await createStage(schoolId, { name, order_index });
    return res.json({ data: row });
  } catch (e) {
    console.error("stagesCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function stagesUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    const name = reqStr(req.body.name);
    const order_index = toInt(req.body.order_index) ?? 1;

    if (!id || !name) return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await updateStage(schoolId, id, { name, order_index });
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("stagesUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function stagesToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await toggleStage(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("stagesToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   GRADES
========================= */
export async function gradesCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const stage_id = mustId(req.body.stage_id);
    const name = reqStr(req.body.name);
    const order_index = toInt(req.body.order_index) ?? 1;

    if (!stage_id || !name) return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await createGrade(schoolId, { stage_id, name, order_index });
    return res.json({ data: row });
  } catch (e) {
    console.error("gradesCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function gradesUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    const stage_id = mustId(req.body.stage_id);
    const name = reqStr(req.body.name);
    const order_index = toInt(req.body.order_index) ?? 1;

    if (!id || !stage_id || !name) return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await updateGrade(schoolId, id, { stage_id, name, order_index });
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("gradesUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function gradesToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await toggleGrade(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("gradesToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   SECTIONS
========================= */
export async function sectionsCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const grade_id = mustId(req.body.grade_id);
    const name = reqStr(req.body.name);

    const capRaw = req.body.capacity;
    const capacity = (capRaw === "" || capRaw === null || capRaw === undefined) ? "" : toInt(capRaw);

    if (!grade_id || !name) return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await createSection(schoolId, { grade_id, name, capacity: capacity ?? "" });
    return res.json({ data: row });
  } catch (e) {
    console.error("sectionsCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function sectionsUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    const grade_id = mustId(req.body.grade_id);
    const name = reqStr(req.body.name);

    const capRaw = req.body.capacity;
    const capacity = (capRaw === "" || capRaw === null || capRaw === undefined) ? "" : toInt(capRaw);

    if (!id || !grade_id || !name) return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await updateSection(schoolId, id, { grade_id, name, capacity: capacity ?? "" });
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("sectionsUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function sectionsToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await toggleSection(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("sectionsToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   SUBJECTS
========================= */
export async function subjectsCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const name = reqStr(req.body.name);
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });

    const row = await createSubject(schoolId, { name });
    return res.json({ data: row });
  } catch (e) {
    console.error("subjectsCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function subjectsUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    const name = reqStr(req.body.name);

    if (!id || !name) return res.status(400).json({ error: "الاسم مطلوب" });

    const row = await updateSubject(schoolId, id, { name });
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("subjectsUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function subjectsToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await toggleSubject(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("subjectsToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   PERIODS
========================= */
export async function periodsCreate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const name = reqStr(req.body.name);
    const start_time = reqStr(req.body.start_time);
    const end_time = reqStr(req.body.end_time);

    const sort_order = req.body.sort_order;

    if (!name || !start_time || !end_time)
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await createPeriod(schoolId, { name, start_time, end_time, sort_order });
    return res.json({ data: row });
  } catch (e) {
    console.error("periodsCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function periodsUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    const name = reqStr(req.body.name);
    const start_time = reqStr(req.body.start_time);
    const end_time = reqStr(req.body.end_time);
    const sort_order = req.body.sort_order;

    if (!id || !name || !start_time || !end_time)
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });

    const row = await updatePeriod(schoolId, id, { name, start_time, end_time, sort_order });
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("periodsUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function periodsToggle(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const id = mustId(req.params.id);
    if (!id) return res.status(400).json({ error: "ID مطلوب" });

    const row = await togglePeriod(schoolId, id);
    if (!row) return res.status(404).json({ error: "غير موجود" });

    return res.json({ data: row });
  } catch (e) {
    console.error("periodsToggle error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

/* =========================
   CURRICULUM
========================= */
export async function curriculumGet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const gradeId = mustId(req.query.gradeId);
    if (!gradeId) return res.status(400).json({ error: "gradeId مطلوب" });

    const subject_ids = await getCurriculum(schoolId, gradeId);
    return res.json({ data: { grade_id: gradeId, subject_ids } });
  } catch (e) {
    console.error("curriculumGet error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function curriculumSet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const grade_id = mustId(req.body.grade_id);

    const subject_ids = Array.isArray(req.body.subject_ids)
      ? req.body.subject_ids.map(Number).filter(Number.isFinite)
      : [];

    if (!grade_id) return res.status(400).json({ error: "grade_id مطلوب" });

    await setCurriculum(schoolId, { grade_id, subject_ids });
    return res.json({ message: "تم حفظ المنهج ✅" });
  } catch (e) {
    console.error("curriculumSet error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}
export async function academicGet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    const data = await getAcademicSettings(schoolId);
    return res.json({ data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export async function academicUpdate(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const daysMap = {
      saturday: 6,
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,

      sat: 6,
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
    };

    const weekStartNum = daysMap[req.body.week_start_day] ?? 6;

    const annualFailureSubjectsLimit =
      toInt(
        req.body.annual_failure_subjects_limit ??
          req.body.annualFailureSubjectsLimit
      ) || 1;

    const payload = {
      week_start_day: weekStartNum,
      working_days: Array.isArray(req.body.working_days)
        ? req.body.working_days
        : [],

      monthly_exam_max: toInt(req.body.monthly_exam_max) || 20,

      midterm_exam_max: toInt(req.body.midterm_exam_max) || 30,
      midterm_muhassala_max: toInt(req.body.midterm_muhassala_max) || 20,
      midterm_max: toInt(req.body.midterm_max) || 50,
      midterm_pass: toInt(req.body.midterm_pass) || 20,

      final_exam_max: toInt(req.body.final_exam_max) || 30,
      final_muhassala_max: toInt(req.body.final_muhassala_max) || 20,
      final_term_max: toInt(req.body.final_term_max) || 50,
      final_max: toInt(req.body.final_max) || 100,
      final_pass: toInt(req.body.final_pass) || 50,

      annual_failure_subjects_limit:
        annualFailureSubjectsLimit > 0 ? annualFailureSubjectsLimit : 1,
    };

    const row = await updateAcademicSettings(schoolId, payload);

    return res.json({
      message: "تم تحديث الإعدادات الأكاديمية بنجاح ✅",
      data: row,
    });
  } catch (e) {
    console.error("academicUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل التحديث" });
  }
}
/* =========================
   Teacher Qualifications (teacher_subjects)
========================= */
export async function teacherSubjectGet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const subjectId = mustId(req.query.subjectId);
    if (!subjectId) return res.status(400).json({ error: "subjectId مطلوب" });

    const teacher_ids = await getTeacherSubjectTeachers(schoolId, subjectId);
    return res.json({ data: { subject_id: subjectId, teacher_ids } });
  } catch (e) {
    console.error("teacherSubjectGet error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}

export async function teacherSubjectSet(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ error: "غير مصرح" });

    const subject_id = mustId(req.body.subject_id);
    const teacher_ids = Array.isArray(req.body.teacher_ids)
      ? req.body.teacher_ids.map(Number).filter(Number.isFinite)
      : [];

    if (!subject_id) return res.status(400).json({ error: "subject_id مطلوب" });

    await setTeacherSubjectTeachers(schoolId, { subject_id, teacher_ids });
    return res.json({ message: "تم حفظ تأهيل المدرسين ✅" });
  } catch (e) {
    console.error("teacherSubjectSet error:", e);
    return res.status(400).json({ error: e.message || "فشل" });
  }
}