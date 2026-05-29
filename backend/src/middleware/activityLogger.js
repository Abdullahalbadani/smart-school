// backend/src/middleware/activityLogger.js
import { logActivity } from "../utils/logger.js";

function actionFromMethod(method) {
  const m = String(method || "").toUpperCase();

  if (m === "POST") return "CREATE";
  if (m === "PUT" || m === "PATCH") return "UPDATE";
  if (m === "DELETE") return "DELETE";

  return "ACTIVITY";
}

function actionArabic(action) {
  const map = {
    CREATE: "أضاف",
    UPDATE: "عدّل",
    DELETE: "حذف",
    APPROVE: "اعتمد",
    REJECT: "رفض",
    PUBLISH: "نشر",
    UNPUBLISH: "ألغى النشر",
    PRINT: "طبع",
    ISSUE: "أصدر",
    CANCEL: "ألغى",
    LOCK: "أغلق",
    UNLOCK: "فتح",
  };

  return map[action] || "نفّذ عملية";
}

function getResourceFromPath(req) {
  const rawPath = String(req.originalUrl || req.url || req.path || "")
    .split("?")[0];

  const parts = rawPath
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);

  const ignored = new Set(["api", "admin", "teacher", "student", "parent"]);

  const clean = parts.filter((part) => !ignored.has(part.toLowerCase()));

  const firstMeaningful = clean.find((part) => !/^\d+$/.test(part)) || "system";
  const lastNumber = [...clean].reverse().find((part) => /^\d+$/.test(part));

  return {
    resource_type: firstMeaningful,
    resource_id: req.params?.id || lastNumber || req.body?.id || null,
  };
}

function safeBodySummary(body) {
  if (!body || typeof body !== "object") return {};

  const out = {};
  const blocked = new Set([
    "password",
    "password_hash",
    "new_password",
    "old_password",
    "confirm_password",
    "token",
    "authorization",
  ]);

  for (const [key, value] of Object.entries(body)) {
    if (blocked.has(key)) continue;

    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }

  return out;
}

export const autoActivityLogger = (req, res, next) => {
  if (req.method === "GET" || req.method === "OPTIONS") return next();

  const bodySnapshot = safeBodySummary(req.body);

  res.on("finish", async () => {
    try {
      if (res.locals.skipAutoLog) return;
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!req.user?.school_id || !req.user?.id) return;

      const action = actionFromMethod(req.method);
      const { resource_type, resource_id } = getResourceFromPath(req);

      const actorName = req.user?.name || req.user?.username || "مستخدم";
      const description = `${actorName} ${actionArabic(action)} في قسم ${resource_type}${
        resource_id ? ` على السجل رقم ${resource_id}` : ""
      }`;

      await logActivity({
        req,
        action,
        resource_type,
        resource_id,
        entity_type: resource_type,
        entity_id: resource_id,
        description,
        details: {
          source: "auto",
          body: bodySnapshot,
        },
        path: req.originalUrl || req.url,
        method: req.method,
        status_code: res.statusCode,
      });
    } catch (err) {
      console.warn("autoActivityLogger warning:", err.message);
    }
  });

  next();
};

export default autoActivityLogger;