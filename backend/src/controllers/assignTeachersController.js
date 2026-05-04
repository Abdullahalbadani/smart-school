// src/controllers/assignTeachersController.js
import {
  getAssignMeta,
  getSectionGradeId,
  getGradeSubjects,
  getSectionAssignments,
  getEligibleTeachersBySubjects,
  upsertSectionAssignments,
} from "../modules/assignTeachersModel.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function meta(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const data = await getAssignMeta(schoolId);
    return res.json({ data });
  } catch (e) {
    console.error("assignTeachers meta error:", e);
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}

export async function sectionView(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const academicYearId = toInt(req.query.academicYearId);
    const term = toInt(req.query.term);
    const sectionId = toInt(req.query.sectionId);

    if (!academicYearId || !term || !sectionId) {
      return res.status(400).json({
        error: "جميع الحقول مطلوبة (السنة/الترم/الشعبة)",
      });
    }

    const sec = await getSectionGradeId(schoolId, sectionId);
    if (!sec) {
      return res.status(404).json({ error: "الشعبة غير موجودة داخل هذه المدرسة" });
    }

    const gradeSubjects = await getGradeSubjects(schoolId, sec.grade_id);
    const subjectIds = gradeSubjects.map((x) => x.subject_id);

    const current = await getSectionAssignments({
      schoolId,
      academicYearId,
      term,
      sectionId,
    });

    const eligible = await getEligibleTeachersBySubjects(schoolId, subjectIds);

    const curMap = new Map(current.map((x) => [x.subject_id, x]));

    const eligMap = new Map();
    for (const row of eligible) {
      const k = row.subject_id;
      if (!eligMap.has(k)) eligMap.set(k, []);
      eligMap.get(k).push({
        id: row.teacher_id,
        full_name: row.full_name,
      });
    }

    const rows = gradeSubjects.map((s) => {
      const cur = curMap.get(s.subject_id) || null;
      const list = eligMap.get(s.subject_id) || [];

      return {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        assigned_teacher_id: cur?.teacher_id ?? null,
        assigned_teacher_name: cur?.teacher_name ?? null,
        assigned_teacher_is_active: cur?.teacher_is_active ?? null,
        status: cur?.status ?? "active",
        eligible_teachers: list,
      };
    });

    return res.json({
      data: {
        section: {
          id: sec.id,
          name: sec.name,
          grade_id: sec.grade_id,
        },
        rows,
      },
    });
  } catch (e) {
    console.error("assignTeachers sectionView error:", e);
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
}

export async function saveSection(req, res) {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const academicYearId = toInt(req.body.academic_year_id);
    const term = toInt(req.body.term);
    const sectionId = toInt(req.body.section_id);
    const assignments = Array.isArray(req.body.assignments)
      ? req.body.assignments
      : [];

    if (!academicYearId || !term || !sectionId) {
      return res.status(400).json({
        error: "جميع الحقول مطلوبة (السنة/الترم/الشعبة)",
      });
    }

    if (!assignments.length) {
      return res.status(400).json({
        error: "لا توجد تعيينات للحفظ",
      });
    }

    const rows = assignments.map((a) => ({
      subject_id: toInt(a.subject_id),
      teacher_id: toInt(a.teacher_id),
      status: String(a.status || "active"),
    }));

    const bad = rows.find(
      (x) =>
        !x.subject_id ||
        !x.teacher_id ||
        !["active", "inactive"].includes(x.status)
    );

    if (bad) {
      return res.status(400).json({
        error: "بيانات التعيين غير صحيحة",
      });
    }

    await upsertSectionAssignments({
      schoolId,
      academicYearId,
      term,
      sectionId,
      rows,
      userId: req.user?.id || null,
    });

    return res.json({
      message: "تم حفظ التعيينات بنجاح ✅",
    });
  } catch (e) {
    console.error("assignTeachers saveSection error:", e);
    return res.status(400).json({
      error: e.message || "فشل الحفظ",
    });
  }
}