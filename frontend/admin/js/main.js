// ===============================
// System Core & Dashboard Widgets
// ===============================
(function () {
  "use strict";

  const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const apiUrl =
  typeof window.apiUrl === "function"
    ? window.apiUrl
    : function (path = "") {
        if (/^https?:\/\//i.test(path)) return path;

        let cleanPath = String(path || "").replace(/^\/+/, "");

        if (cleanPath.startsWith("api/")) {
          cleanPath = cleanPath.slice(4);
        }

        return `${API_BASE}/${cleanPath}`;
      };

const SERVER_URL = String(
  window.API_ORIGIN || window.location.origin
).replace(/\/+$/, "");

const $id = (id) => document.getElementById(id);
  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  function formatAr(n) {
    try { return Number(n).toLocaleString("ar-EG"); }
    catch { return String(n); }
  }

  function animateCount(el, to) {
    if (!el) return;
    const target = Number(to) || 0;
    const from = 0;
    const start = performance.now();
    const dur = 650;

    function tick(t) {
      const p = Math.min(1, (t - start) / dur);
      const v = Math.round(from + (target - from) * p);
      el.textContent = formatAr(v);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
function setText(id, value) {
  const el = $id(id);
  if (el) el.textContent = value;
}

function formatMoney(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString("ar-EG")} ر.س`;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  return `${Number(value || 0).toLocaleString("ar-EG")}٪`;
}
function setBar(id, value) {
  const el = $id(id);
  if (!el) return;

  const percent = Math.max(0, Math.min(100, Number(value || 0)));
  el.style.width = `${percent}%`;
}
async function loadAdminHomeDashboard() {
  try {
    const r = await fetch(apiUrl("/dashboard/admin-home"), {
      headers: { ...authHeaders() },
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(data?.message || "فشل تحميل بيانات لوحة المدير");
    }

    const summary = data.summary || {};
    const attendance = data.attendance_today || {};
    const finance = data.finance || {};
    const pending = data.pending_tasks || {};
const sectionsAttendance = data.sections_attendance_status || {};
const school = data.school || {};
const schoolName = school.name_ar || school.name_en || "المدرسة";

setText(
  "hero-sub",
  `أمامك ملخص تنفيذي لليوم في ${schoolName} من قاعدة البيانات: الحضور، الرسوم، والملفات التي تحتاج متابعتك.`
);
    // أرقام الدائرة الرئيسية
    animateCount($id("orbit-students"), summary.students_count || 0);
    animateCount($id("orbit-teachers"), summary.teachers_count || 0);
    animateCount($id("orbit-classes"), summary.sections_count || summary.grades_count || 0);

    // شرائح الهيرو
    setText("chip-attendance", attendance.configured ? formatPercent(attendance.attendance_rate) : "غير مربوط");
    setText("chip-fees", finance.configured ? formatMoney(finance.total_remaining) : "غير مربوط");
setText("chip-requests", `${formatAr(pending.total || 0)} طلب`);
    // مؤشرات اليوم
   const markedStudents = Number(attendance.marked_students || 0);
const absentStudents = Number(attendance.absent_students || 0);
const presentStudents = Number(attendance.present_students || 0);
const lateStudents = Number(attendance.late_students || 0);

const totalSectionsForAttendance = Number(sectionsAttendance.total_sections || 0);
const missingSectionsForAttendance = Number(sectionsAttendance.missing_sections || 0);

if (markedStudents <= 0 && missingSectionsForAttendance > 0) {
  setText("kpi-absent-students", "لم يبدأ");
  setText(
    "kpi-absent-sub",
    `${formatAr(missingSectionsForAttendance)} شعبة لم تسجل حضور اليوم.`
  );

  if (typeof setBar === "function") {
    setBar("kpi-absent-bar", 0);
  }

  setText("kpi-absent-trend", "—");
} else {
  setText("kpi-absent-students", `${formatAr(absentStudents)} طالب`);
  setText(
    "kpi-absent-sub",
    `الحضور اليوم: ${formatAr(presentStudents)} حاضر · ${formatAr(lateStudents)} متأخر`
  );

  if (typeof setBar === "function") {
    setBar("kpi-absent-bar", Number(attendance.attendance_rate || 0));
  }

  setText(
    "kpi-absent-trend",
    `${formatAr(Number(attendance.attendance_rate || 0))}٪`
  );
}

 const totalSections = Number(sectionsAttendance.total_sections || 0);
const recordedSections = Number(sectionsAttendance.recorded_sections || 0);
const missingSections = Number(sectionsAttendance.missing_sections || 0);
const sectionsCompletionRate = Number(sectionsAttendance.completion_rate || 0);
const missingExamples = Array.isArray(sectionsAttendance.missing_examples)
  ? sectionsAttendance.missing_examples
  : [];

setText("kpi-grades-completion", `${formatAr(missingSections)} شعبة`);

const visibleMissingExamples = missingExamples
  .map((item) => item.label)
  .filter(Boolean)
  .slice(0, 3);

const remainingMissingCount = Math.max(
  missingSections - visibleMissingExamples.length,
  0
);

const missingSectionsText =
  visibleMissingExamples.length > 0
    ? `${visibleMissingExamples.join("، ")}${
        remainingMissingCount > 0
          ? ` + ${formatAr(remainingMissingCount)} أخرى`
          : ""
      }`
    : `${formatAr(missingSections)} شعبة لم تسجل حضور اليوم.`;

setText(
  "kpi-grades-sub",
  missingSections > 0
    ? missingSectionsText
    : totalSections > 0
    ? "تم تسجيل حضور جميع الشعب اليوم."
    : "لا توجد شعب نشطة في المدرسة."
);

setBar("kpi-grades-bar", sectionsCompletionRate);

setText(
  "kpi-grades-trend",
  totalSections > 0
    ? `${formatAr(recordedSections)} / ${formatAr(totalSections)}`
    : "—"
);
    setText(
      "kpi-fees-payment",
      finance.configured ? formatPercent(finance.payment_rate) : "غير مربوط"
    );

    setText(
      "kpi-fees-sub",
      finance.configured
        ? `المتبقي: ${formatMoney(finance.total_remaining)}`
        : "لم يتم ربط جداول الرسوم بعد."
    );

    setText(
      "kpi-parent-requests",
      `${formatAr(pending.total || 0)} طلب`
    );

    setText(
      "kpi-parent-requests-sub",
      pending.total > 0
        ? `لديك ${formatAr(pending.total)} ملف بانتظار المتابعة.`
        : "لا توجد طلبات تحتاج قرار المدير الآن."
    );
const studentsCount = Number(summary.students_count || 0);

const absentPercent =
  attendance.configured && studentsCount > 0
    ? Math.round(((attendance.absent_students || 0) / studentsCount) * 100)
    : 0;

setBar("kpi-absent-bar", absentPercent);
setText(
  "kpi-absent-trend",
  attendance.configured ? `${formatAr(absentPercent)}٪` : "—"
);



setBar(
  "kpi-fees-bar",
  finance.configured ? Number(finance.payment_rate || 0) : 0
);
setText(
  "kpi-fees-trend",
  finance.configured ? formatPercent(finance.payment_rate) : "—"
);

const pendingPercent = Math.min(Number(pending.total || 0) * 10, 100);
setBar("kpi-parent-requests-bar", pendingPercent);
setText(
  "kpi-parent-requests-trend",
  pending.total > 0 ? `${formatAr(pending.total)} طلب` : "—"
);
  renderPendingTasks(pending);
loadAssessmentReopenRequests();
loadFeeAdjustmentRequests();
loadStudentTransferRequests();
    renderSchoolPulse(data.school_pulse || []);
  } catch (error) {
    console.error("Admin home dashboard error:", error);
  }
}

function renderPendingTasks(pending) {
  const board = document.getElementById("pending-tasks-board");
  if (!board) return;

  const items = Array.isArray(pending?.items) ? pending.items : [];

  if (!items.length) {
    board.innerHTML = `
      <div class="kanban-column">
        <h4>المهام</h4>
        <div class="task">
          <span class="task-title">لا توجد مهام تحتاج قرار المدير الآن.</span>
          <span class="task-meta">سيتم عرض الطلبات الحقيقية هنا عند توفرها.</span>
        </div>
      </div>
    `;
    return;
  }

  board.innerHTML = `
    <div class="kanban-column">
      <h4>بانتظار المتابعة</h4>
      ${items
        .map(
          (item) => `
          <div class="task task--warn">
            <span class="task-title">${item.title || "مهمة معلقة"}</span>
            <span class="task-meta">${formatAr(item.count || 0)} عنصر</span>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}
async function loadFeeAdjustmentRequests() {
  const board = document.getElementById("pending-tasks-board");
  if (!board) return;

  try {
    const response = await fetch(apiUrl("/admin/fee-adjustment-requests?status=pending"), {
      headers: { ...authHeaders() },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل تحميل طلبات تعديل الرسوم");
    }

    const items = Array.isArray(result.data) ? result.data : [];

    if (!items.length) return;

    const emptyText = board.textContent || "";
    if (emptyText.includes("لا توجد مهام تحتاج قرار المدير")) {
      board.innerHTML = "";
    }

    const cards = items
      .map((item) => {
        const studentName = item.student_name || "طالب غير محدد";
        const studentCode = item.student_code || "—";
        const amount = formatMoney(item.amount || 0);
        const reason = item.reason || "لا يوجد سبب مكتوب";
        const requestedBy = item.requested_by_name || "مستخدم";

        return `
          <div class="task task--warn" style="gap:10px;">
            <span class="task-title">طلب تعديل رسوم</span>

            <span class="task-meta">
              الطالب: ${studentName}<br>
              رقم الطالب: ${studentCode}<br>
              نوع الطلب: خصم<br>
              مبلغ الخصم: ${amount}<br>
              بواسطة: ${requestedBy}<br>
              السبب: ${reason}
            </span>

            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
              <button
                id="btn-approve-${item.id}"
                type="button"
                onclick="approveFeeAdjustmentRequest(${item.id})"
                style="
                  border:0;
                  border-radius:999px;
                  padding:7px 12px;
                  background:#22c55e;
                  color:white;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                قبول
              </button>

              <button
                id="btn-reject-${item.id}"
                type="button"
                onclick="rejectFeeAdjustmentRequest(${item.id})"
                style="
                  border:1px solid rgba(239,68,68,.45);
                  border-radius:999px;
                  padding:7px 12px;
                  background:rgba(239,68,68,.12);
                  color:#fecaca;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                رفض
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    board.insertAdjacentHTML(
      "beforeend",
      `
      <div class="kanban-column">
        <h4>طلبات تعديل الرسوم</h4>
        ${cards}
      </div>
      `
    );
  } catch (error) {
    console.error("Fee adjustment requests error:", error);
  }
}

window.approveFeeAdjustmentRequest = async function (id) {
  const btnApprove = document.getElementById(`btn-approve-${id}`);
  const btnReject = document.getElementById(`btn-reject-${id}`);

  const adminNote =
    (await window.AppUI.prompt({
      title: "قبول طلب تعديل الرسوم",
      message: "اكتب ملاحظة الموافقة إذا رغبت في توضيحها للمستخدم.",
      defaultValue: "تمت الموافقة على تعديل الرسوم",
      confirmText: "قبول الطلب",
      cancelText: "إلغاء",
    })) || "";

  if (btnApprove) {
    btnApprove.disabled = true;
    btnApprove.style.opacity = "0.6";
    btnApprove.innerText = "جاري القبول...";
  }
  if (btnReject) {
    btnReject.disabled = true;
    btnReject.style.opacity = "0.6";
  }

  try {
    const response = await fetch(apiUrl(`/admin/fee-adjustment-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول طلب تعديل الرسوم");
    }

    window.AppUI.toast(result.message || "تم قبول طلب تعديل الرسوم بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve fee adjustment request error:", error);
    await window.AppUI.alert({
      title: "تعذر قبول الطلب",
      message: error.message || "تعذر قبول طلب تعديل الرسوم.",
      type: "danger",
    });
    if (btnApprove) {
      btnApprove.disabled = false;
      btnApprove.style.opacity = "1";
      btnApprove.innerText = "قبول";
    }
    if (btnReject) {
      btnReject.disabled = false;
      btnReject.style.opacity = "1";
    }
  }
};

window.rejectFeeAdjustmentRequest = async function (id) {
  const btnApprove = document.getElementById(`btn-approve-${id}`);
  const btnReject = document.getElementById(`btn-reject-${id}`);

  const adminNote = await window.AppUI.prompt({
    title: "رفض طلب تعديل الرسوم",
    message: "اكتب سبب الرفض لإظهاره للمستخدم.",
    defaultValue: "",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });
  if (adminNote === null) return;

  if (!String(adminNote).trim()) {
    await window.AppUI.alert({
      title: "بيانات مطلوبة",
      message: "سبب الرفض مطلوب.",
      type: "warning",
    });
    return;
  }

  if (btnApprove) {
    btnApprove.disabled = true;
    btnApprove.style.opacity = "0.6";
  }
  if (btnReject) {
    btnReject.disabled = true;
    btnReject.style.opacity = "0.6";
    btnReject.innerText = "جاري الرفض...";
  }

  try {
    const response = await fetch(apiUrl(`/admin/fee-adjustment-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض طلب تعديل الرسوم");
    }

    window.AppUI.toast(result.message || "تم رفض طلب تعديل الرسوم بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject fee adjustment request error:", error);
    await window.AppUI.alert({
      title: "تعذر رفض الطلب",
      message: error.message || "تعذر رفض طلب تعديل الرسوم.",
      type: "danger",
    });
    if (btnApprove) {
      btnApprove.disabled = false;
      btnApprove.style.opacity = "1";
    }
    if (btnReject) {
      btnReject.disabled = false;
      btnReject.style.opacity = "1";
      btnReject.innerText = "رفض";
    }
  }
};
async function loadAssessmentReopenRequests() {
  const board = document.getElementById("pending-tasks-board");
  if (!board) return;

  try {
    const response = await fetch(apiUrl("/admin/assessment-reopen-requests?status=pending"), {
      headers: { ...authHeaders() },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل تحميل طلبات إعادة فتح التقييم");
    }

    const items = Array.isArray(result.data) ? result.data : [];

    if (!items.length) return;

    const emptyText = board.textContent || "";
    if (emptyText.includes("لا توجد مهام تحتاج قرار المدير")) {
      board.innerHTML = "";
    }

    const cards = items
      .map((item) => {
     const title =
  item.assessment_title ||
  item.assessment_title_short ||
  "تقييم بدون عنوان";

const teacherName = item.requested_by_name || "معلم";
const reason = item.reason || "لا يوجد سبب مكتوب";

const termLabel =
  Number(item.term) === 1
    ? "الفصل الأول"
    : Number(item.term) === 2
    ? "الفصل الثاني"
    : "فصل غير محدد";

const classLabel =
  item.class_label ||
  `${item.grade_name || "صف غير محدد"} - الشعبة ${item.section_name || "غير محددة"}`;
        return `
          <div class="task task--warn" style="gap:10px;">
            <span class="task-title">طلب إعادة فتح تقييم</span>
            <span class="task-meta">
         التقييم: ${title}<br>
الفصل: ${termLabel}<br>
الصف والشعبة: ${classLabel}<br>
بواسطة: ${teacherName}<br>
السبب: ${reason}
            </span>

            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
              <button
                type="button"
                onclick="approveAssessmentReopenRequest(${item.id})"
                style="
                  border:0;
                  border-radius:999px;
                  padding:7px 12px;
                  background:#22c55e;
                  color:white;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                قبول
              </button>

              <button
                type="button"
                onclick="rejectAssessmentReopenRequest(${item.id})"
                style="
                  border:1px solid rgba(239,68,68,.45);
                  border-radius:999px;
                  padding:7px 12px;
                  background:rgba(239,68,68,.12);
                  color:#fecaca;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                رفض
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    board.insertAdjacentHTML(
      "beforeend",
      `
      <div class="kanban-column">
        <h4>طلبات إعادة فتح التقييم</h4>
        ${cards}
      </div>
      `
    );
  } catch (error) {
    console.error("Assessment reopen requests error:", error);
  }
}
async function loadStudentTransferRequests() {
  const board = document.getElementById("pending-tasks-board");
  if (!board) return;

  try {
    const response = await fetch(apiUrl("/admin/student-transfer-requests?status=pending"), {
      headers: { ...authHeaders() },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل تحميل طلبات نقل الطلاب");
    }

    const items = Array.isArray(result.data) ? result.data : [];

    if (!items.length) return;

    const emptyText = board.textContent || "";
    if (emptyText.includes("لا توجد مهام تحتاج قرار المدير")) {
      board.innerHTML = "";
    }

    const cards = items
      .map((item) => {
        const studentName = item.student_name || "طالب غير محدد";
        const studentCode = item.student_code || "—";
        const fromClass = item.from_class_label || "غير محدد";
        const toClass = item.to_class_label || "غير محدد";
        const reason = item.reason || "لا يوجد سبب مكتوب";
        const requestedBy = item.requested_by_name || "مستخدم";

        return `
          <div class="task task--warn" style="gap:10px;">
            <span class="task-title">طلب نقل طالب</span>

            <span class="task-meta">
              الطالب: ${studentName} · ${studentCode}<br>
              من: ${fromClass}<br>
              إلى: ${toClass}<br>
              بواسطة: ${requestedBy}<br>
              السبب: ${reason}
            </span>

            <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
              <button
                type="button"
                onclick="approveStudentTransferRequest(${item.id})"
                style="
                  border:0;
                  border-radius:999px;
                  padding:7px 12px;
                  background:#22c55e;
                  color:white;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                قبول
              </button>

              <button
                type="button"
                onclick="rejectStudentTransferRequest(${item.id})"
                style="
                  border:1px solid rgba(239,68,68,.45);
                  border-radius:999px;
                  padding:7px 12px;
                  background:rgba(239,68,68,.12);
                  color:#fecaca;
                  font-weight:800;
                  cursor:pointer;
                  font-size:12px;
                "
              >
                رفض
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    board.insertAdjacentHTML(
      "beforeend",
      `
      <div class="kanban-column">
        <h4>طلبات نقل الطلاب</h4>
        ${cards}
      </div>
      `
    );
  } catch (error) {
    console.error("Student transfer requests error:", error);
  }
}

window.approveStudentTransferRequest = async function (id) {
  const adminNote =
    (await window.AppUI.prompt({
      title: "قبول طلب نقل الطالب",
      message: "اكتب ملاحظة الموافقة إذا رغبت في توضيحها للمستخدم.",
      defaultValue: "تمت الموافقة على نقل الطالب",
      confirmText: "قبول الطلب",
      cancelText: "إلغاء",
    })) || "";

  try {
    const response = await fetch(apiUrl(`/admin/student-transfer-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول طلب النقل");
    }

    window.AppUI.toast(result.message || "تم قبول طلب نقل الطالب بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve student transfer request error:", error);
    await window.AppUI.alert({
      title: "تعذر قبول طلب النقل",
      message: error.message || "تعذر قبول طلب نقل الطالب.",
      type: "danger",
    });
  }
};

window.rejectStudentTransferRequest = async function (id) {
  const adminNote = await window.AppUI.prompt({
    title: "رفض طلب نقل الطالب",
    message: "اكتب سبب رفض طلب النقل لإظهاره للمستخدم.",
    defaultValue: "",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });
  if (adminNote === null) return;

  if (!String(adminNote).trim()) {
    await window.AppUI.alert({
      title: "بيانات مطلوبة",
      message: "سبب الرفض مطلوب.",
      type: "warning",
    });
    return;
  }

  try {
    const response = await fetch(apiUrl(`/admin/student-transfer-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض طلب النقل");
    }

    window.AppUI.toast(result.message || "تم رفض طلب نقل الطالب بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject student transfer request error:", error);
    await window.AppUI.alert({
      title: "تعذر رفض طلب النقل",
      message: error.message || "تعذر رفض طلب نقل الطالب.",
      type: "danger",
    });
  }
};
window.approveAssessmentReopenRequest = async function (id) {
  const hours = await window.AppUI.prompt({
    title: "مدة إعادة فتح التقييم",
    message: "أدخل عدد الساعات التي سيبقى فيها التقييم مفتوحًا للتعديل.",
    defaultValue: "24",
    confirmText: "متابعة",
    cancelText: "إلغاء",
    required: true,
    requiredMessage: "عدد الساعات مطلوب.",
  });
  if (hours === null) return;

  const adminNote =
    (await window.AppUI.prompt({
      title: "قبول طلب إعادة فتح التقييم",
      message: "اكتب ملاحظة الموافقة إذا رغبت في توضيحها للمعلم.",
      defaultValue: "تمت الموافقة لإصلاح الدرجات",
      confirmText: "قبول الطلب",
      cancelText: "إلغاء",
    })) || "";

  try {
    const response = await fetch(apiUrl(`/admin/assessment-reopen-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
        reopen_hours: Number(hours) || 24,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول الطلب");
    }

    window.AppUI.toast(result.message || "تم قبول طلب إعادة فتح التقييم بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve reopen request error:", error);
    await window.AppUI.alert({
      title: "تعذر قبول الطلب",
      message: error.message || "تعذر قبول طلب إعادة فتح التقييم.",
      type: "danger",
    });
  }
};

window.rejectAssessmentReopenRequest = async function (id) {
  const adminNote = await window.AppUI.prompt({
    title: "رفض طلب إعادة فتح التقييم",
    message: "اكتب سبب الرفض لإظهاره للمعلم.",
    defaultValue: "",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });
  if (adminNote === null) return;

  if (!String(adminNote).trim()) {
    await window.AppUI.alert({
      title: "بيانات مطلوبة",
      message: "سبب الرفض مطلوب.",
      type: "warning",
    });
    return;
  }

  try {
    const response = await fetch(apiUrl(`/admin/assessment-reopen-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض الطلب");
    }

    window.AppUI.toast(result.message || "تم رفض طلب إعادة فتح التقييم بنجاح ✅", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject reopen request error:", error);
    await window.AppUI.alert({
      title: "تعذر رفض الطلب",
      message: error.message || "تعذر رفض طلب إعادة فتح التقييم.",
      type: "danger",
    });
  }
};
  // 🕒 دالة احترافية لتحويل الوقت إلى صيغة "منذ..."
  function timeAgo(dateString) {
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return "الآن";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "أمس";
    if (days === 2) return "منذ يومين";
    return `منذ ${days} أيام`;
  }

  // ===============================
  // 1. إحصائيات النظام
  // ===============================
  async function loadOrbitStats() {
    const elStudents = $id("orbit-students");
    const elTeachers = $id("orbit-teachers");
    const elClasses = $id("orbit-classes");

    [elStudents, elTeachers, elClasses].forEach((el) => {
      if (el) el.textContent = "…";
    });

    try {
      let schoolIdParam = "";
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const userObj = JSON.parse(userStr);
        const currentSchoolId = userObj.school_id || userObj.school?.id; 
        if (currentSchoolId) schoolIdParam = `?schoolId=${currentSchoolId}`;
      }

      const r = await fetch(apiUrl(`/dashboard/stats${schoolIdParam}`), {
  headers: { ...authHeaders() },
});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.message || "فشل تحميل الإحصائيات");

      animateCount(elStudents, data.students);
      animateCount(elTeachers, data.teachers);
      animateCount(elClasses, data.classes); 
    } catch (e) {
      console.error("Orbit stats error:", e);
      if (elStudents) elStudents.textContent = "0";
      if (elTeachers) elTeachers.textContent = "0";
      if (elClasses) elClasses.textContent = "0";
    }
  }

  // ===============================
  // 2. سجل النشاطات المباشر (Live Radar)
  // ===============================
 // ===============================
  // 2. سجل النشاطات المباشر (النسخة الأنيقة)
  // ===============================
  // ===============================
  // 2. سجل النشاطات المباشر (النسخة النظيفة والمتوافقة 100% مع شاشات الجوال)
  // ===============================
// ===============================
  // 2. سجل النشاطات المباشر (متوافق 100% مع قالبك الأصلي)
  // ===============================
 // ===============================
  // 2. سجل النشاطات المباشر (النسخة الأنيقة والفخمة)
  // ===============================
 // ===============================
  // 2. سجل النشاطات (مفلتر باليوم + النقر للتفاصيل)
  // ===============================

  // إضافة مستمع لحقل التاريخ عندما يتم تغيير اليوم
  // ===============================
  // 2. سجل النشاطات المباشر (تفاصيل كاملة وآمنة)
  // ===============================
  // ===============================
  // 2. سجل النشاطات المباشر - عرض إداري مختصر
  // ===============================

  const ACTIVITY_ACTION_LABELS = {
    VIEW: "عرض",
    CREATE: "إضافة",
    UPDATE: "تعديل",
    DELETE: "حذف",
    LOGIN: "تسجيل دخول",
    LOGOUT: "تسجيل خروج",
    APPROVE: "اعتماد",
    REJECT: "رفض",
    PUBLISH: "نشر",
    UNPUBLISH: "إلغاء نشر",
    PRINT: "طباعة",
    EXPORT: "تصدير",
    IMPORT: "استيراد",
    ISSUE: "إصدار",
    CANCEL: "إلغاء",
    LOCK: "إغلاق",
    UNLOCK: "إعادة فتح",
    ACTIVATE: "تفعيل",
    DEACTIVATE: "تعطيل",
    RESTORE: "استعادة",
    DOWNLOAD: "تنزيل",
    SEND: "إرسال",
    SUBMIT: "تسليم",
    TRANSFER: "نقل",
    DENY: "رفض وصول",
    RESET: "إعادة تعيين",
    ACTIVITY: "عملية",
  };

  const ACTIVITY_MODULE_LABELS = {
    Security: "الأمان وتسجيل الدخول",
    Finance: "الرسوم والمدفوعات",
    Grades: "الدرجات والنتائج",
    users: "المستخدمون",
    roles: "الأدوار والصلاحيات",
    permissions: "الصلاحيات",
    students: "الطلاب",
    guardians: "أولياء الأمور",
    employees: "الموظفون والمعلمون",
    schools: "إعدادات المدرسة",
    "school-settings": "إعدادات المدرسة",
    "academic-years": "السنوات الدراسية",
    stages: "المراحل الدراسية",
    grades: "الصفوف الدراسية",
    sections: "الشعب الدراسية",
    subjects: "المواد الدراسية",
    periods: "الحصص الدراسية",
    curriculum: "الخطة الدراسية",
    "assign-teachers": "توزيع المعلمين",
    attendance: "الحضور والغياب",
    assessments: "الاختبارات والتقييمات",
    results: "النتائج الدراسية",
    fees: "الرسوم والمدفوعات",
    "fee-rules": "قواعد الرسوم",
    "fee-adjustments": "طلبات تعديل الرسوم",
    reports: "التقارير المدرسية",
    "school-reports": "التقارير المدرسية",
    backups: "النسخ الاحتياطية",
    notifications: "الإشعارات والرسائل",
    timetables: "الجداول الدراسية",
    certificates: "الشهادات",
    transfers: "طلبات نقل الطلاب",
    "student-transfer-requests": "طلبات نقل الطلاب",
    permits: "الأذونات",
    learning: "الأنشطة التعليمية",
    system: "النظام",
    System: "النظام",
  };

  const ACTIVITY_FIELD_LABELS = {
    name: "الاسم",
    full_name: "الاسم الكامل",
    student_name: "اسم الطالب",
    employee_name: "اسم الموظف",
    teacher_name: "اسم المعلم",
    guardian_name: "اسم ولي الأمر",
    username: "اسم المستخدم",
    phone: "رقم الهاتف",
    job_title: "المسمى الوظيفي",
    is_teacher: "نوع الموظف",
    is_active: "الحالة",
    status: "الحالة",
    grade_name: "الصف",
    section_name: "الشعبة",
    subject_name: "المادة",
    assessment_title: "التقييم",
    title: "العنوان",
    amount: "المبلغ",
    paid_amount: "المبلغ المدفوع",
    remaining_amount: "المبلغ المتبقي",
    receipt_number: "رقم السند",
    payment_method: "طريقة الدفع",
    attendance_status: "حالة الحضور",
    reason: "السبب",
    notes: "الملاحظات",
  };

  const ACTIVITY_ROLE_LABELS = {
    school_admin: "مدير المدرسة",
    platform_admin: "مدير المنصة",
    student: "طالب",
    parent: "ولي أمر",
    teacher: "معلم",
    employee: "موظف",
    system: "النظام",
  };

  const ACTIVITY_FIELD_PRIORITY = [
    "full_name",
    "student_name",
    "employee_name",
    "teacher_name",
    "guardian_name",
    "name",
    "title",
    "assessment_title",
    "job_title",
    "is_teacher",
    "is_active",
    "status",
    "grade_name",
    "section_name",
    "subject_name",
    "attendance_status",
    "amount",
    "paid_amount",
    "remaining_amount",
    "receipt_number",
    "payment_method",
    "reason",
    "notes",
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function localDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function firstValue(...values) {
    return values.find((value) => value !== null && value !== undefined && value !== "");
  }

  function fieldLabel(field) {
    return ACTIVITY_FIELD_LABELS[field] || "";
  }

  function roleLabel(role) {
    return ACTIVITY_ROLE_LABELS[role] || role || "—";
  }

  function severityLabel(severity) {
    return {
      normal: "عادي",
      important: "مهم",
      sensitive: "حساس",
      danger: "خطير",
      critical: "خطير",
    }[severity] || "عادي";
  }

  function resultLabel(result) {
    return result === "failure" ? "فاشلة" : "ناجحة";
  }

  function maskPhone(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length < 7) return String(value ?? "—");
    return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
  }

  function formatActivityValue(value, field = "") {
    if (value === null || value === undefined || value === "") return "—";
    if (field === "phone") return maskPhone(value);
    if (field === "is_active") return value === true || value === "true" || value === 1 || value === "1" ? "نشط" : "غير نشط";
    if (field === "is_teacher") return value === true || value === "true" || value === 1 || value === "1" ? "معلم" : "موظف إداري";
    if (field === "status" || field === "attendance_status") {
      const labels = {
        active: "نشط",
        inactive: "غير نشط",
        pending: "بانتظار المراجعة",
        approved: "مقبول",
        rejected: "مرفوض",
        present: "حاضر",
        absent: "غائب",
        late: "متأخر",
      };
      return labels[String(value).toLowerCase()] || String(value);
    }
    if (/amount$/i.test(field)) return `${Number(value || 0).toLocaleString("ar-EG")} ريال`;
    if (typeof value === "boolean") return value ? "نعم" : "لا";
    if (typeof value === "object") return "تم حفظ بيانات إضافية";
    return String(value);
  }

  function isUsefulManagerField(field) {
    return Boolean(ACTIVITY_FIELD_LABELS[field]);
  }

  function sortActivityFields(a, b) {
    const ai = ACTIVITY_FIELD_PRIORITY.indexOf(a.field);
    const bi = ACTIVITY_FIELD_PRIORITY.indexOf(b.field);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }

  function managerRows(data, max = 5) {
    return Object.entries(parseJsonObject(data))
      .filter(([field, value]) => isUsefulManagerField(field) && value !== null && value !== undefined && value !== "")
      .map(([field, value]) => ({ field, label: fieldLabel(field), value: formatActivityValue(value, field) }))
      .sort(sortActivityFields)
      .slice(0, max);
  }

  function managerChangeRows(activity, max = 6) {
    const changes = parseJsonObject(activity.changes);
    const oldData = parseJsonObject(activity.old_data || changes.before);
    const newData = parseJsonObject(activity.new_data || changes.after);
    const configured = Array.isArray(activity.changed_fields) && activity.changed_fields.length
      ? activity.changed_fields
      : [...new Set([...Object.keys(oldData), ...Object.keys(newData)])];

    return configured
      .filter(isUsefulManagerField)
      .filter((field) => JSON.stringify(oldData[field]) !== JSON.stringify(newData[field]))
      .map((field) => ({
        field,
        label: fieldLabel(field),
        oldValue: formatActivityValue(oldData[field], field),
        newValue: formatActivityValue(newData[field], field),
      }))
      .sort(sortActivityFields)
      .slice(0, max);
  }

  function activityDotClass(activity) {
    const action = String(activity.action || "").toUpperCase();
    const severity = String(activity.severity || "normal").toLowerCase();
    const result = String(activity.result || "success").toLowerCase();

    if (result === "failure" || ["danger", "critical"].includes(severity) || ["DELETE", "DENY", "REJECT", "CANCEL"].includes(action)) {
      return "timeline-dot timeline-dot--danger";
    }
    if (["important", "sensitive"].includes(severity) || ["UPDATE", "DEACTIVATE", "LOCK", "RESET"].includes(action)) {
      return "timeline-dot timeline-dot--warn";
    }
    return "timeline-dot";
  }

  function renderSimpleDataTable(title, rows) {
    if (!rows.length) return "";
    return `
      <section class="activity-detail-section">
        <h5>${escapeHtml(title)}</h5>
        <div class="activity-data-table-wrap">
          <table class="activity-data-table">
            <tbody>
              ${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderChangesTable(rows) {
    if (!rows.length) return "";
    return `
      <section class="activity-detail-section">
        <h5>التغييرات المسجلة</h5>
        <div class="activity-data-table-wrap">
          <table class="activity-data-table activity-changes-table">
            <thead><tr><th>الحقل</th><th>قبل التعديل</th><th>بعد التعديل</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.oldValue)}</td><td>${escapeHtml(row.newValue)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderActivityDetails(activity, dateObj) {
    const details = parseJsonObject(activity.details);
    const action = String(activity.action || "").toUpperCase();
    const targetLabel = firstValue(activity.target_label, details.target_label);
    const moduleKey = activity.module || activity.resource_type || activity.entity_type || "system";
    const detailModuleLabel = activity.module_label || ACTIVITY_MODULE_LABELS[moduleKey] || moduleKey || "النظام";
    const fullDate = dateObj.toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const exactTime = dateObj.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const changes = parseJsonObject(activity.changes);

    const createRows = action === "CREATE" ? managerRows(activity.new_data || changes.after, 5) : [];
    const deleteRows = action === "DELETE" ? managerRows(activity.old_data || changes.before, 5) : [];
    const updateRows = !["CREATE", "DELETE"].includes(action) ? managerChangeRows(activity, 6) : [];

    return `
      <div class="activity-details-grid">
        <div class="activity-detail-row"><span>القسم</span><strong>${escapeHtml(detailModuleLabel)}</strong></div>
        <div class="activity-detail-row"><span>المستخدم المنفذ</span><strong>${escapeHtml(activity.actor_name || activity.user_name || "مستخدم")}</strong></div>
        <div class="activity-detail-row"><span>الدور</span><strong>${escapeHtml(roleLabel(activity.user_role))}</strong></div>
        <div class="activity-detail-row"><span>التاريخ والوقت</span><strong>${escapeHtml(`${fullDate} — ${exactTime}`)}</strong></div>
        ${targetLabel ? `<div class="activity-detail-row activity-detail-row--full"><span>السجل المتأثر</span><strong>${escapeHtml(targetLabel)}</strong></div>` : ""}
        ${activity.reason ? `<div class="activity-detail-row activity-detail-row--full"><span>السبب</span><strong>${escapeHtml(activity.reason)}</strong></div>` : ""}
      </div>

      ${renderChangesTable(updateRows)}
      ${renderSimpleDataTable("بيانات مختصرة عن السجل المضاف", createRows)}
      ${renderSimpleDataTable("بيانات مختصرة عن السجل المحذوف", deleteRows)}
    `;
  }

  function renderActivityCard(activity) {
    const dateObj = new Date(activity.created_at || `${activity.event_date || ""}T${activity.event_time || "00:00:00"}`);
    const validDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
    const timeOnly = validDate.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    const action = String(activity.action || "ACTIVITY").toUpperCase();
    const actionTitle = activity.action_label || ACTIVITY_ACTION_LABELS[action] || "عملية";
    const moduleKey = activity.module || activity.resource_type || activity.entity_type || "system";
    const sectionTitle = activity.module_label || ACTIVITY_MODULE_LABELS[moduleKey] || moduleKey || "النظام";
    const description = activity.display_text || activity.description || `${actionTitle} في قسم ${sectionTitle}`;
    const severity = String(activity.severity || "normal").toLowerCase();
    const result = String(activity.result || "success").toLowerCase();

    return `
      <div class="timeline-item">
        <div class="timeline-time">${escapeHtml(timeOnly)}</div>
        <div class="${activityDotClass(activity)}"></div>
        <article class="timeline-card activity-card activity-card--${escapeHtml(severity)}">
          <button type="button" class="activity-card-toggle" data-activity-toggle aria-expanded="false">
            <span class="activity-card-title">${escapeHtml(actionTitle)} — ${escapeHtml(sectionTitle)}</span>
            <span class="activity-card-description">${escapeHtml(description)}</span>
            <span class="activity-card-footer">
              <span class="meta">بواسطة: ${escapeHtml(activity.actor_name || activity.user_name || "مستخدم")}</span>
              <span class="activity-badges">
                <span class="activity-badge activity-badge--${escapeHtml(result)}">${escapeHtml(resultLabel(result))}</span>
                <span class="activity-badge activity-badge--${escapeHtml(severity)}">${escapeHtml(severityLabel(severity))}</span>
              </span>
            </span>
          </button>
          <div class="activity-card-details" hidden>${renderActivityDetails(activity, validDate)}</div>
        </article>
      </div>`;
  }

  function bindActivityTimeline(container) {
    if (container.dataset.activityBound === "1") return;
    container.dataset.activityBound = "1";
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-activity-toggle]");
      if (!button || !container.contains(button)) return;
      const card = button.closest(".activity-card");
      const details = card?.querySelector(".activity-card-details");
      if (!card || !details) return;
      const willOpen = details.hidden;
      container.querySelectorAll(".activity-card.is-open").forEach((openCard) => {
        if (openCard === card) return;
        openCard.classList.remove("is-open");
        openCard.querySelector("[data-activity-toggle]")?.setAttribute("aria-expanded", "false");
        const openDetails = openCard.querySelector(".activity-card-details");
        if (openDetails) openDetails.hidden = true;
      });
      details.hidden = !willOpen;
      card.classList.toggle("is-open", willOpen);
      button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const dateFilter = document.getElementById("activity-date-filter");
    if (!dateFilter) return;
    dateFilter.value = localDateValue();
    dateFilter.addEventListener("change", () => fetchLiveActivities(dateFilter.value));
  });

  async function fetchLiveActivities(selectedDate = null) {
    const container = document.getElementById("live-activity-timeline");
    if (!container) return;
    bindActivityTimeline(container);
    const dateInput = document.getElementById("activity-date-filter");
    const requestedDate = selectedDate || dateInput?.value || localDateValue();
    container.setAttribute("aria-busy", "true");

    try {
      const response = await fetch(apiUrl(`/activities/recent?date=${encodeURIComponent(requestedDate)}&limit=10&scope=dashboard`), {
        method: "GET",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "فشل جلب النشاطات");
      const activities = Array.isArray(result.data) ? result.data : [];
      container.innerHTML = activities.length
        ? activities.map(renderActivityCard).join("")
        : `<div class="activity-empty-state">لا توجد نشاطات مسجلة في هذا اليوم.</div>`;
    } catch (error) {
      console.error("❌ Live Activities Error:", error);
      container.innerHTML = `<div class="activity-error-state">تعذر جلب سجل النشاطات. تأكد من تشغيل الخادم ثم أعد المحاولة.</div>`;
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  }


  // ===============================
  // 3. هوية المدرسة الديناميكية
  // ===============================
  async function setupSchoolBranding() {
    const userStr = localStorage.getItem("user");
    if (!userStr) return;

    try {
      const user = JSON.parse(userStr);
      const schoolName = user.school_name_ar || user.school?.name_ar || user.school?.name || user.name_ar || "Smart School";
      const logoUrl = user.logo_url || user.school?.logo_url || user.school_logo;
      
      const nameEl = $id("real-school-name");
      const textEl = $id("default-logo-text");
      const imgEl = $id("real-school-logo");

      if (nameEl) nameEl.textContent = schoolName;
      if (textEl && schoolName !== "Smart School") textEl.textContent = schoolName.charAt(0);

      if (logoUrl && imgEl && textEl) {
const cleanLogoUrl = logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`;
imgEl.src = logoUrl.startsWith("http") ? logoUrl : `${SERVER_URL}${cleanLogoUrl}`;        imgEl.style.display = "block";
        textEl.style.display = "none";
      }

      // التحديث في الخلفية من السيرفر
     const r = await fetch(apiUrl("/profile/me"), {
  headers: { ...authHeaders() },
});

      if (r.ok) {
        const data = await r.json();
        const schoolData = data.school || user; 
        
        if (nameEl && schoolData.school_name_ar) {
           nameEl.textContent = schoolData.school_name_ar;
        }

        if (schoolData.logo_url && imgEl && textEl) {
const cleanFreshLogoUrl = schoolData.logo_url.startsWith("/")
  ? schoolData.logo_url
  : `/${schoolData.logo_url}`;

const freshLogoUrl = schoolData.logo_url.startsWith("http")
  ? schoolData.logo_url
  : `${SERVER_URL}${cleanFreshLogoUrl}`;           imgEl.src = freshLogoUrl;
           imgEl.style.display = "block";
           textEl.style.display = "none";
           
           user.logo_url = schoolData.logo_url;
           localStorage.setItem("user", JSON.stringify(user));
        }
      }
    } catch (e) {
      console.error("خطأ في تحديث هوية المدرسة:", e);
    }
  }

  // ===============================
  // 🎯 المُنسق المركزي (Orchestrator) 
  // يضمن تشغيل كل شيء بترتيب سليم وبدون تكرار
  // ===============================
document.addEventListener("DOMContentLoaded", () => {
  setupSchoolBranding();

  // الداشبورد الجديدة الكاملة
  loadAdminHomeDashboard();

  // نترك هذا مؤقتًا كاحتياط، لكن لاحقًا سنحذفه بعد التأكد
  // loadOrbitStats();

  fetchLiveActivities();
  setInterval(fetchLiveActivities, 60000);
});

})();

// ===============================
// RBAC Filters (Search in Tables)
// ===============================
window.RBAC_filters = {
  filter(input, tbodyId) {
    const q = (input.value || "").toLowerCase();
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.style.display = tr.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  },
};

// ===============================
// UserUI - واجهة إدارة المستخدمين
// ===============================
window.UserUI = {
  modalEl: null,
  formEl: null,
  titleEl: null,
  countBadge: null,

  init() {
    this.modalEl = document.getElementById("user-modal");
    this.formEl = document.getElementById("rbac-user-form");
    this.titleEl = document.getElementById("user-modal-title");
    this.countBadge = document.getElementById("users-count-badge");

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });

    if (window.RBAC && Array.isArray(window.RBAC.users)) {
      this.updateCount(window.RBAC.users.length);
    }
  },

  ensureInit() {
    if (!this.modalEl || !this.formEl || !this.titleEl) this.init();
  },

  openCreate() {
    this.ensureInit();
    if (!this.modalEl || !this.formEl) return;

    this.formEl.reset();
    const idInput = document.getElementById("user-id");
    if (idInput) idInput.value = "";

    if (this.titleEl) this.titleEl.textContent = "مستخدم جديد";
    this.modalEl.classList.add("is-open");
  },

  openEdit() {
    this.ensureInit();
    if (!this.modalEl) return;

    if (this.titleEl) this.titleEl.textContent = "تعديل مستخدم";
    this.modalEl.classList.add("is-open");
  },

  close() {
    this.ensureInit();
    if (!this.modalEl) return;
    this.modalEl.classList.remove("is-open");
  },

  search(query) {
    const tbody = document.getElementById("rbac-users-tbody");
    if (!tbody) return;

    const q = (query || "").toLowerCase();
    tbody.querySelectorAll("tr").forEach((tr) => {
      const text = tr.innerText.toLowerCase();
      tr.style.display = text.includes(q) ? "" : "none";
    });
  },

  updateCount(count) {
    if (!this.countBadge) this.countBadge = document.getElementById("users-count-badge");
    if (!this.countBadge) return;

    const n = Number(count || 0);
    let text;

    if (n === 0) text = "لا يوجد مستخدمون";
    else if (n === 1) text = "مستخدم واحد";
    else if (n === 2) text = "مستخدمان";
    else if (n <= 10) text = `${n} مستخدمين`;
    else text = `${n} مستخدم`;

    this.countBadge.textContent = text;
  },
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.UserUI && typeof window.UserUI.init === "function") {
    window.UserUI.init();
  }
});
function renderSchoolPulse(items) {
  const box =
    document.getElementById("school-pulse-map") ||
    document.querySelector(".heat-body");

  if (!box) return;

  const list = Array.isArray(items) ? items : [];

  const fmt = (n) => {
    try {
      return Number(n || 0).toLocaleString("ar-EG");
    } catch {
      return String(n || 0);
    }
  };

  if (!list.length) {
    box.innerHTML = `
      <div style="
        width:100%;
        min-height:220px;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        border:1px dashed rgba(148,163,184,.25);
        border-radius:22px;
        color:#94a3b8;
        padding:24px;
      ">
        <div>
          <strong style="display:block;color:#e5e7eb;font-size:15px;margin-bottom:8px;">
            لا توجد بيانات كافية لخريطة نبض المدرسة
          </strong>
          <span style="font-size:13px;line-height:1.8;">
            ستظهر الخريطة بعد تسجيل الحضور.
          </span>
        </div>
      </div>
    `;
    return;
  }

 const statusColor = {
  ok: "#22c55e",
  warn: "#f59e0b",
  danger: "#ef4444",
  no_data: "#64748b",
};  
  const dotsPositions = [
    [18, 34], [34, 18], [52, 28], [72, 18],
    [82, 42], [66, 58], [48, 74], [28, 64],
    [16, 78], [74, 78], [42, 46], [58, 48],
    [24, 22], [84, 66], [36, 82], [62, 16],
    [14, 52], [88, 28],
  ];

  const visibleItems = list.slice(0, dotsPositions.length);

  const dots = visibleItems
    .map((item, index) => {
      const [left, top] = dotsPositions[index];
      const status = item.status || "no_data";
      const color = statusColor[status] || statusColor.no_data;

      const label =
        item.label ||
        `${item.grade_name || "صف غير محدد"} - الشعبة ${item.section_name || ""}`;

      return `
        <span
          title="${label}"
          style="
            position:absolute;
            left:${left}%;
            top:${top}%;
            width:13px;
            height:13px;
            border-radius:50%;
            background:${color};
            border:2px solid rgba(255,255,255,.92);
            box-shadow:0 0 14px ${color};
            transform:translate(-50%, -50%);
          "
        ></span>
      `;
    })
    .join("");

const okCount = list.filter((x) => x.status === "ok").length;
const noDataCount = list.filter((x) => x.status === "no_data").length;
const warnOnlyCount = list.filter((x) => x.status === "warn").length;
const dangerCount = list.filter((x) => x.status === "danger").length;
  box.innerHTML = `
    <div style="
      width:100%;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:22px;
      direction:rtl;
    ">
      <div style="
        flex:1;
        min-width:210px;
        color:#cbd5e1;
        font-size:13px;
        line-height:2;
        text-align:right;
      ">
        <p style="margin:0 0 12px;color:#94a3b8;line-height:1.8;">
          كل نقطة تمثل شعبة. اللون يوضح حالة الحضور اليوم.
        </p>

        <div style="display:grid;gap:7px;">
          <div><span style="color:#22c55e;">●</span> مستقر: ${fmt(okCount)} شعبة</div>
<div><span style="color:#64748b;">●</span> لم يسجل حضور: ${fmt(noDataCount)} شعبة</div>
<div><span style="color:#f59e0b;">●</span> يحتاج متابعة: ${fmt(warnOnlyCount)} شعبة</div>          <div><span style="color:#ef4444;">●</span> يحتاج تدخل: ${fmt(dangerCount)} شعبة</div>
        </div>
      </div>

      <div style="
   width:240px;
height:240px;
        flex:0 0 230px;
        position:relative;
        border-radius:50%;
        background:
          radial-gradient(circle at center, rgba(30,64,175,.55), rgba(15,23,42,.88) 62%, rgba(15,23,42,.98) 100%);
        border:1px solid rgba(148,163,184,.22);
        box-shadow:
          inset 0 0 45px rgba(59,130,246,.18),
          0 0 25px rgba(15,23,42,.35);
        overflow:hidden;
      ">
        ${dots}

   
      </div>
    </div>
  `;
}
// ===============================
// Idle Auto Logout System
// ===============================
const IDLE_LIMIT = 15 * 60 * 1000; // 15 دقيقة
let idleTimer;

function logoutDueToIdle() {
  window.AppUI?.toast(
    "تم تسجيل خروجك بسبب عدم النشاط للحفاظ على أمان البيانات.",
    "warning",
    { timeout: 1800 }
  );
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  setTimeout(() => {
    window.location.href = "/frontend/login/login.html";
  }, 900);
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(logoutDueToIdle, IDLE_LIMIT);
}

["mousemove", "keydown", "click", "scroll"].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer);
});

resetIdleTimer();
