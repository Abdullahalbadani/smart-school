(function () {
  "use strict";

  const bellBtn = document.getElementById("navbar-notifications-btn");
  const badgeEl = document.getElementById("navbar-notifications-badge");

  if (!bellBtn || !badgeEl) return; // مخفي بالصلاحية أو غير موجود

const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function toApiUrl(path) {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path).replace(/^\/+/, "");

  // يمنع تكرار /api/api لأن الاستدعاء الحالي يبدأ بـ /api
  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${API_BASE}/${cleanPath}`;
}

  function getStoredToken() {
    const possibleKeys = ["token", "accessToken", "authToken", "adminToken", "jwt"];

    for (const key of possibleKeys) {
      const lsValue = window.localStorage?.getItem(key);
      if (lsValue) return lsValue;

      const ssValue = window.sessionStorage?.getItem(key);
      if (ssValue) return ssValue;
    }

    return null;
  }

  function getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

 function renderBadge(count) {
  const n = Number(count) || 0;

  // ✅ دائمًا أظهر العداد حتى لو صفر
  badgeEl.textContent = n > 99 ? "99+" : String(n);
  badgeEl.classList.remove("is-hidden");
}

  async function fetchUnreadCount() {
    try {
      const res = await fetch(toApiUrl("/api/notifications/inbox/unread-count"), {
        method: "GET",
        headers: getAuthHeaders({ Accept: "application/json" }),
      });

      if (res.status === 403) {
        bellBtn.style.display = "none"; // نفس صلاحية صندوق الوارد
        return;
      }

      if (!res.ok) return;

      const json = await res.json();

      // الكنترول عندك يرجّع: { success: true, data: ... }
      // لذلك ندعم أكثر من شكل
      const payload = json?.data ?? json;
      const count =
        Number(payload?.unread_count) ||
        Number(payload?.unreadCount) ||
        Number(payload?.count) ||
        0;

      renderBadge(count);
    } catch (err) {
      console.error("Bell unread count error:", err);
    }
  }

  // الضغط على الجرس -> فتح صندوق الوارد داخل النظام
  bellBtn.addEventListener("click", function () {
    if (window.Dashboard && typeof window.Dashboard.openPage === "function") {
      window.Dashboard.openPage("inbox", "صندوق الوارد");
      return;
    }

    // احتياطي
    if (window.Dashboard && typeof window.Dashboard.switchScreen === "function") {
      window.Dashboard.switchScreen("screen-notify");
    }
  });

  // أول تحميل + تحديث دوري
  fetchUnreadCount();
  setInterval(fetchUnreadCount, 30000);

  // نجعلها دالة عامة ليستدعيها inbox.js أو socket
  window.refreshNavbarNotificationCount = fetchUnreadCount;
})();