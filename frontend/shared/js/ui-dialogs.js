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
    const aliases = {
      ok: "success",
      warn: "warning",
      err: "error",
      normal: "info",
    };
    const normalized = aliases[t] || t;
    if (["success", "error", "warning", "info", "danger"].includes(normalized)) return normalized;
    return "info";
  }

  function friendlyMessage(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";

    if (/HTTP\s*401|لا يوجد Token|No token|Unauthorized/i.test(text)) {
      return "انتهت جلسة الدخول أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى.";
    }

    if (/HTTP\s*403|Forbidden/i.test(text)) {
      return "لا تملك صلاحية تنفيذ هذه العملية.";
    }

    if (/HTTP\s*404/i.test(text)) {
      return "تعذر العثور على البيانات المطلوبة.";
    }

    if (/HTTP\s*(?:400|409|422)|API error/i.test(text)) {
      return "تعذر تنفيذ العملية. يرجى مراجعة البيانات والمحاولة مرة أخرى.";
    }

    if (
      /ECONNREFUSED|ERR_CONNECTION_REFUSED|Failed to fetch|NetworkError|fetch failed|Load failed|Unexpected token|SyntaxError: JSON|HTTP\s*5\d\d|الرد ليس JSON|Endpoint|CORS|SQLSTATE|duplicate key|violates .* constraint|relation .* does not exist|column .* does not exist|syntax error at|Cannot read properties|ReferenceError:|TypeError:/i.test(
        text
      )
    ) {
      return "تعذر الاتصال بالخادم حاليًا. يرجى المحاولة مرة أخرى بعد قليل.";
    }

    return text;
  }

  function inferType(message) {
    const text = String(message || "");

    if (/✅|بنجاح|تمت? (?:الإضافة|الحفظ|التحديث|التسجيل|الإرسال|الحذف|التفعيل|التعطيل|الاعتماد|الفتح|الرفض|القبول)/i.test(text)) {
      return "success";
    }

    if (/خطأ|فشل|تعذر|غير مصرح|لا تملك|انتهت الجلسة|غير صالح|❌/i.test(text)) {
      return "error";
    }

    if (/تحذير|تنبيه|يرجى|الرجاء|مطلوب|لا يمكن|غير صحيح/i.test(text)) {
      return "warning";
    }

    return "info";
  }

  function toast(message, type = "info", options = {}) {
    const stack = ensureToastStack();
    const inferredType = inferType(message);
    const requestedType = normalizeType(type);
    const finalType = requestedType === "info" ? inferredType : requestedType;
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
        <div class="ui-toast__message">${escapeHtml(friendlyMessage(message))}</div>
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
                ? `<div class="ui-dialog-message">${escapeHtml(friendlyMessage(options.message))}</div>`
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
    friendlyMessage,
    inferType,
  };

  window.uiToast = toast;
  window.uiAlert = alertDialog;
  window.uiConfirm = confirmDialog;
  window.uiPrompt = promptDialog;

  window.showToast = function (message, type = "info", options = {}) {
    return toast(message, type, options);
  };

  window.Toast = window.Toast || {};
  window.Toast.show = function (message, type = "info", options = {}) {
    return toast(message, type, options);
  };

  let lastUnhandledMessage = "";
  let lastUnhandledAt = 0;

  function notifyUnhandled(raw, details) {
    const message = friendlyMessage(raw) || "حدث خطأ غير متوقع أثناء تنفيذ العملية.";
    const now = Date.now();

    console.error("Unhandled frontend error:", details);

    if (message === lastUnhandledMessage && now - lastUnhandledAt < 1200) return;
    lastUnhandledMessage = message;
    lastUnhandledAt = now;

    toast(message, "error", { title: "تعذر تنفيذ العملية", timeout: 5200 });
  }

  window.addEventListener("unhandledrejection", (event) => {
    notifyUnhandled(
      event?.reason?.message || event?.reason || "حدث خطأ غير متوقع أثناء تنفيذ العملية.",
      event?.reason
    );
  });

  window.addEventListener("error", (event) => {
    const raw = event?.error?.message || event?.message;
    if (!raw) return;
    notifyUnhandled(raw, event?.error || event);
  });
})();
// Global alert beautifier
(function () {
  if (window.__APP_UI_ALERT_PATCHED__) return;
  window.__APP_UI_ALERT_PATCHED__ = true;

  const nativeAlert = window.alert.bind(window);

  window.alert = function (message) {
    const safeMessage = window.AppUI?.friendlyMessage
      ? window.AppUI.friendlyMessage(message)
      : String(message || "");

    if (window.AppUI?.alert) {
      const type = window.AppUI.inferType?.(safeMessage) || "info";
      window.AppUI.alert({
        title:
          type === "success"
            ? "تم بنجاح"
            : type === "error" || type === "danger"
            ? "تعذر تنفيذ العملية"
            : type === "warning"
            ? "تنبيه"
            : "معلومة",
        message: safeMessage,
        type,
      });
      return;
    }

    nativeAlert(safeMessage);
  };
})();