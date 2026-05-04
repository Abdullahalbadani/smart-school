// teacher/teacher.main.js
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    // UI
    TeacherClock?.init?.();
    TeacherTheme?.init?.();
    TeacherModals?.init?.();
    TeacherAccountMenu?.init?.();
    TeacherAvatar?.init?.();
    TeacherCommandPalette?.init?.();

    // Features
    TeacherTimetable?.init?.(); // جدول أسبوعي + اختبارات
    // teachingScopes.js ما يحتاج init — لكنه يجهز window.__loadTeacherTeachingScopes
    TeacherSessions?.init?.();  // حضور/غياب + حصص
    // students/profile لو عندك ملفاتهم شغّلهم هنا
  });
})();
