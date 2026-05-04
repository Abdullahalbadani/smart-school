// teacher/ui/theme.js
(function () {
  "use strict";

  window.TeacherTheme = {
    init() {
      const root = document.documentElement;
      const btn = $("theme-toggle");
      const icon = $("theme-icon");
      if (!btn) return;

      const saved = localStorage.getItem("smart_theme");
      if (saved === "dark" || saved === "light") {
        root.setAttribute("data-theme", saved);
      }

      function updateIcon() {
        const current = root.getAttribute("data-theme") || "light";
        if (!icon) return;
        icon.className =
          current === "dark" ? "ri-moon-clear-line" : "ri-sun-line";
      }

      updateIcon();

      btn.addEventListener("click", () => {
        const current = root.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        localStorage.setItem("smart_theme", next);
        updateIcon();
      });
    },
  };
})();
