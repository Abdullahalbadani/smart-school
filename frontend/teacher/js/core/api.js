// teacher/core/api.js
(function () {
  "use strict";

  const API_BASE = window.API_BASE || "/api";
  window.API_BASE = API_BASE;

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiFetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : API_BASE + path;
    const r = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });

    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!r.ok) {
      const err = new Error(
        data?.message || data?.error || text.slice(0, 200) || "API Error"
      );
      err.status = r.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  window.apiFetch = apiFetch;
  window.apiGet = (path) => apiFetch(path, { method: "GET" });
  window.apiPost = (path, body) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
})();
