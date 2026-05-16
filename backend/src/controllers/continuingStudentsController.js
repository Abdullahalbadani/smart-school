import { pool } from "../config/db.js";

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function toPositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${name} غير صحيح.`);
  }
  return n;
}

function getSchoolId(req) {
  const schoolId = Number(req.user?.school_id);
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    throw badRequest("لم يتم تحديد المدرسة.");
  }
  return schoolId;
}

function normalizeFilters(input) {
  return {
    from_academic_year_id: toPositiveInt(input.from_academic_year_id, "السنة الحالية"),
    from_stage_id: toPositiveInt(input.from_stage_id, "المرحلة الحالية"),
    from_grade_id: toPositiveInt(input.from_grade_id, "الصف الحالي"),
    from_section_id: toPositiveInt(input.from_section_id, "الشعبة الحالية"),

    to_academic_year_id: toPositiveInt(input.to_academic_year_id, "السنة الجديدة"),

    promote_stage_id: toPositiveInt(input.promote_stage_id, "مرحلة الناجحين"),
    promote_grade_id: toPositiveInt(input.promote_grade_id, "صف الناجحين"),
    promote_section_id: toPositiveInt(input.promote_section_id, "شعبة الناجحين"),

    repeat_stage_id: toPositiveInt(input.repeat_stage_id, "مرحلة الراسبين"),
    repeat_grade_id: toPositiveInt(input.repeat_grade_id, "صف الراسبين"),
    repeat_section_id: toPositiveInt(input.repeat_section_id, "شعبة الراسبين"),
  };
}

function assertDifferentYears(filters) {
  if (filters.from_academic_year_id === filters.to_academic_year_id) {
    throw badRequest("تسجيل المستمرين يجب أن يكون من سنة دراسية إلى سنة دراسية جديدة، وليس داخل نفس السنة.");
  }
}

function finalResultLabel(status) {
  const map = {
    passed: "ناجح",
    failed: "راسب",
    incomplete: "ناقص",
    missing: "ناقص",
    absent: "غائب",
    not_approved: "غير معتمد",
  };

  return map[status] || "لا توجد نتيجة";
}

function decisionFromFinalStatus(status) {
  if (status === "passed") {
    return {
      decision: "promote",
      decision_label: "يترحل",
      can_decide: true,
      result_label: "ناجح",
    };
  }

  if (status === "failed") {
    return {
      decision: "repeat",
      decision_label: "يعيد السنة",
      can_decide: true,
      result_label: "راسب",
    };
  }

  if (status) {
    return {
      decision: "review",
      decision_label: "يحتاج مراجعة",
      can_decide: false,
      result_label: finalResultLabel(status),
    };
  }

  return {
    decision: "review",
    decision_label: "لا توجد نتيجة نهائية",
    can_decide: false,
    result_label: "لا توجد نتيجة",
  };
}

function rowStatus(row, filters) {
  const resultDecision = decisionFromFinalStatus(row.final_status);

  if (row.student_status && row.student_status !== "active") {
    return {
      ...resultDecision,
      status: "blocked",
      status_label: "غير نشط",
      can_register: false,
      note: "حساب الطالب غير نشط.",
      target_label: "—",
    };
  }

  if (row.target_year_enrollment_id) {
    return {
      ...resultDecision,
      status: "already_registered",
      status_label: "مسجل مسبقًا",
      can_register: false,
      note: "الطالب مسجل مسبقًا في السنة الجديدة.",
      target_label: "مسجل مسبقًا",
    };
  }

  if (!resultDecision.can_decide) {
    return {
      ...resultDecision,
      status: "needs_review",
      status_label: "مراجعة",
      can_register: false,
      note: "لا يتم تسجيل الطالب تلقائيًا لأنه لا توجد نتيجة نهاية سنة واضحة.",
      target_label: "يحتاج مراجعة",
    };
  }

  const target =
    resultDecision.decision === "promote"
      ? {
          stage_id: filters.promote_stage_id,
          grade_id: filters.promote_grade_id,
          section_id: filters.promote_section_id,
          label: "وجهة الناجحين",
        }
      : {
          stage_id: filters.repeat_stage_id,
          grade_id: filters.repeat_grade_id,
          section_id: filters.repeat_section_id,
          label: "وجهة الراسبين",
        };

  return {
    ...resultDecision,
    status: "ready",
    status_label: "جاهز",
    can_register: true,
    note:
      resultDecision.decision === "promote"
        ? "الطالب ناجح وجاهز للترحيل للسنة الجديدة."
        : "الطالب راسب وسيعاد تسجيله في السنة الجديدة.",
    target_stage_id: target.stage_id,
    target_grade_id: target.grade_id,
    target_section_id: target.section_id,
    target_label: target.label,
  };
}

function buildSummary(students) {
  return {
    total: students.length,
    ready: students.filter((s) => s.can_register).length,
    passed: students.filter((s) => s.decision === "promote").length,
    failed: students.filter((s) => s.decision === "repeat").length,
    needs_review: students.filter((s) => s.status === "needs_review").length,
    already_registered: students.filter((s) => s.status === "already_registered").length,
    blocked: students.filter((s) => s.status === "blocked").length,
  };
}

async function getNextRoll(client, schoolId, target, cache) {
  const key = [
    target.academic_year_id,
    target.stage_id,
    target.grade_id,
    target.section_id,
  ].join(":");

  if (!cache.has(key)) {
    const q = await client.query(
      `
      SELECT COALESCE(MAX(roll_number), 0) AS max_roll
      FROM student_enrollments
      WHERE school_id = $1
        AND academic_year_id = $2
        AND stage_id = $3
        AND grade_id = $4
        AND section_id = $5
        AND COALESCE(status, 'enrolled') = 'enrolled'
      `,
      [
        schoolId,
        target.academic_year_id,
        target.stage_id,
        target.grade_id,
        target.section_id,
      ]
    );

    cache.set(key, Number(q.rows[0]?.max_roll || 0) + 1);
  }

  const next = cache.get(key);
  cache.set(key, next + 1);

  return next;
}

async function fetchContinuingRows(db, schoolId, filters, onlyStudentIds = null) {
  const params = [
    schoolId,
    filters.from_academic_year_id,
    filters.from_stage_id,
    filters.from_grade_id,
    filters.from_section_id,
    filters.to_academic_year_id,
  ];

  let studentFilterSql = "";

  if (Array.isArray(onlyStudentIds) && onlyStudentIds.length) {
    params.push(onlyStudentIds);
    studentFilterSql = `AND s.id = ANY($${params.length}::int[])`;
  }

  const { rows } = await db.query(
    `
    WITH src AS (
      SELECT DISTINCT ON (se.student_id)
        se.*
      FROM student_enrollments se
      WHERE se.school_id = $1
        AND se.academic_year_id = $2
        AND se.stage_id = $3
        AND se.grade_id = $4
        AND se.section_id = $5
        AND COALESCE(se.status, 'enrolled') = 'enrolled'
      ORDER BY se.student_id, se.id DESC
    )
    SELECT
      s.id AS student_id,
      s.student_code,
      s.full_name,
      s.gender,
      s.status AS student_status,

      src.id AS source_enrollment_id,
      src.roll_number AS source_roll_number,

      ay.name AS source_year_name,
      st.name AS source_stage_name,
      COALESCE(g.grade_name, g.name) AS source_grade_name,
      sec.name AS source_section_name,

      final_res.student_status AS final_status,
      final_res.percentage AS final_percentage,
      final_res.grade_label AS final_grade_label,
      final_res.rank_in_section AS final_rank,
      final_res.failed_subjects AS final_failed_subjects,
      final_res.missing_subjects AS final_missing_subjects,
      final_res.published_at AS final_published_at,

      target_year.id AS target_year_enrollment_id,
      target_year.stage_id AS target_year_stage_id,
      target_year.grade_id AS target_year_grade_id,
      target_year.section_id AS target_year_section_id

    FROM src

    JOIN students s
      ON s.id = src.student_id
     AND s.school_id = src.school_id

    LEFT JOIN academic_years ay
      ON ay.id = src.academic_year_id
     AND ay.school_id = src.school_id

    LEFT JOIN stages st
      ON st.id = src.stage_id
     AND st.school_id = src.school_id

    LEFT JOIN grades g
      ON g.id = src.grade_id
     AND g.school_id = src.school_id

    LEFT JOIN sections sec
      ON sec.id = src.section_id
     AND sec.school_id = src.school_id

    LEFT JOIN LATERAL (
      SELECT
        trs.status AS student_status,
        trs.percentage,
        trs.grade_label,
        trs.rank_in_section,
        trs.failed_subjects,
        trs.missing_subjects,
        b.published_at
      FROM term_result_students trs
      JOIN term_result_batches b
        ON b.id = trs.batch_id
       AND b.school_id = trs.school_id
      WHERE trs.school_id = src.school_id
        AND trs.student_id = src.student_id
        AND b.academic_year_id = src.academic_year_id
        AND b.term = 2
        AND b.stage_id = src.stage_id
        AND b.grade_id = src.grade_id
        AND b.section_id = src.section_id
        AND b.status IN ('approved', 'published')
      ORDER BY
        b.published_at DESC NULLS LAST,
        b.approved_at DESC NULLS LAST,
        b.id DESC
      LIMIT 1
    ) final_res ON TRUE

    LEFT JOIN student_enrollments target_year
      ON target_year.student_id = s.id
     AND target_year.school_id = src.school_id
     AND target_year.academic_year_id = $6
     AND COALESCE(target_year.status, 'enrolled') = 'enrolled'

    WHERE 1 = 1
      ${studentFilterSql}

    ORDER BY
      src.roll_number ASC NULLS LAST,
      s.student_code ASC,
      s.full_name ASC
    `,
    params
  );

  return rows;
}

export async function getContinuingMeta(req, res) {
  try {
    const schoolId = getSchoolId(req);

    const [yearsQ, stagesQ, gradesQ, sectionsQ] = await Promise.all([
      pool.query(
        `
        SELECT id, name, is_active, start_date, end_date
        FROM academic_years
        WHERE school_id = $1
        ORDER BY is_active DESC NULLS LAST, start_date DESC NULLS LAST, id DESC
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, name
        FROM stages
        WHERE school_id = $1
        ORDER BY id ASC
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, stage_id, COALESCE(grade_name, name) AS name
        FROM grades
        WHERE school_id = $1
        ORDER BY stage_id ASC, id ASC
        `,
        [schoolId]
      ),
      pool.query(
        `
        SELECT id, grade_id, name
        FROM sections
        WHERE school_id = $1
        ORDER BY grade_id ASC, name ASC, id ASC
        `,
        [schoolId]
      ),
    ]);

    return res.json({
      academic_years: yearsQ.rows,
      stages: stagesQ.rows,
      grades: gradesQ.rows,
      sections: sectionsQ.rows,
    });
  } catch (e) {
    console.error("getContinuingMeta error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في تحميل بيانات تسجيل المستمرين.",
    });
  }
}

export async function listContinuingStudents(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const filters = normalizeFilters(req.query);
    assertDifferentYears(filters);

    const rows = await fetchContinuingRows(pool, schoolId, filters);

    const students = rows.map((row) => ({
      ...row,
      ...rowStatus(row, filters),
      result_label: finalResultLabel(row.final_status),
    }));

    return res.json({
      filters,
      summary: buildSummary(students),
      students,
    });
  } catch (e) {
    console.error("listContinuingStudents error:", e);
    return res.status(e.status || 500).json({
      message: e.message || "خطأ في عرض طلاب المستمرين.",
    });
  }
}

export async function registerContinuingStudents(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = getSchoolId(req);
    const filters = normalizeFilters(req.body || {});
    assertDifferentYears(filters);

    const studentIds = Array.isArray(req.body?.student_ids)
      ? [
          ...new Set(
            req.body.student_ids
              .map(Number)
              .filter((id) => Number.isInteger(id) && id > 0)
          ),
        ]
      : [];

    if (!studentIds.length) {
      throw badRequest("اختر طالبًا واحدًا على الأقل.");
    }

    await client.query("BEGIN");

    const rows = await fetchContinuingRows(client, schoolId, filters, studentIds);
    const byId = new Map(rows.map((row) => [Number(row.student_id), row]));

    const rollCache = new Map();
    const created = [];
    const skipped = [];

    for (const studentId of studentIds) {
      const row = byId.get(Number(studentId));

      if (!row) {
        skipped.push({
          student_id: studentId,
          reason: "الطالب غير موجود في المصدر المحدد.",
        });
        continue;
      }

      const evaluated = {
        ...row,
        ...rowStatus(row, filters),
      };

      if (!evaluated.can_register) {
        skipped.push({
          student_id: studentId,
          student_code: row.student_code,
          full_name: row.full_name,
          reason: evaluated.note || "الطالب غير جاهز للتسجيل.",
        });
        continue;
      }

      const target =
        evaluated.decision === "promote"
          ? {
              academic_year_id: filters.to_academic_year_id,
              stage_id: filters.promote_stage_id,
              grade_id: filters.promote_grade_id,
              section_id: filters.promote_section_id,
            }
          : {
              academic_year_id: filters.to_academic_year_id,
              stage_id: filters.repeat_stage_id,
              grade_id: filters.repeat_grade_id,
              section_id: filters.repeat_section_id,
            };

      const existingQ = await client.query(
        `
        SELECT id
        FROM student_enrollments
        WHERE school_id = $1
          AND student_id = $2
          AND academic_year_id = $3
          AND COALESCE(status, 'enrolled') = 'enrolled'
        LIMIT 1
        `,
        [schoolId, studentId, target.academic_year_id]
      );

      if (existingQ.rows.length) {
        skipped.push({
          student_id: studentId,
          student_code: row.student_code,
          full_name: row.full_name,
          reason: "الطالب مسجل مسبقًا في السنة الجديدة.",
        });
        continue;
      }

      const rollNumber = await getNextRoll(client, schoolId, target, rollCache);

      const insertQ = await client.query(
        `
        INSERT INTO student_enrollments (
          student_id,
          academic_year_id,
          term,
          stage_id,
          grade_id,
          section_id,
          roll_number,
          status,
          school_id,
          created_at
        )
        VALUES (
          $1, $2, 1, $3, $4, $5, $6, 'enrolled', $7, NOW()
        )
        RETURNING id, student_id, roll_number
        `,
        [
          studentId,
          target.academic_year_id,
          target.stage_id,
          target.grade_id,
          target.section_id,
          rollNumber,
          schoolId,
        ]
      );

      created.push({
        enrollment_id: insertQ.rows[0].id,
        student_id: studentId,
        student_code: row.student_code,
        full_name: row.full_name,
        decision: evaluated.decision,
        decision_label: evaluated.decision_label,
        roll_number: insertQ.rows[0].roll_number,
      });
    }

    await client.query("COMMIT");

    return res.status(201).json({
      message: `تم تسجيل ${created.length} طالب/طلاب من المستمرين.`,
      created_count: created.length,
      skipped_count: skipped.length,
      created,
      skipped,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("registerContinuingStudents error:", e);

    return res.status(e.status || 500).json({
      message: e.message || "خطأ في تسجيل المستمرين.",
    });
  } finally {
    client.release();
  }
}