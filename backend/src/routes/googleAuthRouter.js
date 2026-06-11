import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { logAudit } from '../utils/auditLogger.js';

const router = Router();

// دالة مساعدة لتهيئة العميل
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// 🟢 1. مسار التوجيه إلى صفحة جوجل الرسمية لمنح الصلاحيات
router.get('/google', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send('غير مصرح: التوكن مفقود');

    // فك تشفير التوكن لمعرفة من هي المدرسة التي تطلب الربط الآن
    // (استبدل JWT_SECRET بمتغير البيئة الخاص بك في مشروعك)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
const schoolId = Number(
  decoded.school_id ??
  decoded.schoolId
);

if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
  return res.status(401).send('غير مصرح: رقم المدرسة غير صالح');
}

const oauthState = jwt.sign(
  {
    schoolId,
    userId: decoded.id || decoded.user_id || null
  },
  process.env.GOOGLE_OAUTH_STATE_SECRET,
  {
    expiresIn: '10m',
    issuer: 'smart-school',
    audience: 'google-drive-link'
  }
);
    const oauth2Client = getOAuth2Client();

    // توليد رابط التحقق مع طلب صلاحية الوصول للملفات وطلب التوكن الدائم (offline)
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // إلزامي للحصول على الـ Refresh Token الثابت للرفع التلقائي
      prompt: 'consent select_account',    // إجبار قوقل على إظهار شاشة الموافقة لتوليد التوكن
      scope: ['https://www.googleapis.com/auth/drive.file'], // الوصول فقط للملفات التي ينشئها سيستمك لحماية خصوصيتهم
state: oauthState
    });

    return res.redirect(authUrl);
  } catch (err) {
    console.error('Google Auth Init Error:', err.message);
    return res.status(500).send('حدث خطأ أثناء بدء الاتصال بسيرفرات جوجل');
  }
});

// 🟢 2. مسار الاستقبال (Callback URL) الذي يعود إليه المتصفح بعد موافقة العميل
router.get('/google/callback', async (req, res) => {
 const { code, state, error } = req.query;

if (error) {
  return res.redirect(
    `/frontend/admin/index.html?tab=backups&status=error&msg=${encodeURIComponent(String(error))}`
  );
}

if (!code || !state) {
  return res.status(400).send('بيانات التحقق من جوجل غير مكتملة');
}

let schoolId;
let oauthUserId = null;

try {
  const decodedState = jwt.verify(
    String(state),
    process.env.GOOGLE_OAUTH_STATE_SECRET,
    {
      issuer: 'smart-school',
      audience: 'google-drive-link'
    }
  );

  schoolId = Number(decodedState.schoolId);
  oauthUserId = Number(decodedState.userId) || null;

  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    throw new Error('رقم المدرسة غير صالح');
  }
} catch {
  return res.status(400).send(
    'انتهت صلاحية طلب الربط أو أن بياناته غير صالحة. أعد المحاولة من داخل النظام.'
  );
}

  try {
    const oauth2Client = getOAuth2Client();
    
    // تبادل الشفرة المؤقتة بالتوكنات الدائمة من جوجل
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      throw new Error('لم يتم إرجاع Refresh Token. يرجى إلغاء الربط وإعادة المحاولة مجدداً.');
    }

    // تهيئة عميل الـ Drive لإنشاء مجلد معزول للمدرسة فوراً
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // جلب اسم المدرسة من الداتابيز لتسمية المجلد باسم منشأتهم بشكل احترافي
    const schoolRes = await pool.query('SELECT name_ar FROM schools WHERE id = $1', [schoolId]);
    const schoolName = schoolRes.rows[0]?.name_ar || `School_${schoolId}`;

    // إعداد بيانات المجلد الفريد للمستأجر
    const folderMetadata = {
      name: `منصتي التعليمية - نسخ احتياطي (${schoolName})`,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id'
    });

    const folderId = folder.data.id; // معرّف المجلد الفريد المشفر من جوجل

    // حفظ التوكن ومعرّف المجلد في جدول الإعدادات الخاص بهذه المدرسة
    await pool.query(
      `INSERT INTO backup_settings (school_id, google_drive_refresh_token, google_drive_folder_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (school_id) DO UPDATE 
       SET google_drive_refresh_token = EXCLUDED.google_drive_refresh_token,
           google_drive_folder_id = EXCLUDED.google_drive_folder_id,
           updated_at = NOW()`,
      [schoolId, tokens.refresh_token, folderId]
    );

    await logAudit({
      req,
      action: 'ACTIVATE',
      actionLabel: 'ربط Google Drive',
      module: 'backups',
      moduleLabel: 'النسخ الاحتياطية',
      tableName: 'backup_settings',
      description: `تم ربط النسخ الاحتياطية للمدرسة (${schoolName}) بحساب Google Drive`,
      newData: { google_drive_linked: true },
      metadata: { severity: 'sensitive', result: 'success' },
      eventKey: 'GOOGLE_DRIVE_LINK',
      statusCode: 200,
      schoolIdFallback: schoolId,
      userIdFallback: oauthUserId,
      userNameFallback: oauthUserId ? `المستخدم رقم ${oauthUserId}` : 'مستخدم المدرسة',
      userRoleFallback: 'school_user'
    });

    // 🎯 إعادة توجيه المستخدم لصفحة الإعدادات لوحة التحكم في الفرونت إند بنجاح
    // (قم بتحديث المسار النصي ليتطابق مع مجلدات العرض لديك)
return res.redirect('/frontend/admin/index.html?tab=backups&status=success');
  } catch (err) {
    console.error('Google OAuth Callback Error:', err.message);
return res.redirect(
  `/frontend/admin/index.html?tab=backups&status=error&msg=${encodeURIComponent(err.message)}`
);  }
});

export default router;