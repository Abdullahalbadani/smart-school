// frontend/shared/js/notification-socket.js
// Creates one authenticated Socket.IO connection per page for notifications and school-scoped live events.
(function () {
  "use strict";

  let socketInstance = null;

  function getStoredToken() {
    const keys = ["token", "accessToken", "authToken", "adminToken", "jwt"];
    for (const key of keys) {
      const fromLocal = window.localStorage?.getItem(key);
      if (fromLocal) return fromLocal;
      const fromSession = window.sessionStorage?.getItem(key);
      if (fromSession) return fromSession;
    }
    return null;
  }

  function getOrigin() {
    return String(window.API_ORIGIN || window.location.origin).replace(/\/+$/, "");
  }

  window.getNotificationSocket = function getNotificationSocket() {
    if (socketInstance) return socketInstance;
    if (typeof window.io !== "function") return null;

    const token = getStoredToken();
    if (!token) return null;

    socketInstance = window.io(getOrigin(), {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 700,
      timeout: 10000,
    });

    socketInstance.on("connect_error", (error) => {
      console.warn("[Socket] تعذر إنشاء الاتصال اللحظي:", error?.message || error);
    });

    return socketInstance;
  };

  window.disconnectNotificationSocket = function disconnectNotificationSocket() {
    if (!socketInstance) return;
    socketInstance.disconnect();
    socketInstance = null;
  };
})();
