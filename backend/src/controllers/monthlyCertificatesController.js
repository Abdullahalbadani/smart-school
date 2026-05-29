// backend/src/controllers/monthlyCertificatesController.js
import { pool } from "../config/db.js";

function normalizeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeTerm(value) {
  const n = Number(value);
  return n === 1 || n === 2 ? n : null;
}

function normalizeMonth(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function normalizeStudentIds(value) {
  if (!Array.isArray(value)) return [];

  const ids = value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  return [...new Set(ids)];
}

function monthName(month) {
  const names = {
    1: "يناير",
    2: "فبراير",
    3: "مارس",
    4: "أبريل",
    5: "مايو",
    6: "يونيو",
    7: "يوليو",
    8: "أغسطس",
    9: "سبتمبر",
    10: "أكتوبر",
    11: "نوفمبر",
    12: "ديسمبر",
  };

  return names[Number(month)] || "";
}

function termLabel(term) {
  if (Number(term) === 1) return "الفصل الأول";
  if (Number(term) === 2) return "الفصل الثاني";
  return "";
}

function getSchoolId(req) {
  return req.user?.school_id || req.user?.school?.id || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function validateScope(source) {
  const academicYearId = normalizeInt(source.academic_year_id);
  const term = normalizeTerm(source.term);
  const month = normalizeMonth(source.month);
  const stageId = normalizeInt(source.stage_id);
  const gradeId = normalizeInt(source.grade_id);
  const sectionId = normalizeInt(source.section_id);

  if (!academicYearId) throw new Error("اختر السنة الدراسية.");
  if (!term) throw new Error("اختر الفصل الدراسي.");
  if (!month) throw new Error("اختر الشهر.");
  if (!stageId) throw new Error("اختر المرحلة.");
  if (!gradeId) throw new Error("اختر الصف.");
  if (!sectionId) throw new Error("اختر الشعبة.");

  return {
    academicYearId,
    term,
    month,
    stageId,
    gradeId,
    sectionId,
  };
}

async function getSchoolSnapshot(client, schoolId) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM schools
    WHERE id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  const school = rows[0] || {};

  return {
    id: school.id || schoolId,
    name:
      school.name_ar ||
      school.name_en ||
      school.name ||
      school.school_name ||
      school.school_name_ar ||
      "اسم المدرسة",
    logo_url:
      school.logo_url ||
      school.school_logo ||
      school.logo ||
      school.logo_path ||
      "",
    principal_name:
      school.principal_name ||
      school.manager_name ||
      school.director_name ||
      school.headmaster_name ||
      school.school_principal ||
      "مدير المدرسة",
  };
}

async function loadStudentsForScope(client, schoolId, scope) {
  const { rows } = await client.query(
    `
    SELECT
      s.id AS student_id,
      s.full_name,
      s.student_code,

      se.roll_number,
      se.stage_id,
      se.grade_id,
      se.section_id,

      st.name AS stage_name,
      COALESCE(g.grade_name, g.name) AS grade_name,
      sec.name AS section_name,

      c.id AS certificate_id,
      c.status AS certificate_status,
      c.created_at AS issued_at,
      c.printed_at

    FROM student_enrollments se

    JOIN students s
      ON s.id = se.student_id

    LEFT JOIN stages st
      ON st.id = se.stage_id

    LEFT JOIN grades g
      ON g.id = se.grade_id

    LEFT JOIN sections sec
      ON sec.id = se.section_id

    LEFT JOIN student_certificates c
      ON c.school_id = se.school_id
      AND c.certificate_type = 'monthly'
      AND c.academic_year_id = se.academic_year_id
      AND c.term = se.term
      AND c.month = $7
      AND c.student_id = se.student_id
      AND c.status <> 'canceled'

    WHERE se.school_id = $1
      AND se.academic_year_id = $2
      AND se.term = $3
      AND se.stage_id = $4
      AND se.grade_id = $5
      AND se.section_id = $6

    ORDER BY
      se.roll_number NULLS LAST,
      s.full_name ASC,
      s.id ASC
    `,
    [
      schoolId,
      scope.academicYearId,
      scope.term,
      scope.stageId,
      scope.gradeId,
      scope.sectionId,
      scope.month,
    ]
  );

  return rows;
}

export const MonthlyCertificatesController = {
  async meta(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = getSchoolId(req);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const school = await getSchoolSnapshot(client, schoolId);

      return res.json({
        success: true,
        school,
        settings: {
          school_name: school.name,
          logo_url: school.logo_url,
          principal_name: school.principal_name,
        },
      });
    } catch (err) {
      console.error("monthly certificates meta error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في تحميل بيانات الشهادات",
      });
    } finally {
      client.release();
    }
  },

  async students(req, res) {
    const client = await pool.connect();

    try {
      const schoolId = getSchoolId(req);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(req.query);
      const rows = await loadStudentsForScope(client, schoolId, scope);

      return res.json({
        success: true,
        items: rows.map((row) => ({
          student_id: row.student_id,
          full_name: row.full_name,
          student_code: row.student_code,
          roll_number: row.roll_number,

          stage_id: row.stage_id,
          grade_id: row.grade_id,
          section_id: row.section_id,

          stage_name: row.stage_name,
          grade_name: row.grade_name,
          section_name: row.section_name,

          already_issued: !!row.certificate_id,
          certificate_id: row.certificate_id,
          certificate_status: row.certificate_status,
          issued_at: row.issued_at,
          printed_at: row.printed_at,
        })),
      });
    } catch (err) {
      console.error("monthly certificates students error:", err);

      return res.status(400).json({
        success: false,
        message: err.message || "خطأ في تحميل الطلاب",
      });
    } finally {
      client.release();
    }
  },

  async list(req, res) {
    try {
      const schoolId = getSchoolId(req);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(req.query);

      const { rows } = await pool.query(
        `
        SELECT
          c.id,
          c.school_id,
          c.certificate_type,
          c.academic_year_id,
          c.term,
          c.month,
          c.student_id,
          c.stage_id,
          c.grade_id,
          c.section_id,
          c.title,
          c.status,
          c.snapshot_json,
          c.created_at AS issued_at,
          c.printed_at,

          COALESCE(c.snapshot_json->>'student_name', s.full_name) AS full_name,
          COALESCE(c.snapshot_json->>'student_code', s.student_code) AS student_code

        FROM student_certificates c

        JOIN students s
          ON s.id = c.student_id

        WHERE c.school_id = $1
          AND c.certificate_type = 'monthly'
          AND c.academic_year_id = $2
          AND c.term = $3
          AND c.month = $4
          AND c.stage_id = $5
          AND c.grade_id = $6
          AND c.section_id = $7
          AND c.status <> 'canceled'

        ORDER BY
          c.created_at DESC,
          c.id DESC
        `,
        [
          schoolId,
          scope.academicYearId,
          scope.term,
          scope.month,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
        ]
      );

      return res.json({
        success: true,
        items: rows,
      });
    } catch (err) {
      console.error("monthly certificates list error:", err);

      return res.status(400).json({
        success: false,
        message: err.message || "خطأ في عرض الشهادات",
      });
    }
  },

  async create(req, res) {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const schoolId = getSchoolId(req);
      const userId = getUserId(req);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(req.body);
      const studentIds = normalizeStudentIds(req.body.student_ids);

      if (!studentIds.length) {
        return res.status(400).json({
          success: false,
          message: "اختر طالبًا واحدًا على الأقل",
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      const school = await getSchoolSnapshot(client, schoolId);
      const allRows = await loadStudentsForScope(client, schoolId, scope);

      const selected = allRows.filter((row) =>
        studentIds.includes(Number(row.student_id))
      );

      if (!selected.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "لا يوجد طلاب مطابقون للاختيار الحالي",
        });
      }

      const created = [];
      const skipped = [];

      for (const row of selected) {
        if (row.certificate_id) {
          skipped.push(row.student_id);
          continue;
        }

        const snapshot = {
          certificate_type: "monthly",
          title: "شهادة شكر وتقدير",

          school_id: school.id,
          school_name: school.name,
          logo_url: school.logo_url,
          principal_name: school.principal_name,

          student_id: row.student_id,
          student_name: row.full_name,
          student_code: row.student_code,
          roll_number: row.roll_number,

          stage_id: row.stage_id,
          grade_id: row.grade_id,
          section_id: row.section_id,
          stage_name: row.stage_name,
          grade_name: row.grade_name,
          section_name: row.section_name,

          academic_year_id: scope.academicYearId,
          term: scope.term,
          term_label: termLabel(scope.term),
          month: scope.month,
          month_name: monthName(scope.month),

          issued_at: new Date().toISOString(),
        };

        try {
          const insert = await client.query(
            `
            INSERT INTO student_certificates
              (
                school_id,
                certificate_type,
                academic_year_id,
                term,
                month,
                student_id,
                stage_id,
                grade_id,
                section_id,
                title,
                status,
                snapshot_json,
                issued_by_user_id,
                created_at,
                updated_at
              )
            VALUES
              (
                $1,
                'monthly',
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                'شهادة شكر وتقدير',
                'issued',
                $9::jsonb,
                $10,
                NOW(),
                NOW()
              )
            RETURNING
              id,
              school_id,
              certificate_type,
              academic_year_id,
              term,
              month,
              student_id,
              stage_id,
              grade_id,
              section_id,
              title,
              status,
              snapshot_json,
              created_at AS issued_at,
              printed_at
            `,
            [
              schoolId,
              scope.academicYearId,
              scope.term,
              scope.month,
              row.student_id,
              row.stage_id,
              row.grade_id,
              row.section_id,
              JSON.stringify(snapshot),
              userId,
            ]
          );

          created.push({
            ...insert.rows[0],
            full_name: row.full_name,
            student_code: row.student_code,
          });
        } catch (err) {
          if (err?.code === "23505") {
            skipped.push(row.student_id);
            continue;
          }

          throw err;
        }
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        message:
          created.length > 0
            ? `تم إصدار ${created.length} شهادة شهرية. تم تخطي ${skipped.length}.`
            : `لم يتم إصدار شهادات جديدة. تم تخطي ${skipped.length} لأنها موجودة مسبقًا.`,
        items: created,
        created_count: created.length,
        skipped_count: skipped.length,
      });
    } catch (err) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("monthly certificates create error:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "خطأ في إصدار الشهادات الشهرية",
      });
    } finally {
      client.release();
    }
  },

  async markPrinted(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const id = normalizeInt(req.params.id);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "رقم الشهادة غير صالح",
        });
      }

      const { rows } = await pool.query(
        `
        UPDATE student_certificates
        SET
          status = 'printed',
          printed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND certificate_type = 'monthly'
          AND status <> 'canceled'
        RETURNING *
        `,
        [id, schoolId]
      );

      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          message: "الشهادة غير موجودة",
        });
      }

      return res.json({
        success: true,
        message: "تم تحديث حالة الطباعة",
        data: rows[0],
      });
    } catch (err) {
      console.error("monthly certificate printed error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في تحديث حالة الطباعة",
      });
    }
  },

  async remove(req, res) {
    try {
      const schoolId = getSchoolId(req);
      const id = normalizeInt(req.params.id);

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "رقم الشهادة غير صالح",
        });
      }

      const { rows } = await pool.query(
        `
        UPDATE student_certificates
        SET
          status = 'canceled',
          canceled_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND certificate_type = 'monthly'
          AND status <> 'canceled'
        RETURNING id
        `,
        [id, schoolId]
      );

      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          message: "الشهادة غير موجودة",
        });
      }

      return res.json({
        success: true,
        message: "تم حذف الشهادة",
      });
    } catch (err) {
      console.error("monthly certificate delete error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في حذف الشهادة",
      });
    }
  },
};

export default MonthlyCertificatesController;