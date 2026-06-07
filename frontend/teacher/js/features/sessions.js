// teacher/features/sessions.js
(function () {
  "use strict";
if (window.__TEACHER_SESSIONS_JS_LOADED__) return;
window.__TEACHER_SESSIONS_JS_LOADED__ = true;

  /* =========================
     Safe helpers (بدون ما نكسر ملفاتك)
     - Hardened for: older browsers, timezone, missing TS, missing DOM, stale maps
  ========================= */
// ===================== Attendance Meta guard =====================
// ===================== Attendance Meta guard (retry-safe) =====================
let __ATT_META_STATE = 0; // 0=idle, 1=loading, 2=ready
let __ATT_META_PROMISE = null;

async function ensureAttendanceMetaOnce(TS) {
  if (__ATT_META_STATE === 2) return true;

  if (__ATT_META_STATE === 1 && __ATT_META_PROMISE) return __ATT_META_PROMISE;

  __ATT_META_STATE = 1;
  __ATT_META_PROMISE = (async () => {
    try {
      if (TS && typeof TS.ensureAttendanceMeta === "function") {
        await TS.ensureAttendanceMeta();
      }
      __ATT_META_STATE = 2;
      return true;
    } catch (e) {
      console.warn("ensureAttendanceMeta failed:", e);
      __ATT_META_STATE = 0; // ✅ allow retry later
      return false;
    } finally {
      __ATT_META_PROMISE = null;
    }
  })();

  return __ATT_META_PROMISE;
}


function findFinishedSessionInLog(dateVal, periodId, scope) {
  const d = String(dateVal || "").slice(0, 10);
  const pid = String(parseInt(periodId, 10) || 0);
  const list = readLessonLog();

  // ✅ الأفضل: IDs
  const secId = String(toInt(scope?.sectionId || 0));
  const subId = String(toInt(scope?.subjectId || 0));

  // fallback: names
  const secName = String(scope?.sectionName || "");
  const subName = String(scope?.subjectName || "");

  for (const x of list) {
    if (String(x.date || "").slice(0, 10) !== d) continue;
    if (String(parseInt(x.periodId, 10) || 0) !== pid) continue;

    // ✅ match by ids if available
    if (secId !== "0" && String(toInt(x.sectionId || 0)) !== secId) continue;
    if (subId !== "0" && String(toInt(x.subjectId || 0)) !== subId) continue;

    // fallback match by names only if ids missing in old records
    if (secId === "0" && secName && String(x.sectionName || "") !== secName) continue;
    if (subId === "0" && subName && String(x.subjectName || "") !== subName) continue;

    if (x.isLocked) return { finished: true, state: "locked", sessionId: toInt(x.sessionId) || 0 };
    if (x.endISO)   return { finished: true, state: "ended",  sessionId: toInt(x.sessionId) || 0 };
  }
  return null;
}


  const byId = (id) =>
    typeof window.$ === "function" ? window.$(id) : document.getElementById(id);

  // Safe string replace (avoid replaceAll compatibility issues)
  const replaceAllSafe = (str, search, replacement) => {
    const s = String(str ?? "");
    const needle = String(search ?? "");
    if (!needle) return s;
    // split/join is widely supported
    return s.split(needle).join(String(replacement ?? ""));
  };

  const esc =
    typeof window.escapeHtml === "function"
      ? window.escapeHtml
      : (str) => {
          const s = String(str ?? "");
          // regex replace is broadly supported
          return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
        };

  const toast = (msg) =>
    typeof window.showToast === "function" ? window.showToast(msg) : console.warn(msg);

  const toInt = (v) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };
const toBool = (v) => {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (["true", "t", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "f", "0", "no", "n", "off", ""].includes(s)) return false;
  return false;
};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Local ISO date (avoid UTC shift from toISOString)
  // استبدل دالة todayISO القديمة بهذه:
function todayISO() {
  // نستخدم new Date() لنحصل على توقيت الجهاز الحالي لحظة الطلب
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

  function parseYMD(iso) {
    const dateVal = String(iso || "").slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateVal);
    if (!m) return null;
    const y = toInt(m[1]);
    const mo = toInt(m[2]);
    const d = toInt(m[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, mo, d, dateVal };
  }

  // JS getDay(): 0 Sun ... 6 Sat
  // School: 1=Saturday,2=Sunday,3=Mon,...7=Fri
  const dayIdFromISO_School = (iso) => {
    const p = parseYMD(iso);
    if (!p) return 0;
    // local date to avoid timezone UTC shift
    const jsDay = new Date(p.y, p.mo - 1, p.d).getDay();
    const mapToSchoolDay = { 6: 1, 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 };
    return mapToSchoolDay[jsDay] || 0;
  };

  // ISO day (Mon=1..Sun=7)
  const isoDayFromISO = (iso) => {
    const p = parseYMD(iso);
    if (!p) return 0;
    const jsDay = new Date(p.y, p.mo - 1, p.d).getDay(); // 0..6
    return jsDay === 0 ? 7 : jsDay; // Mon=1..Sun=7
  };

  const pad2 = (n) => String(Math.max(0, toInt(n))).padStart(2, "0");
  const formatHMS = (seconds) => {
    const s = Math.max(0, toInt(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(ss)}`;
  };

  const fmtHHMM = (t) => {
    const s = String(t || "").trim();
    if (!s) return "";
    // normalize "9:00" -> "09:00" if needed
    const m = /^(\d{1,2}):(\d{2})/.exec(s);
    if (m) return `${String(toInt(m[1])).padStart(2, "0")}:${m[2]}`;
    return s.slice(0, 5);
  };

  const fmtLocalTime = (iso) => {
    const t = String(iso || "");
    if (!t) return "—";
    try {
      const d = new Date(t);
      if (!Number.isFinite(d.getTime())) return "—";
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    } catch {
      return "—";
    }
  };

  const parseLocalDateTime = (dateISO, timeStr) => {
    const p = parseYMD(dateISO);
    const t = String(timeStr || "").trim();
    if (!p || !t) return null;
    const hhmm = fmtHHMM(t);
    if (!hhmm) return null;
    try {
      const dt = new Date(`${p.dateVal}T${hhmm}:00`);
      if (!Number.isFinite(dt.getTime())) return null;
      return dt;
    } catch {
      return null;
    }
  };

  function getSelectedOption(selectEl) {
    if (!selectEl) return null;
    // selectedOptions may not exist in some environments
    const so = selectEl.selectedOptions && selectEl.selectedOptions[0];
    if (so) return so;
    const idx = Number.isFinite(selectEl.selectedIndex) ? selectEl.selectedIndex : -1;
    if (idx >= 0 && selectEl.options && selectEl.options[idx]) return selectEl.options[idx];
    return null;
  }

  /* =========================
     ✅ API wrappers (ثابتة + أكثر صلابة)
  ========================= */
  const API_BASE = window.API_BASE || "/api";

  function authHeaders() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: "Bearer " + token } : {};
  }

  async function apiCall(method, path, body) {
    const url = path.startsWith("http")
      ? path
      : API_BASE + (path.startsWith("/") ? path : "/" + path);

    const r = await fetch(url, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });

    // 204 no content
    if (r.status === 204) return null;

    const text = await r.text();
    const ct = (r.headers.get("content-type") || "").toLowerCase();

    let data = null;
    try {
      if (ct.includes("application/json")) data = text ? JSON.parse(text) : null;
      else {
        // try json anyway, fallback raw
        data = text ? JSON.parse(text) : null;
      }
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      const msg =
        data?.message ||
        data?.error ||
        (typeof data?.raw === "string" && String(data.raw).slice(0, 200)) ||
        `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data;
  }

  // استخدم الموجود عندك إن كان متوفر + fallback للـ fetch
  const apiGet = typeof window.apiGet === "function" ? window.apiGet : (p) => apiCall("GET", p);
  const apiPost =
    typeof window.apiPost === "function" ? window.apiPost : (p, b) => apiCall("POST", p, b);
  const apiPut =
    typeof window.apiPut === "function" ? window.apiPut : (p, b) => apiCall("PUT", p, b);
  const apiPatch =
    typeof window.apiPatch === "function" ? window.apiPatch : (p, b) => apiCall("PATCH", p, b);

  /* =========================
     Periods meta cache (لوقت البداية/النهاية)
  ========================= */
  let __PERIODS_CACHE = null;
  let __PERIODS_LOADED = false;

  async function getPeriodsMeta() {
    if (__PERIODS_LOADED) return Array.isArray(__PERIODS_CACHE) ? __PERIODS_CACHE : [];
    __PERIODS_LOADED = true;

    try {
      const TS = window.TeachingScopes;
      console.log("MY_TEACHER_ID =", getMyTeacherIdGuess(TS));

      if (TS?.ensurePeriodsMeta) {
        const periods = await TS.ensurePeriodsMeta();
        __PERIODS_CACHE = Array.isArray(periods) ? periods : [];
        return __PERIODS_CACHE;
      }
    } catch (e) {
      console.warn("getPeriodsMeta from TeachingScopes failed:", e);
    }

    // fallback: حاول من meta endpoint إن كان عندك
    try {
      const r = await apiGet("/teacher/timetables/meta");
      const meta = r?.data || r || {};
      const periods = meta?.periods || meta?.data?.periods || [];
      __PERIODS_CACHE = Array.isArray(periods) ? periods : [];
      return __PERIODS_CACHE;
    } catch (e) {
      console.warn("getPeriodsMeta fallback failed:", e);
      __PERIODS_CACHE = [];
      return [];
    }
  }

  async function getPeriodById(periodId) {
    const list = await getPeriodsMeta();
    const id = String(toInt(periodId));
    return list.find((p) => String(p.id) === id) || null;
  }

  // ✅ استخرج timetableEntryId بشكل آمن (لا تعتمد على e.id لأنه قد يكون period.id)
  function extractTimetableEntryId(e) {
    const explicit =
      toInt(e?.timetable_entry_id ?? 0) ||
      toInt(e?.entry_id ?? 0) ||
      toInt(e?.timetableEntryId ?? 0) ||
      toInt(e?.timetable_entryId ?? 0);
    return explicit || 0;
  }

  // ✅ رقم الحصة للعرض/الحفظ (sort_order) وليس period_id
  async function getLessonNoByPeriodId(periodId) {
    const p = await getPeriodById(periodId);
    const no = toInt(p?.sort_order ?? p?.order ?? p?.lesson_no ?? p?.lessonNo ?? 0);
    return no || toInt(periodId);
  }

  /* =========================
     Teacher timetable fetch + day fallback
     (مُحصّن ضد اختلافات day + اختلاف شكل الاستجابة)
  ========================= */
  function normalizeEntries(resp) {
    const r = resp?.data ?? resp;
    // common shapes:
    // {data:{entries:[...]}} , {entries:[...]} , {data:[...]} , [...]
    const entries = r?.entries ?? r?.data ?? r;
    return Array.isArray(entries) ? entries : Array.isArray(r) ? r : [];
  }

  async function fetchTeacherTimetables(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || String(v).trim() === "") return;
      qs.set(k, String(v));
    });
    const url = `/teacher/timetables?${qs.toString()}`;
    const r = await apiGet(url);
    return normalizeEntries(r);
  }
// ✅ cache لليوم (لتقليل الطلبات)
const __SLOTS_CACHE = Object.create(null);

async function fetchSessionSlotsMap({ yearId, term, dateVal, sectionId, subjectId }) {
  const key = [yearId, term, dateVal, sectionId, subjectId || ""].join("|");
  const hit = __SLOTS_CACHE[key];
  if (hit && (Date.now() - hit.at) < 15000) return hit.map; // 15 ثانية كاش

  const qs = new URLSearchParams();
    try {
    const myTid = getMyTeacherIdGuess(window.TeachingScopes);
    if (myTid) {
      qs.set("teacherId", String(myTid));
      qs.set("teacher_id", String(myTid));
    }
  } catch {}
  qs.set("academicYearId", String(yearId));
  qs.set("term", String(term));
  qs.set("date", String(dateVal).slice(0, 10));
  qs.set("sectionId", String(sectionId));
  if (subjectId) qs.set("subjectId", String(subjectId));

  const r = await apiGet(`/teacher/attendance/sessions/slots?${qs.toString()}`);
  const rows = r?.data?.slots || r?.slots || [];

  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    const pid = String(toInt(x.period_id));
    if (!pid) return;
 map.set(pid, {
  id: toInt(x.session_id ?? x.sessionId ?? x.id),        // ✅ session id الحقيقي
  is_locked: toBool(x.is_locked ?? x.isLocked),
  subject_id: toInt(x.subject_id ?? x.subjectId),
  ended_at: x.ended_at ?? x.endedAt ?? null,             // ✅ لو موجود
});

  });

  __SLOTS_CACHE[key] = { at: Date.now(), map };
  return map;
}
function invalidateSlotsCache({ yearId, term, dateVal, sectionId, subjectId }) {
  const key = [yearId, term, dateVal, sectionId, subjectId || ""].join("|");
  try { delete __SLOTS_CACHE[key]; } catch {}
}

  async function fetchEntriesWithDayFallback({ yearId, term, sectionId, subjectId, dateVal }) {
    const base = {
      academicYearId: yearId,
      term,
      sectionId,
      subjectId,
    };

  const cand = [dayIdFromISO_School(dateVal)].filter(Boolean);

    // جرّب مع day
    for (const day of cand) {
      try {
        const e = await fetchTeacherTimetables({ ...base, day });
        if (Array.isArray(e) && e.length) return e;
      } catch (e) {
        // ignore and try next
      }
    }

    // جرّب بدون day (بعض السيرفرات ما تحتاجه)
    try {
      const e = await fetchTeacherTimetables(base);
      if (Array.isArray(e) && e.length) {
      const schoolDay = dayIdFromISO_School(dateVal);

const filtered = e.filter((x) => {
  const raw = x?.day_of_week ?? x?.day_id ?? x?.day ?? x?.day_name ?? x?.dayName;
  const d = dayNameToSchoolId(raw);
if (!d) return false;
return d === schoolDay;
     // ✅ يوم المدرسة فقط
});


        return filtered.length ? filtered : e;
      }
    } catch (e) {
      // ignore
    }

    return [];
  }

  async function resolveTimetableEntryId({ yearId, term, dateVal, scope, periodId }) {
    const sectionId = toInt(scope?.sectionId || 0);
    const subjectId = toInt(scope?.subjectId || 0);
    const pid = toInt(periodId || 0);
    if (!sectionId || !subjectId || !pid) return 0;

    const entries = await fetchEntriesWithDayFallback({
      yearId,
      term,
      sectionId,
      subjectId,
      dateVal,
    });

    // ابحث عن الـ entry الخاص بهذه الحصة (period)
    const best = (entries || []).find((e) => toInt(e?.period_id ?? e?.periodId ?? 0) === pid);
    if (!best) return 0;

    // prefer explicit entry id fields, never rely on e.id blindly
    const entryId =
      extractTimetableEntryId(best) ||
      toInt(best?.id ?? 0); // keep as last resort (some APIs return timetable entry as id)
    return entryId || 0;
  }

  /* =========================
     Local lessons log (كشف الحصص محلي)
  ========================= */
  const LS_LESSON_LOG_KEY = "TEACHER_LESSONS_LOG_V1";

  function readLessonLog() {
    try {
      const raw = localStorage.getItem(LS_LESSON_LOG_KEY);
      const arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
function findLockedSessionInLog(dateVal, periodId, scope) {
  const d = String(dateVal || "").slice(0, 10);
  const pid = String(parseInt(periodId, 10) || 0);
  const list = readLessonLog();

  // نحاول نطابق بالاسم (لو متوفر) لتقليل الالتباس
  const secName = String(scope?.sectionName || "");
  const subName = String(scope?.subjectName || "");

  for (const x of list) {
    if (String(x.date || "").slice(0,10) !== d) continue;
    if (String(parseInt(x.periodId, 10) || 0) !== pid) continue;

    if (secName && String(x.sectionName || "") !== secName) continue;
    if (subName && String(x.subjectName || "") !== subName) continue;

    if (x.isLocked || x.endISO) {
      return { locked: true, sessionId: parseInt(x.sessionId, 10) || 0 };
    }
  }
  return null;
}

  function writeLessonLog(arr) {
    try {
      localStorage.setItem(
        LS_LESSON_LOG_KEY,
        JSON.stringify(Array.isArray(arr) ? arr.slice(0, 300) : [])
      );
    } catch {}
  }

  function upsertLessonLog(entry) {
  const list = readLessonLog();

  const sid = entry?.sessionId ? String(entry.sessionId) : "";
  const d = String(entry?.date || "").slice(0, 10);
  const pid = String(toInt(entry?.periodId ?? 0));
  const sec = String(entry?.sectionName || "");
  const sub = String(entry?.subjectName || "");

  // 1) match by sessionId (أفضل)
  let idx = -1;
  if (sid) idx = list.findIndex((x) => String(x.sessionId || "") === sid);

  // 2) fallback match by (date+period+section+subject)
  if (idx < 0) {
    idx = list.findIndex(
      (x) =>
        String(x.date || "").slice(0, 10) === d &&
        String(toInt(x.periodId ?? 0)) === pid &&
        String(x.sectionName || "") === sec &&
        String(x.subjectName || "") === sub
    );
  }

  if (idx >= 0) {
    const old = list[idx];
    const merged = {
  
      ...old,
      ...entry,
          stageId: entry?.stageId ?? old.stageId ?? null,
gradeId: entry?.gradeId ?? old.gradeId ?? null,
sectionId: entry?.sectionId ?? old.sectionId ?? null,
subjectId: entry?.subjectId ?? old.subjectId ?? null,

      date: d || old.date,
      durationSeconds: toInt(entry?.durationSeconds ?? old.durationSeconds ?? 0),
      isLocked: entry?.isLocked != null ? !!entry.isLocked : !!old.isLocked,
      status: entry?.status || old.status || "",
      updatedAt: new Date().toISOString(),
    };
    list.splice(idx, 1);
    list.unshift(merged);
    writeLessonLog(list);
    
    return;
  }

  // insert new
  list.unshift({
    id: entry?.id ?? null,
    sessionId: entry?.sessionId ?? null,
    date: d || todayISO(),
    lessonNo: entry?.lessonNo ?? entry?.lesson ?? null,
    periodId: entry?.periodId ?? null,
    stageName: entry?.stageName ?? "",
    gradeName: entry?.gradeName ?? "",
    sectionName: entry?.sectionName ?? "",
    subjectName: entry?.subjectName ?? "",
    note: entry?.note ?? "",
    startISO: entry?.startISO ?? null,
    endISO: entry?.endISO ?? null,
    durationSeconds: toInt(entry?.durationSeconds ?? 0),
    isLocked: !!entry?.isLocked,
    status: entry?.status || "",
    createdAt: new Date().toISOString(),
    updatedAt: null,
  });

  writeLessonLog(list);
}
// ===================== Lessons Log merge (local + server fallback) =====================
const __LESSONS_MERGE_CACHE = { at: 0, key: "", rows: [] };

function __normLocalLogRow(x) {
  const d = String(x?.date || "").slice(0, 10);
  return {
    sessionId: toInt(x?.sessionId ?? 0) || null,
    date: d,
    lessonNo: x?.lessonNo ?? null,
    periodId: toInt(x?.periodId ?? 0) || null,

    stageName: x?.stageName || "",
    gradeName: x?.gradeName || "",
    sectionName: x?.sectionName || "",
    subjectName: x?.subjectName || "",

    note: x?.note || "",
    startISO: x?.startISO ?? null,
    endISO: x?.endISO ?? null,
    durationSeconds: toInt(x?.durationSeconds ?? 0),
    isLocked: !!x?.isLocked,
    status: x?.status || "",
  };
}

function __normServerRowToLog(s) {
  // نحاول تغطية أغلب أشكال السيرفر
  const sid =
    toInt(s?.session_id ?? s?.sessionId ?? s?.id ?? 0) || null;

  const d = String(s?.attendance_date ?? s?.date ?? "").slice(0, 10);

  const periodId = toInt(s?.period_id ?? s?.periodId ?? 0) || null;
  const lessonNo = toInt(s?.lesson ?? s?.lesson_no ?? 0) || null;

  const startISO = s?.started_at ?? s?.startedAt ?? s?.startISO ?? null;
  const endISO = s?.ended_at ?? s?.endedAt ?? s?.endISO ?? null;

  let dur = 0;
  try {
    if (startISO && endISO) {
      const a = new Date(startISO).getTime();
      const b = new Date(endISO).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) dur = Math.floor((b - a) / 1000);
    }
  } catch {}

  const locked = toBool(s?.is_locked ?? s?.isLocked);

  return {
    sessionId: sid,
    date: d,
    lessonNo,
    periodId,

    stageName: s?.stage_name ?? s?.stageName ?? "",
    gradeName: s?.grade_name ?? s?.gradeName ?? "",
    sectionName: s?.section_name ?? s?.sectionName ?? "",
    subjectName: s?.subject_name ?? s?.subjectName ?? "",

    note: s?.note ?? "",
    startISO,
    endISO,
    durationSeconds: dur || 0,
    isLocked: locked,
    status: locked ? "locked" : endISO ? "ended" : "running",
  };
}

function __mergeKey(x) {
  if (x?.sessionId) return "sid:" + String(x.sessionId);
  return "k:" + [
    String(x?.date || ""),
    String(toInt(x?.periodId ?? 0)),
    String(x?.sectionName || ""),
    String(x?.subjectName || ""),
  ].join("|");
}

async function __tryFetchLessonsFromServer({ from, to } = {}) {
  const TS = window.TeachingScopes;
  const { yearId, term } = getYearTermSafe(TS);
  const myTid = getMyTeacherIdGuess(TS);

  const params = new URLSearchParams();
  if (from) params.set("from", String(from).slice(0, 10));
  if (to) params.set("to", String(to).slice(0, 10));
  if (yearId) params.set("academicYearId", String(yearId));
  if (term) params.set("term", String(term));
  if (myTid) params.set("teacherId", String(myTid));

  // جرّب عدة مسارات (لو واحد منها موجود عندك)
  const paths = [
    `/teacher/attendance/sessions/log?${params.toString()}`,
    `/teacher/attendance/sessions/history?${params.toString()}`,
    `/teacher/attendance/sessions?${params.toString()}`,
  ];

  let lastErr = null;
  for (const p of paths) {
    try {
      const r = await apiGet(p);
      const data = r?.data ?? r ?? {};
      const rows = data?.rows ?? data?.sessions ?? data?.data ?? data;
      if (Array.isArray(rows)) return rows;
    } catch (e) {
      lastErr = e;
    }
  }
  // إذا ما فيه endpoint أصلاً، نرجع null بدون كسر
  return null;
}

async function getLessonsLogMerged({ from, to, status } = {}) {
  const key = [String(from || ""), String(to || ""), String(status || "")].join("|");
  if (__LESSONS_MERGE_CACHE.key === key && (Date.now() - __LESSONS_MERGE_CACHE.at) < 8000) {
    return __LESSONS_MERGE_CACHE.rows;
  }

  // 1) local
  const local = readLessonLog().map(__normLocalLogRow);

  // 2) server (اختياري)
  let serverRows = null;
  try {
    serverRows = await __tryFetchLessonsFromServer({ from, to });
  } catch {}

  const map = new Map();
  for (const x of local) map.set(__mergeKey(x), x);

  if (Array.isArray(serverRows)) {
    for (const s of serverRows) {
      const row = __normServerRowToLog(s);
      const k = __mergeKey(row);
      const old = map.get(k);

      if (!old) {
        map.set(k, row);
      } else {
        // نفضّل معلومات السيرفر في القفل والنهاية
        map.set(k, {
          ...old,
          ...row,
          sessionId: row.sessionId || old.sessionId,
          isLocked: row.isLocked != null ? !!row.isLocked : !!old.isLocked,
          endISO: row.endISO || old.endISO,
          startISO: row.startISO || old.startISO,
          durationSeconds: toInt(row.durationSeconds || old.durationSeconds || 0),
        });
      }
    }
  }

  const out = Array.from(map.values())
    .filter((x) => inRange(x.date, String(from || "").slice(0, 10), String(to || "").slice(0, 10)))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  __LESSONS_MERGE_CACHE.key = key;
  __LESSONS_MERGE_CACHE.at = Date.now();
  __LESSONS_MERGE_CACHE.rows = out;
  return out;
}

  function pickStatus(x) {
    if (x?.isLocked) return "locked";
    if (x?.endISO) return "ended";
    if (x?.startISO && !x?.endISO) return "running";
    return "";
  }

  function inRange(dateISO, fromISO, toISO) {
    const d = String(dateISO || "").slice(0, 10);
    if (!d) return false;
    if (fromISO && d < fromISO) return false;
    if (toISO && d > toISO) return false;
    return true;
  }

  function downloadText(filename, text) {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 700);
    } catch {
      toast("تعذر التصدير على هذا المتصفح.");
    }
  }

  function renderLessonsLogLegacy(containerEl, filterDateISO) {
    if (!containerEl) return;
    const dateFilter = String(filterDateISO || "").slice(0, 10) || null;
    const list = readLessonLog();

    const rows = dateFilter
      ? list.filter((x) => String(x.date || "").slice(0, 10) === dateFilter)
      : list;

    if (!rows.length) {
      containerEl.innerHTML = `<div class="empty-state">لا توجد حصص مسجلة بعد.</div>`;
      return;
    }

    containerEl.innerHTML = `
      <div class="muted-box" style="margin:.35rem 0;">
        <strong>كشف الحصص</strong> — ${dateFilter ? `تاريخ: ${esc(dateFilter)}` : "آخر الحصص"}
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>الحصة</th>
            <th>المادة</th>
            <th>الصف / الشعبة</th>
            <th>البداية</th>
            <th>النهاية</th>
            <th>المدة</th>
            <th>الحالة</th>
            <th>إجراء</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice(0, 100)
            .map((x) => {
              const st = pickStatus(x);
              const lesson = x.lessonNo
                ? `الحصة ${esc(x.lessonNo)}`
                : x.periodId
                ? `الحصة ${esc(x.periodId)}`
                : "-";
              const scope = `${esc(x.gradeName || "")} / ${esc(x.sectionName || "")}`.trim();
              const dur = x.durationSeconds ? formatHMS(x.durationSeconds) : "-";
              const sessionId = x.sessionId ? String(x.sessionId) : "";
              const openBtn = sessionId
                ? `<button type="button" class="primary-btn" data-open-att-session="${esc(
                    sessionId
                  )}" style="padding:.35rem .6rem;">
                     <i class="ri-external-link-line"></i> فتح الحضور
                   </button>`
                : `<span class="muted">—</span>`;

             const label =
  st === "locked" || st === "ended" ? "منتهية ✅" : st === "running" ? "جارية" : "-";

              return `
                <tr>
                  <td>${esc(String(x.date || "").slice(0, 10))}</td>
                  <td>${lesson}</td>
                  <td>${esc(x.subjectName || "-")}</td>
                  <td>${scope || "-"}</td>
                  <td>${esc(fmtLocalTime(x.startISO))}</td>
                  <td>${esc(fmtLocalTime(x.endISO))}</td>
                  <td>${esc(dur)}</td>
                  <td>${esc(label)}</td>
                  <td>${openBtn}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;

    containerEl.querySelectorAll("[data-open-att-session]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sid = btn.getAttribute("data-open-att-session");
        if (!sid) return;
        if (typeof window.__openAttendanceForSession === "function") {
          window.__openAttendanceForSession(sid);
        } else {
          toast("فتح الحضور غير جاهز (window.__openAttendanceForSession غير موجود).");
        }
      });
    });
  }

  async function renderLessonsLogToNewUI() {
    const body = byId("lsr-body");
    const empty = byId("lsr-empty");
    const summary = byId("lsr-summary");
    const from = byId("lsr-from");
    const to = byId("lsr-to");
    const statusSel = byId("lsr-status");

    if (!body) return false;

    const fromVal = String(from?.value || "").slice(0, 10);
    const toVal = String(to?.value || "").slice(0, 10);
    const stVal = String(statusSel?.value || "").trim(); // running/ended/locked/ ""

const list = await getLessonsLogMerged({ from: fromVal, to: toVal, status: stVal });
    let rows = list.filter((x) => inRange(x.date, fromVal, toVal));

    if (stVal) rows = rows.filter((x) => pickStatus(x) === stVal);

    if (summary) summary.textContent = rows.length ? `عدد السجلات: ${rows.length}` : "—";

    if (!rows.length) {
      body.innerHTML = "";
      if (empty) empty.style.display = "block";
      return true;
    }
    if (empty) empty.style.display = "none";

    const periods = await getPeriodsMeta();
    const pMap = new Map((periods || []).map((p) => [String(p.id), p]));

    const labelStatus = (x) => {
      const s = pickStatus(x);
      if (s === "locked") return "معتمدة";
      if (s === "ended") return "منتهية";
      if (s === "running") return "جارية";
      return "—";
    };

    const schedTime = (x) => {
      const p = pMap.get(String(toInt(x.periodId)));
      if (!p) return "—";
      const st = fmtHHMM(p.start_time);
      const en = fmtHHMM(p.end_time);
      return st && en ? `${st} → ${en}` : "—";
    };

    body.innerHTML = rows
      .slice(0, 300)
      .map((x) => {
        const sessionId = x.sessionId ? String(x.sessionId) : "";
        const openBtn = sessionId
          ? `<button type="button" class="primary-btn" data-open-att-session="${esc(
              sessionId
            )}" style="padding:.35rem .6rem;">
               <i class="ri-external-link-line"></i> فتح الحضور
             </button>`
          : `<span class="muted">—</span>`;

        const dur = x.durationSeconds ? formatHMS(x.durationSeconds) : "—";
        const lesson = x.lessonNo
          ? `الحصة ${esc(x.lessonNo)}`
          : x.periodId
          ? `الحصة ${esc(x.periodId)}`
          : "—";
        const scope = `${esc(x.gradeName || "")} / ${esc(x.sectionName || "")}`.trim();

        return `
          <tr>
            <td>${esc(String(x.date || "").slice(0, 10))}</td>
            <td>${lesson}</td>
            <td>${scope || "—"}</td>
            <td>${esc(x.subjectName || "—")}</td>
            <td>${esc(schedTime(x))}</td>
            <td>${esc(fmtLocalTime(x.startISO))}</td>
            <td>${esc(fmtLocalTime(x.endISO))}</td>
            <td>${esc(dur)}</td>
            <td>${esc(labelStatus(x))}</td>
            <td>${openBtn}</td>
          </tr>
        `;
      })
      .join("");

    body.querySelectorAll("[data-open-att-session]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sid = btn.getAttribute("data-open-att-session");
        if (!sid) return;
        if (typeof window.__openAttendanceForSession === "function") {
          window.__openAttendanceForSession(sid);
        } else {
          toast("فتح الحضور غير جاهز (window.__openAttendanceForSession غير موجود).");
        }
      });
    });

    return true;
  }

  /* =========================
     Snapshot / Restore (لحماية مودال ls من أي إعادة تهيئة)
  ========================= */
  function snapshotPicker(prefix) {
    const stage = byId(prefix + "-stage");
    const grade = byId(prefix + "-grade");
    const section = byId(prefix + "-section");
    const subject = byId(prefix + "-subject");
    const lesson = byId(prefix + "-lesson");
    const date = byId(prefix + "-date");

    if (!stage && !grade && !section && !subject && !lesson) return null;

    return {
      prefix,
      stageId: stage?.value || "",
      gradeId: grade?.value || "",
      sectionId: section?.value || "",
      subjectId: subject?.value || "",
      periodId: lesson?.value || "",
      dateVal: String(date?.value || "").slice(0, 10) || "",
      disabled: {
        stage: !!stage?.disabled,
        grade: !!grade?.disabled,
        section: !!section?.disabled,
        subject: !!subject?.disabled,
        lesson: !!lesson?.disabled,
      },
    };
  }

  async function restorePicker(prefixSnap, TS) {
    if (!prefixSnap) return;

    const prefix = prefixSnap.prefix;
    const stage = byId(prefix + "-stage");
    const grade = byId(prefix + "-grade");
    const section = byId(prefix + "-section");
    const subject = byId(prefix + "-subject");
    const lesson = byId(prefix + "-lesson");

    if (!stage && !grade && !section && !subject && !lesson) return;

    const setVal = (el, val, fireChange = true) => {
      if (!el) return;
      if (val == null || val === "") return;
      el.value = String(val);
      if (fireChange) el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    setVal(stage, prefixSnap.stageId, true);
    await sleep(60);

    setVal(grade, prefixSnap.gradeId, true);
    await sleep(60);

    setVal(section, prefixSnap.sectionId, true);
    await sleep(60);

    setVal(subject, prefixSnap.subjectId, true);
    await sleep(80);

    try {
      const dateVal =
        prefixSnap.dateVal ||
        String(byId(prefix + "-date")?.value || "").slice(0, 10) ||
        (typeof TS?.todayISO === "function" ? TS.todayISO() : todayISO());

      const scope =
        typeof TS?.getTeachingScope === "function" ? TS.getTeachingScope(prefix) : null;

      if (typeof TS?.filterLessonsByTeacherDay === "function" && lesson) {
        await TS.filterLessonsByTeacherDay(lesson, scope, dateVal);
      }

      if (lesson && prefixSnap.periodId) lesson.value = String(prefixSnap.periodId);
    } catch (e) {
      console.warn("restorePicker failed:", e);
    }

    try {
      if (stage) stage.disabled = !!prefixSnap.disabled.stage;
      if (grade) grade.disabled = !!prefixSnap.disabled.grade;
      if (section) section.disabled = !!prefixSnap.disabled.section;
      if (subject) subject.disabled = !!prefixSnap.disabled.subject;
      if (lesson) lesson.disabled = !!prefixSnap.disabled.lesson;
    } catch {}
  }

  /* =========================
     Patch TeachingScopes.filterLessonsByTeacherDay + حماية applyAttCtxToUI
     + حماية من تلوّث periodEntryMap (scope+date)
  ========================= */
  function getYearTermSafe(TS) {
    // prefer TS.getYearTermForTeacher, else fallback to localStorage keys used in your project
    try {
      if (TS?.getYearTermForTeacher) {
        const r = TS.getYearTermForTeacher();
        const yearId = toInt(r?.yearId ?? r?.academicYearId ?? 0) || toInt(r?.year_id ?? 0) || 1;
        const term = toInt(r?.term ?? 0) || 1;
        return { yearId, term };
      }
    } catch {}
    const yearId = toInt(localStorage.getItem("TT_YEAR_ID") || 1) || 1;
    const term = toInt(localStorage.getItem("TT_TERM") || 1) || 1;
    return { yearId, term };
  }

  function scopeKey(scope, dateVal) {
    const s = scope || {};
    return [
      String(dateVal || ""),
      String(toInt(s.stageId)),
      String(toInt(s.gradeId)),
      String(toInt(s.sectionId)),
      String(toInt(s.subjectId)),
    ].join("|");
  }

  function patchTeachingScopesFilter() {
    const TS = window.TeachingScopes;
    if (!TS || TS.__sessions_patched_filter === true) return;

    TS.__sessions_patched_filter = true;
    TS.__periodEntryMap = TS.__periodEntryMap || Object.create(null);
    TS.__periodEntryMapMeta = TS.__periodEntryMapMeta || Object.create(null);

    TS.filterLessonsByTeacherDay = async function (selectEl, scope, dateOverride) {
      if (!selectEl) return;

      try {
        let dateVal = String(dateOverride || "").slice(0, 10);

        if (!dateVal) {
          const id = String(selectEl.id || "");
          if (id.startsWith("ls-")) dateVal = String(byId("ls-date")?.value || "").slice(0, 10);
          else dateVal = String(byId("att-date")?.value || "").slice(0, 10);
        }

        dateVal = dateVal || (typeof TS.todayISO === "function" ? TS.todayISO() : todayISO());

        if (!scope?.sectionId || !scope?.subjectId) {
          selectEl.innerHTML = `<option value="">اختر الشعبة والمادة أولاً</option>`;
          selectEl.disabled = true;
          return;
        }

        const { yearId, term } = getYearTermSafe(TS);
        const periodsMeta = (await getPeriodsMeta()).slice();
        const periodById = new Map(periodsMeta.map((p) => [String(p.id), p]));

let entries = await fetchEntriesWithDayFallback({
          yearId,
          term,
          sectionId: scope.sectionId,
          subjectId: scope.subjectId,
          dateVal,
        });
entries = filterEntriesStrict(entries, scope, dateVal, TS);

        // فلترة احترازية (تقبل كل الصيغ)
    const daySchool = dayIdFromISO_School(dateVal);

let filtered = (entries || []).filter((e) => {
  const raw = e?.day_of_week ?? e?.day_id ?? e?.day ?? e?.day_name ?? e?.dayName;
  const d = dayNameToSchoolId(raw);
 if (!d) return false;
return d === daySchool;

});


        if (!filtered.length) filtered = entries || [];

        if (!filtered.length) {
          selectEl.innerHTML = `<option value="">لا توجد حصص لك هذا اليوم</option>`;
          selectEl.disabled = true;
          return;
        }

        const uniq = new Map();
        for (const e of filtered) {
          const pid = toInt(e?.period_id ?? e?.periodId ?? e?.period ?? 0);
          if (!pid) continue;

          const entryId = extractTimetableEntryId(e);
          if (!uniq.has(pid)) uniq.set(pid, { periodId: pid, entryId });
        }

        const lessons = Array.from(uniq.values()).sort((a, b) => {
          const pa = periodById.get(String(a.periodId));
          const pb = periodById.get(String(b.periodId));
          const oa = toInt(pa?.sort_order ?? pa?.order ?? pa?.lesson ?? pa?.id ?? a.periodId);
          const ob = toInt(pb?.sort_order ?? pb?.order ?? pb?.lesson ?? pb?.id ?? b.periodId);
          return oa - ob;
        });

        if (!lessons.length) {
          selectEl.innerHTML = `<option value="">لا توجد حصص لك هذا اليوم</option>`;
          selectEl.disabled = true;
          return;
        }

        // ✅ period->entryId map with anti-stale key
        try {
          const sid = String(selectEl.id || "no_id");
          const skey = scopeKey(scope, dateVal);
          TS.__periodEntryMap[sid] = Object.create(null);
          TS.__periodEntryMapMeta[sid] = { skey, at: Date.now() };

          lessons.forEach((l) => {
            if (l?.entryId) TS.__periodEntryMap[sid][String(l.periodId)] = toInt(l.entryId);
          });
        } catch (e) {
          console.warn("periodEntryMap set failed:", e);
        }
// ✅ جلب جلسات اليوم (لمنع إعادة بدء الحصة المنتهية)
let slotsMap = new Map();
try {
  slotsMap = await fetchSessionSlotsMap({
    yearId,
    term,
    dateVal,
    sectionId: toInt(scope.sectionId),
    subjectId: toInt(scope.subjectId) || null,
  });
} catch (e) {
  slotsMap = new Map();
}

        const currentValue = selectEl.value;
        selectEl.disabled = false;
        selectEl.innerHTML =
          `<option value="">اختر الحصة</option>` +
          lessons
            .map((l) => {
              const p = periodById.get(String(l.periodId));
              const lessonNo = toInt(p?.sort_order ?? p?.order ?? p?.lesson ?? p?.id ?? l.periodId);
              const name = p?.name || `الحصة ${lessonNo || l.periodId}`;
              const st = fmtHHMM(p?.start_time);
              const en = fmtHHMM(p?.end_time);
              const time = st && en ? ` (${st}-${en})` : "";
              const entryAttr = l?.entryId ? ` data-entry-id="${toInt(l.entryId)}"` : "";
              const selected = String(currentValue) === String(l.periodId) ? "selected" : "";
              // ✅ هل هذه الحصة منتهية/معتمدة؟
const slot = slotsMap.get(String(l.periodId));
const localFin = findFinishedSessionInLog(dateVal, l.periodId, scope);
const serverLocked = toBool(slot?.is_locked);
const serverEnded = !!(slot?.ended_at);
const finishedState = serverLocked ? "locked" : serverEnded ? "ended" : (localFin?.state || "");
const finishedSid = toInt(slot?.id) || toInt(localFin?.sessionId);

const finished = !!finishedState;

let labelSuffix = "";
if (finishedState === "locked" || finishedState === "ended") {
  labelSuffix = " — ✅ منتهية"; // ✅ زر واحد: إنهاء = اعتماد
}


const finishedAttr = finished
  ? ` data-finished="1" data-finish-state="${finishedState}" data-session-id="${finishedSid}"`
  : "";

return `<option value="${l.periodId}" data-lesson="${lessonNo}"${entryAttr}${finishedAttr} ${selected}>
  ${esc(name + time + labelSuffix)}
</option>`;


            })
            .join("");
      } catch (e) {
        console.warn("filterLessonsByTeacherDay(patched) failed:", e);
        selectEl.innerHTML = `<option value="">اختر الحصة</option>`;
        selectEl.disabled = false;
      }
    };

    // حماية إعادة التهيئة التي كانت تُسقط اختيارات ls
    if (typeof TS.applyAttCtxToUI === "function" && TS.__sessions_patched_apply !== true) {
      TS.__sessions_patched_apply = true;

      const originalApply = TS.applyAttCtxToUI.bind(TS);

      TS.applyAttCtxToUI = async function (ctx) {
        const lsSnap = snapshotPicker("ls");
        const ret = await originalApply(ctx);

        if (lsSnap) {
          try {
            await sleep(40);
            await restorePicker(lsSnap, TS);
            await sleep(220);
            await restorePicker(lsSnap, TS);
          } catch (e) {
            console.warn("applyAttCtxToUI restore failed:", e);
          }
        }

        return ret;
      };
    }
  }
function getJwtPayloadSafe() {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;

    // base64url -> base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);

    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
// ===================== Permissions (JWT-based UI guard) =====================
const PERMS = {
  ATT_VIEW: "attendance.view",
  ATT_WRITE: "attendance.write",   // حفظ حضور (بدون اعتماد)
  ATT_LOCK: "attendance.lock",     // اعتماد/قفل
  ATT_CORRECT: "attendance.correct",// تصحيح بعد الاعتماد

  LS_START: "lesson.start",        // بدء حصة
  LS_END: "lesson.end",            // إنهاء/اعتماد حصة
};

function __getPermSetFromJwtPayload(jwt) {
  if (!jwt || typeof jwt !== "object") return null;

  // roles/admin shortcuts
  const rolesRaw = jwt.roles ?? jwt.role ?? jwt.user_role ?? jwt.userRole ?? null;
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.map(String)
    : rolesRaw
    ? [String(rolesRaw)]
    : [];

  const isAdmin =
    roles.some((r) => String(r).toLowerCase().includes("admin")) ||
    jwt.is_admin === true ||
    jwt.isAdmin === true;

  // permissions shapes
  const p1 = jwt.permissions ?? jwt.perms ?? jwt.scopes ?? jwt.scope ?? null;

  let list = [];
  if (Array.isArray(p1)) list = p1;
  else if (typeof p1 === "string") list = p1.split(/[,\s]+/g);
  else if (p1 && typeof p1 === "object" && Array.isArray(p1.list)) list = p1.list;

  // if nothing present: return null (unknown => do not block UI)
  if (!isAdmin && (!list || !list.length)) return null;

  const set = new Set();
  if (isAdmin) set.add("*");

  (list || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .forEach((x) => set.add(x));

  return set;
}

function __permCandidates(name) {
  const n = String(name || "").trim();
  if (!n) return [];
  const out = new Set();

  out.add(n);
  out.add("teacher." + n);

  // dot/colon variants
  out.add(n.replace(/\./g, ":"));
  out.add(n.replace(/:/g, "."));
  out.add(("teacher." + n).replace(/\./g, ":"));
  out.add(("teacher." + n).replace(/:/g, "."));

  // also without teacher.
  out.add(n.replace(/^teacher\./, ""));
  out.add(n.replace(/^teacher\./, "").replace(/\./g, ":"));

  return Array.from(out);
}

function canPerm(name) {
  const jwt = getJwtPayloadSafe();
  const set = __getPermSetFromJwtPayload(jwt);

  // unknown permissions => لا نمنع الواجهة (السيرفر سيتولى المنع)
  if (!set) return true;

  if (set.has("*") || set.has("all") || set.has("ALL")) return true;

  const cands = __permCandidates(name);
  return cands.some((c) => set.has(c));
}

function getMyTeacherIdGuess(TS) {
  const jwt = getJwtPayloadSafe();

  return (
    toInt(TS?.ME?.teacher_id) ||
    toInt(TS?.ME?.teacherId) ||
    toInt(window.__ME__?.teacher_id) ||
    toInt(window.__USER__?.teacher_id) ||
    toInt(localStorage.getItem("teacher_id")) ||
    toInt(localStorage.getItem("TEACHER_ID")) ||

    // ✅ من داخل التوكن (الأهم غالبًا عندك)
    toInt(jwt?.teacher_id) ||
    toInt(jwt?.teacherId) ||
    toInt(jwt?.teacher?.id) ||
    toInt(jwt?.teacher?.teacher_id) ||

    0
  );
}

function dayNameToSchoolId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;

  // ✅ أولوية: أرقام نظام المدرسة عندك (1=سبت..7=جمعة)
  const n = parseInt(s, 10);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 7) return n;  // ✅ هذا هو الصحيح لنظامك
    if (n === 0) return 2;           // JS Sunday(0) -> School Sunday(2)
    return 0;
  }

  // عربي
  const ar = s.replace("الأ", "ال");
  const mapAR = {
    "السبت": 1,
    "الاحد": 2,
    "الأحد": 2,
    "الاثنين": 3,
    "الإثنين": 3,
    "الثلاثاء": 4,
    "الاربعاء": 5,
    "الأربعاء": 5,
    "الخميس": 6,
    "الجمعة": 7,
  };
  if (mapAR[ar]) return mapAR[ar];

  // English
  const en = s.toLowerCase();
  const mapEN = {
    saturday: 1,
    sunday: 2,
    monday: 3,
    tuesday: 4,
    wednesday: 5,
    thursday: 6,
    friday: 7,
  };
  return mapEN[en] || 0;
}

function filterEntriesStrict(entries, scope, dateVal, TS) {
  const arr = Array.isArray(entries) ? entries : [];

  const secId = toInt(scope?.sectionId || 0);
  const subId = toInt(scope?.subjectId || 0);
  const grdId = toInt(scope?.gradeId || 0);
  const stgId = toInt(scope?.stageId || 0);

  const myTid = getMyTeacherIdGuess(TS);

  const p = parseYMD(dateVal);
  const jsDay = p ? new Date(p.y, p.mo - 1, p.d).getDay() : 0; // 0..6
  const daySchool = dayIdFromISO_School(dateVal);               // 1..7 (Sat..Fri)
  const isoDay = isoDayFromISO(dateVal);                        // 1..7 (Mon..Sun)

  // هل السيرفر يرسل day فعلاً؟
  const anyHasDay = arr.some((e) =>
    (e?.day_of_week ?? e?.day_id ?? e?.day ?? e?.day_name ?? e?.dayName) != null
  );

  return arr.filter((e) => {
    const eSec = toInt(e?.section_id ?? e?.sectionId ?? e?.section ?? 0);
    const eSub = toInt(e?.subject_id ?? e?.subjectId ?? e?.subject ?? 0);
    const eGrd = toInt(e?.grade_id ?? e?.gradeId ?? 0);
    const eStg = toInt(e?.stage_id ?? e?.stageId ?? 0);

    // ✅ فلترة scope صارمة (لو الحقول موجودة)
    if (secId && eSec && eSec !== secId) return false;
    if (subId && eSub && eSub !== subId) return false;
    if (grdId && eGrd && eGrd !== grdId) return false;
    if (stgId && eStg && eStg !== stgId) return false;

    // ✅ فلترة teacher لو teacher_id موجود
    const eTid = toInt(e?.teacher_id ?? e?.teacherId ?? e?.teacher ?? 0);
    if (myTid && eTid && eTid !== myTid) return false;

    // ✅ فلترة اليوم: إذا day موجود لازم يطابق، وإذا غير معروف نرفضه
    if (anyHasDay) {
      const raw = e?.day_of_week ?? e?.day_id ?? e?.day ?? e?.day_name ?? e?.dayName;
      const d = dayNameToSchoolId(raw);
      if (!d) return false;
return d === daySchool;
    }

    return true;
  });
}

  /* =========================
     Public init (مُحصّن ضد ترتيب تحميل الملفات)
  ========================= */
  async function waitForTeachingScopes(maxTries = 60, delayMs = 100) {
    for (let i = 0; i < maxTries; i++) {
      const TS = window.TeachingScopes;
      if (TS?.initTeachingPicker) return TS;
      await sleep(delayMs);
    }
    return null;
  }

window.TeacherSessions = {
  init() {
    // ✅ Guard: لا نسمح بتسجيل مستمعين/تهيئة أكثر من مرة
    if (window.TeacherSessions.__inited) return;
    window.TeacherSessions.__inited = true;

    // patchTeachingScopesFilter();

    (async () => {
      const TS = window.TeachingScopes || (await waitForTeachingScopes());
      if (!TS) {
        console.warn("TeachingScopes not ready; TeacherSessions init skipped.");
        return;
      }

      patchTeachingScopesFilter();
      initAttendanceDB();
      initLessonsDB();
      initLessonsTabsAndReport();
    })().catch((e) => console.warn("TeacherSessions.init failed:", e));
  },
};


  /* =========================
     Attendance
  ========================= */


  /* =========================
   ✅ QRCode: Stop + Clear (كاميرا + مكتبة + UI)
   ضع هذا القسم بعد helpers مباشرة (بعد toast/toInt/sleep)
========================= */

const __QR_STATE = {
  stream: null,
  pauseUntil: 0,   // توقف مؤقت بعد قراءة QR لتفادي التكرار
  last: "",
  lastAt: 0,
  busy: false      // نفعّلها أثناء إرسال الطلب للسيرفر
};

function isQrCameraRunning() {
  const s = __QR_STATE.stream;
  if (!s) return false;
  try {
    const tracks = s.getTracks ? s.getTracks() : [];
    return tracks.some((t) => t && t.readyState === "live");
  } catch {
    return true;
  }
}
function normalizeQR(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  s = s.replace(/\s+/g, "");
  if (/^SS:/i.test(s)) s = s.slice(3);
  return s;
}

function extractTokenLike(s) {
  let t = normalizeQR(s);
  t = t.replace(/^['\u2018\u2019\"]+|['\u2018\u2019\"]+$/g, "");
  try {
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t);
      t = u.searchParams.get("token") || u.searchParams.get("qr") || u.searchParams.get("code") || t;
      t = normalizeQR(t);
    }
  } catch {}
  try {
    const m = String(t || "").match(/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    if (m && m[1]) t = m[1];
  } catch {}
  t = t.replace(/[.,;:)]+$/g, "");
  return t;
}

function isJwtLike(s) {
  const ss = String(s || "").trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ss);
}

// ✅ تنظيف حقل الإدخال فقط بدون مسح السجل
function resetScanInputKeepLog() {
  const { token, msg } = __scanEls();
  try { if (token) token.value = ""; } catch {}
  try { if (msg) msg.textContent = "وجّه الكاميرا نحو QR الخاص بالطالب."; } catch {}
}

function __scanEls() {
  return {
    modal: byId("modal-attendance"),
    video: byId("att-scan-video"),
    token: byId("att-scan-token"),
    msg: byId("att-scan-msg"),
    lastBox: byId("att-scan-last"),
    lastText: byId("att-scan-last-text"),
    log: byId("att-scan-log"),
  };
}
// ===================== QR CAMERA START =====================
async function startAttendanceQrCamera() {
  const { video, msg, token } = __scanEls();
  if (!video) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    __QR_STATE.stream = stream;
    video.srcObject = stream;
    video.style.display = "";
    await video.play();

    if (msg) msg.textContent = "الكاميرا تعمل... وجّهها نحو QR";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const scanLoop = () => {
      if (!__QR_STATE.stream) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if (window.jsQR) {
          const code = jsQR(imageData.data, imageData.width, imageData.height);
 if (code && code.data) {
  // لو السيرفر الآن شغال بمعالجة مسح سابق، لا تكرر
  if (__QR_STATE.busy) { requestAnimationFrame(scanLoop); return; }

  const now = Date.now();
  if (now < (__QR_STATE.pauseUntil || 0)) { requestAnimationFrame(scanLoop); return; }

  const cleaned = extractTokenLike(code.data);

  if (!cleaned || !isJwtLike(cleaned)) {
    if (msg) msg.textContent = "QR غير صالح — حاول مرة أخرى.";
    requestAnimationFrame(scanLoop);
    return;
  }

  // منع نفس الرمز يتكرر بسرعة (لو الكاميرا ثابتة على نفس QR)
  if (__QR_STATE.last === cleaned && (now - (__QR_STATE.lastAt || 0)) < 1500) {
    requestAnimationFrame(scanLoop);
    return;
  }
  __QR_STATE.last = cleaned;
  __QR_STATE.lastAt = now;

  // ضع الرمز بالحقل وشغل submit
  if (token) token.value = cleaned;
  if (msg) msg.textContent = "تم قراءة QR ✅ جاري التسجيل...";

  // وقف مؤقت قصير حتى لا يقرأ نفس الكود مرات
  __QR_STATE.pauseUntil = now + 1200;

  try {
    const btn = byId("att-scan-submit");
    btn && btn.click();
  } catch {}

  // نكمل الحلقة بدون ما نطفي الكاميرا
  requestAnimationFrame(scanLoop);
  return;
}


        }
      }

      requestAnimationFrame(scanLoop);
    };

    requestAnimationFrame(scanLoop);

  } catch (e) {
    toast("تعذر تشغيل الكاميرا: " + (e.message || ""));
  }
}
// ===================== END QR CAMERA =====================

async function __scanStopCamera() {
  try {
    const { video } = __scanEls();
    const s = __QR_STATE.stream || (video && video.srcObject);

    if (s && typeof s.getTracks === "function") {
      s.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    }
  } catch {}
  __QR_STATE.stream = null;

  try {
    const { video } = __scanEls();
    if (video) {
      video.pause?.();
      video.srcObject = null;
      video.style.display = "none";
    }
  } catch {}
}

function clearAttendanceQrFully() {
  const { token, msg, lastBox, lastText, log } = __scanEls();

  try { if (token) token.value = ""; } catch {}
  try { if (msg) msg.textContent = "وجّه الكاميرا نحو QR الخاص بالطالب."; } catch {}

  try { if (lastText) lastText.textContent = "—"; } catch {}
  try { if (lastBox) lastBox.style.display = "none"; } catch {}

  try { if (log) log.innerHTML = ""; } catch {}
}

async function stopAndClearAttendanceQr() {
  await __scanStopCamera();
  clearAttendanceQrFully();
}

// خليها عامة لو تحب
window.stopAndClearAttendanceQr = stopAndClearAttendanceQr;
// اجعل الاسم القديم يعمل نفس وظيفة الجديد (توثيق/توافق)
window.clearQrCodeFully = stopAndClearAttendanceQr;



  function initAttendanceDB() {
  // ✅ Guard
  if (initAttendanceDB.__done) return;
  initAttendanceDB.__done = true;

  const TS = window.TeachingScopes;
  if (!TS?.initTeachingPicker) return;
// ✅ ضمان تحميل أسباب الغياب قبل أي عرض
ensureAttendanceMetaOnce(TS).catch(() => {});

  const tbody = byId("att-table-body");
  if (!tbody) return;

  // === Tabs + Views ===
// === Tabs + Views ===
const tabTake = byId("att-tab-take");
const tabPerms = byId("att-tab-perms");   // ✅ أضف هذا
const tabHist = byId("att-tab-history");
const tabRep = byId("att-tab-report");

// ✅ منع إغلاق مودال الحضور لو فيه تغييرات غير محفوظة
try {
  const modal = byId("modal-attendance");
  const closeBtns = modal ? modal.querySelectorAll("[data-close-modal]") : [];
  closeBtns.forEach((btn) => {
    btn.addEventListener(
      "click",
      async (e) => {
        if (__ATT_ALLOW_CLOSE_ONCE) {
          __ATT_ALLOW_CLOSE_ONCE = false;
          return;
        }

        if (ACTIVE_LOCKED || !HAS_DIRTY) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (!(await canLeaveTakeTab())) return;

        __ATT_ALLOW_CLOSE_ONCE = true;
        btn.click();
      },
      true
    );
  });
} catch {}

const viewTake = byId("att-view-take");
const viewPerms = byId("att-view-perms"); // ✅ أضف هذا
const viewHist = byId("att-view-history");
const viewRep = byId("att-view-report");
const tabScan  = byId("att-tab-scan");     // ✅ الصحيح
// tabScan?.addEventListener("click", () => {
//   startAttendanceQrCamera();
// });

const viewScan = byId("att-view-scan");    // ✅ الصحيح
   // ✅ شاشة QR

  // === New UI elements (لو طبّقت المودال الجديد) ===
  const needStartEl = byId("att-need-start");
  const liveAreaEl = byId("att-live-area");
  const goLessonsBtn = byId("att-go-lessons");
  const refreshSessionBtn = byId("att-refresh-session");
const refreshAllBtn = byId("att-refresh-all"); // ✅
// ✅ Bind scan controls once
(function bindScanClearOnce() {
  if (bindScanClearOnce.__done) return;
  bindScanClearOnce.__done = true;

  const btnClear = byId("att-scan-clear");
  const btnStop  = byId("att-scan-stop");

  btnClear?.addEventListener("click", () => {
    stopAndClearAttendanceQr().catch(() => {});
  });

  btnStop?.addEventListener("click", () => {
    __scanStopCamera().catch(() => {});
  });

  // ✅ عند إغلاق مودال الحضور امسح/اطفئ الكاميرا
  const modal = byId("modal-attendance");
  modal?.querySelectorAll("[data-close-modal]")?.forEach((b) => {
    b.addEventListener("click", () => {
      stopAndClearAttendanceQr().catch(() => {});
    }, true);
  });
})();

// ===================== SCAN LOG (time / student / result) =====================
const __SCAN_MEM = { lastToken: "", lastAt: 0, busy: false };
const __SCAN_SEEN = { sessionId: null, set: new Set() };

function nowHHMMSS() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function resolveStudentFromTable(studentId) {
  try {
    const row = tbody.querySelector(`tr.att-row[data-student-id="${String(studentId)}"]`);
    if (!row) return null;
    const name = row.dataset.studentName || "";
    const code = row.dataset.studentCode || "";
    return { name, code };
  } catch {
    return null;
  }
}

function parseScanResponse(resp) {
  const r = resp?.data ?? resp ?? {};
  const ok = r?.ok ?? r?.success ?? r?.status === "ok" ?? true;

  // حاول استخراج طالب بأي شكل
  const studentObj =
    r?.student ?? r?.data?.student ?? r?.result?.student ?? r?.payload?.student ?? null;

  const studentId =
    toInt(studentObj?.id ?? studentObj?.student_id ?? r?.studentId ?? r?.student_id ?? 0) || 0;

  const studentName =
    String(studentObj?.name ?? studentObj?.student_name ?? r?.studentName ?? r?.student_name ?? "").trim();

  const studentCode =
    String(studentObj?.code ?? studentObj?.student_code ?? r?.studentCode ?? r?.student_code ?? "").trim();

  const message =
    String(r?.message ?? r?.msg ?? r?.result ?? r?.raw ?? "").trim();

  return { ok: !!ok, studentId, studentName, studentCode, message };
}

function setScanLastUI(text) {
  try {
    const lastBox = byId("att-scan-last");
    const lastText = byId("att-scan-last-text");
    if (lastText) lastText.textContent = text || "—";
    if (lastBox) lastBox.style.display = text ? "" : "none";
  } catch {}
}

function appendScanLogRow({ time, student, result, ok }) {
  const logEl = byId("att-scan-log");
  if (!logEl) return;

  const safeTime = esc(time || nowHHMMSS());
  const safeStudent = esc(student || "—");
  const safeResult = esc(result || "—");

  // لو logEl هو TBODY (الأفضل)
  const tag = String(logEl.tagName || "").toUpperCase();
  if (tag === "TBODY") {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${safeTime}</td>
      <td>${safeStudent}</td>
      <td>${safeResult}</td>
    `;
    // أضف بالأعلى
    logEl.insertBefore(tr, logEl.firstChild);

    // حدّ أقصى 60 صف
    while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
    return;
  }

  // fallback: لو كان DIV
  const div = document.createElement("div");
  div.className = "muted-box";
  div.style.cssText = "display:flex;gap:.6rem;align-items:center;justify-content:space-between;";
  div.innerHTML = `<span>${safeTime}</span><strong>${safeStudent}</strong><span>${safeResult}</span>`;
  logEl.insertBefore(div, logEl.firstChild);
  while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

const scanSubmitBtn = byId("att-scan-submit"); // زر "تسجيل/تحقق"
// ✅ Enter داخل حقل الـ QR = نفس زر "تسجيل"
(function bindScanEnterOnce(){
  if (bindScanEnterOnce.__done) return;
  bindScanEnterOnce.__done = true;

  const tokenEl = byId("att-scan-token");
  const btn = byId("att-scan-submit");
  if (!tokenEl || !btn) return;

  tokenEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btn.click();
    }
  });
})();

scanSubmitBtn?.addEventListener("click", async () => {
  if (__SCAN_MEM.busy) return;

  try {
    if (!ACTIVE_SESSION_ID) return toast("لا توجد جلسة نشطة. ابدأ الحصة أولاً.");

    const tokenEl = byId("att-scan-token");
    const raw = String(tokenEl?.value || "");
    const cleaned = extractTokenLike(raw);

    if (!cleaned) return toast("الصق/امسح رمز QR أولاً.");
    if (!isJwtLike(cleaned)) return toast("QR غير صالح (تأكد من لصق الرمز كاملًا).");

    // منع تكرار نفس الرمز بسرعة
    const now = Date.now();
    if (__SCAN_MEM.lastToken === cleaned && (now - __SCAN_MEM.lastAt) < 1200) return;
    __SCAN_MEM.lastToken = cleaned;
    __SCAN_MEM.lastAt = now;

   __SCAN_MEM.busy = true;
__QR_STATE.busy = true; // ✅ يمنع scanLoop من الإرسال المتكرر


    // ✅ نلتقط رد السيرفر
    const resp = await apiPost(
      `/teacher/attendance/sessions/${encodeURIComponent(ACTIVE_SESSION_ID)}/scan`,
      { qrText: cleaned, token: cleaned, scanToken: cleaned }
    );

    const info = parseScanResponse(resp);
// ✅ لو نفس الطالب تم تحضيره سابقاً في نفس الجلسة
const sid = toInt(info.studentId || 0);
const alreadyPrepared = sid && __SCAN_SEEN.set && __SCAN_SEEN.set.has(sid);

if (alreadyPrepared) {
  const hit = resolveStudentFromTable(sid);
  const nm = info.studentName || hit?.name || "طالب";
  const cd = info.studentCode || hit?.code || "";
  const studentLabel = nm + (cd ? ` (${cd})` : "");

  appendScanLogRow({
    time: nowHHMMSS(),
    student: studentLabel,
    result: "تم تحضيره مسبقاً ✅",
    ok: true
  });

  setScanLastUI(`${studentLabel} — تم تحضيره مسبقاً ✅`);
  toast("هذا الطالب تم تحضيره مسبقاً ✅");

  // جهّز للمسح التالي
  resetScanInputKeepLog();
  try { byId("att-scan-token")?.focus?.(); } catch {}

  return; // ✅ لا داعي نعيد تحميل الجلسة
}

    // حاول تكملة بيانات الطالب من جدول الحضور لو ما رجعت من السيرفر
    let name = info.studentName;
    let code = info.studentCode;

    if ((!name || !code) && info.studentId) {
      const hit = resolveStudentFromTable(info.studentId);
      if (hit) {
        name = name || hit.name;
        code = code || hit.code;
      }
    }

    const studentLabel = (name ? name : "طالب") + (code ? ` (${code})` : "");
    const resultLabel = info.ok ? "تم ✅" : ("فشل ❌" + (info.message ? ` — ${info.message}` : ""));

    // ✅ Update UI
    appendScanLogRow({
      time: nowHHMMSS(),
      student: studentLabel,
      result: resultLabel,
      ok: info.ok
    });

    setScanLastUI(`${studentLabel} — ${resultLabel}`);

    // حدّث الحضور
    await loadSession(ACTIVE_SESSION_ID);

    // امسح الحقل فقط (بدون مسح السجل)
    try { if (tokenEl) tokenEl.value = ""; } catch {}

    toast("تم تسجيل الحضور عبر QR ✅");
if (info.ok && sid) {
  __SCAN_SEEN.set.add(sid);
}

    // ✅ شغل الكاميرا مرة ثانية تلقائياً إذا لازلت في تبويب المسح
  

  } catch (e) {
    // حتى الفشل نكتبه في السجل
    try {
      appendScanLogRow({
        time: nowHHMMSS(),
        student: "—",
        result: "فشل ❌ — " + (e.message || ""),
        ok: false
      });
      setScanLastUI("فشل ❌ — " + (e.message || ""));
    } catch {}

    toast("فشل QR: " + (e.message || ""));
  } finally {
__SCAN_MEM.busy = false;
__QR_STATE.busy = false;

// ✅ خلي الكاميرا شغالة دائماً في تبويب scan
try {
  if (__ATT_CURRENT_TAB === "scan" && ACTIVE_SESSION_ID && !ACTIVE_LOCKED) {
    resetScanInputKeepLog();
    if (!isQrCameraRunning()) startAttendanceQrCamera().catch(() => {});
  }
} catch {}
  }
});


  // === Legacy elements (الواجهة القديمة) ===
  const loadBtn = byId("att-load"); // كان ينشئ جلسة (سنمنعه)
  const scopeSummaryEl = byId("att-scope-summary"); // اختياري/قديم
  const dateInput = byId("att-date"); // قد لا يوجد بعد التعديل
  const lessonSelect = byId("att-lesson"); // قد لا يوجد بعد التعديل

  const allPresentBtn = byId("att-all-present");
  const allAbsentBtn = byId("att-all-absent");
  const saveBtn = byId("att-save"); // اعتماد (قفل)
  const saveSoftBtn = byId("att-save-soft"); // حفظ فقط
// ===== permissions (attendance) =====
const __CAN_ATT_WRITE = canPerm(PERMS.ATT_WRITE);
const __CAN_ATT_LOCK = canPerm(PERMS.ATT_LOCK);
const __CAN_ATT_CORRECT = canPerm(PERMS.ATT_CORRECT);

// UI hints
if (saveSoftBtn) {
  saveSoftBtn.disabled = !__CAN_ATT_WRITE;
  saveSoftBtn.title = __CAN_ATT_WRITE ? "" : "لا تملك صلاحية حفظ الحضور";
}
if (saveBtn) {
  saveBtn.disabled = !__CAN_ATT_LOCK;
  saveBtn.title = __CAN_ATT_LOCK ? "" : "لا تملك صلاحية اعتماد الحضور";
}

  const onlyIssuesChk = byId("att-only-issues");
  const searchInput = byId("att-search");
  const countsEl = byId("att-counts");

  const hint = byId("att-hint");
  const lockBadge = byId("att-lock-badge");
  if (lockBadge) lockBadge.style.display = "none";

  // === Session summary fields (الجديدة) ===
  const hidSession = byId("att-session-id-hidden");
  const ssum = byId("att-session-summary");
  const ssv = byId("att-session-id-view");
  const sst = byId("att-session-status");
  const ss1 = byId("att-sched-start");
  const ss2 = byId("att-sched-end");

  const scopeView = byId("att-scope-view");
  const dateView = byId("att-date-view");
  const lessonView = byId("att-lesson-view");

  // === History ===
  const historySearchInput = byId("att-history-search");
  const historyShowBtn = byId("att-history-show");
  const historyBody = byId("att-history-body");
  const historyEmpty = byId("att-history-empty");
  const historyFrom = byId("att-history-from");     // قد لا يوجد
  const historyTo = byId("att-history-to");         // قد لا يوجد
  const historyStatus = byId("att-history-status"); // قد لا يوجد
const historyExportBtn = byId("att-history-export-csv");
const historyPrintBtn = byId("att-history-print");
const historySummary = byId("att-history-summary");
let __lastHistoryRows = [];
// ===================== PERMISSIONS TAB (عرض طلبات الأذونات/الأعذار) =====================
(function setupPermsTabOnce() {
  // ✅ Guard: لا نربط أكثر من مرة
  if (setupPermsTabOnce.__done) return;
  setupPermsTabOnce.__done = true;

  const permBadge = byId("perm-badge");
  const permStatus = byId("perm-status");
  const permType = byId("perm-type");
  const permFrom = byId("perm-from");
  const permTo = byId("perm-to");
  const permSearch = byId("perm-search");

  const permShowBtn = byId("perm-show");
  const permExportBtn = byId("perm-export-csv");
  const permPrintBtn = byId("perm-print");

  const permSummary = byId("perm-summary");
  const permList = byId("perm-list");
  const permEmpty = byId("perm-empty");

  let __lastPermRows = [];

  // لو الواجهة/العناصر غير موجودة لا نكسر
  if (!permList && !permEmpty && !permShowBtn && !permExportBtn && !permPrintBtn) {
    window.loadPermitsList = async () => [];
    return;
  }

  function __pickPermRows(r) {
    const data = r?.data ?? r ?? {};
    const rows =
      data?.rows ?? data?.items ?? data?.requests ?? data?.permits ?? data?.data ?? data;
    return Array.isArray(rows) ? rows : [];
  }

 function __normPermStatus(s) {
  const raw = String(s ?? "").trim();
  const v = raw.toLowerCase();

  if (!raw) return "";

  // english-ish
  if (v.includes("pend") || v.includes("wait") || v.includes("review")) return "pending";
  if (v.includes("approv") || v.includes("accept") || v.includes("allow")) return "approved";
  if (v.includes("reject") || v.includes("deny") || v.includes("refus")) return "rejected";

  // عربي (مهم)
  if (/بانتظار|قيد|مراجعة|معلّق|معلق/.test(raw)) return "pending";
  if (/مقبول|تم\s*قبول|معتمد|موافق/.test(raw)) return "approved";
  if (/مرفوض|تم\s*رفض|غير\s*موافق/.test(raw)) return "rejected";

  return v;
}


  function __normPermTypeLocal(t) {
    const v = String(t ?? "").trim().toLowerCase();
    if (!v) return "";
    if (v.includes("late") || v.includes("تأخر") || v.includes("تاخر")) return "late";
    if (v.includes("leave") || v.includes("خروج") || v.includes("استئذان")) return "leave";
    return "absence";
  }

  async function fetchPermitsListFromServer(filters) {
    const { yearId, term } = getYearTermSafe(TS);
    const myTid = getMyTeacherIdGuess(TS);

    const qs = new URLSearchParams();
    if (yearId) qs.set("academicYearId", String(yearId));
    if (term) qs.set("term", String(term));
    if (myTid) {
      qs.set("teacherId", String(myTid));
      qs.set("teacher_id", String(myTid));
    }

    // ✅ Filters
    const st = String(filters?.status || "").trim();
    const ty = String(filters?.type || "").trim();
    const from = String(filters?.from || "").slice(0, 10);
    const to = String(filters?.to || "").slice(0, 10);
    const search = String(filters?.search || "").trim();

    if (st) qs.set("status", st);              // pending/approved/rejected أو حسب الباك-إند
    if (ty) qs.set("type", ty);                // absence/late/leave
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (search) qs.set("search", search);

    // ✅ جرّب عدة مسارات (أضف/غيّر حسب باك-إندك)
    const paths = [
      `/teacher/attendance/permits?${qs.toString()}`,
      `/teacher/attendance/excuses?${qs.toString()}`,
      `/teacher/permissions?${qs.toString()}`,
      `/teacher/requests?${qs.toString()}`,
    ];

    let lastErr = null;
    for (const p of paths) {
      try {
        const r = await apiGet(p);
        const rows = __pickPermRows(r);
        if (Array.isArray(rows)) return rows;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("مسار الأذونات غير موجود في السيرفر");
  }
function __getPermStatusRaw(x) {
  return (
    x?.status ??
    x?.request_status ??
    x?.state ??
    x?.approval_status ??
    x?.admin_status ??
    x?.decision_status ??
    x?.decision ??
    x?.admin_decision ??
    ""
  );
}

function __dedupPermits(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    const id = x?.id ?? x?.permit_id ?? x?.request_id ?? null;
    const key = id
      ? "id:" + String(id)
      : [
          x?.student_id ?? x?.studentId ?? "",
          __normPermTypeLocal(x?.type ?? x?.permit_type ?? x?.request_type ?? x?.kind),
          String(x?.from_date ?? x?.date_from ?? x?.from ?? x?.date ?? "").slice(0, 10),
          String(x?.to_date ?? x?.date_to ?? x?.to ?? "").slice(0, 10),
          __normPermStatus(__getPermStatusRaw(x)),
        ].join("|");

    if (!map.has(key)) map.set(key, x);
  });
  return Array.from(map.values());
}

  function renderPermitsList(rows) {
  const list = __dedupPermits(rows);
__lastPermRows = list;


    if (permSummary) permSummary.textContent = list.length ? `عدد الطلبات: ${list.length}` : "—";

    // badge: عدد المعلّق
    const pendingCount = list.filter(
      (x) => __normPermStatus(x.status ?? x.request_status ?? x.state) === "pending"
    ).length;

    if (permBadge) {
      permBadge.textContent = String(pendingCount);
      permBadge.style.display = pendingCount ? "inline-flex" : "none";
    }

    if (!permList || !permEmpty) return;

    if (!list.length) {
      permList.innerHTML = "";
      permEmpty.style.display = "block";
      return;
    }
    permEmpty.style.display = "none";

    permList.innerHTML = list
      .map((x) => {
const st = __normPermStatus(__getPermStatusRaw(x));
        const ty = __normPermTypeLocal(x.type ?? x.permit_type ?? x.request_type ?? x.kind);

        const studentName = x.student_name ?? x.studentName ?? "—";
        const studentCode = x.student_code ?? x.studentCode ?? "";

        const fromD = String(x.from_date ?? x.date_from ?? x.from ?? x.date ?? "").slice(0, 10);
        const toD = String(x.to_date ?? x.date_to ?? x.to ?? "").slice(0, 10);

        const labelSt =
          st === "approved"
            ? "مقبول"
            : st === "rejected"
            ? "مرفوض"
            : st === "pending"
            ? "معلّق"
            : st || "—";

        const labelTy = ty === "late" ? "تأخر" : ty === "leave" ? "استئذان/خروج" : "غياب";

        const note = x.note ?? x.details ?? x.message ?? x.description ?? "";

        return `
          <div class="muted-box" style="display:flex;flex-direction:column;gap:.35rem;">
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;justify-content:space-between;">
              <div>
                <strong>${esc(studentName)}</strong>
                ${studentCode ? `<span class="att-chip" style="margin-inline-start:.35rem;">${esc(studentCode)}</span>` : ``}
              </div>
              <div style="display:flex;gap:.35rem;flex-wrap:wrap;">
                <span class="att-chip">${esc(labelTy)}</span>
                <span class="att-chip">${esc(labelSt)}</span>
              </div>
            </div>

            <div class="muted" style="display:flex;gap:.6rem;flex-wrap:wrap;">
              ${fromD ? `<span>من: ${esc(fromD)}</span>` : ``}
              ${toD ? `<span>إلى: ${esc(toD)}</span>` : ``}
            </div>

            ${note ? `<div>${esc(note)}</div>` : `<div class="muted">—</div>`}
          </div>
        `;
      })
      .join("");
  }

  // ✅ دالة تحميل واحدة + Global للتاب
  window.loadPermitsList = async function loadPermitsList() {
    const filters = {
      status: String(permStatus?.value || "").trim(),
      type: String(permType?.value || "").trim(),
      from: String(permFrom?.value || "").slice(0, 10),
      to: String(permTo?.value || "").slice(0, 10),
      search: String(permSearch?.value || "").trim(),
    };

    // لو ما حدد المستخدم status: اعرض approved افتراضيًا (تقدر تغيّرها)

    const rows = await fetchPermitsListFromServer(filters);
    renderPermitsList(rows);
    return rows;
  };

  permShowBtn?.addEventListener("click", () => {
    window.loadPermitsList?.().catch((e) => toast("فشل تحميل الأذونات: " + (e.message || "")));
  });

  permExportBtn?.addEventListener("click", () => {
    if (!__lastPermRows.length) return toast("لا توجد بيانات للتصدير.");

    const header = ["student_name", "student_code", "type", "status", "from", "to", "note"];
    const csv =
      header.join(",") +
      "\n" +
      __lastPermRows
        .map((x) => {
          const vals = [
            x.student_name ?? x.studentName ?? "",
            x.student_code ?? x.studentCode ?? "",
            __normPermTypeLocal(x.type ?? x.permit_type ?? x.request_type ?? x.kind),
            __normPermStatus(x.status ?? x.request_status ?? x.state),
            String(x.from_date ?? x.date_from ?? x.from ?? x.date ?? "").slice(0, 10),
            String(x.to_date ?? x.date_to ?? x.to ?? "").slice(0, 10),
            x.note ?? x.details ?? x.message ?? x.description ?? "",
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
          return vals.join(",");
        })
        .join("\n");

    downloadText(`permits_${Date.now()}.csv`, csv);
  });

permPrintBtn?.addEventListener("click", () => {
  try { setAttendanceTab("perms"); } catch {}
  try { window.print(); } catch { toast("تعذر فتح الطباعة."); }
});

})();

  // === Report ===
  const repForm = byId("att-report-form");
  const repStage = byId("rep-stage");
  const repGrade = byId("rep-grade");
  const repSection = byId("rep-section");
  const repSubject = byId("rep-subject");
  const repFrom = byId("rep-from");
  const repTo = byId("rep-to");
  const repStatus = byId("rep-status");
  const repShowBtn = byId("rep-show");
  const repExportBtn = byId("rep-export-csv");
  const repPrintBtn = byId("rep-print");
  const repSummary = byId("rep-summary");
  const repBody = byId("rep-body");
  const repEmpty = byId("rep-empty");

  // ✅ تهيئة الـ pickers (لو موجودة في تقرير الغياب)
  try {
    if (repStage || repGrade || repSection || repSubject) {
      TS.initTeachingPicker("rep");
      TS.ensureAttendanceMeta?.().catch(() => {});
    }
  } catch {}

  // ✅ في الواجهة القديمة: اجعل التاريخ ReadOnly (لكن قد لا يوجد)
  if (dateInput && !dateInput.value)
    dateInput.value = typeof TS.todayISO === "function" ? TS.todayISO() : todayISO();
// (الكود الجديد: يفتح التاريخ ويحدث الحصص عند تغييره)
if (dateInput) {
  // 1. فتح الحقل للتعديل
  dateInput.disabled = false;
  dateInput.readOnly = false;
  dateInput.style.pointerEvents = "auto";

  // 2. وضع تاريخ اليوم افتراضياً إذا كان فارغاً
  if (!dateInput.value) dateInput.value = todayISO();

  // 3. عند تغيير التاريخ يدوياً -> حدث الحصص فوراً
dateInput.addEventListener("change", async () => {
  try {
    const TS = window.TeachingScopes;
    const scope = TS?.getTeachingScope ? TS.getTeachingScope("att") : null;
    if (TS?.filterLessonsByTeacherDay && lessonSelect) {
      await TS.filterLessonsByTeacherDay(lessonSelect, scope, String(dateInput.value || "").slice(0,10));
    }
  } catch {}
});

}

  // ✅ أخفِ نموذج الاختيارات القديم في (تسجيل الحضور) — لأنه ممنوع التحضير قبل بدء الحصة
  // (لو ما طبقت HTML الجديد، هذا يمنع منظر السلكتات ويجبر النظام على “ابدأ الحصة أولاً”)
  try {
    const legacyForm = viewTake?.querySelector("form.form-card");
    if (legacyForm) legacyForm.style.display = "none";
  } catch {}

  // ============== Tab switch ==============
 let __ATT_CURRENT_TAB = "take";
 let __ATT_ALLOW_CLOSE_ONCE = false;

async function canLeaveTakeTab() {
  if (ACTIVE_LOCKED) return true;
  if (!HAS_DIRTY) return true;

  if (window.AppUI?.confirm) {
    return await window.AppUI.confirm({
      title: "تغييرات غير محفوظة",
      message: "لديك تغييرات غير محفوظة في الحضور. هل تريد المتابعة بدون حفظ؟",
      confirmText: "متابعة بدون حفظ",
      cancelText: "العودة للحفظ",
      type: "warning",
    });
  }

  console.warn("AppUI.confirm غير متاح");
  return false;
}
function updateQrViewUI() {
  // معرفات HTML كما أرسلتها لي سابقاً
  const box = byId("att-scan-session-box");     // صندوق معلومات الجلسة
  const need = byId("att-scan-need-session");   // رسالة "لا توجد جلسة"
  const live = byId("att-scan-live");           // منطقة الكاميرا والأزرار

  const sidEl = byId("att-scan-session-id");
  const statusEl = byId("att-scan-session-status");

  // هل توجد جلسة نشطة الآن؟
  if (ACTIVE_SESSION_ID) {
    // إخفاء رسالة التحذير
    if (need) need.style.display = "none";
    
    // إظهار معلومات الجلسة ومنطقة الكاميرا
    if (box) box.style.display = "block";
    if (live) live.style.display = "block";

    // تحديث النصوص
    if (sidEl) sidEl.textContent = "#" + ACTIVE_SESSION_ID;
    if (statusEl) statusEl.textContent = ACTIVE_LOCKED ? "مقفولة" : "جارية";
    
  } else {
    // لا توجد جلسة
    if (need) need.style.display = "block";
    if (box) box.style.display = "none";
    if (live) live.style.display = "none";
  }
}
async function setAttendanceTab(which) {
  const w =
    which === "perms" ? "perms" :
    which === "history" ? "history" :
    which === "report" ? "report" :
    which === "scan" ? "scan" :     // ✅ بدل qr
    "take";
if (w === "scan") {
      updateQrViewUI(); // <--- هذا السطر سيحل مشكلتك
  }
  if (__ATT_CURRENT_TAB === "take" && w !== "take") {
    if (!(await canLeaveTakeTab())) return false;
  }

  __ATT_CURRENT_TAB = w;

  if (__ATT_CURRENT_TAB !== "scan") {
    __scanStopCamera?.().catch?.(() => {});
  }


  tabTake?.classList.toggle("is-active", w === "take");
  tabPerms?.classList.toggle("is-active", w === "perms");
  tabHist?.classList.toggle("is-active", w === "history");
  tabRep?.classList.toggle("is-active", w === "report");

  tabScan?.classList.toggle("is-active", w === "scan");      // ✅
  if (viewScan) viewScan.style.display = w === "scan" ? "" : "none";  // ✅

  if (viewTake) viewTake.style.display = w === "take" ? "" : "none";
  if (viewPerms) viewPerms.style.display = w === "perms" ? "" : "none";
  if (viewHist) viewHist.style.display = w === "history" ? "" : "none";
  if (viewRep) viewRep.style.display = w === "report" ? "" : "none";
  return true;
}

(function bindScanStartButtonOnce(){
  if (bindScanStartButtonOnce.__done) return;
  bindScanStartButtonOnce.__done = true;

  const btnStart =
    byId("att-scan-start") ||
    byId("att-scan-start-btn") ||
    byId("att-scan-camera") ||
    document.querySelector("[data-att-scan-start],[data-scan-start]");

  if (!btnStart) return; // لو ما عندك زر تشغيل في HTML، ما نكسر شيء

  btnStart.addEventListener("click", async () => {
    try {
      // لازم جلسة نشطة وغير مقفولة
      if (!ACTIVE_SESSION_ID) return toast("لا توجد جلسة نشطة. ابدأ الحصة أولاً.");
      if (ACTIVE_LOCKED) return toast("الجلسة معتمدة/مقفولة — لا يمكن تشغيل الكاميرا.");

      // افتح تبويب المسح (بدون تشغيل تلقائي)
      try {
        if (!(await setAttendanceTab("scan"))) return;
      } catch {}

      resetScanInputKeepLog();

      // فوكس على الحقل
      try { byId("att-scan-token")?.focus?.(); byId("att-scan-token")?.select?.(); } catch {}

      // ✅ التشغيل الوحيد للكاميرا هنا
      await startAttendanceQrCamera();
    } catch (e) {
      toast("تعذر تشغيل الكاميرا: " + (e.message || ""));
    }
  });
})();


 tabTake?.addEventListener("click", () => setAttendanceTab("take"));
tabPerms?.addEventListener("click", async () => {                 // ✅
  if (!(await setAttendanceTab("perms"))) return;
window.loadPermitsList?.().catch((e) => toast("فشل تحميل الأذونات: " + (e.message || "")));
});
tabHist?.addEventListener("click", async () => { await setAttendanceTab("history"); });
tabRep?.addEventListener("click", async () => { await setAttendanceTab("report"); });
tabScan?.addEventListener("click", async () => {
  if (!(await setAttendanceTab("scan"))) return;

  // ✅ مهم: حمّل الجلسة من السياق قبل التحقق
  await refreshFromContext().catch(() => {});
  updateQrViewUI();

  // الآن تحقق بعد التحميل
  if (!ACTIVE_SESSION_ID) return toast("لا توجد جلسة نشطة. ابدأ الحصة أولاً.");
  if (ACTIVE_LOCKED) return toast("الجلسة معتمدة/مقفولة — لا يمكن المسح.");

  resetScanInputKeepLog();

  try {
    const msgEl = byId("att-scan-msg");
    if (msgEl) msgEl.textContent = "اضغط (تشغيل الكاميرا) لبدء المسح، أو الصق الرمز ثم Enter.";
  } catch {}

  try { byId("att-scan-token")?.focus(); byId("att-scan-token")?.select?.(); } catch {}
});



  // ============== State ==============
  let ACTIVE_SESSION_ID = null;
  let ACTIVE_LOCKED = false;

  let HAS_DIRTY = false;
  let SAVE_BUSY = false;
  let LOAD_BUSY = false;

  // هل جدول الحضور يحتوي عمود "تصحيح"؟
  const hasCorrectCol = (() => {
    try {
      const table = tbody.closest("table");
      const ths = table?.querySelectorAll("thead th");
      return ths && ths.length >= 6;
    } catch {
      return false;
    }
  })();

  function markDirty() {
    HAS_DIRTY = true;
    updateCounts();
  }
  function clearDirty() {
    HAS_DIRTY = false;
    updateCounts();
  }

  function setNeedStartUI(show) {
    // UI الجديد
    if (needStartEl) needStartEl.style.display = show ? "" : "none";
    if (liveAreaEl) liveAreaEl.style.display = show ? "none" : "";

    // لو ما عندك UI الجديد: على الأقل نظف الجدول
    if (show) {
      try {
        tbody.innerHTML = "";
        if (countsEl) countsEl.textContent = "—";
      } catch {}
    }

    if (hint) {
      hint.textContent = show
        ? "لا يمكن التحضير قبل بدء الحصة من (إدارة الحصص)."
        : ACTIVE_LOCKED
        ? "هذه الجلسة معتمدة ومقفولة — يمكنك فقط عمل (تصحيح) مع سبب."
        : "أنت داخل جلسة حصة نشطة — يمكنك تسجيل الحضور ثم حفظ/اعتماد.";
    }
  }

  function updateLockIndicators(isLocked) {
    const badge = byId("att-lock-badge");
    if (badge) badge.style.display = isLocked ? "inline-flex" : "none";
    if (hint) {
      hint.textContent = isLocked
        ? "هذه الجلسة معتمدة ومقفولة — يمكنك فقط عمل (تصحيح) مع سبب."
        : "أنت داخل جلسة حصة نشطة — يمكنك تسجيل الحضور ثم حفظ/اعتماد.";
    }
  }

  function setLockedUI(locked) {
    ACTIVE_LOCKED = !!locked;

    // في القفل: نمنع التعديل العادي والحفظ، لكن نسمح بـ (تصحيح) فقط
 // في القفل: نمنع التعديل العادي والحفظ، لكن نسمح بـ (تصحيح) فقط لو لديه صلاحية
if (allPresentBtn) allPresentBtn.disabled = ACTIVE_LOCKED;
if (allAbsentBtn) allAbsentBtn.disabled = ACTIVE_LOCKED;

if (saveSoftBtn) saveSoftBtn.disabled = ACTIVE_LOCKED || !__CAN_ATT_WRITE;
if (saveBtn) saveBtn.disabled = ACTIVE_LOCKED || !__CAN_ATT_LOCK;

    tbody.querySelectorAll("tr.att-row").forEach((row) => {
      const st = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";
      setRowStatus(row, st);
    });
  }

  // ============== Status ==============
  const STATUS = ["present", "absent", "late", "excused"];
  const STATUS_LABEL = { present: "حاضر", absent: "غائب", late: "متأخر", excused: "بعذر" };
  /* =========================
     ✅ Approved Permits/Excuses (ربط إذن ولي الأمر بالحضور)
     - يحاول عدة endpoints
     - Cache قصير
     - لا يكسر لو 404/غير موجود
  ========================= */
  const __PERMITS_CACHE = Object.create(null);

  function __pickRowsGeneric(r) {
    const data = r?.data ?? r ?? {};
    const rows = data?.rows ?? data?.items ?? data?.requests ?? data?.permits ?? data?.data ?? data;
    return Array.isArray(rows) ? rows : [];
  }

  function __normPermitType(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return "absence";

    // عربي
    if (s.includes("غياب") || s.includes("اجاز") || s.includes("إجاز") || s.includes("عذر")) return "absence";
    if (s.includes("تأخر") || s.includes("تاخر")) return "late";

    // English-ish
    if (s.includes("late")) return "late";
    if (s.includes("absence") || s.includes("absent") || s.includes("leave") || s.includes("excuse")) return "absence";

    return s;
  }

  function __permitStatusKey(raw) {
  const s = String(raw ?? "").trim();
  const v = s.toLowerCase();

  if (!s) return "";

  if (v.includes("pend") || v.includes("wait") || v.includes("review")) return "pending";
  if (v.includes("approv") || v.includes("accept") || v.includes("allow") || v.includes("ok") || v.includes("done"))
    return "approved";
  if (v.includes("reject") || v.includes("deny") || v.includes("refus")) return "rejected";

  if (/بانتظار|قيد|مراجعة|معلّق|معلق/.test(s)) return "pending";
  if (/مقبول|تم\s*قبول|معتمد|موافق/.test(s)) return "approved";
  if (/مرفوض|تم\s*رفض|غير\s*موافق/.test(s)) return "rejected";

  return v;
}

function __normPermitRow(x) {
  const studentId = toInt(x?.student_id ?? x?.studentId ?? x?.student ?? x?.studentID ?? 0);
  if (!studentId) return null;

  const statusKey = __permitStatusKey(
    x?.status ?? x?.request_status ?? x?.state ?? x?.approval_status ?? x?.admin_status ?? x?.decision_status
  );

  const type = __normPermitType(x?.type ?? x?.permit_type ?? x?.request_type ?? x?.kind ?? x?.category);

  const reasonId = (() => {
    const v = x?.reason_id ?? x?.reasonId ?? x?.attendance_reason_id ?? x?.att_reason_id ?? null;
    return v == null || v === "" ? null : toInt(v);
  })();

  const lateMinutes = (() => {
    const v = x?.late_minutes ?? x?.lateMinutes ?? x?.minutes ?? x?.mins ?? null;
    return v == null || v === "" ? null : toInt(v);
  })();

  const reasonName = String(x?.reason_name ?? x?.reasonName ?? x?.reason ?? x?.reason_label ?? "").trim();
  const note = String(x?.note ?? x?.details ?? x?.message ?? x?.description ?? "").trim();
  const id = toInt(x?.id ?? x?.request_id ?? x?.permit_id ?? 0) || null;

  return { id, studentId, type, statusKey, reasonId, reasonName, note, lateMinutes };
}

function __ymd(x) {
  return String(x || "").slice(0, 10);
}

function __dateInRange(dateVal, fromVal, toVal) {
  const d = __ymd(dateVal);
  const f = __ymd(fromVal);
  const t = __ymd(toVal);
  if (!d) return false;

  if (f && t) return d >= f && d <= t;
  if (f && !t) return d === f;      // لو عنده فقط from
  if (!f && t) return d === t;      // لو عنده فقط to
  return true;                      // لو ما فيه تواريخ — ما نفلتر
}

 async function fetchApprovedPermitsMap({ yearId, term, dateVal, sectionId, subjectId }) {
  const key = [yearId, term, dateVal, sectionId, subjectId || ""].join("|");
  const hit = __PERMITS_CACHE[key];
  if (hit && (Date.now() - hit.at) < 15000) return hit.map;

  const qs = new URLSearchParams();
  if (yearId) qs.set("academicYearId", String(yearId));
  if (term) qs.set("term", String(term));
  if (dateVal) qs.set("date", String(dateVal).slice(0, 10));
  if (sectionId) qs.set("sectionId", String(sectionId));
  if (subjectId) qs.set("subjectId", String(subjectId));

  // ✅ الأفضل: اطلب approved مباشرة إذا موجودة بالباك
  const paths = [
    `/teacher/attendance/permits/approved?${qs.toString()}`,
    `/teacher/attendance/permits?${qs.toString()}`,
    `/teacher/attendance/excuses?${qs.toString()}`,
  ];

  let rows = [];

  // 1) جرّب بالـ subjectId
  for (const p of paths) {
    try {
      const r = await apiGet(p);
      const got = __pickRowsGeneric(r);
      if (got.length) { rows = got; break; }
    } catch {}
  }

  // 2) fallback بدون subjectId (إذن يوم كامل)
  if ((!rows || !rows.length) && subjectId) {
    const qs2 = new URLSearchParams(qs.toString());
    qs2.delete("subjectId");

    const paths2 = [
      `/teacher/attendance/permits/approved?${qs2.toString()}`,
      `/teacher/attendance/permits?${qs2.toString()}`,
      `/teacher/attendance/excuses?${qs2.toString()}`,
    ];

    for (const p of paths2) {
      try {
        const r = await apiGet(p);
        const got = __pickRowsGeneric(r);
        if (got.length) { rows = got; break; }
      } catch {}
    }
  }

const map = new Map();
(rows || []).forEach((x) => {
  const fromD = __ymd(x.from_date ?? x.date_from ?? x.start_date ?? x.startDate ?? x.date ?? x.attendance_date);
  const toD   = __ymd(x.to_date   ?? x.date_to   ?? x.end_date   ?? x.endDate   ?? x.date);

  if (dateVal && (fromD || toD) && !__dateInRange(dateVal, fromD, toD)) return;

  const n = __normPermitRow(x);
  if (!n) return;

  map.set(String(n.studentId), n);
});


  __PERMITS_CACHE[key] = { at: Date.now(), map };
  return map;
}

function deriveFinalStatus(baseStatus, per, isUntouchedPresent) {
  const st = String(baseStatus || "present").trim() || "present";
  if (!per || per.statusKey !== "approved") return st;

  // late permit
  if (per.type === "late") {
    // لو كان حاضر افتراضي ولم يلمسه المعلم -> يصير متأخر
    if (st === "present" && isUntouchedPresent) return "late";
    return st; // لا نغيّر حالات أخرى
  }

  // absence/leave permit => لو غائب يصير بعذر، ولو حاضر افتراضي ولم يلمسه المعلم نرفعه لبعذر
  if (st === "absent") return "excused";
  if (st === "present" && isUntouchedPresent) return "excused";
  return st;
}

function applyPermitsToStudents(list, permitsMap, { applyStatus } = {}) {
  const arr = Array.isArray(list) ? list : [];
  const map = permitsMap instanceof Map ? permitsMap : new Map();

  return arr.map((s) => {
    const sid = String(parseInt(s?.id || 0, 10));
    const per = map.get(sid) || null;

    if (!per) return s;

    const out = { ...s, permit: per };

    const current = String(out.status || "present").trim() || "present";

    const untouchedPresent =
      current === "present" &&
      !out.reasonId &&
      !String(out.note || "").trim() &&
      !out.lateMinutes;

    // ✅ Final دائمًا
    out.finalStatus = deriveFinalStatus(current, per, untouchedPresent);

    // ✅ تطبيق تلقائي فقط لو المعلم ما لمس الحالة
    if (applyStatus !== false) {
      if (untouchedPresent && out.finalStatus && out.finalStatus !== current) {
        out.status = out.finalStatus;

        if (out.status === "late" && !out.lateMinutes && per.lateMinutes) {
          out.lateMinutes = per.lateMinutes;
        }
        if ((out.status === "excused" || out.status === "absent") && !out.note) {
          out.note = `[إذن إلكتروني] ${per.note || ""}`.trim();
        }
      }
    }

    return out;
  });
}


// استبدل دالة permitBadgeHTML القديمة بهذه الجديدة:
function permitBadgeHTML(per) {
  if (!per || typeof per !== 'object') return "";

  // تنظيف النص لضمان المطابقة
  const sKey = String(per.statusKey || "").toLowerCase().trim();
  
  let cssClass = "";
  let label = "—";
  let icon = "ri-question-line";

  // 1. حالة القبول
  if (sKey.includes("approv") || sKey === "accepted" || sKey === "approved") {
      cssClass = "is-approved"; 
      label = "مقبول ✅"; 
      icon = "ri-check-double-line";
  } 
  // 2. حالة الرفض (إصلاح مشكلة عدم الظهور)
  else if (sKey.includes("reject") || sKey.includes("refus") || sKey === "rejected") {
      cssClass = "is-rejected"; 
      label = "مرفوض ❌"; 
      icon = "ri-close-circle-line";
  } 
  // 3. حالة الانتظار (قبل قرار الإدارة)
  else if (sKey.includes("pend") || sKey.includes("wait") || sKey === "pending") {
      cssClass = "is-pending"; 
      label = "قيد المراجعة ⏳"; 
      icon = "ri-time-line";
  }

  // تحديد نوع الإذن (تأخر أم غياب)
  const typeLabel = (per.type && per.type.includes("late")) ? "تأخر" : "غياب";
  
  // إرجاع HTML الشارة
  return `
    <span class="att-chip ${cssClass}" title="${typeLabel}: ${label}">
      <i class="${icon}"></i>
      <span>${label}</span>
    </span>
  `;
}
  function reasonOptionsHTML(selectedId) {
    const list = TS.ATT_META?.reasons || [];
    const opts =
      `<option value="">بدون سبب</option>` +
      list
        .map((r) => {
          const id = r.id ?? r.value;
          const name = r.name ?? r.label ?? `سبب ${id}`;
          const sel = String(id) === String(selectedId) ? "selected" : "";
          return `<option value="${esc(id)}" ${sel}>${esc(name)}</option>`;
        })
        .join("");
    return opts;
  }

function rowTemplate(s) {
  if (!s) return "";
  
  const id = s.id || 0;
  const name = s.name || "طالب";
  const code = s.code || "";
  const status = s.status || "present";
  const finalStatus = s.finalStatus || status;
const finalDifferent = finalStatus && finalStatus !== status;
const finalLabel = STATUS_LABEL?.[finalStatus] || finalStatus;

  const note = s.note || "";
  const reasonId = s.reasonId || "";
  const lateMinutes = s.lateMinutes || "";

  // الشارة
  const permitHtml = s.permit ? permitBadgeHTML(s.permit) : `<span class="muted">—</span>`;

  // ❌ قمنا بحذف كود rowStyle من هنا لكي لا يتلون السطر بالكامل
  let rowStyle = ""; 

const isLocked = !!ACTIVE_LOCKED; // ✅ الصحيح (متغيرك المحلي)
  const disabledAttr = isLocked ? "disabled" : "";
  const correctBtnStyle = (isLocked) ? "" : "display:none";

  const btns = ["present", "absent", "late", "excused"].map(k => {
      const active = k === status ? "is-active" : "";
      const label = {present:"حاضر", absent:"غائب", late:"متأخر", excused:"بعذر"}[k];
      return `<button type="button" class="att-status-btn ${active}" data-status="${k}" ${disabledAttr}>${label}</button>`;
  }).join("");

  let reasonOpts = `<option value="">بدون سبب</option>`;
  try {
      const meta = window.TeachingScopes?.ATT_META?.reasons || [];
      reasonOpts += meta.map(r => `<option value="${r.id}" ${r.id==reasonId?'selected':''}>${r.name}</option>`).join("");
  } catch(e){}

  return `
<tr class="att-row" ${rowStyle}
    data-student-id="${id}"
    data-student-name="${esc(name)}"
    data-student-code="${esc(code)}">
      <td>
        <div class="att-student">
            <span class="att-student__name">${name}</span>
            <span class="att-student__meta"><small class="att-chip">${code}</small></span>
        </div>
      </td>
      <td>${permitHtml}</td>
<td>
  <div class="att-status">${btns}</div>
  ${finalDifferent ? `<div class="muted" style="margin-top:.25rem;">نهائي (قرار الإدارة): <strong>${esc(finalLabel)}</strong></div>` : ``}
</td>
      <td>
        <div class="att-details">
            <select class="att-reason" ${status === "absent" || status === "excused" ? "" : 'style="display:none"'} ${disabledAttr}>${reasonOpts}</select>
            <input class="att-late-min" type="number" placeholder="دقيقة" value="${lateMinutes}" ${status === "late" ? "" : 'style="display:none"'} ${disabledAttr}>
        </div>
      </td>
      <td><input class="att-note" type="text" placeholder="ملاحظة" value="${note}" ${disabledAttr}></td>
      <td>
        <button type="button" class="primary-btn att-correct-btn" style="${correctBtnStyle}">
            <i class="ri-edit-2-line"></i> تصحيح
        </button>
        
      </td>
    </tr>
  `;
}

  function setRowStatus(row, status) {
    row.querySelectorAll(".att-status-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.status === status);
      b.disabled = ACTIVE_LOCKED;
    });

    const reasonSel = row.querySelector(".att-reason");
    const lateInp = row.querySelector(".att-late-min");
    const noteInp = row.querySelector(".att-note");
    const correctBtn = row.querySelector(".att-correct-btn");

    if (reasonSel) {
      const show = status === "absent" || status === "excused";
      reasonSel.style.display = show ? "" : "none";
      reasonSel.disabled = ACTIVE_LOCKED;
      if (!show) reasonSel.value = "";
    }

    if (lateInp) {
      const show = status === "late";
      lateInp.style.display = show ? "" : "none";
      lateInp.disabled = ACTIVE_LOCKED;
      if (!show) lateInp.value = "";
    }

    if (noteInp) noteInp.disabled = ACTIVE_LOCKED;

    // ✅ في القفل: نظهر زر التصحيح فقط
 // ✅ في القفل: نظهر زر التصحيح فقط إذا لديه صلاحية
if (correctBtn) {
  const show = ACTIVE_LOCKED && __CAN_ATT_CORRECT;
  correctBtn.style.display = show ? "" : "none";
  correctBtn.disabled = !show;
}

  }

  function updateCounts() {
    if (!countsEl) return;
    const rows = tbody.querySelectorAll("tr.att-row");
    const total = rows.length;
    let present = 0,
      absent = 0,
      late = 0,
      excused = 0;

    rows.forEach((row) => {
      const st = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";
      if (st === "present") present++;
      else if (st === "absent") absent++;
      else if (st === "late") late++;
      else if (st === "excused") excused++;
    });

    countsEl.textContent =
      `الإجمالي: ${total} — حاضر: ${present} — غائب: ${absent} — متأخر: ${late} — بعذر: ${excused}` +
      (HAS_DIRTY ? " — (تغييرات غير محفوظة)" : "");
  }

  function applyFilters() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const onlyIssues = !!onlyIssuesChk?.checked;

    tbody.querySelectorAll("tr.att-row").forEach((row) => {
      const name = String(row.dataset.studentName || "").toLowerCase();
      const code = String(row.dataset.studentCode || "").toLowerCase();
      const st = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";

      const matchText = !q || name.includes(q) || code.includes(q);
      const matchIssues = !onlyIssues || st !== "present";
      row.style.display = matchText && matchIssues ? "" : "none";
    });
  }

  searchInput?.addEventListener("input", applyFilters);
  onlyIssuesChk?.addEventListener("change", applyFilters);

  function getCurrentSessionId() {
    const fromHidden = toInt(hidSession?.value || 0);
    if (fromHidden) return fromHidden;

    const ctx = TS.loadAttCtx?.();
    if (ctx?.sessionId) return toInt(ctx.sessionId);

    const al = window.__ACTIVE_LESSON__;
    if (al?.sessionId) return toInt(al.sessionId);

    return 0;
  }

  async function loadSession(sessionId) {
    const sid = toInt(sessionId);
    if (!sid) return;

    if (LOAD_BUSY) return;
    LOAD_BUSY = true;
await ensureAttendanceMetaOnce(TS);

    try {
      const r = await apiGet(`/teacher/attendance/sessions/${encodeURIComponent(sid)}/entries`);
      const data = r?.data || r || {};
      const sess = data.session || {};
      const list = Array.isArray(data.students) ? data.students : [];
      // ✅ جلب إذونات اليوم (Approved) وتطبيقها على الطلاب
      let permitsMap = new Map();
      try {
        const { yearId, term } = getYearTermSafe(TS);
        const dateVal = String(sess.attendance_date || "").slice(0, 10);
        const sectionId = toInt(sess.section_id || 0);
        const subjectId = toInt(sess.subject_id || 0);

        permitsMap = await fetchApprovedPermitsMap({ yearId, term, dateVal, sectionId, subjectId });
      } catch {}

      const listWithPermits = applyPermitsToStudents(list, permitsMap, { applyStatus: !toBool(sess.is_locked) });

      ACTIVE_SESSION_ID = toInt(sess.id || sid);
      // ✅ reset seen set when session changes
if (__SCAN_SEEN.sessionId !== ACTIVE_SESSION_ID) {
  __SCAN_SEEN.sessionId = ACTIVE_SESSION_ID;
  __SCAN_SEEN.set = new Set();
}

      if (hidSession) hidSession.value = String(ACTIVE_SESSION_ID || "");

      const isLocked = toBool(sess.is_locked);
      setLockedUI(isLocked);
      updateLockIndicators(isLocked);

      // ✅ UI: إظهار المنطقة الصحيحة
      setNeedStartUI(false);

      // ✅ املأ summary (الجديد + القديم)
      try {
        if (ssum) ssum.style.display = ACTIVE_SESSION_ID ? "" : "none";
        if (ssv) ssv.textContent = ACTIVE_SESSION_ID ? "#" + ACTIVE_SESSION_ID : "—";

        const lockedText = isLocked ? "معتمدة" : sess.ended_at ? "منتهية" : "جارية";
        if (sst) sst.textContent = lockedText;

        const p = await getPeriodById(sess.period_id);
        if (ss1) ss1.textContent = p ? fmtHHMM(p.start_time) : "—";
        if (ss2) ss2.textContent = p ? fmtHHMM(p.end_time) : "—";

        // حاول جلب أسماء النطاق من TeachingScopes
        let scopeName = "—";
        try {
          if (typeof TS.loadTeachingScopes === "function") {
            const scopes = await TS.loadTeachingScopes();
            const hit = (scopes || []).find(
              (x) =>
                String(x.section_id) === String(sess.section_id) &&
                String(x.subject_id) === String(sess.subject_id)
            );
            if (hit) {
              scopeName = `${hit.grade_name || ""} / ${hit.section_name || ""} — ${hit.subject_name || ""}`.trim();
            }
          }
        } catch {}

        const d = String(sess.attendance_date || "").slice(0, 10);
        const lessonNo = toInt(sess.lesson || 0) || (await getLessonNoByPeriodId(sess.period_id));
        if (scopeView) scopeView.textContent = scopeName || "—";
        if (dateView) dateView.textContent = d || "—";
        if (lessonView) lessonView.textContent = lessonNo ? `الحصة ${lessonNo}` : "—";

        if (scopeSummaryEl) {
          scopeSummaryEl.textContent =
            `حضور: ${scopeName} — ${d} — الحصة ${lessonNo || sess.period_id || ""}` + (isLocked ? " — (معتمد)" : "");
        }
      } catch (e) {
        console.warn("attendance summary update failed:", e);
      }

      // ✅ Render table
  tbody.innerHTML = listWithPermits
  .map((s) =>
    rowTemplate({
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
        finalStatus: s.finalStatus || null, // ✅

      note: s.note,
      reasonId: s.reasonId,
      lateMinutes: s.lateMinutes,
      permit: s.permit || null, // ✅ مهم لإظهار الشارة
    })
  )
  .join("");


      tbody.querySelectorAll("tr.att-row").forEach((row) => {
        const st = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";
        setRowStatus(row, st);

        // inputs change => dirty
        row.querySelector(".att-reason")?.addEventListener("change", () => {
          if (!ACTIVE_LOCKED) markDirty();
        });
        row.querySelector(".att-late-min")?.addEventListener("input", () => {
          if (!ACTIVE_LOCKED) markDirty();
        });
        row.querySelector(".att-note")?.addEventListener("input", () => {
          if (!ACTIVE_LOCKED) markDirty();
        });
      });

      clearDirty();
      updateCounts();
      applyFilters();
      // ✅ إذا التبويب الحالي هو المسح (scan) بعد تحميل الجلسة: حدّث UI وشغّل الكاميرا
      try {
        if (__ATT_CURRENT_TAB === "scan") {
          updateQrViewUI();
          if (!ACTIVE_LOCKED) {
            resetScanInputKeepLog();
            // startAttendanceQrCamera().catch(() => {});
          }
        }
      } catch {}


    } 
    
    
    finally {
      LOAD_BUSY = false;
    }
  }

  async function refreshFromContext() {
    const sid = getCurrentSessionId();
    if (!sid) {
      ACTIVE_SESSION_ID = null;
      ACTIVE_LOCKED = false;
      if (hidSession) hidSession.value = "";
      setNeedStartUI(true);
      return;
    }
    await loadSession(sid);
  }
let __ATT_POLL_TIMER = null;

function isModalOpenSafe(modalEl) {
  if (!modalEl) return false; 
  const cls = modalEl.classList;
  if (cls.contains("open") || cls.contains("is-open") || cls.contains("show")) return true;
  // fallback: لو display none يعني مغلق
  const ds = (modalEl.style && modalEl.style.display) ? modalEl.style.display : "";
  return ds !== "none";
}

function startAttendanceAutoRefresh() {
  const modal = byId("modal-attendance");

  if (__ATT_POLL_TIMER) clearInterval(__ATT_POLL_TIMER);

  __ATT_POLL_TIMER = setInterval(async () => {
    try {
      // لا نعمل ريفريش إذا المعلم عنده تغييرات غير محفوظة
      if (HAS_DIRTY || SAVE_BUSY || LOAD_BUSY) return;

      // إذا المودال مغلق لا نسحب
      if (!isModalOpenSafe(modal)) return;

      const sid = getCurrentSessionId();
      if (!sid) return;

      // ✅ اكسر كاش الأذونات عشان قرار الإدارة يظهر فورًا
      try { __PERMITS_CACHE && Object.keys(__PERMITS_CACHE).forEach(k => { delete __PERMITS_CACHE[k]; }); } catch {}

      await loadSession(sid);
    } catch {}
  }, 20000); // كل 20 ثانية
}

// شغلها مرة بعد التهيئة
startAttendanceAutoRefresh();

  // ✅ عند فتح المودال (أو عند التهيئة) حاول استعادة الجلسة إن وجدت
  setTimeout(() => {
    refreshFromContext().catch(() => {});
  }, 250);

  // ====== منع التحضير بدون بدء الحصة ======
  if (hint) hint.textContent = "لا يمكن التحضير قبل بدء الحصة من (إدارة الحصص).";
  setNeedStartUI(true);

  // زر “اذهب لبدء الحصة”
  goLessonsBtn?.addEventListener("click", () => {
    if (typeof window.openModal === "function") {
      window.openModal("modal-lessons");
    } else {
      toast("تعذر فتح (إدارة الحصص) — openModal غير موجود.");
    }
  });

  // زر “تحديث”
  refreshSessionBtn?.addEventListener("click", () => {
    refreshFromContext().catch((e) => toast("فشل التحديث: " + (e.message || "")));
  });
refreshAllBtn?.addEventListener("click", async () => {
  try {
    await refreshFromContext();
    // لو أنت داخل تبويب الأذونات حدّثها
if (__ATT_CURRENT_TAB === "perms") await window.loadPermitsList?.();
  } catch (e) {
    toast("فشل التحديث: " + (e.message || ""));
  }
});


  // زر “عرض قائمة الطلاب” القديم: لم يعد ينشئ جلسة — فقط يحاول تحميل جلسة موجودة
  loadBtn?.addEventListener("click", async () => {
    const sid = getCurrentSessionId();
    if (!sid) {
      setNeedStartUI(true);
      return toast("ابدأ الحصة أولاً من (إدارة الحصص) ثم ارجع للحضور.");
    }
    try {
      await loadSession(sid);
      setAttendanceTab("take");
    } catch (e) {
      console.error(e);
      toast("فشل تحميل الجلسة: " + (e.message || ""));
    }
  });

  // ====== تعديل الحالة (قبل القفل فقط) ======
 tbody.addEventListener("click", (e) => {
  const btn = e.target.closest(".att-correct-btn");
  if (!btn) return;
  if (!ACTIVE_LOCKED) return;

  const row = btn.closest("tr.att-row");
  if (!row) return;

  const studentId = toInt(row.dataset.studentId || 0);
  const studentName = row.dataset.studentName || "";

  if (cmStudentId) cmStudentId.value = String(studentId || "");
  if (cmTitle) cmTitle.textContent = `تصحيح: ${studentName || "طالب"} — جلسة #${ACTIVE_SESSION_ID || "—"}`;
if (cmReason) cmReason.value = "";
  // ✅✅ الصق هذا المقطع هنا
  const currentStatus = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";
  const currentReasonId = (row.querySelector(".att-reason")?.value || "").trim();
  const currentLate = (row.querySelector(".att-late-min")?.value || "").trim();
  const currentNote = (row.querySelector(".att-note")?.value || "").trim();

  if (cmCurrent) {
    const sLabel = STATUS_LABEL[currentStatus] || currentStatus;
    cmCurrent.textContent =
      `${sLabel}` +
      (currentReasonId ? ` — سبب: ${currentReasonId}` : "") +
      (currentLate ? ` — تأخر: ${currentLate}د` : "");
  }

  if (cmStatus) cmStatus.value = currentStatus;
  if (cmLate) cmLate.value = currentLate;
  if (cmNote) cmNote.value = currentNote;

  // ✅ تعبئة reasons داخل مودال التصحيح
  try {
    if (cmReasonId) cmReasonId.innerHTML = reasonOptionsHTML(currentReasonId || "");
  } catch {}

  updateCorrectLateUI();
  // ✅✅ نهاية المقطع

  if (typeof window.openModal === "function") {
    window.openModal(correctModalId);
  } else {
    toast("تعذر فتح مودال التصحيح — openModal غير موجود.");
  }
});
// ✅ تغيير حالة الطالب عند الضغط على أزرار (حاضر/غائب/متأخر/بعذر)
tbody.addEventListener("click", (e) => {
  const b = e.target.closest(".att-status-btn");
  if (!b) return;

  if (ACTIVE_LOCKED) return; // بعد الاعتماد: ممنوع تغيير مباشر

  const row = b.closest("tr.att-row");
  if (!row) return;

  const st = String(b.dataset.status || "present");
  setRowStatus(row, st);
  markDirty();
  applyFilters();
});


  allPresentBtn?.addEventListener("click", () => {
    if (ACTIVE_LOCKED) return;
    tbody.querySelectorAll("tr.att-row").forEach((row) => setRowStatus(row, "present"));
    markDirty();
    applyFilters();
  });

  allAbsentBtn?.addEventListener("click", () => {
    if (ACTIVE_LOCKED) return;
    tbody.querySelectorAll("tr.att-row").forEach((row) => setRowStatus(row, "absent"));
    markDirty();
    applyFilters();
  });

 function collectEntriesRaw() {
  const rows = Array.from(tbody.querySelectorAll("tr.att-row"));
  return rows.map((row) => {
    const studentId = toInt(row.dataset.studentId || 0);
    const studentName = String(row.dataset.studentName || "");
    const status = row.querySelector(".att-status-btn.is-active")?.dataset?.status || "present";
    const note = (row.querySelector(".att-note")?.value || "").trim();

    const reasonIdRaw = (row.querySelector(".att-reason")?.value || "").trim();
    const lateRaw = (row.querySelector(".att-late-min")?.value || "").trim();

    const reasonId = reasonIdRaw ? toInt(reasonIdRaw) : null;
    const lateMinutes = lateRaw ? toInt(lateRaw) : null;

    return { studentId, studentName, status, note, reasonId, lateMinutes };
  });
}

function validateEntries(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  for (const x of arr) {
    const st = String(x.status || "present");
    if (st === "late") {
      if (!x.lateMinutes || toInt(x.lateMinutes) <= 0) {
        return "يوجد طالب حالته (متأخر) بدون دقائق تأخر.";
      }
    }
    if (st === "absent" || st === "excused") {
      // إذا تريد السبب إلزامي: احذف شرط note
      if (!x.reasonId && !String(x.note || "").trim()) {
        return "يوجد طالب حالته (غائب/بعذر) بدون سبب أو ملاحظة.";
      }
    }
  }
  return null;
}


  async function saveAttendance({ lock }) {
    if (!ACTIVE_SESSION_ID) return toast("لا توجد جلسة حضور نشطة.");
    if (ACTIVE_LOCKED) return toast("الجلسة معتمدة ومقفولة. استخدم (تصحيح) فقط.");
    if (lock === true && !canPerm(PERMS.ATT_LOCK)) return toast("لا تملك صلاحية اعتماد الحضور.");
if (lock !== true && !canPerm(PERMS.ATT_WRITE)) return toast("لا تملك صلاحية حفظ الحضور.");

    if (SAVE_BUSY) return;

    SAVE_BUSY = true;
    try {
const raw = collectEntriesRaw();
const err = validateEntries(raw);
if (err) return toast(err);

// نرسل فقط المطلوب للسيرفر
const entries = raw.map(({ studentId, status, note, reasonId, lateMinutes }) => ({
  studentId,
  status,
  note,
  reasonId,
  lateMinutes: status === "late" ? lateMinutes : null,
}));
      await apiPut(`/teacher/attendance/sessions/${encodeURIComponent(ACTIVE_SESSION_ID)}/entries`, {
        entries,
        lock: lock === true,
      });

      toast(lock ? "تم حفظ واعتماد الحضور ✅" : "تم حفظ الحضور ✅");
      try { __PERMITS_CACHE && Object.keys(__PERMITS_CACHE).forEach(k => { delete __PERMITS_CACHE[k]; }); } catch {}

      clearDirty();

 if (lock) {
  setLockedUI(true);
  updateLockIndicators(true);

  try {
    const ctx = TS.loadAttCtx?.() || {};
    const dateVal = String(ctx.date || "").slice(0,10) || todayISO();
    const periodId = toInt(ctx.periodId || 0);

    upsertLessonLog({
      sessionId: toInt(ACTIVE_SESSION_ID),
      date: dateVal,
      periodId,
      lessonNo: toInt(ctx.lessonNo || 0) || null,

      stageId: toInt(ctx?.scope?.stageId || 0),
      gradeId: toInt(ctx?.scope?.gradeId || 0),
      sectionId: toInt(ctx?.scope?.sectionId || 0),
      subjectId: toInt(ctx?.scope?.subjectId || 0),

      isLocked: true,
      endISO: new Date().toISOString(),
      status: "locked",
    });

    // ✅ امسح كاش slots حتى تظهر "منتهية" فورًا
    const { yearId, term } = getYearTermSafe(TS);
    invalidateSlotsCache({
      yearId, term,
      dateVal,
      sectionId: toInt(ctx?.scope?.sectionId || 0),
      subjectId: toInt(ctx?.scope?.subjectId || 0) || null,
    });

    // ✅ حدث القائمة فورًا
    window.dispatchEvent(new CustomEvent("LESSONS_LOG_CHANGED"));
  } catch {}
}

    } catch (e) {
      console.error(e);
      toast("فشل الحفظ: " + (e.message || ""));
    } finally {
      SAVE_BUSY = false;
    }
  }

  saveSoftBtn?.addEventListener("click", () => saveAttendance({ lock: false }));
  saveBtn?.addEventListener("click", () => saveAttendance({ lock: true }));

  // ===================== التصحيح بعد الاعتماد (للمدرّس) =====================
  const correctModalId = "modal-att-correct";
  const cmStatus = byId("att-correct-status");
  const cmReasonId = byId("att-correct-reason-id");
const cmNote = byId("att-correct-note");
const cmCurrent = byId("att-correct-current");

  const cmLateWrap = byId("att-correct-late-wrap");
  const cmLate = byId("att-correct-late");
  const cmReason = byId("att-correct-reason");
  const cmStudentId = byId("att-correct-student-id");
  const cmTitle = byId("att-correct-title");
  const cmSave = byId("att-correct-save");

  function updateCorrectLateUI() {
    const st = String(cmStatus?.value || "");
    if (!cmLateWrap) return;
    cmLateWrap.style.display = st === "late" ? "" : "none";
    if (st !== "late" && cmLate) cmLate.value = "";
  }
  cmStatus?.addEventListener("change", updateCorrectLateUI);

  async function correctOnServer(sessionId, payload) {
  const sid = toInt(sessionId);
  if (!sid) throw new Error("جلسة غير صالحة");

  // payload المتوقع من مودال التصحيح عندك غالباً:
  // { studentId, status, lateMinutes, reason }  // reason = سبب التصحيح (نص)
  // وقد يكون عندك أيضاً: reasonId, note

  const studentId = toInt(payload?.studentId || 0);
  if (!studentId) throw new Error("طالب غير صالح");

  const status = String(payload?.status || "present").trim() || "present";

  // ✅ سبب التصحيح النصي (إجباري في الباك اند بعد الاعتماد)
  const correctionReason = String(payload?.reason || payload?.correctionReason || "").trim();
  if (!correctionReason) throw new Error("سبب التصحيح إجباري");

  // ✅ السبب الرقمي (من جدول attendance_reasons) اختياري حسب الحالة
  const reasonIdRaw = payload?.reasonId;
  const reasonId = reasonIdRaw === "" || reasonIdRaw == null ? null : toInt(reasonIdRaw);

  // ✅ دقائق التأخر فقط إذا الحالة late
  const lateRaw = payload?.lateMinutes;
  const lateMinutes = lateRaw === "" || lateRaw == null ? null : toInt(lateRaw);

  const note = payload?.note == null ? null : String(payload.note).trim();

  // ✅ هذا هو المسار الوحيد اللي يدعمه كنترولك للتصحيح بعد الاعتماد
  // isCorrectionMode = session.is_locked && correctionReason موجود
 return await apiPut(`/teacher/attendance/sessions/${sid}/entries`, {
  correctionReason,
  correction_reason: correctionReason, // ✅ احتياط لاختلاف الباك-إند
  entries: [
    {
      studentId,
      status,
      reasonId,
      lateMinutes: status === "late" ? lateMinutes : null,
      note,
    },
  ],
  lock: false,
});

}


  
let CORRECT_BUSY = false;

cmSave?.addEventListener("click", async () => {
  if (CORRECT_BUSY) return;

  if (!ACTIVE_SESSION_ID) return toast("لا توجد جلسة.");
  if (!ACTIVE_LOCKED) return toast("التصحيح متاح فقط بعد الاعتماد.");
  if (!__CAN_ATT_CORRECT) return toast("لا تملك صلاحية التصحيح بعد الاعتماد.");

  const studentId = toInt(cmStudentId?.value || 0);
  const status = String(cmStatus?.value || "").trim() || "present";
  const reason = (cmReason?.value || "").trim();
  const lateMinutes = toInt(cmLate?.value || 0);

  const reasonIdRaw = (cmReasonId?.value || "").trim();
  const reasonId = reasonIdRaw ? toInt(reasonIdRaw) : null;

  const note = (cmNote?.value || "").trim();

  if (!studentId) return toast("طالب غير صالح.");
  if (!reason) return toast("سبب التصحيح إجباري.");
  if (status === "late" && lateMinutes <= 0) return toast("أدخل دقائق التأخر.");

  CORRECT_BUSY = true;
  try {
    await correctOnServer(ACTIVE_SESSION_ID, {
      studentId,
      status,
      lateMinutes: status === "late" ? lateMinutes : null,
      reason,   // correctionReason النصي
      reasonId, // سبب رقمي اختياري
      note,
    });
toast("تم حفظ التصحيح ✅");
try { __PERMITS_CACHE && Object.keys(__PERMITS_CACHE).forEach(k => { delete __PERMITS_CACHE[k]; }); } catch {}
await loadSession(ACTIVE_SESSION_ID);

    setAttendanceTab("take");
  } catch (e) {
    console.error(e);
    toast("فشل التصحيح: " + (e.message || ""));
  } finally {
    CORRECT_BUSY = false;
  }
});


  // ===================== History (كشف الغياب) =====================
 function renderHistory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  __lastHistoryRows = list;

  if (historySummary) historySummary.textContent = list.length ? `عدد السجلات: ${list.length}` : "—";

  if (!historyBody || !historyEmpty) return;

  if (!list.length) {
    historyBody.innerHTML = "";
    historyEmpty.style.display = "block";
    historyEmpty.textContent = "لا توجد نتائج.";
    return;
  }

  historyEmpty.style.display = "none";
  historyBody.innerHTML = list
    .map((x) => {
      const reason = x.reason_name || x.reason || "";
      const lateMin = x.late_minutes ?? x.lateMinutes ?? "";
      const details = reason ? `سبب: ${reason}` : lateMin ? `تأخر: ${lateMin} د` : "-";

      return `
        <tr>
          <td>${esc(x.student_name || "")} (${esc(x.student_code || "")})</td>
          <td>${esc(String(x.attendance_date || "").slice(0, 10))}</td>
          <td>${esc(String(x.lesson || ""))}</td>
          <td>${esc(x.subject_name || "")}</td>
          <td>${esc(x.status || "")}</td>
          <td>${esc(details)}</td>
          <td>${esc(x.note || "-")}</td>
        </tr>
      `;
    })
    .join("");
}


  historyShowBtn?.addEventListener("click", async () => {
    const q = (historySearchInput?.value || "").trim();
    if (!q) return toast("أدخل اسم الطالب أو كوده للبحث.");

    try {
      const params = new URLSearchParams();
      params.set("search", q);

      const fromVal = String(historyFrom?.value || "").slice(0, 10);
      const toVal = String(historyTo?.value || "").slice(0, 10);
      const stVal = String(historyStatus?.value || "").trim();

      if (fromVal && toVal) {
        params.set("from", fromVal);
        params.set("to", toVal);
      }
      if (stVal) params.set("status", stVal);

      const r = await apiGet(`/teacher/attendance/history?${params.toString()}`);
      const rows = r?.data?.rows || r?.rows || r?.data || [];
      renderHistory(Array.isArray(rows) ? rows : []);
      setAttendanceTab("history");
    } catch (e) {
      console.error(e);
      toast("فشل البحث في كشف الغياب: " + (e.message || ""));
    }
  });
historyExportBtn?.addEventListener("click", () => {
  if (!__lastHistoryRows.length) return toast("لا توجد بيانات للتصدير.");

  const header = ["student_name","student_code","attendance_date","lesson","subject_name","status","reason","late_minutes","note"];
  const csv =
    header.join(",") +
    "\n" +
    __lastHistoryRows.map((x) => {
      const vals = [
        x.student_name || "",
        x.student_code || "",
        String(x.attendance_date || "").slice(0,10),
        x.lesson ?? "",
        x.subject_name ?? "",
        x.status ?? "",
        x.reason_name || x.reason || "",
        x.late_minutes ?? x.lateMinutes ?? "",
        x.note ?? ""
      ].map((v)=> `"${String(v).replace(/"/g,'""')}"`);
      return vals.join(",");
    }).join("\n");

  downloadText(`attendance_history_${Date.now()}.csv`, csv);
});

historyPrintBtn?.addEventListener("click", () => {
  setAttendanceTab("history");
  try { window.print(); } catch { toast("تعذر فتح الطباعة."); }
});

  // ===================== Report (تقرير الغياب) =====================
  let __lastReportRows = [];

  function calcRate(present, late, excused, total) {
    if (!total) return "0%";
    const ok = toInt(present) + toInt(late) + toInt(excused);
    const pct = Math.round((ok / total) * 100);
    return `${pct}%`;
  }

  function renderReport(rows) {
    const list = Array.isArray(rows) ? rows : [];
    __lastReportRows = list;

    if (!repBody || !repEmpty) return;
    if (!list.length) {
      repBody.innerHTML = "";
      repEmpty.style.display = "block";
      if (repSummary) repSummary.textContent = "—";
      return;
    }

    repEmpty.style.display = "none";

    if (repSummary) {
      repSummary.textContent = `عدد الطلاب: ${list.length}`;
    }

    repBody.innerHTML = list
      .map((x) => {
        const total = toInt(x.total || (toInt(x.present) + toInt(x.absent) + toInt(x.late) + toInt(x.excused)));
        const rate = calcRate(x.present, x.late, x.excused, total);

        return `
          <tr>
            <td>${esc(x.student_name || x.name || "—")}</td>
            <td>${esc(x.student_code || x.code || "—")}</td>
            <td>${esc(String(toInt(x.present || 0)))}</td>
            <td>${esc(String(toInt(x.absent || 0)))}</td>
            <td>${esc(String(toInt(x.late || 0)))}</td>
            <td>${esc(String(toInt(x.excused || 0)))}</td>
            <td>${esc(rate)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function fetchReportFromServer(params) {
    // نحاول عدة مسارات لأن الباك اند قد يختلف عندك
    const paths = [
      `/teacher/attendance/report?${params.toString()}`,
      `/teacher/attendance/reports?${params.toString()}`,
      `/teacher/attendance/report/summary?${params.toString()}`,
      `/teacher/attendance/report/aggregate?${params.toString()}`,
    ];

    let lastErr = null;
  for (const p of paths) {
  try {
    console.log("PERMITS TRY:", p);
    const r = await apiGet(p);

        return r?.data?.rows || r?.rows || r?.data || [];
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("لا يوجد مسار تقرير الغياب في السيرفر بعد.");
  }

  function aggregateIfNeeded(rows) {
    // إذا السيرفر رجّع بيانات جاهزة (present/absent/late/excused) نمررها كما هي
    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) return [];

    const sample = arr[0] || {};
    const looksAggregated =
      ("present" in sample || "present_count" in sample) &&
      ("absent" in sample || "absent_count" in sample);

    if (looksAggregated) {
      return arr.map((x) => ({
        student_name: x.student_name || x.name,
        student_code: x.student_code || x.code,
        present: toInt(x.present ?? x.present_count ?? 0),
        absent: toInt(x.absent ?? x.absent_count ?? 0),
        late: toInt(x.late ?? x.late_count ?? 0),
        excused: toInt(x.excused ?? x.excused_count ?? 0),
        total: toInt(x.total ?? 0),
      }));
    }

    // وإلا نجمعها هنا لو كانت سجلات تفصيلية
    const map = new Map();
    for (const x of arr) {
      const sid = String(x.student_id || x.studentId || x.id || "");
      if (!sid) continue;

      const name = x.student_name || x.name || "";
      const code = x.student_code || x.code || "";
      const st = String(x.status || "").trim();

      if (!map.has(sid)) {
        map.set(sid, {
          student_name: name,
          student_code: code,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          total: 0,
        });
      }

      const obj = map.get(sid);
      obj.total++;
      if (st === "absent") obj.absent++;
      else if (st === "late") obj.late++;
      else if (st === "excused") obj.excused++;
      else obj.present++;
    }

    return Array.from(map.values());
  }

  repShowBtn?.addEventListener("click", async () => {
    try {
      const params = new URLSearchParams();

      const fromVal = String(repFrom?.value || "").slice(0, 10);
      const toVal = String(repTo?.value || "").slice(0, 10);

      // defaults
      const tdy = typeof TS.todayISO === "function" ? TS.todayISO() : todayISO();
      params.set("from", fromVal || tdy);
      params.set("to", toVal || tdy);

      const stVal = String(repStatus?.value || "").trim();
      if (stVal) params.set("status", stVal);

      // scope (اختياري)
      const scope = TS.getTeachingScope ? TS.getTeachingScope("rep") : null;
      if (scope?.stageId) params.set("stageId", String(toInt(scope.stageId)));
      if (scope?.gradeId) params.set("gradeId", String(toInt(scope.gradeId)));
      if (scope?.sectionId) params.set("sectionId", String(toInt(scope.sectionId)));
      if (scope?.subjectId) params.set("subjectId", String(toInt(scope.subjectId)));

      // year/term (اختياري)
      const { yearId, term } = getYearTermSafe(TS);
      if (yearId) params.set("academicYearId", String(yearId));
      if (term) params.set("term", String(term));

      const raw = await fetchReportFromServer(params);
      const aggr = aggregateIfNeeded(raw);
      renderReport(aggr);
      setAttendanceTab("report");
    } catch (e) {
      console.error(e);
      toast("تقرير الغياب غير جاهز في السيرفر: " + (e.message || ""));
      renderReport([]);
      setAttendanceTab("report");
    }
  });

  repExportBtn?.addEventListener("click", () => {
    if (!__lastReportRows.length) return toast("لا توجد بيانات للتصدير.");
    const header = ["student_name", "student_code", "present", "absent", "late", "excused", "rate"];
    const csv =
      header.join(",") +
      "\n" +
      __lastReportRows
        .map((x) => {
          const total = toInt(x.total || (toInt(x.present) + toInt(x.absent) + toInt(x.late) + toInt(x.excused)));
          const rate = calcRate(x.present, x.late, x.excused, total);
          const vals = [
            x.student_name || "",
            x.student_code || "",
            toInt(x.present || 0),
            toInt(x.absent || 0),
            toInt(x.late || 0),
            toInt(x.excused || 0),
            rate,
          ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
          return vals.join(",");
        })
        .join("\n");

    downloadText(`attendance_report_${Date.now()}.csv`, csv);
  });

  repPrintBtn?.addEventListener("click", () => {
    try {
      window.print();
    } catch {
      toast("تعذر فتح الطباعة على هذا المتصفح.");
    }
  });

  // ===================== فتح الحضور من جلسة معينة =====================
  window.__openAttendanceForSession = async (sessionId) => {
    if (typeof window.openModal === "function") window.openModal("modal-attendance");
    try {
      await loadSession(sessionId);
      setAttendanceTab("take");
    } catch (e) {
      console.error(e);
      toast("فشل فتح جلسة الحضور: " + (e.message || ""));
    }
  };
}

  /* =========================
     Lessons (Session start/end + auto-end) + anti-double end
  ========================= */
  function initLessonsDB() {
    if (initLessonsDB.__done) return;
initLessonsDB.__done = true;

    const TS = window.TeachingScopes;
    if (!TS?.initTeachingPicker) return;

    const lessonSelect = byId("ls-lesson");
    const noteInput = byId("ls-note");
    const startBtn = byId("ls-start");
function syncStartBtnWithSelectedOption() {
  const opt = getSelectedOption(lessonSelect);
  const finished = opt?.dataset?.finished === "1";

  if (finished) {
    startBtn.disabled = true;
    startBtn.style.pointerEvents = "none";
    startBtn.title = opt?.dataset?.finishState === "locked" ? "الحصة معتمدة" : "الحصة منتهية";
  } else {
    startBtn.disabled = false;
    startBtn.style.pointerEvents = "";
    startBtn.title = "";
  }
}

    const endBtn = byId("ls-end");
    // ===== permissions (lessons) =====
const __CAN_LS_START = canPerm(PERMS.LS_START);
const __CAN_LS_END = canPerm(PERMS.LS_END);

if (startBtn && !__CAN_LS_START) {
  startBtn.disabled = true;
  startBtn.title = "لا تملك صلاحية بدء الحصة";
}
if (endBtn && !__CAN_LS_END) {
  endBtn.disabled = true;
  endBtn.title = "لا تملك صلاحية إنهاء الحصة";
}

    const timelineBox = byId("ls-timeline");
    const dateInput = byId("ls-date");

    const timerBox = byId("ls-timer");
    const timerText = byId("ls-timer-text"); // (لو طبقت HTML الجديد)
    const logBoxLegacy = byId("ls-log");

    // عناصر جديدة (اختيارية)
    const schedMeta = byId("ls-schedule-meta");
    const schedStartEl = byId("ls-sched-start");
    const schedEndEl = byId("ls-sched-end");
    const sessStatusEl = byId("ls-session-status");
    const lockedBadge = byId("ls-locked-badge");

    const sessMetaBox = byId("ls-session-meta");
    const sessIdView = byId("ls-session-id");
    const sessStartedView = byId("ls-started-at");
    const sessEndedView = byId("ls-ended-at");
    const sessHidden = byId("ls-session-id-hidden");
    const entryHidden = byId("ls-timetable-entry-id-hidden");
const openAttBtn = byId("ls-open-att");
// ✅ اربط زر فتح الحضور مرة واحدة فقط (حتى ما يتكرر الحدث)
if (openAttBtn && openAttBtn.dataset.boundOpenAtt !== "1") {
  openAttBtn.dataset.boundOpenAtt = "1";
  openAttBtn.addEventListener("click", () => {
    if (!ACTIVE_SESSION_ID) return toast("ابدأ الحصة أولاً ثم افتح الحضور.");
    if (typeof window.__openAttendanceForSession === "function") {
      window.__openAttendanceForSession(ACTIVE_SESSION_ID);
    } else if (typeof window.openModal === "function") {
      window.openModal("modal-attendance");
    }
  });
}

    if (!lessonSelect || !startBtn || !endBtn) return;

    TS.initTeachingPicker("ls");

    if (dateInput && !dateInput.value)
      dateInput.value = typeof TS.todayISO === "function" ? TS.todayISO() : todayISO();
// ✅ تصحيح: جعل التاريخ قابلاً للتعديل
    if (dateInput) {
      dateInput.disabled = false;
      dateInput.readOnly = false;
      dateInput.style.pointerEvents = "auto";
      
      // وضع تاريخ اليوم إذا كان فارغاً
      if (!dateInput.value) dateInput.value = todayISO();

      // تحديث الحصص عند تغيير التاريخ يدوياً
      dateInput.addEventListener("change", () => {
          refreshLsLessons();
      });
    }

    let ACTIVE_SESSION_ID = null;
    let ACTIVE_PERIOD_ID = null;
    let ACTIVE_DATE = null;
    let TIMER_INTERVAL = null;
    let TIMER_START_MS = null;
    let AUTO_END_TIMEOUT = null;
    let ENDING_IN_PROGRESS = false;

    function setTimerText(sec) {
      if (timerText) {
        timerText.textContent = formatHMS(sec);
        return;
      }
      if (!timerBox) return;
      const span = timerBox.querySelector("span:last-child");
      if (span) span.textContent = `مدة الحصة: ${formatHMS(sec)}`;
    }

    function stopTimer() {
      if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
      TIMER_INTERVAL = null;
      TIMER_START_MS = null;
      setTimerText(0);

      if (AUTO_END_TIMEOUT) clearTimeout(AUTO_END_TIMEOUT);
      AUTO_END_TIMEOUT = null;
    }

    function startTimerFrom(startISOorMS) {
      try {
        if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);

        let startMs = null;
        if (typeof startISOorMS === "number") startMs = startISOorMS;
        else if (String(startISOorMS || "").includes("T")) startMs = new Date(startISOorMS).getTime();
        else startMs = Date.now();

        if (!Number.isFinite(startMs) || startMs <= 0) startMs = Date.now();

        TIMER_START_MS = startMs;

        const tick = () => {
          const now = Date.now();
          const diffSec = Math.floor((now - TIMER_START_MS) / 1000);
          setTimerText(diffSec);
        };

        tick();
        TIMER_INTERVAL = setInterval(tick, 1000);
      } catch {
        setTimerText(0);
      }



    }

    async function updateScheduleUI(periodId, dateVal) {
      try {
        const p = await getPeriodById(periodId);
        if (schedMeta) schedMeta.style.display = p ? "" : "none";
        if (schedStartEl) schedStartEl.textContent = p ? fmtHHMM(p.start_time) : "—";
        if (schedEndEl) schedEndEl.textContent = p ? fmtHHMM(p.end_time) : "—";

        if (sessStatusEl) sessStatusEl.textContent = ACTIVE_SESSION_ID ? "جارية" : "—";

        if (AUTO_END_TIMEOUT) clearTimeout(AUTO_END_TIMEOUT);
        AUTO_END_TIMEOUT = null;

        if (!ACTIVE_SESSION_ID || !p || !p.end_time) return;

        const endDT = parseLocalDateTime(dateVal, fmtHHMM(p.end_time));
        if (!endDT) return;

        const now = Date.now();
        const ms = endDT.getTime() - now;

      // لو وقت الجدول انتهى بالفعل، لا تقفل الجلسة تلقائياً
// (لأن المدرس قد يبدأ متأخراً)
if (ms <= 0) {
  // فقط اعرض ملاحظة إن أحببت (اختياري)
  // if (timelineBox) timelineBox.textContent = "تنبيه: وقت الحصة حسب الجدول انتهى، الإنهاء سيكون يدويًا.";
  return;
}

// لا نفعّل الإنهاء التلقائي إذا المتبقي أقل من دقيقة (لتجنب مشاكل التوقيت)
if (ms <= 60000) return;

        AUTO_END_TIMEOUT = setTimeout(() => {
          endSession({ auto: true }).catch(() => {});
        }, ms);
      } catch (e) {
        console.warn("updateScheduleUI failed:", e);
      }
    }

    const lsStage = byId("ls-stage");
    const lsGrade = byId("ls-grade");
    const lsSection = byId("ls-section");
    const lsSubject = byId("ls-subject");

    const getLessonDate = () =>
      String(dateInput?.value || "").slice(0, 10) ||
      (typeof TS.todayISO === "function" ? TS.todayISO() : todayISO());

  const refreshLsLessons = async () => {
  try {
    if (typeof TS.filterLessonsByTeacherDay === "function") {
      await TS.filterLessonsByTeacherDay(lessonSelect, TS.getTeachingScope("ls"), getLessonDate());
      syncStartBtnWithSelectedOption(); // ✅ بعد تعبئة الخيارات
    }
  } catch {}
};

// ✅ تحديث خيارات الحصص مباشرة عند تغيير سجل الحصص (من أي مودال)
if (!window.__LESSONS_LOG_CHANGED_LISTENER__) {
  window.__LESSONS_LOG_CHANGED_LISTENER__ = true;

  const fireRefresh = () => {
    // لا نكسر شيء لو الصفحة في حالة غير جاهزة
    refreshLsLessons().catch(() => {});
  };

  // CustomEvent
  window.addEventListener("LESSONS_LOG_CHANGED", fireRefresh);

  // fallback (لبعض المتصفحات القديمة)
  window.addEventListener("lessons_log_changed", fireRefresh);
}

    [lsStage, lsGrade, lsSection, lsSubject].forEach((el) =>
      el?.addEventListener("change", refreshLsLessons)
    );
    setTimeout(refreshLsLessons, 150);

 lessonSelect.addEventListener("change", async () => {
  const pid = toInt(lessonSelect.value || 0);
  await updateScheduleUI(pid, getLessonDate());
  syncStartBtnWithSelectedOption(); // ✅ مهم
});

function setLessonsControlsRunning(running) {
  if (openAttBtn) openAttBtn.disabled = !running;

  const lock = !!running;

  [lsStage, lsGrade, lsSection, lsSubject, lessonSelect, noteInput].forEach((el) => {
    if (!el) return;
    el.disabled = lock;
    el.style.pointerEvents = lock ? "none" : "";
  });

  if (dateInput) {
    dateInput.disabled = true;
    dateInput.readOnly = true;
    dateInput.style.pointerEvents = "none";
  }

  const finished = getSelectedOption(lessonSelect)?.dataset?.finished === "1";

  // ✅ احترم الصلاحيات
  startBtn.disabled = lock || finished || !__CAN_LS_START;
  endBtn.disabled = !lock || !__CAN_LS_END;

  startBtn.title = !__CAN_LS_START ? "لا تملك صلاحية بدء الحصة" : (finished ? "الحصة منتهية/معتمدة" : "");
  endBtn.title = !__CAN_LS_END ? "لا تملك صلاحية إنهاء الحصة" : "";

  endBtn.style.opacity = lock ? "" : ".7";
}


   async function lockViaEntries(sessionId) {
  const sid = toInt(sessionId);
  if (!sid) throw new Error("SessionId غير صالح");

  // نجيب نفس سجلات الحضور الحالية
  const r = await apiGet(`/teacher/attendance/sessions/${encodeURIComponent(sid)}/entries`);
  const data = r?.data || r || {};
  const students = Array.isArray(data.students) ? data.students : [];

  const entries = students.map((s) => ({
    studentId: toInt(s.id),
    status: String(s.status || "present"),
    note: (s.note || "").trim(),
    reasonId: s.reasonId == null ? null : toInt(s.reasonId),
    lateMinutes: s.lateMinutes == null ? null : toInt(s.lateMinutes),
  }));

  // ✅ هذا “يقفل/يعتمد” الجلسة عندك لأنك تستخدمه أصلاً في الحضور
  await apiPut(`/teacher/attendance/sessions/${encodeURIComponent(sid)}/entries`, {
    entries,
    lock: true,
  });
}

async function finalizeSessionOnServer(sessionId) {
  const id = toInt(sessionId);
  if (!id) throw new Error("SessionId غير صالح");

  // 1) أفضل طريقة (مضمونة عندك): اعتماد عبر /entries
  try {
    await lockViaEntries(id);
    return { locked: true };
  } catch (e) {
    console.warn("lockViaEntries failed:", e);
  }

  // 2) محاولات إضافية لو باك-إندك يدعم lock/end مباشرة
  const tries = [
    { method: "PATCH", path: `/teacher/attendance/sessions/${id}/lock`, body: {} },
    { method: "POST",  path: `/teacher/attendance/sessions/${id}/lock`, body: {} },
    { method: "PATCH", path: `/teacher/attendance/sessions/${id}/end`,  body: {} },
    { method: "POST",  path: `/teacher/attendance/sessions/${id}/end`,  body: {} },
    { method: "PATCH", path: `/teacher/attendance/sessions/${id}`,      body: { action: "end" } },
  ];

  let lastErr = null;
  for (const t of tries) {
    try {
      if (t.method === "PATCH") { await apiPatch(t.path, t.body); return { locked: false }; }
      if (t.method === "POST")  { await apiPost(t.path, t.body);  return { locked: false }; }
    } catch (e) { lastErr = e; }
  }

  throw lastErr || new Error("تعذر إنهاء/اعتماد الجلسة");
}


    async function endSession({ auto } = {}) {
      if (!ACTIVE_SESSION_ID) return;
      if (ENDING_IN_PROGRESS) return; // anti-double
      ENDING_IN_PROGRESS = true;
let locked = true;
try {
  const fin = await finalizeSessionOnServer(ACTIVE_SESSION_ID);
  locked = fin?.locked !== false; // الافتراضي: مقفولة
} catch (e) {
  console.error(e);
  toast("تعذر إنهاء الحصة من الخادم: " + (e.message || ""));
  ENDING_IN_PROGRESS = false;
  return;
}


      const endISO = new Date().toISOString();
      const durSec = TIMER_START_MS ? Math.floor((Date.now() - TIMER_START_MS) / 1000) : 0;

      if (timelineBox)
        timelineBox.textContent = auto
          ? `انتهت الحصة تلقائياً حسب وقتها (جلسة #${ACTIVE_SESSION_ID}).`
          : `تم إنهاء الحصة (جلسة #${ACTIVE_SESSION_ID}).`;
if (sessStatusEl) sessStatusEl.textContent = "منتهية ✅";
if (lockedBadge) lockedBadge.style.display = "";



      if (sessMetaBox) sessMetaBox.style.display = "";
      if (sessIdView) sessIdView.textContent = "#" + ACTIVE_SESSION_ID;
      if (sessStartedView) sessStartedView.textContent = "—";
      if (sessEndedView) sessEndedView.textContent = fmtLocalTime(endISO);

      const ctx = TS.loadAttCtx?.() || {};
      const scope = TS.getTeachingScope ? TS.getTeachingScope("ls") : {};
      const dateVal = ACTIVE_DATE || getLessonDate();
      const periodId = ACTIVE_PERIOD_ID || toInt(ctx.periodId || lessonSelect?.value || 0);
      const opt = getSelectedOption(lessonSelect);
      const lessonNo = toInt(ctx.lessonNo || opt?.dataset?.lesson || periodId);
      const note = (noteInput?.value || "").trim();

upsertLessonLog({
  sessionId: toInt(ACTIVE_SESSION_ID),
  date: dateVal,
  lessonNo,
  periodId,

  stageId: toInt(scope?.stageId || 0),
  gradeId: toInt(scope?.gradeId || 0),
  sectionId: toInt(scope?.sectionId || 0),
  subjectId: toInt(scope?.subjectId || 0),

  stageName: scope.stageName || "",
  gradeName: scope.gradeName || "",
  sectionName: scope.sectionName || "",
  subjectName: scope.subjectName || "",

  note: note || "",
  startISO: ctx.startedAt || null,
  endISO,
  durationSeconds: durSec,

  isLocked: !!locked,                       // ✅
  status: locked ? "locked" : "ended",      // ✅
});


// ✅ امسح الكاش
const { yearId, term } = getYearTermSafe(TS);
invalidateSlotsCache({
  yearId, term,
  dateVal,
  sectionId: toInt(scope?.sectionId || 0),
  subjectId: toInt(scope?.subjectId || 0) || null,
});

// ✅ أخبر الواجهة أن سجل الحصص تغيّر (لتحديث كلمة منتهية فورًا)
try {
  window.dispatchEvent(new CustomEvent("LESSONS_LOG_CHANGED"));
} catch {
  try {
    const ev = document.createEvent("Event");
    ev.initEvent("lessons_log_changed", true, true);
    window.dispatchEvent(ev);
  } catch {}
}


      const old = ACTIVE_SESSION_ID;
      ACTIVE_SESSION_ID = null;
      ACTIVE_PERIOD_ID = null;
      ACTIVE_DATE = null;

      if (sessHidden) sessHidden.value = "";
      if (entryHidden) entryHidden.value = "";

      TS.saveAttCtx?.(null);
      try { delete window.__ACTIVE_LESSON__; } catch { window.__ACTIVE_LESSON__ = null; }

      setLessonsControlsRunning(false);
      stopTimer();

      await renderLessonsLogToNewUI().catch(() => {});
      if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());

      if (typeof window.__openAttendanceForSession === "function") {
        try {
          window.__openAttendanceForSession(old);
        } catch {}
      }

      ENDING_IN_PROGRESS = false;
    }

    async function tryResumeSavedSession() {
      const ctx = TS.loadAttCtx?.();
      if (!ctx?.sessionId) {
        setLessonsControlsRunning(false);
        if (timelineBox) timelineBox.textContent = "لم يتم بدء أي حصة بعد.";
        stopTimer();
        await renderLessonsLogToNewUI().catch(() => {});
        if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());
        return;
      }

      try {
        const r = await apiGet(`/teacher/attendance/sessions/${encodeURIComponent(ctx.sessionId)}/entries`);
        const data = r?.data || r || {};
        const sess = data.session || {};
        const sid = toInt(sess.id || ctx.sessionId);

const endedAt = sess.ended_at ?? sess.endedAt ?? null;

if (toBool(sess.is_locked) || !!endedAt) {
  TS.saveAttCtx?.(null);
  setLessonsControlsRunning(false);
  if (timelineBox) timelineBox.textContent = "لا توجد حصة جارية الآن.";
  stopTimer();
  await renderLessonsLogToNewUI().catch(() => {});
  if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());
  return;
}


        ACTIVE_SESSION_ID = sid;
        ACTIVE_PERIOD_ID = toInt(sess.period_id || ctx.periodId || 0);
        ACTIVE_DATE = String(sess.attendance_date || ctx.date || getLessonDate()).slice(0, 10);

        try {
          if (ctx.scope) TS.setTeachingScope?.("ls", ctx.scope);
        } catch {}

        await refreshLsLessons();
        if (ACTIVE_PERIOD_ID) lessonSelect.value = String(ACTIVE_PERIOD_ID);
syncStartBtnWithSelectedOption();

        setLessonsControlsRunning(true);

        if (timelineBox) timelineBox.textContent = `هناك حصة نشطة (جلسة #${ACTIVE_SESSION_ID}).`;

        const startedAt = sess.started_at || ctx.startedAt || null;
        if (startedAt) startTimerFrom(startedAt);
        else startTimerFrom(Date.now());

        if (sessHidden) sessHidden.value = String(ACTIVE_SESSION_ID || "");
        if (sessMetaBox) sessMetaBox.style.display = "";
        if (sessIdView) sessIdView.textContent = "#" + ACTIVE_SESSION_ID;
        if (sessStartedView) sessStartedView.textContent = startedAt ? fmtLocalTime(startedAt) : "—";
        if (sessEndedView) sessEndedView.textContent = "—";

        if (lockedBadge) lockedBadge.style.display = "none";
        if (sessStatusEl) sessStatusEl.textContent = "جارية";

        await updateScheduleUI(ACTIVE_PERIOD_ID, ACTIVE_DATE);

        await renderLessonsLogToNewUI().catch(() => {});
        if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());
      } catch (e) {
        console.warn("resume failed, clearing ctx:", e);
        TS.saveAttCtx?.(null);
        ACTIVE_SESSION_ID = null;
        ACTIVE_PERIOD_ID = null;
        ACTIVE_DATE = null;
        setLessonsControlsRunning(false);
        if (timelineBox) timelineBox.textContent = "لم يتم بدء أي حصة بعد.";
        stopTimer();
        await renderLessonsLogToNewUI().catch(() => {});
        if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());
      }
    }

    tryResumeSavedSession().catch(() => {});
    setTimeout(() => {
      renderLessonsLogToNewUI().catch(() => {});
      if (logBoxLegacy) renderLessonsLogLegacy(logBoxLegacy, getLessonDate());
    }, 250);

 startBtn.addEventListener("click", async () => {
  try {
    if (!__CAN_LS_START) return toast("لا تملك صلاحية بدء الحصة.");

    // 🧹 امسح أي جلسة قديمة محفوظة قبل البدء بجلسة جديدة
TS.saveAttCtx?.(null);

    if (ACTIVE_SESSION_ID) return toast("هناك حصة جارية بالفعل. أنهِ الحصة أولاً.");


        const scope = TS.getTeachingScope ? TS.getTeachingScope("ls") : null;
        const { yearId, term } = getYearTermSafe(TS);
        const dateVal = getLessonDate();

        if (!scope) return toast("تعذر قراءة نطاق التدريس (TeachingScopes).");

        const currentPid = toInt(lessonSelect.value || 0);
        if (!currentPid && typeof TS.filterLessonsByTeacherDay === "function")
          await TS.filterLessonsByTeacherDay(lessonSelect, scope, dateVal);

        const periodId = toInt(lessonSelect.value || 0);
        const opt = getSelectedOption(lessonSelect);
        // ✅ لو الحصة مقفولة: لا ترسل POST أصلاً، افتح حضورها فقط
if (opt?.dataset?.finished === "1") {
  const oldSid = toInt(opt.dataset.sessionId || 0);
  const st = opt.dataset.finishState || "ended";

  toast(st === "locked"
    ? "هذه الحصة معتمدة — سيتم فتحها للعرض/التصحيح."
    : "هذه الحصة منتهية (غير معتمدة) — سيتم فتحها لتسجيل/اعتماد الحضور إن لزم.");

  syncStartBtnWithSelectedOption();

  if (oldSid && typeof window.__openAttendanceForSession === "function") {
    window.__openAttendanceForSession(oldSid);
  } else {
    toast("لا يوجد رقم جلسة محفوظ لهذه الحصة.");
  }
  return;
}


        const lessonNo = toInt(opt?.dataset?.lesson || periodId);

        if (!scope.stageId || !scope.gradeId || !scope.sectionId || !scope.subjectId) {
          return toast("اختر المرحلة والصف والشعبة والمادة أولاً.");
        }
        if (!periodId || lessonSelect.disabled) {
          return toast("اختر الحصة الصحيحة لليوم (أو لا توجد حصص لك اليوم).");
        }

        // ✅ timetableEntryId + anti-stale map
        let timetableEntryId = 0;
        const sid = String(lessonSelect?.id || "");
        const meta = TS.__periodEntryMapMeta?.[sid];
        const wantKey = scopeKey(scope, dateVal);
        const mapOk = meta && meta.skey === wantKey;

        timetableEntryId =
          toInt(opt?.dataset?.entryId || 0) ||
          (mapOk ? toInt(TS.__periodEntryMap?.[sid]?.[String(periodId)] || 0) : 0);

        if (!timetableEntryId) {
          timetableEntryId = await resolveTimetableEntryId({ yearId, term, dateVal, scope, periodId });
        }
        if (!timetableEntryId) {
          return toast("تعذر تحديد الحصة من الجدول — تأكد أن الحصة تظهر ضمن حصصك لهذا اليوم.");
        }

        const note = (noteInput?.value || "").trim();

        const body = {
          academicYearId: yearId,
          term,
          date: dateVal,
          periodId,
          lesson: lessonNo,

          stageId: toInt(scope.stageId),
          gradeId: toInt(scope.gradeId),

          sectionId: toInt(scope.sectionId),
          subjectId: toInt(scope.subjectId),

          timetableEntryId,
          lessonNote: note || null,
          source: "manual",
          startNow: true,
        };

       const r = await apiPost("/teacher/attendance/sessions", body);
const data = r?.data || r || {};

const sessionId = toInt(data.sessionId || data.id || 0);
if (!sessionId) return toast("لم يتم إنشاء جلسة الحصة.");

const isLocked = toBool(data.isLocked ?? data.is_locked);

// ✅ لو الجلسة معتمدة: لا تبدأ تايمر ولا تقفل السيلكت.. فقط افتح الحضور
if (isLocked) {
  toast("هذه الحصة منتهية ومعتمدة — لا يمكن بدءها مرة أخرى. سيتم فتحها للعرض/التصحيح.");
  // وقف زر البدء لهذه الحصة (Hover يتوقف)
  try {
    startBtn.disabled = true;
    startBtn.style.pointerEvents = "none";
    startBtn.title = "الحصة منتهية/معتمدة";
    const opt = getSelectedOption(lessonSelect);
  } catch {}

  if (typeof window.__openAttendanceForSession === "function") {
    window.__openAttendanceForSession(sessionId);
  }
  return; // 🔥 مهم جدًا
}


        ACTIVE_SESSION_ID = sessionId;
        ACTIVE_PERIOD_ID = periodId;
        ACTIVE_DATE = dateVal;

        if (sessHidden) sessHidden.value = String(sessionId);
        if (entryHidden) entryHidden.value = String(timetableEntryId);

        setLessonsControlsRunning(true);
        startTimerFrom(Date.now());

        if (sessMetaBox) sessMetaBox.style.display = "";
        if (sessIdView) sessIdView.textContent = "#" + sessionId;
        if (sessStartedView) sessStartedView.textContent = fmtLocalTime(new Date().toISOString());
        if (sessEndedView) sessEndedView.textContent = "—";

        if (lockedBadge) lockedBadge.style.display = "none";
        if (sessStatusEl) sessStatusEl.textContent = "جارية";

        await updateScheduleUI(periodId, dateVal);

        if (timelineBox) {
          timelineBox.textContent =
            `بدأت الحصة ${lessonNo || periodId} — ${scope.gradeName} / ${scope.sectionName} — ${scope.subjectName}` +
            ` — تاريخ ${dateVal}` +
            (note ? ` — ملاحظة: ${note}` : "");
        }

        const startedAtISO = new Date().toISOString();
        TS.saveAttCtx?.({
          sessionId: sessionId,
          date: dateVal,
          periodId: toInt(periodId),
          lessonNo: toInt(lessonNo || periodId),
          startedAt: startedAtISO,
          scope: {
            stageId: toInt(scope.stageId || 0),
            gradeId: toInt(scope.gradeId || 0),
            sectionId: toInt(scope.sectionId || 0),
            subjectId: toInt(scope.subjectId || 0),
          },
        });

        window.__ACTIVE_LESSON__ = {
          sessionId,
          stageId: toInt(scope.stageId),
          gradeId: toInt(scope.gradeId),
          sectionId: toInt(scope.sectionId),
          subjectId: toInt(scope.subjectId),
          periodId: toInt(periodId),
          timetableEntryId,
          date: dateVal,
          startedAt: startedAtISO,
        };

        upsertLessonLog({
          sessionId,
          date: dateVal,
          lessonNo: toInt(lessonNo || periodId),
          periodId: toInt(periodId),
          stageName: scope.stageName || "",
          gradeName: scope.gradeName || "",
          sectionName: scope.sectionName || "",
          subjectName: scope.subjectName || "",
          note: note || "",
          startISO: startedAtISO,
          endISO: null,
          durationSeconds: 0,
          isLocked: false,
          status: "running",
        });

        await renderLessonsLogToNewUI().catch(() => {});
        const logBoxLegacy2 = byId("ls-log");
        if (logBoxLegacy2) renderLessonsLogLegacy(logBoxLegacy2, getLessonDate());

        if (typeof window.__openAttendanceForSession === "function") {
          window.__openAttendanceForSession(sessionId);
        } else if (typeof window.openModal === "function") {
          window.openModal("modal-attendance");
        }
      } catch (e) {
        console.error(e);
        toast("فشل بدء الحصة: " + (e.message || ""));
      }
    });

    endBtn.addEventListener("click", async () => {
      if (!ACTIVE_SESSION_ID) return toast("لا توجد حصة جارية لإنهائها.");
      if (!__CAN_LS_END) return toast("لا تملك صلاحية إنهاء الحصة.");

      await endSession({ auto: false });
    });
    
  }

  /* =========================
     Lessons Tabs + Report actions (ls-view-live / ls-view-log)
  ========================= */
  function initLessonsTabsAndReport() {
    const tabLive = byId("ls-tab-live");
    const tabLog = byId("ls-tab-log");
    const viewLive = byId("ls-view-live");
    const viewLog = byId("ls-view-log");

    function setTab(which) {
      const w = which === "log" ? "log" : "live";
      tabLive?.classList.toggle("is-active", w === "live");
      tabLog?.classList.toggle("is-active", w === "log");
      if (viewLive) viewLive.style.display = w === "live" ? "" : "none";
      if (viewLog) viewLog.style.display = w === "log" ? "" : "none";
      if (w === "log") renderLessonsLogToNewUI().catch(() => {});
    }

    tabLive?.addEventListener("click", () => setTab("live"));
    tabLog?.addEventListener("click", () => setTab("log"));

    const showBtn = byId("lsr-show");
    const exportBtn = byId("lsr-export-csv");
    const printBtn = byId("lsr-print");

    showBtn?.addEventListener("click", () => renderLessonsLogToNewUI().catch(() => {}));

    exportBtn?.addEventListener("click", async () => {
      const from = String(byId("lsr-from")?.value || "").slice(0, 10);
      const to = String(byId("lsr-to")?.value || "").slice(0, 10);
      const stVal = String(byId("lsr-status")?.value || "").trim();

     const merged = await getLessonsLogMerged({ from, to, status: stVal });
const rows = merged
  .filter((x) => inRange(x.date, from, to))
  .filter((x) => (stVal ? pickStatus(x) === stVal : true))
  .slice(0, 1000);


      if (!rows.length) return toast("لا توجد بيانات للتصدير ضمن الفلاتر الحالية.");

      const header = [
        "date",
        "lessonNo",
        "subject",
        "grade",
        "section",
        "start",
        "end",
        "duration",
        "status",
        "sessionId",
        "note",
      ];

      const csv =
        header.join(",") +
        "\n" +
        rows
          .map((x) => {
            const vals = [
              String(x.date || ""),
              String(x.lessonNo || ""),
              String(x.subjectName || ""),
              String(x.gradeName || ""),
              String(x.sectionName || ""),
              String(x.startISO || ""),
              String(x.endISO || ""),
              String(x.durationSeconds || ""),
              String(pickStatus(x) || ""),
              String(x.sessionId || ""),
              String(x.note || ""),
            ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
            return vals.join(",");
          })
          .join("\n");

      downloadText(`lessons_log_${from || "all"}_${to || "all"}.csv`, csv);
    });

    printBtn?.addEventListener("click", async () => {
      const ok = await renderLessonsLogToNewUI().catch(() => false);
      if (!ok) return toast("نافذة الطباعة غير جاهزة (جدول السجل غير موجود).");
      try {
        window.print();
      } catch {
        toast("تعذر فتح الطباعة على هذا المتصفح.");
      }
    });
  }
})();
