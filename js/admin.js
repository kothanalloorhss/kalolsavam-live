/* Kalolsavam Live — admin console. Every action is a read-modify-write on data.json
   through the GitHub Contents API, so the latest SHA is always fetched first. */
(() => {
  const C = KL.CONFIG, esc = KL.esc;
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = "kl_admin_token";
  const S = { token: sessionStorage.getItem(TOKEN_KEY), stages: [], schedule: [], data: null,
              selected: Number(sessionStorage.getItem("kl_stage")) || 1, busy: false, endStage: null };
  const stageIds = () => S.stages.map(s => s.stage_id);
  const findEvent = id => S.schedule.find(e => String(e.event_id) === String(id));

  /* ---------- GitHub Contents API ---------- */
  const toB64 = str => { let bin = ""; new TextEncoder().encode(str).forEach(b => (bin += String.fromCharCode(b))); return btoa(bin); };
  const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

  function api(path, opts = {}) {
    return fetch(`https://api.github.com/repos/${C.owner}/${C.repo}/contents/${path}`, {
      cache: "no-store", ...opts,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                 Authorization: `Bearer ${S.token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) }
    });
  }

  async function apiError(r) {
    let detail = ""; try { detail = (await r.json()).message; } catch (e) {}
    const msg = r.status === 401 ? "GitHub rejected the token. Check it has not expired."
      : r.status === 403 || r.status === 404 ? `The token cannot reach ${C.owner}/${C.repo}. It needs Contents: read and write on that repo only.`
      : `GitHub error ${r.status}${detail ? `: ${detail}` : ""}`;
    const e = new Error(msg); e.status = r.status; return e;
  }

  async function readRemote() {
    const r = await api(`${C.dataPath}?ref=${encodeURIComponent(C.branch)}`);
    if (!r.ok) throw await apiError(r);
    const j = await r.json();
    return { sha: j.sha, data: KL.normalizeData(JSON.parse(fromB64(j.content)), stageIds()) };
  }

  async function writeRemote(data, sha, message) {
    return api(C.dataPath, { method: "PUT", body: JSON.stringify({
      message, content: toB64(JSON.stringify(data, null, 2) + "\n"), sha, branch: C.branch }) });
  }

  // Serialised: one commit at a time. Retries when someone else changed the file in between.
  let chain = Promise.resolve();
  function commit(mutator, message) {
    const job = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { sha, data } = await readRemote();
        const next = mutator(data) || data;
        next.updated_at = new Date().toISOString();
        const r = await writeRemote(next, sha, message);
        if (r.ok) { S.data = next; return next; }
        if (r.status === 409 || r.status === 422) continue; // stale SHA, read again
        throw await apiError(r);
      }
      throw new Error("Could not save because data.json kept changing. Try again.");
    };
    const p = chain.then(job, job);
    chain = p.catch(() => {});
    return p;
  }

  /* ---------- UI helpers ---------- */
  let toastTimer;
  function toast(msg, kind = "ok") {
    const t = $("toast");
    t.textContent = msg; t.className = `toast is-${kind}`; t.hidden = false;
    clearTimeout(toastTimer);
    if (kind === "ok") toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  async function run(mutator, message, okText) {
    if (S.busy) return false;
    S.busy = true; document.body.classList.add("is-busy"); toast("Saving to GitHub…", "wait");
    try { await commit(mutator, message); toast(okText || "Saved. Viewers get it on their next refresh."); return true; }
    catch (e) { toast(e.message, "err"); return false; }
    finally { S.busy = false; document.body.classList.remove("is-busy"); render(); }
  }

  const trimList = (arr, n) => { if (arr.length > n) arr.length = n; };
  const pushTicker = (d, text) => { d.ticker.unshift({ t: KL.nowISO(), text }); trimList(d.ticker, C.maxTickerStored); };
  const idleStage = () => ({ status: "idle", event_id: null, event_name: null, categories: [], scheduled_start: null, actual_start: null, delay_minutes: 0 });

  /* ---------- actions ---------- */
  function startEvent(eventId) {
    const ev = findEvent(eventId); if (!ev) return;
    const sid = Number(ev.stage_id), cur = S.data.stages[sid];
    if (cur.status === "ongoing") return toast(`Stage ${sid} is still running "${cur.event_name}". End it first.`, "err");
    const delay = Math.max(0, Math.round((KL.now() - KL.atTime(ev.date, ev.start_time)) / 60000));
    run(d => {
      if (d.stages[sid].status === "ongoing") throw new Error(`Stage ${sid} is already running another event.`);
      if (d.completed_events.map(String).includes(String(ev.event_id))) throw new Error("This event is already marked finished.");
      d.stages[sid] = { status: "ongoing", event_id: ev.event_id, event_name: ev.event_name, categories: KL.cats(ev),
                        scheduled_start: ev.start_time, actual_start: KL.nowISO(), delay_minutes: delay };
      pushTicker(d, `Stage ${sid}: ${ev.event_name} has started${delay > 5 ? ` (${delay} min late)` : ""}`);
    }, `Stage ${sid} start: event ${ev.event_id}`, `Stage ${sid} is now live.`);
  }

  function endEvent(sid, ranks) {
    run(d => {
      const st = d.stages[sid];
      if (st.status !== "ongoing") throw new Error(`Stage ${sid} has no running event.`);
      const eventId = st.event_id, name = st.event_name, cats = st.categories;
      if (!d.completed_events.map(String).includes(String(eventId))) d.completed_events.push(eventId);
      if (ranks) {
        d.recent_results.unshift({ event_id: eventId, event_name: name, stage_id: sid, categories: cats,
                                   announced_at: KL.nowISO(), first: ranks.first, second: ranks.second, third: ranks.third });
        trimList(d.recent_results, C.maxResultsStored);
        const parts = [["1st", ranks.first], ["2nd", ranks.second], ["3rd", ranks.third]].filter(p => p[1]).map(p => `${p[0]} ${p[1]}`);
        pushTicker(d, `Results, Stage ${sid}, ${name}: ${parts.join(", ")}`);
      } else {
        pushTicker(d, `Stage ${sid}: ${name} has finished`);
      }
      d.stages[sid] = idleStage();
    }, `Stage ${sid} end`, ranks ? "Event finished and results announced." : "Event finished.");
  }

  const cancelStart = sid => run(d => { d.stages[sid] = idleStage(); }, `Stage ${sid} start cancelled`, `Stage ${sid} reset to idle.`);
  const reopenEvent = id => run(d => { d.completed_events = d.completed_events.filter(x => String(x) !== String(id)); },
                                 `Reopen event ${id}`, "Event moved back to pending.");

  /* ---------- rendering ---------- */
  function eventItem(ev, st) {
    const running = st.status === "ongoing" && String(st.event_id) === String(ev.event_id);
    const blocked = st.status === "ongoing" && !running;
    const due = Math.floor((KL.now() - KL.atTime(ev.date, ev.start_time)) / 60000);
    const note = running
      ? `Running since ${KL.fmtTime(st.actual_start)}${st.delay_minutes > 0 ? `, started ${st.delay_minutes} min late` : ""}`
      : due > 0 ? `Due ${due} min ago` : "";
    const chips = KL.cats(ev).map(c => `<span class="chip">${esc(c)}</span>`).join("");
    return `<li class="ev ${running ? "is-live" : ""}">
      <div class="ev-time">${KL.fmtHHMM(ev.start_time)}</div>
      <div class="ev-main"><p class="ev-name" lang="ml">${esc(ev.event_name)}</p>
        <div class="chips">${chips}</div>${note ? `<p class="ev-note ${running ? "" : "is-due"}">${esc(note)}</p>` : ""}
        ${running ? `<button class="link act" data-act="cancel" data-stage="${ev.stage_id}">Started by mistake? Reset stage</button>` : ""}</div>
      <div class="ev-actions">
        <button class="btn btn-start act" data-act="start" data-id="${esc(ev.event_id)}" ${running || blocked ? "disabled" : ""}>Start</button>
        <button class="btn btn-end act" data-act="end" data-stage="${ev.stage_id}" ${running ? "" : "disabled"}>End</button>
      </div></li>`;
  }

  function render() {
    if (!S.data) return;
    const day = KL.today();
    $("adminDate").textContent = KL.fmtLongDate(KL.now());
    $("testChip").hidden = !KL.testMode;

    $("chips").innerHTML = S.stages.map(s => {
      const live = S.data.stages[s.stage_id].status === "ongoing";
      return `<button class="stage-chip ${live ? "is-live" : ""}" data-chip="${s.stage_id}" aria-pressed="${s.stage_id === S.selected}"
        aria-label="Stage ${s.stage_id}${live ? ", live" : ""}">${s.stage_id}</button>`;
    }).join("");

    const stage = S.stages.find(s => s.stage_id === S.selected) || S.stages[0];
    const st = S.data.stages[stage.stage_id];
    const done = new Set(S.data.completed_events.map(String));
    const todays = KL.eventsFor(S.schedule, day, stage.stage_id);
    const pending = todays.filter(e => !done.has(String(e.event_id)));
    const finished = todays.filter(e => done.has(String(e.event_id)));

    $("stageHead").innerHTML = `<h2>${esc(stage.stage_name)}</h2><p>${esc(stage.venue_location)}</p>`;
    $("eventList").innerHTML = pending.map(e => eventItem(e, st)).join("");
    $("emptyState").hidden = pending.length > 0;
    $("emptyState").textContent = !todays.length
      ? `No events are scheduled on this stage for ${day}. Festival days are ${C.festivalDates.join(", ")}. Add ?date=YYYY-MM-DD to the address to test another day.`
      : "Every event on this stage is finished.";

    $("finishedWrap").hidden = !finished.length;
    $("finishedCount").textContent = finished.length;
    $("finishedList").innerHTML = finished.map(e => `<li><span lang="ml">${esc(e.event_name)}</span>
      <button class="link act" data-act="reopen" data-id="${esc(e.event_id)}">Move back to pending</button></li>`).join("");

    const b = S.data.banner;
    $("bannerState").textContent = b.active && b.text ? `Showing: ${b.text}` : "No banner is showing.";
  }

  /* ---------- events ---------- */
  function openEndModal(sid) {
    const st = S.data.stages[sid];
    S.endStage = sid;
    $("endTitle").textContent = `End Stage ${sid}`;
    $("endEvent").textContent = st.event_name || "";
    ["rank1", "rank2", "rank3"].forEach(id => ($(id).value = ""));
    $("endModal").showModal();
    $("rank1").focus();
  }

  document.addEventListener("click", e => {
    const chip = e.target.closest("[data-chip]");
    if (chip) { S.selected = Number(chip.dataset.chip); sessionStorage.setItem("kl_stage", S.selected); render(); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled || S.busy) return;
    const { act, id, stage } = btn.dataset;
    if (act === "start") startEvent(id);
    else if (act === "end") openEndModal(Number(stage));
    else if (act === "cancel" && confirm(`Reset Stage ${stage} to idle? The start notice stays in the ticker.`)) cancelStart(Number(stage));
    else if (act === "reopen") reopenEvent(id);
  });

  $("endForm").addEventListener("submit", e => {
    e.preventDefault();
    const ranks = { first: $("rank1").value.trim(), second: $("rank2").value.trim(), third: $("rank3").value.trim() };
    $("endModal").close();
    endEvent(S.endStage, ranks.first || ranks.second || ranks.third ? ranks : null);
  });
  $("skipResults").addEventListener("click", () => { $("endModal").close(); endEvent(S.endStage, null); });
  $("cancelEnd").addEventListener("click", () => $("endModal").close());

  $("bannerForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("bannerText").value.trim(); if (!text) return;
    run(d => { d.banner = { active: true, text, updated_at: KL.nowISO() }; }, "Banner on", "Banner is live on the public page.")
      .then(ok => ok && ($("bannerText").value = ""));
  });
  $("clearBanner").addEventListener("click", () => run(d => { d.banner = { active: false, text: "" }; }, "Banner off", "Banner removed."));
  $("noticeForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("noticeText").value.trim(); if (!text) return;
    run(d => pushTicker(d, text), "Ticker notice", "Notice added to the ticker.").then(ok => ok && ($("noticeText").value = ""));
  });

  /* ---------- token gate + boot ---------- */
  function showGate(msg) { $("gate").hidden = false; $("gateError").textContent = msg || ""; $("tokenInput").focus(); }

  async function connect(token) {
    S.token = token;
    const { data } = await readRemote();
    S.data = data;
    sessionStorage.setItem(TOKEN_KEY, token);
    $("gate").hidden = true;
    render();
  }

  $("gateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("gateBtn"); btn.disabled = true; $("gateError").textContent = "";
    try { await connect($("tokenInput").value.trim()); }
    catch (err) { S.token = null; $("gateError").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("logout").addEventListener("click", () => { sessionStorage.removeItem(TOKEN_KEY); location.reload(); });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !S.token || S.busy) return;
    try { S.data = (await readRemote()).data; render(); } catch (e) {}
  });

  async function init() {
    document.title = `${C.festivalTitle} Admin`;
    try {
      [S.stages, S.schedule] = await Promise.all([
        KL.fetchJson("stages.json", { cache: "no-cache" }),
        KL.fetchJson("schedule.json", { cache: "no-cache" })
      ]);
      S.stages.sort((a, b) => a.stage_id - b.stage_id);
    } catch (err) { return showGate("Could not load stages.json or schedule.json."); }
    if (S.token) { try { await connect(S.token); return; } catch (err) { sessionStorage.removeItem(TOKEN_KEY); showGate(err.message); return; } }
    showGate();
  }
  init();
})();
