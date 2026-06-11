import { pool } from "../config/db.js";
import WorkflowNotifications from "../modules/notifications/workflowNotificationService.js";

/* =========================
   Helpers
========================= */

function toInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

function isISODate(value) {
  const stringValue = String(value || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return false;
  }

  const [year, month, day] = stringValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/*
  تثبيت التاريخ بصيغة YYYY-MM-DD دون السماح
  بتغيير اليوم بسبب المنطقة الزمنية.
*/
function normalizeDateOnly(value) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    return match
      ? `${match[1]}-${match[2]}-${match[3]}`
      : "";
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return "";
}

// 1=Saturday, 2=Sunday ... 7=Friday
function schoolDayIdFromISO(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(iso || "")
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const jsDay = new Date(
    Date.UTC(year, month - 1, day)
  ).getUTCDay();

  const map = {
    6: 1,
    0: 2,
    1: 3,
    2: 4,
    3: 5,
    4: 6,
    5: 7,
  };

  return map[jsDay] || null;
}

function normalizeTimeoutMinutes(value) {
  const minutes = Number(value);

  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 1440
  ) {
    return 15;
  }

  return minutes;
}

/* =========================
   Load affected timetable entries
========================= */

async function getAffectedTimetableEntries(
  db,
  permit,
  schoolId
) {
  const date = normalizeDateOnly(permit.request_date);
  const teacherId = permit.teacher_id;
  const scope = String(permit.scope || "full_day");
  const schoolDay = schoolDayIdFromISO(date);

  if (!isISODate(date) || !teacherId || !schoolDay) {
    return [];
  }

  if (scope === "slots") {
    const result = await db.query(
      `
      SELECT
        te.id,
        te.period_id,
        te.day_of_week
      FROM teacher_permission_request_slots prs
      JOIN timetable_entries te
        ON te.id = prs.timetable_entry_id
       AND te.school_id = $3
      WHERE prs.permission_request_id = $1
        AND te.teacher_id = $2
        AND te.day_of_week = $4
      ORDER BY te.period_id ASC, te.id ASC
      `,
      [permit.id, teacherId, schoolId, schoolDay]
    );

    return result.rows || [];
  }

  const result = await db.query(
    `
    SELECT
      te.id,
      te.period_id,
      te.day_of_week
    FROM timetable_entries te
    WHERE te.teacher_id = $1
      AND te.day_of_week = $2
      AND te.school_id = $3
    ORDER BY te.period_id ASC, te.id ASC
    `,
    [teacherId, schoolDay, schoolId]
  );

  return result.rows || [];
}

/* =========================
   Apply excused presence safely
========================= */

async function applyPermitPresenceSafe(
  db,
  permit,
  schoolId
) {
  const date = normalizeDateOnly(permit.request_date);
  const teacherId = permit.teacher_id;

  if (!isISODate(date) || !teacherId) {
    return;
  }

  const entries = await getAffectedTimetableEntries(
    db,
    permit,
    schoolId
  );

  if (!entries.length) {
    return;
  }

  for (const entry of entries) {
    await db.query(
      `
      INSERT INTO teacher_lesson_presence (
        school_id,
        presence_date,
        teacher_id,
        timetable_entry_id,
        status,
        permission_request_id,
        created_at
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        'excused',
        $5,
        now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM teacher_lesson_presence presence
        WHERE presence.school_id = $1
          AND presence.presence_date = $2
          AND presence.timetable_entry_id = $4
      )
      `,
      [
        schoolId,
        date,
        teacherId,
        entry.id,
        permit.id,
      ]
    );
  }
}

/* =========================
   Validate substitute teacher
========================= */

async function validateSubstituteTeacher({
  db,
  schoolId,
  absentTeacherId,
  substituteTeacherId,
  timetableEntry,
  substitutionDate,
}) {
  const result = await db.query(
    `
    SELECT
      teacher.id,
      teacher.full_name
    FROM teachers teacher
    WHERE teacher.id = $1
      AND teacher.school_id = $2
      AND teacher.is_active = TRUE
      AND teacher.id <> $3

      -- المعلم الاحتياط لا يملك حصة أصلية في التوقيت نفسه
      AND NOT EXISTS (
        SELECT 1
        FROM timetable_entries own_entry
        WHERE own_entry.teacher_id = teacher.id
          AND own_entry.school_id = $2
          AND own_entry.day_of_week = $4
          AND own_entry.period_id = $5
      )

      -- المعلم الاحتياط غير مرتبط بتغطية حصة أخرى في التوقيت نفسه
      AND NOT EXISTS (
        SELECT 1
        FROM lesson_substitutions existing_substitution
        JOIN timetable_entries existing_entry
          ON existing_entry.id =
             existing_substitution.timetable_entry_id
         AND existing_entry.school_id = $2
        WHERE existing_substitution.school_id = $2
          AND existing_substitution.substitution_date = $6
          AND existing_substitution.substitute_teacher_id =
              teacher.id
          AND existing_entry.period_id = $5
          AND existing_substitution.status IN (
            'pending_teacher',
            'accepted'
          )
          AND existing_substitution.timetable_entry_id <> $7
      )

    LIMIT 1
    `,
    [
      substituteTeacherId,
      schoolId,
      absentTeacherId,
      timetableEntry.day_of_week,
      timetableEntry.period_id,
      substitutionDate,
      timetableEntry.id,
    ]
  );

  return result.rows?.[0] || null;
}

/* =========================
   Background timer
========================= */

function scheduleSubstitutionExpiry({
  app,
  schoolId,
  substitutionId,
  substituteTeacherId,
  timeoutMinutes,
}) {
  const timeoutMs =
    normalizeTimeoutMinutes(timeoutMinutes) * 60 * 1000;

  setTimeout(async () => {
    const client = await pool.connect();

    try {
      /*
        التحديث مشروط بالحالة pending_teacher.
        إذا رد المعلم قبل انتهاء الوقت فلن يتحول إلى expired.
      */
      const expireResult = await client.query(
        `
        UPDATE lesson_substitutions
        SET status = 'expired'
        WHERE id = $1
          AND school_id = $2
          AND status = 'pending_teacher'
        RETURNING id
        `,
        [substitutionId, schoolId]
      );

      if (expireResult.rowCount === 0) {
        return;
      }

      const teacherResult = await client.query(
        `
        SELECT full_name
        FROM teachers
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [substituteTeacherId, schoolId]
      );

      const teacherName =
        teacherResult.rows?.[0]?.full_name || "المعلم";

      const io = app.get("io");

      if (io) {
        io.to(`school_${schoolId}`).emit(
          "substitute_rejected",
          {
            teacherName:
              `${teacherName} (تجاهل الطلب - انتهى الوقت ⏱️)`,
          }
        );

        io.to(`school_${schoolId}`).emit(
          "refresh_admin_permits"
        );

        io.to(`school_${schoolId}`).emit(
          "refresh_substitutions"
        );
      }

      try {
        await WorkflowNotifications.notifySubstitutionResponse({
          app,
          schoolId,
          substitutionId,
          status: "expired",
        });
      } catch (notificationError) {
        console.error(
          "Notification error (substitution expired):",
          notificationError
        );
      }

      console.log(
        `⏱️ [Auto-Escalation] انتهت مهلة الأستاذ ${teacherName} (School: ${schoolId})`
      );
    } catch (error) {
      console.error("Substitution timer error:", error);
    } finally {
      client.release();
    }
  }, timeoutMs);
}

/* =========================
   Controller
========================= */

export const AdminTeacherPermitsController = {
  /*
    GET /api/admin/teacher-permits
    Query: status, from, to, q, count
  */
  async list(req, res) {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({
        message: "غير مصرح",
      });
    }

    const status = String(
      req.query.status || ""
    ).toLowerCase();

    const from = String(
      req.query.from || ""
    ).slice(0, 10);

    const to = String(
      req.query.to || ""
    ).slice(0, 10);

    const search = String(
      req.query.q || ""
    ).trim();

    const wantCount =
      String(req.query.count || "") === "1";

    const where = [];
    const params = [];

    params.push(schoolId);
    where.push(`request.school_id = $${params.length}`);

    if (status) {
      params.push(status);
      where.push(`request.status = $${params.length}`);
    }

    if (isISODate(from)) {
      params.push(from);
      where.push(
        `request.request_date >= $${params.length}`
      );
    }

    if (isISODate(to)) {
      params.push(to);
      where.push(
        `request.request_date <= $${params.length}`
      );
    }

    if (search) {
      params.push(`%${search}%`);
      where.push(
        `teacher.full_name ILIKE $${params.length}`
      );
    }

    const whereSql = where.length
      ? `WHERE ${where.join(" AND ")}`
      : "";

    const client = await pool.connect();

    try {
      if (wantCount) {
        const result = await client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM teacher_permission_requests request
          JOIN teachers teacher
            ON teacher.id = request.teacher_id
           AND teacher.school_id = request.school_id
          ${whereSql}
          `,
          params
        );

        return res.json({
          count: result.rows?.[0]?.count ?? 0,
        });
      }

      const result = await client.query(
        `
        SELECT
          request.id,
          request.teacher_id,
          teacher.full_name AS teacher_name,
          request.request_date::text AS request_date,
          request.scope,
          request.status,
          request.reason_text,
          request.notes,
          request.requested_at,
          request.decided_at,
          request.decision_note,
          request.decided_by_user_id
        FROM teacher_permission_requests request
        JOIN teachers teacher
          ON teacher.id = request.teacher_id
         AND teacher.school_id = request.school_id
        ${whereSql}
        ORDER BY request.requested_at DESC, request.id DESC
        LIMIT 500
        `,
        params
      );

      return res.json({
        items: result.rows || [],
      });
    } catch (error) {
      console.error("Permits list error:", error);

      return res.status(500).json({
        message: "Server error",
      });
    } finally {
      client.release();
    }
  },

  /*
    GET /api/admin/teacher-permits/:id
  */
  async getOne(req, res) {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({
        message: "غير مصرح",
      });
    }

    const id = toInt(req.params.id);

    if (!id) {
      return res.status(400).json({
        message: "Invalid id",
      });
    }

    const client = await pool.connect();

    try {
      const permitResult = await client.query(
        `
        SELECT
          request.*,
          teacher.full_name AS teacher_name
        FROM teacher_permission_requests request
        JOIN teachers teacher
          ON teacher.id = request.teacher_id
         AND teacher.school_id = request.school_id
        WHERE request.id = $1
          AND request.school_id = $2
        LIMIT 1
        `,
        [id, schoolId]
      );

      const permit = permitResult.rows?.[0];

      if (!permit) {
        return res.status(404).json({
          message: "Not found",
        });
      }

      const requestDate = normalizeDateOnly(
        permit.request_date
      );

      if (!isISODate(requestDate)) {
        return res.status(400).json({
          message: "Invalid permit request date",
        });
      }

      /*
        نعيد التاريخ كنص ثابت إلى الواجهة حتى لا يتحول
        إلى يوم مختلف بسبب المنطقة الزمنية.
      */
      permit.request_date = requestDate;

      const scope = String(
        permit.scope || "full_day"
      );

      let slotsResult;

      /*
        عند إذن الحصص المحددة:
        نعرض الحصص المحفوظة في جدول تفاصيل الطلب.
      */
      if (scope === "slots") {
        slotsResult = await client.query(
          `
          SELECT
            request_slot.id,
            entry.id AS timetable_entry_id,
            entry.period_id,
            entry.day_of_week,
            period.name AS period_name,
            period.start_time,
            period.end_time,
            subject.name AS subject_name,
            section.name AS section_name,
            grade.name AS grade_name,
            stage.name AS stage_name,
            substitution.id AS substitution_id,
            substitution.status AS sub_status,
            substitute_teacher.full_name AS substitute_name
          FROM teacher_permission_request_slots request_slot
          JOIN timetable_entries entry
            ON entry.id = request_slot.timetable_entry_id
           AND entry.school_id = $3
          LEFT JOIN periods period
            ON period.id = entry.period_id
          LEFT JOIN subjects subject
            ON subject.id = entry.subject_id
          LEFT JOIN timetables timetable
            ON timetable.id = entry.timetable_id
          LEFT JOIN sections section
            ON section.id = timetable.section_id
          LEFT JOIN grades grade
            ON grade.id = section.grade_id
          LEFT JOIN stages stage
            ON stage.id = grade.stage_id
          LEFT JOIN lesson_substitutions substitution
            ON substitution.timetable_entry_id = entry.id
           AND substitution.substitution_date = $2
           AND substitution.school_id = $3
          LEFT JOIN teachers substitute_teacher
            ON substitute_teacher.id =
               substitution.substitute_teacher_id
           AND substitute_teacher.school_id = $3
          WHERE request_slot.permission_request_id = $1
            AND entry.teacher_id = $4
          ORDER BY entry.period_id ASC, entry.id ASC
          `,
          [
            id,
            requestDate,
            schoolId,
            permit.teacher_id,
          ]
        );
      } else {
        /*
          عند إذن اليوم الكامل:
          لا توجد صفوف داخل teacher_permission_request_slots.
          لذلك نجلب جميع حصص المعلم في اليوم المحدد مباشرة
          من جدول timetable_entries.
        */
        const schoolDay = schoolDayIdFromISO(
          requestDate
        );

        if (!schoolDay) {
          return res.json({
            permit,
            slots: [],
          });
        }

        slotsResult = await client.query(
          `
          SELECT
            entry.id,
            entry.id AS timetable_entry_id,
            entry.period_id,
            entry.day_of_week,
            period.name AS period_name,
            period.start_time,
            period.end_time,
            subject.name AS subject_name,
            section.name AS section_name,
            grade.name AS grade_name,
            stage.name AS stage_name,
            substitution.id AS substitution_id,
            substitution.status AS sub_status,
            substitute_teacher.full_name AS substitute_name
          FROM timetable_entries entry
          LEFT JOIN periods period
            ON period.id = entry.period_id
          LEFT JOIN subjects subject
            ON subject.id = entry.subject_id
          LEFT JOIN timetables timetable
            ON timetable.id = entry.timetable_id
          LEFT JOIN sections section
            ON section.id = timetable.section_id
          LEFT JOIN grades grade
            ON grade.id = section.grade_id
          LEFT JOIN stages stage
            ON stage.id = grade.stage_id
          LEFT JOIN lesson_substitutions substitution
            ON substitution.timetable_entry_id = entry.id
           AND substitution.substitution_date = $4
           AND substitution.school_id = $3
          LEFT JOIN teachers substitute_teacher
            ON substitute_teacher.id =
               substitution.substitute_teacher_id
           AND substitute_teacher.school_id = $3
          WHERE entry.teacher_id = $1
            AND entry.day_of_week = $2
            AND entry.school_id = $3
          ORDER BY entry.period_id ASC, entry.id ASC
          `,
          [
            permit.teacher_id,
            schoolDay,
            schoolId,
            requestDate,
          ]
        );
      }

      const slots = slotsResult.rows || [];

      /*
        نظام الرادار:
        لكل حصة نبحث عن المعلمين المتاحين في المدرسة نفسها.
      */
      for (const slot of slots) {
        const availableTeachersResult =
          await client.query(
            `
            SELECT
              teacher.id,
              teacher.full_name
            FROM teachers teacher
            WHERE teacher.school_id = $5
              AND teacher.is_active = TRUE
              AND teacher.id <> $1

              -- لا يملك حصة أصلية في التوقيت نفسه
              AND NOT EXISTS (
                SELECT 1
                FROM timetable_entries own_entry
                WHERE own_entry.teacher_id = teacher.id
                  AND own_entry.school_id = $5
                  AND own_entry.day_of_week = $2
                  AND own_entry.period_id = $3
              )

              -- لا يغطي حصة بديلة أخرى في التوقيت نفسه
              AND NOT EXISTS (
                SELECT 1
                FROM lesson_substitutions existing_substitution
                JOIN timetable_entries existing_entry
                  ON existing_entry.id =
                     existing_substitution.timetable_entry_id
                 AND existing_entry.school_id = $5
                WHERE existing_substitution.school_id = $5
                  AND existing_substitution.substitution_date = $4
                  AND existing_substitution.substitute_teacher_id =
                      teacher.id
                  AND existing_entry.period_id = $3
                  AND existing_substitution.status IN (
                    'pending_teacher',
                    'accepted'
                  )
                  AND existing_substitution.id <>
                      COALESCE($6::int, -1)
              )

            ORDER BY teacher.full_name ASC
            `,
            [
              permit.teacher_id,
              slot.day_of_week,
              slot.period_id,
              requestDate,
              schoolId,
              slot.substitution_id || null,
            ]
          );

        slot.available_teachers =
          availableTeachersResult.rows || [];
      }

      return res.json({
        permit,
        slots,
      });
    } catch (error) {
      console.error("Get one permit error:", error);

      return res.status(500).json({
        message: "Server error",
      });
    } finally {
      client.release();
    }
  },

  /*
    PATCH /api/admin/teacher-permits/:id/decision

    Body:
    {
      status: "approved" | "rejected",
      decision_note?: string,
      substitutes?: [
        {
          entry_id,
          substitute_id,
          timeout_minutes
        }
      ]
    }
  */
  async decide(req, res) {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({
        message: "غير مصرح",
      });
    }

    const id = toInt(req.params.id);

    const requestedStatus = String(
      req.body?.status || ""
    ).toLowerCase();

    const decisionNote = String(
      req.body?.decision_note || ""
    ).trim();

    const userId = req.user?.id ?? null;

    if (!id) {
      return res.status(400).json({
        message: "Invalid id",
      });
    }

    if (
      !["approved", "rejected"].includes(requestedStatus)
    ) {
      return res.status(400).json({
        message: "الحالة المطلوبة غير صالحة",
      });
    }

    const rawSubstitutes = Array.isArray(
      req.body?.substitutes
    )
      ? req.body.substitutes
      : [];

    const substitutes = [];
    const seenEntryIds = new Set();

    for (const item of rawSubstitutes) {
      const entryId = toInt(
        item?.entry_id ??
          item?.timetable_entry_id
      );

      const substituteId = toInt(
        item?.substitute_id ??
          item?.substitute_teacher_id
      );

      if (!entryId || !substituteId) {
        return res.status(400).json({
          message:
            "بيانات تعيين معلم الاحتياط غير مكتملة",
        });
      }

      if (seenEntryIds.has(entryId)) {
        return res.status(400).json({
          message:
            "تم إرسال الحصة نفسها أكثر من مرة",
        });
      }

      seenEntryIds.add(entryId);

      substitutes.push({
        entryId,
        substituteId,
        timeoutMinutes: normalizeTimeoutMinutes(
          item?.timeout_minutes
        ),
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const permitResult = await client.query(
        `
        SELECT *
        FROM teacher_permission_requests
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [id, schoolId]
      );

      const permit = permitResult.rows?.[0];

      if (!permit) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Not found",
        });
      }

      const permitDate = normalizeDateOnly(
        permit.request_date
      );

      if (!isISODate(permitDate)) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "تاريخ طلب الإذن غير صالح",
        });
      }

      permit.request_date = permitDate;

      const currentStatus = String(
        permit.status || ""
      ).toLowerCase();

      if (
        currentStatus !== "pending" &&
        currentStatus !== "approved"
      ) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message: "تم البت في هذا الطلب مسبقًا",
        });
      }

      /*
        بعد قبول الإذن لا نسمح بتحويله إلى مرفوض.
        يمكن فقط تحديث معلمي الاحتياط.
      */
      if (
        currentStatus === "approved" &&
        requestedStatus !== "approved"
      ) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          message:
            "لا يمكن تحويل الإذن المقبول إلى مرفوض. يمكنك فقط تحديث معلمي الاحتياط.",
        });
      }

      /*
        عند تحديث إذن مقبول يجب اختيار معلم احتياط فعليًا،
        حتى لا تظهر رسالة نجاح وهمية في الواجهة.
      */
      if (
        currentStatus === "approved" &&
        requestedStatus === "approved" &&
        substitutes.length === 0
      ) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message:
            "اختر معلمًا احتياطًا واحدًا على الأقل قبل الحفظ.",
        });
      }

      const affectedEntries =
        await getAffectedTimetableEntries(
          client,
          permit,
          schoolId
        );

      const affectedEntriesMap = new Map(
        affectedEntries.map((entry) => [
          Number(entry.id),
          entry,
        ])
      );

      /*
        التحقق الأمني من جميع التعيينات داخل الباك إند.
        لا نعتمد على القيم القادمة من المتصفح.
      */
      const selectedTeacherPeriods = new Set();

      for (const substitution of substitutes) {
        const timetableEntry =
          affectedEntriesMap.get(
            substitution.entryId
          );

        if (!timetableEntry) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            message:
              "إحدى الحصص المحددة لا تنتمي إلى طلب الإذن الحالي.",
          });
        }

        const teacherPeriodKey =
          `${substitution.substituteId}:${timetableEntry.period_id}`;

        if (
          selectedTeacherPeriods.has(
            teacherPeriodKey
          )
        ) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            message:
              "لا يمكن تعيين المعلم الاحتياط نفسه لحصتين في التوقيت نفسه.",
          });
        }

        selectedTeacherPeriods.add(
          teacherPeriodKey
        );

        const validTeacher =
          await validateSubstituteTeacher({
            db: client,
            schoolId,
            absentTeacherId:
              permit.teacher_id,
            substituteTeacherId:
              substitution.substituteId,
            timetableEntry,
            substitutionDate: permitDate,
          });

        if (!validTeacher) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            message:
              "أحد المعلمين المختارين غير متاح في توقيت الحصة أو لا ينتمي إلى المدرسة الحالية.",
          });
        }
      }

      let updatedPermit = permit;
      let decisionChanged = false;

      /*
        تغيير حالة الطلب يحدث عند اتخاذ القرار أول مرة فقط.
      */
      if (currentStatus === "pending") {
        const updateResult = await client.query(
          `
          UPDATE teacher_permission_requests
          SET
            status = $2,
            decided_at = now(),
            decided_by_user_id = $3,
            decision_note = $4,
            updated_at = now()
          WHERE id = $1
            AND school_id = $5
          RETURNING *
          `,
          [
            id,
            requestedStatus,
            userId,
            decisionNote || null,
            schoolId,
          ]
        );

        updatedPermit = updateResult.rows[0];

        updatedPermit.request_date =
          normalizeDateOnly(
            updatedPermit.request_date
          ) || permitDate;

        decisionChanged = true;

        if (requestedStatus === "approved") {
          await applyPermitPresenceSafe(
            client,
            updatedPermit,
            schoolId
          );
        }
      }

      const assignedSubstitutions = [];

      /*
        إنشاء أو تحديث حصص الاحتياط.
      */
      if (
        requestedStatus === "approved" &&
        substitutes.length > 0
      ) {
        for (const substitution of substitutes) {
          const insertResult =
            await client.query(
              `
              INSERT INTO lesson_substitutions (
                school_id,
                substitution_date,
                timetable_entry_id,
                absent_teacher_id,
                substitute_teacher_id,
                assigned_by_user_id,
                status
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                'pending_teacher'
              )
              ON CONFLICT (
                school_id,
                substitution_date,
                timetable_entry_id
              )
              DO UPDATE SET
                absent_teacher_id =
                  EXCLUDED.absent_teacher_id,
                substitute_teacher_id =
                  EXCLUDED.substitute_teacher_id,
                assigned_by_user_id =
                  EXCLUDED.assigned_by_user_id,
                status = 'pending_teacher'
              RETURNING
                id,
                substitute_teacher_id
              `,
              [
                schoolId,
                permitDate,
                substitution.entryId,
                permit.teacher_id,
                substitution.substituteId,
                userId,
              ]
            );

          assignedSubstitutions.push({
            substitutionId:
              insertResult.rows[0].id,
            substituteTeacherId:
              insertResult.rows[0]
                .substitute_teacher_id,
            timeoutMinutes:
              substitution.timeoutMinutes,
          });
        }
      }

      await client.query("COMMIT");

      /*
        نشغل المؤقتات بعد نجاح COMMIT فقط.
      */
      for (const assigned of assignedSubstitutions) {
        scheduleSubstitutionExpiry({
          app: req.app,
          schoolId,
          substitutionId:
            assigned.substitutionId,
          substituteTeacherId:
            assigned.substituteTeacherId,
          timeoutMinutes:
            assigned.timeoutMinutes,
        });
      }

      /*
        نرسل إشعار قرار الإذن فقط عند تغيّر القرار أول مرة،
        وليس عند إعادة تعيين معلم احتياط لاحقًا.
      */
      try {
        if (decisionChanged) {
          await WorkflowNotifications
            .notifyTeacherPermissionDecision({
              app: req.app,
              schoolId,
              requestId: id,
              status: requestedStatus,
            });
        }

        for (const assigned of assignedSubstitutions) {
          await WorkflowNotifications
            .notifySubstitutionAssigned({
              app: req.app,
              schoolId,
              substitutionId:
                assigned.substitutionId,
            });
        }
      } catch (notificationError) {
        console.error(
          "Notification error (teacher permit decision):",
          notificationError
        );
      }

      const io = req.app.get("io");

      if (io) {
        io.to(`school_${schoolId}`).emit(
          "refresh_admin_permits"
        );

        if (
          assignedSubstitutions.length > 0
        ) {
          io.to(`school_${schoolId}`).emit(
            "refresh_substitutions"
          );
        }
      }

      return res.json({
        permit: updatedPermit,
        substitutions:
          assignedSubstitutions.map(
            (item) => ({
              id: item.substitutionId,
              substitute_teacher_id:
                item.substituteTeacherId,
            })
          ),
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => {});

      console.error(
        "Decide permit error:",
        error
      );

      return res.status(500).json({
        message: "Server error",
      });
    } finally {
      client.release();
    }
  },

  /*
    GET /api/admin/teacher-permits/substitutions/alerts
    نظام عين الصقر:
    جلب حصص الاحتياط المرفوضة والمنتهية مهلتها.
  */
  async getRejectedSubsAlerts(req, res) {
    const schoolId = req.user?.school_id;

    if (!schoolId) {
      return res.status(401).json({
        message: "غير مصرح",
      });
    }

    const client = await pool.connect();

    try {
      const result = await client.query(
        `
        SELECT
          substitution.id,
          substitution.substitution_date,
          substitution.status,
          period.name AS period_name,
          absent_teacher.full_name AS absent_teacher,
          substitute_teacher.full_name AS sub_teacher,
          subject.name AS subject_name,
          section.name AS section_name,
          grade.name AS grade_name
        FROM lesson_substitutions substitution
        JOIN timetable_entries entry
          ON entry.id =
             substitution.timetable_entry_id
         AND entry.school_id =
             substitution.school_id
        LEFT JOIN periods period
          ON period.id = entry.period_id
        LEFT JOIN teachers absent_teacher
          ON absent_teacher.id =
             substitution.absent_teacher_id
         AND absent_teacher.school_id =
             substitution.school_id
        LEFT JOIN teachers substitute_teacher
          ON substitute_teacher.id =
             substitution.substitute_teacher_id
         AND substitute_teacher.school_id =
             substitution.school_id
        LEFT JOIN subjects subject
          ON subject.id = entry.subject_id
        LEFT JOIN timetables timetable
          ON timetable.id = entry.timetable_id
        LEFT JOIN sections section
          ON section.id = timetable.section_id
        LEFT JOIN grades grade
          ON grade.id = section.grade_id
        WHERE substitution.school_id = $1
          AND substitution.status IN (
            'rejected',
            'expired'
          )
        ORDER BY
          substitution.substitution_date ASC,
          entry.period_id ASC
        `,
        [schoolId]
      );

      return res.json({
        alerts: result.rows || [],
      });
    } catch (error) {
      console.error(
        "Eagle Eye DB error:",
        error
      );

      return res.status(500).json({
        message: "Server error",
      });
    } finally {
      client.release();
    }
  },
};