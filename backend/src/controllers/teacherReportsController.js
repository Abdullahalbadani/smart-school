import { pool } from "../config/db.js";
import puppeteer from "puppeteer";

const REPORT_TYPES = new Set([
  "class_grades_report",
  "student_performance_report",
  "attendance_report",
  "exam_results_summary",
  "assignments_report",
  "struggling_students_report",
  "top_students_report",
  "grade_entry_sheet",
]);

const TERM_LABELS = {
  "1": "الفصل الأول",
  "2": "الفصل الثاني",
};

// ✅ جلب هوية المدرسة من الريكويست
function getSchoolId(req) {
  return req.user?.school_id || null;
}

export async function getTeacherReportsMeta(req, res) {
  try {
    const schoolId = getSchoolId(req);
    if (!schoolId) return res.status(401).json({ success: false, message: "غير مصرح" });

    // ✅ فلترة السنوات الدراسية للمدرسة
    const yearsQuery = `
      SELECT id, name
      FROM academic_years
      WHERE school_id = $1
      ORDER BY id DESC
    `;

    const yearsResult = await pool.query(yearsQuery, [schoolId]);

    return res.json({
      success: true,
      data: {
        years: yearsResult.rows,
        terms: [
          { value: "1", label: "الفصل الأول" },
          { value: "2", label: "الفصل الثاني" },
          { value: "3", label: "الفصل الثالث" },
        ],
      },
    });
  } catch (error) {
    console.error("getTeacherReportsMeta error:", error);
    return res.status(500).json({
      success: false,
      message: "فشل تحميل البيانات الأساسية للتقارير",
    });
  }
}

export async function getTeacherReportScopes(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await resolveTeacherId(req, schoolId);
    const academicYearId = toInt(req.query.academicYearId);
    const term = valueOrNull(req.query.term);

    if (!schoolId || !teacherId) {
      return res.status(401).json({
        success: false,
        message: "تعذر تحديد المعلم الحالي",
      });
    }

    if (!academicYearId) {
      return res.status(400).json({
        success: false,
        message: "academicYearId مطلوب",
      });
    }

    const scopes = await queryTeacherScopes({
      teacherId,
      academicYearId,
      term,
      schoolId,
    });

    return res.json({
      success: true,
      data: scopes,
    });
  } catch (error) {
    console.error("getTeacherReportScopes error:", error);
    return res.status(500).json({
      success: false,
      message: "فشل تحميل نطاقات المعلم",
    });
  }
}

export async function getTeacherReportContext(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await resolveTeacherId(req, schoolId);

    const academicYearId = toInt(req.query.academicYearId);
    const term = valueOrNull(req.query.term);
    const sectionId = toInt(req.query.sectionId);
    const subjectId = toInt(req.query.subjectId);

    if (!schoolId || !teacherId) {
      return res.status(401).json({
        success: false,
        message: "تعذر تحديد المعلم الحالي",
      });
    }

    if (!academicYearId || !sectionId) {
      return res.status(400).json({
        success: false,
        message: "academicYearId و sectionId مطلوبان",
      });
    }

    const [subjects, students, assessments, assignments] = await Promise.all([
      queryTeacherSubjects({
        teacherId,
        academicYearId,
        term,
        sectionId,
        schoolId,
      }),
      querySectionStudents({
        sectionId,
        academicYearId,
        term,
        schoolId,
      }),
      querySectionAssessments({
        teacherId,
        academicYearId,
        term,
        sectionId,
        subjectId,
        schoolId,
      }),
      querySectionAssignments({
        teacherId,
        academicYearId,
        term,
        sectionId,
        subjectId,
        schoolId,
      }),
    ]);

    return res.json({
      success: true,
      data: {
        subjects,
        students,
        assessments,
        assignments,
      },
    });
  } catch (error) {
    console.error("getTeacherReportContext error:", error);
    return res.status(500).json({
      success: false,
      message: "فشل تحميل بيانات سياق التقارير",
    });
  }
}

export async function generateTeacherReport(req, res) {
  try {
    const schoolId = getSchoolId(req);
    const teacherId = await resolveTeacherId(req, schoolId);
    const teacherName = await resolveTeacherName(req, teacherId, schoolId);

    if (!schoolId || !teacherId) {
      return res.status(401).json({
        success: false,
        message: "تعذر تحديد المعلم الحالي",
      });
    }

    const payload = normalizePayload(req.body || {});
    payload.schoolId = schoolId; // ✅ حقن المدرسة
    const validationError = validateReportPayload(payload);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const baseInfo = await buildBaseInfo({
      teacherId,
      teacherName,
      payload,
    });

    // ✅ جلب اسم المدرسة لطباعته على الـ PDF
    const schoolRes = await pool.query(`SELECT name_ar FROM schools WHERE id = $1 LIMIT 1`, [schoolId]);
    baseInfo.schoolName = schoolRes.rows[0]?.name_ar || process.env.SCHOOL_NAME || "المدرسة";

    let report;

    switch (payload.reportType) {
      case "class_grades_report":
        report = await buildClassGradesReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "student_performance_report":
        report = await buildStudentPerformanceReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "attendance_report":
        report = await buildAttendanceReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "exam_results_summary":
        report = await buildExamResultsSummary({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "assignments_report":
        report = await buildAssignmentsReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "struggling_students_report":
        report = await buildStrugglingStudentsReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "top_students_report":
        report = await buildTopStudentsReport({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      case "grade_entry_sheet":
        report = await buildGradeEntrySheet({
          teacherId,
          teacherName,
          payload,
          baseInfo,
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "نوع التقرير غير مدعوم",
        });
    }

    if (!report || !Array.isArray(report.rows) || report.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "لا توجد بيانات كافية لإنشاء هذا التقرير",
      });
    }

    const html = renderReportHtml(report);
    const pdfBuffer = await htmlToPdfBuffer(html);
    const fileName = getReportFileName(payload.reportType);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error("generateTeacherReport error:", error);
    return res.status(500).json({
      success: false,
      message: "فشل إنشاء التقرير",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* REPORT BUILDERS                            */
/* -------------------------------------------------------------------------- */

async function buildClassGradesReport({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const gradeRows = await queryAssessmentGradeRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    assessmentType:
      payload.evaluationType && payload.evaluationType !== "all"
        ? payload.evaluationType
        : null,
    studentId: null,
    assessmentId: null,
    schoolId: payload.schoolId,
  });

  const gradeBook = buildGradeBook(students, gradeRows);
  const classAverage = averageOf(gradeBook.map((x) => x.percentage));

  return {
    title: "كشف درجات الصف",
    fileLabel: "class-grades-report",
    meta: buildCommonMeta(baseInfo, payload, teacherName),
    summary: [
      `عدد الطلاب: ${gradeBook.length}`,
      `متوسط الصف: ${formatNumber(classAverage)}%`,
      payload.evaluationType && payload.evaluationType !== "all"
        ? `نوع التقييم: ${getEvaluationTypeLabel(payload.evaluationType)}`
        : "نوع التقييم: جميع التقييمات",
    ],
    columns: [
      "م",
      "اسم الطالب",
      "الواجبات",
      "المشاركة",
      "الاختبارات",
      "النهائي",
      "المجموع",
      "النسبة",
      "التقدير",
    ],
    rows: gradeBook.map((item, index) => [
      index + 1,
      item.name,
      formatNumber(item.homework),
      formatNumber(item.participation),
      formatNumber(item.exams),
      formatNumber(item.final),
      formatNumber(item.total),
      `${formatNumber(item.percentage)}%`,
      item.rating,
    ]),
  };
}

async function buildStudentPerformanceReport({ teacherName, payload, baseInfo }) {
  const student = await querySingleStudent(payload.studentId, payload.schoolId);

  if (!student) {
    return {
      title: "تقرير أداء طالب",
      meta: buildCommonMeta(baseInfo, payload, teacherName),
      summary: [],
      columns: [],
      rows: [],
    };
  }

  const gradeRows = await queryAssessmentGradeRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    assessmentType: null,
    studentId: payload.studentId,
    assessmentId: null,
    schoolId: payload.schoolId,
  });

  const attendanceRows = await queryAttendanceRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    studentId: payload.studentId,
    schoolId: payload.schoolId,
  });

  const gradeBook = buildGradeBook([student], gradeRows);
  const studentSummary = gradeBook[0] || {
    total: 0,
    percentage: 0,
    rating: "لا يوجد",
  };

  const attendanceSummary =
    buildAttendanceSummary([student], attendanceRows)[0] || {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      attendanceRate: 0,
    };

  return {
    title: "تقرير أداء طالب",
    fileLabel: "student-performance-report",
    meta: [
      ...buildCommonMeta(baseInfo, payload, teacherName),
      { label: "الطالب", value: getStudentName(student) },
    ],
    summary: [
      `إجمالي الدرجات: ${formatNumber(studentSummary.total)}`,
      `متوسط الإنجاز: ${formatNumber(studentSummary.percentage)}%`,
      `التقدير: ${studentSummary.rating}`,
      `نسبة الحضور: ${formatNumber(attendanceSummary.attendanceRate)}%`,
      `أيام الغياب: ${attendanceSummary.absent}`,
    ],
    columns: [
      "م",
      "اسم التقييم",
      "النوع",
      "التاريخ",
      "الدرجة",
      "الدرجة الكلية",
      "النسبة",
      "ملاحظات",
    ],
    rows: gradeRows.map((row, index) => {
      const score = toNumber(row.score);
      const maxScore = toNumber(row.max_score);
      const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

      return [
        index + 1,
        row.title || "-",
        getEvaluationTypeLabel(row.assessment_type),
        formatDate(row.assessment_date),
        formatNumber(score),
        formatNumber(maxScore),
        `${formatNumber(percentage)}%`,
        row.notes || "-",
      ];
    }),
  };
}

async function buildAttendanceReport({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const rows = await queryAttendanceRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId || null,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    studentId:
      payload.attendanceScope === "student" ? payload.studentId || null : null,
    schoolId: payload.schoolId,
  });

  if (payload.attendanceScope === "student" && payload.studentId) {
    const student = await querySingleStudent(payload.studentId, payload.schoolId);
    const attendanceSummary =
      buildAttendanceSummary(student ? [student] : [], rows)[0] || {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        attendanceRate: 0,
      };

    return {
      title: "تقرير الحضور والغياب",
      fileLabel: "student-attendance-report",
      meta: [
        ...buildCommonMeta(baseInfo, payload, teacherName),
        { label: "النطاق", value: "طالب واحد" },
        { label: "الطالب", value: student ? getStudentName(student) : "-" },
      ],
      summary: [
        `الحضور: ${attendanceSummary.present}`,
        `الغياب: ${attendanceSummary.absent}`,
        `التأخر: ${attendanceSummary.late}`,
        `مستأذن: ${attendanceSummary.excused}`,
        `نسبة الحضور: ${formatNumber(attendanceSummary.attendanceRate)}%`,
      ],
      columns: ["م", "التاريخ", "الحالة", "الملاحظات"],
      rows: rows.map((row, index) => [
        index + 1,
        formatDate(row.session_date),
        getAttendanceStatusLabel(row.status),
        row.notes || "-",
      ]),
    };
  }

  const summaryRows = buildAttendanceSummary(students, rows);
  const classAttendanceRate = averageOf(summaryRows.map((x) => x.attendanceRate));

  return {
    title: "تقرير الحضور والغياب",
    fileLabel: "class-attendance-report",
    meta: [
      ...buildCommonMeta(baseInfo, payload, teacherName),
      { label: "النطاق", value: "الصف كامل" },
    ],
    summary: [
      `عدد الطلاب: ${summaryRows.length}`,
      `متوسط الحضور: ${formatNumber(classAttendanceRate)}%`,
    ],
    columns: ["م", "اسم الطالب", "حضور", "غياب", "تأخر", "مستأذن", "نسبة الحضور"],
    rows: summaryRows.map((row, index) => [
      index + 1,
      row.name,
      row.present,
      row.absent,
      row.late,
      row.excused,
      `${formatNumber(row.attendanceRate)}%`,
    ]),
  };
}

async function buildExamResultsSummary({ teacherName, payload, baseInfo }) {
  const assessment = await querySingleAssessment({
    assessmentId: payload.assessmentId,
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    schoolId: payload.schoolId,
  });

  const gradeRows = await queryAssessmentGradeRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: null,
    toDate: null,
    assessmentType: null,
    studentId: null,
    assessmentId: payload.assessmentId,
    schoolId: payload.schoolId,
  });

  const scores = gradeRows.map((row) => toNumber(row.score));
  const maxScore = gradeRows.length ? toNumber(gradeRows[0].max_score) : 0;
  const highest = scores.length ? Math.max(...scores) : 0;
  const lowest = scores.length ? Math.min(...scores) : 0;
  const average = averageOf(scores);

  const passedCount = gradeRows.filter((x) => {
    const score = toNumber(x.score);
    const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;
    return percent >= 50;
  }).length;

  return {
    title: "ملخص نتائج اختبار",
    fileLabel: "exam-results-summary",
    meta: [
      ...buildCommonMeta(baseInfo, payload, teacherName),
      { label: "الاختبار", value: assessment?.title || "-" },
    ],
    summary: [
      `عدد الطلاب: ${gradeRows.length}`,
      `أعلى درجة: ${formatNumber(highest)}`,
      `أقل درجة: ${formatNumber(lowest)}`,
      `المتوسط: ${formatNumber(average)}`,
      `عدد الناجحين: ${passedCount}`,
      `عدد من يحتاجون متابعة: ${Math.max(gradeRows.length - passedCount, 0)}`,
    ],
    columns: ["م", "اسم الطالب", "الدرجة", "الدرجة الكلية", "النسبة", "التقدير"],
    rows: gradeRows.map((row, index) => {
      const score = toNumber(row.score);
      const full = toNumber(row.max_score);
      const percentage = full > 0 ? (score / full) * 100 : 0;

      return [
        index + 1,
        row.student_name,
        formatNumber(score),
        formatNumber(full),
        `${formatNumber(percentage)}%`,
        getPerformanceRating(percentage),
      ];
    }),
  };
}

async function buildAssignmentsReport({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const assignments = await querySectionAssignments({
    teacherId: baseInfo.teacherId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    sectionId: payload.sectionId,
    subjectId: payload.subjectId,
    schoolId: payload.schoolId,
  });

  const selectedAssignments =
    payload.assignmentId && payload.assignmentId !== "all"
      ? assignments.filter((x) => String(x.id) === String(payload.assignmentId))
      : assignments;

  if (!selectedAssignments.length) {
    return {
      title: "تقرير الواجبات والتكليفات",
      meta: buildCommonMeta(baseInfo, payload, teacherName),
      summary: [],
      columns: [],
      rows: [],
    };
  }

  const allRows = await queryAssessmentGradeRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    assessmentType: null,
    studentId: null,
    assessmentId: null,
    schoolId: payload.schoolId,
  });

  const gradeIndex = new Map();
  for (const row of allRows) {
    gradeIndex.set(`${row.assessment_id}:${row.student_id}`, row);
  }

  const reportRows = [];
  for (const assignment of selectedAssignments) {
    for (const student of students) {
      const gradeRow = gradeIndex.get(`${assignment.id}:${student.id}`);
      reportRows.push([
        assignment.title || "-",
        getStudentName(student),
        gradeRow ? "تم التسليم" : "لم يتم",
        gradeRow ? formatNumber(toNumber(gradeRow.score)) : "-",
        gradeRow?.notes || "-",
      ]);
    }
  }

  const submittedCount = reportRows.filter((row) => row[2] === "تم التسليم").length;
  const notSubmittedCount = reportRows.length - submittedCount;

  return {
    title: "تقرير الواجبات والتكليفات",
    fileLabel: "assignments-report",
    meta: buildCommonMeta(baseInfo, payload, teacherName),
    summary: [
      `عدد الواجبات المحددة: ${selectedAssignments.length}`,
      `إجمالي السجلات: ${reportRows.length}`,
      `تم التسليم: ${submittedCount}`,
      `لم يتم التسليم: ${notSubmittedCount}`,
    ],
    columns: ["الواجب", "اسم الطالب", "حالة التسليم", "الدرجة", "ملاحظات"],
    rows: reportRows,
  };
}

async function buildStrugglingStudentsReport({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const [gradeRows, attendanceRows] = await Promise.all([
    queryAssessmentGradeRows({
      teacherId: baseInfo.teacherId,
      sectionId: payload.sectionId,
      academicYearId: payload.academicYearId,
      term: payload.term,
      subjectId: payload.subjectId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      assessmentType: null,
      studentId: null,
      assessmentId: null,
      schoolId: payload.schoolId,
    }),
    queryAttendanceRows({
      teacherId: baseInfo.teacherId,
      sectionId: payload.sectionId,
      academicYearId: payload.academicYearId,
      term: payload.term,
      subjectId: payload.subjectId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      studentId: null,
      schoolId: payload.schoolId,
    }),
  ]);

  const gradeBook = buildGradeBook(students, gradeRows);
  const attendanceBook = buildAttendanceSummary(students, attendanceRows);
  const attendanceMap = new Map(attendanceBook.map((x) => [String(x.studentId), x]));
  const classAverage = averageOf(gradeBook.map((x) => x.percentage));

  const reportRows = [];

  for (const item of gradeBook) {
    const att = attendanceMap.get(String(item.studentId)) || {
      absent: 0,
      attendanceRate: 0,
    };

    const result = matchStrugglingCriteria(
      payload.strugglingCriteria,
      item.percentage,
      classAverage,
      att.absent,
      att.attendanceRate
    );

    if (result.matched) {
      reportRows.push([
        item.name,
        `${formatNumber(item.percentage)}%`,
        att.absent,
        `${formatNumber(att.attendanceRate)}%`,
        result.reason,
        "يحتاج متابعة أكاديمية",
      ]);
    }
  }

  return {
    title: "تقرير الطلاب المتعثرين",
    fileLabel: "struggling-students-report",
    meta: buildCommonMeta(baseInfo, payload, teacherName),
    summary: [
      `عدد الطلاب المتعثرين: ${reportRows.length}`,
      `معيار التعثر: ${getStrugglingCriteriaLabel(payload.strugglingCriteria)}`,
      `متوسط الصف: ${formatNumber(classAverage)}%`,
    ],
    columns: [
      "اسم الطالب",
      "المتوسط",
      "أيام الغياب",
      "نسبة الحضور",
      "سبب التعثر",
      "التوصية",
    ],
    rows: reportRows,
  };
}

async function buildTopStudentsReport({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const [gradeRows, attendanceRows] = await Promise.all([
    queryAssessmentGradeRows({
      teacherId: baseInfo.teacherId,
      sectionId: payload.sectionId,
      academicYearId: payload.academicYearId,
      term: payload.term,
      subjectId: payload.subjectId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      assessmentType: null,
      studentId: null,
      assessmentId: null,
      schoolId: payload.schoolId,
    }),
    queryAttendanceRows({
      teacherId: baseInfo.teacherId,
      sectionId: payload.sectionId,
      academicYearId: payload.academicYearId,
      term: payload.term,
      subjectId: payload.subjectId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      studentId: null,
      schoolId: payload.schoolId,
    }),
  ]);

  const gradeBook = buildGradeBook(students, gradeRows).sort(
    (a, b) => b.percentage - a.percentage
  );
  const attendanceBook = buildAttendanceSummary(students, attendanceRows);
  const attendanceMap = new Map(attendanceBook.map((x) => [String(x.studentId), x]));

  const filtered = matchTopCriteria(payload.topCriteria, gradeBook);

  const rows = filtered.map((item) => {
    const att = attendanceMap.get(String(item.studentId)) || {
      attendanceRate: 0,
    };

    return [
      item.name,
      `${formatNumber(item.percentage)}%`,
      item.rating,
      `${formatNumber(att.attendanceRate)}%`,
      "أداء متميز",
    ];
  });

  return {
    title: "تقرير الطلاب المتميزين",
    fileLabel: "top-students-report",
    meta: buildCommonMeta(baseInfo, payload, teacherName),
    summary: [
      `عدد الطلاب المتميزين: ${rows.length}`,
      `معيار التميز: ${getTopCriteriaLabel(payload.topCriteria)}`,
    ],
    columns: ["اسم الطالب", "المتوسط", "التقدير", "نسبة الحضور", "ملاحظة"],
    rows,
  };
}

async function buildGradeEntrySheet({ teacherName, payload, baseInfo }) {
  const students = await querySectionStudents({
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    schoolId: payload.schoolId,
  });

  const assessmentType =
    payload.gradeSheetType === "assessment_type" &&
    payload.evaluationType &&
    payload.evaluationType !== "all"
      ? payload.evaluationType
      : null;

  const gradeRows = await queryAssessmentGradeRows({
    teacherId: baseInfo.teacherId,
    sectionId: payload.sectionId,
    academicYearId: payload.academicYearId,
    term: payload.term,
    subjectId: payload.subjectId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    assessmentType,
    studentId: null,
    assessmentId: null,
    schoolId: payload.schoolId,
  });

  const gradeBook = buildGradeBook(students, gradeRows);

  return {
    title: "كشف رصد الدرجات",
    fileLabel: "grade-entry-sheet",
    meta: [
      ...buildCommonMeta(baseInfo, payload, teacherName),
      { label: "نوع الرصد", value: getGradeSheetTypeLabel(payload.gradeSheetType) },
    ],
    summary: [
      `عدد الطلاب: ${gradeBook.length}`,
      assessmentType
        ? `نوع التقييم: ${getEvaluationTypeLabel(assessmentType)}`
        : "الرصد: إجمالي الدرجات",
    ],
    columns: [
      "م",
      "اسم الطالب",
      "المجموع",
      "الدرجة الكلية",
      "النسبة",
      "التقدير",
      "التوقيع",
    ],
    rows: gradeBook.map((item, index) => [
      index + 1,
      item.name,
      formatNumber(item.total),
      formatNumber(item.totalMax),
      `${formatNumber(item.percentage)}%`,
      item.rating,
      "",
    ]),
  };
}

/* -------------------------------------------------------------------------- */
/* HELPERS                                   */
/* -------------------------------------------------------------------------- */

function normalizePayload(body) {
  return {
    reportType: valueOrNull(body.reportType),
    academicYearId: toInt(body.academicYearId),
    term: valueOrNull(body.term),
    stageId: toInt(body.stageId),
    gradeId: toInt(body.gradeId),
    sectionId: toInt(body.sectionId),
    subjectId: toInt(body.subjectId),
    period: valueOrNull(body.period),
    fromDate: valueOrNull(body.fromDate),
    toDate: valueOrNull(body.toDate),
    evaluationType: valueOrNull(body.evaluationType),
    studentId: toInt(body.studentId),
    attendanceScope: valueOrNull(body.attendanceScope),
    assessmentId: toInt(body.assessmentId),
    assignmentId: body.assignmentId === "all" ? "all" : toInt(body.assignmentId),
    strugglingCriteria: valueOrNull(body.strugglingCriteria),
    topCriteria: valueOrNull(body.topCriteria),
    gradeSheetType: valueOrNull(body.gradeSheetType),
    notes: valueOrNull(body.notes),
  };
}

function validateReportPayload(payload) {
  if (!payload.reportType || !REPORT_TYPES.has(payload.reportType)) {
    return "يرجى اختيار نوع تقرير صحيح";
  }

  if (!payload.academicYearId) return "السنة الدراسية مطلوبة";
  if (!payload.term) return "الفصل الدراسي مطلوب";
  if (!payload.stageId) return "المرحلة مطلوبة";
  if (!payload.gradeId) return "الصف مطلوب";
  if (!payload.sectionId) return "الشعبة مطلوبة";

  const subjectRequiredReports = new Set([
    "class_grades_report",
    "student_performance_report",
    "exam_results_summary",
    "assignments_report",
    "struggling_students_report",
    "top_students_report",
    "grade_entry_sheet",
    "attendance_report",
  ]);

  if (subjectRequiredReports.has(payload.reportType) && !payload.subjectId) {
    return "المادة مطلوبة";
  }

  if (!payload.period) {
    return "الفترة مطلوبة";
  }

  if (payload.period === "custom" || payload.period === "month") {
    if (!payload.fromDate || !payload.toDate) {
      return "من تاريخ وإلى تاريخ مطلوبان لهذا النوع من الفترات";
    }
    if (payload.fromDate > payload.toDate) {
      return "تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية";
    }
  }

  if (payload.reportType === "student_performance_report" && !payload.studentId) {
    return "الطالب مطلوب لهذا التقرير";
  }

  if (payload.reportType === "attendance_report") {
    if (!payload.attendanceScope) {
      return "نطاق تقرير الحضور مطلوب";
    }
    if (payload.attendanceScope === "student" && !payload.studentId) {
      return "الطالب مطلوب عند اختيار نطاق طالب واحد";
    }
  }

  if (payload.reportType === "exam_results_summary" && !payload.assessmentId) {
    return "الاختبار مطلوب لهذا التقرير";
  }

  if (
    payload.reportType === "struggling_students_report" &&
    !payload.strugglingCriteria
  ) {
    return "معيار التعثر مطلوب";
  }

  if (payload.reportType === "top_students_report" && !payload.topCriteria) {
    return "معيار التميز مطلوب";
  }

  if (payload.reportType === "grade_entry_sheet" && !payload.gradeSheetType) {
    return "نوع الرصد مطلوب";
  }

  if (
    payload.reportType === "grade_entry_sheet" &&
    payload.gradeSheetType === "assessment_type" &&
    (!payload.evaluationType || payload.evaluationType === "all")
  ) {
    return "نوع التقييم مطلوب عند اختيار الرصد حسب نوع التقييم";
  }

  return null;
}

async function buildBaseInfo({ teacherId, teacherName, payload }) {
  const [scopeInfo, subjectInfo] = await Promise.all([
    queryScopeInfo(payload.sectionId, payload.academicYearId, payload.schoolId),
    payload.subjectId ? querySubjectInfo(payload.subjectId, payload.schoolId) : null,
  ]);

  return {
    teacherId,
    teacherName,
    scopeInfo,
    subjectInfo,
    schoolName: null // 👈 غيرناها من baseInfo?.schoolName إلى null
  };
}

function buildCommonMeta(baseInfo, payload, teacherName) {
  return [
    {
      label: "اسم المدرسة",
      value: baseInfo.schoolName || "المدرسة",
    },
    {
      label: "اسم المعلم",
      value: teacherName || baseInfo.teacherName || "-",
    },
    {
      label: "المرحلة",
      value: baseInfo.scopeInfo?.stage_name || "-",
    },
    {
      label: "الصف",
      value: baseInfo.scopeInfo?.grade_name || "-",
    },
    {
      label: "الشعبة",
      value: baseInfo.scopeInfo?.section_name || "-",
    },
    {
      label: "المادة",
      value: baseInfo.subjectInfo?.name || "-",
    },
    {
      label: "السنة الدراسية",
      value: baseInfo.scopeInfo?.academic_year_name || "-",
    },
    {
      label: "الفصل الدراسي",
      value: TERM_LABELS[payload.term] || payload.term || "-",
    },
    {
      label: "الفترة",
      value: getPeriodLabel(payload),
    },
    {
      label: "تاريخ الإنشاء",
      value: formatDate(new Date()),
    },
  ];
}

function buildGradeBook(students, gradeRows) {
  const map = new Map();

  for (const student of students) {
    map.set(String(student.id), {
      studentId: student.id,
      name: getStudentName(student),
      homework: 0,
      participation: 0,
      exams: 0,
      final: 0,
      total: 0,
      totalMax: 0,
      percentage: 0,
      rating: "لا يوجد",
    });
  }

  for (const row of gradeRows) {
    const key = String(row.student_id);
    const entry = map.get(key);

    if (!entry) continue;

    const score = toNumber(row.score);
    const maxScore = toNumber(row.max_score);
    const type = normalizeAssessmentType(row.assessment_type);

    entry.total += score;
    entry.totalMax += maxScore;

    if (type === "homework") entry.homework += score;
    else if (type === "participation") entry.participation += score;
    else if (type === "final") entry.final += score;
    else entry.exams += score;
  }

  for (const entry of map.values()) {
    entry.percentage =
      entry.totalMax > 0 ? (entry.total / entry.totalMax) * 100 : 0;
    entry.rating = getPerformanceRating(entry.percentage);
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function buildAttendanceSummary(students, attendanceRows) {
  const map = new Map();

  for (const student of students) {
    map.set(String(student.id), {
      studentId: student.id,
      name: getStudentName(student),
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      totalSessions: 0,
      attendanceRate: 0,
    });
  }

  for (const row of attendanceRows) {
    const key = String(row.student_id);
    const entry = map.get(key);

    if (!entry) continue;

    entry.totalSessions += 1;

    const status = normalizeAttendanceStatus(row.status);
    if (status === "present") entry.present += 1;
    else if (status === "absent") entry.absent += 1;
    else if (status === "late") entry.late += 1;
    else entry.excused += 1;
  }

  for (const entry of map.values()) {
    entry.attendanceRate =
      entry.totalSessions > 0 ? (entry.present / entry.totalSessions) * 100 : 0;
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function matchStrugglingCriteria(criteria, percentage, classAverage, absent, attendanceRate) {
  switch (criteria) {
    case "below_50":
      return {
        matched: percentage < 50,
        reason: "المعدل أقل من 50%",
      };

    case "below_60":
      return {
        matched: percentage < 60,
        reason: "المعدل أقل من 60%",
      };

    case "below_average":
      return {
        matched: percentage < classAverage,
        reason: "أقل من متوسط الصف",
      };

    case "high_absence_low_grade":
      return {
        matched: attendanceRate < 75 && percentage < 60,
        reason: `غياب مرتفع (${absent}) مع درجات منخفضة`,
      };

    default:
      return {
        matched: false,
        reason: "-",
      };
  }
}

function matchTopCriteria(criteria, gradeBook) {
  switch (criteria) {
    case "above_90":
      return gradeBook.filter((x) => x.percentage >= 90);

    case "above_95":
      return gradeBook.filter((x) => x.percentage >= 95);

    case "top_3":
      return gradeBook.slice(0, 3);

    case "top_5":
      return gradeBook.slice(0, 5);

    case "top_10":
      return gradeBook.slice(0, 10);

    default:
      return gradeBook.filter((x) => x.percentage >= 90);
  }
}

/* -------------------------------------------------------------------------- */
/* QUERIES                                   */
/* -------------------------------------------------------------------------- */

async function resolveTeacherId(req, schoolId) {
  const directTeacherId = toInt(
    req.user?.teacher_id || req.body?.teacherId || req.query?.teacherId
  );

  if (directTeacherId) {
    return directTeacherId;
  }

  const userId = toInt(req.user?.id || req.body?.userId || req.query?.userId);

  if (!userId) {
    return null;
  }

  try {
    const result = await pool.query(
      `SELECT id FROM teachers WHERE user_id = $1 AND school_id = $2 LIMIT 1`,
      [userId, schoolId]
    );

    if (result.rows.length) {
      return Number(result.rows[0].id);
    }

    return userId;
  } catch (error) {
    console.error("resolveTeacherId error:", error); // ✅ استخدمنا المتغير هنا
    return userId;
  }
}

async function resolveTeacherName(req, teacherId, schoolId) {
  if (req.user?.name) return req.user.name;
  if (req.user?.full_name) return req.user.full_name;

  if (!teacherId) return "المعلم";

  try {
    const result = await pool.query(
      `
      SELECT full_name
      FROM teachers
      WHERE id = $1 AND school_id = $2
      LIMIT 1
      `,
      [teacherId, schoolId]
    );

    if (!result.rows.length) {
      return "المعلم";
    }

    return result.rows[0].full_name || "المعلم";
  } catch (error) {
    console.error("resolveTeacherName error:", error); // ✅ استخدمنا المتغير هنا
    return "المعلم";
  }
}

async function queryTeacherScopes({ teacherId, academicYearId, term, schoolId }) {
  const primaryQuery = `
    SELECT DISTINCT
      st.id AS stage_id,
      st.name AS stage_name,
      g.id AS grade_id,
      COALESCE(g.grade_name, g.name) AS grade_name,
      s.id AS section_id,
      s.name AS section_name
    FROM teacher_assignments ta
    INNER JOIN sections s ON s.id = ta.section_id
    INNER JOIN grades g ON g.id = ta.grade_id
    INNER JOIN stages st ON st.id = ta.stage_id
    WHERE ta.teacher_id = $1
      AND ta.academic_year_id = $2
      AND ta.school_id = $4
      AND ($3::text IS NULL OR ta.term::text = $3)
    ORDER BY st.name, COALESCE(g.grade_name, g.name), s.name
  `;

  const primaryResult = await pool.query(primaryQuery, [teacherId, academicYearId, term, schoolId]);
  if (primaryResult.rows.length) {
    return primaryResult.rows;
  }

  const fallbackQuery = `
    SELECT DISTINCT
      st.id AS stage_id,
      st.name AS stage_name,
      g.id AS grade_id,
      COALESCE(g.grade_name, g.name) AS grade_name,
      s.id AS section_id,
      s.name AS section_name
    FROM timetable_entries te
    INNER JOIN timetables tt ON tt.id = te.timetable_id
    INNER JOIN sections s ON s.id = tt.section_id
    INNER JOIN grades g ON g.id = tt.grade_id
    INNER JOIN stages st ON st.id = tt.stage_id
    WHERE te.teacher_id = $1
      AND tt.academic_year_id = $2
      AND tt.school_id = $4
      AND ($3::text IS NULL OR tt.term::text = $3)

    UNION

    SELECT DISTINCT
      st.id AS stage_id,
      st.name AS stage_name,
      g.id AS grade_id,
      COALESCE(g.grade_name, g.name) AS grade_name,
      s.id AS section_id,
      s.name AS section_name
    FROM attendance_sessions ats
    INNER JOIN sections s ON s.id = ats.section_id
    INNER JOIN grades g ON g.id = COALESCE(ats.grade_id, s.grade_id)
    INNER JOIN stages st ON st.id = COALESCE(ats.stage_id, g.stage_id)
    WHERE ats.teacher_id = $1
      AND ats.academic_year_id = $2
      AND ats.school_id = $4
      AND ($3::text IS NULL OR ats.term::text = $3)
    ORDER BY stage_name, grade_name, section_name
  `;

  const fallbackResult = await pool.query(fallbackQuery, [
    teacherId,
    academicYearId,
    term,
    schoolId
  ]);

  return fallbackResult.rows;
}

async function queryTeacherSubjects({ teacherId, academicYearId, term, sectionId, schoolId }) {
  const primaryQuery = `
    SELECT DISTINCT
      sub.id,
      sub.name
    FROM teacher_assignments ta
    INNER JOIN subjects sub ON sub.id = ta.subject_id
    WHERE ta.teacher_id = $1
      AND ta.section_id = $2
      AND ta.academic_year_id = $3
      AND ta.school_id = $5
      AND ($4::text IS NULL OR ta.term::text = $4)
    ORDER BY sub.name
  `;

  const primaryResult = await pool.query(primaryQuery, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    schoolId
  ]);

  if (primaryResult.rows.length) {
    return primaryResult.rows;
  }

  const fallbackQuery = `
    SELECT DISTINCT
      sub.id,
      sub.name
    FROM timetable_entries te
    INNER JOIN timetables tt ON tt.id = te.timetable_id
    INNER JOIN subjects sub ON sub.id = te.subject_id
    WHERE te.teacher_id = $1
      AND tt.section_id = $2
      AND tt.academic_year_id = $3
      AND tt.school_id = $5
      AND ($4::text IS NULL OR tt.term::text = $4)

    UNION

    SELECT DISTINCT
      sub.id,
      sub.name
    FROM attendance_sessions ats
    INNER JOIN subjects sub ON sub.id = ats.subject_id
    WHERE ats.teacher_id = $1
      AND ats.section_id = $2
      AND ats.academic_year_id = $3
      AND ats.school_id = $5
      AND ($4::text IS NULL OR ats.term::text = $4)
    ORDER BY name
  `;

  const fallbackResult = await pool.query(fallbackQuery, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    schoolId
  ]);

  return fallbackResult.rows;
}

async function querySectionStudents({ sectionId, academicYearId, term = null, schoolId }) {
  const query = `
    SELECT
      s.id,
      s.student_code,
      s.full_name
    FROM student_enrollments se
    INNER JOIN students s ON s.id = se.student_id
    WHERE se.section_id = $1
      AND se.academic_year_id = $2
      AND se.school_id = $4
      AND ($3::text IS NULL OR se.term::text = $3)
      AND COALESCE(se.status, 'enrolled') <> 'inactive'
    ORDER BY s.full_name
  `;

  const result = await pool.query(query, [sectionId, academicYearId, term, schoolId]);

  return result.rows.map((row) => ({
    ...row,
    name: getStudentName(row),
  }));
}

async function querySingleStudent(studentId, schoolId) {
  const query = `
    SELECT
      id,
      student_code,
      full_name
    FROM students
    WHERE id = $1 AND school_id = $2
    LIMIT 1
  `;

  const result = await pool.query(query, [studentId, schoolId]);

  if (!result.rows.length) return null;

  return {
    ...result.rows[0],
    name: getStudentName(result.rows[0]),
  };
}

async function queryScopeInfo(sectionId, academicYearId, schoolId) {
  const query = `
    SELECT
      ay.name AS academic_year_name,
      s.name AS section_name,
      COALESCE(g.grade_name, g.name) AS grade_name,
      st.name AS stage_name
    FROM sections s
    INNER JOIN grades g ON g.id = s.grade_id
    INNER JOIN stages st ON st.id = g.stage_id
    LEFT JOIN academic_years ay ON ay.id = $2 AND ay.school_id = $3
    WHERE s.id = $1 AND s.school_id = $3
    LIMIT 1
  `;

  const result = await pool.query(query, [sectionId, academicYearId, schoolId]);
  return result.rows[0] || null;
}

async function querySubjectInfo(subjectId, schoolId) {
  const query = `
    SELECT id, name
    FROM subjects
    WHERE id = $1 AND school_id = $2
    LIMIT 1
  `;

  const result = await pool.query(query, [subjectId, schoolId]);
  return result.rows[0] || null;
}

async function querySectionAssessments({
  teacherId,
  academicYearId,
  term,
  sectionId,
  subjectId = null,
  schoolId
}) {
  const query = `
    SELECT
      a.id,
      a.title,
      a.type AS assessment_type,
      COALESCE(a.due_at::date, a.starts_at::date) AS assessment_date
    FROM assessments a
    INNER JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    WHERE ta.teacher_id = $1
      AND ta.section_id = $2
      AND ta.academic_year_id = $3
      AND ta.school_id = $6
      AND ($4::text IS NULL OR ta.term::text = $4)
      AND ($5::int IS NULL OR ta.subject_id = $5)
    ORDER BY COALESCE(a.due_at, a.starts_at) DESC NULLS LAST, a.id DESC
  `;

  const result = await pool.query(query, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    subjectId,
    schoolId
  ]);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.title,
    title: row.title,
    assessment_type: row.assessment_type,
    assessment_date: row.assessment_date,
  }));
}

async function querySingleAssessment({
  assessmentId,
  teacherId,
  sectionId,
  academicYearId,
  term,
  subjectId = null,
  schoolId
}) {
  const query = `
    SELECT
      a.id,
      a.title,
      a.type AS assessment_type,
      COALESCE(a.due_at::date, a.starts_at::date) AS assessment_date,
      a.max_score
    FROM assessments a
    INNER JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    WHERE a.id = $1
      AND ta.teacher_id = $2
      AND ta.section_id = $3
      AND ta.academic_year_id = $4
      AND ta.school_id = $7
      AND ($5::text IS NULL OR ta.term::text = $5)
      AND ($6::int IS NULL OR ta.subject_id = $6)
    LIMIT 1
  `;

  const result = await pool.query(query, [
    assessmentId,
    teacherId,
    sectionId,
    academicYearId,
    term,
    subjectId,
    schoolId
  ]);

  return result.rows[0] || null;
}

async function querySectionAssignments({
  teacherId,
  academicYearId,
  term,
  sectionId,
  subjectId = null,
  schoolId
}) {
  const query = `
    SELECT
      a.id,
      a.title,
      a.type AS assessment_type,
      COALESCE(a.due_at::date, a.starts_at::date) AS assessment_date
    FROM assessments a
    INNER JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    WHERE ta.teacher_id = $1
      AND ta.section_id = $2
      AND ta.academic_year_id = $3
      AND ta.school_id = $6
      AND ($4::text IS NULL OR ta.term::text = $4)
      AND ($5::int IS NULL OR ta.subject_id = $5)
      AND LOWER(a.type) IN ('homework', 'assignment', 'task')
    ORDER BY COALESCE(a.due_at, a.starts_at) DESC NULLS LAST, a.id DESC
  `;

  const result = await pool.query(query, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    subjectId,
    schoolId
  ]);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.title,
    title: row.title,
    assessment_type: row.assessment_type,
    assessment_date: row.assessment_date,
  }));
}

async function queryAssessmentGradeRows({
  teacherId,
  sectionId,
  academicYearId,
  term,
  subjectId,
  fromDate,
  toDate,
  assessmentType,
  studentId,
  assessmentId,
  schoolId
}) {
  const query = `
    SELECT
      ag.student_id,
      ag.assessment_id,
      ag.score,
      ag.feedback AS notes,
      a.title,
      a.type AS assessment_type,
      a.max_score,
      COALESCE(a.due_at::date, a.starts_at::date) AS assessment_date,
      s.full_name
    FROM assessment_grades ag
    INNER JOIN assessments a ON a.id = ag.assessment_id
    INNER JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
    INNER JOIN students s ON s.id = ag.student_id
    WHERE ta.teacher_id = $1
      AND ta.section_id = $2
      AND ta.academic_year_id = $3
      AND ta.school_id = $11
      AND ($4::text IS NULL OR ta.term::text = $4)
      AND ($5::int IS NULL OR ta.subject_id = $5)
      AND ($6::date IS NULL OR COALESCE(a.due_at::date, a.starts_at::date) >= $6::date)
      AND ($7::date IS NULL OR COALESCE(a.due_at::date, a.starts_at::date) <= $7::date)
      AND ($8::text IS NULL OR a.type = $8)
      AND ($9::int IS NULL OR ag.student_id = $9)
      AND ($10::int IS NULL OR a.id = $10)
    ORDER BY COALESCE(a.due_at, a.starts_at) ASC NULLS LAST, s.full_name ASC
  `;

  const result = await pool.query(query, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    subjectId,
    fromDate,
    toDate,
    assessmentType,
    studentId,
    assessmentId,
    schoolId
  ]);

  return result.rows.map((row) => ({
    ...row,
    student_name: getStudentName(row),
  }));
}

async function queryAttendanceRows({
  teacherId,
  sectionId,
  academicYearId,
  term,
  subjectId,
  fromDate,
  toDate,
  studentId,
  schoolId
}) {
  const query = `
    SELECT
      ae.student_id,
      ae.status,
      ae.note AS notes,
      ats.attendance_date AS session_date,
      s.full_name
    FROM attendance_entries ae
    INNER JOIN attendance_sessions ats ON ats.id = ae.session_id
    INNER JOIN students s ON s.id = ae.student_id
    WHERE ats.teacher_id = $1
      AND ats.section_id = $2
      AND ats.academic_year_id = $3
      AND ats.school_id = $9
      AND ($4::text IS NULL OR ats.term::text = $4)
      AND ($5::int IS NULL OR ats.subject_id = $5)
      AND ($6::date IS NULL OR ats.attendance_date >= $6::date)
      AND ($7::date IS NULL OR ats.attendance_date <= $7::date)
      AND ($8::int IS NULL OR ae.student_id = $8)
    ORDER BY ats.attendance_date ASC, s.full_name ASC
  `;

  const result = await pool.query(query, [
    teacherId,
    sectionId,
    academicYearId,
    term,
    subjectId,
    fromDate,
    toDate,
    studentId,
    schoolId
  ]);

  return result.rows.map((row) => ({
    ...row,
    student_name: getStudentName(row),
  }));
}

/* -------------------------------------------------------------------------- */
/* PDF / HTML                                 */
/* -------------------------------------------------------------------------- */

async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html); // أو waitUntil: "load"

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        right: "20px",
        bottom: "20px",
        left: "20px",
      },
    });
  } finally {
    await browser.close();
  }
}

function renderReportHtml(report) {
  const metaHtml = report.meta
    .map(
      (item) => `
        <div class="meta-item">
          <div class="meta-label">${escapeHtml(item.label)}</div>
          <div class="meta-value">${escapeHtml(item.value || "-")}</div>
        </div>
      `
    )
    .join("");

  const summaryHtml = report.summary?.length
    ? `
      <div class="summary-box">
        ${report.summary
          .map((item) => `<div class="summary-item">${escapeHtml(item)}</div>`)
          .join("")}
      </div>
    `
    : "";

  const headerCells = report.columns
    .map((col) => `<th>${escapeHtml(col)}</th>`)
    .join("");

  const bodyRows = report.rows
    .map(
      (row) => `
        <tr>
          ${row
            .map(
              (cell) =>
                `<td>${escapeHtml(
                  cell === null || cell === undefined ? "-" : String(cell)
                )}</td>`
            )
            .join("")}
        </tr>
      `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(report.title)}</title>
        <style>
          * {
            box-sizing: border-box;
          }

          body {
            font-family: Arial, "Segoe UI", Tahoma, sans-serif;
            color: #111827;
            margin: 0;
            padding: 0;
            direction: rtl;
          }

          .page {
            width: 100%;
          }

          .header {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
            margin-bottom: 16px;
          }

          .school-name {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 6px;
          }

          .report-title {
            font-size: 18px;
            font-weight: 700;
            color: #0f172a;
          }

          .meta-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin: 18px 0;
          }

          .meta-item {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 10px 12px;
            background: #f9fafb;
          }

          .meta-label {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 4px;
          }

          .meta-value {
            font-size: 14px;
            font-weight: 700;
          }

          .summary-box {
            margin: 16px 0 18px;
            padding: 12px;
            border-radius: 8px;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
          }

          .summary-item {
            font-size: 13px;
            margin-bottom: 6px;
          }

          .summary-item:last-child {
            margin-bottom: 0;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 12px;
          }

          thead th {
            background: #0f172a;
            color: white;
            border: 1px solid #0f172a;
            padding: 8px 6px;
            text-align: center;
          }

          tbody td {
            border: 1px solid #d1d5db;
            padding: 7px 6px;
            text-align: center;
            word-wrap: break-word;
          }

          tbody tr:nth-child(even) {
            background: #f9fafb;
          }

          .footer {
            margin-top: 18px;
            font-size: 11px;
            color: #6b7280;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div class="school-name">${escapeHtml(
              report.meta?.find((x) => x.label === "اسم المدرسة")?.value || "المدرسة"
            )}</div>
            <div class="report-title">${escapeHtml(report.title)}</div>
          </div>

          <div class="meta-grid">
            ${metaHtml}
          </div>

          ${summaryHtml}

          <table>
            <thead>
              <tr>${headerCells}</tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
          </table>

          <div class="footer">
            تم إنشاء هذا التقرير آليًا من نظام إدارة المدرسة
          </div>
        </div>
      </body>
    </html>
  `;
}

/* -------------------------------------------------------------------------- */
/* SMALL HELPERS                               */
/* -------------------------------------------------------------------------- */

function getReportFileName(reportType) {
  const names = {
    class_grades_report: "class-grades-report.pdf",
    student_performance_report: "student-performance-report.pdf",
    attendance_report: "attendance-report.pdf",
    exam_results_summary: "exam-results-summary.pdf",
    assignments_report: "assignments-report.pdf",
    struggling_students_report: "struggling-students-report.pdf",
    top_students_report: "top-students-report.pdf",
    grade_entry_sheet: "grade-entry-sheet.pdf",
  };

  return names[reportType] || "teacher-report.pdf";
}

function getStudentName(row) {
  return row?.full_name || joinName(row) || row?.name || "-";
}

function joinName(row) {
  if (row?.full_name) return row.full_name;

  const parts = [
    row?.first_name,
    row?.second_name,
    row?.third_name,
    row?.last_name,
  ].filter(Boolean);

  return parts.join(" ").trim();
}

function normalizeAssessmentType(value) {
  const v = String(value || "").toLowerCase();

  if (["homework", "assignment", "task"].includes(v)) return "homework";
  if (["participation", "classwork", "activity"].includes(v)) return "participation";
  if (["final", "final_exam"].includes(v)) return "final";
  return "exam";
}

function normalizeAttendanceStatus(value) {
  const v = String(value || "").toLowerCase();

  if (["present", "حاضر"].includes(v)) return "present";
  if (["absent", "غائب"].includes(v)) return "absent";
  if (["late", "متأخر"].includes(v)) return "late";
  return "excused";
}

function getAttendanceStatusLabel(value) {
  const status = normalizeAttendanceStatus(value);

  if (status === "present") return "حاضر";
  if (status === "absent") return "غائب";
  if (status === "late") return "متأخر";
  return "مستأذن";
}

function getEvaluationTypeLabel(value) {
  const map = {
    quiz: "اختبار قصير",
    exam: "اختبار",
    midterm: "منتصف الفصل",
    final: "نهائي",
    homework: "واجب",
    assignment: "واجب",
    task: "تكليف",
    participation: "مشاركة",
    project: "مشروع",
    oral: "شفهي",
  };

  return map[value] || value || "-";
}

function getStrugglingCriteriaLabel(value) {
  const map = {
    below_50: "أقل من 50",
    below_60: "أقل من 60",
    below_average: "أقل من متوسط الصف",
    high_absence_low_grade: "غياب مرتفع مع درجات منخفضة",
  };

  return map[value] || "-";
}

function getTopCriteriaLabel(value) {
  const map = {
    above_90: "أعلى من 90",
    above_95: "أعلى من 95",
    top_3: "أفضل 3 طلاب",
    top_5: "أفضل 5 طلاب",
    top_10: "أفضل 10 طلاب",
  };

  return map[value] || "-";
}

function getGradeSheetTypeLabel(value) {
  const map = {
    period: "رصد فترة محددة",
    final: "رصد نهائي",
    assessment_type: "حسب نوع التقييم",
  };

  return map[value] || "-";
}

function getPeriodLabel(payload) {
  if (payload.period === "custom" || payload.period === "month") {
    return `${payload.fromDate || "-"} إلى ${payload.toDate || "-"}`;
  }

  if (payload.period === "term") {
    return TERM_LABELS[payload.term] || payload.term || "-";
  }

  if (payload.period === "all") {
    return "كل الفترة";
  }

  return payload.period || "-";
}

function getPerformanceRating(percentage) {
  if (percentage >= 90) return "ممتاز";
  if (percentage >= 80) return "جيد جدًا";
  if (percentage >= 70) return "جيد";
  if (percentage >= 60) return "مقبول";
  if (percentage > 0) return "ضعيف";
  return "لا يوجد";
}

function averageOf(numbers) {
  const clean = numbers.filter((x) => Number.isFinite(x));
  if (!clean.length) return 0;
  return clean.reduce((sum, n) => sum + n, 0) / clean.length;
}

function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toFixed(2).replace(/\.00$/, "")
    : "0";
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function valueOrNull(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}