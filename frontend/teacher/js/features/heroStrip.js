// frontend/teacher/js/features/heroStrip.js
(function () {
  "use strict";

  /* =====================
     Config / Helpers
  ====================== */
  const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

  const TT_LS_YEAR = "TT_YEAR_ID";
  const TT_LS_TERM = "TT_TERM";

  const $ = (id) => document.getElementById(id);

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function httpGet(path) {
    // لو عندك core/api.js يعرّف apiGet، نستعمله
    if (typeof window.apiGet === "function") {
      const r = await window.apiGet(path);
      return r?.data ?? r;
    }

    // fallback آمن
    const url = path.startsWith("http") ? path : API_BASE + path;
    const res = await fetch(url, { headers: { ...authHeaders() } });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const payload = ct.includes("application/json") ? await res.json() : await res.text();

    if (!res.ok) {
      const msg = payload?.message || (typeof payload === "string" ? payload : "") || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return payload?.data ?? payload;
  }

  function getYearTerm() {
    const academicYearId = Number(localStorage.getItem(TT_LS_YEAR) || 0);
    const term = Number(localStorage.getItem(TT_LS_TERM) || 0);
    return { academicYearId, term };
  }

  function minutesUntilHHMMSS(hhmmss) {
    const parts = String(hhmmss || "").split(":").map(Number);
    if (!Number.isFinite(parts[0])) return null;

    const now = new Date();
    const target = new Date(now);
    target.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);

    return Math.round((target - now) / 60000);
  }

  function humanAfter(mins) {
    if (mins === null) return "—";
    if (mins <= 0) return "الآن";
    if (mins === 1) return "بعد دقيقة";
    if (mins === 2) return "بعد دقيقتين";
    if (mins <= 10) return `بعد ${mins} دقائق`;
    return `بعد ${mins} دقيقة`;
  }

  function safeSet(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  /* =====================
     Weather Mood (UI only)
  ====================== */
  function setMood() {
    const h = new Date().getHours();

    let main = "طقس جميل اليوم";
    let sub = "يوم مناسب للإنجاز ✨";
    let badge = "مزاج جيد";

    if (h >= 5 && h < 11) {
      main = "صباح لطيف 🌤️";
      sub = "ابدأ يومك بخفة";
      badge = "صباح";
    } else if (h >= 11 && h < 16) {
      main = "نهار هادئ 🌤️";
      sub = "خليك على نفس الوتيرة";
      badge = "نهار";
    } else if (h >= 16 && h < 20) {
      main = "مساء جميل 🌥️";
      sub = "رتّب حصصك بهدوء";
      badge = "مساء";
    } else {
      main = "ليل هادئ 🌙";
      sub = "ختم يومك بأمان";
      badge = "ليل";
    }

    safeSet("weather-main", main);
    safeSet("weather-sub", sub);
    safeSet("weather-badge", badge);
  }

  /* =====================
     Load Hero (real data)
  ====================== */
  async function loadHero() {
    const { academicYearId, term } = getYearTerm();
    if (!academicYearId || !term) return; // بدون أرقام وهمية

    const q = `?academicYearId=${encodeURIComponent(academicYearId)}&term=${encodeURIComponent(term)}`;
    const data = await httpGet(`/teacher/dashboard/hero${q}`);

    const name = data?.teacher_name || "المعلّم";
    safeSet("hero-greeting", `مرحبًا أ. ${name}، هذا ملخص يومك التدريسي.`);
safeSet("teacher-name-pill", `أ. ${name}`);

    if (Number.isFinite(data?.today_lessons)) safeSet("today-lessons", `${data.today_lessons} حصص`);
    if (Number.isFinite(data?.current_sections)) safeSet("current-sections", `${data.current_sections} شعب`);
  }

  /* =====================
     Load Next Lesson (real data)
  ====================== */
  async function loadNextLesson() {
    const { academicYearId, term } = getYearTerm();
    if (!academicYearId || !term) return;

    const q = `?academicYearId=${encodeURIComponent(academicYearId)}&term=${encodeURIComponent(term)}`;
    const x = await httpGet(`/teacher/dashboard/next-lesson${q}`);

    // إذا فاضي => لا يوجد شيء قادم/حالي
    if (!x || (!x.start_time && x.sort_order == null)) {
      safeSet("next-lesson-main", "لا توجد حصة قادمة اليوم");
      safeSet("next-lesson-sub", "—");
      safeSet("next-lesson-badge", "—");
      return;
    }

    // mode قد يرجع: current / next (حسب الباك اند اللي أعطيتك)
    const mode = x.mode || "next";

    if (x.start_time) {
      const mins = minutesUntilHHMMSS(x.start_time);
      safeSet("next-lesson-main", mode === "current" ? "أنت الآن في الحصة" : `لديك حصة ${humanAfter(mins)}`);
      safeSet("next-lesson-badge", String(x.start_time).slice(0, 5));
    } else {
      safeSet("next-lesson-main", "الحصة التالية حسب الترتيب");
      safeSet("next-lesson-badge", `#${x.sort_order}`);
    }

    const subject = x.subject_name || "—";
    const section = x.section_label || "—";
    const room = x.room ? ` • قاعة ${x.room}` : "";
    safeSet("next-lesson-sub", `${subject} • ${section}${room}`);
  }
/* =====================
     Substitute Alerts (حصص الاحتياط)
  ====================== */
 /* =====================
     Substitute Alerts (حصص الاحتياط)
  ====================== */
  async function loadSubstituteAlerts() {
    const container = $("substitute-alerts-container");
    if (!container) return;

    try {
      // 1. جلب البيانات من المسار الصحيح
      const data = await httpGet("/teacher/permits/substitutions/pending");
      
      // 2. 🟢 هذا هو السطر الذي كان مفقوداً (تعريف المتغير items)
      const items = data?.items || (Array.isArray(data) ? data : []);

      if (items.length === 0) {
        container.innerHTML = "";
        return;
      }

      // 3. رسم البطاقات باستخدام المتغير items
      container.innerHTML = items.map(req => {
        const date = String(req.substitution_date).slice(0, 10);
        const subject = req.subject_name || "مادة غير محددة";
        const gradeSection = (req.grade_name || "") + " " + (req.section_name || "");

        return `
          <div style="background: var(--bg-card, #1e293b); border-right: 4px solid #3b82f6; border-radius: 8px; padding: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="display: flex; flex-direction: column; gap: 5px;">
              <div style="color: var(--text-main, #f8fafc); font-size: 1.1rem; font-weight: bold;">
                <i class="ri-notification-badge-line" style="color: #3b82f6;"></i> طلب تغطية حصة (احتياط)
              </div>
              <div style="color: var(--text-muted, #cbd5e1); font-size: 0.95rem; line-height: 1.5;">
                طلبت الإدارة منك تغطية <strong>${esc(req.period_name)} - ${esc(subject)}</strong> 
                للفصل <strong>${esc(gradeSection)}</strong>.
                <br>
                <small style="color: #94a3b8; display: inline-flex; gap: 10px; margin-top: 5px;">
                  <span><i class="ri-calendar-line"></i> التاريخ: <span style="direction:ltr; display:inline-block;">${date}</span></span>
                  <span><i class="ri-user-unfollow-line"></i> بدلاً من: ${esc(req.absent_teacher_name)}</span>
                </small>
              </div>
            </div>
            <div style="display: flex; gap: 10px;">
              <button onclick="respondToSubstitute(${req.substitution_id}, 'accepted')" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid #10b981; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;"><i class="ri-check-line"></i> موافق</button>
              <button onclick="respondToSubstitute(${req.substitution_id}, 'rejected')" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;"><i class="ri-close-line"></i> أعتذر</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      console.warn("loadSubstituteAlerts error:", e);
    }
  }

  // دالة إرسال الرد للإدارة
  window.respondToSubstitute = async function(subId, responseType) {
    const isAccepted = responseType === 'accepted';
    if(!confirm(isAccepted ? 'هل أنت متأكد من قبول هذه الحصة؟' : 'هل أنت متأكد من الاعتذار عن هذه الحصة؟')) return;
    
    try {
      // 🟢 المسار الصحيح مع كلمة permits
      const url = (window.API_BASE || "http://127.0.0.1:5000/api") + `/teacher/permits/substitutions/${subId}/respond`;
      const token = localStorage.getItem("token");

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {})
        },
        body: JSON.stringify({ response: responseType })
      });

      if (!res.ok) throw new Error("فشل إرسال الرد");

      alert(isAccepted ? "تم قبول الحصة بنجاح ✅" : "تم إرسال اعتذارك للإدارة ❌");
      loadSubstituteAlerts(); // تحديث البطاقة لإخفائها بعد الرد
    } catch (e) {
      alert("حدث خطأ أثناء إرسال الرد: " + e.message);
    }
  };

  // هيلبر بسيط للهروب من الأكواد الخبيثة
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /* =====================
     Init
  ====================== */
/* =====================
     Init
  ====================== */
/* =====================
     Init
  ====================== */
 /* =====================
     Init
  ====================== */
  async function initHeroStrip() {
    // لو الصفحة ما فيها العناصر، لا نسوي شيء
    if (!$("hero-greeting") && !$("today-lessons") && !$("next-lesson-main")) return;

    // mood فورًا
    setMood();
    setInterval(setMood, 60000);

    // بيانات حقيقية
    try { await loadHero(); } catch (e) { console.warn("heroStrip loadHero:", e); }
    try { await loadNextLesson(); } catch (e) { console.warn("heroStrip loadNextLesson:", e); }
    try { await loadSubstituteAlerts(); } catch (e) { console.warn("heroStrip loadSubstituteAlerts:", e); }

    // ⚡ السحر الحي (Socket.io) - التحديث الفوري للبطاقات بدون Refresh
    if (typeof io !== "undefined") {
      // 🟢 نحدد الرابط الصافي للسيرفر لتجنب أي تعارض
      const socket = io("http://127.0.0.1:5000");
      
      socket.on("connect", () => {
        console.log("🟢 [Socket] متصل بالسيرفر الحي بنجاح!");
      });

      // عندما يرسل المدير تكليفاً جديداً، نستقبل الإشارة هنا
      socket.on("refresh_substitutions", () => {
        console.log("⚡ [Socket] إشعار جديد من الإدارة! جاري إظهار البطاقة...");
        // ⏳ السحر هنا: نضع تأخير زمني (نصف ثانية) لتتأكد قاعدة البيانات من إغلاق الحفظ
        setTimeout(loadSubstituteAlerts, 500); 
      });
    } else {
      console.warn("⚠️ [Socket] مكتبة Socket.io لم يتم تحميلها في الـ HTML!");
    }
  }

  document.addEventListener("DOMContentLoaded", initHeroStrip);
})();



  // ربط الدالة بحدث تحميل الصفحة

