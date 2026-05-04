// // ===============================
// // UserUI - واجهة إدارة المستخدمين (مودال + بحث + عداد)
// // ===============================
// window.UserUI = {
//   modalEl: null,
//   formEl: null,
//   titleEl: null,
//   countBadge: null,

//   init() {
//     this.modalEl = document.getElementById("user-modal");
//     this.formEl = document.getElementById("rbac-user-form");
//     this.titleEl = document.getElementById("user-modal-title");
//     this.countBadge = document.getElementById("users-count-badge");

//     // إغلاق بالمفتاح Esc
//     document.addEventListener("keydown", (e) => {
//       if (e.key === "Escape") this.close();
//     });
//   },

//   ensureInit() {
//     if (!this.modalEl) this.init();
//   },

//   // فتح لإنشاء مستخدم جديد (زر: مستخدم جديد)
//   openCreate() {
//     this.ensureInit();
//     if (!this.modalEl || !this.formEl) return;

//     this.formEl.reset();
//     const idInput = document.getElementById("user-id");
//     if (idInput) idInput.value = "";

//     if (this.titleEl) this.titleEl.textContent = "مستخدم جديد";
//     this.modalEl.classList.add("is-open");
//   },

//   // فتح لتعديل مستخدم (يُستدعى بعد ما تعبي الفورم من JS)
//   openEdit() {
//     this.ensureInit();
//     if (!this.modalEl) return;

//     if (this.titleEl) this.titleEl.textContent = "تعديل مستخدم";
//     this.modalEl.classList.add("is-open");
//   },

//   // إغلاق المودال
//   close() {
//     this.ensureInit();
//     if (!this.modalEl) return;
//     this.modalEl.classList.remove("is-open");
//   },

//   // بحث داخل جدول المستخدمين
//   search(query) {
//     const tbody = document.getElementById("rbac-users-tbody");
//     if (!tbody) return;

//     const q = (query || "").toLowerCase();
//     tbody.querySelectorAll("tr").forEach((tr) => {
//       const text = tr.innerText.toLowerCase();
//       tr.style.display = text.includes(q) ? "" : "none";
//     });
//   },

//   // تحديث عدّاد المستخدمين في أعلى الجدول
//   updateCount(count) {
//     this.ensureInit();
//     if (!this.countBadge) return;
//     const n = Number(count) || 0;

//     if (n === 0) {
//       this.countBadge.textContent = "لا يوجد مستخدمون";
//     } else {
//       this.countBadge.textContent = `${n} مستخدم${n > 2 ? "ين" : ""}`;
//     }
//   },
// };

// // تشغيل init بعد تحميل الصفحة
// document.addEventListener("DOMContentLoaded", () => {
//   if (window.UserUI && typeof UserUI.init === "function") {
//     UserUI.init();
//   }
// });
