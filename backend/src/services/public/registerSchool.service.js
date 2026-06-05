import bcrypt from 'bcrypt';
import { pool } from '../../config/db.js';

// --- وظائف مساعدة (Helpers) ---

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ✅ 1. دالة توليد الأدوار الأساسية لأي مدرسة جديدة
async function seedDefaultRoles(client, schoolId) {
  const defaultRoles = [
    { name: 'admin', desc: 'مدير النظام العام' },
    { name: 'school_admin', desc: 'مدير المدرسة' },
    { name: 'teacher', desc: 'معلم' },
    { name: 'student', desc: 'طالب' },
    { name: 'parent', desc: 'ولي أمر' }
  ];

  for (const role of defaultRoles) {
    await client.query(
      `INSERT INTO roles (school_id, name, description) VALUES ($1, $2, $3)`,
      [schoolId, role.name, role.desc]
    );
  }
}

// ✅ 2. دالة منح جميع الصلاحيات لمدير المدرسة الجديد تلقائياً
async function grantAllPermissionsToSchoolAdmin(client, schoolId) {
  // جلب رقم الدور الذي تم إنشاؤه للتو لهذه المدرسة
  const roleRes = await client.query(
    "SELECT id FROM roles WHERE school_id = $1 AND name = 'school_admin' LIMIT 1",
    [schoolId]
  );
  
  if (roleRes.rowCount > 0) {
    const roleId = roleRes.rows[0].id;
    
    // ربط هذا الدور بكل الصلاحيات الموجودة في جدول permissions العام
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions`,
       [roleId]
    );
  }
}

// ✅ 3. دالة التحقق المحدثة بالحقول الأربعة الجديدة
function validateRegisterSchoolInput(payload) {
  const errors = [];

  const schoolNameAr = String(payload.schoolNameAr || '').trim();
  const schoolNameEn = String(payload.schoolNameEn || '').trim();
  const slug = normalizeSlug(payload.slug);
  const code = String(payload.code || '').trim();
  const schoolPhone = String(payload.schoolPhone || '').trim();
  const schoolEmail = String(payload.schoolEmail || '').trim().toLowerCase();
  
  // لقط الحقول الجغرافية المتفق عليها
  const country = String(payload.country || '').trim();
  const city = String(payload.city || '').trim();
  const address = String(payload.address || '').trim();
  const logoUrl = String(payload.logoUrl || '').trim();

  const adminName = String(payload.adminName || '').trim();
  const adminUsername = String(payload.adminUsername || '').trim().toLowerCase();
  const adminEmail = String(payload.adminEmail || '').trim().toLowerCase();
  const adminPhone = String(payload.adminPhone || '').trim();
  const password = String(payload.password || '');
  const confirmPassword = String(payload.confirmPassword || '');

  // شروط التحقق القياسية
  if (!schoolNameAr) errors.push('اسم المدرسة بالعربي مطلوب');
  if (!slug) errors.push('Slug المدرسة مطلوب');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    errors.push('Slug يجب أن يحتوي حروفًا إنجليزية صغيرة وأرقامًا وشرطات فقط');
  }
  if (!code) errors.push('كود المدرسة مطلوب');

  // التحقق الإلزامي من الحقول الجغرافية المضافة للهيكل الهندسي
  if (!country) errors.push('الدولة مطلوبة');
  if (!city) errors.push('المدينة مطلوبة');
  if (!address) errors.push('العنوان التفصيلي للمدرسة مطلوب');

  // التحقق من بيانات المدير
  if (!adminName) errors.push('اسم الأدمن مطلوب');
  if (!adminUsername) errors.push('اسم المستخدم مطلوب');
  if (!adminEmail) errors.push('بريد الأدمن مطلوب');
  if (!adminPhone) errors.push('رقم هاتف المدير الشخصي مطلوب');

  if (!password) errors.push('كلمة المرور مطلوبة');
  if (password.length < 8) errors.push('كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (password !== confirmPassword) errors.push('تأكيد كلمة المرور غير مطابق');

  if (errors.length) {
    const error = new Error('Validation failed');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    error.details = errors;
    throw error;
  }

  return {
    schoolNameAr,
    schoolNameEn: schoolNameEn || null,
    slug,
    code,
    schoolPhone: schoolPhone || null,
    schoolEmail: schoolEmail || null,
    country,
    city,
    address,
    logoUrl: logoUrl || null,
    adminName,
    adminUsername,
    adminEmail,
    adminPhone,
    password,
  };
}

// ✅ 4. خدمة تسجيل المدرسة المحدثة والمطابقة بالكامل لقاعدة البيانات
export async function registerSchoolService(payload) {
  const data = validateRegisterSchoolInput(payload);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. فحص وجود المدرسة مسبقاً
    const schoolExistsQuery = `SELECT id FROM schools WHERE slug = $1 OR code = $2 LIMIT 1`;
    const schoolExistsResult = await client.query(schoolExistsQuery, [data.slug, data.code]);

    if (schoolExistsResult.rowCount > 0) {
      const error = new Error('رابط المدرسة أو الكود مستخدم مسبقاً');
      error.statusCode = 409;
      error.code = 'SCHOOL_ALREADY_EXISTS';
      throw error;
    }

    // 2. إدخال المدرسة الجديدة شاملة المدينة والدولة
    const insertSchoolQuery = `
      INSERT INTO schools (
        name_ar, name_en, slug, code, phone, email, address, logo_url,
        city, country, timezone, currency_code, subscription_status, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Asia/Aden', 'YER', 'trial', TRUE)
      RETURNING id, name_ar, slug
    `;

    const schoolResult = await client.query(insertSchoolQuery, [
      data.schoolNameAr, data.schoolNameEn, data.slug, data.code,
      data.schoolPhone, data.schoolEmail, data.address, data.logoUrl,
      data.city, data.country // حقن الحقول الجديدة في استعلام الـ SQL
    ]);

    const school = schoolResult.rows[0];

    // 3. إنشاء إعدادات المدرسة الافتراضية
    const insertSettingsQuery = `
      INSERT INTO school_settings (
        school_id, default_language, grading_scale, pass_mark, attendance_policy, 
        invoice_prefix, student_code_prefix, week_start_day, allow_parent_portal, allow_teacher_portal
      )
      VALUES ($1, 'ar', '100', 50.00, 'daily', 'INV', 'STD', 6, TRUE, TRUE)
    `;
    await client.query(insertSettingsQuery, [school.id]);

    // 4. توليد الأدوار الأساسية للمدرسة
    await seedDefaultRoles(client, school.id);

    // 5. منح مدير المدرسة جميع الصلاحيات تلقائياً
    await grantAllPermissionsToSchoolAdmin(client, school.id);

    // 6. إنشاء حساب الأدمن للمدرسة وحفظ هاتف المدير بشكل إلزامي
    const passwordHash = await bcrypt.hash(data.password, 12);
    const insertUserQuery = `
      INSERT INTO users (
        school_id, name, email, username, phone, password_hash, status, created_at, updated_at, token_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW(), 0)
      RETURNING id
    `;

    const userResult = await client.query(insertUserQuery, [
      school.id, data.adminName, data.adminEmail, data.adminUsername, data.adminPhone, passwordHash
    ]);

    const user = userResult.rows[0];

    // 7. جلب الـ ID الخاص بدور school_admin لربطه بالأدمن
    const roleQuery = `
      SELECT id FROM roles WHERE school_id = $1 AND name = 'school_admin' LIMIT 1
    `;
    const roleResult = await client.query(roleQuery, [school.id]);
    const roleId = roleResult.rows[0].id;

    // 8. تعيين الدور للمستخدم داخل نفس المدرسة
    await client.query(
      `INSERT INTO user_roles (school_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [school.id, user.id, roleId]
    );

    await client.query('COMMIT');

    return { school, admin: user };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Register School Error:", error.message);
    throw error;
  } finally {
    client.release();
  }
}