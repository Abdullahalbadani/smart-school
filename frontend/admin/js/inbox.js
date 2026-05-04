/* === Admin Inbox Page (API Version) ===
 * - مربوط بـ Backend API (Inbox فقط)
 * - متوافق مع authMiddleware الذي يعتمد على Authorization Bearer token
 * - جاهز لاحقًا للـ Socket.io
 */

(function () {
  "use strict";

  const state = {
    initialized: false,
    items: [],
    filter: "all", // all | unread | read | system | manual
    q: "",
    selectedId: null, // notification id
    loading: false,
    searchDebounceTimer: null,
    eventsBound: false,
  };
const API_BASE =
  (window.location.port === "5501" || window.location.port === "5500")
    ? "http://127.0.0.1:5000"
    : "";

function toApiUrl(path) {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}
  // ===== أدوات =====
  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateTime(value) {
    if (!value) return "--";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "--";

    return new Intl.DateTimeFormat("ar-YE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function getPriorityLabel(priority) {
    switch (priority) {
      case "urgent":
        return "عاجل";
      case "important":
        return "مهم";
      default:
        return "عادي";
    }
  }

  function normalizeCategoryLabel(category) {
    if (!category) return "عام";

    // تحسين عرض بسيط لو جاء من DB بالإنجليزية
    const map = {
      finance: "المالية",
      general: "عام",
      attendance: "حضور وغياب",
      permits: "استئذان",
      permission: "استئذان",
      admin: "إداري",
      academic: "أكاديمي",
      fees: "رسوم",
      exams: "امتحانات",
    };

    return map[String(category).toLowerCase()] || category;
  }

  // =========================================
  // 🔐 AUTH (متوافق مع authMiddleware عندك)
  // =========================================

  function getStoredToken() {
    // عدّل المفاتيح إذا مشروعك يستخدم اسمًا مختلفًا للتوكن
    const possibleKeys = [
      "token",
      "accessToken",
      "authToken",
      "adminToken",
      "jwt",
    ];

    for (const key of possibleKeys) {
      const lsValue = window.localStorage?.getItem(key);
      if (lsValue) return lsValue;

      const ssValue = window.sessionStorage?.getItem(key);
      if (ssValue) return ssValue;
    }

    return null;
  }

  function getAuthHeaders(extraHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };

    const token = getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

 async function apiRequest(url, options = {}) {
  const res = await fetch(toApiUrl(url), {
    method: options.method || "GET",
    headers: getAuthHeaders(options.headers || {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {}

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      `HTTP ${res.status} ${res.statusText || ""}`.trim();
    throw new Error(message);
  }

  if (data && typeof data === "object" && "success" in data) {
    if (!data.success) {
      throw new Error(data.message || "فشل في الطلب");
    }
    return data.data;
  }

  return data;
}

 function mapApiItemToUi(item) {
  const categoryKey = String(item.category || "general").toLowerCase();

  return {
    recipient_row_id: Number(item.recipient_row_id || 0),
    id: Number(item.id || 0),
    source: item.source || "system",

    category_key: categoryKey,                 // ✅ مهم للفلترة
    category: normalizeCategoryLabel(categoryKey), // ✅ للعرض

    priority: item.priority || "normal",
    title: item.title || "بدون عنوان",
    body: item.body || "",
    sender_name: item.sender_name || "النظام",
    created_at: item.created_at || null,
    is_read: !!item.is_read,
    read_at: item.read_at || null,
    related: item.related || null,
    meta: item.meta || {},
  };
}

  // =========================================
  // API Calls (Inbox)
  // =========================================

  async function loadInboxFromApi() {
    if (!ensureRootExists()) return;

    state.loading = true;
    setLoadingUI(true);

    try {
      const params = new URLSearchParams({
        filter: state.filter || "all",
        q: state.q || "",
        limit: "50",
        offset: "0",
      });

      const data = await apiRequest(`/api/notifications/inbox?${params.toString()}`);
      const items = Array.isArray(data?.items) ? data.items : [];

      state.items = items.map(mapApiItemToUi);

      // الحفاظ على العنصر المحدد إن كان موجودًا بعد إعادة الجلب
      if (!state.selectedId || !state.items.some((x) => x.id === state.selectedId)) {
        state.selectedId = state.items[0]?.id || null;
      }

      renderAll();
      if (typeof window.refreshNavbarNotificationCount === "function") {
  window.refreshNavbarNotificationCount();
}
    } catch (err) {
      console.error("loadInboxFromApi error:", err);

      state.items = [];
      state.selectedId = null;
      renderAll();

      showToast(err.message || "تعذر تحميل صندوق الوارد", "error");
    } finally {
      state.loading = false;
      setLoadingUI(false);
    }
  }

  async function markNotificationAsReadApi(recipientRowId) {
    return apiRequest(`/api/notifications/inbox/${recipientRowId}/read`, {
      method: "PATCH",
    });
  }

  async function markAllAsReadApi() {
    return apiRequest(`/api/notifications/inbox/read-all`, {
      method: "PATCH",
    });
  }

  async function fetchUnreadCountApi() {
    try {
      const data = await apiRequest(`/api/notifications/inbox/unread-count`);
      return Number(data?.unread_count || 0);
    } catch (err) {
      console.warn("fetchUnreadCountApi error:", err);
      return null;
    }
  }

  // =========================================
  // State helpers
  // =========================================

  function getFilteredItems() {
    // هذه الفلاتر تبقى محليًا أيضًا (رغم أن السيرفر يفلتر)
    // مفيد إذا أضفنا عنصرًا جديدًا لحظيًا قبل إعادة الجلب
    let items = [...state.items];

    if (state.filter === "unread") {
      items = items.filter((x) => !x.is_read);
    } else if (state.filter === "read") {
      items = items.filter((x) => x.is_read);
    } else if (state.filter === "system") {
      items = items.filter((x) => x.source === "system");
    } else if (state.filter === "manual") {
      items = items.filter((x) => x.source === "manual");
    }
else if (state.filter === "finance") {
  items = items.filter((x) => x.category_key === "finance");
}
    if (state.q.trim()) {
      const q = state.q.trim().toLowerCase();
      items = items.filter((x) =>
        [x.title, x.body, x.category, x.sender_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }

    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items;
  }

  function getCounts() {
    const total = state.items.length;
    const unread = state.items.filter((x) => !x.is_read).length;
    const read = total - unread;
    return { total, unread, read };
  }

  function getItemById(id) {
    return state.items.find((x) => x.id === id) || null;
  }

  // =========================================
  // Render
  // =========================================

  function renderStats() {
    const totalEl = qs("#inboxTotalCount");
    const unreadEl = qs("#inboxUnreadCount");
    const readEl = qs("#inboxReadCount");

    if (!totalEl || !unreadEl || !readEl) return;

    const { total, unread, read } = getCounts();
    totalEl.textContent = String(total);
    unreadEl.textContent = String(unread);
    readEl.textContent = String(read);

    // (اختياري) تحديث رقم الجرس لو عندك عنصر badge معروف
    // مثال IDs محتملة:
  const bellBadge =
  qs("#navbar-notifications-badge") ||
  qs("#adminNotificationBellBadge") ||
  qs("#notificationBellBadge") ||
  qs("#notificationsBellCount");
  if (bellBadge) {
  bellBadge.textContent = unread > 99 ? "99+" : String(unread);
  bellBadge.style.display = ""; // ✅ دائمًا ظاهر حتى لو صفر
  bellBadge.classList?.remove("is-hidden");
}
  }

  function renderTabs() {
    qsa(".inbox-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.filter === state.filter);
    });
  }

  function renderList() {
    const listEl = qs("#inboxList");
    const emptyEl = qs("#inboxEmptyState");
    if (!listEl || !emptyEl) return;

    const items = getFilteredItems();

    if (!items.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      renderDetail(null);
      return;
    }

    emptyEl.classList.add("hidden");

    listEl.innerHTML = items
      .map((item) => {
        const selectedClass = item.id === state.selectedId ? "is-selected" : "";
        const unreadClass = !item.is_read ? "is-unread" : "";
        const snippet = (item.body || "").replace(/\s+/g, " ").trim().slice(0, 100);

        return `
          <div class="inbox-list-item ${selectedClass} ${unreadClass}" data-id="${item.id}">
            <div class="inbox-item-top">
              <div class="inbox-item-title">${escapeHtml(item.title)}</div>
              <div class="inbox-item-time">${escapeHtml(formatDateTime(item.created_at))}</div>
            </div>

            <div class="inbox-item-meta">
              <span class="inbox-chip ${escapeHtml(item.source)}">${item.source === "system" ? "النظام" : "يدوي"}</span>
              <span class="inbox-chip">${escapeHtml(item.category || "عام")}</span>
              <span class="inbox-chip priority-${escapeHtml(item.priority || "normal")}">${escapeHtml(getPriorityLabel(item.priority))}</span>
            </div>

            <div class="inbox-item-snippet">${escapeHtml(snippet || "—")}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderDetail(item) {
    const placeholder = qs("#inboxDetailPlaceholder");
    const card = qs("#inboxDetailCard");

    if (!placeholder || !card) return;

    if (!item) {
      placeholder.classList.remove("hidden");
      card.classList.add("hidden");
      return;
    }

    placeholder.classList.add("hidden");
    card.classList.remove("hidden");

    const categoryBadge = qs("#detailCategoryBadge");
    const priorityBadge = qs("#detailPriorityBadge");
    const sourceBadge = qs("#detailSourceBadge");
    const titleEl = qs("#detailTitle");
    const senderEl = qs("#detailSender");
    const timeEl = qs("#detailTime");
    const readAtEl = qs("#detailReadAt");
    const bodyEl = qs("#detailBody");
    const relatedWrap = qs("#detailRelated");
    const relatedContent = qs("#detailRelatedContent");
    const markReadBtn = qs("#detailMarkReadBtn");

    if (categoryBadge) categoryBadge.textContent = item.category || "عام";

    if (priorityBadge) {
      priorityBadge.textContent = getPriorityLabel(item.priority);
      priorityBadge.className = `detail-badge priority ${item.priority || "normal"}`;
    }

    if (sourceBadge) sourceBadge.textContent = item.source === "system" ? "system" : "manual";
    if (titleEl) titleEl.textContent = item.title || "بدون عنوان";
    if (senderEl) senderEl.textContent = `المرسل: ${item.sender_name || "النظام"}`;
    if (timeEl) timeEl.textContent = `الوقت: ${formatDateTime(item.created_at)}`;
    if (readAtEl) {
      readAtEl.textContent =
        item.is_read && item.read_at
          ? `القراءة: ${formatDateTime(item.read_at)}`
          : "القراءة: غير مقروء";
    }

    if (bodyEl) bodyEl.textContent = item.body || "";

    if (relatedWrap && relatedContent) {
      if (item.related) {
        relatedWrap.classList.remove("hidden");
        const relLabel = item.related.label || `#${item.related.id || ""}`;
        relatedContent.textContent = `${relLabel} (${item.related.type || ""})`;
      } else {
        relatedWrap.classList.add("hidden");
        relatedContent.textContent = "";
      }
    }

    if (markReadBtn) {
      markReadBtn.disabled = !!item.is_read;
      markReadBtn.style.opacity = item.is_read ? "0.6" : "1";
      markReadBtn.textContent = item.is_read ? "مقروء بالفعل" : "تعليم كمقروء";
      markReadBtn.dataset.id = String(item.id);
    }
  }

  function renderAll() {
    renderStats();
    renderTabs();
    renderList();

    let selected = getItemById(state.selectedId);
    const filtered = getFilteredItems();

    if (!selected || !filtered.some((x) => x.id === selected.id)) {
      selected = filtered[0] || null;
      state.selectedId = selected ? selected.id : null;
      renderList(); // لإظهار التحديد الصحيح
    }

    renderDetail(selected);
  }

  // =========================================
  // Actions
  // =========================================

  async function markNotificationAsRead(id) {
    const item = getItemById(id);
    if (!item || item.is_read) return;

    const prevRead = item.is_read;
    const prevReadAt = item.read_at;

    // Optimistic UI
    item.is_read = true;
    item.read_at = new Date().toISOString();
    renderAll();
if (typeof window.refreshNavbarNotificationCount === "function") {
  window.refreshNavbarNotificationCount();
}
    try {
      if (!item.recipient_row_id) {
        throw new Error("recipient_row_id غير موجود");
      }

      const result = await markNotificationAsReadApi(item.recipient_row_id);
      item.is_read = true;
      item.read_at = result?.read_at || item.read_at;
      renderAll();
    } catch (err) {
      console.error("markNotificationAsRead error:", err);

      // rollback
      item.is_read = prevRead;
      item.read_at = prevReadAt;
      renderAll();

      showToast(err.message || "فشل تعليم الإشعار كمقروء", "error");
    }
  }

  async function markAllAsRead() {
    const snapshot = state.items.map((x) => ({
      id: x.id,
      is_read: x.is_read,
      read_at: x.read_at,
    }));

    const now = new Date().toISOString();

    // Optimistic UI
    state.items.forEach((x) => {
      if (!x.is_read) {
        x.is_read = true;
        x.read_at = now;
      }
    });
    renderAll();

    try {
      await markAllAsReadApi();
      showToast("تم تعليم جميع الإشعارات كمقروء", "success");
      if (typeof window.refreshNavbarNotificationCount === "function") {
  window.refreshNavbarNotificationCount();
}
    } catch (err) {
      console.error("markAllAsRead error:", err);

      // rollback
      state.items.forEach((x) => {
        const prev = snapshot.find((s) => s.id === x.id);
        if (prev) {
          x.is_read = prev.is_read;
          x.read_at = prev.read_at;
        }
      });
      renderAll();

      showToast(err.message || "فشل تعليم الكل كمقروء", "error");
    }
  }

  // =========================================
  // UI Helpers
  // =========================================

  function setLoadingUI(isLoading) {
    const refreshBtn = qs("#inboxRefreshBtn");
    const markAllBtn = qs("#inboxMarkAllReadBtn");
    const searchInput = qs("#inboxSearchInput");

    if (refreshBtn) {
      refreshBtn.disabled = isLoading;
      refreshBtn.style.opacity = isLoading ? "0.7" : "1";
      refreshBtn.textContent = isLoading ? "جارٍ التحديث..." : "تحديث";
    }

    if (markAllBtn) {
      markAllBtn.disabled = isLoading;
      markAllBtn.style.opacity = isLoading ? "0.7" : "1";
    }

    if (searchInput) {
      searchInput.disabled = isLoading;
    }
  }

  function showToast(message, type = "info") {
    // إذا عندك نظام toast جاهز في المشروع، اربطه هنا
    // مثال:
    // window.showToast?.(message, type);

    // fallback بسيط:
    if (type === "error") {
      console.warn("[Inbox]", message);
    } else {
      console.log("[Inbox]", message);
    }
  }

  function debounceSearch(callback, delay = 300) {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(callback, delay);
  }

  // =========================================
  // Events
  // =========================================

  function bindEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;

    qs("#inboxTabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".inbox-tab");
      if (!btn) return;

      const newFilter = btn.dataset.filter || "all";
      if (state.filter === newFilter) return;

      state.filter = newFilter;
      loadInboxFromApi();
    });

    qs("#inboxSearchInput")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      debounceSearch(() => {
        loadInboxFromApi();
      }, 300);
    });

    qs("#inboxList")?.addEventListener("click", (e) => {
      const itemEl = e.target.closest(".inbox-list-item");
      if (!itemEl) return;

      const id = Number(itemEl.dataset.id);
      if (!id) return;

      state.selectedId = id;
      renderAll();
    });

    qs("#detailMarkReadBtn")?.addEventListener("click", async (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if (!id) return;
      await markNotificationAsRead(id);
    });

    qs("#inboxMarkAllReadBtn")?.addEventListener("click", async () => {
      await markAllAsRead();
    });

    qs("#inboxRefreshBtn")?.addEventListener("click", async () => {
      await loadInboxFromApi();
    });
  }

  // =========================================
  // Init / Re-init
  // =========================================

  function ensureRootExists() {
    return !!qs("#adminInboxPage");
  }

  async function init() {
    if (!ensureRootExists()) return;
    if (state.initialized) return;

    bindEvents();
    state.initialized = true;

    // أول تحميل حقيقي من API
    await loadInboxFromApi();

    // (اختياري) مزامنة عداد الجرس مباشرة
    const unread = await fetchUnreadCountApi();
    if (typeof unread === "number") {
      const bellBadge =
        qs("#adminNotificationBellBadge") ||
        qs("#notificationBellBadge") ||
        qs("#notificationsBellCount");

   if (bellBadge) {
  bellBadge.textContent = unread > 99 ? "99+" : String(unread);
  bellBadge.style.display = ""; // ✅ دائمًا ظاهر
  bellBadge.classList?.remove("is-hidden");
}
    }

    console.log("✅ Admin Inbox initialized (API)");
  }

  function resetStateForReinit() {
    state.initialized = false;
    state.items = [];
    state.selectedId = null;
    state.loading = false;
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = null;
    // نُبقي filter/q كما هي لتحسين تجربة المستخدم عند إعادة فتح الصفحة
    // إذا أردت التصفير الكامل:
    // state.filter = "all";
    // state.q = "";
  }

  function resetAndInit() {
    resetStateForReinit();
    init();
  }

  // =========================================
  // Public APIs (مفيد للربط لاحقًا مع Socket)
  // =========================================

  window.initAdminInboxPage = resetAndInit;

  window.AdminInboxPage = {
    async refresh() {
      await loadInboxFromApi();
    },

    setNotifications(items) {
      state.items = Array.isArray(items) ? items.map(mapApiItemToUi) : [];
      state.selectedId = state.items[0]?.id || null;
      renderAll();
    },

    addNotification(notification) {
      if (!notification) return;

      const mapped = mapApiItemToUi(notification);
      if (!mapped.id) return;

      // منع التكرار
      const exists = state.items.some(
        (x) =>
          (mapped.recipient_row_id && x.recipient_row_id === mapped.recipient_row_id) ||
          (!mapped.recipient_row_id && x.id === mapped.id)
      );
      if (exists) return;

      state.items.unshift(mapped);

      // إذا لا يوجد عنصر محدد، حدده
      if (!state.selectedId) {
        state.selectedId = mapped.id;
      }

      renderAll();
    },

    async markRead(id) {
      await markNotificationAsRead(Number(id));
    },

    // مفيد للجرس لاحقًا
    async fetchUnreadCount() {
      return fetchUnreadCountApi();
    },
  };

  // محاولة تشغيل تلقائي إذا الصفحة موجودة مباشرة
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();