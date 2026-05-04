// backend/src/modules/notifications/notificationsAttachmentsService.js
import fs from "fs";
import path from "path";
import { pool } from "../../config/db.js";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "notifications");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function inferKindFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  return "file";
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
    return { ...base, url: row.link_url, label: row.link_label || row.link_url };
  }

  return {
    ...base,
    view_url: `/api/notifications/attachments/${row.id}/view`,
    download_url: `/api/notifications/attachments/${row.id}/download`,
  };
}

// ✅ إضافة schoolId كمعامل إجباري لربط المرفق بالمدرسة
export async function createAttachmentsForNotification({ notificationId, files = [], links = [], schoolId }) {
  if (!schoolId) throw new Error("schoolId مطلوب لإنشاء المرفقات");
  
  const created = [];

  // ملفات
  for (const f of files || []) {
    const { rows } = await pool.query(
      `INSERT INTO notification_attachments
       (school_id, notification_id, kind, original_name, mime_type, size_bytes, storage_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        schoolId, // 👈 التمرير الإجباري للمدرسة
        notificationId,
        inferKindFromMime(f.mimetype),
        f.originalname || null,
        f.mimetype || null,
        f.size || null,
        path.relative(process.cwd(), f.path),
      ]
    );
    created.push(toDto(rows[0]));
  }

  // روابط
  for (const l of links || []) {
    const url = String(l?.url || "").trim();
    if (!url) continue;

    const { rows } = await pool.query(
      `INSERT INTO notification_attachments
       (school_id, notification_id, kind, link_url, link_label)
       VALUES ($1,$2,'link',$3,$4)
       RETURNING *`,
      [schoolId, notificationId, url, String(l?.label || "").trim() || null] // 👈 التمرير الإجباري للمدرسة
    );
    created.push(toDto(rows[0]));
  }

  return created;
}

// ✅ إضافة schoolId لضمان عدم جلب مرفقات مدرسة أخرى بالخطأ
export async function getAttachmentsForNotificationIds(notificationIds = [], schoolId) {
  if (!schoolId) return new Map();

  const ids = (notificationIds || [])
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);

  const map = new Map();
  if (!ids.length) return map;

  const { rows } = await pool.query(
    `SELECT *
     FROM notification_attachments
     WHERE notification_id = ANY($1::bigint[])
       AND school_id = $2
     ORDER BY id ASC`,
    [ids, schoolId] // 👈 الحماية بالـ schoolId
  );

  for (const r of rows) {
    const nid = Number(r.notification_id);
    if (!map.has(nid)) map.set(nid, []);
    map.get(nid).push(toDto(r));
  }

  return map;
}

// ✅ صلاحية التحميل: التأكد أن المرفق ينتمي لنفس المدرسة، وأن المستخدم مستلم أو مرسل
export async function getAttachmentForServing({ attachmentId, userId, schoolId }) {
  if (!schoolId) return null;

  const { rows } = await pool.query(
    `SELECT a.*, n.sender_user_id
     FROM notification_attachments a
     JOIN notifications n ON n.id = a.notification_id
     WHERE a.id = $1 
       AND a.school_id = $2 
       AND n.school_id = $2
     LIMIT 1`,
    [attachmentId, schoolId] // 👈 لا يمكن الوصول لمرفق خارج نطاق المدرسة
  );

  const row = rows[0];
  if (!row) return null;
  if (row.kind === "link") return { ...row, _isLink: true };

  const isSender = row.sender_user_id && Number(row.sender_user_id) === Number(userId);

  const recipientCheck = await pool.query(
    `SELECT 1
     FROM notification_recipients
     WHERE notification_id = $1 
       AND recipient_user_id = $2 
       AND school_id = $3
     LIMIT 1`,
    [row.notification_id, userId, schoolId]
  );

  const isRecipient = recipientCheck.rowCount > 0;
  if (!isSender && !isRecipient) return { ...row, _forbidden: true };

  const abs = path.resolve(process.cwd(), row.storage_path || "");
  const allowedRoot = path.resolve(process.cwd(), "uploads", "notifications");
  if (!abs.startsWith(allowedRoot)) return { ...row, _forbidden: true };

  return { ...row, _absPath: abs };
}