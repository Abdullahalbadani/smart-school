import ContinuingModel from "../modules/continuingModel.js";

function toInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} غير صحيح`);
  return n;
}

export const ContinuingController = {
  async getEligible(req, res) {
    try {
      const fromYearId = toInt(req.query.fromYearId, "fromYearId");
      const toYearId = toInt(req.query.toYearId, "toYearId");
      const gradeId = req.query.gradeId ? toInt(req.query.gradeId, "gradeId") : null;
      const sectionId = req.query.sectionId ? toInt(req.query.sectionId, "sectionId") : null;
      const q = (req.query.q || "").trim();
      const includePending = String(req.query.includePending || "") === "1";

      const rows = await ContinuingModel.getEligible({
        fromYearId,
        toYearId,
        gradeId,
        sectionId,
        q,
        includePending,
      });

      return res.json({ data: rows });
    } catch (e) {
      return res.status(400).json({ message: e.message || "خطأ" });
    }
  },

  async preview(req, res) {
    try {
      const fromYearId = toInt(req.body?.fromYearId, "fromYearId");
      const toYearId = toInt(req.body?.toYearId, "toYearId");
      const students = req.body?.students;

      if (!Array.isArray(students) || !students.length) {
        return res.status(400).json({ message: "students مطلوبة (مصفوفة)" });
      }

      const summary = await ContinuingModel.preview({ fromYearId, toYearId, students });
      return res.json({ summary });
    } catch (e) {
      return res.status(400).json({ message: e.message || "خطأ" });
    }
  },

  async registerBulk(req, res) {
    try {
      const fromYearId = toInt(req.body?.fromYearId, "fromYearId");
      const toYearId = toInt(req.body?.toYearId, "toYearId");
      const students = req.body?.students;

      if (!Array.isArray(students) || !students.length) {
        return res.status(400).json({ message: "حدد طلابًا للترحيل" });
      }

      for (const s of students) {
        if (!s.studentId) throw new Error("studentId مفقود");
        if (!s.toGradeId) throw new Error("toGradeId مفقود لبعض الطلاب");
      }

      const result = await ContinuingModel.registerBulk({ fromYearId, toYearId, students });
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ message: e.message || "خطأ" });
    }
  },
};
