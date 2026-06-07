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
    
    // الحقول الجغرافية الجديدة المتفق عليها للهيكل الهندسي
    formData.append('country', document.getElementById('country').value);
    formData.append('city', document.getElementById('city').value);
    formData.append('address', document.getElementById('schoolAddress').value);
    
    formData.append('adminName', document.getElementById('adminName').value);
    formData.append('adminUsername', document.getElementById('adminUsername').value);
    formData.append('adminEmail', document.getElementById('adminEmail').value);
    
    // الحقل الجديد لهاتف المدير الشخصي لتلبية شرط السيرفر
    formData.append('adminPhone', document.getElementById('adminPhone').value);
    
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
        body: formData
    });

    const result = await response.json();

    if (response.ok) {
        const school = result.school || result.data?.school;

        const slug = String(
            school?.slug ||
            document.getElementById('slug').value
        )
            .trim()
            .toLowerCase();

        if (!slug) {
            throw new Error(
                'تم إنشاء المدرسة، لكن لم يتم العثور على رابط المدرسة'
            );
        }

        const schoolName = String(
    school?.name_ar ||
    document.getElementById('schoolNameAr').value ||
    ''
).trim();

localStorage.setItem('school_slug', slug);
localStorage.setItem('school_name', schoolName);


        const schoolLoginUrl =
            `${window.location.origin}` +
            `/frontend/login/login.html?school=${encodeURIComponent(slug)}`;

        window.AppUI.toast(
            `تم تسجيل مدرستك بنجاح ✅ رابط الدخول: ${schoolLoginUrl}`,
            "success",
            { timeout: 2200 }
        );

        setTimeout(() => {
            window.location.replace(schoolLoginUrl);
        }, 900);
    } else {
        if (result.details && Array.isArray(result.details)) {
            await window.AppUI.alert({
                title: "تعذر إنشاء المدرسة",
                message: 'فشل التحقق من البيانات:\n- ' + result.details.join('\n- '),
                type: "danger",
            });
        } else {
            await window.AppUI.alert({
                title: "تعذر إنشاء المدرسة",
                message: result.message || "حدث خطأ غير معروف.",
                type: "danger",
            });
        }
    }
} catch (error) {
    console.error('Error:', error);
    await window.AppUI.alert({
        title: "تعذر الاتصال بالخادم",
        message: error.message || "فشل الاتصال بالخادم.",
        type: "danger",
    });
} finally {
    btn.disabled = false;
    btn.innerText = 'تسجيل المدرسة والبدء';
}
});