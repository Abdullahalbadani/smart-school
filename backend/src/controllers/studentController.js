// src/controllers/studentController.js
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { ensureFeeContractForEnrollmentTx } from "../services/fees/ensureFeeContract.js";

/**
 * IMPORTANT:
 * - users مرتبطة بالأدوار عبر user_roles
 * - users فيها school_id و password_hash و status
 * - عدّل أرقام الأدوار حسب جدول roles عندك
 */
const ROLE_STUDENT_ID = 3;
const ROLE_GUARDIAN_ID = 4;

function normalizeEmail(email) {
  const e = (email || "").trim();
  return e ? e.toLowerCase() : null;
}

// استبدل دالة generateUniqueUsername بهذا المنطق الاحترافي:
async function generateUniqueUsername(client, { schoolId, email, phone, baseName }) {
  let base = (normalizeEmail(email)?.split("@")[0]) || 
             (phone ? `u${String(phone).replace(/\D/g, "")}` : null) || 
             (baseName ? baseName.trim().split(" ")[0] : "user");

  base = String(base).toLowerCase().replace(/[^\w]/g, "").slice(0, 20);
  
  let username = base;
  let i = 0;

  while (true) {
    // 1. نفحص أولاً داخل مدرستك (للحفاظ على منطق العزل الخاص بك)
    const chk = await client.query(
      `SELECT 1 FROM users WHERE school_id = $1 AND username = $2 LIMIT 1`,
      [schoolId, username]
    );

    if (chk.rowCount === 0) {
      // 2. إذا كان متاحاً في مدرستك، نقوم بعمل فحص أخير وسريع على النظام كاملاً
      // لنتأكد أن قاعدة البيانات لن ترفضه (هذا الفحص تقني فقط ولا يعرض أي بيانات)
      const globalChk = await client.query(
        `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
        [username]
      );
      
      if (globalChk.rowCount === 0) return username;
    }

    // إذا وجدناه محجوزاً في مدرستك أو في "قاعدة البيانات العامة"، نزيد رقماً
    i += 1;
    username = `${base}${i}`.slice(0, 24);
  }
}
async function ensureEmailNotUsed(client, schoolId, email) {
  const e = normalizeEmail(email);
  if (!e) return;

  const chk = await client.query(
    `
    SELECT id
    FROM users
    WHERE school_id = $1
      AND LOWER(email) = LOWER($2)
    LIMIT 1
    `,
    [schoolId, e]
  );

  if (chk.rowCount > 0) {
    throw new Error("EMAIL_EXISTS");
  }
}

async function createUserWithRole(client, { schoolId, name, email, phone, passwordPlain, roleId }) {
  const e = normalizeEmail(email);
  const p = phone ? String(phone).trim() : null;

  if (e) await ensureEmailNotUsed(client, schoolId, e);

  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  const username = await generateUniqueUsername(client, {
    schoolId,
    email: e,
    phone: p,
    baseName: name,
  });

  const userRes = await client.query(
    `
    INSERT INTO users (school_id, name, email, username, phone, password_hash, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'active')
    RETURNING id
    `,
    [schoolId, name, e, username, p, passwordHash]
  );

  const userId = userRes.rows[0].id;

  await client.query(
    `
    INSERT INTO user_roles (user_id, role_id)
    VALUES ($1, $2)
    `,
    [userId, roleId]
  );

  return userId;
}

async function validateAcademicRefs(client, { schoolId, academicYearId, stageId, gradeId, sectionId }) {
  const yearChk = await client.query(
    `
    SELECT id
    FROM academic_years
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [academicYearId, schoolId]
  );
  if (yearChk.rowCount === 0) {
    throw new Error("INVALID_ACADEMIC_YEAR");
  }

  const stageChk = await client.query(
    `
    SELECT id
    FROM stages
    WHERE id = $1
      AND school_id = $2
      AND is_active = TRUE
    LIMIT 1
    `,
    [stageId, schoolId]
  );
  if (stageChk.rowCount === 0) {
    throw new Error("INVALID_STAGE");
  }

  const gradeChk = await client.query(
    `
    SELECT id
    FROM grades
    WHERE id = $1
      AND stage_id = $2
      AND school_id = $3
      AND is_active = TRUE
    LIMIT 1
    `,
    [gradeId, stageId, schoolId]
  );
  if (gradeChk.rowCount === 0) {
    throw new Error("INVALID_GRADE");
  }

  if (sectionId) {
    const sectionChk = await client.query(
      `
      SELECT id
      FROM sections
      WHERE id = $1
        AND grade_id = $2
        AND school_id = $3
        AND is_active = TRUE
      LIMIT 1
      `,
      [sectionId, gradeId, schoolId]
    );

    if (sectionChk.rowCount === 0) {
      throw new Error("INVALID_SECTION");
    }
  }
}

/**
 * POST /api/students/register
 */
export const registerStudent = async (req, res) => {
  const { student, academic, guardian, account } = req.body || {};
  const schoolId = req.user?.school_id;

  if (!schoolId) {
    return res.status(401).json({ message: "غير مصرح" });
  }

  if (!student || !academic) {
    return res.status(400).json({ message: "Missing student or academic data." });
  }

  if (!student.student_code || !student.full_name || !student.admission_date) {
    return res.status(400).json({
      message: "Student code, full name and admission date are required.",
    });
  }

  if (!academic.academic_year_id || !academic.stage_id || !academic.grade_id) {
    return res.status(400).json({
      message: "Academic year, stage and grade are required.",
    });
  }

  if (guardian?.mode === "new") {
    if (!guardian.full_name || !guardian.phone) {
      return res.status(400).json({
        message: "Guardian name and phone are required when adding a new guardian.",
      });
    }

    if (guardian.create_account && !guardian.password) {
      return res.status(400).json({
        message: "Guardian password is required to create a guardian account.",
      });
    }
  }

  if (account?.create_student_account) {
    if (!account.email || !account.password) {
      return res.status(400).json({
        message: "Student email and password are required to create a student account.",
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const studentCode = String(student.student_code).trim();
    const academicYearId = Number(academic.academic_year_id);
    const stageId = Number(academic.stage_id);
    const gradeId = Number(academic.grade_id);

    let sectionId = academic.section_id ? Number(academic.section_id) : null;

    await validateAcademicRefs(client, {
      schoolId,
      academicYearId,
      stageId,
      gradeId,
      sectionId,
    });

    const dup = await client.query(
      `
      SELECT id
      FROM students
      WHERE school_id = $1
        AND student_code = $2
      LIMIT 1
      `,
      [schoolId, studentCode]
    );

    if (dup.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Student code already exists." });
    }

    const stuRes = await client.query(
      `
      INSERT INTO students
        (school_id, student_code, full_name, gender, birth_date, birth_place,
         address, phone, phone2, admission_date, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
      `,
      [
        schoolId,
        studentCode,
        String(student.full_name).trim(),
        student.gender || null,
        student.birth_date || null,
        student.birth_place || null,
        student.address || null,
        student.phone || null,
        student.phone2 || null,
        student.admission_date,
        student.status || "active",
      ]
    );

    const studentId = stuRes.rows[0].id;

    if (!sectionId) {
      const sec = await client.query(
        `
        SELECT id
        FROM sections
        WHERE school_id = $1
          AND grade_id = $2
          AND is_active = TRUE
        ORDER BY id ASC
        LIMIT 1
        `,
        [schoolId, gradeId]
      );
      sectionId = sec.rows[0] ? sec.rows[0].id : null;
    }

    if (sectionId) {
      const chk = await client.query(
        `
        SELECT id
        FROM sections
        WHERE id = $1
          AND grade_id = $2
          AND school_id = $3
          AND is_active = TRUE
        LIMIT 1
        `,
        [sectionId, gradeId, schoolId]
      );

      if (chk.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Section does not belong to the selected grade or is inactive.",
        });
      }
    }

    await client.query(
      `
      INSERT INTO student_enrollments
        (school_id, student_id, academic_year_id, stage_id, grade_id, section_id, roll_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        schoolId,
        studentId,
        academicYearId,
        stageId,
        gradeId,
        sectionId,
        academic.roll_number || null,
      ]
    );

  await ensureFeeContractForEnrollmentTx(client, {
      studentId,
      academicYearId,
      stageId,
      gradeId,
      sectionId,
      schoolId, // ✅ هذا السطر هو الذي يحل مشكلة الـ Null
    });

    let guardianId = null;
    let guardianUserId = null;

    if (guardian?.mode === "existing") {
      const gid = Number(guardian.existing_id);

      if (!gid) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Existing guardian ID is required.",
        });
      }

      const gchk = await client.query(
        `
        SELECT id, user_id, full_name, email, phone
        FROM guardians
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [gid, schoolId]
      );

      if (gchk.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Guardian not found." });
      }

      guardianId = gid;

      await client.query(
        `
        INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary)
        VALUES ($1,$2,$3,$4, TRUE)
        `,
        [schoolId, studentId, guardianId, guardian.relation || null]
      );

      if (guardian.create_account) {
        if (!guardian.password) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Guardian password is required to create a guardian account.",
          });
        }

        const gRow = gchk.rows[0];

        if (!gRow.user_id) {
          guardianUserId = await createUserWithRole(client, {
            schoolId,
            name: gRow.full_name,
            email: gRow.email || guardian.email || null,
            phone: gRow.phone || null,
            passwordPlain: guardian.password,
            roleId: ROLE_GUARDIAN_ID,
          });

          await client.query(
            `
            UPDATE guardians
            SET user_id = $1
            WHERE id = $2
              AND school_id = $3
            `,
            [guardianUserId, guardianId, schoolId]
          );
        }
      }
    } else if (guardian?.mode === "new") {
      const gRes = await client.query(
        `
        INSERT INTO guardians (school_id, full_name, gender, phone, email, address)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
        `,
        [
          schoolId,
          String(guardian.full_name).trim(),
          guardian.gender || null,
          String(guardian.phone).trim(),
          normalizeEmail(guardian.email) || null,
          guardian.address || null,
        ]
      );

      guardianId = gRes.rows[0].id;

      await client.query(
        `
        INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary)
        VALUES ($1,$2,$3,$4, TRUE)
        `,
        [schoolId, studentId, guardianId, guardian.relation || null]
      );

      if (guardian.create_account) {
        const gEmail = normalizeEmail(guardian.email) || null;

        guardianUserId = await createUserWithRole(client, {
          schoolId,
          name: String(guardian.full_name).trim(),
          email: gEmail,
          phone: String(guardian.phone).trim(),
          passwordPlain: guardian.password,
          roleId: ROLE_GUARDIAN_ID,
        });

        await client.query(
          `
          UPDATE guardians
          SET user_id = $1
          WHERE id = $2
            AND school_id = $3
          `,
          [guardianUserId, guardianId, schoolId]
        );
      }
    }

    let studentUserId = null;

    if (account?.create_student_account) {
      const sEmail = normalizeEmail(account.email);

      studentUserId = await createUserWithRole(client, {
        schoolId,
        name: String(student.full_name).trim(),
        email: sEmail,
        phone: student.phone || null,
        passwordPlain: account.password,
        roleId: ROLE_STUDENT_ID,
      });

      await client.query(
        `
        UPDATE students
        SET user_id = $1
        WHERE id = $2
          AND school_id = $3
        `,
        [studentUserId, studentId, schoolId]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Student registered successfully",
      student_id: studentId,
      student_user_id: studentUserId,
      guardian_id: guardianId,
      guardian_user_id: guardianUserId,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error?.message === "EMAIL_EXISTS") {
      return res.status(409).json({
        message: "هذا البريد مستخدم مسبقًا داخل نفس المدرسة.",
      });
    }

    if (error?.message === "INVALID_ACADEMIC_YEAR") {
      return res.status(400).json({
        message: "السنة الدراسية غير صحيحة داخل هذه المدرسة.",
      });
    }

    if (error?.message === "INVALID_STAGE") {
      return res.status(400).json({
        message: "المرحلة الدراسية غير صحيحة داخل هذه المدرسة.",
      });
    }

    if (error?.message === "INVALID_GRADE") {
      return res.status(400).json({
        message: "الصف الدراسي غير صحيح داخل هذه المدرسة.",
      });
    }

    if (error?.message === "INVALID_SECTION") {
      return res.status(400).json({
        message: "الشعبة الدراسية غير صحيحة داخل هذه المدرسة.",
      });
    }

    if (error?.message === "NO_FEE_RULE") {
      return res.status(error.status || 400).json({
        message: error.userMessage || "Missing fee rules",
      });
    }

    console.error("registerStudent error:", error);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

/* =========================================================
   GET /api/students
========================================================= */
export const listStudents = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const offset = (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "all").trim();
    const academic_year_id = req.query.academic_year_id
      ? Number(req.query.academic_year_id)
      : null;

    const stage_id = req.query.stage_id ? Number(req.query.stage_id) : null;
    const grade_id = req.query.grade_id ? Number(req.query.grade_id) : null;
    const section_id = req.query.section_id ? Number(req.query.section_id) : null;

    const sortMap = {
      created_at: "s.created_at",
      full_name: "s.full_name",
      student_code: "s.student_code",
      admission_date: "s.admission_date",
      status: "s.status",
    };

    const sort_by = String(req.query.sort_by || "created_at");
    const sort_dir =
      String(req.query.sort_dir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const orderBy = sortMap[sort_by] || sortMap.created_at;

    const qLike = q ? `%${q}%` : "";

    const baseWhere = `
      WHERE s.school_id = $1
        AND ($3::text = '' OR (
          s.student_code ILIKE $3 OR s.full_name ILIKE $3
          OR COALESCE(s.phone,'') ILIKE $3 OR COALESCE(s.phone2,'') ILIKE $3
          OR COALESCE(g.full_name,'') ILIKE $3 OR COALESCE(g.phone,'') ILIKE $3
          OR COALESCE(se.roll_number::text,'') ILIKE $3
        ))
        AND ($4::text = 'all' OR s.status = $4)
        AND ($5::int IS NULL OR se.stage_id = $5)
        AND ($6::int IS NULL OR se.grade_id = $6)
        AND ($7::int IS NULL OR se.section_id = $7)
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM students s
      LEFT JOIN LATERAL (
        SELECT se.*
        FROM student_enrollments se
        WHERE se.student_id = s.id
          AND se.school_id = $1
          AND ($2::int IS NULL OR se.academic_year_id = $2)
        ORDER BY se.created_at DESC NULLS LAST, se.id DESC
        LIMIT 1
      ) se ON TRUE
      LEFT JOIN LATERAL (
        SELECT sg.guardian_id, sg.relation
        FROM student_guardians sg
        WHERE sg.student_id = s.id
          AND sg.school_id = $1
          AND sg.is_primary = TRUE
        ORDER BY sg.id DESC
        LIMIT 1
      ) sg ON TRUE
      LEFT JOIN guardians g
        ON g.id = sg.guardian_id
       AND g.school_id = $1
      ${baseWhere}
    `;

    const baseParams = [
      schoolId,
      academic_year_id,
      qLike,
      status,
      stage_id,
      grade_id,
      section_id,
    ];

    const countRes = await pool.query(countSql, baseParams);
    const total = countRes.rows?.[0]?.total ?? 0;

    const dataSql = `
      SELECT
        s.id,
        s.school_id,
        s.user_id,
        s.student_code,
        s.full_name,
        s.gender,
        s.birth_date,
        s.birth_place,
        s.address,
        s.phone,
        s.phone2,
        s.admission_date,
        s.status,
        s.created_at,
        s.updated_at,

        se.academic_year_id,
        se.stage_id,
        st.name AS stage_name,
        se.grade_id,
        gr.name AS grade_name,
        se.section_id,
        sc.name AS section_name,
        se.roll_number,
        se.status AS enrollment_status,

        g.id AS guardian_id,
        g.full_name AS guardian_name,
        g.phone AS guardian_phone,
        sg.relation AS guardian_relation

      FROM students s

      LEFT JOIN LATERAL (
        SELECT se.*
        FROM student_enrollments se
        WHERE se.student_id = s.id
          AND se.school_id = $1
          AND ($2::int IS NULL OR se.academic_year_id = $2)
        ORDER BY se.created_at DESC NULLS LAST, se.id DESC
        LIMIT 1
      ) se ON TRUE

      LEFT JOIN stages st
        ON st.id = se.stage_id
       AND st.school_id = $1
      LEFT JOIN grades gr
        ON gr.id = se.grade_id
       AND gr.school_id = $1
      LEFT JOIN sections sc
        ON sc.id = se.section_id
       AND sc.school_id = $1

      LEFT JOIN LATERAL (
        SELECT sg.guardian_id, sg.relation
        FROM student_guardians sg
        WHERE sg.student_id = s.id
          AND sg.school_id = $1
          AND sg.is_primary = TRUE
        ORDER BY sg.id DESC
        LIMIT 1
      ) sg ON TRUE

      LEFT JOIN guardians g
        ON g.id = sg.guardian_id
       AND g.school_id = $1

      ${baseWhere}
      ORDER BY ${orderBy} ${sort_dir}
      LIMIT $8 OFFSET $9
    `;

    const dataParams = [...baseParams, limit, offset];
    const dataRes = await pool.query(dataSql, dataParams);

    return res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      data: dataRes.rows || [],
    });
  } catch (err) {
    console.error("listStudents error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* =========================================================
   GET /api/students/:id
========================================================= */
export const getStudentById = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    const id = Number(req.params.id);

    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    if (!id) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const academic_year_id = req.query.academic_year_id
      ? Number(req.query.academic_year_id)
      : null;

    const sql = `
      SELECT
        s.*,

        se.academic_year_id,
        se.stage_id,
        st.name AS stage_name,
        se.grade_id,
        gr.name AS grade_name,
        se.section_id,
        sc.name AS section_name,
        se.roll_number,
        se.status AS enrollment_status,

        g.id AS guardian_id,
        g.full_name AS guardian_name,
        g.phone AS guardian_phone,
        g.email AS guardian_email,
        g.address AS guardian_address,
        sg.relation AS guardian_relation

      FROM students s

      LEFT JOIN LATERAL (
        SELECT se.*
        FROM student_enrollments se
        WHERE se.student_id = s.id
          AND se.school_id = $1
          AND ($2::int IS NULL OR se.academic_year_id = $2)
        ORDER BY se.created_at DESC NULLS LAST, se.id DESC
        LIMIT 1
      ) se ON TRUE

      LEFT JOIN stages st
        ON st.id = se.stage_id
       AND st.school_id = $1
      LEFT JOIN grades gr
        ON gr.id = se.grade_id
       AND gr.school_id = $1
      LEFT JOIN sections sc
        ON sc.id = se.section_id
       AND sc.school_id = $1

      LEFT JOIN LATERAL (
        SELECT sg.guardian_id, sg.relation
        FROM student_guardians sg
        WHERE sg.student_id = s.id
          AND sg.school_id = $1
          AND sg.is_primary = TRUE
        ORDER BY sg.id DESC
        LIMIT 1
      ) sg ON TRUE

      LEFT JOIN guardians g
        ON g.id = sg.guardian_id
       AND g.school_id = $1

      WHERE s.school_id = $1
        AND s.id = $3
      LIMIT 1
    `;

    const r = await pool.query(sql, [schoolId, academic_year_id, id]);

    if (r.rowCount === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.json(r.rows[0]);
  } catch (err) {
    console.error("getStudentById error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* =========================================================
   DELETE /api/students/:id
========================================================= */
export const deleteStudentById = async (req, res) => {
  const schoolId = req.user?.school_id;
  const id = Number(req.params.id);

  if (!schoolId) {
    return res.status(401).json({ message: "غير مصرح" });
  }

  if (!id) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM student_guardians
      WHERE student_id = $1
        AND school_id = $2
      `,
      [id, schoolId]
    );

    await client.query(
      `
      DELETE FROM student_enrollments
      WHERE student_id = $1
        AND school_id = $2
      `,
      [id, schoolId]
    );

    const del = await client.query(
      `
      DELETE FROM students
      WHERE id = $1
        AND school_id = $2
      RETURNING id
      `,
      [id, schoolId]
    );

    if (del.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Student not found" });
    }

    await client.query("COMMIT");
    return res.json({ message: "Deleted", id });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteStudentById error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

export const updateStudentById = async (req, res) => {
  const schoolId = req.user?.school_id;
  const studentId = Number(req.params.id);

  if (!schoolId) {
    return res.status(401).json({ message: "غير مصرح" });
  }

  if (!studentId) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const {
    full_name,
    student_code,
    status,
    phone,
    phone2,
    gender,
    birth_date,
    birth_place,
    address,
    admission_date,

    stage_id,
    grade_id,
    section_id,
    roll_number,

    guardian_name,
    guardian_phone,
  } = req.body || {};

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const cur = await client.query(
      `
      SELECT id
      FROM students
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [studentId, schoolId]
    );

    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Student not found" });
    }

    if (student_code && String(student_code).trim()) {
      const dup = await client.query(
        `
        SELECT id
        FROM students
        WHERE school_id = $1
          AND student_code = $2
          AND id <> $3
        LIMIT 1
        `,
        [schoolId, String(student_code).trim(), studentId]
      );

      if (dup.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Student code already exists." });
      }
    }

    const fields = [];
    const values = [];
    let i = 1;

    const add = (col, val) => {
      if (val === undefined) return;
      fields.push(`${col}=$${i++}`);
      values.push(val);
    };

    add("full_name", full_name?.trim());
    add("student_code", student_code?.trim());
    add("status", status);
    add("phone", phone);
    add("phone2", phone2);
    add("gender", gender);
    add("birth_date", birth_date);
    add("birth_place", birth_place);
    add("address", address);
    add("admission_date", admission_date);

    if (fields.length) {
      values.push(studentId, schoolId);

      await client.query(
        `
        UPDATE students
        SET ${fields.join(", ")}, updated_at = NOW()
        WHERE id = $${i} AND school_id = $${i + 1}
        `,
        values
      );
    }

    const hasAcademic =
      stage_id !== undefined ||
      grade_id !== undefined ||
      section_id !== undefined ||
      roll_number !== undefined;

    if (hasAcademic) {
      const enr = await client.query(
        `
        SELECT id, stage_id, grade_id
        FROM student_enrollments
        WHERE student_id = $1
          AND school_id = $2
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1
        `,
        [studentId, schoolId]
      );

      if (enr.rowCount) {
        const enrId = enr.rows[0].id;
        const currentStageId = Number(enr.rows[0].stage_id);
        const currentGradeId = Number(enr.rows[0].grade_id);

        const effectiveStageId =
          stage_id !== undefined && stage_id ? Number(stage_id) : currentStageId;

        const effectiveGradeId =
          grade_id !== undefined && grade_id ? Number(grade_id) : currentGradeId;

        const stageChk = await client.query(
          `
          SELECT id
          FROM stages
          WHERE id = $1
            AND school_id = $2
            AND is_active = TRUE
          LIMIT 1
          `,
          [effectiveStageId, schoolId]
        );

        if (stageChk.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "المرحلة الدراسية غير صحيحة داخل هذه المدرسة.",
          });
        }

        const gradeChk = await client.query(
          `
          SELECT id
          FROM grades
          WHERE id = $1
            AND stage_id = $2
            AND school_id = $3
            AND is_active = TRUE
          LIMIT 1
          `,
          [effectiveGradeId, effectiveStageId, schoolId]
        );

        if (gradeChk.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "الصف الدراسي غير صحيح داخل هذه المدرسة.",
          });
        }

        if (section_id !== undefined && section_id) {
          const secChk = await client.query(
            `
            SELECT 1
            FROM sections
            WHERE id = $1
              AND grade_id = $2
              AND school_id = $3
              AND is_active = TRUE
            LIMIT 1
            `,
            [Number(section_id), effectiveGradeId, schoolId]
          );

          if (secChk.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              message: "الشعبة لا تتبع الصف المختار أو غير مفعلة.",
            });
          }
        }

        const eFields = [];
        const eVals = [];
        let j = 1;

        const addE = (col, val) => {
          if (val === undefined) return;
          eFields.push(`${col}=$${j++}`);
          eVals.push(val);
        };

        addE(
          "stage_id",
          stage_id !== undefined ? (stage_id ? Number(stage_id) : null) : undefined
        );
        addE(
          "grade_id",
          grade_id !== undefined ? (grade_id ? Number(grade_id) : null) : undefined
        );
        addE(
          "section_id",
          section_id !== undefined ? (section_id ? Number(section_id) : null) : undefined
        );
        addE(
          "roll_number",
          roll_number !== undefined ? (roll_number === null ? null : Number(roll_number)) : undefined
        );

        if (eFields.length) {
          eVals.push(enrId, schoolId);

          await client.query(
            `
            UPDATE student_enrollments
            SET ${eFields.join(", ")}
            WHERE id = $${j}
              AND school_id = $${j + 1}
            `,
            eVals
          );
        }
      }
    }

    const hasGuardian =
      guardian_name !== undefined || guardian_phone !== undefined;

    if (hasGuardian) {
      const g = await client.query(
        `
        SELECT g.id
        FROM student_guardians sg
        JOIN guardians g
          ON g.id = sg.guardian_id
         AND g.school_id = sg.school_id
        WHERE sg.student_id = $1
          AND sg.school_id = $2
          AND sg.is_primary = TRUE
        ORDER BY sg.id DESC
        LIMIT 1
        `,
        [studentId, schoolId]
      );

      if (g.rowCount) {
        const gid = g.rows[0].id;

        const gf = [];
        const gv = [];
        let k = 1;

        const addG = (col, val) => {
          if (val === undefined) return;
          gf.push(`${col}=$${k++}`);
          gv.push(val);
        };

        addG("full_name", guardian_name?.trim());
        addG("phone", guardian_phone?.trim());

        if (gf.length) {
          gv.push(gid, schoolId);

          await client.query(
            `
            UPDATE guardians
            SET ${gf.join(", ")}
            WHERE id = $${k}
              AND school_id = $${k + 1}
            `,
            gv
          );
        }
      }
    }

    await client.query("COMMIT");
    return res.json({ message: "Updated ✅" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateStudentById error:", err);
    return res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

/* =========================================================
   GET /api/students/next-code
   دالة لجلب رقم الطالب التالي (تلقائياً) للواجهة
========================================================= */
export const getNextStudentCode = async (req, res) => {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ message: "غير مصرح" });
    }

    const client = await pool.connect();
    try {
      // 1. جلب بادئة المدرسة من جدول المدارس (الافتراضي ST إذا لم تكن موجودة)
      const schoolRes = await client.query('SELECT name_prefix FROM schools WHERE id = $1', [schoolId]);
      const prefix = schoolRes.rows[0]?.name_prefix || 'ST';
      
      // 2. تحديد السنة الحالية
      const currentYear = new Date().getFullYear(); // يعطي 2026
      
      // نبحث عن نمط مثل ST-2026-%
      const searchPattern = `${prefix}-${currentYear}-%`;

      // 3. جلب آخر وأكبر رقم طالب تم تسجيله بهذه البادئة وهذه السنة
      const maxRes = await client.query(`
        SELECT student_code
        FROM students
        WHERE school_id = $1 AND student_code LIKE $2
        ORDER BY student_code DESC
        LIMIT 1
      `, [schoolId, searchPattern]);

      let nextNumber = 1;

      if (maxRes.rowCount > 0) {
        // إذا وجدنا طلاب سابقين، مثلاً ST-2026-045
        const lastCode = maxRes.rows[0].student_code;
        const parts = lastCode.split('-'); // نقسمه إلى ['ST', '2026', '045']
        
        if (parts.length === 3) {
          nextNumber = parseInt(parts[2], 10) + 1; // نأخذ 45 ونزيد عليها 1 لتصبح 46
        }
      }

      // 4. تجميع الرقم الجديد (مثلاً: ST-2026-046)
      const nextCode = `${prefix}-${currentYear}-${String(nextNumber).padStart(3, '0')}`;

      return res.json({ data: { nextCode } });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("getNextStudentCode error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};