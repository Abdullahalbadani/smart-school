(() => {
  "use strict";

  const qs = (sel, root = document) => root.querySelector(sel);
  const API_BASE = window.__API_BASE__ || "http://127.0.0.1:5000";

  const getToken = () =>
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("token") ||
    "";

  const api = async (method, url) => {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(fullUrl, { method, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  };

  const fmtDT = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ar-EG");
  };

  // جعلنا الدالة عامة لكي يسهل استدعاؤها
  window.loadParentActivities = async () => {
    const childId = qs("#selChild")?.value;
    const acList = qs("#acList");

    if (!acList) return;

    if (!childId) {
      acList.innerHTML = `<div class="empty-state">الرجاء اختيار الابن أولاً من أعلى الشاشة.</div>`;
      return;
    }

    acList.innerHTML = `<div class="muted-box"><i class="ri-loader-4-line ri-spin"></i> جاري تحميل أنشطة وواجبات الابن...</div>`;

    try {
      // هذا هو مسار الباك إند الذي أعطيتك إياه في الرسالة السابقة
      const data = await api("GET", `/api/parent/children/${childId}/activities`);
      const items = Array.isArray(data?.items) ? data.items : [];

      if (items.length === 0) {
        acList.innerHTML = `<div class="empty-state">لا توجد أنشطة أو اختبارات حالية لهذا الابن.</div>`;
        return;
      }

      let html = `<div style="display:flex; flex-direction:column; gap:1rem;">`;

      items.forEach(item => {
        let statusBadge = '';
        if (item.student_status === "graded") statusBadge = `<span class="ss-badge ss-badge--success">تم التصحيح</span>`;
        else if (item.student_status === "submitted") statusBadge = `<span class="ss-badge ss-badge--warning">تم التسليم</span>`;
        else if (item.student_status === "missed") statusBadge = `<span class="ss-badge ss-badge--danger">فات الموعد</span>`;
        else statusBadge = `<span class="ss-badge ss-badge--soft">بانتظار الحل</span>`;

        html += `
          <div style="padding: 1.2rem; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--bg-surface, #1e293b);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem;">
              <div>
                <strong style="font-size: 1.1rem; color: var(--color-primary); display:block;">${item.title}</strong>
                <small style="color: var(--color-muted);">مادة: ${item.subject_name || "—"} | المعلم: ${item.teacher_name || "—"}</small>
              </div>
              ${statusBadge}
            </div>

            <div style="font-size: 0.95rem; margin-bottom: 1rem; color: var(--color-text);">
              <strong>آخر موعد للتسليم:</strong> <span dir="ltr">${fmtDT(item.due_at)}</span>
            </div>
        `;

        if (item.student_status === "graded" && item.score !== null) {
          html += `
            <div class="ss-banner ss-banner--success" style="padding: 1rem; background: rgba(16, 185, 129, 0.1); border-right: 4px solid #10b981; border-radius: 4px;">
              <strong style="display:block; font-size: 1.1rem; color: #10b981;">النتيجة: ${item.score} / ${item.max_score}</strong>
              ${item.feedback ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.95rem;">ملاحظة المعلم: ${item.feedback}</p>` : ''}
            </div>
          `;
        }

        html += `</div>`;
      });

      html += `</div>`;
      acList.innerHTML = html;

    } catch (error) {
      acList.innerHTML = `<div class="empty-state" style="color: #ef4444;">حدث خطأ أثناء جلب البيانات: ${error.message}</div>`;
    }
  };

  // الاستماع لضغطة الكارت (البطاقة)
  document.addEventListener("DOMContentLoaded", () => {
    // التقاط بطاقة الأنشطة باستخدام data-modal
    const activityCard = document.querySelector('article[data-modal="modal-activities"]');
    
    if (activityCard) {
      activityCard.addEventListener("click", () => {
        // ننتظر أجزاء من الثانية حتى يفتح المودال الأساسي الخاص بـ parent.js ثم نحمل البيانات
        setTimeout(() => {
          window.loadParentActivities();
        }, 50);
      });
    }

    // تحديث البيانات إذا قام الأب بتغيير الابن أثناء فتح المودال
    const childSelect = document.getElementById("selChild");
    if (childSelect) {
      childSelect.addEventListener("change", () => {
        const modal = document.getElementById("modal-activities");
        if (modal && modal.classList.contains("is-open")) {
          window.loadParentActivities();
        }
      });
    }
  });

})();