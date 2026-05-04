import { pool } from "../config/db.js";

// دالة مساعدة لجلب ID المستخدم
function pickUserId(req) {
  return req.user?.id ?? req.user?.user_id ?? req.user?.userId ?? null;
}

// دالة مساعدة لتحديد حالة الواجب/النشاط
function buildStudentStatus(row) {
  // إذا نشر المعلم الدرجة
  if (row.is_published === true && row.score !== null) return "graded";
  // إذا سلم الطالب الواجب
  if (row.submission_id) return "submitted";
  // إذا قفل المعلم الواجب والطالب لم يسلم
  if (row.status === "closed" && !row.submission_id) return "missed";
  // عدا ذلك فهو بانتظار الحل
  return "pending";
}

export async function getChildActivities(req, res) {
  try {
    const parentUserId = pickUserId(req);
    const schoolId = req.user?.school_id; // ✅ جلب هوية المدرسة من التوكن
    
    if (!parentUserId || !schoolId) return res.status(401).json({ message: "غير مصرح." });

    const childId = Number(req.params.childId);
    if (!childId) return res.status(400).json({ message: "رقم الابن غير صحيح." });

    // 1. التحقق الأمني: هل هذا الطالب فعلاً ابن لهذا الولي؟ (مع حماية المدرسة)
    // نمر عبر الجدول الوسيط student_guardians لربط الطالب بولي الأمر
    const childCheckQ = await pool.query(
      `SELECT s.id 
       FROM students s
       JOIN student_guardians sg ON s.id = sg.student_id
       JOIN guardians g ON g.id = sg.guardian_id
       WHERE s.id = $1 
         AND g.user_id = $2 
         AND s.school_id = $3 
         AND sg.school_id = $3
         AND g.school_id = $3`,
      [childId, parentUserId, schoolId]
    );

    if (childCheckQ.rowCount === 0) {
      return res.status(403).json({ message: "عذراً، هذا الطالب غير مرتبط بحسابك أو لا يتبع لمدرستك." });
    }

    // 2. جلب بيانات التسجيل الفعّال للابن لمعرفة فصله وشعبته (مع حماية المدرسة)
    const ctxQ = await pool.query(
      `SELECT se.academic_year_id, se.term, se.stage_id, se.grade_id, se.section_id
       FROM student_enrollments se
       JOIN academic_years ay ON ay.id = se.academic_year_id
       WHERE se.student_id = $1 
         AND COALESCE(se.status, 'enrolled') = 'enrolled' 
         AND ay.is_active = true
         AND se.school_id = $2
         AND ay.school_id = $2
       ORDER BY se.id DESC LIMIT 1`,
      [childId, schoolId]
    );

    const studentCtx = ctxQ.rows[0];
    if (!studentCtx) {
      return res.json({ items: [] }); // لا يوجد تسجيل دراسي فعال
    }

    // 3. جلب الأنشطة والاختبارات المطروحة لهذه الشعبة (مع حماية المدرسة)
    // ولي الأمر يرى فقط الأنشطة "المنشورة" أو "المغلقة" (لا يرى المسودات)
    const { rows } = await pool.query(
      `
      SELECT 
        a.id,
        a.title,
        a.type,
        a.status,
        a.max_score,
        a.due_at,
        subj.name AS subject_name,
        t.full_name AS teacher_name,
        sub.id AS submission_id,
        ag.score,
        ag.feedback,
        ag.is_published
      FROM assessments a
      JOIN teacher_assignments ta ON ta.id = a.teacher_assignment_id
      LEFT JOIN subjects subj ON subj.id = ta.subject_id
      LEFT JOIN teachers t ON t.id = ta.teacher_id
      LEFT JOIN submissions sub ON sub.assessment_id = a.id AND sub.student_id = $1
      LEFT JOIN assessment_grades ag ON ag.assessment_id = a.id AND ag.student_id = $1
      WHERE ta.academic_year_id = $2
        AND ta.term = $3
        AND (ta.section_id = $4 OR (ta.section_id IS NULL AND ta.grade_id = $5))
        AND a.type NOT IN ('continuous_assessment', 'midterm_muhassala', 'final_muhassala')
        AND a.status IN ('published', 'closed')
        AND a.school_id = $6
        AND ta.school_id = $6
      ORDER BY COALESCE(a.due_at, a.created_at) DESC
      `,
      [
        childId,
        studentCtx.academic_year_id,
        studentCtx.term,
        studentCtx.section_id,
        studentCtx.grade_id,
        schoolId // ✅ تمرير الـ school_id كمتغير سادس
      ]
    );

    // 4. معالجة البيانات وإرسالها للواجهة الأمامية
    const items = rows.map(row => {
      // إخفاء الدرجة إذا لم يقم المعلم بنشرها رسمياً
      const canSeeScore = row.is_published === true && row.score !== null;

      return {
        id: row.id,
        title: row.title,
        type: row.type,
        due_at: row.due_at,
        max_score: row.max_score,
        subject_name: row.subject_name,
        teacher_name: row.teacher_name,
        student_status: buildStudentStatus(row),
        score: canSeeScore ? row.score : null,
        feedback: canSeeScore ? row.feedback : null,
      };
    });

    return res.json({ items });

  } catch (e) {
    console.error("getChildActivities error:", e);
    return res.status(500).json({ message: "خطأ في السيرفر أثناء جلب أنشطة الابن." });
  }
}