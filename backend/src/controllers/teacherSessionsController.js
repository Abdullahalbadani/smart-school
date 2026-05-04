// src/controllers/teacherSessionsController.js
import { TeacherAttendanceController } from "./teacherAttendanceController.js";
import { pool } from "../config/db.js";

function runController(controllerFn, reqLike) {
  return new Promise((resolve, reject) => {
    const resLike = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(payload) {
        resolve({ status: this._status || 200, payload });
      },
      send(payload) {
        resolve({ status: this._status || 200, payload });
      },
    };

    Promise.resolve(controllerFn(reqLike, resLike))
      .then(() => {})
      .catch(reject);
  });
}

// ✅ حماية جلب المعلم برقم المدرسة (تعدد المدارس)
async function getTeacherIdFromReq(req) {
  const userId = req.user?.id;
  const schoolId = req.user?.school_id;
  
  if (!userId || !schoolId) return null;
  
  const r = await pool.query(
    `SELECT id FROM teachers WHERE user_id = $1 AND school_id = $2 LIMIT 1`, 
    [userId, schoolId]
  );
  return r.rows[0]?.id || null;
}

export async function startSession(req, res) {
  try {
    const b = req.body || {};

    const dateVal = b.date ?? b.attendance_date ?? b.attendanceDate ?? null;
    const periodIncoming = b.periodId ?? b.period_id ?? b.lesson ?? null;
    const lessonIncoming = b.lesson ?? null;

    const sectionIncoming = b.sectionId ?? b.section_id ?? null;
    const subjectIncoming = b.subjectId ?? b.subject_id ?? null;

    const stageIncoming = b.stageId ?? b.stage_id ?? null;
    const gradeIncoming = b.gradeId ?? b.grade_id ?? null;

    const timetableEntryId =
      b.timetableEntryId ?? b.timetable_entry_id ?? b.entryId ?? b.entry_id ?? null;

    if (!b.academicYearId && !b.academic_year_id) {
      return res.status(400).json({ message: "academicYearId مفقود" });
    }
    if (!(b.term === 1 || b.term === 2 || String(b.term) === "1" || String(b.term) === "2")) {
      return res.status(400).json({ message: "term غير صحيح" });
    }
    if (!dateVal) return res.status(400).json({ message: "date مفقود" });
    if (!periodIncoming) return res.status(400).json({ message: "periodId/lesson مفقود" });
    if (!sectionIncoming) return res.status(400).json({ message: "sectionId مفقود" });
    if (!subjectIncoming) return res.status(400).json({ message: "subjectId مفقود" });

    const mappedBody = {
      ...b,
      attendance_date: dateVal,
      attendanceDate: dateVal,
      date: dateVal,

      period_id: periodIncoming,
      periodId: periodIncoming,

      lesson: lessonIncoming ?? periodIncoming,

      section_id: sectionIncoming,
      sectionId: sectionIncoming,
      subject_id: subjectIncoming,
      subjectId: subjectIncoming,

      stage_id: stageIncoming,
      stageId: stageIncoming,
      grade_id: gradeIncoming,
      gradeId: gradeIncoming,

      note: b.lessonNote ?? b.note ?? null,
      lessonNote: b.lessonNote ?? b.note ?? null,
    };

    if (timetableEntryId) {
      mappedBody.timetableEntryId = timetableEntryId;
      mappedBody.timetable_entry_id = timetableEntryId;
    }

    const reqLike = { ...req, body: mappedBody };
    const out = await runController(TeacherAttendanceController.createSession, reqLike);

    if (out.status >= 400) return res.status(out.status).json(out.payload);

    const p = out.payload || {};
    const data = p.data || p;

    const sessionId =
      data.sessionId ||
      data.id ||
      data.session?.id ||
      data.session?.sessionId ||
      data?.data?.sessionId ||
      null;

    const isLocked = !!(data.isLocked || data.session?.is_locked || data.session?.isLocked);

    return res.json({
      data: {
        sessionId,
        isLocked,
        periodId: data.periodId ?? undefined,
        stageId: data.stageId ?? undefined,
        gradeId: data.gradeId ?? undefined,
        timetableEntryId: data.timetableEntryId ?? undefined,
      },
    });
  } catch (e) {
    console.error("teacherSessions startSession error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر (startSession)" });
  }
}

export async function sessionStudents(req, res) {
  try {
    const id = req.params.id;
    const schoolId = req.user?.school_id; // ✅ استخراج رقم المدرسة
    
    if (!schoolId) return res.status(401).json({ message: "غير مصرح" });

    const getSess = await runController(TeacherAttendanceController.getSession, { ...req, params: { id } });
    if (getSess.status >= 400) return res.status(getSess.status).json(getSess.payload);

    const getEntries = await runController(TeacherAttendanceController.listEntries, { ...req, params: { id } });
    if (getEntries.status >= 400) return res.status(getEntries.status).json(getEntries.payload);

    const sessPayload = getSess.payload || {};
    const entriesPayload = getEntries.payload || {};

    const sessionBase = sessPayload.data?.session || sessPayload.session || sessPayload.data || sessPayload;
    const sessionFull = entriesPayload.data?.session || entriesPayload.session || sessionBase;

    let students =
      entriesPayload.data?.students ||
      entriesPayload.students ||
      entriesPayload.data?.entries ||
      entriesPayload.entries ||
      [];

    if (!Array.isArray(students)) students = [];

    if (students.length === 0) {
      const teacherId = await getTeacherIdFromReq(req);

      const academicYearId =
        sessionFull?.academic_year_id ??
        sessionFull?.academicYearId ??
        sessionBase?.academic_year_id;

      const term = sessionFull?.term ?? sessionBase?.term;

      const sectionId =
        sessionFull?.section_id ?? sessionFull?.sectionId ?? sessionBase?.section_id;

      const subjectId =
        sessionFull?.subject_id ?? sessionFull?.subjectId ?? sessionBase?.subject_id;

      const periodId =
        sessionFull?.period_id ?? sessionFull?.periodId ?? sessionBase?.period_id;

      let stageId = sessionFull?.scope?.stage_id ?? sessionFull?.scope?.stageId ?? null;
      let gradeId = sessionFull?.scope?.grade_id ?? sessionFull?.scope?.gradeId ?? null;

      if (!stageId || !gradeId) {
        try {
          if (academicYearId && term && sectionId && subjectId && periodId && teacherId) {
            // ✅ حماية استنتاج المرحلة/الصف برقم المدرسة
            const tg = await pool.query(
              `
              SELECT t.stage_id, t.grade_id
              FROM timetables t
              JOIN timetable_entries te ON te.timetable_id = t.id
              WHERE t.academic_year_id = $1
                AND t.term = $2
                AND t.section_id = $3
                AND te.teacher_id = $4
                AND te.subject_id = $5
                AND t.school_id = $7
                AND (
                  te.period_id = $6
                  OR te.period_id IN (SELECT id FROM periods WHERE sort_order = $6 AND school_id = $7)
                )
              LIMIT 1
              `,
              [academicYearId, term, sectionId, teacherId, subjectId, periodId, schoolId]
            );
            stageId = stageId || tg.rows[0]?.stage_id || null;
            gradeId = gradeId || tg.rows[0]?.grade_id || null;
          }
        } catch (e) {
          console.warn("infer stage/grade from timetable failed:", e);
        }
      }

      if (academicYearId && sectionId && stageId && gradeId) {
        // ✅ حماية استعلام جلب الطلاب برقم المدرسة للـ enrollments والـ students
        const q = await pool.query(
          `
          SELECT
            s.id,
            s.student_code AS code,
            s.full_name AS name
          FROM student_enrollments se
          JOIN students s ON s.id = se.student_id
          WHERE se.academic_year_id = $1
            AND se.section_id = $2
            AND se.stage_id = $3
            AND se.grade_id = $4
            AND se.school_id = $5
            AND s.school_id = $5
          ORDER BY s.full_name ASC
          `,
          [academicYearId, sectionId, stageId, gradeId, schoolId]
        );

        students = (q.rows || []).map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          status: "present",
          note: "",
          reasonId: null,
          lateMinutes: null,
        }));
      }
    } else {
      students = students.map((s) => ({
        id: s.id ?? s.student_id ?? s.studentId,
        code: s.code ?? s.student_code ?? s.studentCode ?? "",
        name: s.name ?? s.full_name ?? s.fullName ?? "",
        status: s.status ?? "present",
        note: s.note ?? "",
        reasonId: s.reasonId ?? s.reason_id ?? null,
        lateMinutes: s.lateMinutes ?? s.late_minutes ?? null,
      }));
    }

    return res.json({
      data: {
        session: sessionFull || sessionBase || null,
        students: Array.isArray(students) ? students : [],
      },
    });
  } catch (e) {
    console.error("teacherSessions sessionStudents error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر (sessionStudents)" });
  }
}

export async function saveAttendance(req, res) {
  try {
    const id = req.params.id;
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const lock = req.body?.lock === true;

    const saveOut = await runController(TeacherAttendanceController.saveEntries, {
      ...req,
      params: { id },
      body: { entries, lock },
    });

    if (saveOut.status >= 400) return res.status(saveOut.status).json(saveOut.payload);

    return res.json({ data: { ok: true, locked: !!lock } });
  } catch (e) {
    console.error("teacherSessions saveAttendance error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر (saveAttendance)" });
  }
}

/**
 * ✅ صار end فعلي: يقفل الجلسة
 * POST /api/teacher/sessions/:id/end
 */
export async function endSession(req, res) {
  try {
    const id = req.params.id;

    const out = await runController(TeacherAttendanceController.endSession, {
      ...req,
      params: { id },
      body: {},
    });

    if (out.status >= 400) return res.status(out.status).json(out.payload);

    return res.json({ data: { ok: true, locked: true } });
  } catch (e) {
    console.error("teacherSessions endSession error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر (endSession)" });
  }
}