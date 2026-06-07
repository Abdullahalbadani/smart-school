function getParam(name) {
  return new URLSearchParams(window.location.search).get(name) || "";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("ar-YE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getStatusText(status) {
  const map = {
    trial: "تجربة",
    active: "فعال",
    suspended: "موقوف",
    expired: "منتهي",
    cancelled: "ملغي",
    inactive: "غير مفعل",
  };

  return map[status] || status || "—";
}

function getPlanText(plan) {
  const map = {
    trial: "تجربة",
    monthly: "شهري",
    yearly: "سنوي",
    lifetime: "دائم",
    custom: "مخصص",
  };

  return map[plan] || plan || "—";
}

const code = getParam("code");
const schoolName = decodeURIComponent(getParam("school") || "هذه المدرسة");
const status = getParam("status");
const plan = getParam("plan");
const trialEndsAt = getParam("trial_ends_at");
const subscriptionEndsAt = getParam("subscription_ends_at");

const messages = {
  SCHOOL_INACTIVE: "تم إيقاف المدرسة مؤقتًا من مالك النظام.",
  SCHOOL_SUSPENDED: "تم إيقاف اشتراك المدرسة، يرجى التواصل مع مالك النظام.",
  SCHOOL_EXPIRED: "انتهت مدة استخدام النظام لهذه المدرسة.",
  SCHOOL_CANCELLED: "تم إلغاء اشتراك المدرسة.",
  SUBSCRIPTION_EXPIRED: "انتهت التجربة أو الاشتراك، يرجى التجديد للمتابعة.",
};

document.getElementById("schoolName").textContent = schoolName || "—";
document.getElementById("statusText").textContent = getStatusText(status);
document.getElementById("planText").textContent = getPlanText(plan);
document.getElementById("trialEndsAt").textContent = formatDate(trialEndsAt);
document.getElementById("subscriptionEndsAt").textContent = formatDate(subscriptionEndsAt);

if (messages[code]) {
  document.getElementById("message").textContent = messages[code];
}

document.getElementById("contactBtn").addEventListener("click", () => {
  window.AppUI.alert({
    title: "التواصل مع مالك النظام",
    message: "لم تتم إضافة وسيلة التواصل بعد. يرجى التواصل مع إدارة المنصة.",
    type: "info",
  });
});