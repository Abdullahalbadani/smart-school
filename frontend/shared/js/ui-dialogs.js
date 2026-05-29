// frontend/admin/js/ui-dialogs.js
(function () {
  "use strict";

  const ICONS = {
    success: "✓",
    error: "!",
    danger: "!",
    warning: "!",
    info: "i",
  };

  function ensureToastStack() {
    let stack = document.getElementById("uiToastStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "uiToastStack";
      stack.className = "ui-toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function normalizeType(type) {
    const t = String(type || "info").toLowerCase();
    if (["success", "error", "warning", "info", "danger"].includes(t)) return t;
    return "info";
  }

  function toast(message, type = "info", options = {}) {
    const stack = ensureToastStack();
    const finalType = normalizeType(type);
    const title =
      options.title ||
      (finalType === "success"
        ? "تم بنجاح"
        : finalType === "error" || finalType === "danger"
        ? "حدث خطأ"
        : finalType === "warning"
        ? "تنبيه"
        : "معلومة");

    const item = document.createElement("div");
    item.className = `ui-toast ui-toast--${finalType === "danger" ? "error" : finalType}`;
    item.innerHTML = `
      <div class="ui-toast__icon">${ICONS[finalType] || "i"}</div>
      <div>
        <div class="ui-toast__title">${escapeHtml(title)}</div>
        <div class="ui-toast__message">${escapeHtml(message || "")}</div>
      </div>
      <button class="ui-toast__close" type="button" aria-label="إغلاق">×</button>
    `;

    stack.appendChild(item);

    const close = () => {
      item.classList.add("is-leaving");
      setTimeout(() => item.remove(), 240);
    };

    item.querySelector(".ui-toast__close")?.addEventListener("click", close);

    const timeout = Number(options.timeout ?? 3600);
    if (timeout > 0) setTimeout(close, timeout);

    return item;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function dialog(options = {}) {
    return new Promise((resolve) => {
      const type = normalizeType(options.type || options.variant || "info");
      const isDanger = type === "danger" || type === "error";
      const variant = isDanger ? "danger" : type;

      const overlay = document.createElement("div");
      overlay.className = "ui-dialog-overlay";

      const showCancel = options.showCancel !== false;
      const mode = options.mode || "alert";
      const hasInput = mode === "prompt" || options.input === true || options.textarea === true;

      const inputHtml = hasInput
        ? options.textarea
          ? `<textarea class="ui-dialog-textarea" id="uiDialogInput" placeholder="${escapeHtml(
              options.placeholder || ""
            )}">${escapeHtml(options.defaultValue || "")}</textarea>`
          : `<input class="ui-dialog-input" id="uiDialogInput" type="text" placeholder="${escapeHtml(
              options.placeholder || ""
            )}" value="${escapeHtml(options.defaultValue || "")}" />`
        : "";

      const confirmClass =
        variant === "success"
          ? "ui-dialog-btn--success"
          : variant === "danger"
          ? "ui-dialog-btn--danger"
          : variant === "warning"
          ? "ui-dialog-btn--warning"
          : "ui-dialog-btn--primary";

      overlay.innerHTML = `
        <div class="ui-dialog-card ui-dialog-card--${variant}" role="dialog" aria-modal="true">
          <div class="ui-dialog-head">
            <div class="ui-dialog-icon">${ICONS[type] || "i"}</div>
            <div>
              <h3 class="ui-dialog-title">${escapeHtml(options.title || "تنبيه")}</h3>
              ${
                options.subtitle
                  ? `<div class="ui-dialog-subtitle">${escapeHtml(options.subtitle)}</div>`
                  : ""
              }
            </div>
          </div>

          <div class="ui-dialog-body">
            ${
              options.message
                ? `<div class="ui-dialog-message">${escapeHtml(options.message)}</div>`
                : ""
            }
            ${inputHtml}
          </div>

          <div class="ui-dialog-actions">
            <button class="ui-dialog-btn ${confirmClass}" type="button" data-ui-confirm>
              ${escapeHtml(options.confirmText || "موافق")}
            </button>

            ${
              showCancel
                ? `<button class="ui-dialog-btn ui-dialog-btn--ghost" type="button" data-ui-cancel>
                    ${escapeHtml(options.cancelText || "إلغاء")}
                  </button>`
                : ""
            }
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = overlay.querySelector("#uiDialogInput");
      const confirmBtn = overlay.querySelector("[data-ui-confirm]");
      const cancelBtn = overlay.querySelector("[data-ui-cancel]");

      function cleanup(value) {
        overlay.classList.add("is-leaving");
        document.removeEventListener("keydown", onKeyDown);
        setTimeout(() => {
          overlay.remove();
          resolve(value);
        }, 170);
      }

      function confirmAction() {
        if (hasInput) {
          const value = String(input?.value || "").trim();

          if (options.required && !value) {
            toast(options.requiredMessage || "هذا الحقل مطلوب.", "warning");
            input?.focus?.();
            return;
          }

          cleanup(value);
          return;
        }

        cleanup(true);
      }

      function cancelAction() {
        cleanup(hasInput ? null : false);
      }

      function onKeyDown(e) {
        if (e.key === "Escape") cancelAction();
        if (e.key === "Enter" && !options.textarea) confirmAction();
      }

      confirmBtn?.addEventListener("click", confirmAction);
      cancelBtn?.addEventListener("click", cancelAction);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay && options.closeOnBackdrop !== false) {
          cancelAction();
        }
      });

      document.addEventListener("keydown", onKeyDown);

      setTimeout(() => {
        if (hasInput) input?.focus?.();
        else confirmBtn?.focus?.();
      }, 40);
    });
  }

  function alertDialog(messageOrOptions, type = "info") {
    const options =
      typeof messageOrOptions === "object"
        ? messageOrOptions
        : {
            title: type === "success" ? "تم بنجاح" : type === "error" ? "حدث خطأ" : "تنبيه",
            message: messageOrOptions,
            type,
          };

    return dialog({
      showCancel: false,
      confirmText: "حسنًا",
      ...options,
    });
  }

  function confirmDialog(messageOrOptions) {
    const options =
      typeof messageOrOptions === "object"
        ? messageOrOptions
        : {
            title: "تأكيد الإجراء",
            message: messageOrOptions,
            type: "warning",
          };

    return dialog({
      mode: "confirm",
      showCancel: true,
      confirmText: "تأكيد",
      cancelText: "إلغاء",
      ...options,
    });
  }

  function promptDialog(messageOrOptions, defaultValue = "") {
    const options =
      typeof messageOrOptions === "object"
        ? messageOrOptions
        : {
            title: "إدخال بيانات",
            message: messageOrOptions,
            defaultValue,
          };

    return dialog({
      mode: "prompt",
      input: true,
      showCancel: true,
      confirmText: "حفظ",
      cancelText: "إلغاء",
      ...options,
    });
  }

  window.AppUI = {
    toast,
    alert: alertDialog,
    confirm: confirmDialog,
    prompt: promptDialog,
    dialog,
  };

  window.showToast = function (message, type = "info", options = {}) {
    return toast(message, type, options);
  };

  window.Toast = window.Toast || {};
  window.Toast.show = function (message, type = "info", options = {}) {
    return toast(message, type, options);
  };
})();
// Global alert beautifier
(function () {
  if (window.__APP_UI_ALERT_PATCHED__) return;
  window.__APP_UI_ALERT_PATCHED__ = true;

  const nativeAlert = window.alert.bind(window);

  window.alert = function (message) {
    if (window.AppUI?.toast) {
      window.AppUI.toast(String(message || ""), "info");
      return;
    }

    nativeAlert(message);
  };
})();