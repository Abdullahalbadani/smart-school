// src/controllers/academicYearController.js
import { pool } from "../config/db.js";

/* =============== 1) جلب كل السنوات الدراسية =============== */
export const getAcademicYears = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const result = await pool.query(
      `
      SELECT id, school_id, name, start_date, end_date, is_active, created_at, updated_at
      FROM academic_years
      WHERE school_id = $1
      ORDER BY start_date DESC
      `,
      [schoolId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Error fetching academic years:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء جلب السنوات الدراسية",
    });
  }
};

/* =============== 2) جلب السنة الحالية فقط =============== */
export const getActiveAcademicYear = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const result = await pool.query(
      `
      SELECT id, school_id, name, start_date, end_date, is_active, created_at, updated_at
      FROM academic_years
      WHERE school_id = $1
        AND is_active = TRUE
      ORDER BY start_date DESC
      LIMIT 1
      `,
      [schoolId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "لا توجد سنة دراسية مفعلة حاليًا",
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching active academic year:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء جلب السنة الدراسية الحالية",
    });
  }
};

/* =============== 3) إنشاء سنة دراسية جديدة =============== */
export const createAcademicYear = async (req, res) => {
  const { name, startDate, endDate, isActive } = req.body || {};

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (!name || !startDate || !endDate) {
      return res.status(400).json({
        message: "الاسم، تاريخ البداية، وتاريخ النهاية حقول مطلوبة",
      });
    }

    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        message: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية",
      });
    }

    const exists = await pool.query(
      `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND name = $2
      LIMIT 1
      `,
      [schoolId, name]
    );

    if (exists.rowCount > 0) {
      return res.status(400).json({
        message: "اسم السنة الدراسية مستخدم من قبل داخل نفس المدرسة",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (isActive === true) {
        await client.query(
          `
          UPDATE academic_years
          SET is_active = FALSE, updated_at = NOW()
          WHERE school_id = $1
            AND is_active = TRUE
          `,
          [schoolId]
        );
      }

      const insertResult = await client.query(
        `
        INSERT INTO academic_years
          (school_id, name, start_date, end_date, is_active, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, COALESCE($5, FALSE), NOW(), NOW())
        RETURNING id, school_id, name, start_date, end_date, is_active, created_at, updated_at
        `,
        [schoolId, name, startDate, endDate, isActive === true]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "تم إنشاء السنة الدراسية بنجاح",
        data: insertResult.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error creating academic year:", err);
      return res.status(500).json({
        message: "حدث خطأ أثناء إنشاء السنة الدراسية",
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error creating academic year:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء إنشاء السنة الدراسية",
    });
  }
};

/* =============== 4) تعديل سنة دراسية =============== */
export const updateAcademicYear = async (req, res) => {
  const { id } = req.params;
  const { name, startDate, endDate, isActive } = req.body || {};

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const existing = await pool.query(
      `
      SELECT *
      FROM academic_years
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [id, schoolId]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({
        message: "السنة الدراسية غير موجودة",
      });
    }

    const current = existing.rows[0];

    const finalStartDate = startDate || current.start_date;
    const finalEndDate = endDate || current.end_date;

    if (new Date(finalStartDate) >= new Date(finalEndDate)) {
      return res.status(400).json({
        message: "تاريخ البداية يجب أن يكون قبل تاريخ النهاية",
      });
    }

    if (name) {
      const duplicate = await pool.query(
        `
        SELECT id
        FROM academic_years
        WHERE school_id = $1
          AND name = $2
          AND id <> $3
        LIMIT 1
        `,
        [schoolId, name, id]
      );

      if (duplicate.rowCount > 0) {
        return res.status(400).json({
          message: "اسم السنة الدراسية مستخدم من قبل داخل نفس المدرسة",
        });
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (isActive === true) {
        await client.query(
          `
          UPDATE academic_years
          SET is_active = FALSE, updated_at = NOW()
          WHERE school_id = $1
            AND is_active = TRUE
            AND id <> $2
          `,
          [schoolId, id]
        );
      }

      const updateResult = await client.query(
        `
        UPDATE academic_years
        SET
          name       = COALESCE($1, name),
          start_date = COALESCE($2, start_date),
          end_date   = COALESCE($3, end_date),
          is_active  = COALESCE($4, is_active),
          updated_at = NOW()
        WHERE id = $5
          AND school_id = $6
        RETURNING id, school_id, name, start_date, end_date, is_active, created_at, updated_at
        `,
        [
          name || null,
          startDate || null,
          endDate || null,
          typeof isActive === "boolean" ? isActive : null,
          id,
          schoolId,
        ]
      );

      await client.query("COMMIT");

      return res.json({
        message: "تم تحديث السنة الدراسية بنجاح",
        data: updateResult.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error updating academic year:", err);
      return res.status(500).json({
        message: "حدث خطأ أثناء تعديل السنة الدراسية",
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error updating academic year:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء تعديل السنة الدراسية",
    });
  }
};

/* =============== 5) حذف سنة دراسية =============== */
export const deleteAcademicYear = async (req, res) => {
  const { id } = req.params;

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM academic_years
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [id, schoolId]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({
        message: "السنة الدراسية غير موجودة",
      });
    }

    await pool.query(
      `
      DELETE FROM academic_years
      WHERE id = $1
        AND school_id = $2
      `,
      [id, schoolId]
    );

    return res.json({
      message: "تم حذف السنة الدراسية بنجاح",
    });
  } catch (error) {
    console.error("Error deleting academic year:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء حذف السنة الدراسية",
    });
  }
};

/* =============== 6) تعيين سنة كالسنة الحالية =============== */
export const setActiveAcademicYear = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      client.release();
      return res.status(401).json({ message: "غير مصرح" });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT id, name
      FROM academic_years
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [id, schoolId]
    );

    if (existing.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "السنة الدراسية غير موجودة",
      });
    }

    await client.query(
      `
      UPDATE academic_years
      SET is_active = FALSE, updated_at = NOW()
      WHERE school_id = $1
      `,
      [schoolId]
    );

    const updated = await client.query(
      `
      UPDATE academic_years
      SET is_active = TRUE, updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
      RETURNING id, school_id, name, start_date, end_date, is_active, created_at, updated_at
      `,
      [id, schoolId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "تم تعيين السنة الدراسية الحالية بنجاح",
      data: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting active academic year:", error);
    return res.status(500).json({
      message: "حدث خطأ أثناء تعيين السنة الدراسية الحالية",
    });
  } finally {
    client.release();
  }
};