// teacher/ui/avatar.js
(function () {
  "use strict";

  window.TeacherAvatar = {
    init() {
      const imgEl = $("teacher-avatar-img");
      const letterEl = $("teacher-avatar-letter");
      const inputEl = $("avatar-input");
      const changeBtn = $("change-avatar-btn");
      if (!imgEl || !letterEl || !inputEl || !changeBtn) return;

      const stored = localStorage.getItem("teacher_avatar");
      if (stored) {
        imgEl.src = stored;
        imgEl.style.display = "block";
        letterEl.style.display = "none";
      }

      changeBtn.addEventListener("click", () => inputEl.click());

      inputEl.addEventListener("change", () => {
        const file = inputEl.files && inputEl.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          imgEl.src = ev.target.result;
          imgEl.style.display = "block";
          letterEl.style.display = "none";
          localStorage.setItem("teacher_avatar", ev.target.result);
          showToast("تم تحديث الصورة الشخصية (تجريبي)");
        };
        reader.readAsDataURL(file);
      });
    },
  };
})();
