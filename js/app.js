/* Kalolsavam Live — public viewer. Polls data.json and redraws the page. */
(() => {
  const C = KL.CONFIG, esc = KL.esc;
  const $ = id => document.getElementById(id);
  const S = { 
    stages: [], schedule: [], data: null, lastOk: null, online: true, 
    tickerKey: "", animate: true, activeModalStageId: null, currentFilter: "all" 
  };
  const stageIds = () => S.stages.map(s => s.stage_id);

  function parseStageIds(stg) {
    if (Array.isArray(stg)) return stg.map(Number);
    return String(stg || '').split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
  }

  // data.json-ൽ നിന്നുള്ള schedule_overrides മാസ്റ്റർ ഷെഡ്യൂളിലേക്ക് മെർജ് ചെയ്യുന്നു
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

  function getEventsForStage(day, stageId) {
    const sId = Number(stageId);
    return getEffectiveSchedule().filter(e => {
      if (e.date !== day) return false;
      return parseStageIds(e.stage_id).includes(sId);
    });
  }

  /* ---------- Comprehensive English & Manglish Alias Dictionary ---------- */
  const ALIAS_MAP = {
    'ഗിറ്റാർ': ['guitar', 'gitar', 'gittar'],
    'വയലിൻ': ['violin', 'vayalin'],
    'ബാന്റ്': ['band', 'baant', 'bandmelam'],
    'ക്ലാർനെറ്റ്': ['clarinet'],
    'ബ്യൂഗിൾ': ['bugle'],
    'ജാസ്': ['jazz'],
    'ട്രിപ്പിൾ': ['triple'],
    'പെൻസിൽ': ['pencil', 'pensil'],
    'ഓയിൽ കളർ': ['oil color', 'oil colour'],
    'ജലഛായം': ['watercolor', 'water colour'],
    'കാർട്ടൂൺ': ['cartoon'],
    'കൊളാഷ്': ['collage'],
    'മിമിക്രി': ['mimicry', 'mimicri'],
    'മോണോ ആക്ട്': ['monoact', 'mono act'],
    'മൂകാഭിനയം': ['mime', 'mookabhinayam'],
    'സ്കിറ്റ്': ['skit'],
    'നാടകം': ['drama', 'play', 'nadakam', 'natakam'],
    'പ്രശ്നോത്തരി': ['quiz', 'prashnothari'],
    'പ്രസംഗം': ['speech', 'elocution', 'prasangam'],
    'ഉപന്യാസം': ['essay', 'upanyasam'],
    'കഥാരചന': ['story writing', 'katharachana', 'kadharachana', 'story'],
    'കവിതാരചന': ['poem writing', 'poetry', 'kavitharachana'],
    'പദ്യംചൊല്ലൽ': ['recitation', 'poem recitation', 'padyamchollal'],
    'ചിത്രരചന': ['drawing', 'painting', 'chithrarachana', 'chitrarachana'],
    'ലളിതഗാനം': ['light music', 'lalithaganam'],
    'ശാസ്ത്രീയ സംഗീതം': ['classical music', 'carnatic', 'shastriya sangeetham'],
    'ദേശഭക്തിഗാനം': ['patriotic song', 'deshabhakthiganam'],
    'മാപ്പിളപ്പാട്ട്': ['mappilapattu', 'mappilappattu', 'mappila'],
    'വന്ദേമാതരം': ['vande mataram', 'vandematharam'],
    'സംഘഗാനം': ['group song', 'sanghaganam'],
    'സംഘ ഗാനം': ['group song', 'sangha ganam'],
    'സംഘനൃത്തം': ['group dance', 'sanghanrutham'],
    'സംഘ നൃത്തം': ['group dance', 'sangha nrutham'],
    'ഓടക്കുഴൽ': ['flute', 'odakkuzhal'],
    'തബല': ['tabla'],
    'വീണ': ['veena'],
    'മൃദംഗം': ['mridangam', 'mrudangam'],
    'കടങ്കഥ': ['riddle', 'kadankadha'],
    'കുച്ചുപ്പുടി': ['kuchipudi', 'kuchuppudi'],
    'ഓട്ടൻ തുള്ളൽ': ['ottanthullal', 'ottan thullal', 'thullal'],
    'വെസ്റ്റേൺ': ['western'],
    'പൗരസ്ത്യം': ['oriental', 'eastern'],
    'പാശ്ചാത്യം': ['western'],
    'നൃത്തം': ['dance', 'nritham', 'nrutham'],
    'നടനം': ['dance', 'nadanam'],
    'കളി': ['kali'],
    'ഗാനം': ['song', 'music', 'ganam'],
    'സംഗീതം': ['song', 'music', 'sangeetham'],
    'പാട്ട്': ['song', 'pattu'],
    'ആലാപനം': ['singing', 'song', 'alapanam'],
    'ചവിട്ടുനാടകം': ['chavittu', 'chavittunadakam'],
    'തിരുവാതിര': ['thiruvathira'],
    'മാർഗ്ഗംകളി': ['margamkali', 'margam kali'],
    'പരിചമുട്ട്': ['parichamuttu'],
    'പൂരക്കളി': ['poorakkali'],
    'കോൽക്കളി': ['kolkali'],
    'ചെണ്ട': ['chenda', 'chendamelam'],
    'തായമ്പക': ['thayambaka', 'thayambakam']
  };

  const CONSONANTS = {
    0x0D15: 'k', 0x0D16: 'kh', 0x0D17: 'g', 0x0D18: 'gh', 0x0D19: 'ng',
    0x0D1A: 'ch', 0x0D1B: 'chh', 0x0D1C: 'j', 0x0D1D: 'jh', 0x0D1E: 'nj',
    0x0D1F: 't', 0x0D20: 'th', 0x0D21: 'd', 0x0D22: 'dh', 0x0D23: 'n',
    0x0D24: 'th', 0x0D25: 'th', 0x0D26: 'd', 0x0D27: 'dh', 0x0D28: 'n',
    0x0D2A: 'p', 0x0D2B: 'ph', 0x0D2C: 'b', 0x0D2D: 'bh', 0x0D2E: 'm',
    0x0D2F: 'y', 0x0D30: 'r', 0x0D31: 'r', 0x0D32: 'l', 0x0D33: 'l',
    0x0D34: 'zh', 0x0D35: 'v', 0x0D36: 'sh', 0x0D37: 'sh', 0x0D38: 's', 0x0D39: 'h',
    0x0D29: 'n', 0x0D3A: 'tt'
  };

  const VOWELS = {
    0x0D05: 'a', 0x0D06: 'aa', 0x0D07: 'i', 0x0D08: 'ee', 0x0D09: 'u', 0x0D0A: 'oo',
    0x0D0B: 'ri', 0x0D0E: 'e', 0x0D0F: 'e', 0x0D10: 'ai', 0x0D12: 'o', 0x0D13: 'o', 0x0D14: 'au'
  };

  const MATRAS = {
    0x0D3E: 'a', 0x0D3F: 'i', 0x0D40: 'ee', 0x0D41: 'u', 0x0D42: 'oo',
    0x0D43: 'ri', 0x0D46: 'e', 0x0D47: 'e', 0x0D48: 'ai', 0x0D4A: 'o',
    0x0D4B: 'o', 0x0D4C: 'au'
  };

  const CHILLUS = {
    0x0D7A: 'nn', 0x0D7B: 'n', 0x0D7C: 'r', 0x0D7D: 'l', 0x0D7E: 'l', 0x0D7F: 'k'
  };

  function cleanMl(text) {
    return (text || '').replace(/[\u200C\u200D]/g, '').trim();
  }

  function toManglish(text) {
    if (!text) return "";
    let clean = cleanMl(text);
    let out = [];
    const n = clean.length;
    let i = 0;
    while (i < n) {
      const code = clean.charCodeAt(i);
      if (code === 0x0D02) { out.push('m'); i++; continue; }
      if (code === 0x0D03) { out.push('h'); i++; continue; }
      if (VOWELS[code]) { out.push(VOWELS[code]); i++; continue; }
      if (CHILLUS[code]) { out.push(CHILLUS[code]); i++; continue; }

      if (code === 0x0D31 && i + 2 < n && clean.charCodeAt(i + 1) === 0x0D4D && clean.charCodeAt(i + 2) === 0x0D31) {
        let vowel = "a";
        let advance = 3;
        if (i + 3 < n && MATRAS[clean.charCodeAt(i + 3)]) {
          vowel = MATRAS[clean.charCodeAt(i + 3)];
          advance = 4;
        } else if (i + 3 < n && clean.charCodeAt(i + 3) === 0x0D4D) {
          vowel = "";
          advance = 4;
        }
        out.push('tt' + vowel);
        i += advance;
        continue;
      }

      if (code === 0x0D28 && i + 2 < n && clean.charCodeAt(i + 1) === 0x0D4D && clean.charCodeAt(i + 2) === 0x0D31) {
        let vowel = "a";
        let advance = 3;
        if (i + 3 < n && MATRAS[clean.charCodeAt(i + 3)]) {
          vowel = MATRAS[clean.charCodeAt(i + 3)];
          advance = 4;
        }
        out.push('nt' + vowel);
        i += advance;
        continue;
      }

      if (CONSONANTS[code]) {
        const c = CONSONANTS[code];
        if (i + 1 < n) {
          const next = clean.charCodeAt(i + 1);
          if (next === 0x0D4D) {
            out.push(c);
            i += 2;
            continue;
          } else if (MATRAS[next]) {
            out.push(c + MATRAS[next]);
            i += 2;
            continue;
          }
        }
        out.push(c + 'a');
        i++;
        continue;
      }
      out.push(clean[i]);
      i++;
    }
    return out.join('').toLowerCase();
  }

  function normalizeFuzzy(str) {
    return (str || '')
      .toLowerCase()
      .replace(/[\u200C\u200D]/g, '')
      .replace(/dh/g, 'th').replace(/d/g, 't')
      .replace(/bh/g, 'b').replace(/ph/g, 'p')
      .replace(/kh/g, 'k').replace(/gh/g, 'g')
      .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a')
      .replace(/nd/g, 'nt').replace(/mb/g, 'mp')
      .replace(/sh/g, 's').replace(/w/g, 'v')
      .replace(/th/g, 't')
      .replace(/[^a-z0-9]/g, '')
      .replace(/([a-z])\1+/g, '$1');
  }

  function buildSearchIndex() {
    const eff = getEffectiveSchedule();
    eff.forEach(ev => {
      const ml = cleanMl(ev.event_name || "");
      const mang = toManglish(ml);
      const catStr = Array.isArray(ev.categories) ? ev.categories.join(" ") : (ev.category || "");

      const aliases = [];
      for (const [mlTerm, engList] of Object.entries(ALIAS_MAP)) {
        if (ml.includes(cleanMl(mlTerm))) {
          aliases.push(...engList);
        }
      }

      const allTokens = [ml.toLowerCase(), mang.toLowerCase(), catStr.toLowerCase(), ...aliases.map(a => a.toLowerCase())];
      const fullText = allTokens.join(" ");
      const fuzzyTokens = allTokens.map(normalizeFuzzy).filter(Boolean);

      ev._search = {
        fullText: fullText,
        fuzzyTokens: fuzzyTokens
      };
    });
  }

  function getStageMeta(stageId) {
    const sids = parseStageIds(stageId);
    if (!sids.length) return { name: `വേദി ${stageId}`, venue: "" };
    const stg = S.stages.find(s => s.stage_id === sids[0]);
    if (sids.length > 1) {
      return {
        name: `വേദി ${sids.join(' & ')}`,
        venue: stg ? `${stg.venue_location} (സംയുക്തം)` : ""
      };
    }
    return {
      name: stg ? stg.stage_name : `വേദി ${sids[0]}`,
      venue: stg ? stg.venue_location : ""
    };
  }

  /* ---------- data ---------- */
  async function fetchLive() {
    const t = Date.now();
    try {
      return await KL.fetchJson(`${KL.rawUrl()}?t=${t}`, { cache: "no-store" });
    } catch (err) {
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
    buildSearchIndex();
    render();
    if (S.activeModalStageId !== null) {
      updateStageModal(S.activeModalStageId);
    }
  }

  /* ---------- per-stage status ---------- */
  function stageView(stage) {
    const id = stage.stage_id;
    const st = (S.data && S.data.stages && S.data.stages[id]) || {};
    const day = KL.today();
    const todays = getEventsForStage(day, id);
    const done = new Set((S.data && S.data.completed_events ? S.data.completed_events : []).map(String));
    const base = { mode: "none", doneCount: todays.filter(e => done.has(String(e.event_id))).length, total: todays.length };

    if (st.status === "ongoing") {
      const ev = getEffectiveSchedule().find(e => String(e.event_id) === String(st.event_id));
      const started = new Date(st.actual_start);
      const schedHHMM = st.scheduled_start || (ev && ev.start_time) || null;
      const sched = schedHHMM ? KL.atTime(ev ? ev.date : day, schedHHMM) : null;
      const delay = sched && !isNaN(started) ? Math.round((started - sched) / 60000) : (st.delay_minutes || 0);
      return { 
        ...base, 
        mode: "live", 
        name: st.event_name || (ev && ev.event_name) || "Event in progress",
        cats: st.categories && st.categories.length ? st.categories : KL.cats(ev),
        sched: schedHHMM, 
        started: isNaN(started) ? null : started, 
        delay,
        combined: st.combined_stages || (ev ? parseStageIds(ev.stage_id) : null)
      };
    }

    const next = todays.find(e => !done.has(String(e.event_id)));
    if (next) {
      const sched = KL.atTime(next.date, next.start_time);
      return { 
        ...base, 
        mode: "next", 
        name: next.event_name, 
        cats: KL.cats(next), 
        sched: next.start_time,
        delay: Math.max(0, Math.floor((KL.now() - sched) / 60000)),
        combined: parseStageIds(next.stage_id)
      };
    }
    return { ...base, mode: todays.length ? "done" : "none" };
  }

  const delayClass = m => (m <= 5 ? "ok" : m <= 20 ? "warn" : "bad");

  function directions(s) {
    const map = s.is_external && s.map_url
      ? `<a class="map-btn" href="${esc(s.map_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open in Google Maps</a>` : "";
    const route = s.route_guide ? `<p class="route">${esc(s.route_guide)}</p>` : "";
    return map || route ? `<footer class="stage-foot">${map}${route}</footer>` : "";
  }

  function stageCard(s, i) {
    const v = stageView(s);
    const label = { live: "Live now", next: "Up next", done: "Finished for today", none: "No events today" }[v.mode];
    let body = "", pill = "";

    const combinedNotice = v.combined && v.combined.length > 1
      ? `<span class="chip" style="background:var(--maroon-600)">👥 വേദി ${v.combined.join(' & ')} സംയുക്തം</span>`
      : "";

    if (v.mode === "live" || v.mode === "next") {
      const chips = (v.cats || []).map(c => `<span class="chip">${esc(c)}</span>`).join("");
      body += `<p class="event-name" lang="ml">${esc(v.name)}</p><div class="chips">${chips}${combinedNotice}</div>`;
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
    const aos = S.animate ? ` data-aos="fade-up" data-aos-delay="${(i % 3) * 90}"` : "";
    return `<article class="stage-card is-${v.mode} is-clickable" data-stage-id="${esc(s.stage_id)}"${aos} role="button" tabindex="0" aria-label="View schedule and results for Stage ${esc(s.stage_id)}">
      <header class="stage-head">
        <span class="stage-no" aria-label="Stage ${s.stage_id}">${s.stage_id}</span>
        <div class="stage-title"><h3>${esc(s.stage_name)}</h3><p>${esc(s.venue_location)}</p></div>
      </header>
      <div class="stage-body">
        <div class="stage-status-row">
          <span class="status status-${v.mode}">${label}</span>
          <span class="view-detail-hint">Details &rsaquo;</span>
        </div>
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
    if (key === S.tickerKey) return;
    S.tickerKey = key;
    const html = text.map(t => `<span class="tick">${esc(t)}</span>`).join("");
    const chars = text.join("").length;
    const track = $("tickerTrack");
    if (track) {
      track.style.setProperty("--dur", `${Math.max(30, Math.round(chars * 0.22))}s`);
      track.innerHTML = html;
    }
  }

  function renderMeta() {
    const idx = C.festivalDates.indexOf(KL.today());
    const day = KL.fmtLongDate(KL.now());
    $("dayLabel").textContent = idx >= 0 ? `${day}, day ${idx + 1} of ${C.festivalDates.length}` : day;
    const sync = $("syncState");
    const offlineBar = $("offlineBar");

    if (S.online && S.lastOk) { 
      sync.textContent = `Updated ${KL.fmtTime(S.lastOk)}`; 
      sync.className = "sync";
      if (offlineBar) offlineBar.hidden = true;
    } else if (!S.online) { 
      sync.textContent = "Offline (retrying…)"; 
      sync.className = "sync is-off";
      if (offlineBar) offlineBar.hidden = false;
    }
    $("testChip").hidden = !KL.testMode;
  }

  /* ---------- Live Search Component ---------- */
  function initSearch() {
    const input = $("eventSearchInput");
    const drop = $("searchResults");
    const list = $("searchResultsList");
    const clearBtn = $("clearSearchBtn");
    if (!input || !drop || !list) return;

    function doSearch() {
      const q = input.value.trim();
      if (!q) {
        drop.hidden = true;
        if (clearBtn) clearBtn.hidden = true;
        list.innerHTML = "";
        return;
      }
      if (clearBtn) clearBtn.hidden = false;
      const qWords = q.toLowerCase().split(/\s+/).filter(Boolean);

      const eff = getEffectiveSchedule();
      const matches = eff.filter(ev => {
        const s = ev._search;
        if (!s) return false;
        return qWords.every(word => {
          if (s.fullText.includes(word)) return true;
          const wFuzz = normalizeFuzzy(word);
          if (wFuzz.length >= 2) {
            return s.fuzzyTokens.some(ft => ft.includes(wFuzz));
          }
          return false;
        });
      });

      if (!matches.length) {
        list.innerHTML = `<li class="search-item search-empty">No events found matching "${esc(q)}".</li>`;
        drop.hidden = false;
        return;
      }

      list.innerHTML = matches.slice(0, 15).map(ev => {
        const stg = getStageMeta(ev.stage_id);
        const cats = KL.cats(ev).map(c => `<span class="chip">${esc(c)}</span>`).join("");
        const dateStr = KL.fmtLongDate(new Date(ev.date));
        const timeStr = KL.fmtHHMM(ev.start_time);
        const sids = parseStageIds(ev.stage_id);
        const firstSid = sids[0] || 1;

        return `<li class="search-item" data-stage-id="${esc(firstSid)}" role="option">
          <div class="search-item-main">
            <span class="search-item-name" lang="ml">${esc(ev.event_name)}</span>
            <div class="chips">${cats}</div>
          </div>
          <div class="search-item-meta">
            <div class="search-meta-pill">📅 ${esc(dateStr)}</div>
            <div class="search-meta-pill">⏰ ${esc(timeStr)}</div>
            <div class="search-meta-pill stage-pill">📍 ${esc(stg.name)}${stg.venue ? ` (${esc(stg.venue)})` : ''}</div>
          </div>
        </li>`;
      }).join("");

      drop.hidden = false;
    }

    input.addEventListener("input", doSearch);
    input.addEventListener("focus", () => { if (input.value.trim()) doSearch(); });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        drop.hidden = true;
        clearBtn.hidden = true;
        input.focus();
      });
    }

    list.addEventListener("click", e => {
      const item = e.target.closest(".search-item[data-stage-id]");
      if (item) {
        const sid = item.dataset.stageId;
        drop.hidden = true;
        openStageModal(sid);
      }
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".search-box-wrap")) {
        drop.hidden = true;
      }
    });
  }

  /* ---------- Stage Schedule & Results Modal ---------- */
  function findResultForEvent(stageId, ev) {
    const results = S.data.recent_results || [];
    return results.find(r => 
      String(r.stage_id).includes(String(stageId)) && 
      ( (r.event_id && String(r.event_id) === String(ev.event_id)) || (r.event_name && r.event_name === ev.event_name) )
    );
  }

  function openStageModal(stageId) {
    S.activeModalStageId = stageId;
    updateStageModal(stageId);
    const dlg = $("stageModal");
    if (dlg && typeof dlg.showModal === "function") dlg.showModal();
  }

  function updateStageModal(stageId) {
    const dlg = $("stageModal");
    if (!dlg) return;

    const stage = S.stages.find(s => String(s.stage_id) === String(stageId));
    if (!stage) return;

    const day = KL.today();
    const todays = getEventsForStage(day, stageId);
    const done = new Set((S.data && S.data.completed_events ? S.data.completed_events : []).map(String));
    const st = (S.data && S.data.stages && S.data.stages[stageId]) || {};
    const ongoingId = st.status === "ongoing" ? String(st.event_id) : null;

    $("modalStageTitle").textContent = `${stage.stage_name} — ${stage.venue_location}`;

    // 1. Ongoing Event
    let liveHtml = "";
    if (st.status === "ongoing") {
      const ev = todays.find(e => String(e.event_id) === ongoingId);
      const name = st.event_name || (ev && ev.event_name) || "Event in progress";
      const cats = st.categories && st.categories.length ? st.categories : KL.cats(ev);
      const chips = cats.map(c => `<span class="chip">${esc(c)}</span>`).join("");
      const startStr = st.actual_start ? `Started at ${KL.fmtTime(new Date(st.actual_start))}` : "Ongoing";
      const comb = st.combined_stages && st.combined_stages.length > 1
        ? `<span class="chip" style="background:var(--maroon-600)">👥 വേദി ${st.combined_stages.join(' & ')} സംയുക്തം</span>` : "";

      liveHtml = `
        <div class="modal-section live-section">
          <h4><span class="status-live"></span> Live Now</h4>
          <div class="modal-ev-item is-live">
            <span class="ev-name" lang="ml">${esc(name)}</span>
            <div class="chips">${chips}${comb}</div>
            <p class="times">${startStr}${st.scheduled_start ? ` (Scheduled: ${KL.fmtHHMM(st.scheduled_start)})` : ""}</p>
          </div>
        </div>`;
    }

    // 2. Upcoming Events
    const upcoming = todays.filter(e => !done.has(String(e.event_id)) && String(e.event_id) !== ongoingId);
    let upcomingHtml = "";
    if (upcoming.length) {
      upcomingHtml = `
        <div class="modal-section">
          <h4>Upcoming Events Today (${upcoming.length})</h4>
          <ul class="modal-ev-list">
            ${upcoming.map(e => {
              const chips = KL.cats(e).map(c => `<span class="chip">${esc(c)}</span>`).join("");
              const sids = parseStageIds(e.stage_id);
              const comb = sids.length > 1 ? `<span class="chip" style="background:var(--maroon-600)">വേദി ${sids.join(' & ')}</span>` : "";
              return `<li>
                <div class="ev-time-badge">${KL.fmtHHMM(e.start_time)}</div>
                <div class="ev-detail">
                  <span class="ev-name" lang="ml">${esc(e.event_name)}</span>
                  <div class="chips">${chips}${comb}</div>
                </div>
              </li>`;
            }).join("")}
          </ul>
        </div>`;
    } else {
      upcomingHtml = `
        <div class="modal-section">
          <h4>Upcoming Events Today</h4>
          <p class="muted">No upcoming events left for this stage today.</p>
        </div>`;
    }

    // 3. Completed Events & Results
    const completed = todays.filter(e => done.has(String(e.event_id)));
    let completedHtml = "";
    if (completed.length) {
      completedHtml = `
        <div class="modal-section">
          <h4>Completed Events (${completed.length})</h4>
          <ul class="modal-completed-list">
            ${completed.map(e => {
              const res = findResultForEvent(stageId, e);
              const chips = KL.cats(e).map(c => `<span class="chip">${esc(c)}</span>`).join("");
              let resHtml = `<p class="muted-small">Result awaited</p>`;
              if (res && (res.first || res.second || res.third)) {
                const badge = (lbl, val) => val ? `<span class="rank"><b>${lbl}:</b> ${esc(val)}</span>` : "";
                resHtml = `<div class="modal-ranks">
                  ${badge("1st", res.first)}
                  ${badge("2nd", res.second)}
                  ${badge("3rd", res.third)}
                </div>`;
              }
              return `<li>
                <div class="completed-head">
                  <span class="ev-name" lang="ml">${esc(e.event_name)}</span>
                  <div class="chips">${chips}</div>
                </div>
                ${resHtml}
              </li>`;
            }).join("")}
          </ul>
        </div>`;
    } else {
      completedHtml = `
        <div class="modal-section">
          <h4>Completed Events</h4>
          <p class="muted">No events completed yet on this stage today.</p>
        </div>`;
    }

    $("modalContent").innerHTML = liveHtml + upcomingHtml + completedHtml;
  }

  function initModal() {
    const dlg = $("stageModal");
    const closeBtn = $("closeModalBtn");
    if (!dlg) return;

    if (closeBtn) closeBtn.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => { S.activeModalStageId = null; });
    dlg.addEventListener("click", ev => {
      if (ev.target === dlg) dlg.close();
    });

    const grid = $("stageGrid");
    grid.addEventListener("click", ev => {
      const card = ev.target.closest(".stage-card");
      if (card && card.dataset.stageId) openStageModal(card.dataset.stageId);
    });

    grid.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        const card = ev.target.closest(".stage-card");
        if (card && card.dataset.stageId) {
          ev.preventDefault();
          openStageModal(card.dataset.stageId);
        }
      }
    });
  }

  /* ---------- Quick Filter Logic ---------- */
  function initFilters() {
    const bar = document.querySelector(".filter-bar");
    if (!bar) return;

    bar.addEventListener("click", e => {
      const chip = e.target.closest(".filter-chip");
      if (!chip) return;
      bar.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      S.currentFilter = chip.dataset.filter;
      renderStageGrid();
      updateAutoScrollButtonVisibility();
    });
  }

  function renderStageGrid() {
    const day = KL.today();
    const visible = S.stages.filter(s => {
      const evs = getEventsForStage(day, s.stage_id);
      const isLive = S.data.stages[s.stage_id] && S.data.stages[s.stage_id].status === "ongoing";
      return evs.length > 0 || isLive;
    });

    let filtered = visible;

    if (S.currentFilter === "live") {
      filtered = visible.filter(s => stageView(s).mode === "live");
    } else if (S.currentFilter !== "all") {
      filtered = visible.filter(s => {
        const v = stageView(s);
        return v.cats && v.cats.some(c => c.toUpperCase().includes(S.currentFilter.toUpperCase()));
      });
    }

    if (!visible.length) {
      $("stageGrid").innerHTML = `<p class="empty-day">No events are scheduled for today. Please check back on a festival day (${esc(C.festivalDatesText)}).</p>`;
    } else if (!filtered.length) {
      $("stageGrid").innerHTML = `<p class="empty-day">No stages matching the "${esc(S.currentFilter)}" filter right now.</p>`;
    } else {
      $("stageGrid").innerHTML = filtered.map(stageCard).join("");
    }
  }

  function updateAutoScrollButtonVisibility() {
    const btn = $("autoScrollBtn");
    if (!btn) return;
    const canScroll = (document.documentElement.scrollHeight - window.innerHeight) > 40;
    btn.hidden = !canScroll;
  }

  function render() {
    if (!S.data) return;
    renderBanner(); 
    renderResults(); 
    renderMeta(); 
    renderTicker();
    renderStageGrid();
    updateAutoScrollButtonVisibility();
  }

  /* ---------- scroll-reveal animations (AOS) ---------- */
  function startAOS() {
    if (window.AOS) {
      AOS.init({ duration: 700, easing: "ease-out-cubic", once: true, offset: 30, disable: () => KL.reduced });
    } else {
      document.querySelectorAll("[data-aos]").forEach(el => el.removeAttribute("data-aos"));
    }
  }

  /* ---------- idle auto-scroll through all stage cards (Fixed & Optimized) ---------- */
  function initAutoScroll() {
    const A = C.autoScroll || { speedPxPerSec: 28, startDelaySec: 4, resumeAfterIdleSec: 8, holdSec: 3 };
    const btn = $("autoScrollBtn");
    if (!btn) return;

    const saved = sessionStorage.getItem("kl_autoscroll");
    let enabled = saved ? saved === "on" : !KL.reduced;
    let phase = "idle", y = 0, holdUntil = 0, everTouched = false;
    let last = performance.now();
    let lastInput = performance.now();

    const maxY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const paint = () => {
      btn.setAttribute("aria-pressed", enabled);
      btn.textContent = `Auto-scroll: ${enabled ? "on" : "off"}`;
    };
    paint();

    btn.addEventListener("click", () => {
      enabled = !enabled;
      sessionStorage.setItem("kl_autoscroll", enabled ? "on" : "off");
      everTouched = false;
      lastInput = performance.now();
      phase = "idle";
      paint();
    });

    const markInteraction = () => {
      everTouched = true;
      lastInput = performance.now();
      phase = "idle";
    };

    ["wheel", "touchstart", "pointerdown", "keydown"].forEach(ev => {
      window.addEventListener(ev, markInteraction, { passive: true });
    });

    function frame(ts) {
      const dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      const maxScroll = maxY();
      const drop = $("searchResults");
      const searchOpen = drop && !drop.hidden;

      // Don't auto scroll if stage modal is active or search dropdown is open
      if (enabled && !document.hidden && maxScroll > 40 && !S.activeModalStageId && !searchOpen) {
        const wait = (everTouched ? (A.resumeAfterIdleSec || 8) : (A.startDelaySec || 4)) * 1000;
        
        if (phase === "idle" && (ts - lastInput) >= wait) {
          phase = "down";
          y = window.scrollY;
        }

        if (phase === "down") {
          y += (A.speedPxPerSec || 28) * dt;
          if (y >= maxScroll) {
            y = maxScroll;
            phase = "hold-bottom";
            holdUntil = ts + (A.holdSec || 3) * 1000;
          }
          window.scrollTo(0, y);
        } else if (phase === "hold-bottom" && ts >= holdUntil) {
          phase = "up";
        } else if (phase === "up") {
          y -= (A.speedPxPerSec || 28) * 5 * dt;
          if (y <= 0) {
            y = 0;
            phase = "hold-top";
            holdUntil = ts + (A.holdSec || 3) * 1000;
          }
          window.scrollTo(0, y);
        } else if (phase === "hold-top" && ts >= holdUntil) {
          phase = "down";
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
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

    buildSearchIndex();
    initSearch();
    initFilters();
    initModal();
    await poll();
    S.animate = false;
    setTimeout(startAOS, KL.splashMs);
    initAutoScroll();
    updateAutoScrollButtonVisibility();

    setInterval(() => { if (!document.hidden) poll(); }, C.pollSeconds * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    window.addEventListener("online", poll);
    window.addEventListener("offline", () => { S.online = false; renderMeta(); });
    window.addEventListener("resize", updateAutoScrollButtonVisibility);
  }

  init();
})();