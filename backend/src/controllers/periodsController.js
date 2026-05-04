// src/controllers/periodsController.js
import { pool } from "../config/db.js";

// GET /api/periods
export const listPeriods = async (req, res) => {
  try {
    const schoolId = req.user?.school_id; // ✅ استخراج هوية المدرسة
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const { rows } = await pool.query(
      `SELECT id, name, start_time, end_time, sort_order
       FROM periods
       WHERE school_id = $1 -- ✅ جلب حصص مدرستي فقط
       ORDER BY sort_order ASC`,
      [schoolId]
    );
    return res.json({ data: rows });
  } catch (e) {
    console.error("listPeriods error:", e);
    return res.status(500).json({ message: "فشل جلب الحصص" });
  }
};

// POST /api/periods
export const createPeriod = async (req, res) => {
  try {
    const schoolId = req.user?.school_id; // ✅ استخراج هوية المدرسة
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const { name, start_time, end_time, sort_order } = req.body;

    if (!name || !start_time || !end_time || !sort_order) {
      return res.status(400).json({ message: "الاسم + البداية + النهاية + الترتيب مطلوبة" });
    }

    // ✅ زراعة school_id عند إنشاء الحصة
    const { rows } = await pool.query(
      `INSERT INTO periods (school_id, name, start_time, end_time, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, start_time, end_time, sort_order`,
      [schoolId, name.trim(), start_time, end_time, Number(sort_order)]
    );

    return res.status(201).json({ data: rows[0] });
  } catch (e) {
    // duplicate sort_order
    if (e?.code === "23505") {
      return res.status(409).json({ message: "هذا الترتيب (sort_order) مستخدم مسبقاً في مدرستك. اختر رقم آخر." });
    }
    console.error("createPeriod error:", e);
    return res.status(500).json({ message: "فشل إنشاء الحصة" });
  }
};

// PUT /api/periods/:id
export const updatePeriod = async (req, res) => {
  try {
    const schoolId = req.user?.school_id; // ✅ استخراج هوية المدرسة
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = Number(req.params.id);
    const { name, start_time, end_time, sort_order } = req.body;

    if (!id) return res.status(400).json({ message: "ID غير صحيح" });
    if (!name || !start_time || !end_time || !sort_order) {
      return res.status(400).json({ message: "الاسم + البداية + النهاية + الترتيب مطلوبة" });
    }

    // ✅ التعديل يتم فقط إذا كانت الحصة تابعة لنفس المدرسة
    const { rows } = await pool.query(
      `UPDATE periods
       SET name=$1, start_time=$2, end_time=$3, sort_order=$4
       WHERE id=$5 AND school_id=$6
       RETURNING id, name, start_time, end_time, sort_order`,
      [name.trim(), start_time, end_time, Number(sort_order), id, schoolId]
    );

    if (!rows.length) return res.status(404).json({ message: "الحصة غير موجودة أو لا تملك صلاحية تعديلها" });
    return res.json({ data: rows[0] });
  } catch (e) {
    if (e?.code === "23505") {
      return res.status(409).json({ message: "هذا الترتيب (sort_order) مستخدم مسبقاً في مدرستك. اختر رقم آخر." });
    }
    console.error("updatePeriod error:", e);
    return res.status(500).json({ message: "فشل تحديث الحصة" });
  }
};

// DELETE /api/periods/:id
export const deletePeriod = async (req, res) => {
  try {
    const schoolId = req.user?.school_id; // ✅ استخراج هوية المدرسة
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID غير صحيح" });

    // ✅ الحذف يتم فقط إذا كانت الحصة تابعة لنفس المدرسة
    const { rowCount } = await pool.query(
      `DELETE FROM periods WHERE id=$1 AND school_id=$2`, 
      [id, schoolId]
    );
    if (!rowCount) return res.status(404).json({ message: "الحصة غير موجودة أو لا تملك صلاحية حذفها" });

    return res.json({ message: "تم حذف الحصة بنجاح" });
  } catch (e) {
    console.error("deletePeriod error:", e);
    return res.status(500).json({ message: "فشل حذف الحصة" });
  }
};