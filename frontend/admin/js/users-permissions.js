// frontend/admin/js/users-permissions.js

const RBAC_API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

function rbacApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  let cleanPath = String(path || "").replace(/^\/+/, "");

  if (cleanPath.startsWith("api/")) {
    cleanPath = cleanPath.slice(4);
  }

  return `${RBAC_API_BASE}/${cleanPath}`;
}
/* ==========================================
   أدوات مساعدة عامة
========================================== */

// هيدر التوثيق
function rbacGetAuthHeaders() {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// طلب عام للـ API مع معالجة 401 / أخطاء أخرى
async function rbacApiRequest(path, options = {}) {
  const finalOptions = {
    headers: {
      ...rbacGetAuthHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  };

  try {
   const res = await fetch(rbacApiUrl(path), finalOptions);

    // 1) انتهاء الجلسة / توكن غير صالح
    if (res.status === 401) {
      let message = "تم انتهاء الجلسة، الرجاء تسجيل الدخول من جديد";

      try {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          message = json.message || message;
        } catch (_) {
          if (text && text.trim()) message = text;
        }
      } catch (_) {}

    adminToast(message, "warning");
localStorage.removeItem("token");
localStorage.removeItem("user");
window.location.href = "../login/login.html";
return;
    }

    // 2) أخطاء أخرى
    if (!res.ok) {
      const text = await res.text();
      console.error("RBAC API error:", res.status, text);
      let message = "حدث خطأ في الخادم";
      try {
        const json = JSON.parse(text);
        message = json.message || message;
      } catch (_) {}
      throw new Error(message);
    }

    // 3) نجاح
    if (res.status === 204) return null;
    return await res.json();
  } catch (err) {
    console.error("RBAC request failed:", err);
   adminToast(`خطأ: ${err.message}`, "error");
throw err;
  }
}
function adminToast(message, type = "info") {
  if (window.AppUI?.toast) {
    window.AppUI.toast(message, type);
    return;
  }

  console.warn(message);
}

async function adminConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  console.warn("AppUI.confirm غير متاح");
  return false;
}
// تعبئة فورم من كائن قيم
function rbacFillForm(formElement, values) {
  Object.entries(values).forEach(([key, val]) => {
    const input = formElement.querySelector(`#${key}`);
    if (input) input.value = val ?? "";
  });
}

// إعادة ضبط فورم + الـ hidden id
function rbacResetForm(formElement) {
  if (formElement) formElement.reset();
  const hiddenId =
    formElement && formElement.querySelector("input[type=hidden]");
  if (hiddenId) hiddenId.value = "";
}

// توحيد شكل ردود الـ API التي تعيد مصفوفات
function normalizeArrayResponse(res, keys = ["data"]) {
  if (Array.isArray(res)) return res;

  for (const key of keys) {
    if (Array.isArray(res?.[key])) return res[key];
  }

  if (res?.data && Array.isArray(res.data.items)) return res.data.items;

  console.warn("Unexpected array response shape:", res);
  return [];
}

/* ==========================================
   🔢 دالة عامة لتحديث عدّادات الكروت
   (Modules / Permissions / Roles)
========================================== */
function rbacUpdateBadgeCount(badgeId, count) {
  const el = document.getElementById(badgeId);
  if (!el) return;

  const n = Number(count || 0);
  const type = el.dataset.label; // "وحدة" | "صلاحية" | "دور"

  let text = "";

  if (type === "وحدة") {
    if (n === 0) text = "لا توجد وحدات";
    else if (n === 1) text = "وحدة واحدة";
    else if (n === 2) text = "وحدتان";
    else if (n <= 10) text = `${n} وحدات`;
    else text = `${n} وحدة`;
  } else if (type === "صلاحية") {
    if (n === 0) text = "لا توجد صلاحيات";
    else if (n === 1) text = "صلاحية واحدة";
    else if (n === 2) text = "صلاحيتان";
    else if (n <= 10) text = `${n} صلاحيات`;
    else text = `${n} صلاحية`;
  } else if (type === "دور") {
    if (n === 0) text = "لا توجد أدوار";
    else if (n === 1) text = "دور واحد";
    else if (n === 2) text = "دوران";
    else if (n <= 10) text = `${n} أدوار`;
    else text = `${n} دور`;
  } else {
    if (n === 0) text = "لا يوجد عناصر";
    else text = `${n}`;
  }

  el.textContent = text;
}

/* ==========================================
   الكائن الرئيسي RBAC
========================================== */
const RBAC = {
  modules: [],
  permissions: [],
  roles: [],
  users: [],

  async onPageLoaded(pageKey) {
    if (pageKey === "rbac-modules") {
      await this.initModulesPage();
    } else if (pageKey === "rbac-permissions") {
      await this.initPermissionsPage();
    } else if (pageKey === "rbac-roles") {
      await this.initRolesPage();
    } else if (pageKey === "rbac-users") {
      await this.initUsersPage();
    }
  },

  /* ================== الوحدات (Modules) ================== */
  async initModulesPage() {
    const form = document.getElementById("rbac-module-form");
    const tbody = document.getElementById("rbac-modules-tbody");
    if (!form || !tbody) return;

    await this.loadModules();

    form.onsubmit = async (e) => {
      e.preventDefault();

      const id = document.getElementById("module-id").value || null;
      const name = document.getElementById("module-name").value.trim();
      const code = document.getElementById("module-code").value.trim();
if (!name || !code) {
  adminToast("الرجاء إدخال الاسم والكود", "warning");
  return;
}

      const body = JSON.stringify({ name, code });

      if (id) {
        await rbacApiRequest(`/modules/${id}`, {
          method: "PUT",
          body,
        });
      } else {
        await rbacApiRequest("/modules", {
          method: "POST",
          body,
        });
      }

      await this.loadModules();
      rbacResetForm(form);
      adminToast(id ? "تم تعديل الوحدة بنجاح" : "تمت إضافة الوحدة بنجاح", "success");
    };
  },

  async loadModules() {
    const res = await rbacApiRequest("/modules", { method: "GET" });
    this.modules = normalizeArrayResponse(res, ["data", "modules"]);
    this.renderModulesTable();
    rbacUpdateBadgeCount("modules-count-badge", this.modules.length);
  },

  renderModulesTable() {
    const tbody = document.getElementById("rbac-modules-tbody");
    if (!tbody) return;

    if (!this.modules.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;">لا توجد وحدات بعد</td></tr>';
      return;
    }

    tbody.innerHTML = this.modules
      .map(
        (m, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${m.name || ""}</td>
            <td>${m.code || ""}</td>
            <td>
              <button class="btn-small" data-module-id="${m.id}" data-action="edit-module">تعديل</button>
              <button class="btn-small danger" data-module-id="${m.id}" data-action="delete-module">حذف</button>
            </td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll("[data-action=edit-module]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-module-id");
        const module = this.modules.find((m) => String(m.id) === String(id));
        if (!module) return;
        const form = document.getElementById("rbac-module-form");
        if (!form) return;
        rbacFillForm(form, {
          "module-id": module.id,
          "module-name": module.name || "",
          "module-code": module.code || "",
        });
      };
    });

  tbody.querySelectorAll("[data-action=delete-module]").forEach((btn) => {
  btn.onclick = async () => {
    const id = btn.getAttribute("data-module-id");

    const ok = await adminConfirm({
      title: "حذف الوحدة",
      message:
        "هل أنت متأكد من حذف هذه الوحدة؟\nقد يؤثر هذا على الصلاحيات المرتبطة بها.",
      confirmText: "حذف الوحدة",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    await rbacApiRequest(`/modules/${id}`, { method: "DELETE" });
    adminToast("تم حذف الوحدة بنجاح", "success");
    await this.loadModules();
  };
});
  },

  /* ================== الصلاحيات (Permissions) ================== */

  // تعبئة قائمة الوحدات (للفورم + كارت الربط الجماعي)
  populateModulesInPermissionSelect() {
    const moduleSelect = document.getElementById("perm-module");
    const bulkModuleSelect = document.getElementById("bulk-module-select");

    const optionsHtml =
      '<option value="">اختر الوحدة المرتبطة</option>' +
      this.modules
        .map(
          (m) =>
            `<option value="${m.code}">${m.name || m.code}</option>`
        )
        .join("");

    if (moduleSelect) moduleSelect.innerHTML = optionsHtml;
    if (bulkModuleSelect) bulkModuleSelect.innerHTML = optionsHtml;
  },

  // تهيئة صفحة الصلاحيات (جدول + فورم + ربط جماعي)
  async initPermissionsPage() {
    const form = document.getElementById("rbac-permission-form");
    const tbody = document.getElementById("rbac-permissions-tbody");
    const moduleSelect = document.getElementById("perm-module");
    if (!form || !tbody || !moduleSelect) return;

    // تحميل الوحدات أولاً
    if (!this.modules.length) {
      await this.loadModules();
    }
    this.populateModulesInPermissionSelect();

    // تحميل الصلاحيات
    await this.loadPermissions();

    // تهيئة واجهة الربط الجماعي
    this.initBulkPermissionsUI();

    // حفظ/تعديل صلاحية واحدة (الفورم العادي)
    form.onsubmit = async (e) => {
      e.preventDefault();

      const id = document.getElementById("perm-id").value || null;
      const name = document.getElementById("perm-name").value.trim();
      const code = document.getElementById("perm-code").value.trim();
      const moduleCode = document.getElementById("perm-module").value.trim();
if (!name || !code || !moduleCode) {
  adminToast("الرجاء تعبئة جميع الحقول", "warning");
  return;
}
// ✅ استخرج module_id من قائمة الوحدات بناءً على moduleCode
const selectedModule = this.modules.find((m) => String(m.code) === String(moduleCode));
const module_id = selectedModule ? Number(selectedModule.id) : null;

// ✅ أرسل أكثر من اسم للحقل عشان يتوافق مع أي باك إند (module_id / moduleId / module_code)
const body = JSON.stringify({
  name,
  code,
  module_code: moduleCode,
  moduleCode,       // احتياط لو الباك يستعمل camelCase
  module_id,
  moduleId: module_id
});

      if (id) {
        await rbacApiRequest(`/permissions/${id}`, {
          method: "PUT",
          body,
        });
      } else {
        await rbacApiRequest("/permissions", {
          method: "POST",
          body,
        });
      }

      await this.loadPermissions();
      rbacResetForm(form);
      adminToast(id ? "تم تعديل الصلاحية بنجاح" : "تمت إضافة الصلاحية بنجاح", "success");

      // تحديث قائمة الربط الجماعي حسب فلتر البحث الحالي
      this.renderBulkPermissionsList(
        document.getElementById("bulk-perms-search")?.value || ""
      );
    };
  },

  // واجهة ربط صلاحيات متعددة بوحدة واحدة
  initBulkPermissionsUI() {
    const searchInput = document.getElementById("bulk-perms-search");
    const btn = document.getElementById("bulk-assign-perms-btn");

    // بحث في قائمة الصلاحيات
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.renderBulkPermissionsList(searchInput.value);
      });
    }

    // زر تنفيذ الربط
  if (btn) {
  btn.addEventListener("click", async () => {
    const moduleSelect = document.getElementById("bulk-module-select");
    const moduleCode = moduleSelect ? moduleSelect.value.trim() : "";

    if (!moduleCode) {
      adminToast("اختر وحدة أولاً", "warning");
      return;
    }

    const checked = Array.from(
      document.querySelectorAll(
        "#bulk-perms-list input[type=checkbox]:checked"
      )
    ).map((c) => Number(c.value));

    if (!checked.length) {
      adminToast("اختر صلاحيات أولاً", "warning");
      return;
    }

    const ok = await adminConfirm({
      title: "ربط الصلاحيات بالوحدة",
      message: `سيتم ربط ${checked.length} صلاحية بالوحدة المحددة.\nهل تريد المتابعة؟`,
      confirmText: "ربط الصلاحيات",
      cancelText: "إلغاء",
      type: "warning",
    });

    if (!ok) return;

    for (const permId of checked) {
      const perm = this.permissions.find(
        (p) => Number(p.id) === Number(permId)
      );
      if (!perm) continue;

      const body = JSON.stringify({
        name: perm.name,
        code: perm.code,
        module_code: moduleCode,
      });

      await rbacApiRequest(`/permissions/${permId}`, {
        method: "PUT",
        body,
      });
    }

    await this.loadPermissions();
    this.renderBulkPermissionsList(searchInput ? searchInput.value : "");
    adminToast("تم ربط الصلاحيات المحددة بالوحدة بنجاح", "success");
  });
}

    // تحميل أولي للقائمة
    this.renderBulkPermissionsList();
  },

  // رسم قائمة الصلاحيات داخل كارت الربط الجماعي
  renderBulkPermissionsList(filterQuery = "") {
    const container = document.getElementById("bulk-perms-list");
    if (!container) return;

    const q = (filterQuery || "").toLowerCase();

    const perms = this.permissions.filter((p) => {
      const text = `${p.name || ""} ${p.code || ""} ${
        p.module_code || ""
      }`.toLowerCase();
      return text.includes(q);
    });

    if (!perms.length) {
      container.innerHTML =
        '<p style="font-size:0.8rem; color:#9ca3af; margin:0;">لا توجد صلاحيات مطابقة.</p>';
      return;
    }

    container.innerHTML = perms
      .map((p) => {
        const tag =
          p.module_code && p.module_code !== ""
            ? `<span class="tag">${p.module_code}</span>`
            : "";
        return `
          <label class="checkbox-line">
            <input type="checkbox" value="${p.id}" />
            <span>${p.name || ""} <small>(${p.code})</small> ${tag}</span>
          </label>
        `;
      })
      .join("");
  },

  async loadPermissions() {
    const res = await rbacApiRequest("/permissions", { method: "GET" });
    this.permissions = normalizeArrayResponse(res, ["data", "permissions"]);
    this.renderPermissionsTable();

    // تحديث قائمة الربط الجماعي إن وجدت
    this.renderBulkPermissionsList(
      document.getElementById("bulk-perms-search")?.value || ""
    );

    // 🔢 تحديث عدّاد الصلاحيات
    rbacUpdateBadgeCount("perms-count-badge", this.permissions.length);
  },

  renderPermissionsTable() {
    const tbody = document.getElementById("rbac-permissions-tbody");
    if (!tbody) return;

    if (!this.permissions.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;">لا توجد صلاحيات بعد</td></tr>';
      return;
    }

    tbody.innerHTML = this.permissions
      .map(
        (p, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${p.name || ""}</td>
            <td>${p.code || ""}</td>
            <td>${p.module_code || ""}</td>
            <td>
              <button class="btn-small" data-perm-id="${p.id}" data-action="edit-permission">تعديل</button>
              <button class="btn-small danger" data-perm-id="${p.id}" data-action="delete-permission">حذف</button>
            </td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll("[data-action=edit-permission]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-perm-id");
        const perm = this.permissions.find((p) => String(p.id) === String(id));
        if (!perm) return;
        const form = document.getElementById("rbac-permission-form");
        if (!form) return;
        rbacFillForm(form, {
          "perm-id": perm.id,
          "perm-name": perm.name || "",
          "perm-code": perm.code || "",
          "perm-module": perm.module_code || "",
        });
      };
    });

  tbody.querySelectorAll("[data-action=delete-permission]").forEach((btn) => {
  btn.onclick = async () => {
    const id = btn.getAttribute("data-perm-id");

    const ok = await adminConfirm({
      title: "حذف الصلاحية",
      message:
        "هل أنت متأكد من حذف هذه الصلاحية؟\nقد يؤثر هذا على الأدوار المرتبطة بها.",
      confirmText: "حذف الصلاحية",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    await rbacApiRequest(`/permissions/${id}`, { method: "DELETE" });
    adminToast("تم حذف الصلاحية بنجاح", "success");
    await this.loadPermissions();
  };
});
  },

  /* ================== الأدوار (Roles) ================== */
  async initRolesPage() {
    const rolesTbody = document.getElementById("rbac-roles-tbody");
    const roleForm = document.getElementById("rbac-role-form");
    const roleSelect = document.getElementById("role-select-perms");
    const permsContainer = document.getElementById("role-permissions-list");
    const savePermsBtn = document.getElementById("save-role-permissions");
    if (!rolesTbody || !roleForm || !roleSelect || !permsContainer || !savePermsBtn) return;

    if (!this.modules.length) await this.loadModules();
    if (!this.permissions.length) await this.loadPermissions();
    await this.loadRoles();

    roleForm.onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById("role-id").value || null;
      const name = document.getElementById("role-name").value.trim();
      const description = document
        .getElementById("role-description")
        .value.trim();

    if (!name) {
  adminToast("الرجاء إدخال اسم الدور", "warning");
  return;
}

      const body = JSON.stringify({ name, description });

      if (id) {
        await rbacApiRequest(`/roles/${id}`, { method: "PUT", body });
      } else {
        await rbacApiRequest("/roles", { method: "POST", body });
      }

      await this.loadRoles();
      rbacResetForm(roleForm);
      adminToast(id ? "تم تعديل الدور بنجاح" : "تمت إضافة الدور بنجاح", "success");
    };

    roleSelect.onchange = async () => {
      const roleId = roleSelect.value;
      if (!roleId) {
        permsContainer.innerHTML = "<p>اختر دورًا لعرض صلاحياته.</p>";
        return;
      }
      await this.renderRolePermissions(roleId);
    };

    savePermsBtn.onclick = async () => {
      const roleId = roleSelect.value;
    if (!roleId) {
  adminToast("اختر دورًا أولاً", "warning");
  return;
}

      const checked = Array.from(
        document.querySelectorAll(
          "#role-permissions-list input[type=checkbox]:checked"
        )
      ).map((c) => Number(c.value));

      await rbacApiRequest(`/roles/${roleId}/permissions`, {
        method: "POST",
        body: JSON.stringify({ permissions: checked }),
      });

adminToast("تم حفظ صلاحيات الدور بنجاح", "success");    };
  },

  async loadRoles() {
    const res = await rbacApiRequest("/roles", { method: "GET" });

    let roles = [];
    if (Array.isArray(res)) {
      roles = res;
    } else if (Array.isArray(res.roles)) {
      roles = res.roles;
    } else if (Array.isArray(res.data)) {
      roles = res.data;
    } else {
      console.warn("Unexpected roles response shape:", res);
    }

    this.roles = roles;
    this.renderRolesTable();
    this.populateRolesSelect();
    rbacUpdateBadgeCount("roles-count-badge", this.roles.length);
  },

  renderRolesTable() {
    const tbody = document.getElementById("rbac-roles-tbody");
    if (!tbody) return;

    if (!this.roles.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;">لا توجد أدوار بعد</td></tr>';
      return;
    }

    tbody.innerHTML = this.roles
      .map(
        (r, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${r.name || ""}</td>
            <td>${r.description || ""}</td>
            <td>
              <button class="btn-small" data-role-id="${r.id}" data-action="edit-role">تعديل</button>
              <button class="btn-small danger" data-role-id="${r.id}" data-action="delete-role">حذف</button>
            </td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll("[data-action=edit-role]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-role-id");
        const role = this.roles.find((r) => String(r.id) === String(id));
        if (!role) return;
        const form = document.getElementById("rbac-role-form");
        if (!form) return;
        rbacFillForm(form, {
          "role-id": role.id,
          "role-name": role.name || "",
          "role-description": role.description || "",
        });
      };
    });

   tbody.querySelectorAll("[data-action=delete-role]").forEach((btn) => {
  btn.onclick = async () => {
    const id = btn.getAttribute("data-role-id");

    const ok = await adminConfirm({
      title: "حذف الدور",
      message:
        "هل أنت متأكد من حذف هذا الدور؟\nقد يؤثر هذا على المستخدمين المرتبطين بهذا الدور وصلاحياتهم.",
      confirmText: "حذف الدور",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    await rbacApiRequest(`/roles/${id}`, { method: "DELETE" });
    adminToast("تم حذف الدور بنجاح", "success");
    await this.loadRoles();
  };
});
  },

  populateRolesSelect() {
    const roleSelect = document.getElementById("role-select-perms");
    if (!roleSelect) return;

    roleSelect.innerHTML =
      '<option value="">اختر الدور...</option>' +
      this.roles.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
  },

  async renderRolePermissions(roleId) {
    const permsContainer = document.getElementById("role-permissions-list");
    if (!permsContainer) return;

    const res = await rbacApiRequest(`/roles/${roleId}/permissions`, {
      method: "GET",
    });

    const data = res && res.data ? res.data : res;
    const rolePermIds = Array.isArray(data.permissions)
      ? data.permissions.map((p) => Number(p))
      : [];

    permsContainer.innerHTML = this.permissions
      .map((p) => {
        const checked = rolePermIds.includes(Number(p.id)) ? "checked" : "";
        return `
          <label class="checkbox-line">
            <input type="checkbox" value="${p.id}" ${checked} />
            <span>${p.name} <small>(${p.code})</small></span>
          </label>`;
      })
      .join("");
  },

  async grantAllPermissions() {
  const roleSelect = document.getElementById("role-select-perms");
  const roleId = roleSelect?.value;

  if (!roleId) {
    adminToast("اختر دورًا أولاً", "warning");
    return;
  }

  const ok = await adminConfirm({
    title: "منح كل الصلاحيات",
    message:
      "سيتم منح جميع صلاحيات النظام لهذا الدور.\nهذا الإجراء قد يعطي المستخدمين صلاحيات واسعة جدًا.",
    confirmText: "منح الصلاحيات",
    cancelText: "إلغاء",
    type: "warning",
  });

  if (!ok) return;

  await rbacApiRequest(
    `/roles/${roleId}/grant-all-permissions`,
    { method: "POST" }
  );

  adminToast("تم منح كل الصلاحيات بنجاح", "success");
  await this.renderRolePermissions(roleId);
},
  /* ================== المستخدمون (Users) ================== */
  async initUsersPage() {
    const tbody = document.getElementById("rbac-users-tbody");
    const form = document.getElementById("rbac-user-form");
    const roleSelect = document.getElementById("user-role");
    if (!tbody || !form || !roleSelect) return;

    if (!this.roles.length) await this.loadRoles();
    this.populateRolesInUserForm();

    await this.loadUsers();

    form.onsubmit = async (e) => {
      e.preventDefault();

      const id = document.getElementById("user-id").value || null;
      const full_name = document
        .getElementById("user-fullname")
        .value.trim();
      const username = document
        .getElementById("user-username")
        .value.trim();
      const email = document.getElementById("user-email").value.trim();
      const phone = document.getElementById("user-phone").value.trim();
      const password = document.getElementById("user-password").value.trim();
      const role_id = document.getElementById("user-role").value;
if (!full_name || !username || !email || !role_id) {
  adminToast("الاسم الكامل واسم المستخدم والبريد والدور مطلوبة", "warning");
  return;
}

      const payload = {
        full_name,
        username,
        email,
        phone,
        role_id: Number(role_id),
      };

    if (!id && !password) {
  adminToast("الرجاء إدخال كلمة المرور للمستخدم الجديد", "warning");
  return;
}
      if (password) {
        payload.password = password;
      }

      const body = JSON.stringify(payload);

      if (id) {
        await rbacApiRequest(`/users/${id}`, { method: "PUT", body });
      } else {
        await rbacApiRequest("/users", { method: "POST", body });
      }

      await this.loadUsers();
      rbacResetForm(form);
      adminToast(id ? "تم تعديل المستخدم بنجاح" : "تمت إضافة المستخدم بنجاح", "success");
    };
  },

  populateRolesInUserForm() {
    const roleSelect = document.getElementById("user-role");
    if (!roleSelect) return;
    roleSelect.innerHTML =
      '<option value="">اختر الدور...</option>' +
      this.roles.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
  },

  async loadUsers() {
    const res = await rbacApiRequest("/users", { method: "GET" });
    this.users = normalizeArrayResponse(res, ["data", "users"]);

    // تعبئة الجدول
    this.renderUsersTable();

    // 🔢 تحديث عدّاد المستخدمين
    const badge = document.getElementById("users-count-badge");
    if (badge) {
      const n = Number(this.users.length || 0);
      let text;

      if (n === 0) {
        text = "لا يوجد مستخدمون";
      } else if (n === 1) {
        text = "مستخدم واحد";
      } else if (n === 2) {
        text = "مستخدمان";
      } else if (n <= 10) {
        text = `${n} مستخدمين`;
      } else {
        text = `${n} مستخدم`;
      }

      badge.textContent = text;
    }
  },

  renderUsersTable() {
    const tbody = document.getElementById("rbac-users-tbody");
    if (!tbody) return;

    if (!this.users.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;">لا يوجد مستخدمون بعد</td></tr>';
      return;
    }

    tbody.innerHTML = this.users
      .map(
        (u, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${u.full_name || ""}</td>
            <td>${u.username || ""}</td>
            <td>${u.email || ""}</td>
            <td>
              <span class="role-pill">${u.role_name || ""}</span>
            </td>
            <td>
              <button
                type="button"
                class="btn-chip"
                data-user-id="${u.id}"
                data-action="edit-user">
                تعديل
              </button>
              <button
                type="button"
                class="btn-chip danger"
                data-user-id="${u.id}"
                data-action="delete-user">
                حذف
              </button>
            </td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll("[data-action=edit-user]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-user-id");
        const user = this.users.find((u) => String(u.id) === String(id));
        if (!user) return;
        const form = document.getElementById("rbac-user-form");
        if (!form) return;

        rbacFillForm(form, {
          "user-id": user.id,
          "user-fullname": user.full_name || "",
          "user-username": user.username || "",
          "user-email": user.email || "",
          "user-phone": user.phone || "",
          "user-password": "",
          "user-role": user.role_id || "",
        });

        if (window.UserUI && typeof UserUI.openEdit === "function") {
          UserUI.openEdit();
        }
      };
    });

   tbody.querySelectorAll("[data-action=delete-user]").forEach((btn) => {
  btn.onclick = async () => {
    const id = btn.getAttribute("data-user-id");

    const ok = await adminConfirm({
      title: "حذف المستخدم",
      message:
        "هل أنت متأكد من حذف هذا المستخدم؟\nلن يستطيع هذا المستخدم الدخول للنظام بعد الحذف.",
      confirmText: "حذف المستخدم",
      cancelText: "إلغاء",
      type: "danger",
    });

    if (!ok) return;

    await rbacApiRequest(`/users/${id}`, { method: "DELETE" });
    adminToast("تم حذف المستخدم بنجاح", "success");
    await this.loadUsers();
  };
});
  },
};

window.RBAC = RBAC;
