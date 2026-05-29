document.getElementById('schoolRegisterForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.innerText = 'جاري الإنشاء ورفع البيانات...';

    // استخدام FormData بدلاً من JSON لدعم رفع الصور
    const formData = new FormData();
    formData.append('schoolNameAr', document.getElementById('schoolNameAr').value);
    formData.append('schoolNameEn', document.getElementById('schoolNameEn').value);
    formData.append('slug', document.getElementById('slug').value);
    formData.append('code', document.getElementById('code').value);
    formData.append('schoolPhone', document.getElementById('schoolPhone').value);
    formData.append('schoolEmail', document.getElementById('schoolEmail').value);
    
    formData.append('adminName', document.getElementById('adminName').value);
    formData.append('adminUsername', document.getElementById('adminUsername').value);
    formData.append('adminEmail', document.getElementById('adminEmail').value);
    formData.append('password', document.getElementById('password').value);
    formData.append('confirmPassword', document.getElementById('confirmPassword').value);

    // إضافة ملف الصورة إذا اختاره المستخدم
    const logoFile = document.getElementById('schoolLogo').files[0];
    if (logoFile) {
        formData.append('logo', logoFile);
    }

    try {
        const response = await fetch('/api/public/register-school', {
            method: 'POST',
            // ⚠️ ملاحظة: عند استخدام FormData لا نكتب Content-Type، المتصفح يضعها تلقائياً
            body: formData
        });

        const result = await response.json();

  if (response.ok) {
    alert('تم تسجيل مدرستك بنجاح!');

    const slug = document.getElementById('slug').value.trim().toLowerCase();
    localStorage.setItem("school_slug", slug);
    const loginUrl = `/frontend/login/login.html?school=${encodeURIComponent(slug)}`;

    window.location.replace(loginUrl);
}else {
            if (result.details && Array.isArray(result.details)) {
                alert("فشل التحقق من البيانات:\n- " + result.details.join("\n- "));
            } else {
                alert(result.message || 'حدث خطأ غير معروف');
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('فشل الاتصال بالسيرفر');
    } finally {
        btn.disabled = false;
        btn.innerText = 'تسجيل المدرسة والبدء';
    }
});