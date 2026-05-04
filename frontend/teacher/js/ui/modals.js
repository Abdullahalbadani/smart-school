// teacher/ui/modals.js
(function () {
  "use strict";

  const overlayEl = $("modal-overlay");

  // ✅ Guard لمنع إعادة تهيئة TeachingScopes كل مرة نفتح مودال
  let __TEACHING_SCOPES_INITED = false;
  let __TEACHING_SCOPES_KEY = "";

  function getTeachingKeySafe() {
    // الأفضل: من TeachingScopes
    try {
      const TS = window.TeachingScopes;
      if (TS && typeof TS.getYearTermForTeacher === "function") {
        const { yearId, term } = TS.getYearTermForTeacher();
        return `${yearId}-${term}`;
      }
    } catch {}

    // fallback: من localStorage (بنفس مفاتيح teachingScopes.js)
    const y = localStorage.getItem("TT_YEAR_ID") || "";
    const t = localStorage.getItem("TT_TERM") || "";
    return `${y}-${t}`;
  }

  function pickerLooksReady() {
    // إذا الselects موجودة وفيها خيارات فعلية (غير placeholder)
    const attStage = $("att-stage");
    const lsStage = $("ls-stage");

    const okAtt = !!(attStage && attStage.options && attStage.options.length > 1);
    const okLs = !!(lsStage && lsStage.options && lsStage.options.length > 1);

    // نعتبر جاهز إذا الاثنين جاهزين (لأن loader يجهّز الاثنين)
    return okAtt && okLs;
  }

  function ensureTeachingScopesLoaded() {
    if (typeof window.__loadTeacherTeachingScopes !== "function") return;

    const keyNow = getTeachingKeySafe();

    // ✅ لا تعيد التهيئة إذا:
    // 1) سبق عملنا init
    // 2) year/term ما تغير
    // 3) والـ pickers تبدو جاهزة
    const needInit = !__TEACHING_SCOPES_INITED || __TEACHING_SCOPES_KEY !== keyNow || !pickerLooksReady();

    if (!needInit) return;

    __TEACHING_SCOPES_INITED = true;
    __TEACHING_SCOPES_KEY = keyNow;

    window.__loadTeacherTeachingScopes();
  }

  function anyModalOpen() {
    return Array.from(document.querySelectorAll(".modal")).some((m) => m.dataset.open === "1");
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = "none";
    delete modalEl.dataset.open;
    if (overlayEl && !anyModalOpen()) overlayEl.style.display = "none";
  }

    function openModal(id) {
    // ✅ الطلاب
    if (id === "modal-students") {
      if (typeof window.__loadTeacherStudentScopes === "function") {
        window.__loadTeacherStudentScopes();
      }
    }

    // ✅ الحضور/الحصص
    if (id === "modal-attendance" || id === "modal-lessons") {
      ensureTeachingScopesLoaded();
    }

    const modal = $(id);
    if (!modal) return;

    modal.style.display = "flex";
    modal.dataset.open = "1";
    if (overlayEl) overlayEl.style.display = "flex";

    // ✅✅ أضف هذا هنا
    if (id === "profile-modal") {
window.TeacherJobProfile.refresh();
    }

    // ✅ عند فتح مودال الجدول: افتح آخر تبويب محفوظ
    if (id === "modal-timetable") {
      const savedTab = localStorage.getItem("teacher_tt_tab") || "weekly";
      window.TeacherTimetable?.setTab?.(savedTab, true);
    }
  }


  function initModalEvents() {
    // زر الإغلاق
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modal");
        closeModal(modal);
      });
    });

    // الخلفية
    if (overlayEl) {
      overlayEl.addEventListener("click", () => {
        document.querySelectorAll('.modal[data-open="1"]').forEach((m) => closeModal(m));
        overlayEl.style.display = "none";
      });
    }

    // ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (overlayEl && overlayEl.style.display === "flex") overlayEl.click();
      }
    });

    // فتح من الكروت
    document.querySelectorAll(".cards-grid .card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("button, input, select, textarea, a")) return;
        const id = card.getAttribute("data-modal");
        if (id) openModal(id);
      });
    });
  }

  window.openModal = openModal;
  window.closeModal = closeModal;

  window.TeacherModals = {
    init: initModalEvents,
    open: openModal,
    close: closeModal,
  };
})();
