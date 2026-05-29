// frontend/admin/js/staffRegister.js
(function () {
  "use strict";


const API_BASE = String(window.API_BASE || "/api").replace(/\/+$/, "");

const apiUrl =
  typeof window.apiUrl === "function"
    ? window.apiUrl
    : function (path = "") {
        if (/^https?:\/\//i.test(path)) return path;

        let cleanPath = String(path || "").replace(/^\/+/, "");

        if (cleanPath.startsWith("api/")) {
          cleanPath = cleanPath.slice(4);
        }

        return `${API_BASE}/${cleanPath}`;
      };  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

 async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);

    const r = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    });

    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!r.ok) {
      const msg = (data && (data.error || data.message)) || `API ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.payload = data;
      throw e;
    }
    return data;
  }

 function toast(msg, type = "info") {
  if (window.AppUI?.toast) {
    window.AppUI.toast(msg, type);
    return;
  }

  const t = document.getElementById("toast");
  if (!t) return alert(msg);

  t.hidden = false;
  t.textContent = msg;
  t.classList.add("show");

  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

async function empConfirm(options = {}) {
  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm(options);
  }

  return confirm(options.message || "هل تريد المتابعة؟");
}
  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const state = {
    roles: [],
    usersAll: [], // كل الحسابات من السيرفر
    users: [], // الحسابات الظاهرة بعد الفلترة حسب (معلم/موظف)
    teachers: [],
    employees: [],
    mainTab: "form",
    viewTab: "teachers",
    editingId: null,

    // modal state
    lastViewedId: null,
    lastViewedActive: null,

    _inited: false,
  };

  const els = {};

  function requireEl(id) {
    return document.getElementById(id) || null;
  }

  function bind() {
    els.page = requireEl("employeesPage");
    if (!els.page) return false;

    els.newBtn = requireEl("empNewBtn");
    els.saveBtn = requireEl("empSaveBtn");

    els.mainTabForm = requireEl("empMainTabForm");
    els.mainTabView = requireEl("empMainTabView");
    els.paneForm = requireEl("empPaneForm");
    els.paneView = requireEl("empPaneView");

    els.refreshBtn = requireEl("empRefreshBtn");
    els.search = requireEl("empSearch");
    els.tabTeachers = requireEl("empTabTeachers");
    els.tabEmployees = requireEl("empTabEmployees");
    els.countTeachers = requireEl("empCountTeachers");
    els.countEmployees = requireEl("empCountEmployees");

    els.teachersWrap = requireEl("empTeachersWrap");
    els.employeesWrap = requireEl("empEmployeesWrap");
    els.teachersBody = requireEl("empTeachersBody");
    els.employeesBody = requireEl("empEmployeesBody");
    els.emptyTeachers = requireEl("empEmptyTeachers");
    els.emptyEmployees = requireEl("empEmptyEmployees");

    els.form = requireEl("empForm");
    els.resetBtn = requireEl("empResetBtn");
    els.modeBadge = requireEl("empModeBadge");
    els.idBadge = requireEl("empIdBadge");

    els.fullName = requireEl("empFullName");
    els.phone = requireEl("empPhone");
    els.jobTitle = requireEl("empJobTitle");
    els.notes = requireEl("empNotes");
    els.isTeacher = requireEl("empIsTeacher");
    els.isActive = requireEl("empIsActive");

    els.hasAccount = requireEl("empHasAccount");
    els.accountBox = requireEl("empAccountBox");
    els.userSelect = requireEl("empUserSelect");
    els.userPreview = requireEl("empUserPreview");
    els.username = requireEl("empUsername");
    els.email = requireEl("empEmail");
    els.password = requireEl("empPassword");
    els.password2 = requireEl("empPassword2");

    els.roleSearch = requireEl("empRoleSearch");
    els.rolesList = requireEl("empRolesList");

    els.viewModal = requireEl("empViewModal");
    els.viewBody = requireEl("empViewBody");
    els.viewTitle = requireEl("empViewTitle");
    els.viewEditBtn = requireEl("empViewEditBtn");
    els.viewToggleBtn = requireEl("empViewToggleBtn"); // ✅ مهم

    const must = [
      "empNewBtn",
      "empSaveBtn",
      "empForm",
      "empFullName",
      "empPhone",
      "empIsTeacher",
      "empTeachersBody",
      "empEmployeesBody",
      "empRolesList",
      "empViewToggleBtn",
    ];
    const missing = must.filter((id) => !requireEl(id));
    if (missing.length) {
      console.error("StaffRegister page missing IDs:", missing);
      toast("الواجهة ناقصها عناصر (IDs) — افتح Console لمعرفة التفاصيل");
      return false;
    }

    return true;
  }

  /* ================== Account UI ================== */

  function accMode() {
    const r = $("input[name='accMode']:checked", els.page);
    return r ? r.value : "link";
  }

  function toggleAccUI() {
    const on = !!els.hasAccount?.checked;
    if (els.accountBox) els.accountBox.style.display = on ? "" : "none";

    const mode = on ? accMode() : "none";
    for (const b of $$(".emp-block[data-acc]", els.page)) {
      b.hidden = b.getAttribute("data-acc") !== mode;
    }

    if (on && mode === "link" && els.userPreview) {
      if (!state.users.length) {
        els.userPreview.innerHTML = `<span style="color:rgba(229,231,235,.75)">لا توجد حسابات مناسبة لهذا النوع — تأكد من /api/employees/meta</span>`;
      }
    }
  }

  /* ================== Roles Filtering ================== */

  function norm(x) {
    return String(x ?? "")
      .trim()
      .toLowerCase();
  }

  function roleId(r) {
    const n = Number(r?.id);
    return Number.isFinite(n) ? n : null;
  }

  function roleCode(r) {
    return norm(r?.code || r?.key || r?.slug || "");
  }

  function roleName(r) {
    return norm(r?.name || "");
  }

  function roleText(r) {
    return `${r?.name || ""} ${r?.description || ""} ${r?.code || ""} ${
      r?.key || ""
    } ${r?.slug || ""}`.toLowerCase();
  }

  function isExactSystemRole(r, key) {
    const id = roleId(r);
    const name = roleName(r);
    const code = roleCode(r);

    if (key === "admin")
      return id === 1 || name === "admin" || code === "admin";
    if (key === "teacher")
      return id === 2 || name === "teacher" || code === "teacher";
    if (key === "student")
      return id === 3 || name === "student" || code === "student";
    if (key === "parent")
      return id === 4 || name === "parent" || code === "parent";
    return false;
  }

  const TEACHER_ROLE_KEYWORDS = [
    "معلم",
    "مدرس",
    "teacher",
    "teachers",
    "تدريس",
  ];

  function isTeacherRole(r) {
    if (isExactSystemRole(r, "teacher")) return true;
    const t = roleText(r);
    return TEACHER_ROLE_KEYWORDS.some((k) => t.includes(norm(k)));
  }

  function isStudentOrParentRole(r) {
    return isExactSystemRole(r, "student") || isExactSystemRole(r, "parent");
  }

  function isAdminRole(r) {
    return isExactSystemRole(r, "admin");
  }

  function currentKind() {
    return els.isTeacher?.value === "1" ? "teacher" : "employee";
  }

  function visibleRoles() {
    const kind = currentKind();
    const all = state.roles || [];

    if (kind === "teacher") {
      return all.filter(
        (r) => !isStudentOrParentRole(r) && !isAdminRole(r) && isTeacherRole(r)
      );
    }

    return all.filter(
      (r) => !isStudentOrParentRole(r) && !isAdminRole(r) && !isTeacherRole(r)
    );
  }

  function selectedRoleIds() {
    if (!els.rolesList) return [];
    return $$("input[type='checkbox']", els.rolesList)
      .filter((x) => x.checked)
      .map((x) => Number(x.value));
  }

  function setRoleIds(ids) {
    if (!els.rolesList) return;
    const set = new Set((ids || []).map(Number));
    for (const cb of $$("input[type='checkbox']", els.rolesList)) {
      cb.checked = set.has(Number(cb.value));
    }
  }

  function applyRoleSearch() {
    if (!els.roleSearch || !els.rolesList) return;
    const q = (els.roleSearch.value || "").trim().toLowerCase();
    for (const it of $$(".emp-roleItem", els.rolesList)) {
      const name = (it.querySelector("b")?.textContent || "").toLowerCase();
      it.style.display = !q || name.includes(q) ? "" : "none";
    }
  }

  function renderRoles() {
    if (!els.rolesList) return;

    const roles = visibleRoles();
    els.rolesList.innerHTML = "";

    if (!roles.length) {
      els.rolesList.innerHTML = `
        <div class="emp-alert">
          <i class="ri-information-line"></i>
          <div>
            <div><b>لا توجد أدوار مناسبة لهذا النوع</b></div>
            <div style="margin-top:4px">
              إذا عندك أدوار للمعلمين بدون كلمة "teacher/معلم"، عدّل كلمات TEACHER_ROLE_KEYWORDS.
            </div>
          </div>
        </div>
      `;
      return;
    }

    for (const r of roles) {
      const label = document.createElement("label");
      label.className = "emp-roleItem";
      label.innerHTML = `
        <input type="checkbox" value="${r.id}">
        <b>${esc(r.name)}</b>
        <small>${esc(r.description || "")}</small>
      `;
      els.rolesList.appendChild(label);
    }
  }

  function refreshRolesUI(keepSelected = true) {
    const prev = keepSelected ? selectedRoleIds() : [];
    renderRoles();
    setRoleIds(prev);
    applyRoleSearch();
  }

  /* ================== Users select (FILTERED) ================== */

  function roleMap() {
    return new Map((state.roles || []).map((r) => [Number(r.id), r]));
  }

  function userRoleObjects(u) {
    const m = roleMap();
    const out = [];

    function pushRole(r) {
      if (!r) return;

      if (typeof r === "number" || /^\d+$/.test(String(r))) {
        const id = Number(r);
        out.push(m.get(id) || { id, name: `#${id}` });
        return;
      }

      if (typeof r === "object") {
        if (r.id != null) {
          const id = Number(r.id);
          out.push(m.get(id) || r);
        } else {
          out.push(r);
        }
        return;
      }

      out.push({ name: String(r) });
    }

    if (u.role_id != null) pushRole(u.role_id);
    if (Array.isArray(u.role_ids)) u.role_ids.forEach(pushRole);

    let rolesRaw = u.roles;
    if (typeof rolesRaw === "string") {
      try {
        rolesRaw = JSON.parse(rolesRaw);
      } catch {}
    }
    if (Array.isArray(rolesRaw)) rolesRaw.forEach(pushRole);

    if (u.role || u.role_name || u.role_code || u.role_slug) {
      out.push({
        name: u.role_name || u.role,
        code: u.role_code || u.role_slug,
      });
    }

    const seen = new Set();
    return out.filter((r) => {
      const k =
        r?.id != null
          ? `id:${r.id}`
          : `n:${String(r?.name || "").toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function classifyUser(u) {
    const roles = userRoleObjects(u);

    if (roles.some(isAdminRole)) return "admin";
    if (roles.some(isStudentOrParentRole)) return "student_parent";
    if (roles.some(isTeacherRole)) return "teacher";
    if (roles.length) return "employee";

    const t = `${u.role || ""} ${u.role_name || ""} ${
      u.username || ""
    }`.toLowerCase();
    if (t.includes("teacher") || t.includes("معلم") || t.includes("مدرس"))
      return "teacher";
    return "unknown";
  }

  function visibleUsers() {
    const kind = currentKind();
    const all = state.usersAll || [];

    if (kind === "teacher")
      return all.filter((u) => classifyUser(u) === "teacher");
    return all.filter((u) => classifyUser(u) === "employee");
  }

  function ensureSelectedUserVisible(selectedId) {
    if (!els.userSelect || !selectedId) return;

    const exists = state.users.some((u) => String(u.id) === String(selectedId));
    if (exists) return;

    const u = (state.usersAll || []).find(
      (x) => String(x.id) === String(selectedId)
    );
    if (!u) return;

    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = `⚠ ${u.username || "—"} — ${
      u.full_name || "—"
    } (غير مطابق لفلتر النوع)`;
    els.userSelect.appendChild(opt);
  }

  function userRoleLabel(u) {
    const m = roleMap();
    let rolesRaw = u.roles;

    if (typeof rolesRaw === "string") {
      try {
        rolesRaw = JSON.parse(rolesRaw);
      } catch {
        rolesRaw = null;
      }
    }

    if (Array.isArray(rolesRaw) && rolesRaw.length) {
      return rolesRaw
        .map((r) =>
          typeof r === "object" ? r.name || r.code || r.id : String(r)
        )
        .filter(Boolean)
        .join(" / ");
    }

    if (Array.isArray(u.role_ids) && u.role_ids.length) {
      return u.role_ids
        .map((id) => m.get(Number(id))?.name || `#${id}`)
        .filter(Boolean)
        .join(" / ");
    }

    return u.role_name || u.role || "";
  }

  function renderUsersSelect() {
    if (!els.userSelect) return;

    els.userSelect.innerHTML = `<option value="">— اختر —</option>`;

    for (const u of state.users) {
      const opt = document.createElement("option");
      opt.value = u.id;

      const hint = userRoleLabel(u);
      const label = `${u.username || "—"} — ${u.full_name || "—"} — ${
        u.email || "—"
      }${hint ? " — [" + hint + "]" : ""}`;
      opt.textContent = label;

      els.userSelect.appendChild(opt);
    }
  }

  function refreshUsersUI(keepSelected = true) {
    const prev = keepSelected ? els.userSelect?.value : "";
    state.users = visibleUsers();
    renderUsersSelect();

    if (prev && state.users.some((u) => String(u.id) === String(prev))) {
      els.userSelect.value = prev;
    } else {
      ensureSelectedUserVisible(prev);
      if (els.userSelect) {
        const stillExists = [...els.userSelect.options].some(
          (o) => o.value === String(prev)
        );
        els.userSelect.value = stillExists ? prev : "";
      }
    }

    previewUser(els.userSelect?.value || "");
  }

  function previewUser(id) {
    if (!els.userPreview) return;

    if (!id) {
      els.userPreview.textContent = "لم يتم اختيار حساب.";
      return;
    }

    const u = (state.usersAll || []).find((x) => Number(x.id) === Number(id));
    if (!u) {
      els.userPreview.textContent = "الحساب غير موجود.";
      return;
    }

    els.userPreview.innerHTML =
      `username: <b>${esc(u.username || "—")}</b><br>` +
      `الاسم: <b>${esc(u.full_name || "—")}</b><br>` +
      `الجوال: <b>${esc(u.phone || "—")}</b><br>` +
      `البريد: <b>${esc(u.email || "—")}</b>`;
  }

  /* ================== Tabs ================== */

  function setMainTab(tab) {
    state.mainTab = tab;

    if (els.mainTabForm)
      els.mainTabForm.classList.toggle("is-active", tab === "form");
    if (els.mainTabView)
      els.mainTabView.classList.toggle("is-active", tab === "view");

    if (els.paneForm) els.paneForm.hidden = tab !== "form";
    if (els.paneView) els.paneView.hidden = tab !== "view";

    if (tab === "view" && !state.teachers.length && !state.employees.length) {
      loadLists().catch((e) => toast(`قائمة العرض: ${e.message}`));
    }
  }

  function setViewTab(tab) {
    state.viewTab = tab;

    if (els.tabTeachers)
      els.tabTeachers.classList.toggle("is-active", tab === "teachers");
    if (els.tabEmployees)
      els.tabEmployees.classList.toggle("is-active", tab === "employees");

    if (els.teachersWrap) els.teachersWrap.hidden = tab !== "teachers";
    if (els.employeesWrap) els.employeesWrap.hidden = tab !== "employees";

    renderActiveTable();
  }

  /* ================== Tables ================== */

  function pill(ok, yes = "موجود", no = "بدون") {
    return ok
      ? `<span class="emp-pill ok"><i class="ri-check-line"></i> ${yes}</span>`
      : `<span class="emp-pill no">${no}</span>`;
  }

  function renderCounts() {
    if (els.countTeachers)
      els.countTeachers.textContent = state.teachers.length;
    if (els.countEmployees)
      els.countEmployees.textContent = state.employees.length;
  }

  function filterRows(rows) {
    const q = (els.search?.value || "").trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((e) => {
      return (
        String(e.full_name || "")
          .toLowerCase()
          .includes(q) ||
        String(e.phone || "")
          .toLowerCase()
          .includes(q) ||
        String(e.job_title || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }

  function renderTableRows(tbody, emptyEl, rows) {
    if (!tbody) return;
    tbody.innerHTML = "";

    if (emptyEl) emptyEl.hidden = rows.length > 0;

    for (const e of rows) {
      const active = !!e.is_active;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${e.id}</td>
        <td>${esc(e.full_name)}</td>
        <td>${esc(e.phone)}</td>
        <td>${esc(e.job_title || "")}</td>
        <td>${pill(!!e.user_id, "مربوط", "بدون")}</td>
        <td>${pill(active, "نشط", "موقوف")}</td>
        <td>
          <div class="emp-rowActions">
            <!-- ✅ زر تعطيل/تفعيل داخل الصف -->
            <button class="emp-btn emp-btn-ghost emp-btn-mini"
              data-toggle="${e.id}" data-active="${active ? 1 : 0}">
              <i class="${active ? "ri-forbid-2-line" : "ri-check-line"}"></i>
              <span>${active ? "تعطيل" : "تفعيل"}</span>
            </button>

            <button class="emp-btn emp-btn-ghost emp-btn-mini" data-view="${
              e.id
            }">
              <i class="ri-eye-line"></i><span>عرض</span>
            </button>
            <button class="emp-btn emp-btn-ghost emp-btn-mini" data-edit="${
              e.id
            }">
              <i class="ri-edit-line"></i><span>تعديل</span>
            </button>

            <!-- الحذف النهائي نادر -->
            <button class="emp-btn emp-btn-ghost emp-btn-mini" data-del="${
              e.id
            }">
              <i class="ri-delete-bin-6-line"></i><span>حذف</span>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function renderActiveTable() {
    if (state.viewTab === "teachers") {
      renderTableRows(
        els.teachersBody,
        els.emptyTeachers,
        filterRows(state.teachers)
      );
    } else {
      renderTableRows(
        els.employeesBody,
        els.emptyEmployees,
        filterRows(state.employees)
      );
    }
  }

  /* ================== Modal + View ================== */

  function roleNamesFromIds(ids) {
    const map = new Map((state.roles || []).map((r) => [Number(r.id), r.name]));
    const names = (ids || []).map((id) => map.get(Number(id)) || `#${id}`);
    return names.length ? names.join("، ") : "—";
  }

  function openModal() {
    if (!els.viewModal) return;
    els.viewModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!els.viewModal) return;
    els.viewModal.hidden = true;
    document.body.style.overflow = "";
  }

  function renderModalToggle(active) {
    state.lastViewedActive = !!active;
    if (!els.viewToggleBtn) return;

    const icon = els.viewToggleBtn.querySelector("i");
    const label = els.viewToggleBtn.querySelector("span");
    if (icon) icon.className = active ? "ri-forbid-2-line" : "ri-check-line";
    if (label) label.textContent = active ? "تعطيل" : "تفعيل";
  }

  async function viewEmployee(id) {
    const res = await apiFetch(`/employees/${id}`);
    const { employee, role_ids } = res.data;

    state.lastViewedId = Number(employee.id);
    renderModalToggle(!!employee.is_active);

    if (els.viewTitle)
      els.viewTitle.textContent = employee.is_teacher
        ? "بيانات المعلم"
        : "بيانات الموظف";

    if (els.viewBody) {
      els.viewBody.innerHTML = `
        <div class="emp-kv"><div class="k">الاسم</div><div class="v">${esc(
          employee.full_name
        )}</div></div>
        <div class="emp-kv"><div class="k">الجوال</div><div class="v">${esc(
          employee.phone
        )}</div></div>
        <div class="emp-kv"><div class="k">المسمى</div><div class="v">${esc(
          employee.job_title || "—"
        )}</div></div>
        <div class="emp-kv"><div class="k">النوع</div><div class="v">${
          employee.is_teacher ? "معلم" : "موظف"
        }</div></div>
        <div class="emp-kv"><div class="k">الحساب</div><div class="v">${
          employee.user_id
            ? `#${employee.user_id} (${esc(employee.username || "—")})`
            : "بدون"
        }</div></div>
        <div class="emp-kv"><div class="k">الأدوار</div><div class="v">${esc(
          roleNamesFromIds(role_ids)
        )}</div></div>
        <div class="emp-kv"><div class="k">الحالة</div><div class="v">${
          employee.is_active ? "نشط" : "موقوف"
        }</div></div>
        <div class="emp-kv"><div class="k">ملاحظات</div><div class="v">${esc(
          employee.notes || "—"
        )}</div></div>
      `;
    }

    openModal();
  }

  async function editEmployee(id) {
    const res = await apiFetch(`/employees/${id}`);
    const { employee, role_ids } = res.data;

    state.editingId = Number(employee.id);
    if (els.modeBadge) els.modeBadge.textContent = "تعديل";
    if (els.idBadge) {
      els.idBadge.hidden = false;
      els.idBadge.textContent = `#${employee.id}`;
    }

    els.fullName.value = employee.full_name || "";
    els.phone.value = employee.phone || "";
    els.jobTitle.value = employee.job_title || "";
    els.notes.value = employee.notes || "";
    els.isTeacher.value = employee.is_teacher ? "1" : "0";
    els.isActive.checked = employee.is_active !== false;

    refreshRolesUI(false);
    refreshUsersUI(false);

    els.hasAccount.checked = true;
    if (employee.user_id) {
      $("input[name='accMode'][value='link']", els.page).checked = true;
      toggleAccUI();

      ensureSelectedUserVisible(employee.user_id);
      els.userSelect.value = String(employee.user_id);
      previewUser(employee.user_id);
    } else {
      $("input[name='accMode'][value='none']", els.page).checked = true;
      toggleAccUI();
      els.userSelect.value = "";
      previewUser("");
    }

    setRoleIds(role_ids || []);
    applyRoleSearch();

    setMainTab("form");
  }

 async function toggleActive(id, nextActive) {
  const row = [...state.teachers, ...state.employees].find(
    (x) => Number(x.id) === Number(id)
  );

  const name = row?.full_name || `#${id}`;

  const ok = await empConfirm({
    title: nextActive ? "تفعيل الحساب" : "تعطيل الحساب",
    message: nextActive
      ? `سيتم تفعيل ${name} وإعادته للعمل داخل النظام.\nهل تريد المتابعة؟`
      : `سيتم تعطيل ${name} ومنعه من الاستخدام الطبيعي داخل النظام.\nهل تريد المتابعة؟`,
    confirmText: nextActive ? "تفعيل" : "تعطيل",
    cancelText: "إلغاء",
    type: nextActive ? "success" : "warning",
  });

  if (!ok) return;

  await apiFetch(`/employees/${id}/active`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: !!nextActive }),
  });

  toast(nextActive ? "تم التفعيل ✅" : "تم التعطيل ✅", "success");
  await loadLists();

  if (
    els.viewModal &&
    !els.viewModal.hidden &&
    state.lastViewedId === Number(id)
  ) {
    await viewEmployee(id);
  }
}
  async function delEmployee(id) {
  const row = [...state.teachers, ...state.employees].find(
    (x) => Number(x.id) === Number(id)
  );

  const name = row?.full_name || `#${id}`;

  const ok = await empConfirm({
    title: "حذف نهائي",
    message:
      `سيتم حذف ${name} نهائيًا.\n` +
      "لن يتم الحذف إذا كان مرتبطًا بجداول أو بيانات أخرى.\n\n" +
      "الأفضل غالبًا استخدام التعطيل بدل الحذف النهائي.",
    confirmText: "حذف نهائي",
    cancelText: "إلغاء",
    type: "danger",
  });

  if (!ok) return;

  try {
    await apiFetch(`/employees/${id}`, { method: "DELETE" });
    toast("تم الحذف النهائي ✅", "success");
    await loadLists();
  } catch (err) {
    if (err?.status === 409) {
      toast(err.message || "لا يمكن الحذف النهائي — استخدم التعطيل.", "warning");
      return;
    }

    throw err;
  }
}
  /* ================== Form ================== */

  function validate() {
    if (!els.fullName.value.trim()) throw new Error("الاسم مطلوب");
    if (!els.phone.value.trim()) throw new Error("الجوال مطلوب");

    if (!els.hasAccount.checked) return;

    const mode = accMode();
    if (mode === "link") {
      if (!els.userSelect.value) throw new Error("اختر حسابًا للربط");
    } else if (mode === "create") {
      if (!els.username.value.trim()) throw new Error("اسم المستخدم مطلوب");
      if (!els.email.value.trim()) throw new Error("البريد مطلوب");
      if (!els.password.value) throw new Error("كلمة المرور مطلوبة");
      if (els.password.value !== els.password2.value)
        throw new Error("كلمتا المرور غير متطابقتين");
    }
  }

  function buildPayload() {
    const mode = els.hasAccount.checked ? accMode() : "none";

    const payload = {
      full_name: els.fullName.value.trim(),
      phone: els.phone.value.trim(),
      job_title: els.jobTitle.value.trim() || null,
      notes: els.notes.value.trim() || null,
      is_teacher: els.isTeacher.value === "1",
      is_active: els.isActive.checked,
      role_ids: selectedRoleIds(),
      account: { mode },
    };

    if (mode === "link") payload.account.user_id = Number(els.userSelect.value);

    if (mode === "create") {
      payload.account.username = els.username.value.trim();
      payload.account.password = els.password.value;
      payload.account.email = els.email.value.trim();
    }

    return payload;
  }

  async function save() {
    validate();
    const payload = buildPayload();

    if (!state.editingId) {
      await apiFetch("/employees", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("تمت الإضافة ✅");
    } else {
      await apiFetch(`/employees/${state.editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("تم التحديث ✅");
    }

    await loadMeta();
    await loadLists();

    setMainTab("view");
    setViewTab(payload.is_teacher ? "teachers" : "employees");
    resetForm({ toForm: false });
  }

  function resetForm(opts = { toForm: true }) {
    state.editingId = null;
    if (els.modeBadge) els.modeBadge.textContent = "إضافة";
    if (els.idBadge) els.idBadge.hidden = true;

    els.form.reset();
    els.isActive.checked = true;

    if (els.hasAccount) els.hasAccount.checked = true;
    const linkRadio = $("input[name='accMode'][value='link']", els.page);
    if (linkRadio) linkRadio.checked = true;

    toggleAccUI();

    refreshRolesUI(false);
    refreshUsersUI(false);

    if (els.userSelect) els.userSelect.value = "";
    previewUser("");

    if (opts?.toForm) setMainTab("form");
  }

  /* ================== Loaders ================== */

  async function loadMeta() {
    const res = await apiFetch("/employees/meta");
    state.roles = res.data.roles || [];
    state.usersAll = res.data.users || [];

    refreshRolesUI(false);
    refreshUsersUI(false);

    applyRoleSearch();
    toggleAccUI();
  }

  async function loadLists() {
    const ts = Date.now();
    const [t, e] = await Promise.all([
      apiFetch(`/employees?tab=teachers&_=${ts}`),
      apiFetch(`/employees?tab=employees&_=${ts}`),
    ]);

    state.teachers = t.data || [];
    state.employees = e.data || [];

    renderCounts();
    renderActiveTable();
  }

  /* ================== Events ================== */

  function handleTableClick(ev) {
    // ✅ أولاً toggle
    const tgl = ev.target.closest("[data-toggle]");
    if (tgl) {
      const id = tgl.getAttribute("data-toggle");
      const cur = Number(tgl.getAttribute("data-active")) === 1;
      return toggleActive(id, !cur).catch((x) => toast(x.message));
    }

    const v = ev.target.closest("[data-view]");
    const e = ev.target.closest("[data-edit]");
    const d = ev.target.closest("[data-del]");

    const id =
      (v && v.getAttribute("data-view")) ||
      (e && e.getAttribute("data-edit")) ||
      (d && d.getAttribute("data-del"));

    if (!id) return;

    if (v) return viewEmployee(id).catch((x) => toast(x.message));
    if (e) return editEmployee(id).catch((x) => toast(x.message));
    if (d) return delEmployee(id).catch((x) => toast(x.message));
  }

  function bindEvents() {
    els.newBtn.addEventListener("click", () => resetForm({ toForm: true }));
    els.saveBtn.addEventListener("click", () => els.form.requestSubmit());

    if (els.resetBtn)
      els.resetBtn.addEventListener("click", () => resetForm({ toForm: true }));

    if (els.mainTabForm)
      els.mainTabForm.addEventListener("click", () => setMainTab("form"));
    if (els.mainTabView)
      els.mainTabView.addEventListener("click", () => setMainTab("view"));

    if (els.tabTeachers)
      els.tabTeachers.addEventListener("click", () => setViewTab("teachers"));
    if (els.tabEmployees)
      els.tabEmployees.addEventListener("click", () => setViewTab("employees"));

    if (els.search) els.search.addEventListener("input", renderActiveTable);

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", () =>
        loadLists().catch((e) => toast(e.message))
      );
    }

    if (els.hasAccount) els.hasAccount.addEventListener("change", toggleAccUI);
    for (const r of $$("input[name='accMode']", els.page))
      r.addEventListener("change", toggleAccUI);

    if (els.userSelect)
      els.userSelect.addEventListener("change", () =>
        previewUser(els.userSelect.value)
      );
    if (els.roleSearch)
      els.roleSearch.addEventListener("input", applyRoleSearch);

    if (els.isTeacher) {
      els.isTeacher.addEventListener("change", () => {
        refreshRolesUI(true);
        refreshUsersUI(true);
      });
    }

    if (els.teachersBody)
      els.teachersBody.addEventListener("click", handleTableClick);
    if (els.employeesBody)
      els.employeesBody.addEventListener("click", handleTableClick);

    els.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await save();
      } catch (err) {
        console.error(err);
        toast(err.message || "حدث خطأ");
      }
    });

    if (els.viewModal) {
      els.viewModal.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-close='1']")) closeModal();
      });
    }

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && els.viewModal && !els.viewModal.hidden)
        closeModal();
    });

    if (els.viewEditBtn) {
      els.viewEditBtn.addEventListener("click", () => {
        if (!state.lastViewedId) return;
        closeModal();
        editEmployee(state.lastViewedId).catch((x) => toast(x.message));
      });
    }

    // ✅ زر toggle داخل المودال
    if (els.viewToggleBtn) {
      els.viewToggleBtn.addEventListener("click", () => {
        if (!state.lastViewedId) return;
        const next = !state.lastViewedActive;
        toggleActive(state.lastViewedId, next).catch((x) => toast(x.message));
      });
    }
  }

  /* ================== Init / Boot ================== */

  async function init() {
    if (state._inited) return;
    state._inited = true;


    bindEvents();
    resetForm({ toForm: true });
    setMainTab("form");
    setViewTab("teachers");
    closeModal();

    try {
      await loadMeta();
      await loadLists();
      previewUser("");
    } catch (e) {
      console.error("StaffRegister init load error:", e);
      toast(`فشل التحميل: ${e.message} (status:${e.status || "?"})`);
    }
  }

  function bootWhenReady() {
    if (state._inited) return;
    if (!bind()) return;
    init();
  }

  bootWhenReady();
  const obs = new MutationObserver(() => bootWhenReady());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
