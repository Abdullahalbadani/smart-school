// src/middleware/xssSanitizer.js

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#x27;";
      default: return m;
    }
  });
}

const SKIPPED_KEYS = new Set([
  "password",
  "passwordPlain",
  "confirmPassword",
  "oldPassword",
  "newPassword",
  "token",
  "accessToken",
  "refreshToken"
]);

function sanitizeObject(obj, keyName = null) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    if (keyName && SKIPPED_KEYS.has(keyName)) {
      return obj;
    }
    return escapeHtml(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, keyName));
  }

  if (typeof obj === "object") {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = sanitizeObject(obj[key], key);
      }
    }
  }

  return obj;
}

export default function xssSanitizer(req, res, next) {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
}
