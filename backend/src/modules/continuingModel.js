import * as Db from "../config/db.js";
const pool = Db.default || Db.pool || Db.db;

const T = {
  students: { t: "students", id: "id", code: "student_code", name: "full_name" },
  enroll: {
    t: "student_enrollments",
    studentId: "student_id",
    yearId: "academic_year_id",
    stageId: "stage_id",
    gradeId: "grade_id",
    sectionId: "section_id",
    status: "status",
    createdAt: "created_at",
    roll: "roll_number",
  },
  grades: { t: "grades", id: "id", name: "name", stageId: "stage_id", orderNo: "order_no", isActive: "is_active" },
  sections: { t: "sections", id: "id", name: "name" },
  stages: { t: "stages", id: "id", name: "name" },
  yearResults: { t: "student_year_results", yearId: "academic_year_id", studentId: "student_id", result: "result", reason: "reason" },
};

const ENROLL_ACTIVE_STATUSES = ["enrolled", "active"];
const NEW_ENROLL_STATUS = "enrolled";

// نتائج تمنع الترحيل نهائيًا
const BLOCKED_RESULTS = new Set(["graduated", "transferred", "withdrawn"]);

function norm(x) {
  return String(x ?? "").toLowerCase().trim();
}

const ContinuingModel = {
  async getEligible({ fromYearId, toYearId, gradeId, sectionId, q, includePending = false }) {
    const S = T.students, E = T.enroll, G = T.grades, C = T.sections, ST = T.stages, YR = T.yearResults;

    const where = [];
    const params = [];
    let i = 1;

    // سنة المصدر
    where.push(`se.${E.yearId} = $${i++}`); params.push(fromYearId);

    // حالات القيد المسموح بها
    where.push(`se.${E.status} = ANY($${i++}::text[])`);
    params.push(ENROLL_ACTIVE_STATUSES);

    if (gradeId) { where.push(`se.${E.gradeId} = $${i++}`); params.push(gradeId); }
    if (sectionId) { where.push(`se.${E.sectionId} = $${i++}`); params.push(sectionId); }

    if (q) {
      where.push(`(st.${S.name} ILIKE $${i} OR st.${S.code} ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    // نريد كذلك معرفة هل يوجد صف تالي لنفس المرحلة (للناجح في آخر صف)
    const sql = `
      SELECT
        st.${S.id} AS student_id,
        st.${S.code} AS code,
        st.${S.name} AS name,

        se.${E.stageId} AS stage_id,
        stg.${ST.name} AS stage_name,

        se.${E.gradeId} AS grade_id,
        g.${G.name} AS grade_name,
        g.${G.orderNo} AS grade_order_no,

        se.${E.sectionId} AS section_id,
        sc.${C.name} AS section_name,

        COALESCE(yr.${YR.result}, 'pending') AS year_result,
        yr.${YR.reason} AS year_reason,

        EXISTS (
          SELECT 1 FROM ${G.t} g2
          WHERE g2.${G.stageId} = se.${E.stageId}
            AND g2.${G.isActive} = TRUE
            AND g2.${G.orderNo} = g.${G.orderNo} + 1
        ) AS has_next_grade,

        NOT EXISTS (
          SELECT 1 FROM ${E.t} se2
          WHERE se2.${E.studentId} = st.${S.id}
            AND se2.${E.yearId} = $${i}
        ) AS not_registered_in_target
      FROM ${E.t} se
      JOIN ${S.t} st ON st.${S.id} = se.${E.studentId}
      LEFT JOIN ${ST.t} stg ON stg.${ST.id} = se.${E.stageId}
      LEFT JOIN ${G.t} g ON g.${G.id} = se.${E.gradeId}
      LEFT JOIN ${C.t} sc ON sc.${C.id} = se.${E.sectionId}
      LEFT JOIN ${YR.t} yr
        ON yr.${YR.studentId} = st.${S.id}
       AND yr.${YR.yearId} = se.${E.yearId}
      WHERE ${where.join(" AND ")}
      ORDER BY st.${S.id} DESC
    `;
    params.push(toYearId);

    const { rows } = await pool.query(sql, params);

    return rows.map((r) => {
      const yr = norm(r.year_result);

      let eligible = true;
      let reason = "";

      if (!r.not_registered_in_target) {
        eligible = false;
        reason = "مسجل مسبقًا في السنة الهدف";
      } else if (BLOCKED_RESULTS.has(yr)) {
        eligible = false;
        reason = `حالة الطالب: ${yr}`;
      } else if (yr === "pending" && !includePending) {
        eligible = false;
        reason = "النتيجة معلّقة (pending) — لا يمكن الترحيل قبل الحسم";
      } else if (yr === "passed" && !r.has_next_grade) {
        eligible = false;
        reason = "نجح لكنه في آخر صف (اعتبر تخرج/لا يوجد صف أعلى)";
      }

      return {
        student_id: r.student_id,
        code: r.code,
        name: r.name,
        stage_id: r.stage_id,
        stage_name: r.stage_name,
        grade_id: r.grade_id,
        grade_name: r.grade_name,
        section_id: r.section_id,
        section_name: r.section_name,
        year_result: yr,
        eligible,
        reason,
      };
    });
  },

  async preview({ toYearId, students }) {
    const E = T.enroll;

    const ids = students.map((s) => Number(s.studentId)).filter(Boolean);
    if (!ids.length) return { willRegister: 0, blocked: 0 };

    const existSql = `
      SELECT ${E.studentId} AS student_id
      FROM ${E.t}
      WHERE ${E.yearId} = $1 AND ${E.studentId} = ANY($2::int[])
    `;
    const exist = await pool.query(existSql, [toYearId, ids]);
    const existsSet = new Set(exist.rows.map((x) => Number(x.student_id)));

    let willRegister = 0, blocked = 0;
    for (const s of students) {
      const sid = Number(s.studentId);
      if (!sid) continue;
      existsSet.has(sid) ? blocked++ : willRegister++;
    }
    return { willRegister, blocked, toYearId };
  },

  async registerBulk({ toYearId, students }) {
    const E = T.enroll, G = T.grades, YR = T.yearResults;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const payload = students.map((s) => ({
        studentId: Number(s.studentId),
        toGradeId: Number(s.toGradeId),
        toSectionId: s.toSectionId ? Number(s.toSectionId) : null,
      }));

      const sql = `
        WITH input AS (
          SELECT
            (x->>'studentId')::int AS student_id,
            (x->>'toGradeId')::int AS grade_id,
            NULLIF(x->>'toSectionId','')::int AS section_id
          FROM jsonb_array_elements($1::jsonb) x
        ),
        input2 AS (
          SELECT i.*, g.${G.stageId} AS stage_id
          FROM input i
          JOIN ${G.t} g ON g.${G.id} = i.grade_id
        ),
        ins AS (
          INSERT INTO ${E.t} (
            ${E.studentId}, ${E.yearId}, ${E.stageId}, ${E.gradeId}, ${E.sectionId},
            ${E.roll}, ${E.status}, ${E.createdAt}
          )
          SELECT
            i2.student_id,
            $2::int,
            i2.stage_id,
            i2.grade_id,
            i2.section_id,
            NULL,
            '${NEW_ENROLL_STATUS}',
            NOW()
          FROM input2 i2
          WHERE NOT EXISTS (
            SELECT 1 FROM ${E.t} e2
            WHERE e2.${E.studentId} = i2.student_id AND e2.${E.yearId} = $2::int
          )
          RETURNING ${E.studentId} AS student_id
        ),
        ins_results AS (
          INSERT INTO ${YR.t} (${YR.yearId}, ${YR.studentId}, ${YR.result}, ${YR.reason})
          SELECT $2::int, student_id, 'pending', NULL
          FROM ins
          ON CONFLICT (${YR.yearId}, ${YR.studentId}) DO NOTHING
          RETURNING 1
        )
        SELECT
          (SELECT COUNT(*) FROM ins) AS inserted_count,
          (SELECT COUNT(*) FROM input) AS requested_count
      `;

      const r = await client.query(sql, [JSON.stringify(payload), toYearId]);
      const inserted = Number(r.rows?.[0]?.inserted_count || 0);
      const requested = Number(r.rows?.[0]?.requested_count || 0);

      await client.query("COMMIT");
      return {
        registered_count: inserted,
        skipped_count: requested - inserted,
        message: "تم تسجيل المستمرين للسنة الجديدة ✅",
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
};

export default ContinuingModel;
