/* students.js — نسخة نهائية نظيفة ومتوافقة مع API لديك
   ✅ Fix:
   - منع تكرار event listeners عند التنقل SPA
   - نقل Drawer + Modals لنهاية body (Portal)
   - قفل السكرول بطريقة صحيحة (بدون ضياع موضع الصفحة)
   - توافق مع JSON عندك: full_name / student_code / status / phone / gender / birth_date / address / admission_date / guardian_name / guardian_phone
   - ✅ إزالة notes و nid بالكامل (لأنها غير موجودة عندك في جدول students)
*/

(function () {
  "use strict";

  const API_BASE = window.API_BASE || "http://localhost:5000/api";

  const PUBLIC_BASE =
    window.STU_PUBLIC_BASE ||
    window.PUBLIC_APP_BASE ||
    window.PUBLIC_URL ||
    location.origin;

  function getPublicPageBase() {
    const base = String(PUBLIC_BASE || location.origin).trim();
    if (!base) return `${location.origin}${location.pathname}`;
    const clean = base.split("#")[0];
    if (/\.html(\?|$)/i.test(clean)) return clean;
    return clean.replace(/\/$/, "") + location.pathname;
  }

  function getToken() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("authToken") ||
      sessionStorage.getItem("token") ||
      ""
    );
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const method = (options.method || "GET").toUpperCase();
    const hasBody = options.body != null && method !== "GET";
    if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch {
      throw new Error("تعذر الاتصال بالخادم (تحقق من الشبكة/السيرفر)");
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg =
        data && typeof data === "object" && data.message
          ? data.message
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function toast(msg) {
    if (window.Toast?.show) return window.Toast.show(msg);
    if (window.showToast) return window.showToast(msg);
    console.log(msg);
    alert(msg);
  }

  function safeJson(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function escHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function boot() {
    const page = document.getElementById("studentsPage");
    if (!page || page.__stuInited) return;
    page.__stuInited = true;
    init(page).catch((err) => console.error("Students init error:", err));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // SPA support
  if (!window.__stuMO) {
    window.__stuMO = new MutationObserver(boot);
    window.__stuMO.observe(document.body, { childList: true, subtree: true });
  }

  async function init(page) {
    const $ = (q, root = page) => root.querySelector(q);

    // Filters
    const stageEl = $("#stuStage");
    const gradeEl = $("#stuGrade");
    const secEl = $("#stuSection");
    const qEl = $("#stuSearch");
    const onlyAEl = $("#stuOnlyActive");
    const resetBtn = $("#stuReset");
    const clearBtn = $("#stuClearSearch");
    const emptyBox = $("#stuEmpty");
    const emptyReset = $("#stuEmptyReset");

    const refreshBtn = $("#stuRefreshBtn");
    const exportBtn = $("#stuExportBtn");
    const printBtn = $("#stuPrintBtn");

    const tbody = $("#stuTbody");
    const cardsWrap = $("#stuCards");

    const statTotal = $("#stuStatTotal");
    const statActive = $("#stuStatActive");
    const statInactive = $("#stuStatInactive");
    const statVisible = $("#stuStatVisible");

    // Portal (Drawer + Modals to body)
    function getOrPortal(id) {
      const inBody = document.body.querySelector(`#${id}`);
      const inPage = page.querySelector(`#${id}`);
      const el = inBody || inPage;

      if (inBody && inPage && inBody !== inPage) inPage.remove();
      if (el && el.parentElement !== document.body) document.body.appendChild(el);
      return el;
    }

    const drawer = getOrPortal("stuDrawer");
    const editM = getOrPortal("stuEdit");
    const confirmM = getOrPortal("stuConfirm");

    // Drawer els
    const dName = document.getElementById("stuD_Name");
    const dAvatar = document.getElementById("stuD_Avatar");
    const dCode = document.getElementById("stuD_Code");
    const dClass = document.getElementById("stuD_Class");
    const dStatus = document.getElementById("stuD_Status");
    const dPhone = document.getElementById("stuD_Phone");
    const dDob = document.getElementById("stuD_Dob");
    const dGender = document.getElementById("stuD_Gender");
    const dAddress = document.getElementById("stuD_Address");
    const dGName = document.getElementById("stuD_GName");
    const dGPhone = document.getElementById("stuD_GPhone");
    const dStage = document.getElementById("stuD_Stage");
    const dGrade = document.getElementById("stuD_Grade");
    const dSection = document.getElementById("stuD_Section");
    const dEnroll = document.getElementById("stuD_Enroll");

    const qrBox = document.getElementById("stuQrBox");
    const qrFallback = document.getElementById("stuQrFallback");
    const barcodeSvg = document.getElementById("stuBarcodeSvg");
    const barcodeFallback = document.getElementById("stuBarcodeFallback");
    const copyQRBtn = document.getElementById("stuCopyQRBtn");

    // Confirm delete
    const confirmName = document.getElementById("stuConfirmName");
    const confirmYes = document.getElementById("stuConfirmYes");
    let pendingDeleteId = null;

    // Edit modal
    const editForm = document.getElementById("stuEditForm");
    const editSaveBtn = document.getElementById("stuEditSaveBtn");

    const eName = document.getElementById("stuE_Name");
    const eCode = document.getElementById("stuE_Code");
    const eStatus = document.getElementById("stuE_Status");
    const ePhone = document.getElementById("stuE_Phone");
    const eGender = document.getElementById("stuE_Gender");
    const eDob = document.getElementById("stuE_Dob");
    const eStage = document.getElementById("stuE_Stage");
    const eGrade = document.getElementById("stuE_Grade");
    const eSection = document.getElementById("stuE_Section");
    const eGuardian = document.getElementById("stuE_Guardian");
    const eGuardianPhone = document.getElementById("stuE_GuardianPhone");
    const eAddress = document.getElementById("stuE_Address");

    // State
    const state = {
      list: [],
      lastVisible: [],
      allStages: [],
      allGrades: [],
      allSections: [],
      filters: { stage: "", grade: "", section: "", q: "", onlyActive: false },
      currentStudent: null,
      studentsAbort: null,
      gradesAbort: null,
      sectionsAbort: null,
    };

    function setText(el, v) {
      if (el) el.textContent = v ?? "—";
    }
    function setHTML(el, v) {
      if (el) el.innerHTML = v ?? "—";
    }

    // ===== Scroll lock (FIX) =====
    let __stuScrollY = 0;

    function lockPageScroll() {
      if (document.body.dataset.stuLocked === "1") return;
      __stuScrollY = window.scrollY || document.documentElement.scrollTop || 0;

      document.body.dataset.stuLocked = "1";
      document.body.classList.add("stu-scroll-lock");
      document.body.style.position = "fixed";
      document.body.style.top = `-${__stuScrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    }

    function unlockPageScroll() {
      if (document.body.dataset.stuLocked !== "1") return;

      document.body.dataset.stuLocked = "";
      document.body.classList.remove("stu-scroll-lock");
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";

      window.scrollTo(0, __stuScrollY);
    }

    function syncBodyLock() {
      const anyOpen = document.querySelector(".stu-modal.is-open, .stu-drawer.is-open");
      if (anyOpen) lockPageScroll();
      else unlockPageScroll();
    }

    function setModal(modal, open) {
      if (!modal) return;
      if (open) {
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
      } else {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      }
      syncBodyLock();
    }

    function openDrawer() {
      if (!drawer) return;
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      syncBodyLock();
    }

    function closeDrawer() {
      if (!drawer) return;
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      syncBodyLock();
    }

    function openConfirm(id, name) {
      pendingDeleteId = id;
      setText(confirmName, name || "—");
      setModal(confirmM, true);
    }

    function closeConfirm() {
      pendingDeleteId = null;
      setModal(confirmM, false);
    }

    function closeEditModal() {
      setModal(editM, false);
      if (editM) editM.dataset.studentId = "";
      editForm?.reset?.();
    }

    // Close bindings (once)
    if (drawer && !drawer.__closeBound) {
      drawer.__closeBound = true;
      drawer.addEventListener("click", async (e) => {
        if (e.target.closest("[data-stu-close]")) return closeDrawer();

        const btn = e.target.closest("[data-stu-action]");
        if (!btn) return;

        const action = btn.dataset.stuAction;
        const s = state.currentStudent;
        if (!s) return;

        if (action === "edit") return openEditModal(s);
        if (action === "delete") return openConfirm(s.id, s.name);
        if (action === "print") return printStudentCards([s], { title: "طباعة بطاقة طالب" });
      });
    }

    if (confirmM && !confirmM.__closeBound) {
      confirmM.__closeBound = true;
      confirmM.addEventListener("click", (e) => {
        if (e.target.closest("[data-confirm-close]")) closeConfirm();
      });
    }

    if (editM && !editM.__closeBound) {
      editM.__closeBound = true;
      editM.addEventListener("click", (e) => {
        if (e.target.closest("[data-edit-close]")) closeEditModal();
      });
    }

    // ===== Select helpers =====
    function setSelect(select, items, { allLabel = "—", getValue, getLabel } = {}) {
      if (!select) return;
      const prev = select.value;
      select.innerHTML = "";

      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = allLabel;
      select.appendChild(opt0);

      (items || []).forEach((it) => {
        const opt = document.createElement("option");
        opt.value = String(getValue ? getValue(it) : it.id);
        opt.textContent = String(getLabel ? getLabel(it) : it.name ?? it.title ?? it.label ?? it.id);
        select.appendChild(opt);
      });

      if ([...select.options].some((o) => o.value === prev)) select.value = prev;
    }

    function normalizeStatus(raw) {
      if (raw == null) return "active";
      const s = String(raw).toLowerCase();
      if (s.includes("graduated") || s.includes("متخرج")) return "graduated";
      if (s.includes("inactive") || s.includes("غير")) return "inactive";
      if (s.includes("active") || s.includes("نشط")) return "active";
      if (raw === true || raw === 1 || raw === "1") return "active";
      if (raw === false || raw === 0 || raw === "0") return "inactive";
      return "active";
    }

    function isActiveStatus(status) {
      return normalizeStatus(status) === "active";
    }

    function statusBadgeHTML(status) {
      const s = normalizeStatus(status);
      if (s === "graduated") {
        return `<span class="stu-badge stu-badge--amber"><i class="ri-medal-line"></i> متخرج</span>`;
      }
      return s === "active"
        ? `<span class="stu-badge stu-badge--ok"><i class="ri-shield-check-line"></i> نشط</span>`
        : `<span class="stu-badge stu-badge--bad"><i class="ri-shield-close-line"></i> غير نشط</span>`;
    }

    function normalizeGender(raw) {
      const s = String(raw || "").toLowerCase();
      if (s === "female" || s.includes("أنث") || s.includes("انث")) return { label: "أنثى", value: "female" };
      if (s === "male" || s.includes("ذكر")) return { label: "ذكر", value: "male" };
      return { label: raw ? String(raw) : "—", value: "male" };
    }

    // ✅ Mapping مطابق لبياناتك (بدون notes/nid)
    function normalizeStudent(row) {
      const id = row.id ?? "";
      const code = row.student_code ?? row.code ?? row.roll_number ?? id;

      const name = row.full_name ?? row.name ?? "";
      const phone = row.phone ?? "";

      const status = normalizeStatus(row.status ?? row.is_active);

      const stage_id = row.stage_id ?? "";
      const grade_id = row.grade_id ?? "";
      const section_id = row.section_id ?? "";

      const stage = row.stage_name ?? "";
      const grade = row.grade_name ?? "";
      const section = row.section_name ?? "";

      const guardian = row.guardian_name ?? "";
      const guardianPhone = row.guardian_phone ?? "";

      const address = row.address ?? "";
      const dob = row.birth_date ?? "";
      const g = normalizeGender(row.gender ?? "");
      const enroll = row.admission_date ?? row.created_at ?? "";

      return {
        id: String(id),
        code: String(code ?? ""),
        name: String(name ?? ""),
        phone: String(phone ?? ""),
        status: String(status ?? "active"),

        stage_id: String(stage_id ?? ""),
        grade_id: String(grade_id ?? ""),
        section_id: String(section_id ?? ""),

        stage: String(stage ?? ""),
        grade: String(grade ?? ""),
        section: String(section ?? ""),

        guardian: String(guardian ?? ""),
        guardianPhone: String(guardianPhone ?? ""),

        address: String(address ?? ""),
        dob: String(dob ?? ""),
        gender: String(g.label ?? "—"),
        gender_raw: String(g.value ?? ""),

        enroll: String(enroll ?? ""),
      };
    }

    // ===== Load lists =====
    async function loadStages() {
      const res = await apiFetch(`${API_BASE}/stages`).catch(() => []);
      const list = Array.isArray(res) ? res : res?.data || [];
      state.allStages = list;

      setSelect(stageEl, list, {
        allLabel: "الكل",
        getValue: (x) => x.id,
        getLabel: (x) => x.name,
      });

      setSelect(eStage, list, {
        allLabel: "—",
        getValue: (x) => x.id,
        getLabel: (x) => x.name,
      });

      if (gradeEl) {
        gradeEl.disabled = true;
        setSelect(gradeEl, [], { allLabel: "الكل" });
      }
      if (secEl) {
        secEl.disabled = true;
        setSelect(secEl, [], { allLabel: "الكل" });
      }

      if (eGrade) {
        eGrade.disabled = true;
        setSelect(eGrade, [], { allLabel: "—" });
      }
      if (eSection) {
        eSection.disabled = true;
        setSelect(eSection, [], { allLabel: "—" });
      }
    }

    async function loadGrades(stageId, targetSelect) {
      if (state.gradesAbort) state.gradesAbort.abort();
      state.gradesAbort = new AbortController();

      if (!stageId) {
        state.allGrades = [];
        if (targetSelect) {
          targetSelect.disabled = true;
          setSelect(targetSelect, [], { allLabel: targetSelect === gradeEl ? "الكل" : "—" });
        }
        return;
      }

      const res = await apiFetch(`${API_BASE}/grades?stage_id=${encodeURIComponent(stageId)}`, {
        signal: state.gradesAbort.signal,
      }).catch(() => []);

      const list = Array.isArray(res) ? res : res?.data || [];
      state.allGrades = list;

      if (targetSelect) {
        targetSelect.disabled = false;
        setSelect(targetSelect, list, {
          allLabel: targetSelect === gradeEl ? "الكل" : "—",
          getValue: (x) => x.id,
          getLabel: (x) => x.name,
        });
      }
    }

    async function loadSections(gradeId, targetSelect) {
      if (state.sectionsAbort) state.sectionsAbort.abort();
      state.sectionsAbort = new AbortController();

      if (!gradeId) {
        state.allSections = [];
        if (targetSelect) {
          targetSelect.disabled = true;
          setSelect(targetSelect, [], { allLabel: targetSelect === secEl ? "الكل" : "—" });
        }
        return;
      }

      const res = await apiFetch(`${API_BASE}/sections?grade_id=${encodeURIComponent(gradeId)}`, {
        signal: state.sectionsAbort.signal,
      }).catch(() => []);

      const list = Array.isArray(res) ? res : res?.data || [];
      state.allSections = list;

      if (targetSelect) {
        targetSelect.disabled = false;
        setSelect(targetSelect, list, {
          allLabel: targetSelect === secEl ? "الكل" : "—",
          getValue: (x) => x.id,
          getLabel: (x) => x.name,
        });
      }
    }

    // ===== Students =====
    function buildStudentsURL() {
      const u = new URL(`${API_BASE}/students`);
      const q = (state.filters.q || "").trim();
      if (q) u.searchParams.set("q", q);

      if (state.filters.stage) u.searchParams.set("stage_id", state.filters.stage);
      if (state.filters.grade) u.searchParams.set("grade_id", state.filters.grade);
      if (state.filters.section) u.searchParams.set("section_id", state.filters.section);

      // السيرفر عندك عادة يقيّد limit (أحياناً 100). نخليها 100 آمن.
      u.searchParams.set("page", "1");
      u.searchParams.set("limit", String(window.STU_FETCH_LIMIT || 100));

      u.searchParams.set("sort_by", "created_at");
      u.searchParams.set("sort_dir", "desc");
      return u.toString();
    }

    async function loadStudents() {
      if (state.studentsAbort) state.studentsAbort.abort();
      state.studentsAbort = new AbortController();

      if (tbody)
        tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:var(--text-muted)">جاري تحميل الطلاب...</td></tr>`;
      if (cardsWrap) cardsWrap.innerHTML = "";
      if (emptyBox) emptyBox.hidden = true;

      try {
        const res = await apiFetch(buildStudentsURL(), { signal: state.studentsAbort.signal });

        // شكل API عندك: {page,limit,total,pages,data:[...]}
        const rows = Array.isArray(res) ? res : res?.data || res?.students || [];
        state.list = rows.map(normalizeStudent);
        render();
      } catch (e) {
        if (String(e?.name || "").toLowerCase() === "aborterror") return;
        console.error(e);
        toast(e.message || "فشل تحميل الطلاب");
        state.list = [];
        render();
      }
    }

    function computeVisible(items) {
      const onlyActive = !!state.filters.onlyActive;
      const q = (state.filters.q || "").trim().toLowerCase();

      const st = state.filters.stage;
      const gr = state.filters.grade;
      const se = state.filters.section;

      return (items || []).filter((s) => {
        if (st && String(s.stage_id) !== String(st)) return false;
        if (gr && String(s.grade_id) !== String(gr)) return false;
        if (se && String(s.section_id) !== String(se)) return false;

        if (onlyActive && !isActiveStatus(s.status)) return false;

        if (q) {
          const hay = `${s.id} ${s.code} ${s.name} ${s.phone} ${s.guardian} ${s.guardianPhone}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function render() {
      const items = state.list || [];

      const total = items.length;
      const active = items.filter((s) => isActiveStatus(s.status)).length;
      const inactive = Math.max(0, total - active);

      if (statTotal) statTotal.textContent = String(total);
      if (statActive) statActive.textContent = String(active);
      if (statInactive) statInactive.textContent = String(inactive);

      if (tbody) tbody.innerHTML = "";
      if (cardsWrap) cardsWrap.innerHTML = "";

      if (!items.length) {
        if (emptyBox) emptyBox.hidden = false;
        if (statVisible) statVisible.textContent = "0";
        if (tbody)
          tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:var(--text-muted)">لا توجد بيانات</td></tr>`;
        state.lastVisible = [];
        return;
      }

      const visibleItems = computeVisible(items);
      state.lastVisible = visibleItems;

      if (statVisible) statVisible.textContent = String(visibleItems.length);

      if (!visibleItems.length) {
        if (emptyBox) emptyBox.hidden = false;
        if (tbody)
          tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:var(--text-muted)">لا توجد نتائج</td></tr>`;
        return;
      }

      if (emptyBox) emptyBox.hidden = true;

      for (const s of visibleItems) {
        const letter = escHtml((s.name || "؟").trim().slice(0, 1));
        const name = escHtml(s.name || "—");
        const phone = escHtml(s.phone || "—");
        const stage = escHtml(s.stage || "—");
        const grade = escHtml(s.grade || "—");
        const section = escHtml(s.section || "—");
        const guardian = escHtml(s.guardian || "—");
        const guardianPhone = escHtml(s.guardianPhone || "—");
        const code = escHtml(s.code || s.id);

        if (tbody) {
          const tr = document.createElement("tr");
          tr.dataset.stu = JSON.stringify(s);
          tr.innerHTML = `
            <td class="stu-mono">${code}</td>
            <td>
              <div class="stu-student">
                <div class="stu-avatar" aria-hidden="true">${letter}</div>
                <div>
                  <div class="stu-name">${name}</div>
                  <div class="stu-meta"><span class="stu-mono">${phone}</span></div>
                </div>
              </div>
            </td>
            <td>${stage}</td>
            <td>${grade}</td>
            <td>${section}</td>
            <td>
              <div class="stu-parent">
                <span>${guardian}</span>
                <small class="stu-mono">${guardianPhone}</small>
              </div>
            </td>
            <td>${statusBadgeHTML(s.status)}</td>
            <td>
              <div class="stu-actions">
                <button class="stu-act" type="button" data-stu-action="view" title="عرض"><i class="ri-eye-line"></i></button>
                <button class="stu-act" type="button" data-stu-action="edit" title="تعديل"><i class="ri-edit-2-line"></i></button>
                <button class="stu-act stu-act--danger" type="button" data-stu-action="delete" title="حذف"><i class="ri-delete-bin-6-line"></i></button>
                <button class="stu-act" type="button" data-stu-action="print" title="طباعة بطاقة"><i class="ri-printer-line"></i></button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        }

        if (cardsWrap) {
          const card = document.createElement("article");
          card.className = "stu-card";
          card.dataset.stu = JSON.stringify(s);
          card.innerHTML = `
            <div class="stu-card__top">
              <div class="stu-student">
                <div class="stu-avatar" aria-hidden="true">${letter}</div>
                <div>
                  <div class="stu-name">${name}</div>
                  <div class="stu-meta"><span class="stu-mono">${code}</span> • <span class="stu-mono">${phone}</span></div>
                </div>
              </div>
              ${statusBadgeHTML(s.status)}
            </div>

            <div class="stu-card__grid">
              <div><span>المرحلة:</span> ${stage}</div>
              <div><span>الصف:</span> ${grade}</div>
              <div><span>الشعبة:</span> ${section}</div>
              <div><span>ولي الأمر:</span> ${guardian}</div>
            </div>

            <div class="stu-card__actions">
              <button class="stu-btn stu-btn--soft" type="button" data-stu-action="view"><i class="ri-eye-line"></i><span>عرض</span></button>
              <button class="stu-btn stu-btn--soft" type="button" data-stu-action="edit"><i class="ri-edit-2-line"></i><span>تعديل</span></button>
              <button class="stu-btn stu-btn--soft stu-btn--danger" type="button" data-stu-action="delete"><i class="ri-delete-bin-6-line"></i><span>حذف</span></button>
            </div>
          `;
          cardsWrap.appendChild(card);
        }
      }
    }

    // ===== QR / Barcode =====
    function clearCodesUI() {
      if (qrBox) qrBox.innerHTML = "";
      if (barcodeSvg) barcodeSvg.innerHTML = "";
      if (qrFallback) qrFallback.hidden = true;
      if (barcodeFallback) barcodeFallback.hidden = true;
    }

    function buildStudentLink(student) {
      const pageBase = getPublicPageBase();
      return `${pageBase}#/students/view/${encodeURIComponent(student.id)}`;
    }

    function drawQR(text) {
      clearCodesUI();
      const hasQRCode = typeof window.QRCode === "function";
      if (hasQRCode && qrBox) {
        qrBox.innerHTML = "";
        new window.QRCode(qrBox, { text: text || "", width: 180, height: 180 });
        if (qrFallback) qrFallback.hidden = true;
      } else if (qrFallback) {
        qrFallback.hidden = false;
        qrFallback.textContent = text || "—";
      }
    }

    function drawBarcode(value) {
      const hasJsBarcode = typeof window.JsBarcode === "function";
      if (hasJsBarcode && barcodeSvg) {
        barcodeSvg.innerHTML = "";
        window.JsBarcode(barcodeSvg, value || "", {
          format: "CODE128",
          displayValue: false,
          height: 60,
          margin: 0,
        });
        if (barcodeFallback) barcodeFallback.hidden = true;
      } else if (barcodeFallback) {
        barcodeFallback.hidden = false;
        barcodeFallback.textContent = value || "—";
      }
    }

    // ===== Drawer =====
    function resetDrawerTabToPersonal() {
      if (!drawer) return;
      drawer.querySelectorAll(".stu-tab").forEach((t) => t.classList.remove("is-active"));
      drawer.querySelectorAll(".stu-tabpane").forEach((p) => p.classList.remove("is-active"));
      const firstTab =
        drawer.querySelector('.stu-tab[data-tab="personal"]') || drawer.querySelector(".stu-tab");
      const firstPane =
        drawer.querySelector('.stu-tabpane[data-pane="personal"]') || drawer.querySelector(".stu-tabpane");
      firstTab?.classList.add("is-active");
      firstPane?.classList.add("is-active");
    }

    function fillDrawer(s) {
      state.currentStudent = s;
      resetDrawerTabToPersonal();

      const letter = (s.name || "؟").trim().charAt(0) || "؟";
      setText(dAvatar, letter);

      setText(dName, s.name || "—");
      setHTML(dCode, `<i class="ri-hashtag"></i> ${escHtml(s.code || s.id || "—")}`);
      setHTML(
        dClass,
        `<i class="ri-school-line"></i> ${escHtml(s.stage || "—")} / ${escHtml(s.grade || "—")} / ${escHtml(s.section || "—")}`
      );

      const st = normalizeStatus(s.status);
      const isA = st === "active";
      const isG = st === "graduated";
      const label = isG ? "متخرج" : isA ? "نشط" : "غير نشط";
      const icon = isG ? "ri-medal-line" : isA ? "ri-shield-check-line" : "ri-shield-close-line";
      setHTML(dStatus, `<i class="${icon}"></i> ${label}`);

      setText(dPhone, s.phone || "—");
      setText(dDob, (s.dob || "—").toString().slice(0, 10) || "—");
      setText(dGender, s.gender || "—");
      setText(dAddress, s.address || "—");

      setText(dGName, s.guardian || "—");
      setText(dGPhone, s.guardianPhone || "—");

      setText(dStage, s.stage || "—");
      setText(dGrade, s.grade || "—");
      setText(dSection, s.section || "—");
      setText(dEnroll, (s.enroll || "—").toString().slice(0, 10) || "—");

      const link = buildStudentLink(s);

      const hostLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      const pubLocal = String(PUBLIC_BASE).includes("localhost") || String(PUBLIC_BASE).includes("127.0.0.1");
      if (hostLocal && pubLocal && !page.__qrWarned) {
        page.__qrWarned = true;
        toast("تنبيه: QR على localhost لن يفتح من الجوال. ضع window.PUBLIC_APP_BASE بعنوان جهازك/الدومين.");
      }

      drawQR(link);
      drawBarcode(s.code || s.id);

      if (copyQRBtn) {
        copyQRBtn.onclick = () => {
          navigator.clipboard
            ?.writeText(link)
            .then(() => toast("تم نسخ الرابط ✅"))
            .catch(() => toast(link));
        };
      }

      if (drawer) drawer.dataset.studentId = s.id;
    }

    // ===== CRUD =====
    async function deleteStudent(id) {
      await apiFetch(`${API_BASE}/students/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("تم حذف الطالب ✅");
      closeConfirm();
      closeDrawer();
      await loadStudents();
    }

    async function updateStudent(id, payload) {
      const url = `${API_BASE}/students/${encodeURIComponent(id)}`;
      try {
        return await apiFetch(url, { method: "PUT", body: JSON.stringify(payload) });
      } catch (e1) {
        try {
          return await apiFetch(url, { method: "PATCH", body: JSON.stringify(payload) });
        } catch (e2) {
          throw e2 || e1;
        }
      }
    }

    // ✅ Payload مطابق لجدولك (بدون notes/nid)
    function buildUpdatePayload() {
      const st = String(eStatus?.value || "active").toLowerCase();
      const status = st === "graduated" ? "graduated" : st === "inactive" ? "inactive" : "active";

      const toNumOrNull = (v) => (v ? Number(v) : null);

      return {
        full_name: (eName?.value || "").trim(),
        student_code: (eCode?.value || "").trim(),
        status,
        phone: (ePhone?.value || "").trim(),
        gender: eGender?.value || "male",
        birth_date: eDob?.value || "",
        address: (eAddress?.value || "").trim(),

        stage_id: toNumOrNull(eStage?.value || ""),
        grade_id: toNumOrNull(eGrade?.value || ""),
        section_id: toNumOrNull(eSection?.value || ""),

        guardian_name: (eGuardian?.value || "").trim(),
        guardian_phone: (eGuardianPhone?.value || "").trim(),
      };
    }

    async function openEditModal(student) {
      if (!student || !editM) return;

      if (eName) eName.value = student.name || "";
      if (eCode) eCode.value = student.code || student.id || "";

      const st = normalizeStatus(student.status);
      if (eStatus) eStatus.value = st;

      if (ePhone) ePhone.value = student.phone || "";

      if (eGender) eGender.value = student.gender_raw === "female" ? "female" : "male";
      if (eDob) eDob.value = (student.dob || "").slice(0, 10);

      if (eAddress) eAddress.value = student.address || "";

      if (eGuardian) eGuardian.value = student.guardian || "";
      if (eGuardianPhone) eGuardianPhone.value = student.guardianPhone || "";

      if (eStage) eStage.value = student.stage_id || "";
      await loadGrades(eStage?.value || "", eGrade);

      if (eGrade) eGrade.value = student.grade_id || "";
      await loadSections(eGrade?.value || "", eSection);

      if (eSection) eSection.value = student.section_id || "";

      editM.dataset.studentId = student.id;
      setModal(editM, true);
    }

    // Edit bindings once
    if (editM && !editM.__formBound) {
      editM.__formBound = true;

      eStage?.addEventListener("change", async () => {
        if (eGrade) eGrade.value = "";
        if (eSection) eSection.value = "";
        await loadGrades(eStage.value, eGrade);
        await loadSections("", eSection);
      });

      eGrade?.addEventListener("change", async () => {
        if (eSection) eSection.value = "";
        await loadSections(eGrade.value, eSection);
      });

      editSaveBtn?.addEventListener("click", async () => {
        const id = editM?.dataset?.studentId || "";
        if (!id) return;

        if (!eName?.value?.trim()) return toast("اسم الطالب مطلوب");

        const payload = buildUpdatePayload();

        try {
          await updateStudent(id, payload);
          toast("تم حفظ التعديل ✅");
          closeEditModal();

          await loadStudents();

          const same = state.list.find((x) => String(x.id) === String(id));
          if (drawer?.classList.contains("is-open") && same) fillDrawer(same);
        } catch (e) {
          console.error(e);
          toast(e.message || "فشل حفظ التعديل");
        }
      });
    }

    // Confirm yes once
    if (confirmM && !confirmM.__yesBound) {
      confirmM.__yesBound = true;
      confirmYes?.addEventListener("click", async () => {
        if (!pendingDeleteId) return;
        try {
          await deleteStudent(pendingDeleteId);
        } catch (e) {
          console.error(e);
          toast(e.message || "فشل الحذف");
        }
      });
    }

    // ===== CSV =====
    function downloadFile(name, content, mime) {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function toCSV(rows) {
      // ✅ بدون nid
      const header = ["id", "code", "name", "status", "stage", "grade", "section", "phone", "guardian", "guardianPhone"];
      const esc = (v) => {
        const s = String(v ?? "");
        const needs = /[",\n]/.test(s);
        const out = s.replace(/"/g, '""');
        return needs ? `"${out}"` : out;
      };

      const lines = [];
      lines.push(header.join(","));
      for (const r of rows) {
        lines.push(
          [r.id, r.code, r.name, r.status, r.stage, r.grade, r.section, r.phone, r.guardian, r.guardianPhone]
            .map(esc)
            .join(",")
        );
      }
      return "\ufeff" + lines.join("\n");
    }

    // ===== Print helpers =====
    function openPrintHTML(html) {
      const w = window.open("", "_blank", "width=980,height=720");
      if (!w) return toast("المتصفح منع نافذة الطباعة (Popup Blocker)");
      w.document.open();
      w.document.write(html);
      w.document.close();
    }

    function makeBarcodeSVG(value) {
      try {
        if (typeof window.JsBarcode !== "function") return "";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        window.JsBarcode(svg, value || "", {
          format: "CODE128",
          displayValue: true,
          fontSize: 14,
          height: 70,
          margin: 0,
        });
        return svg.outerHTML;
      } catch {
        return "";
      }
    }

    function makeQRDataUrl(text) {
      return new Promise((resolve) => {
        try {
          if (typeof window.QRCode !== "function") return resolve("");

          const holder = document.createElement("div");
          holder.style.position = "fixed";
          holder.style.left = "-99999px";
          holder.style.top = "-99999px";
          document.body.appendChild(holder);

          holder.innerHTML = "";
          new window.QRCode(holder, { text: text || "", width: 220, height: 220 });

          setTimeout(() => {
            let url = "";
            const canvas = holder.querySelector("canvas");
            const img = holder.querySelector("img");
            if (canvas) url = canvas.toDataURL("image/png");
            else if (img && img.src) url = img.src;

            holder.remove();
            resolve(url);
          }, 60);
        } catch {
          resolve("");
        }
      });
    }

    async function printStudentCards(rows, { title = "بطاقات الطلاب" } = {}) {
      rows = rows || [];
      if (!rows.length) return toast("لا توجد بيانات للطباعة");

      const cards = [];
      for (const r of rows) {
        const link = buildStudentLink(r);
        const qr = await makeQRDataUrl(link);
        const bc = makeBarcodeSVG(r.code || r.id);
        cards.push({ r, link, qr, bc });
      }

      const schoolName = window.APP_NAME || "Smart School";
      const subName = window.APP_SUBTITLE || "مركز إدارة المدرسة";
      const dt = new Date().toLocaleString("ar-EG");

      const css = `
        <style>
          :root{ --muted:#667085; --line:#eef2f7; --primary:#4f8cff; }
          *{box-sizing:border-box}
          body{margin:0; font-family:"Tajawal", Arial, sans-serif; direction:rtl; background:#fff; color:#0b1220;}
          .page{padding:16px;}
          .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
          .brand{display:flex;align-items:center;gap:10px;}
          .logo{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--primary),#1d4ed8);display:grid;place-items:center;color:#fff;font-weight:900;}
          .title{font-weight:900;font-size:16px;margin:0;}
          .subtitle{margin:2px 0 0;color:var(--muted);font-weight:700;font-size:12px;}
          .meta{color:var(--muted);font-weight:800;font-size:12px;}
          .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
          .card{border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;break-inside:avoid;}
          .cardTop{background:linear-gradient(135deg,rgba(79,140,255,.10),rgba(29,78,216,.06));padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);}
          .student{display:flex;align-items:center;gap:10px;min-width:0;}
          .avatar{width:44px;height:44px;border-radius:16px;display:grid;place-items:center;background:rgba(79,140,255,.14);border:1px solid rgba(79,140,255,.25);color:#1d4ed8;font-weight:900;flex:0 0 auto;}
          .sName{font-weight:1000;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;}
          .sMini{margin-top:2px;color:var(--muted);font-weight:800;font-size:12px;}
          .badge{padding:6px 10px;border-radius:999px;border:1px solid #e5e7eb;font-weight:1000;font-size:12px;white-space:nowrap;}
          .badge.ok{background:rgba(34,197,94,.10);border-color:rgba(34,197,94,.25);color:#16a34a;}
          .badge.bad{background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.25);color:#dc2626;}
          .badge.amb{background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.25);color:#b45309;}
          .body{padding:12px;display:grid;grid-template-columns:1fr 220px;gap:12px;align-items:start;}
          .kv{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
          .box{border:1px solid var(--line);border-radius:14px;padding:10px;}
          .k{color:var(--muted);font-weight:900;font-size:11px;}
          .v{margin-top:5px;font-weight:1000;font-size:12px;word-break:break-word;}
          .qr{border:1px dashed rgba(79,140,255,.45);border-radius:16px;padding:10px;display:grid;gap:8px;justify-items:center;background:linear-gradient(135deg,rgba(79,140,255,.08),transparent);}
          .qr img{width:170px;height:170px;object-fit:contain;}
          .qr small{color:var(--muted);font-weight:900;font-size:11px;text-align:center;}
          .bar{grid-column:1/-1;border:1px dashed rgba(79,140,255,.35);border-radius:16px;padding:10px;background:linear-gradient(135deg,rgba(79,140,255,.06),transparent);}
          .bar svg{width:100%;height:90px;}
          .foot{padding:10px 12px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-weight:800;font-size:11px;}
          @page{size:A4;margin:10mm;}
        </style>
      `;

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <title>${escHtml(title)}</title>
            <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
            ${css}
          </head>
          <body>
            <div class="page">
              <div class="head">
                <div class="brand">
                  <div class="logo">S</div>
                  <div>
                    <h1 class="title">${escHtml(schoolName)}</h1>
                    <div class="subtitle">${escHtml(subName)}</div>
                  </div>
                </div>
                <div class="meta">تم الإنشاء: ${escHtml(dt)} • العدد: ${cards.length}</div>
              </div>

              <div class="grid">
                ${cards
                  .map(({ r, link, qr, bc }) => {
                    const letter = escHtml((r.name || "؟").trim().charAt(0) || "؟");
                    const st = normalizeStatus(r.status);
                    const badgeClass = st === "graduated" ? "amb" : st === "active" ? "ok" : "bad";
                    const badgeText = st === "graduated" ? "متخرج" : st === "active" ? "نشط" : "غير نشط";

                    return `
                      <section class="card">
                        <div class="cardTop">
                          <div class="student">
                            <div class="avatar">${letter}</div>
                            <div>
                              <div class="sName">${escHtml(r.name || "—")}</div>
                              <div class="sMini">الكود: <b>${escHtml(r.code || r.id)}</b> • الهاتف: <b>${escHtml(r.phone || "—")}</b></div>
                            </div>
                          </div>
                          <div class="badge ${badgeClass}">${badgeText}</div>
                        </div>

                        <div class="body">
                          <div class="kv">
                            <div class="box">
                              <div class="k">المرحلة / الصف / الشعبة</div>
                              <div class="v">${escHtml(r.stage || "—")} / ${escHtml(r.grade || "—")} / ${escHtml(r.section || "—")}</div>
                            </div>

                            <div class="box">
                              <div class="k">ولي الأمر</div>
                              <div class="v">${escHtml(r.guardian || "—")}</div>
                            </div>

                            <div class="box">
                              <div class="k">هاتف ولي الأمر</div>
                              <div class="v">${escHtml(r.guardianPhone || "—")}</div>
                            </div>

                            <div class="box">
                              <div class="k">العنوان</div>
                              <div class="v">${escHtml(r.address || "—")}</div>
                            </div>

                            <div class="bar">
                              ${bc || `<div style="text-align:center;color:#667085;font-weight:900">Barcode غير متاح</div>`}
                            </div>
                          </div>

                          <div class="qr">
                            ${
                              qr
                                ? `<img src="${qr}" alt="QR" />`
                                : `<div style="width:170px;height:170px;display:grid;place-items:center;color:#667085;font-weight:900;border:1px solid #eef2f7;border-radius:14px">QR غير متاح</div>`
                            }
                            <small>امسح QR لفتح ملف الطالب<br/>${escHtml(link)}</small>
                          </div>
                        </div>

                        <div class="foot">
                          <div>توقيع الإدارة: ____________</div>
                          <div>ختم المدرسة: ____________</div>
                        </div>
                      </section>
                    `;
                  })
                  .join("")}
              </div>

              <script>
                window.onload = () => {
                  window.print();
                  setTimeout(() => window.close(), 250);
                };
              </script>
            </div>
          </body>
        </html>
      `;

      openPrintHTML(html);
    }

    // ===== Events =====
    stageEl?.addEventListener("change", async () => {
      state.filters.stage = stageEl.value;
      state.filters.grade = "";
      state.filters.section = "";
      if (gradeEl) gradeEl.value = "";
      if (secEl) secEl.value = "";

      await loadGrades(stageEl.value, gradeEl);
      await loadSections("", secEl);
      await loadStudents();
    });

    gradeEl?.addEventListener("change", async () => {
      state.filters.grade = gradeEl.value;
      state.filters.section = "";
      if (secEl) secEl.value = "";
      await loadSections(gradeEl.value, secEl);
      await loadStudents();
    });

    secEl?.addEventListener("change", async () => {
      state.filters.section = secEl.value;
      await loadStudents();
    });

    onlyAEl?.addEventListener("change", () => {
      state.filters.onlyActive = !!onlyAEl.checked;
      render();
    });

    qEl?.addEventListener("input", () => {
      clearTimeout(qEl.__t);
      qEl.__t = setTimeout(async () => {
        state.filters.q = qEl.value || "";
        render();
        await loadStudents();
      }, 320);
    });

    clearBtn?.addEventListener("click", async () => {
      if (qEl) qEl.value = "";
      state.filters.q = "";
      render();
      await loadStudents();
      qEl?.focus?.();
    });

    resetBtn?.addEventListener("click", async () => {
      state.filters = { stage: "", grade: "", section: "", q: "", onlyActive: false };

      if (stageEl) stageEl.value = "";
      if (gradeEl) {
        gradeEl.value = "";
        gradeEl.disabled = true;
      }
      if (secEl) {
        secEl.value = "";
        secEl.disabled = true;
      }
      if (qEl) qEl.value = "";
      if (onlyAEl) onlyAEl.checked = false;

      setSelect(gradeEl, [], { allLabel: "الكل" });
      setSelect(secEl, [], { allLabel: "الكل" });

      render();
      await loadStudents();
    });

    emptyReset?.addEventListener("click", () => resetBtn?.click());
    refreshBtn?.addEventListener("click", loadStudents);

    exportBtn?.addEventListener("click", () => {
      const rows = state.lastVisible?.length ? state.lastVisible : computeVisible(state.list);
      if (!rows.length) return toast("لا توجد بيانات للتصدير");
      const csv = toCSV(rows);
      downloadFile(`students_${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
      toast("تم تصدير CSV ✅");
    });

    printBtn?.addEventListener("click", async () => {
      const rows = state.lastVisible?.length ? state.lastVisible : computeVisible(state.list);
      await printStudentCards(rows, { title: "طباعة بطاقات الطلاب" });
    });

    // page click (once)
    if (!page.__clickBound) {
      page.__clickBound = true;
      page.addEventListener("click", async (e) => {
        const tr = e.target.closest("tbody tr");
        if (tr && !e.target.closest("[data-stu-action]") && tr.dataset.stu) {
          const s = safeJson(tr.dataset.stu);
          if (s) {
            fillDrawer(s);
            openDrawer();
          }
          return;
        }

        const btn = e.target.closest("[data-stu-action]");
        if (!btn) return;

        const action = btn.dataset.stuAction;
        const item = btn.closest("tr, .stu-card");
        const s = item?.dataset?.stu ? safeJson(item.dataset.stu) : null;
        if (!s) return;

        if (action === "view") {
          fillDrawer(s);
          openDrawer();
          return;
        }
        if (action === "edit") {
          await openEditModal(s);
          return;
        }
        if (action === "delete") {
          openConfirm(s.id, s.name);
          return;
        }
        if (action === "print") {
          await printStudentCards([s], { title: "طباعة بطاقة طالب" });
          return;
        }
      });
    }

    // Drawer tabs once
    if (drawer && !drawer.__tabsBound) {
      drawer.__tabsBound = true;
      drawer.querySelectorAll(".stu-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          drawer.querySelectorAll(".stu-tab").forEach((t) => t.classList.remove("is-active"));
          drawer.querySelectorAll(".stu-tabpane").forEach((p) => p.classList.remove("is-active"));
          tab.classList.add("is-active");
          const pane = drawer.querySelector(`.stu-tabpane[data-pane="${tab.dataset.tab}"]`);
          pane && pane.classList.add("is-active");
        });
      });
    }

    // ESC once
    if (!window.__stuEscBound) {
      window.__stuEscBound = true;
      document.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape") return;
        document.querySelectorAll(".stu-modal.is-open").forEach((m) => {
          m.classList.remove("is-open");
          m.setAttribute("aria-hidden", "true");
        });
        document.querySelectorAll(".stu-drawer.is-open").forEach((d) => {
          d.classList.remove("is-open");
          d.setAttribute("aria-hidden", "true");
        });
        syncBodyLock();
      });
    }

    // ===== Start =====
    await loadStages();
    await loadStudents();
  }
})();
