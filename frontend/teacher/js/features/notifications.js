(function () {
  // ✅ Backend origin
  const BACKEND_ORIGIN = window.location.origin;

  // ✅ Teacher notifications base
  const API_BASE = `${BACKEND_ORIGIN}/api/teacher/notifications`;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function tokenHeader() {
    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("accessToken") ||
      "";
    return token ? { Authorization: `Bearer ${token}` } : {};
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
      // حاول نقرأ JSON وإلا نقرأ نص
      let msg = `HTTP ${res.status}`;
      const ct = res.headers.get("content-type") || "";
      try {
        if (ct.includes("application/json")) {
          const j = await res.json();
          msg = j?.message || j?.error || msg;
        } else {
          const t = await res.text();
          msg = t?.slice(0, 120) || msg;
        }
      } catch {}
      throw new Error(msg);
    }

    if (res.status === 204) return null;
    return res.json();
  }

 function setBadge(count) {
  const n = Math.max(0, Number(count) || 0);

  const bell = $("nt-bell-badge");
  const chip = $("nt-inbox-unread-chip");

  if (bell) {
    bell.textContent = String(n);
    bell.classList.toggle("is-zero", n === 0);
    bell.hidden = false; // ✅ لا نخفيه أبداً
  }

  if (chip) {
    chip.textContent = String(n);
    chip.classList.toggle("is-zero", n === 0);
    chip.hidden = false; // ✅ حتى داخل التبويب يظهر 0
  }
}

  function showToast(msg, type = "info") {
    if (window.AppUI?.toast) return window.AppUI.toast(msg, type);
    if (window.toast && typeof window.toast === "function") return window.toast(msg, type);
    if (window.showToast && typeof window.showToast === "function") return window.showToast(msg, type);
    console.log(msg);
  }

  const state = {
    tab: "inbox",   // inbox | outbox | compose
    status: "all",  // all | unread | read
    q: "",
  };

  function setActiveTab(tab) {
    state.tab = tab;

    $("nt-tab-inbox")?.classList.toggle("is-active", tab === "inbox");
    $("nt-tab-outbox")?.classList.toggle("is-active", tab === "outbox");
    $("nt-tab-compose")?.classList.toggle("is-active", tab === "compose");

    $("nt-view-inbox").style.display = tab === "inbox" ? "" : "none";
    $("nt-view-outbox").style.display = tab === "outbox" ? "" : "none";
    $("nt-view-compose").style.display = tab === "compose" ? "" : "none";

    // زر "تعليم الكل مقروء" فقط للوارد
    $("nt-mark-all-read").style.display = tab === "inbox" ? "" : "none";

    closeDetail();

    refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
  }

  function setActiveStatus(status) {
    state.status = status;

    document.querySelectorAll("#nt-filters .nt-filter").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.status === status);
    });

    closeDetail();
    refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
  }

  function openDetail() {
    $("nt-detail").style.display = "";
    $("nt-view-inbox").style.display = "none";
    $("nt-view-outbox").style.display = "none";
    $("nt-view-compose").style.display = "none";
    $("nt-receipts-box").style.display = "none";
  }

  function closeDetail() {
    $("nt-detail").style.display = "none";
  }

  function isUnreadItem(it) {
    return !(it.read_at || it.readAt || it.is_read || it.isRead);
  }

  function renderInbox(items) {
    const list = $("nt-inbox-list");
    const empty = $("nt-inbox-empty");
    list.innerHTML = "";

    if (!items || items.length === 0) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const isUnread = isUnreadItem(it);

      const sender =
        it.sender_display_name ||
        it.sender_name ||
        it.senderName ||
        "—";

      const created = it.created_at || it.createdAt || "";
      const body = it.body || "";
      const snippet = it.snippet || it.body_snippet || it.bodySnippet || body || "";

      const div = document.createElement("div");
      div.className = `nt-item ${isUnread ? "nt-unread" : ""}`;
      div.innerHTML = `
        <div class="nt-item-top">
          <div>
            <div class="nt-title">${escapeHtml(it.title || "بدون عنوان")}</div>
            <div class="nt-meta">من: ${escapeHtml(sender)} • ${escapeHtml(created)}</div>
          </div>
          ${
            isUnread
              ? `<span class="nt-pill"><i class="ri-mail-unread-line"></i>غير مقروء</span>`
              : ``
          }
        </div>
        <div class="nt-snippet">${escapeHtml(String(snippet).slice(0, 140))}</div>
      `;

      div.addEventListener("click", async () => {
        try {
          openDetail();

          $("nt-detail-title").textContent = it.title || "—";
          $("nt-detail-sub").textContent = `من: ${sender} • ${created}`;
          $("nt-detail-body").textContent = body || snippet || "—";

          // ✅ تعليم كمقروء عند الفتح
          if (isUnread && it.id) {
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
    const list = $("nt-outbox-list");
    const empty = $("nt-outbox-empty");
    list.innerHTML = "";

    if (!items || items.length === 0) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const created = it.created_at || it.createdAt || "";
      const total =
        it.recipients_total ??
        it.total_recipients ??
        it.recipientsTotal ??
        0;

      const read =
        it.recipients_read ??
        it.read_count ??
        it.recipientsRead ??
        0;

      const unread = Math.max(0, (Number(total) || 0) - (Number(read) || 0));

      const body = it.body || "";
      const snippet = it.snippet || it.body_snippet || it.bodySnippet || body || "";

      const div = document.createElement("div");
      div.className = "nt-item";
      div.innerHTML = `
        <div class="nt-item-top">
          <div>
            <div class="nt-title">${escapeHtml(it.title || "بدون عنوان")}</div>
            <div class="nt-meta">${escapeHtml(created)} • المستلمون: ${escapeHtml(total)}</div>
          </div>
          <span class="nt-pill"><i class="ri-eye-line"></i>قُرئت ${escapeHtml(read)}/${escapeHtml(total)}</span>
        </div>
        <div class="nt-snippet">${escapeHtml(String(snippet).slice(0, 140))}</div>
        ${
          unread > 0
            ? `<div class="nt-meta" style="margin-top:.25rem;">غير مقروء عند ${escapeHtml(unread)} مستلم</div>`
            : ``
        }
      `;

      div.addEventListener("click", async () => {
        try {
          openDetail();

          $("nt-detail-title").textContent = it.title || "—";
          $("nt-detail-sub").textContent = `صادر • ${created}`;
          $("nt-detail-body").textContent = body || snippet || "—";

          if (!it.id) return;

          // ✅ تحميل المستلمين (Read Receipts)
          $("nt-receipts-box").style.display = "";
          $("nt-receipts-summary").textContent = `قُرئت ${read}/${total}`;
          const box = $("nt-recipients");
          box.innerHTML = `<div class="muted-box">جارِ التحميل...</div>`;

          const data = await api(`${API_BASE}/outbox/${it.id}/recipients`);
          const recs = data?.recipients || data?.items || [];

          box.innerHTML = "";
          if (!recs.length) {
            box.innerHTML = `<div class="empty-state">لا توجد بيانات مستلمين.</div>`;
            return;
          }

          for (const r of recs) {
            const name = r.name || r.full_name || r.recipient_name || "—";
            const readAt = r.read_at || r.readAt;
            const deliveredAt = r.delivered_at || r.deliveredAt || r.created_at || r.createdAt;

            const row = document.createElement("div");
            row.className = "nt-rec";
            row.innerHTML = `
              <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="nt-meta">تسليم: ${escapeHtml(deliveredAt || "—")}</div>
              </div>
              <div class="nt-pill">
                ${
                  readAt
                    ? `<i class="ri-check-line"></i>قُرئت <span>${escapeHtml(readAt)}</span>`
                    : `<i class="ri-time-line"></i>لم تُقرأ`
                }
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
    try {
      const data = await api(`${API_BASE}/unread-count`);
      const count = data?.count ?? data?.unread ?? 0;
      setBadge(Number(count) || 0);
    } catch (e) {
      // لا نكسر الواجهة
      console.log("unread-count error:", e?.message);
    }
  }

  async function refreshList() {
    const q = encodeURIComponent(state.q || "");
    const status = encodeURIComponent(state.status || "all");

    if (state.tab === "inbox") {
      const data = await api(`${API_BASE}/inbox?status=${status}&q=${q}`);
      renderInbox(data?.items || data || []);
      return;
    }

    if (state.tab === "outbox") {
      const data = await api(`${API_BASE}/outbox?status=${status}&q=${q}`);
      renderOutbox(data?.items || data || []);
      return;
    }
  }

  async function markAllRead() {
    await api(`${API_BASE}/inbox/read-all`, { method: "PATCH" });
    await refreshUnreadCount();
    await refreshList();
    showToast("تم تعليم كل الوارد كمقروء ✅");
  }

  function wireEvents() {
    $("nt-tab-inbox")?.addEventListener("click", () => setActiveTab("inbox"));
    $("nt-tab-outbox")?.addEventListener("click", () => setActiveTab("outbox"));
$("nt-tab-compose")?.addEventListener("click", async () => {
  setActiveTab("compose");
  try {
    await ensureComposeReady(); // ✅ حمّل النطاقات وفعّل أحداث الإرسال
  } catch (e) {
    showToast("خطأ تحميل بيانات الإرسال: " + e.message);
  }
});

    document.querySelectorAll("#nt-filters .nt-filter").forEach((b) => {
      b.addEventListener("click", () => setActiveStatus(b.dataset.status));
    });

    $("nt-search")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      clearTimeout(window.__ntSearchT);
      window.__ntSearchT = setTimeout(() => refreshList().catch(() => {}), 250);
    });

    $("nt-refresh")?.addEventListener("click", () => {
      refreshUnreadCount();
      refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
    });

    $("nt-mark-all-read")?.addEventListener("click", () => {
      markAllRead().catch((e) => showToast(`خطأ: ${e.message}`));
    });

    $("nt-detail-back")?.addEventListener("click", () => {
      closeDetail();
      setActiveTab(state.tab);
    });

    // ✅ عند الضغط على زر الجرس: حمّل فوراً
function openNotificationsModal() {
  // ✅ الأفضل: خلّيه يفتح بنفس نظام modals.js عندك (عن طريق الضغط على كرت الإشعارات)
  const trigger = document.querySelector('[data-modal="modal-notifications"]');
  if (trigger) {
    trigger.click();
    return;
  }

  // ✅ fallback لو ما وجد الكرت
  const modal = document.getElementById("modal-notifications");
  const overlay = document.getElementById("modal-overlay");
  if (modal) modal.style.display = "";
  if (overlay) overlay.style.display = "";
}

$("notifications-btn")?.addEventListener("click", async () => {
  openNotificationsModal();
  await refreshUnreadCount();
  setActiveTab("inbox");
});

    // ✅ عند فتح مودال الإشعارات (لو modals.js يطلق event)
    // هذا اختياري وآمن
    document.addEventListener("modal:opened", (e) => {
      if (e?.detail?.id === "modal-notifications") {
        refreshUnreadCount();
        setActiveTab("inbox");
      }
    });
  }

  function wireSocket() {
    try {
      if (!window.io) return;

      const socket = window.io(BACKEND_ORIGIN, {
        transports: ["websocket"],
      });

      // ✅ انضم لغرفة المستخدم (الأفضل) إن كان عندك endpoint /api/teacher/me يرجع id
      // لو ما عندك، تجاهل (لن يكسر شيء)
      (async () => {
        try {
          const me = await fetch(`${BACKEND_ORIGIN}/api/teacher/me`, {
            headers: tokenHeader(),
          }).then((r) => (r.ok ? r.json() : null));

          const userId = me?.id || me?.user_id || me?.userId;
          if (userId) socket.emit("join_user_room", userId);
        } catch {}
      })();

      socket.on("notification:new", () => {
        refreshUnreadCount();
        if (state.tab === "inbox") refreshList().catch(() => {});
      });

      socket.on("notification:unreadCount", (count) => setBadge(Number(count) || 0));

      socket.on("notification:receiptUpdated", () => {
        if (state.tab === "outbox") refreshList().catch(() => {});
      });
    } catch {
      // تجاهل
    }
  }
// ===== Compose (Send) =====
const compose = {
  scopes: [],
  selectedScope: null, // {academic_year_id, term, stage_id, grade_id, section_id}
  students: [],
  selectedStudents: new Set(),
  guardianPickStudentId: null,
};

function showComposeStatus(msg, isError = false) {
  const box = $("nt-compose-status");
  if (!box) return;
  box.style.display = msg ? "" : "none";
  box.style.border = isError ? "1px solid rgba(239,68,68,.35)" : "";
  box.textContent = msg || "";
  if (msg && isError && window.AppUI?.toast) window.AppUI.toast(msg, "warning");
}

function getComposeMessage() {
  const title = ($("nt-send-title")?.value || "").trim();
  const body = ($("nt-send-body")?.value || "").trim();
  return { title, body };
}

async function loadScopes() {
  const data = await api(`${API_BASE}/scopes`);
  compose.scopes = data?.items || [];
  const sel = $("nt-scope-select");
  if (!sel) return;

  sel.innerHTML = `<option value="">— اختر —</option>`;
  for (const s of compose.scopes) {
    const payload = JSON.stringify({
      academic_year_id: s.academic_year_id,
      term: s.term,
      stage_id: s.stage_id,
      grade_id: s.grade_id,
      section_id: s.section_id,
      label: `${s.stage_name} / ${s.grade_name} / ${s.section_name} (ترم ${s.term})`,
    });
    const opt = document.createElement("option");
    opt.value = payload;
    opt.textContent = `${s.stage_name} / ${s.grade_name} / ${s.section_name} (ترم ${s.term})`;
    sel.appendChild(opt);
  }
}

async function loadStudents() {
  const empty = $("nt-students-empty");
  const list = $("nt-students-list");

  if (!compose.selectedScope) {
    list.innerHTML = "";
    empty.style.display = "";
    return;
  }

  const q = encodeURIComponent(($("nt-st-search")?.value || "").trim());
  const s = compose.selectedScope;

  const data = await api(
    `${API_BASE}/students?academic_year_id=${s.academic_year_id}&term=${s.term}&section_id=${s.section_id}&q=${q}`
  );

  compose.students = data?.items || [];
  compose.selectedStudents.clear();
  $("nt-selected-count").textContent = "0";

  list.innerHTML = "";
  empty.style.display = compose.students.length ? "none" : "";

  for (const st of compose.students) {
    const row = document.createElement("div");
    row.className = "nt-item";
    row.innerHTML = `
      <div class="nt-st-row">
        <div class="nt-st-left">
          <input type="checkbox" data-stid="${st.student_id}" />
          <div>
            <div class="nt-st-name">${escapeHtml(st.student_name || st.full_name || "—")}</div>
            <div class="nt-st-code">${escapeHtml(st.student_code || "")}</div>
          </div>
        </div>

        <div class="nt-st-actions">
          <button type="button" class="nt-mini-btn" data-action="send-student" data-stid="${st.student_id}">
            <i class="ri-send-plane-2-line"></i><span>للـطالب</span>
          </button>
          <button type="button" class="nt-mini-btn" data-action="send-guardian" data-stid="${st.student_id}">
            <i class="ri-user-heart-line"></i><span>لولي أمره</span>
          </button>
        </div>
      </div>
    `;

    // checkbox select
    const cb = row.querySelector(`input[type="checkbox"]`);
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.stid);
      if (cb.checked) compose.selectedStudents.add(id);
      else compose.selectedStudents.delete(id);
      $("nt-selected-count").textContent = String(compose.selectedStudents.size);
    });

    // buttons
    row.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const studentId = Number(btn.dataset.stid);

        if (action === "send-student") {
          await sendStudentsSelected([studentId]);
        }

        if (action === "send-guardian") {
          await openGuardianPicker(studentId);
        }
      });
    });

    list.appendChild(row);
  }
}

async function sendAdmins() {
  const { title, body } = getComposeMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);

  showComposeStatus("جارِ الإرسال للإدارة...");
  const out = await api(`${API_BASE}/send/admins`, {
    method: "POST",
    body: JSON.stringify({ title, body }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال للإدارة ✅ (المستلمون: ${out?.recipients ?? 0})`);
}

async function sendStudentsSelected(studentIds) {
  const { title, body } = getComposeMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedScope) return showComposeStatus("اختر شعبة من نطاقك أولاً.", true);

  const s = compose.selectedScope;

  showComposeStatus("جارِ الإرسال للطلاب...");
  const out = await api(`${API_BASE}/send/students`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      mode: "selected",
      academic_year_id: s.academic_year_id,
      term: s.term,
      student_ids: studentIds,
    }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال ✅ (المستلمون: ${out?.recipients ?? 0})`);
}

async function sendStudentsSectionAll() {
  const { title, body } = getComposeMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedScope) return showComposeStatus("اختر شعبة من نطاقك أولاً.", true);

  const s = compose.selectedScope;

  showComposeStatus("جارِ الإرسال للشعبة كاملة...");
  const out = await api(`${API_BASE}/send/students`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      mode: "section_all",
      academic_year_id: s.academic_year_id,
      term: s.term,
      section_id: s.section_id,
    }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال للشعبة ✅ (المستلمون: ${out?.recipients ?? 0})`);
}

async function sendStudentsGradeAll() {
  const { title, body } = getComposeMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedScope) return showComposeStatus("اختر شعبة من نطاقك أولاً.", true);

  const s = compose.selectedScope;

  showComposeStatus("جارِ الإرسال للصف (ضمن الشعب التي تدرّسها)...");
  const out = await api(`${API_BASE}/send/students`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      mode: "grade_all",
      academic_year_id: s.academic_year_id,
      term: s.term,
      grade_id: s.grade_id,
    }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال للصف ✅ (المستلمون: ${out?.recipients ?? 0})`);
}

async function sendGuardiansForStudents(studentIds, guardianUserIds = null) {
  const { title, body } = getComposeMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedScope) return showComposeStatus("اختر شعبة من نطاقك أولاً.", true);

  const s = compose.selectedScope;

  showComposeStatus("جارِ الإرسال لأولياء الأمور...");
  const out = await api(`${API_BASE}/send/guardians`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      academic_year_id: s.academic_year_id,
      term: s.term,
      student_ids: studentIds,
      guardian_user_ids: guardianUserIds,
    }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال للأولياء ✅ (المستلمون: ${out?.recipients ?? 0})`);
}

async function openGuardianPicker(studentId) {
  const picker = $("nt-guardian-picker");
  const list = $("nt-guardian-list");
  if (!picker || !list) return;

  if (!compose.selectedScope) return showComposeStatus("اختر شعبة أولاً.", true);

  compose.guardianPickStudentId = studentId;
  picker.style.display = "";
  list.innerHTML = `<div class="muted-box">جارِ تحميل أولياء الأمور...</div>`;

  const data = await api(`${API_BASE}/students/${studentId}/guardians`);
  const items = data?.items || [];

  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">لا يوجد أولياء أمور مسجلين لهذا الطالب.</div>`;
    return;
  }

  for (const g of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-btn";
    btn.style.background = "linear-gradient(120deg,#0ea5e9,#2563eb)";
    btn.style.boxShadow = "none";
    btn.innerHTML = `<i class="ri-user-3-line"></i><span>${escapeHtml(g.guardian_name)}</span>`;
    btn.addEventListener("click", async () => {
      picker.style.display = "none";
      await sendGuardiansForStudents([studentId], [Number(g.guardian_user_id)]);
    });
    list.appendChild(btn);
  }
}

function wireComposeEvents() {
  $("nt-scope-select")?.addEventListener("change", async (e) => {
    showComposeStatus("");
    const v = e.target.value;
    compose.selectedScope = v ? JSON.parse(v) : null;
    await loadStudents();
  });

  $("nt-st-search")?.addEventListener("input", () => {
    clearTimeout(window.__ntStSearchT);
    window.__ntStSearchT = setTimeout(() => loadStudents().catch(()=>{}), 250);
  });

  $("nt-select-all")?.addEventListener("click", () => {
    document.querySelectorAll(`#nt-students-list input[type="checkbox"]`).forEach((cb) => {
      cb.checked = true;
      compose.selectedStudents.add(Number(cb.dataset.stid));
    });
    $("nt-selected-count").textContent = String(compose.selectedStudents.size);
  });

  $("nt-clear-selection")?.addEventListener("click", () => {
    document.querySelectorAll(`#nt-students-list input[type="checkbox"]`).forEach((cb) => (cb.checked = false));
    compose.selectedStudents.clear();
    $("nt-selected-count").textContent = "0";
  });

  $("nt-send-admins")?.addEventListener("click", () => sendAdmins().catch(e=>showToast(`خطأ: ${e.message}`)));

  $("nt-send-selected-students")?.addEventListener("click", () => {
    if (!compose.selectedStudents.size) return showComposeStatus("اختر طلابًا أولاً.", true);
    sendStudentsSelected([...compose.selectedStudents]).catch(e=>showToast(`خطأ: ${e.message}`));
  });

  $("nt-send-selected-guardians")?.addEventListener("click", () => {
    if (!compose.selectedStudents.size) return showComposeStatus("اختر طلابًا أولاً.", true);
    sendGuardiansForStudents([...compose.selectedStudents]).catch(e=>showToast(`خطأ: ${e.message}`));
  });

  $("nt-send-section")?.addEventListener("click", () => sendStudentsSectionAll().catch(e=>showToast(`خطأ: ${e.message}`)));
  $("nt-send-grade")?.addEventListener("click", () => sendStudentsGradeAll().catch(e=>showToast(`خطأ: ${e.message}`)));

  $("nt-guardian-cancel")?.addEventListener("click", () => {
    $("nt-guardian-picker").style.display = "none";
  });
}
let __composeReady = false;

async function ensureComposeReady() {
  if (__composeReady) return;

  // تأكد العناصر موجودة
  if (!$("nt-scope-select") || !$("nt-students-list")) return;

  await loadScopes();       // ✅ يعبّي select
  wireComposeEvents();      // ✅ يفعّل اختيار الشعبة + تحميل الطلاب + الإرسال
  __composeReady = true;
}

window.initTeacherNotifications = async function initTeacherNotifications() {
  wireEvents();

  // ✅ جهّز الإرسال مبكراً (حتى لو فتحت تبويب إرسال مباشرة)
  try {
    await ensureComposeReady();
  } catch (e) {
    console.log("compose init error:", e.message);
  }

  refreshUnreadCount();
  wireSocket();
};
})();