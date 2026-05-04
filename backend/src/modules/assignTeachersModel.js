// src/modules/assignTeachersModel.js
import { pool } from "../config/db.js";

export async function getAssignMeta(schoolId) {
  const [years, stages, grades, sections, subjects, teachers] =
    await Promise.all([
      pool.query(
        `
        SELECT id, school_id, name, is_active
        FROM academic_years
        WHERE school_id = $1
        ORDER BY id DESC
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, school_id, name, order_index, is_active
        FROM stages
        WHERE school_id = $1
        ORDER BY order_index, id
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, school_id, stage_id, name, order_index, is_active
        FROM grades
        WHERE school_id = $1
        ORDER BY stage_id, order_index, id
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, school_id, grade_id, name, is_active
        FROM sections
        WHERE school_id = $1
        ORDER BY grade_id, name
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, school_id, name, is_active
        FROM subjects
        WHERE school_id = $1
        ORDER BY name
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, school_id, full_name, is_active
        FROM teachers
        WHERE school_id = $1
        ORDER BY full_name
        `,
        [schoolId]
      ),
    ]);

  return {
    years: years.rows,
    stages: stages.rows,
    grades: grades.rows,
    sections: sections.rows,
    subjects: subjects.rows,
    teachers: teachers.rows,
  };
}

export async function getSectionGradeId(schoolId, sectionId) {
  const r = await pool.query(
    `
    SELECT id, school_id, grade_id, name
    FROM sections
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [sectionId, schoolId]
  );
  return r.rows[0] || null;
}

export async function getGradeSubjects(schoolId, gradeId) {
  const r = await pool.query(
    `
    SELECT
      s.id   AS subject_id,
      s.name AS subject_name
    FROM grade_subjects gs
    JOIN subjects s
      ON s.id = gs.subject_id
     AND s.school_id = gs.school_id
    WHERE gs.school_id = $1
      AND gs.grade_id = $2
      AND gs.is_active = TRUE
      AND s.is_active = TRUE
    ORDER BY s.name
    `,
    [schoolId, gradeId]
  );
  return r.rows;
}

export async function getSectionAssignments({
  schoolId,
  academicYearId,
  term,
  sectionId,
}) {
  const r = await pool.query(
    `
    SELECT
      sst.subject_id,
      sst.teacher_id,
      sst.status,
      t.full_name AS teacher_name,
      t.is_active AS teacher_is_active
    FROM section_subject_teachers sst
    LEFT JOIN teachers t
      ON t.id = sst.teacher_id
     AND t.school_id = sst.school_id
    WHERE sst.school_id = $1
      AND sst.academic_year_id = $2
      AND sst.term = $3
      AND sst.section_id = $4
    `,
    [schoolId, academicYearId, term, sectionId]
  );
  return r.rows;
}

export async function getEligibleTeachersBySubjects(schoolId, subjectIds) {
  if (!subjectIds?.length) return [];

  const r = await pool.query(
    `
    SELECT
      ts.subject_id,
      t.id AS teacher_id,
      t.full_name
    FROM teacher_subjects ts
    JOIN teachers t
      ON t.id = ts.teacher_id
     AND t.school_id = ts.school_id
    WHERE ts.school_id = $1
      AND ts.is_active = TRUE
      AND t.is_active = TRUE
      AND ts.subject_id = ANY($2::int[])
    ORDER BY ts.subject_id, t.full_name
    `,
    [schoolId, subjectIds]
  );

  return r.rows;
}

export async function upsertSectionAssignments({
  schoolId,
  academicYearId,
  term,
  sectionId,
  rows, // [{subject_id, teacher_id, status}]
  userId,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const subjectIds = rows.map((x) => Number(x.subject_id));
    const teacherIds = rows.map((x) => Number(x.teacher_id));
    const statuses = rows.map((x) => String(x.status || "active"));

    if (![1, 2].includes(Number(term))) {
      throw new Error("الترم غير صحيح");
    }

    // تحقق أن السنة تتبع نفس المدرسة
    const yearCheck = await client.query(
      `
      SELECT id
      FROM academic_years
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [academicYearId, schoolId]
    );

    if (yearCheck.rowCount === 0) {
      throw new Error("السنة الدراسية غير موجودة داخل هذه المدرسة");
    }

    // تحقق أن الشعبة تتبع نفس المدرسة
    const sectionCheck = await client.query(
      `
      SELECT id
      FROM sections
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [sectionId, schoolId]
    );

    if (sectionCheck.rowCount === 0) {
      throw new Error("الشعبة غير موجودة داخل هذه المدرسة");
    }

    // تحقق أن كل المواد تخص نفس المدرسة ومربوطة بالشعبة/الصف بشكل صحيح
    const subjectCheck = await client.query(
      `
      SELECT COUNT(*)::int AS cnt
      FROM grade_subjects gs
      JOIN sections sec
        ON sec.grade_id = gs.grade_id
       AND sec.school_id = gs.school_id
      WHERE gs.school_id = $1
        AND sec.id = $2
        AND gs.is_active = TRUE
        AND gs.subject_id = ANY($3::int[])
      `,
      [schoolId, sectionId, subjectIds]
    );

    if (subjectCheck.rows[0].cnt !== subjectIds.length) {
      throw new Error("يوجد مواد لا تتبع هذه الشعبة أو هذه المدرسة");
    }

    // تحقق أن كل معلم/مادة مؤهلان داخل نفس المدرسة
    const invalidQ = await client.query(
      `
      WITH data AS (
        SELECT *
        FROM unnest($2::int[], $3::int[]) AS d(subject_id, teacher_id)
      )
      SELECT d.subject_id, d.teacher_id
      FROM data d
      LEFT JOIN teacher_subjects ts
        ON ts.school_id = $1
       AND ts.subject_id = d.subject_id
       AND ts.teacher_id = d.teacher_id
       AND ts.is_active = TRUE
      LEFT JOIN teachers t
        ON t.id = d.teacher_id
       AND t.school_id = $1
       AND t.is_active = TRUE
      WHERE ts.id IS NULL OR t.id IS NULL
      `,
      [schoolId, subjectIds, teacherIds]
    );

    if (invalidQ.rows.length) {
      throw new Error("يوجد مدرس غير مؤهل أو غير نشط ضمن التعيينات");
    }

    await client.query(
      `
      WITH data AS (
        SELECT *
        FROM unnest($5::int[], $6::int[], $7::text[]) AS d(subject_id, teacher_id, status)
      )
      INSERT INTO section_subject_teachers
        (school_id, academic_year_id, term, section_id, subject_id, teacher_id, status, created_by)
      SELECT
        $1, $2, $3, $4, d.subject_id, d.teacher_id, d.status, $8
      FROM data d
      ON CONFLICT (school_id, academic_year_id, term, section_id, subject_id)
      DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        status     = EXCLUDED.status,
        updated_at = NOW()
      `,
      [
        schoolId,
        academicYearId,
        term,
        sectionId,
        subjectIds,
        teacherIds,
        statuses,
        userId || null,
      ]
    );

    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}