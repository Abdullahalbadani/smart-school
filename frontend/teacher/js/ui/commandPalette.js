// js/ui/commandPalette.js  (MERGED)
// يدعم: Enter كأوامر سريعة + نتائج بحث (مودالات/تابات/أزرار) + Ctrl/Cmd+K
(function () {
  "use strict";

  // ===== safe globals =====
  const $id = (id) =>
    (typeof window.$ === "function" ? window.$(id) : document.getElementById(id));

  const toast =
    typeof window.showToast === "function"
      ? window.showToast
      : (m) => alert(m);

  const esc = (s) =>
    String(s ?? "")
      .split("&").join("&amp;")
      .split("<").join("&lt;")
      .split(">").join("&gt;")
      .split('"').join("&quot;")
      .split("'").join("&#039;");

  const normalizeArabic = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // تشكيل + تطويل
      .replace(/\s+/g, " ")
      .trim();

  const getText = (el) => ((el?.innerText || el?.textContent || "") + "").trim();

  const supportsCssEscape = typeof window.CSS !== "undefined" && typeof window.CSS.escape === "function";
  const cssEsc = (v) => (supportsCssEscape ? window.CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_\-]/g, "\\$&"));

  // ===== modal open helpers =====
  function openModalSafe(modalId) {
    if (!modalId) return false;

    // لو عندك openModal عالمي من modals.js
    if (typeof window.openModal === "function") {
      window.openModal(modalId);
      return true;
    }

    // fallback بسيط
    const modal = document.getElementById(modalId);
    if (!modal) return false;

    const overlay = document.getElementById("modal-overlay");
    if (overlay) overlay.style.display = "block";

    modal.classList.add("show");
    modal.style.display = "block";
    return true;
  }

  function clickInsideModalAfterOpen(modalId, targetIdOrSelector) {
    openModalSafe(modalId);

    const tryClick = () => {
      const modal = document.getElementById(modalId);
      if (!modal) return false;

      let target = null;
      if (targetIdOrSelector.startsWith("#") || targetIdOrSelector.startsWith(".")) {
        target = modal.querySelector(targetIdOrSelector);
      } else {
        target = modal.querySelector("#" + cssEsc(targetIdOrSelector));
      }

      if (target && typeof target.click === "function") {
        target.scrollIntoView?.({ block: "nearest" });
        target.click();
        return true;
      }
      return false;
    };

    requestAnimationFrame(() => {
      if (tryClick()) return;
      setTimeout(() => {
        if (tryClick()) return;
        setTimeout(() => tryClick(), 160);
      }, 70);
    });
  }

  function getModalTitle(modal) {
    const h = modal?.querySelector(".modal-header h3");
    const t = getText(h);
    return t || modal?.id || "مودال";
  }

  // ===== command palette core =====
  const state = {
    index: [],
    items: [],
    active: -1,
    inited: false,
  };

  function ensureResultsBox() {
    let box = $id("command-results");
    if (!box) {
      // لو ما عندك DIV النتائج في HTML، ننشئه
      const cc = document.querySelector(".command-center");
      if (!cc) return null;
      box = document.createElement("div");
      box.id = "command-results";
      box.className = "command-results";
      box.hidden = true;
      cc.appendChild(box);
    }
    return box;
  }

  function closeResults(results) {
    if (!results) return;
    results.hidden = true;
    results.innerHTML = "";
    state.items = [];
    state.active = -1;
  }

  function showResults(results) {
    if (!results) return;
    results.hidden = false;
  }

  function render(results, list) {
    state.items = list;
    state.active = list.length ? 0 : -1;

    if (!list.length) {
      results.innerHTML = `<div class="command-empty">لا توجد نتائج</div>`;
      showResults(results);
      return;
    }

    results.innerHTML = list
      .map((c, i) => {
        const active = i === state.active ? "active" : "";
        return `
          <div class="command-item ${active}" data-idx="${i}">
            <i class="${esc(c.icon || "ri-search-line")}"></i>
            <div class="txt">
              <div class="t">${esc(c.title)}</div>
              <div class="d">${esc(c.desc || "")}</div>
            </div>
          </div>
        `;
      })
      .join("");

    showResults(results);
  }

  function scoreItem(item, q) {
    const query = normalizeArabic(q);
    if (!query) return 1;

    const hay = normalizeArabic([item.title, item.desc, ...(item.keywords || [])].join(" "));
    if (!hay) return 0;

    const parts = query.split(" ").filter(Boolean);
    let score = 0;

    for (const p of parts) {
      if (hay.includes(p)) score += 10;
    }
    if (hay.startsWith(query)) score += 15;

    return score;
  }

  function filterIndex(q) {
    const query = normalizeArabic(q);
    if (!query) return state.index.slice(0, 14);

    const ranked = state.index
      .map((it) => ({ it, s: scoreItem(it, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);

    return ranked.slice(0, 18);
  }

  function runActive(results, input) {
    const cmd = state.items[state.active];
    if (!cmd) return;
    closeResults(results);
    input.blur();
    try {
      cmd.run();
    } catch (e) {
      console.error(e);
      toast("حدث خطأ أثناء تنفيذ الأمر");
    }
  }

  // ===== your original shortcuts (محفوظة + محسنة) =====
  const shortcuts = [
    { keyword: "حضور", modal: "modal-attendance" },
    { keyword: "غياب", modal: "modal-attendance" },
    { keyword: "تسجيل الحضور", modal: "modal-attendance", click: "att-tab-take" },
    { keyword: "كشف الغياب", modal: "modal-attendance", click: "att-tab-history" },
    { keyword: "تقرير الغياب", modal: "modal-attendance", click: "att-tab-report" },

    { keyword: "درجات", modal: "modal-grades" },

    { keyword: "إشعار", modal: "modal-notifications" },
    { keyword: "إشعارات", modal: "modal-notifications" },

    { keyword: "اختبارات", modal: "modal-timetable", tab: "exams" },
    { keyword: "اختبار", modal: "modal-timetable", tab: "exams" },
    { keyword: "جدول", modal: "modal-timetable", tab: "weekly" },
    { keyword: "أسبوعي", modal: "modal-timetable", tab: "weekly" },

    { keyword: "طلاب", modal: "modal-students" },

    { keyword: "حصة", modal: "modal-lessons" },
    { keyword: "سجل الحصص", modal: "modal-lessons", click: "ls-tab-log" },
    { keyword: "الحصة الحالية", modal: "modal-lessons", click: "ls-tab-live" },

    { keyword: "تقرير", modal: "modal-reports" },

    { keyword: "ملف", modal: "profile-modal" },
    { keyword: "الملف الوظيفي", modal: "profile-modal" },
  ];

  function runShortcut(value) {
    const v = normalizeArabic(value);
    if (!v) return false;

    const cmd = shortcuts.find((c) => v.includes(normalizeArabic(c.keyword)));
    if (!cmd) return false;

    openModalSafe(cmd.modal);

    // timetable tab by API (أفضل)
    if (cmd.modal === "modal-timetable" && cmd.tab) {
      window.TeacherTimetable?.setTab?.(cmd.tab, true);

      // fallback: click buttons إن لم يوجد setTab
      if (!window.TeacherTimetable?.setTab) {
        const btnId = cmd.tab === "exams" ? "tt-tab-exams" : "tt-tab-weekly";
        clickInsideModalAfterOpen(cmd.modal, btnId);
      }
    }

    // click tab/action
    if (cmd.click) {
      clickInsideModalAfterOpen(cmd.modal, cmd.click);
    }

    // profile refresh
    if (cmd.modal === "profile-modal") {
      setTimeout(() => window.TeacherJobProfile?.refresh?.(), 0);
    }

    return true;
  }

  // ===== build FULL index (مودالات + تابات + أزرار) =====
  function uniquePush(list, item) {
    const key = item.key || (item.title + "||" + (item.desc || ""));
    if (list._keys.has(key)) return;
    list._keys.add(key);
    list.push(item);
  }

  function isUsefulButton(btn) {
    if (!btn) return false;
    if (btn.matches("[data-close-modal], .modal-close")) return false;

    const text = getText(btn);
    if (!text || text.length < 2) return false;

    const id = btn.id || "";
    const cls = btn.className || "";
    const lookTab = cls.includes("att-tab") || id.includes("tab");
    const lookAction = /export|print|save|show|load|open|go|refresh|start|end/i.test(id);

    return !!btn.id && (lookTab || lookAction);
  }

  function buildIndex() {
    const idx = [];
    idx._keys = new Set();

    // 0) أضف الأوامر النصية السريعة نفسها كعناصر قابلة للاختيار
    shortcuts.forEach((s) => {
      uniquePush(idx, {
        key: "shortcut:" + s.keyword,
        title: "أمر سريع: " + s.keyword,
        desc: "تنفيذ مباشر عند الاختيار",
        icon: "ri-flashlight-line",
        keywords: [s.keyword, s.modal, s.tab || "", s.click || ""],
        run() {
          runShortcut(s.keyword);
        },
      });
    });

    // 1) من الكروت data-modal
    document.querySelectorAll(".card[data-modal]").forEach((card) => {
      const modalId = card.getAttribute("data-modal");
      if (!modalId) return;

      const title =
        getText(card.querySelector("h3 span")) ||
        getText(card.querySelector("h3")) ||
        modalId;

      const desc = getText(card.querySelector("p")) || "فتح";
      uniquePush(idx, {
        key: "card:" + modalId,
        title,
        desc,
        icon: card.querySelector(".card-icon i")?.className || "ri-window-line",
        keywords: [modalId, title],
        run() {
          if (!openModalSafe(modalId)) toast("لم أجد " + modalId);
          if (modalId === "profile-modal") {
            setTimeout(() => window.TeacherJobProfile?.refresh?.(), 0);
          }
        },
      });
    });

    // 2) كل المودالات
    document.querySelectorAll(".modal[id]").forEach((modal) => {
      const modalId = modal.id;
      const title = getModalTitle(modal);

      uniquePush(idx, {
        key: "modal:" + modalId,
        title: "فتح: " + title,
        desc: "فتح المودال",
        icon: modal.querySelector(".modal-header i")?.className || "ri-window-line",
        keywords: [modalId, title],
        run() {
          if (!openModalSafe(modalId)) toast("لم أجد " + modalId);
          if (modalId === "profile-modal") {
            setTimeout(() => window.TeacherJobProfile?.refresh?.(), 0);
          }
        },
      });

      // 3) التابات داخل المودال: .att-tab + أي زر id فيه tab
      modal.querySelectorAll('button.att-tab, button[id*="tab"]').forEach((btn) => {
        if (!isUsefulButton(btn)) return;
        const tabText = getText(btn);
        if (!tabText) return;

        uniquePush(idx, {
          key: "tab:" + modalId + ":" + btn.id,
          title: title + " — " + tabText,
          desc: "فتح المودال ثم اختيار التبويب",
          icon: btn.querySelector("i")?.className || "ri-layout-grid-line",
          keywords: [tabText, btn.id, title],
          run() {
            // timetable tabs: استخدم setTab لو موجود
            if (modalId === "modal-timetable" && btn.id === "tt-tab-exams") {
              openModalSafe(modalId);
              window.TeacherTimetable?.setTab?.("exams", true);
              if (!window.TeacherTimetable?.setTab) clickInsideModalAfterOpen(modalId, btn.id);
              return;
            }
            if (modalId === "modal-timetable" && btn.id === "tt-tab-weekly") {
              openModalSafe(modalId);
              window.TeacherTimetable?.setTab?.("weekly", true);
              if (!window.TeacherTimetable?.setTab) clickInsideModalAfterOpen(modalId, btn.id);
              return;
            }

            clickInsideModalAfterOpen(modalId, btn.id);
          },
        });
      });

      // 4) أزرار الإجراءات المهمة داخل المودال
      modal.querySelectorAll("button[id]").forEach((btn) => {
        if (!isUsefulButton(btn)) return;

        // لا تكرر التابات
        if (btn.classList.contains("att-tab") || btn.id.includes("tab")) return;

        const text = getText(btn);
        if (!text) return;

        uniquePush(idx, {
          key: "act:" + modalId + ":" + btn.id,
          title: title + " — " + text,
          desc: "فتح المودال ثم تنفيذ الإجراء",
          icon: btn.querySelector("i")?.className || "ri-flashlight-line",
          keywords: [text, btn.id, title],
          run() {
            clickInsideModalAfterOpen(modalId, btn.id);
          },
        });
      });
    });

    delete idx._keys;
    state.index = idx;
  }

  // ===== init & events =====
  function init() {
    if (state.inited) return;
    state.inited = true;

    const input = $id("command-input");
    if (!input) return;

    const results = ensureResultsBox();
    const keyBadge = document.querySelector(".command-center .command-key");

    buildIndex();

    function openPalette() {
      buildIndex();
      input.focus();
      input.select();
      render(results, filterIndex(input.value));
    }

    // Ctrl/Cmd+K
    document.addEventListener("keydown", (e) => {
      const isK = e.key && e.key.toLowerCase() === "k";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        openPalette();
        return;
      }

      if (e.key === "Escape") {
        closeResults(results);
        return;
      }

      if (results.hidden) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!state.items.length) return;
        state.active = Math.min(state.active + 1, state.items.length - 1);
        render(results, state.items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!state.items.length) return;
        state.active = Math.max(state.active - 1, 0);
        render(results, state.items);
      } else if (e.key === "Enter") {
        // إذا النتائج مفتوحة: نفّذ العنصر النشط
        if (document.activeElement === input && !results.hidden) {
          e.preventDefault();
          runActive(results, input);
        }
      }
    });

    // 클릭 على badge ⌘K
    if (keyBadge) {
      keyBadge.style.cursor = "pointer";
      keyBadge.addEventListener("click", openPalette);
    }

    // عند التركيز اظهر نتائج
    input.addEventListener("focus", () => {
      buildIndex();
      render(results, filterIndex(input.value));
    });

    // البحث أثناء الكتابة
    input.addEventListener("input", () => {
      render(results, filterIndex(input.value));
    });

    // Enter: لو ما فيه نتائج/أو ما اخترت شيء -> نفّذ اختصارك القديم
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;

      // إذا النتائج ظاهرة وفيها عناصر، خلّ Enter يشغّل النتيجة النشطة
      if (!results.hidden && state.items.length) {
        e.preventDefault();
        runActive(results, input);
        return;
      }

      // غير ذلك: شغّل أسلوبك القديم (كلمة ثم Enter)
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;

      const ok = runShortcut(value);
      if (!ok) toast("لم أتعرف على هذا الأمر (اكتب مثال: كشف الغياب، تقرير الغياب، جدول، اختبارات...)");
    });

    // 클릭 على عنصر من النتائج
    results.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".command-item");
      if (!item) return;
      const idx = Number(item.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      state.active = idx;
      runActive(results, input);
    });

    // 클릭 خارج command-center => اغلاق
    document.addEventListener("click", (e) => {
      const inside = e.target.closest(".command-center");
      if (!inside) closeResults(results);
    });

    // public API
    window.TeacherCommandPalette = {
      init,
      reindex: buildIndex,
      open: openPalette,
    };
  }

  // expose بنفس اسمك القديم (TeacherCommandPalette)
  window.TeacherCommandPalette = window.TeacherCommandPalette || { init };

  // auto init آمن (ومحمي بفلاج)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
