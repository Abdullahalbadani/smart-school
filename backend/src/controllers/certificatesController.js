// backend/src/controllers/certificatesController.js
import { pool } from "../config/db.js";

const CERTIFICATE_TYPES = ["monthly", "midterm", "final"];

function normalizeCertificateType(value) {
  const type = String(value || "").trim().toLowerCase();
  return CERTIFICATE_TYPES.includes(type) ? type : null;
}

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

  return [
    ...new Set(
      value
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
}

function getSchoolId(req) {
  return req.user?.school_id || req.user?.school?.id || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
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

function certificateTitle(type) {
  if (type === "monthly") return "شهادة شكر وتقدير";
  if (type === "midterm") return "شهادة تقدير وتفوق";
  if (type === "final") return "شهادة تقدير نهاية العام";

  return "شهادة تقدير";
}

function certificateOccasion(type, scope) {
  if (type === "monthly") {
    return `${monthName(scope.month)} - ${termLabel(scope.term)}`;
  }

  if (type === "midterm") {
    return "منتصف العام الدراسي";
  }

  if (type === "final") {
    return "نهاية العام الدراسي";
  }

  return "";
}

function certificateMessage(type) {
  if (type === "monthly") {
    return "تقديرًا لتميزك خلال هذا الشهر، وتهانينا لك على جهدك الجميل وسلوكك الرائع.";
  }

  if (type === "midterm") {
    return "تقديرًا لتميزك خلال الفصل الدراسي الأول، وتهانينا لك على هذا الإنجاز الجميل.";
  }

  if (type === "final") {
    return "تقديرًا لتميزك خلال العام الدراسي، وتهانينا لك على جهدك وتفوقك المستمر.";
  }

  return "تقديرًا لجهودك وتميزك، مع أطيب الأمنيات بمزيد من النجاح والتوفيق.";
}

function validateScope(type, source) {
  const academicYearId = normalizeInt(source.academic_year_id);
  const stageId = normalizeInt(source.stage_id);
  const gradeId = normalizeInt(source.grade_id);
  const sectionId = normalizeInt(source.section_id);

  if (!academicYearId) throw new Error("اختر السنة الدراسية.");
  if (!stageId) throw new Error("اختر المرحلة.");
  if (!gradeId) throw new Error("اختر الصف.");
  if (!sectionId) throw new Error("اختر الشعبة.");

  if (type === "monthly") {
    const term = normalizeTerm(source.term);
    const month = normalizeMonth(source.month);

    if (!term) throw new Error("اختر الفصل الدراسي.");
    if (!month) throw new Error("اختر الشهر.");

    return {
      academicYearId,
      term,
      month,
      stageId,
      gradeId,
      sectionId,
    };
  }

  if (type === "midterm") {
    return {
      academicYearId,
      term: 1,
      month: null,
      stageId,
      gradeId,
      sectionId,
    };
  }

  if (type === "final") {
    return {
      academicYearId,
      term: null,
      month: null,
      stageId,
      gradeId,
      sectionId,
    };
  }

  throw new Error("نوع الشهادة غير صالح.");
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

function certificateJoinCondition(type) {
  if (type === "monthly") {
    return `
      c.certificate_type = 'monthly'
      AND c.academic_year_id = se.academic_year_id
      AND c.term = $6
      AND c.month = $7
      AND c.student_id = se.student_id
      AND c.status <> 'canceled'
    `;
  }

  if (type === "midterm") {
    return `
      c.certificate_type = 'midterm'
      AND c.academic_year_id = se.academic_year_id
      AND c.term = 1
      AND c.month IS NULL
      AND c.student_id = se.student_id
      AND c.status <> 'canceled'
    `;
  }

  return `
    c.certificate_type = 'final'
    AND c.academic_year_id = se.academic_year_id
    AND c.student_id = se.student_id
    AND c.status <> 'canceled'
  `;
}
async function loadStudentsForCertificates(client, schoolId, type, scope) {
  const joinCondition = certificateJoinCondition(type);

  const params =
    type === "monthly"
      ? [
          schoolId,
          scope.academicYearId,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
          scope.term,
          scope.month,
        ]
      : [
          schoolId,
          scope.academicYearId,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
        ];

  const enrollmentWhere = `
    se.school_id = $1
    AND se.academic_year_id = $2
    AND se.stage_id = $3
    AND se.grade_id = $4
    AND se.section_id = $5
  `;

  const { rows } = await client.query(
    `
    SELECT DISTINCT ON (s.id)
      s.id AS student_id,
      s.full_name,
      s.student_code,

      se.roll_number,
      se.academic_year_id,
      se.term AS enrollment_term,
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
      AND ${joinCondition}

    WHERE ${enrollmentWhere}

    ORDER BY
      s.id,
      se.created_at DESC NULLS LAST,
      se.roll_number NULLS LAST
    `,
    params
  );

  rows.sort((a, b) => {
    const ra = a.roll_number == null ? 999999 : Number(a.roll_number);
    const rb = b.roll_number == null ? 999999 : Number(b.roll_number);

    if (ra !== rb) return ra - rb;

    return String(a.full_name || "").localeCompare(String(b.full_name || ""), "ar");
  });

  return rows;
}
function mapStudentRow(row) {
  return {
    student_id: row.student_id,
    full_name: row.full_name,
    student_code: row.student_code,
    roll_number: row.roll_number,

    academic_year_id: row.academic_year_id,
    enrollment_term: row.enrollment_term,

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
  };
}

async function insertCertificateIfMissing(client, options) {
  const {
    schoolId,
    type,
    scope,
    studentId,
    stageId,
    gradeId,
    sectionId,
    title,
    snapshot,
    userId,
  } = options;

  let existsCondition = "";

  if (type === "monthly") {
    existsCondition = `
      c.school_id = $1
      AND c.certificate_type = $2
      AND c.academic_year_id = $3
      AND c.term = $4
      AND c.month = $5
      AND c.student_id = $6
      AND c.status <> 'canceled'
    `;
  } else if (type === "midterm") {
    existsCondition = `
      c.school_id = $1
      AND c.certificate_type = $2
      AND c.academic_year_id = $3
      AND c.term = 1
      AND c.month IS NULL
      AND c.student_id = $6
      AND c.status <> 'canceled'
    `;
  } else {
    existsCondition = `
      c.school_id = $1
      AND c.certificate_type = $2
      AND c.academic_year_id = $3
      AND c.student_id = $6
      AND c.status <> 'canceled'
    `;
  }

  const { rows } = await client.query(
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
    SELECT
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      'issued',
      $11::jsonb,
      $12,
      NOW(),
      NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM student_certificates c
      WHERE ${existsCondition}
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
      type,
      scope.academicYearId,
      scope.term,
      scope.month,
      studentId,
      stageId,
      gradeId,
      sectionId,
      title,
      JSON.stringify(snapshot),
      userId,
    ]
  );

  return rows[0] || null;
}

export const CertificatesController = {
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
      console.error("certificates meta error:", err);

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
      const type = normalizeCertificateType(req.params.type);
      const schoolId = getSchoolId(req);

      if (!type) {
        return res.status(400).json({
          success: false,
          message: "نوع الشهادة غير صالح",
        });
      }

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(type, req.query);
      const rows = await loadStudentsForCertificates(client, schoolId, type, scope);

      return res.json({
        success: true,
        certificate_type: type,
        batch_ready: true,
        items: rows.map(mapStudentRow),
      });
    } catch (err) {
      console.error("certificates students error:", err);

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
      const type = normalizeCertificateType(req.params.type);
      const schoolId = getSchoolId(req);

      if (!type) {
        return res.status(400).json({
          success: false,
          message: "نوع الشهادة غير صالح",
        });
      }

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(type, req.query);

      let params;
      let whereExtra;

      if (type === "monthly") {
        params = [
          schoolId,
          type,
          scope.academicYearId,
          scope.term,
          scope.month,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
        ];

        whereExtra = `
          AND c.term = $4
          AND c.month = $5
          AND c.stage_id = $6
          AND c.grade_id = $7
          AND c.section_id = $8
        `;
      } else if (type === "midterm") {
        params = [
          schoolId,
          type,
          scope.academicYearId,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
        ];

        whereExtra = `
          AND c.term = 1
          AND c.month IS NULL
          AND c.stage_id = $4
          AND c.grade_id = $5
          AND c.section_id = $6
        `;
      } else {
        params = [
          schoolId,
          type,
          scope.academicYearId,
          scope.stageId,
          scope.gradeId,
          scope.sectionId,
        ];

        whereExtra = `
          AND c.stage_id = $4
          AND c.grade_id = $5
          AND c.section_id = $6
        `;
      }

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
          AND c.certificate_type = $2
          AND c.academic_year_id = $3
          AND c.status <> 'canceled'
          ${whereExtra}

        ORDER BY
          c.created_at DESC,
          c.id DESC
        `,
        params
      );

      return res.json({
        success: true,
        certificate_type: type,
        items: rows,
      });
    } catch (err) {
      console.error("certificates list error:", err);

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
      const type = normalizeCertificateType(req.params.type);
      const schoolId = getSchoolId(req);
      const userId = getUserId(req);

      if (!type) {
        return res.status(400).json({
          success: false,
          message: "نوع الشهادة غير صالح",
        });
      }

      if (!schoolId) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح: لم يتم تحديد المدرسة",
        });
      }

      const scope = validateScope(type, req.body);
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
      const title = certificateTitle(type);

      const allRows = await loadStudentsForCertificates(client, schoolId, type, scope);
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
          certificate_type: type,
          title,
          occasion: certificateOccasion(type, scope),
          message: certificateMessage(type),

          school_id: school.id,
          school_name: school.name,
          logo_url: school.logo_url,
          principal_name: school.principal_name,

          student_id: row.student_id,
          student_name: row.full_name,
          student_code: row.student_code,
          roll_number: row.roll_number,

          academic_year_id: scope.academicYearId,
          term: scope.term,
          term_label: scope.term ? termLabel(scope.term) : null,
          month: scope.month,
          month_name: scope.month ? monthName(scope.month) : null,

          stage_id: row.stage_id,
          grade_id: row.grade_id,
          section_id: row.section_id,
          stage_name: row.stage_name,
          grade_name: row.grade_name,
          section_name: row.section_name,

          issued_at: new Date().toISOString(),
        };

        try {
          const inserted = await insertCertificateIfMissing(client, {
            schoolId,
            type,
            scope,
            studentId: row.student_id,
            stageId: row.stage_id,
            gradeId: row.grade_id,
            sectionId: row.section_id,
            title,
            snapshot,
            userId,
          });

          if (!inserted) {
            skipped.push(row.student_id);
            continue;
          }

          created.push({
            ...inserted,
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
        certificate_type: type,
        message:
          created.length > 0
            ? `تم إصدار ${created.length} شهادة. تم تخطي ${skipped.length}.`
            : `لم يتم إصدار شهادات جديدة. تم تخطي ${skipped.length} لأنها موجودة مسبقًا.`,
        items: created,
        created_count: created.length,
        skipped_count: skipped.length,
      });
    } catch (err) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("certificates create error:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "خطأ في إصدار الشهادات",
      });
    } finally {
      client.release();
    }
  },

  async markPrinted(req, res) {
    try {
      const type = normalizeCertificateType(req.params.type);
      const schoolId = getSchoolId(req);
      const id = normalizeInt(req.params.id);

      if (!type) {
        return res.status(400).json({
          success: false,
          message: "نوع الشهادة غير صالح",
        });
      }

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
          AND certificate_type = $3
          AND status <> 'canceled'
        RETURNING *
        `,
        [id, schoolId, type]
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
      console.error("certificate printed error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في تحديث حالة الطباعة",
      });
    }
  },

  async remove(req, res) {
    try {
      const type = normalizeCertificateType(req.params.type);
      const schoolId = getSchoolId(req);
      const id = normalizeInt(req.params.id);

      if (!type) {
        return res.status(400).json({
          success: false,
          message: "نوع الشهادة غير صالح",
        });
      }

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
          AND certificate_type = $3
          AND status <> 'canceled'
        RETURNING id
        `,
        [id, schoolId, type]
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
      console.error("certificate delete error:", err);

      return res.status(500).json({
        success: false,
        message: "خطأ في حذف الشهادة",
      });
    }
  },
};

export default CertificatesController;