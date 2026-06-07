/* frontend/login/login.js */
(function () {
  "use strict";

  console.log("login.js loaded ✅ with Auto-Slug support");

const API_BASE = "/api";
  const state = { inited: false };

  // --- دالة استخراج معرف المدرسة (Slug) من الرابط ---
// استخراج رابط المدرسة من:
// 1. query parameter
// 2. subdomain في بيئة الإنتاج
// 3. التخزين المحلي كحل احتياطي فقط
function getSchoolSlug() {
  const params = new URLSearchParams(window.location.search);

  const fromQuery = String(
    params.get("school") ||
    params.get("slug") ||
    ""
  )
    .trim()
    .toLowerCase();

  if (fromQuery) {
    localStorage.setItem("school_slug", fromQuery);
    return fromQuery;
  }

  const hostname = window.location.hostname.toLowerCase();
  const parts = hostname.split(".");

  // دعم روابط مثل:
  // september.localhost
  if (hostname.endsWith(".localhost") && parts[0]) {
    const fromLocalSubdomain = parts[0];
    localStorage.setItem("school_slug", fromLocalSubdomain);
    return fromLocalSubdomain;
  }

  // دعم روابط الإنتاج مثل:
  // september.example.com
  if (
    parts.length > 2 &&
    !hostname.endsWith(".onrender.com")
  ) {
    const fromSubdomain = parts[0];

    if (fromSubdomain && fromSubdomain !== "www") {
      localStorage.setItem("school_slug", fromSubdomain);
      return fromSubdomain;
    }
  }

  // حل احتياطي لتسهيل إعادة الدخول من المتصفح نفسه
  const fromStorage = String(
    localStorage.getItem("school_slug") || ""
  )
    .trim()
    .toLowerCase();

  if (fromStorage) {
    return fromStorage;
  }

  // لا تستخدم قيمة افتراضية وهمية
  return "";
}
function showSchoolLoginLink() {
  const slug = getSchoolSlug();

  // لا يمكن عرض رابط مدرسة إذا لم تكن المدرسة محددة
  if (!slug || !document.body) return;

  const existingBox = document.getElementById("school-login-link-box");

  // منع تكرار المربع عند تشغيل MutationObserver
  if (existingBox) return;

  const schoolName = String(
    localStorage.getItem("school_name") || ""
  ).trim();

  const schoolLoginUrl =
    `${window.location.origin}` +
    `/frontend/login/login.html?school=${encodeURIComponent(slug)}`;

  const box = document.createElement("div");
  box.id = "school-login-link-box";

  box.innerHTML = `
    <div style="
      font-weight: 800;
      font-size: 15px;
      margin-bottom: 6px;
      color: #0f172a;
    ">
      ${schoolName ? `مدرسة ${schoolName}` : `المدرسة: ${slug}`}
    </div>

    <div style="
      font-size: 12px;
      color: #475569;
      margin-bottom: 8px;
    ">
      رابط تسجيل الدخول الخاص بمدرستك
    </div>

    <a
      href="${schoolLoginUrl}"
      style="
        display: block;
        color: #0369a1;
        font-size: 12px;
        direction: ltr;
        word-break: break-all;
        text-decoration: underline;
        margin-bottom: 10px;
      "
    >
      ${schoolLoginUrl}
    </a>

    <button
      id="copy-school-login-link"
      type="button"
      style="
        border: none;
        border-radius: 8px;
        padding: 8px 14px;
        background: #0ea5e9;
        color: white;
        cursor: pointer;
        font-family: inherit;
        font-weight: 700;
      "
    >
      نسخ الرابط
    </button>
  `;

  Object.assign(box.style, {
    position: "fixed",
    left: "16px",
    bottom: "16px",
    zIndex: "99999",
    width: "min(360px, calc(100vw - 32px))",
    padding: "14px",
    borderRadius: "14px",
    background: "#ffffff",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
    border: "1px solid #e2e8f0",
    direction: "rtl",
    textAlign: "right"
  });

  document.body.appendChild(box);

  const copyButton = document.getElementById(
    "copy-school-login-link"
  );

  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(schoolLoginUrl);

      const oldText = copyButton.textContent;
      copyButton.textContent = "تم النسخ ✅";

      setTimeout(() => {
        copyButton.textContent = oldText;
      }, 1500);
    } catch {
      await window.AppUI.alert({
        title: "تعذر النسخ التلقائي",
        message: `انسخ الرابط يدويًا:\n${schoolLoginUrl}`,
        type: "info",
      });
    }
  });
}
  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function getRoleKeyFromUser(user) {
    const direct =
      (user && (user.role_key || user.roleKey || user.role_code || user.roleCode)) || "";
    if (direct) return String(direct).trim().toLowerCase();

    const name = (user && (user.role || user.role_name || user.roleName)) || "";
    const n = String(name).trim().toLowerCase();
   if (
  [
    "admin",
    "school_admin",
    "teacher",
    "student",
    "parent"
  ].includes(n)
) {
  return n;
}

    const id = Number(user && user.role_id);
    if (id === 1) return "admin";
    if (id === 2) return "teacher";
    if (id === 3) return "student";
    if (id === 4) return "parent";

    return "";
  }

 function dashboardUrlFor(roleKey) {
  if (roleKey === "teacher") {
    return "/frontend/teacher/index.html";
  }

  if (roleKey === "student") {
    return "/frontend/student/index.html";
  }

  if (roleKey === "parent") {
    return "/frontend/parent/index.html";
  }

  if (
    roleKey === "school_admin" ||
    roleKey === "admin"
  ) {
    return "/frontend/admin/index.html";
  }

  // للأدوار الإدارية المخصصة
  return "/frontend/admin/index.html";
}
  function goto(url) {
    console.log("تم الانتقال إلى", url);
    window.location.replace(url);
  }

  function saveSession(token, user) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user || {}));
  }

  function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

 function redirectIfAlreadyLoggedIn() {
  const token = localStorage.getItem("token");
  const user = safeJsonParse(
    localStorage.getItem("user") || ""
  );

  if (!token || !user) {
    return false;
  }

  const requestedSlug = getSchoolSlug();

  const sessionSlug = String(
    user.school_slug ||
    user.schoolSlug ||
    user.slug ||
    localStorage.getItem("school_slug") ||
    ""
  )
    .trim()
    .toLowerCase();

  // إذا فتح المستخدم رابط مدرسة مختلفة:
  // نحذف الجلسة القديمة ونتركه يسجل الدخول من جديد
  if (
    requestedSlug &&
    sessionSlug &&
    requestedSlug !== sessionSlug
  ) {
    clearSession();
    return false;
  }

  const roleKey = getRoleKeyFromUser(user);
  goto(dashboardUrlFor(roleKey));

  return true;
}

  function findLoginElements() {
    const form = $("#loginForm") || $("form");

    const email =
      $("#email") ||
      $("#loginEmail") ||
      $("#username") ||
      $("#loginUsername") ||
      $("input[type='email']") ||
      $("input[name='email']") ||
      $("input[name='username']") ||
      guessInputByPlaceholder(["بريد", "email", "اسم المستخدم", "username", "user"]);

    const password =
      $("#password") ||
      $("#loginPassword") ||
      $("input[type='password']") ||
      $("input[name='password']") ||
      guessInputByPlaceholder(["كلمة", "pass", "password"]);

    const submit =
      $("#loginBtn") ||
      $("#submitBtn") ||
      $("button[type='submit']") ||
      $("input[type='submit']") ||
      guessButtonByText(["تسجيل الدخول", "دخول", "login", "sign in"]);

    return { form, email, password, submit };
  }

  function guessInputByPlaceholder(words) {
    const inputs = $all("input");
    const w = words.map((x) => String(x).toLowerCase());
    return (
      inputs.find((i) => {
        const ph = String(i.getAttribute("placeholder") || "").toLowerCase();
        const aria = String(i.getAttribute("aria-label") || "").toLowerCase();
        const name = String(i.getAttribute("name") || "").toLowerCase();
        const id = String(i.id || "").toLowerCase();
        return w.some((k) => ph.includes(k) || aria.includes(k) || name.includes(k) || id.includes(k));
      }) || null
    );
  }

  function guessButtonByText(words) {
    const btns = $all("button");
    const w = words.map((x) => String(x).toLowerCase());
    return (
      btns.find((b) => {
        const t = String(b.textContent || "").trim().toLowerCase();
        const id = String(b.id || "").toLowerCase();
        const cls = String(b.className || "").toLowerCase();
        return w.some((k) => t.includes(k) || id.includes(k) || cls.includes(k));
      }) || null
    );
  }

  // ✅ تعديل: دالة الإرسال للسيرفر أصبحت تأخذ الـ Slug تلقائياً
  async function apiLogin(identifier, password) {
  const slug = getSchoolSlug();

 if (!slug) {
  throw new Error(
    "لم يتم تحديد المدرسة. يرجى استخدام رابط تسجيل الدخول الخاص بمدرستك."
  );
}
  const body = {
    slug: slug,
    email: identifier,
    username: identifier,
    login: identifier,
    password,
  };

  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await r.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `Login failed (${r.status})`;

    // إذا الباكند رجع رابط التحويل نستخدمه مباشرة
    if (data && data.redirect_url) {
      clearSession();
      window.location.replace(data.redirect_url);
      return new Promise(() => {});
    }

    // حل احتياطي إذا الباكند رجع رسالة فقط بدون redirect_url
    const shouldRedirectToExpiredPage =
      r.status === 403 &&
      (
        msg.includes("غير مفعلة") ||
        msg.includes("إيقاف") ||
        msg.includes("موقوف") ||
        msg.includes("انتهى") ||
        msg.includes("منتهية") ||
        msg.includes("انتهت") ||
        msg.includes("اشتراك") ||
        msg.includes("تجربة")
      );

    if (shouldRedirectToExpiredPage) {
      clearSession();

      const params = new URLSearchParams({
        code: "SCHOOL_INACTIVE",
        school: slug,
        status: "inactive",
        plan: "",
        trial_ends_at: "",
        subscription_ends_at: "",
      });

      window.location.replace(
        `/frontend/subscription/expired.html?${params.toString()}`
      );

      return new Promise(() => {});
    }

    throw new Error(msg);
  }

  return data;
}
  async function doLogin(getEls) {
    const { email, password, submit } = getEls();

    if (!email || !password) {
      await window.AppUI.alert({
        title: "تعذر تسجيل الدخول",
        message: "لم يتم العثور على حقول تسجيل الدخول في الصفحة.",
        type: "danger",
      });
      return;
    }

    const identifier = String(email.value || "").trim();
    const pass = String(password.value || "");

    if (!identifier) {
      await window.AppUI.alert({
        title: "بيانات مطلوبة",
        message: "اكتب البريد الإلكتروني أو اسم المستخدم.",
        type: "warning",
      });
      return;
    }

    if (!pass) {
      await window.AppUI.alert({
        title: "بيانات مطلوبة",
        message: "اكتب كلمة المرور.",
        type: "warning",
      });
      return;
    }

    if (submit) submit.disabled = true;

    try {
      const data = await apiLogin(identifier, pass);

      // دعم مختلف تنسيقات الرد
      const token = data.token || data.data?.token || data.accessToken;
      const user = data.user || data.data?.user || data.data;

      if (!token || !user) {
        throw new Error("رد تسجيل الدخول غير متوقع (لا يوجد token/user)");
      }

      saveSession(token, user);
      const roleKey = getRoleKeyFromUser(user);
      window.AppUI.toast("تم تسجيل الدخول بنجاح ✅", "success", { timeout: 1600 });
      setTimeout(() => goto(dashboardUrlFor(roleKey)), 550);
    } catch (e) {
      console.error("login error:", e);
      clearSession();
      await window.AppUI.alert({
        title: "تعذر تسجيل الدخول",
        message: e.message || "فشل تسجيل الدخول.",
        type: "danger",
      });
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function initIfReady() {
    showSchoolLoginLink();
    if (state.inited) return;

    if (redirectIfAlreadyLoggedIn()) {
      state.inited = true;
      return;
    }

    const els = findLoginElements();
    if (!els.email || !els.password) return;

    state.inited = true;

    const getEls = () => findLoginElements();

    if (els.form) {
      els.form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        doLogin(getEls);
      });
    }

    if (els.submit) {
      els.submit.addEventListener("click", (ev) => {
        ev.preventDefault();
        doLogin(getEls);
      });
    }

    const enterHandler = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        doLogin(getEls);
      }
    };
    els.email.addEventListener("keydown", enterHandler);
    els.password.addEventListener("keydown", enterHandler);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIfReady);
  } else {
    initIfReady();
  }

  const obs = new MutationObserver(() => initIfReady());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();