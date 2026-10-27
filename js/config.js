/* Kalolsavam Live — shared settings and small helpers.
   Edit CONFIG only. Loaded before app.js and admin.js. */
window.KL = (() => {
  const CONFIG = {
    owner: "YOUR_GITHUB_USERNAME",   // GitHub user or org that owns the repo
    repo: "kalolsavam-live",         // repository name
    branch: "main",                  // branch GitHub Pages serves from
    dataPath: "data.json",           // the only file the admin app writes
    festivalTitle: "Kalolsavam 2026",
    festivalDates: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    timeZone: "Asia/Kolkata",
    pollSeconds: 30,
    resultWindowMinutes: 20,         // results stay on the board this long
    freshResultMinutes: 3,           // results flash for this long
    maxResultsShown: 5,
    maxResultsStored: 10,
    maxTickerStored: 30,
    tickerShown: 10,
    festivalDatesText: "3 to 6 November 2026",
    // Public page: gently scrolls through every stage card while the viewer is idle
    autoScroll: { startDelaySec: 6, speedPxPerSec: 40, holdSec: 4, resumeAfterIdleSec: 90 }
  };

  const IST_OFFSET = "+05:30"; // India has no daylight saving

  // Test helpers: ?date=2026-11-03 and/or ?now=10:30 on either page
  const params = new URLSearchParams(location.search);
  const dateOverride = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : null;
  const nowOverride = /^\d{2}:\d{2}$/.test(params.get("now") || "") ? params.get("now") : null;
  const testMode = Boolean(dateOverride || nowOverride);

  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const clockFmt = new Intl.DateTimeFormat("en-IN", { timeZone: CONFIG.timeZone, hour: "numeric", minute: "2-digit", hour12: true });
  const longDateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: CONFIG.timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const atTime = (dateStr, hhmm) => new Date(`${dateStr}T${hhmm}:00${IST_OFFSET}`);

  function today() { return dateOverride || dateFmt.format(new Date()); }
  function now() {
    if (!testMode) return new Date();
    return atTime(today(), nowOverride || hmFmt.format(new Date()));
  }
  const nowISO = () => now().toISOString();

  const fmtTime = d => clockFmt.format(d instanceof Date ? d : new Date(d)).replace(/am|pm/i, m => m.toUpperCase());
  const fmtHHMM = hhmm => fmtTime(atTime("2026-01-01", hhmm));
  const fmtLongDate = d => longDateFmt.format(d);

  function minutesAgo(iso) {
    return Math.floor((now() - new Date(iso)) / 60000);
  }
  function agoText(iso) {
    const m = minutesAgo(iso);
    return m < 1 ? "just now" : `${m} min ago`;
  }

  const cats = ev => {
    if (!ev) return [];
    if (Array.isArray(ev.categories) && ev.categories.length) return ev.categories;
    return ev.category ? String(ev.category).split(/[\/,&]/).map(s => s.trim()).filter(Boolean) : [];
  };

  const eventsFor = (schedule, date, stageId) =>
    schedule
      .filter(e => e.date === date && (stageId == null || Number(e.stage_id) === Number(stageId)))
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || Number(a.event_id) - Number(b.event_id));

  // Only stages that have at least one event on `date` (or are live right now)
  const stagesWithEvents = (stages, schedule, date, data) => {
    const has = new Set(schedule.filter(e => e.date === date).map(e => Number(e.stage_id)));
    return stages.filter(s => has.has(Number(s.stage_id)) ||
      Boolean(data && data.stages && data.stages[s.stage_id] && data.stages[s.stage_id].status === "ongoing"));
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  }

  const rawUrl = () => `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}`;

  // Makes sure data.json always has every key the UI reads.
  function normalizeData(d, stageIds) {
    d = d && typeof d === "object" ? d : {};
    d.banner = d.banner || { active: false, text: "" };
    d.stages = d.stages || {};
    stageIds.forEach(id => {
      d.stages[id] = Object.assign(
        { status: "idle", event_id: null, event_name: null, categories: [], scheduled_start: null, actual_start: null, delay_minutes: 0 },
        d.stages[id]
      );
    });
    ["ticker", "recent_results", "completed_events"].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
    return d;
  }

  /* ---------- branding splash (door-opening intro) ---------- */
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let splashMs = 0;
  (function splash() {
    const sp = document.getElementById("splash");
    if (!sp) return;
    // admin pages set data-splash="once": show the intro once per browser tab
    if (document.body.dataset.splash === "once" && sessionStorage.getItem("kl_splash_seen")) { sp.remove(); return; }
    sessionStorage.setItem("kl_splash_seen", "1");
    splashMs = reduced ? 2000 : 3100;
    const end = () => sp.remove();
    sp.addEventListener("animationend", e => { if (e.target.classList.contains("door-r")) end(); });
    sp.addEventListener("click", () => { splashMs = 0; end(); });
    setTimeout(end, splashMs + 1500); // safety net
  })();

  return { CONFIG, testMode, stagesWithEvents, reduced, get splashMs() { return splashMs; }, dateOverride, nowOverride, today, now, nowISO, atTime, fmtTime, fmtHHMM, fmtLongDate,
           minutesAgo, agoText, cats, eventsFor, esc, fetchJson, rawUrl, normalizeData };
})();
