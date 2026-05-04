// frontend/teacher/features/profileModal.js
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

  const byId = (id) => document.getElementById(id);

  // Escape HTML (fallback)
  const esc =
    typeof window.escapeHtml === "function"
      ? window.escapeHtml
      : (s) =>
          String(s ?? "")
            .split("&")
            .join("&amp;")
            .split("<")
            .join("&lt;")
            .split(">")
            .join("&gt;")
            .split('"')
            .join("&quot;")
            .split("'")
            .join("&#039;");

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiGet(path) {
    const url = path.startsWith("http") ? path : API_BASE + path;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        ...authHeaders(),
      },
    });

    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {}

    if (!r.ok) {
      const msg =
        (json && (json.message || json.error)) ||
        text ||
        "HTTP " + r.status;
      throw new Error(msg);
    }

    return json;
  }

  function setText(id, val) {
    const el = byId(id);
    if (!el) return;
    el.textContent = val == null || val === "" ? "—" : String(val);
  }

  function setHTML(id, html) {
    const el = byId(id);
    if (!el) return;
    el.innerHTML = html || "";
  }

  function show(id, on) {
    const el = byId(id);
    if (!el) return;
    el.style.display = on ? "" : "none";
  }

  function termLabel(term) {
    return Number(term) === 2 ? "الفصل الثاني" : "الفصل الأول";
  }

  function chips(items) {
    if (!items || !items.length) {
      return `<span class="chip chip-muted">—</span>`;
    }
    return items
      .map((x) => `<span class="chip">${esc(x.name)}</span>`)
      .join("");
  }

  function scopeCard(s) {
    return `
      <div class="scope-item">
        <div class="scope-title">
          <i class="ri-building-2-line"></i>
          <strong>${esc(s.stage_name)}</strong>
          <span class="dot">•</span>
          <span>${esc(s.grade_name)}</span>
        </div>
        <div class="scope-meta">
          <span><i class="ri-group-line"></i> الشعبة: <strong>${esc(
            s.section_name
          )}</strong></span>
          <span class="sep">|</span>
          <span><i class="ri-book-2-line"></i> المادة: <strong>${esc(
            s.subject_name
          )}</strong></span>
        </div>
      </div>
    `;
  }

  async function refreshTeacherJobProfile() {
    // ✅ لو المودال مش موجود لا تعمل شيء
    if (!byId("profile-modal")) return;

    // Reset states
    show("profile-msg", false);
    show("profile-empty", false);

    // ✅ السنة/الترم من localStorage لو عندك (مثل صفحات الجدول)
    const yearId = Number(localStorage.getItem("TT_YEAR_ID") || 0) || 0;
    const term = Number(localStorage.getItem("TT_TERM") || 1) || 1;

    const qs = [];
    if (yearId) qs.push("academicYearId=" + encodeURIComponent(yearId));
    qs.push("term=" + encodeURIComponent(term));
    const url = "/teacher/profile?" + qs.join("&");

    // Placeholders أثناء التحميل
    setText("profile-name", "جارٍ التحميل...");
    setText("profile-code", "—");
    setText("profile-phone", "—");
    setText("profile-status", "معلم");

    setText("profile-stages-count", "0");
    setText("profile-grades-count", "0");
    setText("profile-sections-count", "0");
    setText("profile-subjects-count", "0");

    setHTML("profile-stages-list", "");
    setHTML("profile-grades-list", "");
    setHTML("profile-sections-list", "");
    setHTML("profile-subjects-list", "");
    setHTML("profile-scopes", "");

    setText("profile-scope-hint", "—");

    try {
      const r = await apiGet(url);
      const data = r?.data || {};

      const t = data.teacher || {};
      const meta = data.meta || {};
      const stats = data.stats || {};
      const lists = data.lists || {};
      const scopes = Array.isArray(data.scopes) ? data.scopes : [];

      // Basic info
      setText("profile-name", t.full_name || "—");
      setText("profile-code", t.code || t.id || "—");
      setText("profile-phone", t.phone || "—");
      setText("profile-status", t.is_active === false ? "غير نشط" : "معلم");

      // Counts
      setText("profile-stages-count", stats.stages ?? 0);
      setText("profile-grades-count", stats.grades ?? 0);
      setText("profile-sections-count", stats.sections ?? 0);
      setText("profile-subjects-count", stats.subjects ?? 0);

      // Lists
      setHTML("profile-stages-list", chips(lists.stages || []));
      setHTML("profile-grades-list", chips(lists.grades || []));
      setHTML("profile-sections-list", chips(lists.sections || []));
      setHTML("profile-subjects-list", chips(lists.subjects || []));

      // Hint
      const hint =
        (meta.academic_year_name
          ? meta.academic_year_name
          : "سنة #" + (meta.academic_year_id || "—")) +
        " — " +
        termLabel(meta.term || term || 1);

      setText("profile-scope-hint", hint);

      // Scopes list
      if (!scopes.length) {
        setHTML("profile-scopes", "");
        show("profile-empty", true);
      } else {
        setHTML("profile-scopes", scopes.map(scopeCard).join(""));
        show("profile-empty", false);
      }
    } catch (e) {
      console.error("Teacher profile load error:", e);

      // UI fallback
      setText("profile-name", "—");
      setText("profile-code", "—");
      setText("profile-phone", "—");

      setText("profile-stages-count", "0");
      setText("profile-grades-count", "0");
      setText("profile-sections-count", "0");
      setText("profile-subjects-count", "0");

      setHTML("profile-stages-list", "");
      setHTML("profile-grades-list", "");
      setHTML("profile-sections-list", "");
      setHTML("profile-subjects-list", "");
      setHTML("profile-scopes", "");

      show("profile-empty", true);

      const msgEl = byId("profile-msg");
      if (msgEl) {
        msgEl.textContent = e?.message || "فشل تحميل الملف الوظيفي";
        msgEl.style.display = "";
      }
    }
  }

  // ✅ اجعلها متاحة للاستدعاء
  window.TeacherJobProfile = {
    refresh: refreshTeacherJobProfile,
  };
})();
