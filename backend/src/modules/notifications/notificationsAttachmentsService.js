// backend/src/modules/notifications/notificationsAttachmentsService.js
import fs from "fs";
import path from "path";
import { pool } from "../../config/db.js";

const PRIVATE_UPLOAD_DIR = path.resolve(process.cwd(), "storage", "private", "notifications");
const LEGACY_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "notifications");
const ALLOWED_UPLOAD_DIRS = [PRIVATE_UPLOAD_DIR, LEGACY_UPLOAD_DIR];
fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });

function inferKindFromMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized === "application/pdf") return "pdf";
  return "file";
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isPathInsideAllowedUploadDirectory(absPath) {
  return ALLOWED_UPLOAD_DIRS.some(
    (root) => absPath === root || absPath.startsWith(`${root}${path.sep}`)
  );
}

function toDto(row) {
  const base = {
    id: Number(row.id),
    kind: row.kind,
    name: row.original_name || null,
    mime_type: row.mime_type || null,
    size_bytes: row.size_bytes ? Number(row.size_bytes) : null,
    created_at: row.created_at,
  };

  if (row.kind === "link") {
    return {
      ...base,
      url: row.link_url,
      label: row.link_label || row.link_url,
    };
  }

  return {
    ...base,
    view_url: `/api/notifications/attachments/${row.id}/view`,
    download_url: `/api/notifications/attachments/${row.id}/download`,
  };
}

export async function createAttachmentsForNotification({
  notificationId,
  files = [],
  links = [],
  schoolId,
}) {
  const normalizedSchoolId = Number(schoolId);
  const normalizedNotificationId = Number(notificationId);
  if (!Number.isInteger(normalizedSchoolId) || normalizedSchoolId <= 0) {
    throw new Error("schoolId مطلوب لإنشاء المرفقات");
  }
  if (!Number.isInteger(normalizedNotificationId) || normalizedNotificationId <= 0) {
    throw new Error("notificationId غير صالح");
  }

  const preparedFiles = [];
  for (const file of files || []) {
    const absPath = path.resolve(file.path || "");
    if (!isPathInsideAllowedUploadDirectory(absPath) || !fs.existsSync(absPath)) {
      throw new Error("مسار مرفق غير صالح");
    }
    preparedFiles.push({ file, absPath });
  }

  const preparedLinks = [];
  for (const link of links || []) {
    const url = String(link?.url || "").trim();
    if (!url) continue;
    if (!isSafeExternalUrl(url)) throw new Error("رابط المرفق غير صالح");
    preparedLinks.push({
      url,
      label: String(link?.label || "").trim().slice(0, 255) || null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const notificationCheck = await client.query(
      `SELECT id
       FROM notifications
       WHERE id = $1 AND school_id = $2
       LIMIT 1`,
      [normalizedNotificationId, normalizedSchoolId]
    );
    if (!notificationCheck.rowCount) throw new Error("الإشعار غير موجود في المدرسة الحالية");

    const created = [];
    for (const { file, absPath } of preparedFiles) {
      const { rows } = await client.query(
        `INSERT INTO notification_attachments
         (school_id, notification_id, kind, original_name, mime_type, size_bytes, storage_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          normalizedSchoolId,
          normalizedNotificationId,
          inferKindFromMime(file.mimetype),
          String(file.originalname || "").slice(0, 255) || null,
          String(file.mimetype || "").slice(0, 150) || null,
          Number(file.size) || null,
          path.relative(process.cwd(), absPath),
        ]
      );
      created.push(toDto(rows[0]));
    }

    for (const link of preparedLinks) {
      const { rows } = await client.query(
        `INSERT INTO notification_attachments
         (school_id, notification_id, kind, link_url, link_label)
         VALUES ($1,$2,'link',$3,$4)
         RETURNING *`,
        [normalizedSchoolId, normalizedNotificationId, link.url, link.label]
      );
      created.push(toDto(rows[0]));
    }

    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAttachmentsForNotificationIds(notificationIds = [], schoolId) {
  const normalizedSchoolId = Number(schoolId);
  if (!Number.isInteger(normalizedSchoolId) || normalizedSchoolId <= 0) return new Map();

  const ids = [...new Set((notificationIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];

  const map = new Map();
  if (!ids.length) return map;

  const { rows } = await pool.query(
    `SELECT a.*
     FROM notification_attachments a
     JOIN notifications n
       ON n.id = a.notification_id
      AND n.school_id = a.school_id
     WHERE a.notification_id = ANY($1::bigint[])
       AND a.school_id = $2
       AND n.school_id = $2
     ORDER BY a.id ASC`,
    [ids, normalizedSchoolId]
  );

  for (const row of rows) {
    const notificationId = Number(row.notification_id);
    if (!map.has(notificationId)) map.set(notificationId, []);
    map.get(notificationId).push(toDto(row));
  }

  return map;
}

export async function getAttachmentForServing({ attachmentId, userId, schoolId }) {
  const normalizedAttachmentId = Number(attachmentId);
  const normalizedUserId = Number(userId);
  const normalizedSchoolId = Number(schoolId);
  if (
    !Number.isInteger(normalizedAttachmentId) || normalizedAttachmentId <= 0 ||
    !Number.isInteger(normalizedUserId) || normalizedUserId <= 0 ||
    !Number.isInteger(normalizedSchoolId) || normalizedSchoolId <= 0
  ) return null;

  const { rows } = await pool.query(
    `SELECT a.*, n.sender_user_id
     FROM notification_attachments a
     JOIN notifications n
       ON n.id = a.notification_id
      AND n.school_id = a.school_id
     WHERE a.id = $1
       AND a.school_id = $2
       AND n.school_id = $2
     LIMIT 1`,
    [normalizedAttachmentId, normalizedSchoolId]
  );

  const row = rows[0];
  if (!row) return null;

  const isSender = Number(row.sender_user_id) === normalizedUserId;
  const recipientCheck = await pool.query(
    `SELECT 1
     FROM notification_recipients
     WHERE notification_id = $1
       AND recipient_user_id = $2
       AND school_id = $3
     LIMIT 1`,
    [row.notification_id, normalizedUserId, normalizedSchoolId]
  );
  const isRecipient = recipientCheck.rowCount > 0;
  if (!isSender && !isRecipient) return { ...row, _forbidden: true };

  if (row.kind === "link") {
    return isSafeExternalUrl(row.link_url)
      ? { ...row, _isLink: true }
      : { ...row, _forbidden: true };
  }

  const absPath = path.resolve(process.cwd(), row.storage_path || "");
  if (!isPathInsideAllowedUploadDirectory(absPath) || !fs.existsSync(absPath)) {
    return { ...row, _missing: true };
  }

  return { ...row, _absPath: absPath };
}
