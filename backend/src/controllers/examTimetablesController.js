// src/controllers/examTimetablesController.js
import { pool } from "../config/db.js";
import WorkflowNotifications from "../modules/notifications/workflowNotificationService.js";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidExamType(t) {
  return ["monthly", "midyear", "final"].includes(String(t || ""));
}

function isValidScope(s) {
  return ["grade", "section"].includes(String(s || ""));
}

function isValidDateISO(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
}

function isValidTimeHHMM(t) {
  return /^\d{2}:\d{2}$/.test(String(t || ""));
}

function timeLess(a, b) {
  return String(a) < String(b);
}

const months = [
  { id: 1, name: "يناير" },
  { id: 2, name: "فبراير" },
  { id: 3, name: "مارس" },
  { id: 4, name: "أبريل" },
  { id: 5, name: "مايو" },
  { id: 6, name: "يونيو" },
  { id: 7, name: "يوليو" },
  { id: 8, name: "أغسطس" },
  { id: 9, name: "سبتمبر" },
  { id: 10, name: "أكتوبر" },
  { id: 11, name: "نوفمبر" },
  { id: 12, name: "ديسمبر" },
];

// ==============================
// ✅ تطبيع الأرقام العربية/الفارسية → إنجليزية
// ==============================
function toLatinDigits(str) {
  const s = String(str ?? "");
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  return s
    .split("")
    .map((ch) => {
      const ia = ar.indexOf(ch);
      if (ia !== -1) return String(ia);
      const ifa = fa.indexOf(ch);
      if (ifa !== -1) return String(ifa);
      return ch;
    })
    .join("");
}

function isRealDateParts(y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d))
    return false;
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function normalizeDateISO(input) {
  let s = toLatinDigits(String(input || "")).trim();
  if (!s) return null;

  s = s.replace(/\./g, "/").replace(/-/g, "/").replace(/\s+/g, "");

  const m1 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    if (!isRealDateParts(y, mo, d)) return null;
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(
      2,
      "0"
    )}-${String(d).padStart(2, "0")}`;
  }

  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const d = Number(m2[1]);
    const mo = Number(m2[2]);
    const y = Number(m2[3]);
    if (!isRealDateParts(y, mo, d)) return null;
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(
      2,
      "0"
    )}-${String(d).padStart(2, "0")}`;
  }

  return null;
}

function normalizeTimeHHMM(input) {
  let s = toLatinDigits(String(input || "")).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!m) return null;

  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;

  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

async function tryQuery(primarySql, fallbackSql, params = []) {
  try {
    return await pool.query(primarySql, params);
  } catch (e) {
    if (fallbackSql) {
      // 🟢 تصحيح ESLint: no-useless-catch (لا حاجة لـ try/catch إضافية هنا)
      return await pool.query(fallbackSql, params);
    }
    throw e;
  }
}

export const ExamTimetablesController = {
  // =========================
  // GET /api/exam-timetables/meta
  // =========================
  async meta(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const [years, stages, grades, sections, subjects] = await Promise.all([
        pool.query("SELECT id, name FROM academic_years WHERE school_id = $1 ORDER BY id DESC", [schoolId]),
        pool.query("SELECT id, name FROM stages WHERE school_id = $1 ORDER BY id", [schoolId]),
        tryQuery(
          "SELECT id, name, stage_id FROM grades WHERE school_id = $1 ORDER BY id",
          "SELECT id, name FROM grades WHERE school_id = $1 ORDER BY id",
          [schoolId]
        ),
        tryQuery(
          "SELECT id, name, grade_id FROM sections WHERE school_id = $1 ORDER BY id",
          "SELECT id, name FROM sections WHERE school_id = $1 ORDER BY id",
          [schoolId]
        ),
        pool.query(
          "SELECT id, name FROM subjects WHERE school_id = $1 AND is_active=true ORDER BY name",
          [schoolId]
        ),
      ]);

      const examTypes = [
        { id: "monthly", name: "اختبار شهري" },
        { id: "midyear", name: "اختبار نصف العام" },
        { id: "final", name: "اختبار آخر العام" },
      ];

      const scopes = [
        { id: "grade", name: "الصف كامل (كل الشعب)" },
        { id: "section", name: "شعبة محددة" },
      ];

      return res.json({
        data: {
          years: years.rows,
          stages: stages.rows,
          grades: grades.rows,
          sections: sections.rows,
          subjects: subjects.rows,
          months,
          examTypes,
          scopes,
        },
      });
    } catch (e) {
      console.error("exam meta error:", e);
      return res
        .status(500)
        .json({ message: "خطأ في تحميل بيانات جدول الاختبارات" });
    }
  },

  // =========================
  // GET /api/exam-timetables/list
  // =========================
  async list(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const academicYearId = toInt(req.query.academicYearId);
      const examType = String(req.query.examType || "");
      const month = toInt(req.query.month);
      const stageId = toInt(req.query.stageId);
      const gradeId = toInt(req.query.gradeId);
      const scope = String(req.query.scope || "");
      const sectionId = toInt(req.query.sectionId);

      if (!academicYearId)
        return res.status(400).json({ message: "academicYearId مطلوب" });

      const safeMonth = examType === "monthly" ? month : null;

      const wh = ["et.school_id = $1", "et.academic_year_id = $2"];
      const params = [schoolId, academicYearId];
      let idx = 3;

      if (examType) {
        wh.push(`et.exam_type = $${idx++}`);
        params.push(examType);
      }
      if (safeMonth) {
        wh.push(`et.month = $${idx++}`);
        params.push(safeMonth);
      }
      if (stageId) {
        wh.push(`et.stage_id = $${idx++}`);
        params.push(stageId);
      }
      if (gradeId) {
        wh.push(`et.grade_id = $${idx++}`);
        params.push(gradeId);
      }
      if (scope) {
        wh.push(`et.scope = $${idx++}`);
        params.push(scope);
      }
      if (scope === "section" && sectionId) {
        wh.push(`et.section_id = $${idx++}`);
        params.push(sectionId);
      }

      const q = `
        SELECT
          et.id, et.academic_year_id, ay.name AS year_name,
          et.exam_type, et.month,
          et.stage_id, st.name AS stage_name,
          et.grade_id, gr.name AS grade_name,
          et.scope,
          et.section_id, sc.name AS section_name,
          et.status,
          (SELECT COUNT(*)::int FROM exam_timetable_entries e WHERE e.exam_timetable_id = et.id) AS entries_count,
          et.updated_at
        FROM exam_timetables et
        JOIN academic_years ay ON ay.id = et.academic_year_id
        JOIN stages st ON st.id = et.stage_id
        JOIN grades gr ON gr.id = et.grade_id
        LEFT JOIN sections sc ON sc.id = et.section_id
        WHERE ${wh.join(" AND ")}
        ORDER BY et.id DESC
        LIMIT 300
      `;

      const rows = await pool.query(q, params);
      return res.json({ data: rows.rows });
    } catch (e) {
      console.error("exam list error:", e);
      return res
        .status(500)
        .json({ message: "خطأ في جلب قائمة جداول الاختبارات" });
    }
  },

  // ==================================
  // POST /api/exam-timetables/get-or-create
  // ==================================
  async getOrCreate(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const academicYearId = toInt(req.body.academicYearId);
      const stageId = toInt(req.body.stageId);
      const gradeId = toInt(req.body.gradeId);
      const scope = String(req.body.scope || "");
      const sectionId = toInt(req.body.sectionId);
      const examType = String(req.body.examType || "");
      const month = toInt(req.body.month);

      if (!academicYearId || !stageId || !gradeId) {
        return res
          .status(400)
          .json({ message: "بيانات ناقصة (السنة/المرحلة/الصف)" });
      }
      if (!isValidScope(scope))
        return res.status(400).json({ message: "scope غير صحيح" });
      if (!isValidExamType(examType))
        return res.status(400).json({ message: "examType غير صحيح" });

      if (examType === "monthly" && !month) {
        return res.status(400).json({ message: "month مطلوب للاختبار الشهري" });
      }
      if (examType !== "monthly" && month) {
        return res
          .status(400)
          .json({ message: "month يجب أن يكون فارغ لغير الشهري" });
      }
      if (scope === "section" && !sectionId) {
        return res
          .status(400)
          .json({ message: "sectionId مطلوب عندما scope=section" });
      }

      const found = await pool.query(
        `
        SELECT * FROM exam_timetables
        WHERE school_id=$1 
          AND academic_year_id=$2
          AND stage_id=$3
          AND grade_id=$4
          AND scope=$5
          AND exam_type=$6
          AND month IS NOT DISTINCT FROM $7
          AND section_id IS NOT DISTINCT FROM $8
        LIMIT 1
        `,
        [
          schoolId,
          academicYearId,
          stageId,
          gradeId,
          scope,
          examType,
          examType === "monthly" ? month : null,
          scope === "section" ? sectionId : null,
        ]
      );

      if (found.rows.length) return res.json({ data: found.rows[0] });

      const created = await pool.query(
        `
        INSERT INTO exam_timetables
          (school_id, academic_year_id, stage_id, grade_id, scope, section_id, exam_type, month, status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
        RETURNING *
        `,
        [
          schoolId,
          academicYearId,
          stageId,
          gradeId,
          scope,
          scope === "section" ? sectionId : null,
          examType,
          examType === "monthly" ? month : null,
          req.user?.id || null,
        ]
      );

      return res.json({ data: created.rows[0] });
    } catch (e) {
      console.error("exam getOrCreate error:", e);
      return res
        .status(500)
        .json({ message: "خطأ في إنشاء/جلب جدول الاختبارات" });
    }
  },

  // =====================
  // GET /api/exam-timetables/:id
  // =====================
  async getById(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const id = toInt(req.params.id);
      if (!id) return res.status(400).json({ message: "id غير صحيح" });

      const tt = await pool.query("SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2", [
        id,
        schoolId
      ]);
      if (!tt.rows.length)
        return res.status(404).json({ message: "الجدول غير موجود" });

      const entries = await pool.query(
        `
        SELECT
          e.id,
          to_char(e.exam_date::date, 'YYYY-MM-DD') AS date,
          to_char(e.start_time,'HH24:MI') AS start_time,
          to_char(e.end_time,'HH24:MI') AS end_time,
          e.room, e.notes,
          e.subject_id, s.name AS subject_name,
          e.apply_to_section_id,
          sc.name AS apply_to_section_name
        FROM exam_timetable_entries e
        JOIN subjects s ON s.id = e.subject_id
        LEFT JOIN sections sc ON sc.id = e.apply_to_section_id
        WHERE e.exam_timetable_id=$1 AND s.school_id=$2
        ORDER BY e.exam_date, e.start_time
        `,
        [id, schoolId]
      );

      return res.json({
        data: { timetable: tt.rows[0], entries: entries.rows },
      });
    } catch (e) {
      console.error("exam getById error:", e);
      return res.status(500).json({ message: "خطأ في جلب جدول الاختبارات" });
    }
  },

  // =========================
  // PUT /api/exam-timetables/:id/entries
  // =========================
  async saveEntries(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const timetableId = toInt(req.params.id);
    const rows = Array.isArray(req.body.entries) ? req.body.entries : [];

    if (!timetableId) {
      return res.status(400).json({ message: "id غير صحيح" });
    }

    const ttQ = await client.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    if (!ttQ.rows.length) {
      return res.status(404).json({ message: "الجدول غير موجود" });
    }

    const tt = ttQ.rows[0];

    if (tt.status === "published") {
      return res.status(400).json({
        message: "لا يمكن تعديل جدول منشور، اجعله مسودة أولاً.",
      });
    }

    const clean = [];
    const slotSet = new Set();

    for (let i = 0; i < rows.length; i++) {
      const e = rows[i] || {};

      const date = normalizeDateISO(e.date || e.exam_date || "");
      const start_time = normalizeTimeHHMM(e.start_time || e.start || "");
      const end_time = normalizeTimeHHMM(e.end_time || e.end || "");

      const subjectId = toInt(e.subjectId ?? e.subject_id);
      const room = String(e.room || "").trim() || null;
      const notes = String(e.notes || "").trim() || null;
      let applyToSectionId = toInt(e.applyToSectionId ?? e.apply_to_section_id);

      const anyValue =
        e.date ||
        e.exam_date ||
        e.start_time ||
        e.end_time ||
        subjectId ||
        room ||
        notes ||
        applyToSectionId;

      if (!anyValue) continue;

      if (!date) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD أو DD/MM/YYYY.`,
        });
      }

      if (!isValidDateISO(date)) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: صيغة التاريخ غير صحيحة (YYYY-MM-DD).`,
        });
      }

      if (!subjectId) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: المادة مطلوبة.`,
        });
      }

      if (!start_time || !end_time) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: وقت (من/إلى) مطلوب.`,
        });
      }

      if (!isValidTimeHHMM(start_time) || !isValidTimeHHMM(end_time)) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: وقت غير صحيح (${start_time} - ${end_time}).`,
        });
      }

      if (!timeLess(start_time, end_time)) {
        return res.status(400).json({
          message: `السطر رقم ${i + 1}: وقت البداية يجب أن يكون أقل من النهاية.`,
        });
      }

      if (tt.scope === "section") {
        applyToSectionId = null;
      } else {
        if (!applyToSectionId || applyToSectionId <= 0) {
          applyToSectionId = null;
        }
      }

      const groupKey = applyToSectionId ? `sec:${applyToSectionId}` : "all";
      const slotKey = `${groupKey}-${date}-${start_time}-${end_time}`;

      if (slotSet.has(slotKey)) {
        return res.status(400).json({
          message: `تكرار اختبار لنفس المجموعة في نفس الوقت (السطر ${i + 1}).`,
        });
      }

      slotSet.add(slotKey);

      clean.push({
        date,
        start_time,
        end_time,
        subjectId,
        room,
        notes,
        applyToSectionId,
      });
    }

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      `,
      [timetableId]
    );

    for (const x of clean) {
      await client.query(
        `
        INSERT INTO exam_timetable_entries (
          exam_timetable_id,
          exam_date,
          start_time,
          end_time,
          subject_id,
          room,
          notes,
          apply_to_section_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          timetableId,
          x.date,
          x.start_time,
          x.end_time,
          x.subjectId,
          x.room,
          x.notes,
          x.applyToSectionId,
        ]
      );
    }

    await client.query(
      "UPDATE exam_timetables SET updated_at=now() WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "تم حفظ مسودة جدول الاختبارات بنجاح",
      data: { saved: clean.length },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in saveEntries:", rollbackError);
    }

    console.error("exam saveEntries error:", e);

    if (String(e?.code) === "23505") {
      return res.status(400).json({
        message: "يوجد تكرار في نفس الوقت لنفس المجموعة داخل الجدول.",
      });
    }

    return res.status(500).json({ message: "خطأ في حفظ جدول الاختبارات" });
  } finally {
    client.release();
  }
},

  // =========================
  // PUT /api/exam-timetables/:id/publish
  // =========================
  async publish(req, res) {
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const timetableId = toInt(req.params.id);
    if (!timetableId) return res.status(400).json({ message: "id غير صحيح" });

    const ttQ = await pool.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    if (!ttQ.rows.length) {
      return res.status(404).json({ message: "الجدول غير موجود" });
    }

    const countQ = await pool.query(
      `
      SELECT COUNT(*)::int AS c
      FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      `,
      [timetableId]
    );

    if (!countQ.rows[0].c) {
      return res.status(400).json({ message: "لا يمكن نشر جدول فارغ." });
    }

    await pool.query(
      "UPDATE exam_timetables SET status='published', updated_at=now() WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    try {
      await WorkflowNotifications.notifyExamTimetablePublication({
        app: req.app,
        schoolId,
        timetableId,
        published: true,
      });
    } catch (notifyErr) {
      console.error("Notification error (exam timetable published):", notifyErr);
    }

    return res.json({ message: "تم نشر جدول الاختبارات" });
  } catch (e) {
    console.error("exam publish error:", e);
    return res.status(500).json({ message: "خطأ في نشر جدول الاختبارات" });
  }
},

  // =========================
  // PUT /api/exam-timetables/:id/unpublish
  // =========================
  async unpublish(req, res) {
    try {
      const schoolId = req.user?.school_id;
      if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

      const timetableId = toInt(req.params.id);
      if (!timetableId) return res.status(400).json({ message: "id غير صحيح" });

      await pool.query(
        "UPDATE exam_timetables SET status='draft', updated_at=now() WHERE id=$1 AND school_id=$2",
        [timetableId, schoolId]
      );

      try {
        await WorkflowNotifications.notifyExamTimetablePublication({
          app: req.app,
          schoolId,
          timetableId,
          published: false,
        });
      } catch (notifyErr) {
        console.error("Notification error (exam timetable unpublished):", notifyErr);
      }

      return res.json({ message: "تم إرجاع جدول الاختبارات إلى مسودة" });
    } catch (e) {
      console.error("exam unpublish error:", e);
      return res.status(500).json({ message: "خطأ" });
    }
  },

  // =========================
  // DELETE /api/exam-timetables/:id/entries
  // =========================
async clearEntries(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const timetableId = toInt(req.params.id);
    if (!timetableId) return res.status(400).json({ message: "id غير صحيح" });

    const ttQ = await client.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    if (!ttQ.rows.length) {
      return res.status(404).json({ message: "الجدول غير موجود" });
    }

    const tt = ttQ.rows[0];

    if (tt.status === "published") {
      return res.status(400).json({
        message: "لا يمكن تفريغ جدول منشور، اجعله مسودة أولاً.",
      });
    }

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      `,
      [timetableId]
    );

    await client.query(
      "UPDATE exam_timetables SET updated_at=now() WHERE id=$1 AND school_id=$2",
      [timetableId, schoolId]
    );

    await client.query("COMMIT");

    return res.json({ message: "تم تفريغ جدول الاختبارات" });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in clearEntries:", rollbackError);
    }

    console.error("exam clearEntries error:", e);
    return res.status(500).json({ message: "خطأ في تفريغ جدول الاختبارات" });
  } finally {
    client.release();
  }
},

  // =========================
  // DELETE /api/exam-timetables/:id
  // =========================
 async remove(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "id غير صحيح" });

    const ttQ = await client.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [id, schoolId]
    );

    if (!ttQ.rows.length) {
      return res.status(404).json({ message: "الجدول غير موجود" });
    }

    const tt = ttQ.rows[0];

    if (tt.status === "published") {
      return res.status(400).json({
        message: "لا يمكن حذف جدول منشور. ألغِ النشر أولاً.",
      });
    }

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      `,
      [id]
    );

    await client.query(
      "DELETE FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [id, schoolId]
    );

    await client.query("COMMIT");

    return res.json({ message: "تم حذف جدول الاختبارات" });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in remove:", rollbackError);
    }

    console.error("exam remove error:", e);
    return res.status(500).json({ message: "خطأ في حذف جدول الاختبارات" });
  } finally {
    client.release();
  }
},
  // =========================
  // POST /api/exam-timetables/:id/copy-from
  // =========================
  async copyFrom(req, res) {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const targetId = toInt(req.params.id);
    const fromTimetableId = toInt(req.body?.fromTimetableId);

    if (!targetId) {
      return res.status(400).json({ message: "target id غير صحيح" });
    }

    if (!fromTimetableId) {
      return res.status(400).json({ message: "fromTimetableId مطلوب" });
    }

    const tgtQ = await client.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [targetId, schoolId]
    );

    if (!tgtQ.rows.length) {
      return res.status(404).json({ message: "الجدول الهدف غير موجود" });
    }

    const ttTarget = tgtQ.rows[0];

    if (ttTarget.status === "published") {
      return res.status(400).json({
        message: "لا يمكن النسخ إلى جدول منشور، اجعله مسودة أولاً.",
      });
    }

    const srcQ = await client.query(
      "SELECT * FROM exam_timetables WHERE id=$1 AND school_id=$2",
      [fromTimetableId, schoolId]
    );

    if (!srcQ.rows.length) {
      return res.status(404).json({ message: "الجدول المصدر غير موجود" });
    }

    const srcEntriesQ = await client.query(
      `
      SELECT
        exam_date,
        start_time,
        end_time,
        subject_id,
        room,
        notes,
        apply_to_section_id
      FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      ORDER BY exam_date, start_time
      `,
      [fromTimetableId]
    );

    await client.query("BEGIN");

    await client.query(
      `
      DELETE FROM exam_timetable_entries
      WHERE exam_timetable_id = $1
      `,
      [targetId]
    );

    for (const e of srcEntriesQ.rows) {
      const applyTo =
        ttTarget.scope === "section" ? null : e.apply_to_section_id ?? null;

      await client.query(
        `
        INSERT INTO exam_timetable_entries (
          exam_timetable_id,
          exam_date,
          start_time,
          end_time,
          subject_id,
          room,
          notes,
          apply_to_section_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          targetId,
          e.exam_date,
          e.start_time,
          e.end_time,
          e.subject_id,
          e.room,
          e.notes,
          applyTo,
        ]
      );
    }

    await client.query(
      "UPDATE exam_timetables SET updated_at=now() WHERE id=$1 AND school_id=$2",
      [targetId, schoolId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "تم نسخ جدول الاختبارات بنجاح",
      data: { fromTimetableId, targetId },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed in copyFrom:", rollbackError);
    }

    console.error("exam copyFrom error:", e);

    if (String(e?.code) === "23505") {
      return res.status(400).json({
        message: "يوجد تكرار وقت بعد النسخ داخل الجدول الهدف.",
      });
    }

    return res.status(500).json({ message: "خطأ في نسخ جدول الاختبارات" });
  } finally {
    client.release();
  }
},
};

export default ExamTimetablesController;