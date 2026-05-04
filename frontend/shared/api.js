window.api = (() => {
  "use strict";

  const getToken = () => localStorage.getItem("token");
  const getBase = () => window.API_BASE || "/api";

  function buildHeaders(extra = {}, isJson = true) {
    const headers = { ...extra };

    if (isJson && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async function request(path, options = {}) {
    const {
      method = "GET",
      body,
      headers = {},
      isJson = true,
    } = options;

    const response = await fetch(`${getBase()}${path}`, {
      method,
      headers: buildHeaders(headers, isJson),
      body: body == null
        ? undefined
        : isJson
        ? JSON.stringify(body)
        : body,
    });

    const text = await response.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        (data && typeof data === "object" && data.message) ||
        (data && typeof data === "object" && data.error) ||
        (typeof data === "string" && data) ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }

    return data;
  }

  return {
    get: (path, options = {}) => request(path, { ...options, method: "GET" }),
    post: (path, body, options = {}) =>
      request(path, { ...options, method: "POST", body }),
    put: (path, body, options = {}) =>
      request(path, { ...options, method: "PUT", body }),
    patch: (path, body, options = {}) =>
      request(path, { ...options, method: "PATCH", body }),
    delete: (path, options = {}) =>
      request(path, { ...options, method: "DELETE" }),
  };
})();