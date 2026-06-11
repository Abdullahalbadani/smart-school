(function () {
  const BACKEND_ORIGIN = window.location.origin;
  const API_BASE = `${BACKEND_ORIGIN}/api/parent/notifications`;

  const $ = (id) => document.getElementById(id);

  function tokenHeader() {
    const token = localStorage.getItem("token") || localStorage.getItem("accessToken") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...tokenHeader(), ...(opts.headers || {}) },
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
          msg = (await res.text())?.slice(0, 200) || msg;
        }
      } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function showToast(msg, type = "info") {
    if (window.AppUI?.toast) return window.AppUI.toast(msg, type);
    if (window.toast && typeof window.toast === "function") return window.toast(msg, type);
    if (window.showToast && typeof window.showToast === "function") return window.showToast(msg, type);
    console.log(msg);
  }

  // ===== تاريخ واضح ومفهوم (صغير/كبير) =====
  // أمثلة: "اليوم 10:35 م" ، "أمس 8:10 ص" ، "26 فبراير 2026 • 10:51 م"
  function formatDatePretty(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    const now = new Date();

    // بداية اليوم
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

    const timeFmt = new Intl.DateTimeFormat("ar-YE", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);

    if (diffDays === 0) return `اليوم ${timeFmt}`;
    if (diffDays === 1) return `أمس ${timeFmt}`;

    const dateFmt = new Intl.DateTimeFormat("ar-YE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);

    return `${dateFmt} • ${timeFmt}`;
  }

  // نلف التاريخ بـ dir=ltr لمنع التقطيع في RTL (خاصة +03 / ISO)
  function ltrSpan(text) {
    return `<span dir="ltr" style="unicode-bidi: embed; display:inline-block;">${text}</span>`;
  }

  // ===== Badge on bell =====
  function ensureBellBadge() {
    const btn = $("notifications-btn");
    if (!btn) return null;
    let badge = $("nt-bell-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "nt-bell-badge";
      badge.style.position = "absolute";
      badge.style.top = "-6px";
      badge.style.insetInlineStart = "-6px";
      badge.style.minWidth = "18px";
      badge.style.height = "18px";
      badge.style.padding = "0 6px";
      badge.style.borderRadius = "999px";
      badge.style.display = "inline-flex";
      badge.style.alignItems = "center";
      badge.style.justifyContent = "center";
      badge.style.fontSize = "12px";
      badge.style.fontWeight = "800";
      badge.style.lineHeight = "18px";
      badge.style.background = "rgba(148,163,184,.55)";
      badge.style.color = "#fff";
      btn.style.position = "relative";
      btn.appendChild(badge);
    }
    return badge;
  }

  function setBadge(count) {
    const b = ensureBellBadge();
    const chip = $("nt-inbox-unread-chip");
    const dot = $("notif-dot");

    const n = Number(count) || 0;
    if (b) {
      b.textContent = String(n);
      b.style.background = n > 0 ? "#ef4444" : "rgba(148,163,184,.55)";
    }
    if (chip) chip.textContent = String(n);
    if (dot) dot.hidden = !(n > 0);
  }

  async function refreshUnreadCount() {
    const data = await api(`${API_BASE}/unread-count`);
    setBadge(data?.count ?? 0);
  }

  // ===== Modal open/close =====


  // ===== UI State =====
  const state = { tab: "inbox", status: "all", q: "" };

  function setActiveTab(tab) {
    state.tab = tab;
    $("nt-tab-inbox")?.classList.toggle("is-active", tab === "inbox");
    $("nt-tab-outbox")?.classList.toggle("is-active", tab === "outbox");
    $("nt-tab-compose")?.classList.toggle("is-active", tab === "compose");

    $("nt-view-inbox").style.display = tab === "inbox" ? "" : "none";
    $("nt-view-outbox").style.display = tab === "outbox" ? "" : "none";
    $("nt-view-compose").style.display = tab === "compose" ? "" : "none";

    $("nt-mark-all-read").style.display = tab === "inbox" ? "" : "none";
    closeDetail();

    refreshList().catch((e) => showToast(`خطأ: ${e.message}`));
    if (tab === "compose") loadCompose().catch(() => {});
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
function formatArabicDateTime(input) {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d)) return input;

  const date = d.toLocaleDateString("ar-YE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const time = d.toLocaleTimeString("ar-YE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${date} • ${time}`;
}
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  async function openProtectedNotificationAttachment(url, download = false) {
    const res = await fetch(url, {
      headers: { ...tokenHeader() },
      credentials: "include",
    });
    if (!res.ok) throw new Error("تعذر فتح المرفق");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    if (download) a.download = "";
    else a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }

  function renderNotificationAttachments(item, bodyElementId = "nt-detail-body") {
    document.getElementById("nt-detail-attachments-runtime")?.remove();
    const bodyEl = $(bodyElementId);
    const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
    if (!bodyEl || !attachments.length) return;

    const wrap = document.createElement("section");
    wrap.id = "nt-detail-attachments-runtime";
    wrap.style.marginTop = "12px";
    wrap.style.paddingTop = "10px";
    wrap.style.borderTop = "1px dashed rgba(148,163,184,.35)";
    wrap.innerHTML = `
      <strong style="display:block;margin-bottom:8px;">المرفقات</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${attachments.map((a) => {
          const label = escapeHtml(a.label || a.name || "فتح المرفق");
          if (a.kind === "link" && a.url) {
            return `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="nt-pill">🔗 ${label}</a>`;
          }
          if (!a.view_url) return "";
          return `<button type="button" class="nt-pill nt-runtime-attachment" data-view-url="${escapeHtml(a.view_url)}" data-download-url="${escapeHtml(a.download_url || a.view_url)}">📎 ${label}</button>`;
        }).join("")}
      </div>
    `;
    bodyEl.insertAdjacentElement("afterend", wrap);
    wrap.querySelectorAll(".nt-runtime-attachment").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await openProtectedNotificationAttachment(btn.dataset.viewUrl, false);
        } catch (error) {
          showToast(error.message || "تعذر فتح المرفق", "error");
        }
      });
      btn.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await openProtectedNotificationAttachment(btn.dataset.downloadUrl, true);
        } catch (error) {
          showToast(error.message || "تعذر تنزيل المرفق", "error");
        }
      });
    });
  }

  function renderInbox(items) {
    const list = $("nt-inbox-list");
    const empty = $("nt-inbox-empty");
    list.innerHTML = "";

    if (!items?.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const unread = isUnreadItem(it);
const sender =
  it.sender_display_name?.trim() ||
  it.sender_name ||
  it.sender?.name ||
  "وليّ الأمر";      const createdPretty = formatDatePretty(it.created_at);
      const body = it.body || "";

      const div = document.createElement("div");
      div.className = `nt-item ${unread ? "nt-unread" : ""}`;
      div.innerHTML = `
        <div class="nt-item-top">
          <div>
            <div class="nt-title">${escapeHtml(it.title || "بدون عنوان")}</div>
            <div class="nt-meta">من: ${escapeHtml(sender)} • ${ltrSpan(escapeHtml(createdPretty))}</div>
          </div>
          ${
            unread
              ? `<span class="nt-pill"><i class="ri-mail-unread-line"></i>غير مقروء</span>`
              : ``
          }
        </div>
        <div class="nt-snippet">${escapeHtml(String(body).slice(0, 140))}</div>
      `;

      div.addEventListener("click", async () => {
        openDetail();

        $("nt-detail-title").textContent = it.title || "—";
        // ✅ نفس التنسيق الواضح داخل التفاصيل
        $("nt-detail-sub").innerHTML = `من: ${escapeHtml(sender)} • ${ltrSpan(escapeHtml(createdPretty))}`;
        $("nt-detail-body").textContent = body || "—";
        renderNotificationAttachments(it);

        if (unread && it.id) {
          await api(`${API_BASE}/inbox/${it.id}/read`, { method: "PATCH" });
          await refreshUnreadCount();
          await refreshList();
        }
      });

      list.appendChild(div);
    }
  }

  function renderOutbox(items) {
    const list = $("nt-outbox-list");
    const empty = $("nt-outbox-empty");
    list.innerHTML = "";

    if (!items?.length) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";

    for (const it of items) {
      const createdPretty = formatDatePretty(it.created_at);
      const total = it.recipients_total ?? 0;
      const read = it.recipients_read ?? 0;

      const div = document.createElement("div");
      div.className = "nt-item";
      div.innerHTML = `
        <div class="nt-item-top">
          <div>
            <div class="nt-title">${escapeHtml(it.title || "بدون عنوان")}</div>
            <div class="nt-meta">${ltrSpan(escapeHtml(createdPretty))} • المستلمون: ${escapeHtml(total)}</div>
          </div>
          <span class="nt-pill"><i class="ri-eye-line"></i>قُرئت ${escapeHtml(read)}/${escapeHtml(total)}</span>
        </div>
        <div class="nt-snippet">${escapeHtml(String(it.body || "").slice(0, 140))}</div>
      `;

      div.addEventListener("click", async () => {
        openDetail();
        $("nt-detail-title").textContent = it.title || "—";
        $("nt-detail-sub").innerHTML = `صادر • ${ltrSpan(escapeHtml(createdPretty))}`;
        $("nt-detail-body").textContent = it.body || "—";

        if (!it.id) return;

        $("nt-receipts-box").style.display = "";
        $("nt-receipts-summary").textContent = `قُرئت ${read}/${total}`;
        const box = $("nt-recipients");
        box.innerHTML = `<div class="muted-box">جارِ التحميل...</div>`;

        const data = await api(`${API_BASE}/outbox/${it.id}/recipients`);
        const recs = data?.recipients || [];

        box.innerHTML = "";
        if (!recs.length) {
          box.innerHTML = `<div class="empty-state">لا توجد بيانات مستلمين.</div>`;
          return;
        }

        for (const r of recs) {
          const row = document.createElement("div");
          row.className = "nt-rec";
          row.innerHTML = `
            <div>
              <strong>${escapeHtml(r.name || "—")}</strong>
              <div class="nt-meta">تسليم: ${ltrSpan(escapeHtml(formatDatePretty(r.delivered_at || r.created_at || "")))}</div>
            </div>
            <div class="nt-pill">
              ${
                r.read_at
                  ? `<i class="ri-check-line"></i>قُرئت`
                  : `<i class="ri-time-line"></i>لم تُقرأ`
              }
              ${r.read_at ? `<span>${ltrSpan(escapeHtml(formatDatePretty(r.read_at)))}</span>` : ""}
            </div>
          `;
          box.appendChild(row);
        }
      });

      list.appendChild(div);
    }
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
      const data = await api(`${API_BASE}/outbox?q=${q}`);
      renderOutbox(data?.items || []);
    }
  }

  async function markAllRead() {
    await api(`${API_BASE}/inbox/read-all`, { method: "PATCH" });
    await refreshUnreadCount();
    await refreshList();
    showToast("تم تعليم كل الوارد كمقروء ✅");
  }

  // ===== Compose =====
 // ===== Compose =====
const compose = {
  children: [],
  teachers: [],
  selectedChildId: null,
  selectedTeacherUserIds: new Set(),
};

function showComposeStatus(msg, isError = false) {
  const box = $("nt-compose-status");
  if (!box) return;
  box.style.display = msg ? "" : "none";
  box.style.border = isError ? "1px solid rgba(239,68,68,.35)" : "";
  box.textContent = msg || "";
  if (msg && isError && window.AppUI?.toast) window.AppUI.toast(msg, "warning");
}

function getMessage() {
  const title = ($("nt-send-title")?.value || "").trim();
  const body = ($("nt-send-body")?.value || "").trim();
  return { title, body };
}

// شريط أدوات فوق قائمة المعلمين (ينشأ تلقائياً لو غير موجود في HTML)
function ensureTeachersToolbar() {
  const listEl = $("nt-teachers-list");
  if (!listEl) return null;

  let bar = $("nt-teachers-toolbar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "nt-teachers-toolbar";
  bar.className = "nt-teachers-toolbar";

  bar.innerHTML = `
    <div class="left">
      <button id="nt-te-select-all" class="nt-pill-btn ghost" type="button">
        <i class="ri-select-all-line"></i> تحديد الكل
      </button>
      <button id="nt-te-clear" class="nt-pill-btn ghost" type="button">
        <i class="ri-close-circle-line"></i> إلغاء التحديد
      </button>
      <span id="nt-te-selected-count" class="count">المحدد: 0</span>
    </div>

    <div class="right">
      <button id="nt-te-send-selected" class="nt-pill-btn primary" type="button">
        <i class="ri-send-plane-2-line"></i> إرسال للمحدد
      </button>
      <button id="nt-te-send-all" class="nt-pill-btn warn" type="button">
        <i class="ri-user-star-line"></i> إرسال للجميع
      </button>
    </div>
  `;

  listEl.parentElement.insertBefore(bar, listEl);
  return bar;
}

function updateSelectedCountUI() {
  const el = $("nt-te-selected-count");
  if (el) el.textContent = `المحدد: ${compose.selectedTeacherUserIds.size}`;
}

// يساعدنا نعرف من المعلمين المعروضين (بعد الفلترة)
function getVisibleTeachers() {
  const q = ($("nt-te-search")?.value || "").trim();
  const list = compose.teachers || [];
  if (!q) return list;

  const qq = q.toLowerCase();
  return list.filter((t) => String(t.teacher_name || "").toLowerCase().includes(qq));
}

async function sendToTeacherUserIds(ids) {
  const { title, body } = getMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedChildId) return showComposeStatus("اختر ابنًا أولاً.", true);

  const clean = [...new Set(ids.map(Number).filter(Boolean))];
  if (!clean.length) return showComposeStatus("لم يتم اختيار أي معلم.", true);

  showComposeStatus("جارِ الإرسال...");
  await api(`${API_BASE}/send/teachers`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      student_id: compose.selectedChildId,
      teacher_user_ids: clean,
    }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال ✅ (إلى ${clean.length} معلم/معلمين)`);
}

function renderTeachersList() {
  const list = $("nt-teachers-list");
  const empty = $("nt-teachers-empty");
  if (!list || !empty) return;

  list.innerHTML = "";
  empty.style.display = "none";

  if (!compose.selectedChildId) {
    empty.style.display = "";
    empty.textContent = "اختر ابنًا أولاً.";
    return;
  }

  const teachers = getVisibleTeachers();
  if (!teachers.length) {
    empty.style.display = "";
    empty.textContent = "لا يوجد معلمون لهذا الابن حالياً.";
    return;
  }

  for (const t of teachers) {
    const uid = Number(t.teacher_user_id);
    const checked = compose.selectedTeacherUserIds.has(uid);

    const card = document.createElement("div");
    card.className = "nt-teacher-card";

    const subjects = Array.isArray(t.subjects) ? t.subjects.filter(Boolean) : [];

    card.innerHTML = `
      <div class="nt-teacher-left">
        <input type="checkbox"
          class="nt-teacher-checkbox"
          data-uid="${uid}"
          ${checked ? "checked" : ""}/>
        <div class="nt-teacher-info">
          <div class="nt-teacher-name">${escapeHtml(t.teacher_name || "—")}</div>
          <div class="nt-teacher-meta">${subjects.length ? "المواد التي يدرّسها لابنك:" : "اضغط إرسال لإرسال رسالة لهذا المعلم"}</div>

          ${
            subjects.length
              ? `<div class="nt-subject-chips">
                  ${subjects.map(s => `<span class="nt-subject-chip">${escapeHtml(s)}</span>`).join("")}
                </div>`
              : ``
          }
        </div>
      </div>

      <div class="nt-teacher-actions">
        <button type="button" class="nt-send-one-btn" data-uid="${uid}">
          <i class="ri-send-plane-2-line"></i> إرسال
        </button>
      </div>
    `;

    // checkbox
    card.querySelector(".nt-teacher-checkbox")?.addEventListener("change", (e) => {
      const v = Number(e.target.getAttribute("data-uid"));
      if (!v) return;
      if (e.target.checked) compose.selectedTeacherUserIds.add(v);
      else compose.selectedTeacherUserIds.delete(v);
      updateSelectedCountUI();
    });

    // send one
    card.querySelector(".nt-send-one-btn")?.addEventListener("click", async (e) => {
      const v = Number(e.currentTarget.getAttribute("data-uid"));
      if (!v) return;
      await sendToTeacherUserIds([v]);
    });

    list.appendChild(card);
  }
}
async function loadChildren() {
  const data = await api(`${API_BASE}/children`);
  compose.children = data?.items || [];

  const sel = $("nt-child-select");
  if (!sel) return;

  sel.innerHTML = "";
  for (const c of compose.children) {
    const opt = document.createElement("option");
    opt.value = String(c.student_id);
    opt.textContent = `${c.student_name} (${c.student_code || "—"})`;
    sel.appendChild(opt);
  }

  compose.selectedChildId = compose.children[0]?.student_id ?? null;
  if (compose.selectedChildId) sel.value = String(compose.selectedChildId);
}

async function loadTeachers() {
  ensureTeachersToolbar();

  const empty = $("nt-teachers-empty");
  if (empty) empty.textContent = "جارِ التحميل...";

  compose.selectedTeacherUserIds.clear();
  updateSelectedCountUI();

  if (!compose.selectedChildId) {
    renderTeachersList();
    return;
  }

  const data = await api(`${API_BASE}/children/${compose.selectedChildId}/teachers`);
  compose.teachers = data?.items || [];

  renderTeachersList();

  // Wiring toolbar events (مرة واحدة)
  const btnAll = $("nt-te-select-all");
  const btnClear = $("nt-te-clear");
  const btnSendSelected = $("nt-te-send-selected");
  const btnSendAll = $("nt-te-send-all");

  if (btnAll && !btnAll.__wired) {
    btnAll.__wired = true;
    btnAll.addEventListener("click", () => {
      // حدد كل الظاهرين (بعد البحث)
      const teachers = getVisibleTeachers();
      teachers.forEach((t) => {
        const uid = Number(t.teacher_user_id);
        if (uid) compose.selectedTeacherUserIds.add(uid);
      });
      renderTeachersList(); // لتحديث 체크 بوكس
      updateSelectedCountUI();
    });
  }

  if (btnClear && !btnClear.__wired) {
    btnClear.__wired = true;
    btnClear.addEventListener("click", () => {
      compose.selectedTeacherUserIds.clear();
      renderTeachersList();
      updateSelectedCountUI();
    });
  }

  if (btnSendSelected && !btnSendSelected.__wired) {
    btnSendSelected.__wired = true;
    btnSendSelected.addEventListener("click", () => {
      sendToTeacherUserIds([...compose.selectedTeacherUserIds]).catch((e) =>
        showToast(`خطأ: ${e.message}`)
      );
    });
  }

  if (btnSendAll && !btnSendAll.__wired) {
    btnSendAll.__wired = true;
    btnSendAll.addEventListener("click", () => {
      // إرسال للجميع عبر API بدون تحديد
      sendAllTeachers().catch((e) => showToast(`خطأ: ${e.message}`));
    });
  }console.log("selectedChildId:", compose.selectedChildId);
console.log("teachers raw response:", data);
console.log("teachers parsed:", compose.teachers);
}

async function loadCompose() {
  await loadChildren();
  await loadTeachers();
}

async function sendAllTeachers() {
  const { title, body } = getMessage();
  if (!title || !body) return showComposeStatus("اكتب عنوانًا ونصًا أولاً.", true);
  if (!compose.selectedChildId) return showComposeStatus("اختر ابنًا أولاً.", true);

  showComposeStatus("جارِ الإرسال لجميع معلمي الابن...");
  const out = await api(`${API_BASE}/send/teachers`, {
    method: "POST",
    body: JSON.stringify({ title, body, student_id: compose.selectedChildId }),
  });
  showComposeStatus("");
  showToast(`تم الإرسال ✅ (المستلمون: ${out?.recipients ?? 0})`);
}
  // ===== Wiring =====
  function wireEvents() {
    $("nt-tab-inbox")?.addEventListener("click", () => setActiveTab("inbox"));
    $("nt-tab-outbox")?.addEventListener("click", () => setActiveTab("outbox"));
    $("nt-tab-compose")?.addEventListener("click", () => setActiveTab("compose"));

    document.querySelectorAll("#nt-filters .nt-filter").forEach((b) => {
      b.addEventListener("click", () => setActiveStatus(b.dataset.status));
    });

    $("nt-search")?.addEventListener("input", (e) => {
      state.q = e.target.value || "";
      clearTimeout(window.__ntSearchT);
      window.__ntSearchT = setTimeout(() => refreshList().catch(() => {}), 250);
    });
$("nt-child-select")?.addEventListener("change", async (e) => {
  compose.selectedChildId = Number(e.target.value);
  await loadTeachers();
});

$("nt-te-search")?.addEventListener("input", () => {
  clearTimeout(window.__ntTeSearchT);
  window.__ntTeSearchT = setTimeout(() => {
    renderTeachersList();   // ✅ يعيد الرسم حسب البحث
  }, 150);
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

    $("notifications-btn")?.addEventListener("click", () => {
      refreshUnreadCount();
      setActiveTab("inbox");
    });

 document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const m = btn.closest(".modal");
    if (m) closeModal(m);
  });
});

    $("nt-child-select")?.addEventListener("change", async (e) => {
      compose.selectedChildId = Number(e.target.value);
      await loadTeachers();
    });


    $("nt-send-admins")?.addEventListener("click", () => sendAdmins().catch((e) => showToast(`خطأ: ${e.message}`)));
    $("nt-send-child")?.addEventListener("click", () => sendChild().catch((e) => showToast(`خطأ: ${e.message}`)));
    $("nt-send-all-children")?.addEventListener("click", () => sendAllChildren().catch((e) => showToast(`خطأ: ${e.message}`)));
    $("nt-send-all-teachers")?.addEventListener("click", () => sendAllTeachers().catch((e) => showToast(`خطأ: ${e.message}`)));
  }

  function wireSocket() {
    try {
      const socket = window.getNotificationSocket?.();
      if (!socket) return;

      const refreshRealtime = () => {
        refreshUnreadCount().catch(() => {});
        if (state.tab === "inbox") refreshList().catch(() => {});
      };

      socket.on("notification:new", refreshRealtime);
      socket.on("notification:unread-count:refresh", refreshRealtime);
    } catch {
      // REST refresh remains available as a fallback.
    }
  }

  async function init() {
    wireEvents();
    setBadge(0);
    refreshUnreadCount().catch(() => {});
    wireSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();