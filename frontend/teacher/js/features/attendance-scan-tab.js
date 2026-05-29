// attendance-scan-tab.js
(function () {
  "use strict";

  // ✅ Prevent double-load
  if (window.__ATTENDANCE_SCAN_TAB_JS_LOADED__) return;
  window.__ATTENDANCE_SCAN_TAB_JS_LOADED__ = true;

  /* =========================
     Attendance Scan Tab
     - Camera Barcode/QR scan (BarcodeDetector if available)
     - Manual input scan
     - Matches by student code OR studentId
     - Applies status to attendance table (if open)
     - Local scan log + export + clear (مسح الملف الخاص)
  ========================= */

  // ---------- Safe helpers ----------
  const byId = (id) =>
    typeof window.$ === "function" ? window.$(id) : document.getElementById(id);

  const esc =
    typeof window.escapeHtml === "function"
      ? window.escapeHtml
      : (str) => {
          const s = String(str ?? "");
          return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        };

  const toast = (msg) =>
    typeof window.showToast === "function" ? window.showToast(msg) : alert(msg);

  const toInt = (v) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const toBool = (v) => {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null) return false;
    const s = String(v).trim().toLowerCase();
    if (["true", "t", "1", "yes", "y", "on"].includes(s)) return true;
    if (["false", "f", "0", "no", "n", "off", ""].includes(s)) return false;
    return false;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 700);
    } catch {
      toast("تعذر التصدير على هذا المتصفح.");
    }
  }

  // ---------- API wrappers (optional; not required for scan itself) ----------
  const API_BASE = window.API_BASE || "/api";

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiCall(method, path, body) {
    const url = path.startsWith("http")
      ? path
      : API_BASE + (path.startsWith("/") ? path : "/" + path);

    const r = await fetch(url, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });

    if (r.status === 204) return null;

    const text = await r.text();
    const ct = (r.headers.get("content-type") || "").toLowerCase();

    let data = null;
    try {
      if (ct.includes("application/json")) data = text ? JSON.parse(text) : null;
      else data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      const msg =
        data?.message ||
        data?.error ||
        (typeof data?.raw === "string" && String(data.raw).slice(0, 200)) ||
        `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  const apiGet = typeof window.apiGet === "function" ? window.apiGet : (p) => apiCall("GET", p);

  // ---------- Permissions hook (optional) ----------
  // إذا موجودة في sessions.js ستعمل، وإلا نسمح (السيرفر يمنع)
  const canPerm = typeof window.canPerm === "function" ? window.canPerm : () => true;

  // ---------- Local scan log (الملف الخاص) ----------
  const LS_SCAN_LOG_KEY = "ATT_SCAN_LOG_V1";

  function readScanLog() {
    try {
      const raw = localStorage.getItem(LS_SCAN_LOG_KEY);
      const arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeScanLog(arr) {
    try {
      const safe = Array.isArray(arr) ? arr.slice(0, 1000) : [];
      localStorage.setItem(LS_SCAN_LOG_KEY, JSON.stringify(safe));
    } catch {}
  }

  function addScanLog(row) {
    const list = readScanLog();
    list.unshift({
      at: new Date().toISOString(),
      raw: String(row?.raw ?? ""),
      code: String(row?.code ?? ""),
      studentId: row?.studentId != null ? toInt(row.studentId) : null,
      status: String(row?.status ?? ""),
      result: String(row?.result ?? ""), // ok / not_found / locked / error
      note: String(row?.note ?? ""),
    });
    writeScanLog(list);
    return list;
  }

  function clearScanLog() {
    try {
      localStorage.removeItem(LS_SCAN_LOG_KEY);
    } catch {}
  }

  // ---------- Parse scanned payload ----------
  // يدعم:
  // - "12345" (code)
  // - "ID:123" أو "studentId=123"
  // - JSON: {"studentId":123,"code":"A12"}
  function parseScanPayload(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return { raw: "", code: "", studentId: null };

    // JSON
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        const j = JSON.parse(s);
        const sid = toInt(j?.studentId ?? j?.student_id ?? j?.id);
        const code = String(j?.code ?? j?.studentCode ?? j?.student_code ?? "").trim();
        return { raw: s, code, studentId: sid || null };
      } catch {
        // ignore
      }
    }

    // studentId formats
    const m1 = /(?:^|\b)(?:id|studentid|student_id)\s*[:=]\s*(\d+)(?:\b|$)/i.exec(s);
    if (m1) return { raw: s, code: "", studentId: toInt(m1[1]) || null };

    // pure numeric => could be code OR id, we treat as code first
    return { raw: s, code: s, studentId: null };
  }

  // ---------- Find and apply to attendance table ----------
  function getAttendanceTableBody() {
    return byId("att-table-body") || document.querySelector("#att-table-body");
  }

  function normalizeCode(code) {
    return String(code ?? "")
      .trim()
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function findRowByStudentId(tbody, studentId) {
    if (!tbody || !studentId) return null;
    return tbody.querySelector(`tr.att-row[data-student-id="${String(toInt(studentId))}"]`);
  }

  function findRowByCode(tbody, code) {
    if (!tbody || !code) return null;
    const needle = normalizeCode(code);
    if (!needle) return null;

    const rows = tbody.querySelectorAll("tr.att-row");
    for (const row of rows) {
      const rc = normalizeCode(row?.dataset?.studentCode || "");
      if (rc && rc === needle) return row;
    }

    // fallback: try "contains" (لو QR فيه زيادات)
    for (const row of rows) {
      const rc = normalizeCode(row?.dataset?.studentCode || "");
      if (rc && needle.includes(rc)) return row;
    }
    return null;
  }

  function isLockedRow(row) {
    try {
      // إذا الأزرار معطلة = غالباً الجلسة معتمدة
      const b = row?.querySelector(".att-status-btn");
      return !!b?.disabled;
    } catch {
      return false;
    }
  }

  function clickStatus(row, status) {
    const btn = row.querySelector(`.att-status-btn[data-status="${status}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }

  function applyScanToTable({ code, studentId, status, note }) {
    const tbody = getAttendanceTableBody();
    if (!tbody) {
      return { ok: false, result: "error", note: "جدول الحضور غير موجود/غير مفتوح." };
    }

    const row =
      (studentId ? findRowByStudentId(tbody, studentId) : null) ||
      (code ? findRowByCode(tbody, code) : null);

    if (!row) return { ok: false, result: "not_found", note: "لم يتم العثور على الطالب في جدول الحضور." };

    if (isLockedRow(row)) {
      return { ok: false, result: "locked", note: "الجلسة معتمدة/مقفولة — لا يمكن التعديل بالمسح." };
    }

    // permission check (اختياري)
    if (!canPerm("attendance.write")) {
      return { ok: false, result: "error", note: "لا تملك صلاحية حفظ الحضور." };
    }

    const ok = clickStatus(row, status || "present");
    if (!ok) return { ok: false, result: "error", note: "تعذر تغيير الحالة (زر الحالة غير موجود)." };

    // optional: fill note
    if (note) {
      const inp = row.querySelector(".att-note");
      if (inp && !inp.disabled) {
        inp.value = String(note);
        try {
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        } catch {}
      }
    }

    // highlight
    try {
      row.style.outline = "2px solid rgba(14,165,233,.55)";
      row.style.outlineOffset = "2px";
      setTimeout(() => {
        row.style.outline = "";
        row.style.outlineOffset = "";
      }, 900);
    } catch {}

    return { ok: true, result: "ok", note: "تم تطبيق الحالة على الطالب." };
  }

  // ---------- Camera scanner (BarcodeDetector) ----------
  let __stream = null;
  let __scannerRunning = false;
  let __scanTimer = null;
  let __lastRaw = "";
  let __lastAt = 0;

  async function stopCamera() {
    __scannerRunning = false;
    if (__scanTimer) clearInterval(__scanTimer);
    __scanTimer = null;

    try {
      if (__stream) {
        __stream.getTracks().forEach((t) => t.stop());
      }
    } catch {}
    __stream = null;
  }

  async function startCamera(videoEl, deviceId) {
    await stopCamera();

    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    __stream = stream;

    videoEl.srcObject = stream;
    await videoEl.play();

    return stream;
  }

  async function listVideoDevices(selectEl) {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      if (selectEl) {
        const current = selectEl.value;
        selectEl.innerHTML =
          `<option value="">الكاميرا الافتراضية</option>` +
          cams
            .map((d, idx) => {
              const label = d.label || `Camera ${idx + 1}`;
              const sel = current && current === d.deviceId ? "selected" : "";
              return `<option value="${esc(d.deviceId)}" ${sel}>${esc(label)}</option>`;
            })
            .join("");
      }
      return cams;
    } catch {
      return [];
    }
  }

  function supportsBarcodeDetector() {
    return typeof window.BarcodeDetector === "function";
  }

  async function detectFrameOnce(videoEl, detector) {
    // BarcodeDetector يعمل على HTMLVideoElement مباشرة في كثير من المتصفحات
    try {
      const barcodes = await detector.detect(videoEl);
      if (!Array.isArray(barcodes) || !barcodes.length) return null;
      // خذ أول نتيجة
      const raw = barcodes[0]?.rawValue ?? barcodes[0]?.data ?? "";
      return String(raw || "").trim() || null;
    } catch {
      return null;
    }
  }

  // ---------- UI: render scan log ----------
  function renderLog(list, listEl, summaryEl) {
    const rows = Array.isArray(list) ? list : [];
    if (summaryEl) summaryEl.textContent = rows.length ? `عدد المسحات: ${rows.length}` : "—";

    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state">لا يوجد سجل مسح بعد.</div>`;
      return;
    }

    listEl.innerHTML = rows
      .slice(0, 200)
      .map((x) => {
        const at = String(x.at || "").replace("T", " ").slice(0, 19);
        const ok = x.result === "ok";
        const badge =
          x.result === "ok"
            ? `<span class="att-chip" style="display:inline-flex;gap:.3rem;"><i class="ri-check-line"></i><span>تم</span></span>`
            : x.result === "not_found"
            ? `<span class="att-chip"><i class="ri-question-line"></i> غير موجود</span>`
            : x.result === "locked"
            ? `<span class="att-chip"><i class="ri-lock-line"></i> مقفول</span>`
            : `<span class="att-chip"><i class="ri-alert-line"></i> خطأ</span>`;

        const who =
          x.studentId
            ? `ID: ${esc(x.studentId)}`
            : x.code
            ? `Code: ${esc(x.code)}`
            : esc(x.raw || "");

        const st = x.status ? `<span class="att-chip">${esc(x.status)}</span>` : "";
        const note = x.note ? `<div class="muted">${esc(x.note)}</div>` : `<div class="muted">—</div>`;

        return `
          <div class="muted-box" style="display:flex;flex-direction:column;gap:.3rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;">
              <div><strong>${who}</strong></div>
              <div style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;">
                ${st}
                ${badge}
                <span class="muted">${esc(at)}</span>
              </div>
            </div>
            ${note}
          </div>
        `;
      })
      .join("");
  }

  // ---------- Main init ----------
  function init() {
    // عناصر التبويب (لو موجودة)
    const root = byId("att-scan-root") || byId("att-view-scan");
    if (!root) return; // لو ما عندك التبويب، ما نسوي شيء

    // Inputs
    const videoEl = byId("att-scan-video");
    const deviceSel = byId("att-scan-device");
    const statusSel = byId("att-scan-status");
    const noteInput = byId("att-scan-note");

    const manualInput = byId("att-scan-input");
    const manualBtn = byId("att-scan-apply");

    const startBtn = byId("att-scan-start");
    const stopBtn = byId("att-scan-stop");
    const refreshDevicesBtn = byId("att-scan-refresh-devices");

    // Output
    const lastEl = byId("att-scan-last");
    const stateEl = byId("att-scan-state");
    const logListEl = byId("att-scan-list");
    const logSummaryEl = byId("att-scan-summary");

    const clearBtn = byId("att-scan-clear"); // ✅ مسح الملف الخاص
    const exportBtn = byId("att-scan-export");

    // Default status
    if (statusSel && !statusSel.value) statusSel.value = "present";

    // Render existing log
    renderLog(readScanLog(), logListEl, logSummaryEl);

    // Devices
    listVideoDevices(deviceSel).catch(() => {});

    refreshDevicesBtn?.addEventListener("click", () => {
      listVideoDevices(deviceSel)
        .then(() => toast("تم تحديث قائمة الكاميرات."))
        .catch(() => toast("تعذر تحديث قائمة الكاميرات."));
    });

    // Manual scan apply
    manualBtn?.addEventListener("click", () => {
      const raw = (manualInput?.value || "").trim();
      if (!raw) return toast("أدخل كود الطالب/QR أولاً.");

      const parsed = parseScanPayload(raw);
      const st = String(statusSel?.value || "present").trim() || "present";
      const note = String(noteInput?.value || "").trim();

      const res = applyScanToTable({ code: parsed.code, studentId: parsed.studentId, status: st, note });
      const log = addScanLog({
        raw,
        code: parsed.code,
        studentId: parsed.studentId,
        status: st,
        result: res.result,
        note: res.note,
      });

      if (lastEl) lastEl.textContent = raw;
      renderLog(log, logListEl, logSummaryEl);

      if (res.ok) {
        try {
          navigator.vibrate && navigator.vibrate(40);
        } catch {}
        toast("تم تطبيق المسح ✅");
      } else {
        toast(res.note || "فشل تطبيق المسح.");
      }
    });

    // Export log
    exportBtn?.addEventListener("click", () => {
      const rows = readScanLog();
      if (!rows.length) return toast("لا يوجد سجل للتصدير.");

      const header = ["at", "raw", "code", "studentId", "status", "result", "note"];
      const csv =
        header.join(",") +
        "\n" +
        rows
          .map((x) => {
            const vals = [
              x.at || "",
              x.raw || "",
              x.code || "",
              x.studentId ?? "",
              x.status || "",
              x.result || "",
              x.note || "",
            ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
            return vals.join(",");
          })
          .join("\n");

      downloadText(`attendance_scan_log_${Date.now()}.csv`, csv);
    });

    // Clear log (مسح الملف الخاص)
    clearBtn?.addEventListener("click", () => {
      if (!window.confirm("هل تريد مسح سجل المسح بالكامل؟")) return;
      clearScanLog();
      renderLog([], logListEl, logSummaryEl);
      toast("تم مسح سجل المسح ✅");
    });

    // Camera scan
    async function startScanner() {
      if (!videoEl) return toast("عنصر الفيديو غير موجود.");
      if (!navigator.mediaDevices?.getUserMedia) return toast("المتصفح لا يدعم الكاميرا.");

      if (!supportsBarcodeDetector()) {
        toast("المتصفح لا يدعم BarcodeDetector — استخدم الإدخال اليدوي.");
        return;
      }

      const formats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"];
      let detector = null;
      try {
        detector = new window.BarcodeDetector({ formats });
      } catch {
        try {
          detector = new window.BarcodeDetector();
        } catch {
          toast("تعذر تشغيل الماسح على هذا المتصفح.");
          return;
        }
      }

      const devId = String(deviceSel?.value || "").trim();
      try {
        await startCamera(videoEl, devId || null);
      } catch (e) {
        toast("تعذر فتح الكاميرا: " + (e.message || ""));
        return;
      }

      __scannerRunning = true;
      if (stateEl) stateEl.textContent = "يتم المسح الآن...";
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;

      // polling loop
      if (__scanTimer) clearInterval(__scanTimer);
      __scanTimer = setInterval(async () => {
        if (!__scannerRunning) return;

        const raw = await detectFrameOnce(videoEl, detector);
        if (!raw) return;

        // anti-dup in short time
        const now = Date.now();
        if (raw === __lastRaw && now - __lastAt < 1200) return;
        __lastRaw = raw;
        __lastAt = now;

        if (lastEl) lastEl.textContent = raw;

        const parsed = parseScanPayload(raw);
        const st = String(statusSel?.value || "present").trim() || "present";
        const note = String(noteInput?.value || "").trim();

        const res = applyScanToTable({ code: parsed.code, studentId: parsed.studentId, status: st, note });
        const log = addScanLog({
          raw,
          code: parsed.code,
          studentId: parsed.studentId,
          status: st,
          result: res.result,
          note: res.note,
        });
        renderLog(log, logListEl, logSummaryEl);

        if (res.ok) {
          try {
            navigator.vibrate && navigator.vibrate(30);
          } catch {}
        }
      }, 250);
    }

    async function stopScanner() {
      await stopCamera();
      if (stateEl) stateEl.textContent = "متوقف";
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    }

    startBtn?.addEventListener("click", () => startScanner().catch(() => {}));
    stopBtn?.addEventListener("click", () => stopScanner().catch(() => {}));

    // Stop camera when leaving page / modal closed
    window.addEventListener("beforeunload", () => {
      stopCamera().catch(() => {});
    });

    // If root hidden (modal closed), stop camera
    const modal = byId("modal-attendance");
    if (modal) {
      const obs = new MutationObserver(() => {
        try {
          const cls = modal.classList;
          const open =
            cls.contains("open") || cls.contains("is-open") || cls.contains("show") || modal.style.display !== "none";
          if (!open) stopScanner().catch(() => {});
        } catch {}
      });
      try {
        obs.observe(modal, { attributes: true, attributeFilter: ["class", "style"] });
      } catch {}
    }

    // expose minimal API
    window.AttendanceScanTab = {
      init,
      start: startScanner,
      stop: stopScanner,
      clearLog: clearScanLog,
      exportCSV: () => exportBtn?.click(),
    };
  }

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
