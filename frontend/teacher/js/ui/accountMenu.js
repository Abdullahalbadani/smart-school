// teacher/ui/accountMenu.js
(function () {
  "use strict";

  window.TeacherAccountMenu = {
    init() {
      const toggleBtn = $("account-menu-toggle");
      const dropdown = $("account-dropdown");
      const logoutBtn = $("logout-btn");
      if (!toggleBtn || !dropdown) return;

      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = dropdown.style.display === "flex";
        dropdown.style.display = isVisible ? "none" : "flex";
      });

      document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
          dropdown.style.display = "none";
        }
      });

      if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          localStorage.removeItem("teacher_att_active_ctx");
          showToast("تم تسجيل الخروج");
          window.setTimeout(() => {
            window.location.replace("/frontend/login/login.html");
          }, 150);
        });
      }

      const openProfileBtn = $("open-profile-modal");
      openProfileBtn?.addEventListener("click", () => {
        openModal("profile-modal");
        dropdown.style.display = "none";
      });

      $("open-change-password-modal")?.addEventListener("click", () => {
        openModal("change-password-modal");
        dropdown.style.display = "none";
      });

      $("open-change-email-modal")?.addEventListener("click", () => {
        openModal("change-email-modal");
        dropdown.style.display = "none";
      });

      $("open-change-avatar-modal")?.addEventListener("click", () => {
        openModal("change-avatar-modal");
        dropdown.style.display = "none";
      });
    },
  };
})();
