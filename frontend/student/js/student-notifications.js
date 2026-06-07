(function () {
  const BACKEND_ORIGIN = window.location.origin;
  const API_BASE = `${BACKEND_ORIGIN}/api/student/notifications`;

  const $ = (id) => document.getElementById(id);

  function token() {
    return localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
  }
  function tokenHeader() {
    const t = token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  function decodeJwtId() {
    try {
      const t = token();
      if (!t || !t.includes(".")) return null;
      const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(p));
      return json?.id ?? null;
    } catch {
      return null;
    }
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...tokenHeader(),
        ...(opts.headers || {}),
      },
      credentials: "include",
      ...opts,
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json();
          msg = j?.message || j?.error || msg;
        } else {
          msg = (await res.text()).slice(0, 120) || msg;
        }
      } catch {}
      throw new Error(msg);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  function showToast(msg, type = "info") {
    if (window.AppUI?.toast) return window.AppUI.toast(msg, type);
    if (window.toast) return window.toast(msg, type);
    const t = $("toast");
    if (!t) return console.log(msg);
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window.__stToastT);
    window.__stToastT = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ===== Modal open (fallback بسيط) =====
  function openModal(modalId) {
    const modal = $(modalId);
    const overlay = $("modal-overlay");
    if (!modal || !overlay) return;
    overlay.style.display = "flex";
    modal.style.display = "flex";
  }

  // ===== Badge =====
  function setBadge(count) {
    const b = $("st-nt-bell-badge");
    const chip = $("st-nt-inbox-unread-chip");
    const n = Number(count) || 0;
    if (b) b.textContent = String(n);
    if (chip) chip.textContent = String(n);
  }

  // ===== State =====
  const state = { tab: "inbox", status: "all", q: "" };

  function setActiveTab(tab) {
    state.tab = tab;

    $("st-nt-tab-inbox")?.classList.toggle("is-active", tab === "inbox");
    $("st-nt-tab-outbox")?.classList.toggle("is-active", tab === "outbox");
    $("st-nt-tab-compose")?.classList.toggle("is-active", tab === "compose");

    $("st-nt-view-inbox").style.display = tab === "inbox" ? "" : "none";
    $("st-nt-view-outbox").style.display = tab === "outbox" ? "" : "none";
    $("st-nt-view-compose").style.display = tab === "compose" ? "" : "none";

    $("st-nt-mark-all-read").style.display = tab === "inbox" ? "" : "none";

    closeDetail();
    refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
  }

  function setActiveStatus(status) {
    state.status = status;
    document.querySelectorAll("#st-nt-filters .st-nt-filter").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.status === status);
    });
    closeDetail();
    refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
  }

  function openDetail() {
    $("st-nt-detail").style.display = "";
    $("st-nt-view-inbox").style.display = "none";
    $("st-nt-view-outbox").style.display = "none";
    $("st-nt-view-compose").style.display = "none";
    $("st-nt-receipts-box").style.display = "none";
  }

  function closeDetail() {
    $("st-nt-detail").style.display = "none";
  }

  function isUnreadItem(it) {
    return !(it.read_at || it.readAt || it.is_read || it.isRead);
  }

  function renderInbox(items) {
    const list = $("st-nt-inbox-list");
    const empty = $("st-nt-inbox-empty");
    list.innerHTML = "";

    if (!items?.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const unread = isUnreadItem(it);
      const sender = it.sender_name || "—";
      const created = it.created_at || "";
      const snippet = (it.body || "").slice(0, 140);

      const div = document.createElement("div");
      div.className = `st-nt-item ${unread ? "st-nt-unread" : ""}`;
      div.innerHTML = `
        <div class="st-nt-item-top">
          <div>
            <div class="st-nt-title">${it.title || "بدون عنوان"}</div>
            <div class="st-nt-meta">من: ${sender} • ${created}</div>
          </div>
          ${unread ? `<span class="st-nt-pill"><i class="ri-mail-unread-line"></i>غير مقروء</span>` : ``}
        </div>
        <div class="st-nt-meta" style="margin-top:.35rem;">${snippet}</div>
      `;

      div.addEventListener("click", async () => {
        try {
          openDetail();
          $("st-nt-detail-title").textContent = it.title || "—";
          $("st-nt-detail-sub").textContent = `من: ${sender} • ${created}`;
          $("st-nt-detail-body").textContent = it.body || "—";

          if (unread && it.id) {
            await api(`${API_BASE}/inbox/${it.id}/read`, { method: "PATCH" });
            await refreshUnreadCount();
            await refreshList();
          }
        } catch (e) {
          showToast(`خطأ: ${e.message}`);
        }
      });

      list.appendChild(div);
    }
  }

  function renderOutbox(items) {
    const list = $("st-nt-outbox-list");
    const empty = $("st-nt-outbox-empty");
    list.innerHTML = "";

    if (!items?.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const created = it.created_at || "";
      const total = it.recipients_total ?? 0;
      const read = it.recipients_read ?? 0;

      const div = document.createElement("div");
      div.className = "st-nt-item";
      div.innerHTML = `
        <div class="st-nt-item-top">
          <div>
            <div class="st-nt-title">${it.title || "بدون عنوان"}</div>
            <div class="st-nt-meta">${created} • المستلمون: ${total}</div>
          </div>
          <span class="st-nt-pill"><i class="ri-eye-line"></i>قُرئت ${read}/${total}</span>
        </div>
        <div class="st-nt-meta" style="margin-top:.35rem;">${(it.body||"").slice(0,140)}</div>
      `;

      div.addEventListener("click", async () => {
        try {
          openDetail();
          $("st-nt-detail-title").textContent = it.title || "—";
          $("st-nt-detail-sub").textContent = `صادر • ${created}`;
          $("st-nt-detail-body").textContent = it.body || "—";

          $("st-nt-receipts-box").style.display = "";
          $("st-nt-receipts-summary").textContent = `قُرئت ${read}/${total}`;

          const box = $("st-nt-recipients");
          box.innerHTML = `<div class="muted-box">جارِ التحميل...</div>`;

          const data = await api(`${API_BASE}/outbox/${it.id}/recipients`);
          const recs = data?.items || [];
          box.innerHTML = "";

          for (const r of recs) {
            const row = document.createElement("div");
            row.className = "muted-box";
            row.style.margin = "0";
            row.innerHTML = `
              <strong>${r.recipient_name || "—"}</strong>
              <div style="margin-top:.25rem;">
                ${r.is_read ? "✅ قُرئت" : "⏳ لم تُقرأ"}
                ${r.read_at ? ` • ${r.read_at}` : ""}
              </div>
            `;
            box.appendChild(row);
          }
        } catch (e) {
          showToast(`خطأ: ${e.message}`);
        }
      });

      list.appendChild(div);
    }
  }

  async function refreshUnreadCount() {
    const data = await api(`${API_BASE}/unread-count`);
    setBadge(data?.count ?? 0);
  }

  async function refreshList() {
    const q = encodeURIComponent(state.q || "");
    const status = encodeURIComponent(state.status || "all");

    if (state.tab === "inbox") {
      const data = await api(`${API_BASE}/inbox?status=${status}&q=${q}`);
      renderInbox(data?.items || []);
      return;
    }

    if (state.tab === "outbox") {
      const data = await api(`${API_BASE}/outbox?status=all&q=${q}`);
      renderOutbox(data?.items || []);
      return;
    }

    // compose: لا شيء
  }

  async function markAllRead() {
    await api(`${API_BASE}/inbox/read-all`, { method: "PATCH" });
    await refreshUnreadCount();
    await refreshList();
    showToast("تم تعليم كل الوارد كمقروء ✅");
  }

  // ===== Compose =====
  const compose = { teachers: [], selected: new Set() };

  function setComposeStatus(msg, isError = false) {
    const box = $("st-nt-compose-status");
    if (!box) return;
    box.style.display = msg ? "" : "none";
    box.style.border = isError ? "1px solid rgba(239,68,68,.35)" : "";
    box.textContent = msg || "";
    if (msg && isError && window.AppUI?.toast) window.AppUI.toast(msg, "warning");
  }

  function getComposeMsg() {
    return {
      title: ($("st-nt-title")?.value || "").trim(),
      body: ($("st-nt-body")?.value || "").trim(),
    };
  }

  async function loadTeachers(q = "") {
    const data = await api(`${API_BASE}/teachers?q=${encodeURIComponent(q)}`);
    compose.teachers = data?.items || [];
    renderTeachers();
  }

  function renderTeachers() {
    const list = $("st-nt-teachers-list");
    const empty = $("st-nt-teachers-empty");
    list.innerHTML = "";

    if (!compose.teachers.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const t of compose.teachers) {
      const uid = Number(t.teacher_user_id);
      const box = document.createElement("div");
      box.className = "st-nt-item";
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:.6rem;align-items:center;">
          <div>
            <div class="st-nt-title">${t.teacher_name}</div>
            ${t.subjects?.length ? `<div class="st-nt-meta">مواد: ${t.subjects.join("، ")}</div>` : ``}
          </div>
          <input type="checkbox" data-uid="${uid}" />
        </div>
      `;

      const cb = box.querySelector("input[type=checkbox]");
      cb.checked = compose.selected.has(uid);

      cb.addEventListener("change", () => {
        if (cb.checked) compose.selected.add(uid);
        else compose.selected.delete(uid);
        $("st-nt-selected-count").textContent = String(compose.selected.size);
      });

      list.appendChild(box);
    }
  }

  async function sendAdmins() {
    const { title, body } = getComposeMsg();
    if (!title || !body) return setComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);

    setComposeStatus("جارِ الإرسال للإدارة...");
    const out = await api(`${API_BASE}/send/admins`, {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
    setComposeStatus("");
    showToast(`تم الإرسال للإدارة ✅ (المستلمون: ${out?.recipients ?? 0})`);
    setActiveTab("outbox");
  }

  async function sendTeachersSelected() {
    const { title, body } = getComposeMsg();
    if (!title || !body) return setComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
    if (!compose.selected.size) return setComposeStatus("اختر معلمين أولاً.", true);

    setComposeStatus("جارِ الإرسال للمعلمين...");
    const out = await api(`${API_BASE}/send/teachers`, {
      method: "POST",
      body: JSON.stringify({ title, body, mode: "selected", teacher_user_ids: [...compose.selected] }),
    });
    setComposeStatus("");
    showToast(`تم الإرسال ✅ (المستلمون: ${out?.recipients ?? 0})`);
    setActiveTab("outbox");
  }

  async function sendTeachersAll() {
    const { title, body } = getComposeMsg();
    if (!title || !body) return setComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);

    setComposeStatus("جارِ الإرسال لكل معلميّ...");
    const out = await api(`${API_BASE}/send/teachers`, {
      method: "POST",
      body: JSON.stringify({ title, body, mode: "all" }),
    });
    setComposeStatus("");
    showToast(`تم الإرسال ✅ (المستلمون: ${out?.recipients ?? 0})`);
    setActiveTab("outbox");
  }

  function wireEvents() {
    $("st-nt-tab-inbox")?.addEventListener("click", () => setActiveTab("inbox"));
    $("st-nt-tab-outbox")?.addEventListener("click", () => setActiveTab("outbox"));
    $("st-nt-tab-compose")?.addEventListener("click", () => {
      setActiveTab("compose");
      loadTeachers().catch(()=>{});
    });

    document.querySelectorAll("#st-nt-filters .st-nt-filter").forEach((b) => {
      b.addEventListener("click", () => setActiveStatus(b.dataset.status));
    });

    $("st-nt-search")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      clearTimeout(window.__stNtSearchT);
      window.__stNtSearchT = setTimeout(() => refreshList().catch(()=>{}), 250);
    });

    $("st-nt-refresh")?.addEventListener("click", () => {
      refreshUnreadCount().catch(()=>{});
      refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
    });

    $("st-nt-mark-all-read")?.addEventListener("click", () => {
      markAllRead().catch((e) => showToast(`خطأ: ${e.message}`));
    });

    $("st-nt-detail-back")?.addEventListener("click", () => {
      closeDetail();
      setActiveTab(state.tab);
    });

    // الجرس يفتح مودال الإشعارات
    $("notifications-btn")?.addEventListener("click", () => {
      openModal("modal-inbox");
      refreshUnreadCount().catch(()=>{});
      setActiveTab("inbox");
    });

    // compose
    $("st-nt-send-admins")?.addEventListener("click", () => sendAdmins().catch(e=>showToast(e.message)));
    $("st-nt-send-teachers-selected")?.addEventListener("click", () => sendTeachersSelected().catch(e=>showToast(e.message)));
    $("st-nt-send-teachers-all")?.addEventListener("click", () => sendTeachersAll().catch(e=>showToast(e.message)));

    $("st-nt-teacher-search")?.addEventListener("input", (e) => {
      clearTimeout(window.__stNtTeacherT);
      window.__stNtTeacherT = setTimeout(() => loadTeachers(e.target.value || "").catch(()=>{}), 250);
    });
  }

  function wireSocket() {
    try {
      if (!window.io) return;
      const socket = window.io(BACKEND_ORIGIN, { transports: ["websocket"] });

      const uid = decodeJwtId();
      if (uid) socket.emit("join_user_room", uid);

      socket.on("notification:new", () => {
        refreshUnreadCount().catch(()=>{});
        if (state.tab === "inbox") refreshList().catch(()=>{});
      });
    } catch {}
  }

  window.initStudentNotifications = function () {
    wireEvents();
    refreshUnreadCount().catch(()=>{});
    wireSocket();
  };
})();