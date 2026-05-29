# patch-main-dialogs.ps1
# يشغل من داخل جذر المشروع: D:\smart-school-main
# يعدل frontend/admin/js/main.js لربط نوافذ الداشبورد مع AppUI بدل alert/prompt

$ErrorActionPreference = 'Stop'

$MainPath = Join-Path (Get-Location) 'frontend\admin\js\main.js'
if (!(Test-Path $MainPath)) {
  throw "لم أجد الملف: $MainPath`nشغل السكربت من جذر المشروع D:\smart-school-main"
}

$BackupPath = "$MainPath.bak-dialogs-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $MainPath $BackupPath -Force
Write-Host "تم إنشاء نسخة احتياطية:" $BackupPath -ForegroundColor Green

$code = Get-Content $MainPath -Raw -Encoding UTF8

$helpers = @'
function uiToast(message, type = "info") {
  if (window.AppUI?.toast) {
    window.AppUI.toast(message, type);
    return;
  }

  alert(message);
}

async function uiConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  return confirm(options?.message || "هل تريد المتابعة؟");
}

async function uiPrompt(options = {}) {
  if (window.AppUI?.prompt) {
    return await window.AppUI.prompt(options);
  }

  return prompt(options?.message || "اكتب الملاحظة", options?.defaultValue || "");
}
'@

if ($code -notmatch 'function\s+uiToast\s*\(') {
  $needle = @'
function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  return `${Number(value || 0).toLocaleString("ar-EG")}٪`;
}
'@

  if ($code.Contains($needle)) {
    $code = $code.Replace($needle, $needle + "`r`n" + $helpers + "`r`n")
  } else {
    throw "لم أجد دالة formatPercent لإضافة دوال النوافذ بعدها."
  }
}

function Replace-WindowFunction {
  param(
    [string]$Source,
    [string]$Name,
    [string]$Replacement
  )

  $pattern = "(?s)window\." + [regex]::Escape($Name) + "\s*=\s*async\s+function\s*\(id\)\s*\{.*?\n\};"
  $matches = [regex]::Matches($Source, $pattern)

  if ($matches.Count -eq 0) {
    Write-Host "تنبيه: لم أجد الدالة window.$Name" -ForegroundColor Yellow
    return $Source
  }

  # نستبدل أول نسخة بالنسخة الجديدة، ونحذف أي نسخة مكررة لاحقة.
  $firstDone = $false
  $result = [regex]::Replace($Source, $pattern, {
    param($m)
    if (-not $firstDone) {
      $script:firstDone = $true
      return $Replacement
    }
    return ""
  })

  return $result
}

$approveFee = @'
window.approveFeeAdjustmentRequest = async function (id) {
  const ok = await uiConfirm({
    title: "قبول طلب تعديل الرسوم",
    message:
      "سيتم تطبيق الخصم على عقد الرسوم والأقساط المتبقية.\nهذا الإجراء يؤثر على الحساب المالي للطالب.",
    confirmText: "تطبيق الخصم",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!ok) return;

  const adminNote = await uiPrompt({
    title: "ملاحظة الموافقة",
    message: "اكتب ملاحظة الموافقة على طلب تعديل الرسوم.",
    placeholder: "مثال: تمت الموافقة على الخصم بعد مراجعة الإدارة",
    defaultValue: "تمت الموافقة على تعديل الرسوم",
    confirmText: "قبول الطلب",
    cancelText: "إلغاء",
    type: "success",
    textarea: true,
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/fee-adjustment-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول طلب تعديل الرسوم");
    }

    uiToast(result.message || "تم قبول طلب تعديل الرسوم", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve fee adjustment request error:", error);
    uiToast(error.message || "تعذر قبول طلب تعديل الرسوم", "error");
  }
};
'@

$rejectFee = @'
window.rejectFeeAdjustmentRequest = async function (id) {
  const adminNote = await uiPrompt({
    title: "رفض طلب تعديل الرسوم",
    message: "اكتب سبب رفض طلب تعديل الرسوم.",
    placeholder: "مثال: المبلغ غير معتمد أو السبب غير كافٍ",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    type: "danger",
    textarea: true,
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/fee-adjustment-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض طلب تعديل الرسوم");
    }

    uiToast(result.message || "تم رفض طلب تعديل الرسوم", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject fee adjustment request error:", error);
    uiToast(error.message || "تعذر رفض طلب تعديل الرسوم", "error");
  }
};
'@

$approveTransfer = @'
window.approveStudentTransferRequest = async function (id) {
  const ok = await uiConfirm({
    title: "قبول طلب نقل الطالب",
    message:
      "سيتم تحديث قيد الطالب الدراسي ونقله إلى الصف أو الشعبة الجديدة.\nهل تريد تنفيذ النقل؟",
    confirmText: "قبول النقل",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!ok) return;

  const adminNote = await uiPrompt({
    title: "ملاحظة الموافقة",
    message: "اكتب ملاحظة الموافقة على نقل الطالب.",
    placeholder: "مثال: تمت الموافقة على النقل بعد مراجعة الإدارة",
    defaultValue: "تمت الموافقة على نقل الطالب",
    confirmText: "قبول الطلب",
    cancelText: "إلغاء",
    type: "success",
    textarea: true,
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/student-transfer-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول طلب النقل");
    }

    uiToast(result.message || "تم قبول طلب النقل", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve student transfer request error:", error);
    uiToast(error.message || "تعذر قبول طلب النقل", "error");
  }
};
'@

$rejectTransfer = @'
window.rejectStudentTransferRequest = async function (id) {
  const adminNote = await uiPrompt({
    title: "رفض طلب نقل الطالب",
    message: "اكتب سبب رفض طلب النقل.",
    placeholder: "مثال: لا يوجد مبرر كافٍ للنقل",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    type: "danger",
    textarea: true,
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/student-transfer-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض طلب النقل");
    }

    uiToast(result.message || "تم رفض طلب النقل", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject student transfer request error:", error);
    uiToast(error.message || "تعذر رفض طلب النقل", "error");
  }
};
'@

$approveReopen = @'
window.approveAssessmentReopenRequest = async function (id) {
  const ok = await uiConfirm({
    title: "قبول طلب إعادة فتح التقييم",
    message:
      "سيتم فتح التقييم للمعلم مؤقتًا حتى يستطيع تعديل الدرجات.\nهل تريد قبول هذا الطلب؟",
    confirmText: "قبول الطلب",
    cancelText: "إلغاء",
    type: "success",
  });

  if (!ok) return;

  const hoursValue = await uiPrompt({
    title: "مدة إعادة الفتح",
    message: "كم ساعة تريد إعادة فتح التقييم؟",
    placeholder: "مثال: 24",
    defaultValue: "24",
    confirmText: "متابعة",
    cancelText: "إلغاء",
    type: "info",
    required: true,
  });

  if (hoursValue === null) return;

  const adminNote = await uiPrompt({
    title: "ملاحظة الموافقة",
    message: "اكتب ملاحظة تظهر في سجل القرار.",
    placeholder: "مثال: تمت الموافقة لإصلاح خطأ التصحيح",
    defaultValue: "تمت الموافقة لإصلاح الدرجات",
    confirmText: "قبول الطلب",
    cancelText: "إلغاء",
    type: "success",
    textarea: true,
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/assessment-reopen-requests/${id}/approve`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
        reopen_hours: Number(hoursValue) || 24,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل قبول الطلب");
    }

    uiToast(result.message || "تم قبول طلب إعادة فتح التقييم", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Approve reopen request error:", error);
    uiToast(error.message || "تعذر قبول الطلب", "error");
  }
};
'@

$rejectReopen = @'
window.rejectAssessmentReopenRequest = async function (id) {
  const adminNote = await uiPrompt({
    title: "رفض طلب إعادة فتح التقييم",
    message: "اكتب سبب رفض الطلب.",
    placeholder: "مثال: لا يوجد مبرر كافٍ لإعادة الفتح",
    confirmText: "رفض الطلب",
    cancelText: "إلغاء",
    type: "danger",
    textarea: true,
    required: true,
    requiredMessage: "سبب الرفض مطلوب.",
  });

  if (adminNote === null) return;

  try {
    const response = await fetch(apiUrl(`/admin/assessment-reopen-requests/${id}/reject`), {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin_note: adminNote,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "فشل رفض الطلب");
    }

    uiToast(result.message || "تم رفض الطلب", "success");
    loadAdminHomeDashboard();
  } catch (error) {
    console.error("Reject reopen request error:", error);
    uiToast(error.message || "تعذر رفض الطلب", "error");
  }
};
'@

$code = Replace-WindowFunction $code 'approveFeeAdjustmentRequest' $approveFee
$code = Replace-WindowFunction $code 'rejectFeeAdjustmentRequest' $rejectFee
$code = Replace-WindowFunction $code 'approveStudentTransferRequest' $approveTransfer
$code = Replace-WindowFunction $code 'rejectStudentTransferRequest' $rejectTransfer
$code = Replace-WindowFunction $code 'approveAssessmentReopenRequest' $approveReopen
$code = Replace-WindowFunction $code 'rejectAssessmentReopenRequest' $rejectReopen

$oldIdle = @'
function logoutDueToIdle() {
  alert("تم تسجيل خروجك بسبب عدم النشاط للحفاظ على أمان البيانات.");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/frontend/login/login.html";
}
'@

$newIdle = @'
async function logoutDueToIdle() {
  if (window.AppUI?.alert) {
    await window.AppUI.alert({
      title: "انتهت الجلسة",
      message: "تم تسجيل خروجك بسبب عدم النشاط للحفاظ على أمان البيانات.",
      type: "warning",
      confirmText: "حسنًا",
    });
  } else {
    alert("تم تسجيل خروجك بسبب عدم النشاط للحفاظ على أمان البيانات.");
  }

  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/frontend/login/login.html";
}
'@

if ($code.Contains($oldIdle)) {
  $code = $code.Replace($oldIdle, $newIdle)
}

Set-Content -Path $MainPath -Value $code -Encoding UTF8
Write-Host "تم تعديل main.js بنجاح ✅" -ForegroundColor Green
Write-Host "الآن غيّر رقم نسخة main.js في index.html مثل: main.js?v=5 ثم Ctrl+F5" -ForegroundColor Cyan
