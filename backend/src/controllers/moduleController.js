import {
  createModule,
  getAllModules,
  getModuleById,
  updateModule,
  deleteModule
} from "../modules/moduleModel.js";

// إنشاء وحدة
export const addModule = async (req, res) => {
  try {
    const { name, code } = req.body;
    const moduleData = await createModule(name, code);
    res.status(201).json(moduleData);
  } catch (error) {
    res.status(500).json({ error: "Error creating module" });
  }
};

// جميع الوحدات
export const fetchModules = async (req, res) => {
  try {
    const modules = await getAllModules();
    res.json(modules);
  } catch (error) {
    res.status(500).json({ error: "Error fetching modules" });
  }
};

// جلب وحدة ID
export const fetchModuleById = async (req, res) => {
  try {
    const moduleId = req.params.id;
    const moduleData = await getModuleById(moduleId);
    res.json(moduleData);
  } catch (error) {
    res.status(500).json({ error: "Error fetching module" });
  }
};

// تعديل وحدة
export const editModule = async (req, res) => {
  try {
    const moduleId = req.params.id;
    const { name, code } = req.body;
    const updated = await updateModule(moduleId, name, code);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Error updating module" });
  }
};

// حذف وحدة
export const removeModule = async (req, res) => {
  try {
    const moduleId = req.params.id;
    await deleteModule(moduleId);
    res.json({ message: "Module deleted" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting module" });
  }
};
