import StageModel from "../modules/stageModel.js";

export const getStages = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const stages = await StageModel.getAllActive(schoolId);

    return res.json(stages);
  } catch (error) {
    console.error("Error fetching stages:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء جلب المراحل الدراسية",
    });
  }
};