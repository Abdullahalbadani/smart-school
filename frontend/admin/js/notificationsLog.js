// frontend/admin/js/notificationsLog.js
(function () {
  "use strict";

  const state = {
    initialized: false,
    eventsBound: false,
    items: [],
    selectedId: null,
    q: "",
    priority: "",
    category: "",
  };

  function qs(s, root = document) { return root.querySelector(s); }

  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("authToken") ||
      localStorage.getItem("accessToken") ||
      ""
    );
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateTime(v) {
    if (!v) return "--";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "--";
    return new Intl.DateTimeFormat("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
const API_BASE =
  window.API_BASE_URL ||
  localStorage.getItem("apiBaseUrl") ||
  "http://127.0.0.1:5000"; // غيّره إذا الباكند عندك على منفذ آخر

function toApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url; // إذا الرابط كامل بالفعل
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}
async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const finalUrl = toApiUrl(url);
  console.log("[API]", options.method || "GET", finalUrl);

  const res = await fetch(finalUrl, { ...options, headers });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    throw new Error(data?.message || `HTTP ${res.status} ${res.statusText}`);
  }
  return data;
}

  function buildListUrl() {
    const params = new URLSearchParams();
    if (state.q.trim()) params.set("q", state.q.trim());
    if (state.priority) params.set("priority", state.priority);
    if (state.category.trim()) params.set("category", state.category.trim());
    params.set("limit", "50");
    return `/api/notifications/admin/sent-log?${params.toString()}`;
  }

  async function loadList() {
    const res = await apiRequest(buildListUrl());
    state.items = res?.data?.items || [];
    renderList();

    if (!state.items.length) {
      renderDetails(null);
      return;
    }

    if (!state.selectedId || !state.items.some((x) => x.id === state.selectedId)) {
      state.selectedId = state.items[0].id;
    }

    await loadDetails(state.selectedId);
  }

  function renderList() {
    const listEl = qs("#sentLogList");
    const emptyEl = qs("#sentLogEmpty");
    if (!listEl || !emptyEl) return;

    if (!state.items.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");

    listEl.innerHTML = state.items.map((item) => {
      const isSelected = item.id === state.selectedId;
      const bodySnippet = String(item.body || "").replace(/\s+/g, " ").slice(0, 90);

      return `
        <div class="sent-log-item ${isSelected ? "is-selected" : ""}" data-id="${item.id}">
          <div class="top-row">
            <strong>${escapeHtml(item.title || "بدون عنوان")}</strong>
            <span>${escapeHtml(formatDateTime(item.created_at))}</span>
          </div>

          <div class="chips-row">
            <span class="chip">${escapeHtml(item.category || "general")}</span>
            <span class="chip">${escapeHtml(item.priority || "normal")}</span>
            <span class="chip">المستلمين: ${escapeHtml(item.recipients_count || 0)}</span>
            <span class="chip">مقروء: ${escapeHtml(item.read_count || 0)}</span>
            <span class="chip">غير مقروء: ${escapeHtml(item.unread_count || 0)}</span>
          </div>

          <div class="snippet">${escapeHtml(bodySnippet || "—")}</div>
        </div>
      `;
    }).join("");
  }

  async function loadDetails(id) {
    if (!id) return;
    const res = await apiRequest(`/api/notifications/admin/sent-log/${id}`);
    renderDetails(res?.data || null);
  }

  function renderDetails(data) {
    const placeholder = qs("#sentLogDetailsPlaceholder");
    const card = qs("#sentLogDetailsCard");

    if (!data || !data.notification) {
      placeholder?.classList.remove("hidden");
      card?.classList.add("hidden");
      return;
    }

    placeholder?.classList.add("hidden");
    card?.classList.remove("hidden");

    const n = data.notification;
    const recipients = data.recipients || [];

    qs("#sentDetailTitle").textContent = n.title || "بدون عنوان";
    qs("#sentDetailMeta").innerHTML = `
      <div>المرسل: ${escapeHtml(n.sender_name || "—")}</div>
      <div>الوقت: ${escapeHtml(formatDateTime(n.created_at))}</div>
      <div>الفئة: ${escapeHtml(n.category || "general")} | الأولوية: ${escapeHtml(n.priority || "normal")}</div>
      <div>المرجع: ${escapeHtml(n.related_type || "—")} ${n.related_id ? "#" + n.related_id : ""}</div>
    `;
    qs("#sentDetailBody").textContent = n.body || "";

    qs("#sentDetailTotal").textContent = String(n.recipients_count || 0);
    qs("#sentDetailRead").textContent = String(n.read_count || 0);
    qs("#sentDetailUnread").textContent = String(n.unread_count || 0);

    qs("#sentDetailRecipientsList").innerHTML = recipients.map((r) => `
      <div class="recipient-item ${r.is_read ? "is-read" : "is-unread"}">
        <div>
          <strong>${escapeHtml(r.recipient_name || "—")}</strong>
          <div class="small">
            user_id: ${escapeHtml(r.recipient_user_id)} 
            ${r.recipient_username ? `| ${escapeHtml(r.recipient_username)}` : ""}
          </div>
        </div>
        <div class="small">
          ${r.is_read ? `مقروء (${escapeHtml(formatDateTime(r.read_at))})` : "غير مقروء"}
        </div>
      </div>
    `).join("");
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;

    qs("#sentLogRefreshBtn")?.addEventListener("click", async () => {
      try {
        await loadList();
      } catch (err) {
        console.error("sent log refresh error:", err);
        alert(err.message || "فشل تحديث السجل");
      }
    });

    qs("#sentLogSearchInput")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
    });

    qs("#sentLogPriorityFilter")?.addEventListener("change", (e) => {
      state.priority = e.target.value || "";
    });

    qs("#sentLogCategoryFilter")?.addEventListener("input", (e) => {
      state.category = e.target.value || "";
    });

    // إعادة الجلب عند Enter في البحث
    qs("#sentLogSearchInput")?.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      try {
        await loadList();
      } catch (err) {
        console.error(err);
        alert(err.message || "فشل البحث");
      }
    });

    qs("#sentLogList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".sent-log-item");
      if (!item) return;
      const id = Number(item.dataset.id);
      if (!id) return;
      state.selectedId = id;
      renderList();

      try {
        await loadDetails(id);
      } catch (err) {
        console.error("load sent details error:", err);
        alert(err.message || "فشل جلب التفاصيل");
      }
    });
  }

  async function init() {
    const root = qs("#adminNotificationsLogPage");
    if (!root) return;

    bindEvents();

    try {
      await loadList();
      console.log("✅ Admin Notifications Log Page initialized");
    } catch (err) {
      console.error("init notifications log error:", err);
      alert(err.message || "فشل تحميل سجل الإشعارات");
    }

    state.initialized = true;
  }

  function resetAndInit() {
    state.initialized = false;
    init();
  }

  window.initAdminNotificationsLogPage = resetAndInit;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();