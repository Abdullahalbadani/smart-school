import { google } from 'googleapis';
import fs from 'fs';
import { pool } from '../config/db.js';

// دالة مساعدة لتهيئة عميل الـ OAuth2 من بيئة النظام (.env)
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// 1. دالة الرفع السحابي للملف المادي لـ Google Drive
export async function uploadToGoogleDrive({ schoolId, filePath, fileName, refreshToken, folderId }) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const fileMetadata = {
    name: fileName,
    parents: folderId ? [folderId] : [] // توجيه الملف للمجلد المعزول الخاص بالمدرسة
  };

  const media = {
    mimeType: 'application/x-sql', // صيغة ملفات الـ Backup لقواعد البيانات
    body: fs.createReadStream(filePath)
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id'
  });

  return { fileId: response.data.id };
}

// 2. دالة الحذف السحابي للملف القديم من حساب المدرسة عند التدوير والتنظيف
export async function deleteFromGoogleDrive(schoolId, fileId) {
  // جلب الـ Refresh Token من الداتابيز لأن الدالة في الـ Executor تستدعيها برقم المدرسة فقط
  const { rows } = await pool.query(
    `SELECT google_drive_refresh_token FROM backup_settings WHERE school_id = $1`,
    [schoolId]
  );
  
  if (!rows.length || !rows[0].google_drive_refresh_token) {
    throw new Error('حساب Google Drive غير مرتبط أو التوكن مفقود للمدرسة');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: rows[0].google_drive_refresh_token });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // إرسال أمر الحذف المباشر إلى خوادم جوجل
  await drive.files.delete({
    fileId: fileId
  });
}