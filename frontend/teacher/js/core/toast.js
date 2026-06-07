// teacher/core/toast.js
(function () {
  "use strict";

  if (!window.showToast) {
    window.showToast = function showToast(message, type = "info") {
      if (window.AppUI?.toast) return window.AppUI.toast(message, type);
      const toast = window.$ ? window.$("toast") : document.getElementById("toast");
      if (!toast) {
        console.warn(message);
        return;
      }
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(() => {
        toast.classList.remove("show");
      }, 2500);
    };
  }

  if (!window.escapeHtml) {
    window.escapeHtml = function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    };
  }
})();
