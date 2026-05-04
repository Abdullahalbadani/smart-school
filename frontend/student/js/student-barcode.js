(function () {
  "use strict";
  if (window.__STUDENT_BARCODE_LOADED__) return;
  window.__STUDENT_BARCODE_LOADED__ = true;

  const $ = (id) => document.getElementById(id);

  const API_BASE = String(
    window.API_BASE || localStorage.getItem("API_BASE") || "http://127.0.0.1:5000"
  ).replace(/\/+$/, "");

  function normalizeUrl(url) {
    const u = String(url || "");
    if (!u) return u;
    if (u.startsWith("/")) return API_BASE + u;
    return u;
  }

  async function apiGet(url) {
    const finalUrl = normalizeUrl(url);

    if (typeof window.apiFetch === "function") {
      return window.apiFetch(finalUrl, { method: "GET" });
    }

    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("ACCESS_TOKEN") ||
      localStorage.getItem("AUTH_TOKEN") ||
      "";

    const r = await fetch(finalUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(txt || ("HTTP " + r.status));
    }
    return r.json();
  }

  function setMsg(text) {
    const box = $("st-barcode-msg");
    if (box) box.textContent = text || "—";
  }

  function showImg(id, dataUrlOrUrl) {
    const img = $(id);
    if (!img) return;
    img.src = dataUrlOrUrl;
    img.style.display = "block";
  }

  // تحميل QR+Barcode من السيرفر
  async function loadStudentCodes() {
    try {
      setMsg("جاري تحميل الباركود...");
      const data = await apiGet("/api/student/barcode");

      // يتوقع يرجع:
      // { token, expiresIn, qrDataUrl, barcodeDataUrl, studentNumberMasked }
      if (data.qrDataUrl) showImg("st-qr-img", data.qrDataUrl);
      if (data.barcodeDataUrl) showImg("st-barcode-img", data.barcodeDataUrl);

      const meta = $("st-barcode-meta");
      if (meta) {
        const exp = Number(data.expiresIn || 0);
        meta.textContent = exp
          ? `هذا الرمز يتحدث تلقائياً. صلاحية الرمز: ${exp} ثانية.`
          : `تم التحميل.`;
      }

      setMsg("جاهز للمسح ✅");

    } catch (e) {
      console.error("barcode ui error:", e);
      setMsg("تعذر تحميل الباركود. تأكد من تشغيل السيرفر وتسجيل الدخول.");
    }
  }

  // يحدث كل 45 ثانية (قبل انتهاء 60 ثانية)
  let __timer = null;
  function startAutoRefresh() {
    if (__timer) clearInterval(__timer);
    __timer = setInterval(() => {
      loadStudentCodes().catch(() => {});
    }, 45000);
  }

  function wire() {

document.getElementById("st-barcode-print")?.addEventListener("click", () => {
  const qr = document.getElementById("st-qr-img")?.src || "";
  const bc = document.getElementById("st-barcode-img")?.src || "";

  const w = window.open("", "_blank");
  if (!w) return;

  w.document.write(`
    <html dir="rtl">
    <head>
      <title>بطاقة الطالب</title>
      <style>
        body{font-family:Arial; padding:24px; text-align:center;}
        .card{border:1px solid #ddd; border-radius:16px; padding:18px; display:inline-block;}
        img{display:block; margin:10px auto; background:#fff; padding:10px; border-radius:12px;}
        .row{display:flex; gap:18px; justify-content:center; flex-wrap:wrap;}
      </style>
    </head>
    <body>
      <div class="card">
        <h2>بطاقة الطالب</h2>
        <div class="row">
          <div>
            <div>QR</div>
            <img src="${qr}" style="width:240px;height:240px;" />
          </div>
          <div>
            <div>Barcode</div>
            <img src="${bc}" style="width:520px;height:auto;" />
          </div>
        </div>
        <p style="margin-top:10px;">ملاحظة: الرمز يتحدث تلقائياً، للطباعة استخدم نسخة ثابتة من الإدارة لاحقاً.</p>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  w.document.close();
});



    // نفس أسلوب فتح المودال عندك (card[data-modal])
    const card = document.querySelector('.card[data-modal="modal-barcode"]');
    if (card) {
      card.addEventListener("click", () => {
        setTimeout(() => {
          loadStudentCodes().catch(() => {});
          startAutoRefresh();
        }, 0);
      });
    }

    // إذا كان عندك طريقة أخرى لفتح المودال، فقط نادِ loadStudentCodes()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
