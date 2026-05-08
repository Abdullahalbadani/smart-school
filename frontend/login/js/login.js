/* frontend/login/login.js */
(function () {
  "use strict";

  console.log("login.js loaded ✅ with Auto-Slug support");

const API_BASE = "/api";
  const state = { inited: false };

  // --- دالة استخراج معرف المدرسة (Slug) من الرابط ---
 function getSchoolSlug() {
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    
    // إذا كان الرابط يحتوي على subdomain (مثل nahda.localhost)
    if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
        return parts[0]; // سيعيد nahda أو majd
    }
    return "smart-school"; // الافتراضي
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
    if (["admin", "teacher", "student", "parent"].includes(n)) return n;

    const id = Number(user && user.role_id);
    if (id === 1) return "admin";
    if (id === 2) return "teacher";
    if (id === 3) return "student";
    if (id === 4) return "parent";

    return "";
  }

  function dashboardUrlFor(roleKey) {
    if (roleKey === "teacher") return "/frontend/teacher/index.html";
    if (roleKey === "student") return "/frontend/student/index.html";
    if (roleKey === "parent") return "/frontend/parent/index.html";
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
    const user = safeJsonParse(localStorage.getItem("user") || "");
    if (token && user) {
      const roleKey = getRoleKeyFromUser(user);
      goto(dashboardUrlFor(roleKey));
      return true;
    }
    return false;
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
    const slug = getSchoolSlug(); // استخراج المعرف من الرابط

    if (!slug) {
        throw new Error("لم نتمكن من تحديد هوية المدرسة من الرابط الحالي.");
    }

    const body = {
      slug: slug, // ✅ تم الإرسال تلقائياً كما يطلبه الكنترولر في الباك إند
      email: identifier,
      username: identifier,
      login: identifier, // لتوافق الأسماء التي قد يستخدمها الباك إند
      password,
    };

    const r = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || `Login failed (${r.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function doLogin(getEls) {
    const { email, password, submit } = getEls();

    if (!email || !password) {
      alert("لم أجد حقول تسجيل الدخول في الصفحة.");
      return;
    }

    const identifier = String(email.value || "").trim();
    const pass = String(password.value || "");

    if (!identifier) return alert("اكتب البريد/اسم المستخدم");
    if (!pass) return alert("اكتب كلمة المرور");

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
      goto(dashboardUrlFor(roleKey));
    } catch (e) {
      console.error("login error:", e);
      clearSession();
      alert(e.message || "فشل تسجيل الدخول");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function initIfReady() {
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