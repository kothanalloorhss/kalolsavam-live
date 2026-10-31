/* Kalolsavam Live — admin console. Every action is a read-modify-write on data.json
   through the GitHub Contents API, so the latest SHA is always fetched first. */
(() => {
  const C = KL.CONFIG, esc = KL.esc;
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = "kl_admin_token";
  const S = { 
    token: sessionStorage.getItem(TOKEN_KEY), stages: [], schedule: [], data: null,
    selected: Number(sessionStorage.getItem("kl_stage")) || 1, busy: false, endStage: null, editResultIdx: null 
  };
  const stageIds = () => S.stages.map(s => s.stage_id);

  // Multi-stage helper: extracts array of numeric stage IDs from "12, 13" or 12 or [12, 13]
  function parseStageIds(stg) {
    if (Array.isArray(stg)) return stg.map(Number);
    return String(stg || '').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
  }

  // Merges schedule_overrides from data.json into base schedule
  function getEffectiveSchedule() {
    const overrides = (S.data && S.data.schedule_overrides) || {};
    return S.schedule.map(item => {
      const ov = overrides[String(item.event_id)];
      if (ov) {
        return {
          ...item,
          start_time: ov.start_time || item.start_time,
          stage_id: ov.stage_id || item.stage_id,
          status_override: ov.status || 'active',
          _overridden: true
        };
      }
      return item;
    }).filter(e => e.status_override !== 'cancelled');
  }

  const findEvent = id => getEffectiveSchedule().find(e => String(e.event_id) === String(id));

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

  let chain = Promise.resolve();
  function commit(mutator, message) {
    const job = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { sha, data } = await readRemote();
        const next = mutator(data) || data;
        next.updated_at = new Date().toISOString();
        const r = await writeRemote(next, sha, message);
        if (r.ok) { S.data = next; return next; }
        if (r.status === 409 || r.status === 422) continue;
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
  const idleStage = () => ({ status: "idle", event_id: null, event_name: null, categories: [], scheduled_start: null, actual_start: null, delay_minutes: 0, idle_since: KL.nowISO() });

  /* ---------- actions (Supports Single & Combined Stages) ---------- */
  function startEvent(eventId) {
    const ev = findEvent(eventId); if (!ev) return;
    const targetStageIds = parseStageIds(ev.stage_id);
    
    for (const sid of targetStageIds) {
      const cur = S.data.stages[sid];
      if (cur && cur.status === "ongoing" && String(cur.event_id) !== String(ev.event_id)) {
        return toast(`Stage ${sid} is still running "${cur.event_name}". End it first.`, "err");
      }
    }

    const delay = Math.max(0, Math.round((KL.now() - KL.atTime(ev.date, ev.start_time)) / 60000));
    const stageDesc = targetStageIds.length > 1 ? `Stages ${targetStageIds.join(' & ')}` : `Stage ${targetStageIds[0]}`;

    run(d => {
      if (d.completed_events.map(String).includes(String(ev.event_id))) throw new Error("This event is already marked finished.");
      
      const payload = {
        status: "ongoing",
        event_id: ev.event_id,
        event_name: ev.event_name,
        categories: KL.cats(ev),
        scheduled_start: ev.start_time,
        actual_start: KL.nowISO(),
        delay_minutes: delay,
        combined_stages: targetStageIds.length > 1 ? targetStageIds : null
      };

      targetStageIds.forEach(sid => {
        d.stages[sid] = { ...payload };
      });

      pushTicker(d, `${stageDesc}: ${ev.event_name} has started${delay > 5 ? ` (${delay} min late)` : ""}`);
    }, `${stageDesc} start: event ${ev.event_id}`, `${stageDesc} is now live.`);
  }

  function endEvent(sid, ranks) {
    run(d => {
      const st = d.stages[sid];
      if (!st || st.status !== "ongoing") throw new Error(`Stage ${sid} has no running event.`);
      const eventId = st.event_id, name = st.event_name, cats = st.categories;
      const combined = st.combined_stages || [sid];

      if (!d.completed_events.map(String).includes(String(eventId))) d.completed_events.push(eventId);
      
      if (ranks) {
        d.recent_results.unshift({ 
          event_id: eventId, 
          event_name: name, 
          stage_id: combined.length > 1 ? combined.join(', ') : sid, 
          categories: cats,
          announced_at: KL.nowISO(), 
          first: ranks.first, 
          second: ranks.second, 
          third: ranks.third 
        });
        trimList(d.recent_results, C.maxResultsStored);
        const parts = [["1st", ranks.first], ["2nd", ranks.second], ["3rd", ranks.third]].filter(p => p[1]).map(p => `${p[0]} ${p[1]}`);
        pushTicker(d, `Results, Stage ${sid}, ${name}: ${parts.join(", ")}`);
      } else {
        pushTicker(d, `Stage ${sid}: ${name} has finished`);
      }

      combined.forEach(s => {
        d.stages[s] = idleStage();
      });
    }, `Stage ${sid} end`, ranks ? "Event finished and results announced." : "Event finished.");
  }

  const cancelStart = sid => run(d => {
    const st = d.stages[sid];
    const combined = (st && st.combined_stages) || [sid];
    combined.forEach(s => { d.stages[s] = idleStage(); });
  }, `Stage ${sid} start cancelled`, `Stage(s) reset to idle.`);

  const reopenEvent = id => run(d => { d.completed_events = d.completed_events.filter(x => String(x) !== String(id)); },
                                 `Reopen event ${id}`, "Event moved back to pending.");

  function updateResult(index, ranks) {
    run(d => {
      if (!d.recent_results || !d.recent_results[index]) throw new Error("Result item not found.");
      d.recent_results[index].first = ranks.first;
      d.recent_results[index].second = ranks.second;
      d.recent_results[index].third = ranks.third;
      pushTicker(d, `Updated Result: ${d.recent_results[index].event_name} -> 1st: ${ranks.first || "—"}, 2nd: ${ranks.second || "—"}, 3rd: ${ranks.third || "—"}`);
    }, `Update result ${index}`, "Result updated successfully.");
  }

  /* ---------- rendering ---------- */
  function renderProgressCards(day) {
    const wrap = $("dayProgress");
    if (!wrap) return;

    const effSchedule = getEffectiveSchedule();
    const dayEvents = effSchedule.filter(e => e.date === day);
    if (!dayEvents.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const doneSet = new Set((S.data.completed_events || []).map(String));
    const ongoingStages = Object.values(S.data.stages || {}).filter(st => st.status === "ongoing" && st.event_id);
    const ongoingEventIds = new Set(ongoingStages.map(st => String(st.event_id)));

    const completed = dayEvents.filter(e => doneSet.has(String(e.event_id)));
    const ongoing = dayEvents.filter(e => ongoingEventIds.has(String(e.event_id)));
    const pending = dayEvents.filter(e => !doneSet.has(String(e.event_id)) && !ongoingEventIds.has(String(e.event_id)));

    let onTimeCount = 0;
    let delayedCount = 0;
    const now = KL.now();

    const processedOngoingIds = new Set();
    ongoingStages.forEach(st => {
      if (processedOngoingIds.has(String(st.event_id))) return;
      processedOngoingIds.add(String(st.event_id));
      if ((st.delay_minutes || 0) <= 5) onTimeCount++;
      else delayedCount++;
    });

    pending.forEach(e => {
      const sched = KL.atTime(e.date, e.start_time);
      const diffMins = Math.floor((now - sched) / 60000);
      if (diffMins > 5) delayedCount++;
    });

    $("statTotal").textContent = dayEvents.length;
    $("statCompleted").textContent = completed.length;
    $("statOngoing").textContent = ongoing.length;
    $("statPending").textContent = pending.length;
    $("statOnTime").textContent = onTimeCount;
    $("statDelayed").textContent = delayedCount;
  }

  function eventItem(ev, st) {
    const running = st.status === "ongoing" && String(st.event_id) === String(ev.event_id);
    const blocked = st.status === "ongoing" && !running;
    const due = Math.floor((KL.now() - KL.atTime(ev.date, ev.start_time)) / 60000);
    const note = running
      ? `Running since ${KL.fmtTime(st.actual_start)}${st.delay_minutes > 0 ? `, started ${st.delay_minutes} min late` : ""}`
      : due > 0 ? `Due ${due} min ago` : "";
    
    const targetStageIds = parseStageIds(ev.stage_id);
    const isCombined = targetStageIds.length > 1;
    const combinedBadge = isCombined ? `<span class="chip" style="background:var(--gold-700)">വേദി ${targetStageIds.join(' & ')} (സംയുക്തം)</span>` : "";
    const isOverridden = ev._overridden ? `<span class="chip" style="background:#b3261e">ഷെഡ്യൂൾ തിരുത്തിയത്</span>` : "";

    const chips = KL.cats(ev).map(c => `<span class="chip">${esc(c)}</span>`).join("");
    return `<li class="ev ${running ? "is-live" : ""}">
      <div class="ev-time">${KL.fmtHHMM(ev.start_time)}</div>
      <div class="ev-main">
        <p class="ev-name" lang="ml">${esc(ev.event_name)}</p>
        <div class="chips">${chips}${combinedBadge}${isOverridden}</div>
        ${note ? `<p class="ev-note ${running ? "" : "is-due"}">${esc(note)}</p>` : ""}
        <div style="margin-top:0.35rem; display:flex; gap:0.8rem; align-items:center;">
          ${running ? `<button class="link act" data-act="cancel" data-stage="${S.selected}">Started by mistake? Reset stage</button>` : ""}
          ${!running ? `<button class="link act" data-act="edit-sched" data-id="${esc(ev.event_id)}">✏️ ഷെഡ്യൂൾ മാറ്റുക</button>` : ""}
        </div>
      </div>
      <div class="ev-actions">
        <button class="btn btn-start act" data-act="start" data-id="${esc(ev.event_id)}" ${running || blocked ? "disabled" : ""}>Start</button>
        <button class="btn btn-end act" data-act="end" data-stage="${S.selected}" ${running ? "" : "disabled"}>End</button>
      </div></li>`;
  }

  let currentEditEventId = null;

  function openEditScheduleModal(eventId) {
    const ev = findEvent(eventId);
    if (!ev) return;
    currentEditEventId = eventId;
    
    const overrides = (S.data && S.data.schedule_overrides) || {};
    const ov = overrides[String(eventId)] || {};

    const catsText = KL.cats(ev).length ? ` (${KL.cats(ev).join(', ')})` : "";
    $("editSchedEventName").textContent = `${ev.event_name}${catsText}`;
    $("editSchedTime").value = (ov.start_time || ev.start_time || "09:00").slice(0, 5);
    
    const stageSelect = $("editSchedStage");
    if (stageSelect) {
      stageSelect.innerHTML = S.stages.map(s => 
        `<option value="${s.stage_id}">${s.stage_id}. ${s.stage_name}</option>`
      ).join("");
      stageSelect.value = String(ov.stage_id || ev.stage_id).split(',')[0].trim();
    }
    $("editSchedStatus").value = ov.status || 'active';

    $("editScheduleModal").showModal();
  }

  function renderResultsEditor() {
    const list = $("editResultsList");
    if (!list) return;
    const results = S.data.recent_results || [];
    if (!results.length) {
      list.innerHTML = `<li class="muted">No results announced yet.</li>`;
      return;
    }
    list.innerHTML = results.map((r, idx) => {
      return `<li>
        <div>
          <span lang="ml" style="font-weight:700;">${esc(r.event_name)}</span> (Stage ${esc(r.stage_id)})<br>
          <span class="muted" style="font-size:0.9rem">1st: ${esc(r.first || '—')}, 2nd: ${esc(r.second || '—')}, 3rd: ${esc(r.third || '—')}</span>
        </div>
        <button class="btn btn-ghost act" style="min-height:2.2rem; padding:0 0.75rem; font-size:0.95rem;" data-act="edit-result" data-idx="${idx}">Edit</button>
      </li>`;
    }).join("");
  }

  function getEventsForStage(schedule, day, stageId) {
    const sId = Number(stageId);
    return schedule.filter(e => {
      if (e.date !== day) return false;
      const sids = parseStageIds(e.stage_id);
      return sids.includes(sId);
    });
  }

  function render() {
    if (!S.data) return;
    const day = KL.today();
    $("adminDate").textContent = KL.fmtLongDate(KL.now());
    $("testChip").hidden = !KL.testMode;
    const bn = S.data.banner;
    $("bannerState").textContent = bn && bn.active && bn.text ? `Showing: ${bn.text}` : "No banner is showing.";

    renderProgressCards(day);
    renderResultsEditor();

    const effSchedule = getEffectiveSchedule();

    const visible = S.stages.filter(s => {
      const evs = getEventsForStage(effSchedule, day, s.stage_id);
      const isLive = S.data.stages[s.stage_id] && S.data.stages[s.stage_id].status === "ongoing";
      return evs.length > 0 || isLive;
    });

    if (!visible.length) {
      $("chips").innerHTML = ""; $("stageHead").innerHTML = ""; $("eventList").innerHTML = "";
      $("finishedWrap").hidden = true; $("emptyState").hidden = false;
      $("emptyState").textContent = `No events are scheduled for ${day}. Festival days are ${C.festivalDates.join(", ")}. Add ?date=YYYY-MM-DD to the address to test another day.`;
      return;
    }
    if (!visible.some(s => s.stage_id === S.selected)) S.selected = visible[0].stage_id;

    const now = KL.now();
    $("chips").innerHTML = visible.map(s => {
      const st = S.data.stages[s.stage_id];
      const live = st && st.status === "ongoing";
      let idleAlert = false;
      if (st && st.status === "idle" && st.idle_since) {
        const idleMins = Math.floor((now - new Date(st.idle_since)) / 60000);
        if (idleMins >= 10) idleAlert = true;
      }
      return `<button class="stage-chip ${live ? "is-live" : ""} ${idleAlert ? "is-idle-alert" : ""}" 
        data-chip="${s.stage_id}" aria-pressed="${s.stage_id === S.selected}"
        aria-label="Stage ${s.stage_id}${live ? ", live" : ""}${idleAlert ? ", idle over 10 min" : ""}">${s.stage_id}</button>`;
    }).join("");

    const stage = visible.find(s => s.stage_id === S.selected);
    const st = S.data.stages[stage.stage_id] || idleStage();
    const done = new Set((S.data.completed_events || []).map(String));
    const todays = getEventsForStage(effSchedule, day, stage.stage_id);
    const pending = todays.filter(e => !done.has(String(e.event_id)));
    const finished = todays.filter(e => done.has(String(e.event_id)));

    let idleNotice = "";
    if (st.status === "idle" && st.idle_since) {
      const idleMins = Math.floor((now - new Date(st.idle_since)) / 60000);
      if (idleMins >= 10 && pending.length > 0) {
        idleNotice = `<div class="idle-warning">⚠️ ഈ വേദി ഒഴിഞ്ഞുകിടക്കാൻ തുടങ്ങിയിട്ട് ${idleMins} മിനിറ്റ് കഴിഞ്ഞു. അടുത്ത പ്രോഗ്രാം ആരംഭിക്കുക.</div>`;
      }
    }

    $("stageHead").innerHTML = `<h2>${esc(stage.stage_name)}</h2><p>${esc(stage.venue_location)}</p>${idleNotice}`;
    $("eventList").innerHTML = pending.map(e => eventItem(e, st)).join("");
    $("emptyState").hidden = pending.length > 0;
    $("emptyState").textContent = "Every event on this stage is finished.";

    $("finishedWrap").hidden = !finished.length;
    $("finishedCount").textContent = finished.length;
    $("finishedList").innerHTML = finished.map(e => `<li><span lang="ml">${esc(e.event_name)}</span>
      <button class="link act" data-act="reopen" data-id="${esc(e.event_id)}">Move back to pending</button></li>`).join("");
  }

  /* ---------- events ---------- */
  function openEndModal(sid) {
    const st = S.data.stages[sid] || {};
    S.endStage = sid;
    const combined = st.combined_stages || [sid];
    $("endTitle").textContent = combined.length > 1 ? `End Stages ${combined.join(' & ')}` : `End Stage ${sid}`;
    $("endEvent").textContent = st.event_name || "";
    ["rank1", "rank2", "rank3"].forEach(id => ($(id).value = ""));
    $("endModal").showModal();
    $("rank1").focus();
  }

  function openEditResultModal(idx) {
    const r = S.data.recent_results[idx];
    if (!r) return;
    S.editResultIdx = idx;
    $("editResultEvent").textContent = `${r.event_name} (Stage ${r.stage_id})`;
    $("editRank1").value = r.first || "";
    $("editRank2").value = r.second || "";
    $("editRank3").value = r.third || "";
    $("editResultModal").showModal();
  }

  document.addEventListener("click", e => {
    const chip = e.target.closest("[data-chip]");
    if (chip) { 
      S.selected = Number(chip.dataset.chip); 
      sessionStorage.setItem("kl_stage", S.selected); 
      render(); 
      return; 
    }
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled || S.busy) return;
    const { act, id, stage, idx } = btn.dataset;
    if (act === "start") startEvent(id);
    else if (act === "end") openEndModal(Number(stage));
    else if (act === "cancel" && confirm(`Reset Stage ${stage} to idle? The start notice stays in the ticker.`)) cancelStart(Number(stage));
    else if (act === "reopen") reopenEvent(id);
    else if (act === "edit-result") openEditResultModal(Number(idx));
    else if (act === "edit-sched") openEditScheduleModal(id);
  });

  $("endForm").addEventListener("submit", e => {
    e.preventDefault();
    const ranks = { first: $("rank1").value.trim(), second: $("rank2").value.trim(), third: $("rank3").value.trim() };
    $("endModal").close();
    endEvent(S.endStage, ranks.first || ranks.second || ranks.third ? ranks : null);
  });
  $("skipResults").addEventListener("click", () => { $("endModal").close(); endEvent(S.endStage, null); });
  $("cancelEnd").addEventListener("click", () => $("endModal").close());

  $("editResultForm").addEventListener("submit", e => {
    e.preventDefault();
    const ranks = { first: $("editRank1").value.trim(), second: $("editRank2").value.trim(), third: $("editRank3").value.trim() };
    $("editResultModal").close();
    if (S.editResultIdx !== null) updateResult(S.editResultIdx, ranks);
  });
  $("cancelEditResult").addEventListener("click", () => $("editResultModal").close());

  $("editScheduleForm").addEventListener("submit", e => {
    e.preventDefault();
    const newTime = $("editSchedTime").value;
    const newStage = $("editSchedStage").value;
    const newStatus = $("editSchedStatus").value;

    $("editScheduleModal").close();

    const formattedTime = newTime ? (newTime.length === 5 ? `${newTime}:00` : newTime) : undefined;

    run(d => {
      if (!d.schedule_overrides) d.schedule_overrides = {};
      d.schedule_overrides[String(currentEditEventId)] = {
        start_time: formattedTime,
        stage_id: newStage,
        status: newStatus,
        updated_at: KL.nowISO()
      };
      const ev = findEvent(currentEditEventId);
      const evName = ev ? ev.event_name : currentEditEventId;
      pushTicker(d, `ഷെഡ്യൂൾ മാറ്റം: ${evName} വേദി ${newStage}-ലേക്ക് (${KL.fmtHHMM(newTime)}) പുനഃക്രമീകരിച്ചു`);
    }, `Reschedule event ${currentEditEventId}`, "ഷെഡ്യൂൾ വിജയകരമായി തിരുത്തി.");
  });

  $("cancelEditSched").addEventListener("click", () => $("editScheduleModal").close());

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