(function () {
  const API_BASE = "/api";

  window.API_BASE = API_BASE;

  window.apiUrl = function (path = "") {
    if (/^https?:\/\//i.test(path)) return path;

    let cleanPath = String(path || "").replace(/^\/+/, "");

    if (cleanPath.startsWith("api/")) {
      cleanPath = cleanPath.slice(4);
    }

    return `${window.API_BASE}/${cleanPath}`;
  };
})();