// account-settings.js  (تغيير كلمة المرور + تغيير البريد)
(function () {
  "use strict";

  // ====== تغيير كلمة المرور (تجريبي) ======
  (function initChangePassword() {
    const form = document.getElementById("changePasswordForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const current = document.getElementById("currentPassword");
      const p1 = document.getElementById("newPassword");
      const p2 = document.getElementById("confirmNewPassword");

      if (!current.value || !p1.value || !p2.value)
        return showToast("يرجى إدخال جميع الحقول.");

      if (p1.value !== p2.value)
        return showToast("كلمة المرور الجديدة غير متطابقة.");

      if (p1.value.length < 8)
        return showToast("يجب أن تكون كلمة المرور من 8 أحرف على الأقل.");

      showToast("تم تحديث كلمة المرور .");

      current.value = "";
      p1.value = "";
      p2.value = "";

      closeModal(document.getElementById("change-password-modal"));
    });
  })();

  // ====== تغيير البريد الإلكتروني (تجريبي) ======
  (function initChangeEmail() {
    const form = document.getElementById("changeEmailForm");
    const profileEmail = document.getElementById("profile-email");
    const currentEmailInput = document.getElementById("currentEmail");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const newEmailInput = document.getElementById("newEmail");
      const mail = newEmailInput.value.trim();

      if (!mail) return showToast("أدخل البريد الجديد.");

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail))
        return showToast("صيغة بريد غير صحيحة.");

      if (profileEmail) profileEmail.textContent = mail;
      if (currentEmailInput) currentEmailInput.value = mail;

      localStorage.setItem("teacher_email", mail);

      showToast("تم تحديث البريد الإلكتروني .");

      newEmailInput.value = "";
      closeModal(document.getElementById("change-email-modal"));
    });

    const stored = localStorage.getItem("teacher_email");
    if (stored) {
      if (profileEmail) profileEmail.textContent = stored;
      if (currentEmailInput) currentEmailInput.value = stored;
    }
  })();
})();
