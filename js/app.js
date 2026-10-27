/* Kalolsavam Live — public viewer. Polls data.json and redraws the page. */
(() => {
  const C = KL.CONFIG, esc = KL.esc;
  const $ = id => document.getElementById(id);
  const S = { stages: [], schedule: [], data: null, lastOk: null, online: true, tickerKey: "" };
  const stageIds = () => S.stages.map(s => s.stage_id);

  /* ---------- data ---------- */
  async function fetchLive() {
    const t = Date.now(); // cache-buster so nobody sees stale data
    try {
      return await KL.fetchJson(`${KL.rawUrl()}?t=${t}`, { cache: "no-store" });
    } catch (err) {
      // fallback: the copy served by GitHub Pages itself (also works for local testing)
      return KL.fetchJson(`data.json?t=${t}`, { cache: "no-store" });
    }
  }

  async function poll() {
    try {
      S.data = KL.normalizeData(await fetchLive(), stageIds());
      S.lastOk = new Date();
      S.online = true;
    } catch (err) {
      S.online = false;
      if (!S.data) S.data = KL.normalizeData({}, stageIds());
    }
    render();
  }

  /* ---------- per-stage status ---------- */
  function stageView(stage) {
    const id = stage.stage_id;
    const st = S.data.stages[id];
    const day = KL.today();
    const todays = KL.eventsFor(S.schedule, day, id);
    const done = new Set(S.data.completed_events.map(String));
    const base = { mode: "none", doneCount: todays.filter(e => done.has(String(e.event_id))).length, total: todays.length };

    if (st.status === "ongoing") {
      const ev = S.schedule.find(e => String(e.event_id) === String(st.event_id));
      const started = new Date(st.actual_start);
      const schedHHMM = st.scheduled_start || (ev && ev.start_time) || null;
      const sched = schedHHMM ? KL.atTime(ev ? ev.date : day, schedHHMM) : null;
      const delay = sched && !isNaN(started) ? Math.round((started - sched) / 60000) : (st.delay_minutes || 0);
      return { ...base, mode: "live", name: st.event_name || (ev && ev.event_name) || "Event in progress",
               cats: st.categories && st.categories.length ? st.categories : KL.cats(ev),
               sched: schedHHMM, started: isNaN(started) ? null : started, delay };
    }

    const next = todays.find(e => !done.has(String(e.event_id)));
    if (next) {
      const sched = KL.atTime(next.date, next.start_time);
      return { ...base, mode: "next", name: next.event_name, cats: KL.cats(next), sched: next.start_time,
               delay: Math.max(0, Math.floor((KL.now() - sched) / 60000)) };
    }
    return { ...base, mode: todays.length ? "done" : "none" };
  }

  const delayClass = m => (m <= 5 ? "ok" : m <= 20 ? "warn" : "bad");

  /* ---------- rendering ---------- */
  function directions(s) {
    const map = s.is_external && s.map_url
      ? `<a class="map-btn" href="${esc(s.map_url)}" target="_blank" rel="noopener">Open in Google Maps</a>` : "";
    const route = s.route_guide ? `<p class="route">${esc(s.route_guide)}</p>` : "";
    return map || route ? `<footer class="stage-foot">${map}${route}</footer>` : "";
  }

  function stageCard(s) {
    const v = stageView(s);
    const label = { live: "Live now", next: "Up next", done: "Finished for today", none: "No events today" }[v.mode];
    let body = "", pill = "";

    if (v.mode === "live" || v.mode === "next") {
      const chips = (v.cats || []).map(c => `<span class="chip">${esc(c)}</span>`).join("");
      body += `<p class="event-name" lang="ml">${esc(v.name)}</p><div class="chips">${chips}</div>`;
      if (v.mode === "live") {
        body += `<p class="times">Started ${v.started ? KL.fmtTime(v.started) : "—"}${v.sched ? `, scheduled ${KL.fmtHHMM(v.sched)}` : ""}</p>`;
        pill = v.delay > 0 ? `<span class="delay ${delayClass(v.delay)}">Started ${v.delay} min late</span>`
                           : `<span class="delay ok">Started on time</span>`;
      } else {
        body += `<p class="times">Scheduled ${KL.fmtHHMM(v.sched)}</p>`;
        pill = v.delay > 0 ? `<span class="delay ${delayClass(v.delay)}">Running ${v.delay} min behind</span>` : "";
      }
    } else if (v.mode === "done") {
      body = `<p class="muted">All ${v.total} events on this stage are complete.</p>`;
    } else {
      body = `<p class="muted">Nothing is scheduled here today.</p>`;
    }

    const progress = v.total ? `<p class="progress">${v.doneCount} of ${v.total} events done</p>` : "";
    return `<article class="stage-card is-${v.mode}">
      <header class="stage-head">
        <span class="stage-no" aria-label="Stage ${s.stage_id}">${s.stage_id}</span>
        <div class="stage-title"><h3>${esc(s.stage_name)}</h3><p>${esc(s.venue_location)}</p></div>
      </header>
      <div class="stage-body">
        <span class="status status-${v.mode}">${label}</span>
        ${body}${pill}${progress}
      </div>
      ${directions(s)}
    </article>`;
  }

  function renderBanner() {
    const b = S.data.banner, el = $("alert");
    if (b && b.active && b.text) { el.textContent = b.text; el.hidden = false; }
    else el.hidden = true;
  }

  function renderResults() {
    const list = S.data.recent_results
      .filter(r => { const m = KL.minutesAgo(r.announced_at); return m <= C.resultWindowMinutes; })
      .sort((a, b) => new Date(b.announced_at) - new Date(a.announced_at))
      .slice(0, C.maxResultsShown);
    const box = $("results");
    box.hidden = !list.length;
    if (!list.length) return;
    $("resultList").innerHTML = list.map(r => {
      const fresh = KL.minutesAgo(r.announced_at) < C.freshResultMinutes;
      const rank = (label, n) => n ? `<span class="rank"><b>${label}</b> ${esc(n)}</span>` : "";
      return `<li class="${fresh ? "is-fresh" : ""}">
        <div class="res-head"><span class="res-name" lang="ml">${esc(r.event_name)}</span>
        <span class="res-meta">Stage ${esc(r.stage_id)}, ${KL.agoText(r.announced_at)}</span></div>
        <div class="ranks">${rank("1st", r.first)}${rank("2nd", r.second)}${rank("3rd", r.third)}</div></li>`;
    }).join("");
  }

  function renderTicker() {
    const items = S.data.ticker.slice(0, C.tickerShown);
    const text = items.length
      ? items.map(i => `${KL.fmtTime(i.t)}: ${i.text}`)
      : [`Welcome to ${C.festivalTitle}. Live stage updates will appear here.`];
    const key = text.join("|");
    if (key === S.tickerKey) return; // don't restart the scroll if nothing changed
    S.tickerKey = key;
    const html = text.map(t => `<span class="tick">${esc(t)}</span>`).join("");
    const chars = text.join("").length;
    const track = $("tickerTrack");
    track.style.setProperty("--dur", `${Math.max(30, Math.round(chars * 0.22))}s`);
    track.innerHTML = html;
  }

  function renderMeta() {
    const idx = C.festivalDates.indexOf(KL.today());
    const day = KL.fmtLongDate(KL.now());
    $("dayLabel").textContent = idx >= 0 ? `${day}, day ${idx + 1} of ${C.festivalDates.length}` : day;
    const sync = $("syncState");
    if (S.online && S.lastOk) { sync.textContent = `Updated ${KL.fmtTime(S.lastOk)}`; sync.className = "sync"; }
    else if (!S.online) { sync.textContent = "Connection lost. Showing the last update and retrying."; sync.className = "sync is-off"; }
    $("testChip").hidden = !KL.testMode;
  }

  function render() {
    if (!S.data) return;
    renderBanner(); renderResults(); renderMeta(); renderTicker();
    $("stageGrid").innerHTML = S.stages.map(stageCard).join("");
  }

  /* ---------- boot ---------- */
  async function init() {
    document.title = `${C.festivalTitle} Live`;
    try {
      [S.stages, S.schedule] = await Promise.all([
        KL.fetchJson("stages.json", { cache: "no-cache" }),
        KL.fetchJson("schedule.json", { cache: "no-cache" })
      ]);
      S.stages.sort((a, b) => a.stage_id - b.stage_id);
    } catch (err) {
      $("stageGrid").innerHTML = `<p class="muted">Could not load the stage list. Please refresh.</p>`;
      return;
    }
    await poll();
    setInterval(() => { if (!document.hidden) poll(); }, C.pollSeconds * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }
  init();
})();
