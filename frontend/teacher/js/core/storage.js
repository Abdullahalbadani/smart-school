// frontend/**/js/core/storage.js
(function () {
  "use strict";

  const StorageUtil = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {}
    },

    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },

    getJSON(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },

    setJSON(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },

    // مساعدات شائعة
    getToken() {
      return StorageUtil.get("token", "");
    },

    setToken(token) {
      if (!token) StorageUtil.remove("token");
      else StorageUtil.set("token", token);
    },

    getTheme(defaultTheme = "light") {
      const t = StorageUtil.get("smart_theme", defaultTheme);
      return t === "dark" || t === "light" ? t : defaultTheme;
    },

    setTheme(theme) {
      StorageUtil.set("smart_theme", theme === "dark" ? "dark" : "light");
    },
  };

  window.StorageUtil = StorageUtil;
})();
