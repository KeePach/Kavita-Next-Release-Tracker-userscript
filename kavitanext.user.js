// ==UserScript==
// @name         Kavita - Next Release Tracker (licensed series)
// @namespace    local.kavita.nextrelease
// @version      3.2.1
// @description  Finds licensed series using the MangaBaka database file, then tracks the next official volume: colored card frames, reminders, a next-volume card on the series page, and a calendar export.
// @include      http://localhost:5000/*
// @include      http://127.0.0.1:5000/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Tampermonkey's @match ignores port numbers, so double-check the port here.
  // If your Kavita uses a different port, change it here and in the two @include lines above.
  const KAVITA_PORTS = ['5000'];
  if (!KAVITA_PORTS.includes(location.port)) return;

  const CFG = {
    cacheDays: 1,
    maxPanelRows: 6,
    dbPage: 'https://mangabaka.org/data/database',

    // Used only until you import the MangaBaka database file.
    licensedTags: ['licensed', 'licensed (en)', 'english licensed', 'licensed in english'],
    englishPublishers: [
      'yen press', 'viz', 'viz media', 'kodansha usa', 'kodansha comics', 'seven seas',
      'seven seas entertainment', 'vertical', 'vertical comics', 'dark horse', 'dark horse manga',
      'square enix manga & books', 'j-novel club', 'denpa', 'airship', 'one peace books',
      'tokyopop', 'digital manga', 'ghost ship', 'kaiten books', 'udon entertainment',
      'titan comics', 'sol press', 'inklore', 'comikey', 'azuki',
    ],
  };

  const DEFAULT_COLORS = { gold: '#f5c542', blue: '#4c8dff', orange: '#ffa62b', red: '#ff4d4f', done: '#6fcf97' };
  const KEY_DATA = 'kvnr_data_v1';
  const KEY_CACHE = 'kvnr_cache_v1';
  const KEY_CFG = 'kvnr_cfg_v1';
  const KEY_OVR = 'kvnr_override_v1';
  const KEY_MB = 'kvnr_mbids_v1';

  // ---------- Storage ----------
  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  function loadKey(k, def) {
    try {
      const raw = hasGM ? GM_getValue(k, '') : localStorage.getItem(k);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function saveKey(k, obj) {
    const s = JSON.stringify(obj);
    if (hasGM) GM_setValue(k, s); else localStorage.setItem(k, s);
  }
  let data = loadKey(KEY_DATA, {});
  let cache = loadKey(KEY_CACHE, {});
  let ovr = loadKey(KEY_OVR, {});
  let mbIds = loadKey(KEY_MB, {});
  const savedCfg = loadKey(KEY_CFG, {});
  const settings = Object.assign({
    showAll: false, nextCard: true, soonDays: 7, checkEveryDays: 30, dbDays: 7, dbSnooze: 0, pos: null,
  }, savedCfg);
  settings.colors = Object.assign({}, DEFAULT_COLORS, savedCfg.colors || {});
  const saveSettings = () => saveKey(KEY_CFG, settings);
  const libMap = {};

  // ---------- Date helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => iso(new Date());
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };

  // color = frame color on the card, tone = badge/pill color
  function status(e) {
    const t = todayISO();
    const v = e.volume || 'Next volume';
    if (e.date) {
      const d = daysBetween(t, e.date);
      if (d < 0) return { kind: 'out', color: 'red', tone: 'red', icon: '\u{1F4E6}', short: `${v} is out`, label: `${v} is out (since ${e.date})` };
      if (d === 0) return { kind: 'today', color: 'red', tone: 'red', icon: '\u{1F4E6}', short: `${v} is out today`, label: `${v} is out today!` };
      if (d <= settings.soonDays) return { kind: 'soon', color: 'orange', tone: 'orange', icon: '\u23F3', short: `${v} in ${d}d`, label: `${v} in ${d} day${d === 1 ? '' : 's'} (${e.date})` };
      return { kind: 'dated', color: 'blue', tone: 'blue', icon: '\u{1F4C5}', short: `${v}: ${e.date}`, label: `${v}: ${e.date}` };
    }
    if (e.finished) return { kind: 'done', color: 'done', tone: 'done', icon: '\u2705', short: 'No more volumes', label: 'No more volumes expected (no reminders)' };
    const last = e.checked || e.added || t;
    if (daysBetween(last, t) >= settings.checkEveryDays) {
      return { kind: 'check', color: 'red', tone: 'red', icon: '\u{1F50E}', short: 'Check for a date', label: `${v}: check for a date now` };
    }
    return { kind: 'tba', color: 'gold', tone: 'gray', icon: '\u{1F552}', short: 'No date yet', label: `${v}: no date yet (re-check ${addDays(last, settings.checkEveryDays)})` };
  }
  const ATTN = ['out', 'today', 'soon', 'check'];

  // ---------- DOM helper ----------
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach(c => el.append(c));
    return el;
  };
  const btn = (label, cls, fn) => h('button', { class: 'kvnr-btn ' + cls, type: 'button', onclick: fn }, label);

  // ---------- Colors ----------
  const hexRgb = hx => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hx || '');
    const n = m ? parseInt(m[1], 16) : 0xf5c542;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const shade = (hx, f) => { const [r, g, b] = hexRgb(hx); return rgbHex(r * f, g * f, b * f); };
  const isLight = hx => { const [r, g, b] = hexRgb(hx); return (0.299 * r + 0.587 * g + 0.114 * b) > 150; };
  function applyColors() {
    const st = document.documentElement.style;
    Object.entries(settings.colors).forEach(([name, hx]) => {
      const bg = shade(hx, 0.5);
      st.setProperty(`--kvnr-${name}`, hx);
      st.setProperty(`--kvnr-${name}-bg`, bg);
      st.setProperty(`--kvnr-${name}-fg`, isLight(bg) ? '#111' : '#fff');
    });
  }

  // ---------- Styles ----------
  document.head.append(h('style', {}, `
    .kvnr-frame{position:absolute;inset:0;z-index:20;pointer-events:none;border:3px solid var(--kvnr-c,#f5c542);border-radius:.4rem;box-sizing:border-box}
    .kvnr-frame.kvnr-dash{border-style:dashed}
    .kvnr-c-red{--kvnr-c:var(--kvnr-red)}
    .kvnr-c-orange{--kvnr-c:var(--kvnr-orange)}
    .kvnr-c-blue{--kvnr-c:var(--kvnr-blue)}
    .kvnr-c-gold{--kvnr-c:var(--kvnr-gold)}
    .kvnr-c-done{--kvnr-c:var(--kvnr-done)}
    .kvnr-badge{position:absolute;top:8px;left:8px;z-index:21;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border-radius:6px;font:700 11px/1.5 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.7);user-select:none}
    .kvnr-add{background:rgba(20,20,20,.9);color:var(--kvnr-gold);border:1px dashed var(--kvnr-gold)}
    .kvnr-t-blue{background:var(--kvnr-blue-bg);color:var(--kvnr-blue-fg);border:1px solid var(--kvnr-blue)}
    .kvnr-t-orange{background:var(--kvnr-orange-bg);color:var(--kvnr-orange-fg);border:1px solid var(--kvnr-orange)}
    .kvnr-t-red{background:var(--kvnr-red-bg);color:var(--kvnr-red-fg);border:1px solid var(--kvnr-red)}
    .kvnr-t-gold{background:var(--kvnr-gold-bg);color:var(--kvnr-gold-fg);border:1px solid var(--kvnr-gold)}
    .kvnr-t-done{background:var(--kvnr-done-bg);color:var(--kvnr-done-fg);border:1px solid var(--kvnr-done)}
    .kvnr-t-gray{background:#3a3d45;color:#ddd;border:1px solid #555}
    .kvnr-next-card img{object-fit:cover!important}
    .kvnr-next-card .card-item-container{cursor:pointer}
    .kvnr-edit{position:absolute;top:8px;right:8px;z-index:21;width:26px;height:26px;border-radius:6px;border:0;background:rgba(0,0,0,.65);color:#fff;font-size:14px;cursor:pointer}
    #kvnr-fab{position:fixed;right:16px;bottom:16px;z-index:99998;padding:10px 14px;border-radius:999px;border:1px solid #555;background:#1b1e24;color:#eee;font:600 13px system-ui,sans-serif;cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,.5);touch-action:none;user-select:none}
    #kvnr-fab.kvnr-alert{background:#b3123a;border-color:#ff5d83;color:#fff}
    #kvnr-fab .kvnr-dot{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:#ffa62b;border:2px solid #16181d}
    #kvnr-panel{position:fixed;z-index:99998;width:380px;max-width:92vw;max-height:min(70vh,calc(100vh - 80px));overflow:auto;background:#16181d;color:#e6e6e6;border:1px solid #444;border-radius:10px;padding:12px;font:13px system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6)}
    .kvnr-ptitle{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
    .kvnr-ptitle h4{margin:0;font-size:14px}
    .kvnr-drag{cursor:grab;user-select:none;touch-action:none}
    .kvnr-count,.kvnr-hint,.kvnr-more{color:#9aa0aa;font-size:12px}
    .kvnr-sec{margin:10px 0 4px;color:#9aa0aa;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .kvnr-empty{color:#9aa0aa;padding:6px 2px}
    .kvnr-banner{margin:0 0 8px;padding:8px;border-radius:8px;background:#3b2f10;border:1px solid #6b5416;color:#ffe3a3;font-size:12px}
    .kvnr-banner .kvnr-actions{margin-top:6px}
    .kvnr-cur{padding:8px;margin-bottom:6px;border:1px solid #3a3d45;border-radius:8px;background:#1b1e24}
    .kvnr-row{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-radius:8px}
    .kvnr-row:hover{background:#23262d}
    .kvnr-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .kvnr-link{color:#9cc2ff;font-weight:700;text-decoration:none}
    .kvnr-link:hover{text-decoration:underline}
    .kvnr-icons{display:flex;gap:4px;flex-shrink:0}
    .kvnr-ico{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:1px solid #4a4f59;background:#262a31;color:#eee;font-size:13px;cursor:pointer;text-decoration:none}
    .kvnr-ico:hover{background:#343944}
    .kvnr-row small{color:#9aa0aa;word-break:break-word}
    .kvnr-pill{align-self:flex-start;padding:1px 8px;border-radius:6px;font-weight:600;font-size:12px}
    .kvnr-warn{color:#ffb4bd;font-size:12px;margin:6px 0}
    .kvnr-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #333}
    #kvnr-modal{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center}
    .kvnr-box{width:400px;max-width:92vw;max-height:90vh;overflow:auto;background:#1b1e24;color:#eee;border:1px solid #444;border-radius:12px;padding:18px;font:14px system-ui,sans-serif}
    .kvnr-box.kvnr-wide{width:720px}
    .kvnr-box h3{margin:0 0 12px;font-size:16px}
    .kvnr-box p{margin:0 0 10px;font-size:13px;color:#c9ced8}
    .kvnr-box pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#0f1115;padding:10px;border-radius:8px}
    .kvnr-box a{color:#9cc2ff}
    .kvnr-box progress{width:100%;height:14px}
    .kvnr-f{display:block;margin-bottom:10px}
    .kvnr-f span{display:block;margin-bottom:3px;font-size:12px;color:#aab}
    .kvnr-f input[type=text],.kvnr-f input[type=date],.kvnr-f input[type=number],.kvnr-sel,.kvnr-search{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:6px;border:1px solid #555;background:#0f1115;color:#eee;font:inherit}
    .kvnr-chk{display:flex;gap:8px;align-items:center;margin:4px 0 8px;font-size:13px}
    .kvnr-colors{display:grid;grid-template-columns:1fr 54px;gap:8px 12px;align-items:center;margin-bottom:12px}
    .kvnr-colors input[type=color]{width:54px;height:30px;border:1px solid #555;border-radius:6px;background:#0f1115;padding:2px}
    .kvnr-cover{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}
    .kvnr-prev{width:64px;height:92px;object-fit:cover;border-radius:4px;border:1px solid #444;display:none}
    .kvnr-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .kvnr-tools{display:grid;grid-template-columns:1fr 170px 150px;gap:8px;margin-bottom:10px}
    .kvnr-vlist{max-height:52vh;overflow:auto;border:1px solid #2c2f36;border-radius:8px;padding:4px}
    .kvnr-btn{padding:6px 10px;border-radius:6px;border:1px solid #555;background:#2a2e36;color:#eee;font:600 12px system-ui,sans-serif;cursor:pointer}
    .kvnr-btn:hover{background:#353a44}
    .kvnr-btn[disabled]{opacity:.5;cursor:default}
    .kvnr-pri{background:#c4143f;border-color:#ff5d83}
    .kvnr-danger{color:#ff9aa8}
    #kvnr-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:99999;background:#b3123a;color:#fff;padding:10px 16px;border-radius:8px;font:600 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.5);max-width:90vw}
  `));
  applyColors();

  // ---------- Kavita API (uses your existing login) ----------
  function getToken() {
    try {
      const raw = localStorage.getItem('kavita-user');
      if (raw) { const u = JSON.parse(raw); if (u && u.token) return u.token; }
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i));
        if (v && v.charAt(0) === '{' && v.indexOf('"token"') !== -1) {
          try { const o = JSON.parse(v); if (o && o.token) return o.token; } catch (e) { /* keep looking */ }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function api(path) {
    const token = getToken();
    const r = await fetch(path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}${token ? '' : ' (no login token found)'}`);
    return r.json();
  }

  // ---------- Reading the series' links and names ----------
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = arr => (arr || []).map(x => String((x && (x.title || x.name)) || '').toLowerCase().trim()).filter(Boolean);
  const normTitle = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function summarize(m) {
    return {
      tags: names(m.tags), genres: names(m.genres), publishers: names(m.publishers),
      publicationStatus: m.publicationStatus, webLinks: m.webLinks || '',
    };
  }

  const LINK_RES = [
    ['al', /anilist\.co\/manga\/(\d+)/i],
    ['mal', /myanimelist\.net\/manga\/(\d+)/i],
    ['mu', /mangaupdates\.com\/series\/([0-9a-z]+)/i],
    ['ki', /kitsu\.(?:app|io)\/manga\/(\d+)/i],
    ['ap', /anime-planet\.com\/manga\/([^/?#\s]+)/i],
    ['mb', /mangabaka\.(?:org|dev)\/(?:[a-z-]+\/)?(\d+)/i],
  ];
  const LINK_LABELS = { al: 'AniList', mal: 'MyAnimeList', mu: 'MangaUpdates', ki: 'Kitsu', ap: 'Anime-Planet', mb: 'MangaBaka link' };

  function parseLinks(webLinks) {
    const out = {};
    String(webLinks || '').split(/[,\s]+/).forEach(u => {
      LINK_RES.forEach(([k, re]) => {
        if (out[k]) return;
        const m = u.match(re);
        if (m) out[k] = m[1].toLowerCase();
      });
    });
    return out;
  }

  // Estimate used only until a MangaBaka database has been imported.
  function detectFromMeta(s) {
    const tagHit = s.tags.concat(s.genres).find(t => CFG.licensedTags.includes(t));
    if (tagHit) return { licensed: true, reason: `tag "${tagHit}"` };
    const pubHit = s.publishers.find(p => CFG.englishPublishers.some(e => new RegExp('(^|[^a-z])' + escRe(e) + '($|[^a-z])').test(p)));
    if (pubHit) return { licensed: true, reason: `publisher "${pubHit}"` };
    return { licensed: false, reason: 'nothing found' };
  }

  // ---------- MangaBaka database index (kept in IndexedDB) ----------
  let idx = null;
  let idxLoaded = false;
  let detMemo = {};

  const IDB_NAME = 'kvnr_db';
  const IDB_STORE = 'kv';
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const rq = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadIndex() {
    try { idx = (await idbGet('index')) || null; } catch (e) { idx = null; }
    idxLoaded = true;
    detMemo = {};
  }

  const newIndex = fileName => ({
    v: 1, builtAt: Date.now(), asOf: '', file: fileName, total: 0, licensed: 0,
    al: {}, mal: {}, mu: {}, ki: {}, ap: {}, mb: {}, ti: {}, mg: {},
  });

  // Keeps only licensed series (IDs, titles, English publishers) plus a map of merged series.
  function addSeries(ix, o) {
    ix.total++;
    if (!o || o.state === 'deleted') return;
    if (o.merged_with != null) { ix.mg[o.id] = o.merged_with; return; }
    if (o.last_updated_at && String(o.last_updated_at) > ix.asOf) ix.asOf = String(o.last_updated_at);
    if (o.is_licensed !== true) return;
    ix.licensed++;
    const id = o.id;
    const s = o.source || {};
    const put = (map, v) => { if (v != null && v !== '') map[String(v).toLowerCase()] = id; };
    put(ix.al, s.anilist && s.anilist.id);
    put(ix.mal, s.my_anime_list && s.my_anime_list.id);
    put(ix.mu, s.manga_updates && s.manga_updates.id);
    put(ix.ki, s.kitsu && s.kitsu.id);
    put(ix.ap, s.anime_planet && s.anime_planet.id);
    const eng = (o.publishers || []).filter(p => p && p.type === 'English').map(p => p.name);
    ix.mb[id] = { t: o.title || '', p: eng, s: o.status ? String(o.status) : '' };
    const titles = new Set([o.title, o.romanized_title, o.native_title]);
    (o.titles || []).forEach(t => { if (t && t.title && /^en/i.test(t.language || '')) titles.add(t.title); });
    titles.forEach(t => {
      const n = normTitle(t);
      if (n.length < 2) return;
      const cur = ix.ti[n];
      if (cur === undefined) ix.ti[n] = id; else if (cur !== id) ix.ti[n] = -1;
    });
  }

  const ascii = (u8, from, len) => {
    let s = '';
    for (let i = from; i < from + len && u8[i]; i++) s += String.fromCharCode(u8[i]);
    return s;
  };
  const concatBytes = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a, 0); c.set(b, a.length); return c; };

  // Reads one entry at a time from a tar stream and hands the .json/.jsonl content to emit().
  function tarPush(st, chunk, emit) {
    let pos = 0;
    while (pos < chunk.length && !st.ended) {
      if (st.mode === 'hdr') {
        const take = Math.min(512 - st.have, chunk.length - pos);
        st.buf.set(chunk.subarray(pos, pos + take), st.have);
        st.have += take; pos += take;
        if (st.have === 512) {
          st.have = 0;
          if (st.buf.every(b => b === 0)) { st.ended = true; continue; }
          const name = ascii(st.buf, 0, 100);
          const size = parseInt(ascii(st.buf, 124, 12).trim() || '0', 8) || 0;
          const type = String.fromCharCode(st.buf[156] || 48);
          const base = name.split('/').pop();
          st.feed = type === '0' && /\.jsonl?$/i.test(base) && base.indexOf('._') !== 0;
          st.left = size;
          st.pad = (512 - (size % 512)) % 512;
          st.mode = size > 0 ? 'body' : 'hdr';
        }
      } else if (st.mode === 'body') {
        const take = Math.min(st.left, chunk.length - pos);
        if (st.feed && take > 0) emit(chunk.subarray(pos, pos + take));
        pos += take; st.left -= take;
        if (st.left === 0) st.mode = 'pad';
      } else {
        const take = Math.min(st.pad, chunk.length - pos);
        pos += take; st.pad -= take;
        if (st.pad === 0) st.mode = 'hdr';
      }
    }
  }

  // Streams the file (plain .json/.jsonl, or gzip / tar.gz) one chunk at a time, so the big file is never held in memory.
  async function importDatabase(file, ui) {
    if (/\.zst$/i.test(file.name)) throw new Error('.zst files cannot be read by the browser. Download the .jsonl.tar.gz or .json.tar.gz version instead.');
    const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const gz = magic[0] === 0x1f && magic[1] === 0x8b;
    let read = 0;
    let stream = file.stream().pipeThrough(new TransformStream({ transform(chunk, ctl) { read += chunk.length; ctl.enqueue(chunk); } }));
    if (gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const dec = new TextDecoder('utf-8');
    const ix = newIndex(file.name);
    let buf = '';
    let head = null;
    let tar = null;

    const handle = raw => {
      let line = raw.trim();
      if (line.charAt(0) === '[') line = line.slice(1).trim();
      if (line.charAt(line.length - 1) === ']') line = line.slice(0, -1).trim();
      if (line.charAt(line.length - 1) === ',') line = line.slice(0, -1);
      if (line.charAt(0) !== '{') return;
      let o = null;
      try { o = JSON.parse(line); } catch (e) { ix.bad = (ix.bad || 0) + 1; return; }
      addSeries(ix, o);
    };
    const feedText = bytes => {
      buf += dec.decode(bytes, { stream: true });
      let start = 0;
      let nl = buf.indexOf('\n', start);
      while (nl !== -1) { handle(buf.slice(start, nl)); start = nl + 1; nl = buf.indexOf('\n', start); }
      buf = buf.slice(start);
      if (buf.length > 30e6) throw new Error('This file has very long lines. Use the JSONL version (series.jsonl) of the database.');
    };
    const feed = bytes => { if (tar) tarPush(tar, bytes, feedText); else feedText(bytes); };

    let lastTick = 0;
    for (;;) {
      if (ui.cancelled()) { reader.cancel(); throw new Error('Import cancelled.'); }
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      if (head !== null || tar === null) {
        head = head ? concatBytes(head, chunk) : chunk;
        if (head.length < 512) continue;
        chunk = head; head = null;
        if (ascii(chunk, 257, 5) === 'ustar') tar = { mode: 'hdr', have: 0, buf: new Uint8Array(512), left: 0, pad: 0, feed: false, ended: false };
        else tar = false;
      }
      feed(chunk);
      if (tar && tar.ended) { reader.cancel(); break; }
      const now = performance.now();
      if (now - lastTick > 200) {
        lastTick = now;
        ui.progress(Math.min(1, read / file.size), `${ix.total.toLocaleString()} series read, ${ix.licensed.toLocaleString()} licensed`);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (head !== null && head.length) feed(head);
    if (buf.trim()) handle(buf);
    if (!ix.total) throw new Error('No series were found in this file. Choose series.jsonl or series.json (or the .tar.gz of either) from the MangaBaka database page.');
    ui.progress(1, `${ix.total.toLocaleString()} series read, ${ix.licensed.toLocaleString()} licensed`);
    return ix;
  }

  const dbAgeDays = () => (idx ? Math.floor((Date.now() - idx.builtAt) / 86400000) : null);
  const dbNeedsAttention = () => idxLoaded && (!idx || dbAgeDays() >= settings.dbDays);
  const dbAlert = () => dbNeedsAttention() && Date.now() >= settings.dbSnooze;

  function resolveMb(rawId) {
    if (!idx) return null;
    let id = String(rawId);
    for (let i = 0; i < 6 && idx.mg[id] != null; i++) id = String(idx.mg[id]);
    const rec = idx.mb[id];
    return rec ? { id, t: rec.t, p: rec.p, s: rec.s || '' } : null;
  }

  // Works out which MangaBaka series a Kavita series is, using (in order): your own MangaBaka ID,
  // a MangaBaka link, AniList / MyAnimeList / MangaUpdates / Kitsu / Anime-Planet links, then the title.
  function matchSeries(id) {
    const byMb = (mbid, via) => {
      const mb = resolveMb(mbid);
      return mb ? { state: 'matched', via, mb } : { state: 'notlicensed', via, mbId: String(mbid) };
    };
    if (mbIds[id]) return byMb(mbIds[id], 'the MangaBaka ID you entered');
    const c = cache[id];
    if (!c || c.err || !c.sum) return { state: 'wait' };
    const links = parseLinks(c.sum.webLinks);
    const ext = c.ext || {};

    // 1) A MangaBaka ID decides everything: Kavita's own External Ids field first, then a MangaBaka link.
    //    If it points to a series that is not licensed, the answer is "not licensed" and nothing else is tried.
    if (ext.mb) return byMb(ext.mb, "Kavita's MangaBaka ID");
    if (links.mb) return byMb(links.mb, LINK_LABELS.mb);

    // 2) Only without a MangaBaka ID: other IDs (Kavita's External Ids, then web links)
    const ids = Object.assign({}, links);
    if (ext.al) ids.al = ext.al;
    if (ext.mal) ids.mal = ext.mal;
    const order = ['al', 'mal', 'mu', 'ki', 'ap'];
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      if (ids[k] && idx[k][ids[k]] != null) return { state: 'matched', via: LINK_LABELS[k], mb: resolveMb(idx[k][ids[k]]) };
    }
    if (Object.keys(ids).length) return { state: 'notlicensed', via: 'its links' };

    // 3) Only without any ID: the title
    const hits = new Set();
    (c.names || []).forEach(n => { const v = idx.ti[normTitle(n)]; if (v !== undefined && v !== -1) hits.add(v); });
    if (hits.size === 1) return { state: 'matched', via: 'title (check it is the right series)', mb: resolveMb(Array.from(hits)[0]) };
    return { state: 'nomatch' };
  }

  function detect(id) {
    if (detMemo[id]) return detMemo[id];
    let r;
    if (!idxLoaded) return { licensed: false, state: 'wait', text: 'Loading database...' };
    if (idx) {
      const m = matchSeries(id);
      if (m.state === 'wait') return { licensed: false, state: 'wait', text: 'Reading metadata...' };
      if (m.state === 'matched') {
        const pubs = m.mb.p.length ? `, English: ${m.mb.p.join(', ')}` : '';
        r = { licensed: true, state: 'matched', mb: m.mb, text: `Licensed - MangaBaka #${m.mb.id}, matched by ${m.via}${pubs}` };
      } else if (m.state === 'notlicensed') {
        r = { licensed: false, state: 'notlicensed', text: m.mbId ? `Not licensed: MangaBaka #${m.mbId} (from ${m.via}) is not marked as licensed` : `Not licensed (checked by ${m.via})` };
      } else {
        r = { licensed: false, state: 'nomatch', text: "Couldn't match this series. Add a MangaBaka link or ID in the edit dialog." };
      }
    } else {
      const c = cache[id];
      if (!c) return { licensed: false, state: 'wait', text: 'Reading metadata...' };
      if (c.err) return { licensed: false, state: 'error', text: 'Metadata unreadable' };
      const d = detectFromMeta(c.sum);
      r = { licensed: d.licensed, state: 'estimate', text: `${d.licensed ? 'Licensed' : 'Not detected'} (estimate from ${d.reason}). Import the MangaBaka database for exact results.` };
    }
    detMemo[id] = r;
    return r;
  }

  const pending = new Set();
  const queue = [];
  let running = 0;
  let refreshTimer;
  const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); };

  function ensureMeta(id, fresh) {
    const c = cache[id];
    const ttl = fresh ? 10000 : (c && c.err ? 10 * 60000 : CFG.cacheDays * 86400000);
    if ((c && c.ver === 3 && Date.now() - c.t < ttl) || pending.has(id)) return;
    pending.add(id); queue.push(id); pump();
  }

  // Kavita's "External Ids" tab: MangaBaka / AniList / MyAnimeList numbers stored on the series.
  function extIds(...objs) {
    const out = {};
    const keys = { mangabakaid: 'mb', anilistid: 'al', malid: 'mal' };
    objs.forEach(o => {
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach(k => {
        const t = keys[k.toLowerCase()];
        const v = o[k];
        if (t && !out[t] && v != null && v !== 0 && v !== '' && v !== '0') out[t] = String(v).toLowerCase();
      });
    });
    return out;
  }

  async function fetchMeta(id) {
    const [m, s] = await Promise.all([api(`/api/Series/metadata?seriesId=${id}`), api(`/api/Series/${id}`).catch(() => null)]);
    cache[id] = {
      t: Date.now(), ver: 3, sum: summarize(m), ext: extIds(m, s),
      name: (s && (s.name || s.localizedName)) || '',
      names: s ? [s.name, s.localizedName, s.originalName].filter(Boolean) : [],
      lib: s && s.libraryId != null ? String(s.libraryId) : '',
    };
    delete detMemo[id];
    return m;
  }

  function loadMeta(id) {
    return fetchMeta(id)
      .catch(err => { cache[id] = { t: Date.now(), ver: 3, err: String(err.message || err) }; delete detMemo[id]; })
      .finally(() => { running--; pending.delete(id); saveKey(KEY_CACHE, cache); scheduleRefresh(); pump(); });
  }

  // Re-read the series you are looking at, so edits made in Kavita (External Ids, links) apply right away.
  function refreshCurrent() {
    const cur = currentSeriesId();
    if (cur) ensureMeta(cur, true);
  }

  function pump() {
    while (running < 2 && queue.length) {
      running++;
      loadMeta(queue.shift());
    }
  }

  const overrideOf = id => (ovr[id] && ovr[id].mode) || (data['k:' + id] && data['k:' + id].force ? 'yes' : 'auto');
  const isHidden = id => overrideOf(id) === 'no';
  function isLicensed(id) {
    const m = overrideOf(id);
    if (m === 'no') return false;
    if (m === 'yes') return true;
    return detect(id).licensed;
  }
  function setOverride(id, mode, title) {
    if (mode === 'auto') delete ovr[id]; else ovr[id] = { mode, title: title || '' };
    saveKey(KEY_OVR, ovr);
  }
  const titleOf = (id, fallback) => (data['k:' + id] && data['k:' + id].title) || (cache[id] && cache[id].name) || fallback || ('Series ' + id);

  // ---------- Entry helpers ----------
  const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());
  const storeOf = e => e.store || (isUrl(e.note) ? e.note.trim() : '');
  const noteOf = e => (isUrl(e.note) && !e.store ? '' : (e.note || ''));
  function libFor(id) {
    const e = data['k:' + id];
    return (e && e.lib) || libMap[id] || (cache[id] && cache[id].lib) || '';
  }
  function urlFor(id) {
    const lib = libFor(id);
    return lib ? `${location.origin}/library/${lib}/series/${id}` : '';
  }
  const bumpVolume = v => String(v || '').replace(/(\d+)(?!.*\d)/, m => String(Number(m) + 1));
  const parseMbInput = s => { const m = String(s || '').match(/(\d+)(?!.*\d)/); return m ? m[1] : ''; };

  // ---------- Modal helpers ----------
  function closeModal() { const m = document.getElementById('kvnr-modal'); if (m) m.remove(); }
  function showModal(box) {
    closeModal();
    const overlay = h('div', { id: 'kvnr-modal', onclick: ev => { if (ev.target === overlay) closeModal(); } }, box);
    document.body.append(overlay);
  }
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

  // Resize a chosen image to a small JPEG so it is cheap to store.
  function fileToCover(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 360 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
      img.src = url;
    });
  }

  function setEntry(key, patch) { data[key] = Object.assign({}, data[key] || {}, patch); saveKey(KEY_DATA, data); refresh(); }
  function removeEntry(key) { delete data[key]; saveKey(KEY_DATA, data); refresh(); }

  function openModal(id, fallbackTitle, opts) {
    const back = (opts && opts.back) || null;
    const key = 'k:' + id, e = data[key] || {}, title = titleOf(id, fallbackTitle);
    const finish = () => { closeModal(); if (back) back(); };

    const vol = h('input', { type: 'text', placeholder: 'e.g. Vol. 6' }); vol.value = e.volume || '';
    const date = h('input', { type: 'date' }); date.value = e.date || '';
    const store = h('input', { type: 'text', placeholder: 'Store page link (https://...)' }); store.value = storeOf(e);
    const note = h('input', { type: 'text', placeholder: 'Optional note' }); note.value = noteOf(e);
    const mbIn = h('input', { type: 'text', placeholder: 'MangaBaka link or number (only if matching fails)' }); mbIn.value = mbIds[id] || '';
    const licSel = h('select', { class: 'kvnr-sel' },
      h('option', { value: 'auto' }, 'Automatic (use the database)'),
      h('option', { value: 'yes' }, 'Always treat as licensed'),
      h('option', { value: 'no' }, 'Never treat as licensed (hide)'));
    licSel.value = overrideOf(id);
    const finChk = h('input', { type: 'checkbox' }); finChk.checked = !!e.finished;
    const mbStatus = (detect(id).mb && detect(id).mb.s) || '';

    let cover = e.cover || '';
    const prev = h('img', { class: 'kvnr-prev', alt: '' });
    const coverUrl = h('input', { type: 'text', placeholder: 'Image address (https://...)' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    const coverInfo = h('div', { class: 'kvnr-hint' });
    const showCover = () => {
      if (cover) { prev.src = cover; prev.style.display = 'block'; } else { prev.removeAttribute('src'); prev.style.display = 'none'; }
      coverInfo.textContent = !cover ? 'No cover yet. Choose a file, paste an image (Ctrl+V), or enter an address.'
        : (cover.indexOf('data:') === 0 ? `Saved image (${Math.round(cover.length / 1365)} KB)` : 'Using the image address');
    };
    const takeFile = f => {
      if (!f) return;
      fileToCover(f).then(d => { cover = d; coverUrl.value = ''; showCover(); })
        .catch(() => { coverInfo.textContent = 'That file is not an image.'; });
    };
    coverUrl.value = cover.indexOf('http') === 0 ? cover : '';
    coverUrl.addEventListener('input', () => { cover = coverUrl.value.trim(); showCover(); });
    fileIn.addEventListener('change', () => takeFile(fileIn.files && fileIn.files[0]));
    showCover();

    const field = (label, input) => h('label', { class: 'kvnr-f' }, h('span', {}, label), input);
    const base = () => ({
      title, volume: vol.value.trim(), store: store.value.trim(), note: note.value.trim(), cover,
      force: false, lib: libFor(id), added: e.added || todayISO(), finished: finChk.checked && !date.value,
    });
    const applyOverride = () => {
      setOverride(id, licSel.value, title);
      const n = parseMbInput(mbIn.value);
      if (n) mbIds[id] = n; else delete mbIds[id];
      saveKey(KEY_MB, mbIds);
      delete detMemo[id];
    };

    const box = h('div', { class: 'kvnr-box' },
      h('h3', {}, title),
      h('div', { class: 'kvnr-hint', style: 'margin-bottom:10px' }, detect(id).text),
      field('Next volume', vol),
      field('Release date (leave empty if unknown)', date),
      field('Store link (opens from the cart icon)', store),
      field('Note', note),
      h('div', { class: 'kvnr-f' }, h('span', {}, 'Cover of the next volume'),
        h('div', { class: 'kvnr-cover' }, prev,
          h('div', { style: 'flex:1' }, coverUrl,
            h('div', { class: 'kvnr-actions' }, btn('Choose file...', '', () => fileIn.click()), btn('Clear cover', '', () => { cover = ''; coverUrl.value = ''; showCover(); }), fileIn),
            coverInfo))),
      h('label', { class: 'kvnr-chk' }, finChk, 'No more volumes expected (stop reminding me to check)'),
      mbStatus ? h('div', { class: 'kvnr-hint', style: 'margin:-4px 0 10px' }, `MangaBaka lists this series as: ${mbStatus}`) : '',
      field('Licensed status', licSel),
      field('MangaBaka link or ID (optional, fixes a wrong or missing match)', mbIn),
      h('div', { class: 'kvnr-actions' },
        btn('Save', 'kvnr-pri', () => { applyOverride(); setEntry(key, Object.assign(base(), { date: date.value, checked: todayISO() })); finish(); }),
        btn('Checked today, no date yet', '', () => { applyOverride(); setEntry(key, Object.assign(base(), { date: '', finished: finChk.checked, checked: todayISO() })); finish(); }),
        btn('Got it - track next volume', '', () => {
          applyOverride();
          setEntry(key, Object.assign(base(), { volume: bumpVolume(vol.value), date: '', store: '', note: '', cover: '', finished: false, checked: todayISO() }));
          finish();
        }),
        e.added ? '' : btn('Not licensed - hide this series', 'kvnr-danger', () => { setOverride(id, 'no', title); refresh(); finish(); }),
        e.added ? btn('Stop tracking', 'kvnr-danger', () => { removeEntry(key); finish(); }) : '',
        btn('Cancel', '', finish)));

    box.addEventListener('paste', ev => {
      const files = ev.clipboardData && ev.clipboardData.files;
      if (files && files[0] && files[0].type.indexOf('image/') === 0) { ev.preventDefault(); takeFile(files[0]); }
    });
    showModal(box);
  }

  // ---------- Rows (used by the popup and the "View all" window) ----------
  function rowEl(key, e, s, opts) {
    const id = key.slice(2), url = urlFor(id), store = storeOf(e), note = noteOf(e);
    const title = e.title || titleOf(id);
    const name = url ? h('a', { class: 'kvnr-link', href: url, title: 'Open in Kavita' }, title) : h('b', {}, title);
    return h('div', { class: 'kvnr-row' },
      h('div', { class: 'kvnr-row-top' }, name,
        h('span', { class: 'kvnr-icons' },
          store ? h('a', { class: 'kvnr-ico', href: store, target: '_blank', rel: 'noopener noreferrer', title: 'Open store page' }, '\u{1F6D2}') : '',
          (s.kind === 'check' || s.kind === 'tba') ? h('button', { class: 'kvnr-ico', type: 'button', title: 'No more volumes expected - stop reminding me to check', onclick: () => setEntry(key, { finished: true, date: '', checked: todayISO() }) }, '\u2714') : '',
          h('button', { class: 'kvnr-ico', type: 'button', title: 'Edit', onclick: () => openModal(id, e.title, opts) }, '\u270E'))),
      h('span', { class: 'kvnr-pill kvnr-t-' + s.tone }, s.icon + ' ' + s.label),
      note ? h('small', {}, note) : '');
  }

  const ORDER = { out: 0, today: 0, check: 1, soon: 2, dated: 3, tba: 4, done: 5 };
  const allRows = () => Object.entries(data).map(([key, e]) => ({ key, e, s: status(e) }));
  function sortRows(rows, mode) {
    const byTitle = (x, y) => (x.e.title || '').localeCompare(y.e.title || '');
    const byDate = (x, y) => (x.e.date || '9999').localeCompare(y.e.date || '9999');
    if (mode === 'title') return rows.sort(byTitle);
    if (mode === 'date') return rows.sort((x, y) => byDate(x, y) || byTitle(x, y));
    return rows.sort((x, y) => ORDER[x.s.kind] - ORDER[y.s.kind] || byDate(x, y) || byTitle(x, y));
  }
  const FILTERS = {
    all: () => true,
    attention: s => ATTN.includes(s.kind),
    out: s => s.kind === 'out' || s.kind === 'today',
    dated: s => s.kind === 'dated' || s.kind === 'soon',
    nodate: s => s.kind === 'check' || s.kind === 'tba',
    done: s => s.kind === 'done',
  };

  // ---------- Database window ----------
  function openDatabase() {
    const state = { cancel: false, busy: false };
    const info = h('p', {});
    const bar = h('progress', { max: '1', value: '0', style: 'display:none' });
    const msg = h('div', { class: 'kvnr-hint', style: 'margin:6px 0 10px;min-height:16px' });
    const fileIn = h('input', { type: 'file', accept: '.json,.jsonl,.gz,.tgz', style: 'display:none' });

    const describe = () => {
      if (!idx) { info.textContent = 'No database imported yet. Until you import one, the script only estimates which series are licensed.'; return; }
      const age = dbAgeDays();
      info.textContent = `Loaded ${idx.licensed.toLocaleString()} licensed series (of ${idx.total.toLocaleString()} in the file). `
        + `Data as of ${idx.asOf ? idx.asOf.slice(0, 10) : 'unknown'}. Imported ${age === 0 ? 'today' : age + ' day(s) ago'} from ${idx.file}.`;
    };
    describe();

    const importBtn = btn('Choose database file...', 'kvnr-pri', () => fileIn.click());
    const cancelBtn = btn('Cancel import', '', () => { state.cancel = true; });
    cancelBtn.style.display = 'none';
    const removeBtn = btn('Remove database', 'kvnr-danger', async () => {
      await idbDel('index').catch(() => {});
      idx = null; detMemo = {}; describe(); refresh();
    });

    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!f || state.busy) return;
      state.busy = true; state.cancel = false;
      importBtn.disabled = true; removeBtn.disabled = true; cancelBtn.style.display = '';
      bar.style.display = ''; bar.value = 0; msg.textContent = 'Reading...';
      try {
        const ix = await importDatabase(f, { cancelled: () => state.cancel, progress: (fr, t) => { bar.value = fr; msg.textContent = t; } });
        msg.textContent = 'Saving...';
        await idbSet('index', ix);
        idx = ix; detMemo = {};
        settings.dbSnooze = 0; saveSettings();
        msg.textContent = `Done: ${ix.licensed.toLocaleString()} licensed series indexed.`;
        describe(); refresh();
      } catch (err) {
        msg.textContent = String((err && err.message) || err);
      } finally {
        state.busy = false; importBtn.disabled = false; removeBtn.disabled = false; cancelBtn.style.display = 'none'; bar.style.display = 'none';
      }
    });

    showModal(h('div', { class: 'kvnr-box' },
      h('h3', {}, 'MangaBaka database'),
      info,
      h('p', {}, 'Download series.jsonl.tar.gz (or series.json.tar.gz) from the MangaBaka database page and choose it here. You do not need to unzip it. The big file stays where it is; only a small index of licensed series is kept in the browser.'),
      h('p', {}, h('a', { href: CFG.dbPage, target: '_blank', rel: 'noopener noreferrer' }, 'Open the MangaBaka download page')),
      bar, msg, fileIn,
      h('div', { class: 'kvnr-actions' }, importBtn, cancelBtn, removeBtn, btn('Close', '', closeModal))));
  }

  // ---------- Settings window ----------
  function openSettings() {
    const colorRows = [
      ['gold', 'Nothing to do yet (licensed, or no date and not due)'],
      ['blue', 'Has a release date'],
      ['orange', 'Coming soon'],
      ['red', 'Out now, or time to check for a date'],
      ['done', 'No more volumes expected (finished series)'],
    ];
    const colorGrid = h('div', { class: 'kvnr-colors' });
    colorRows.forEach(([name, label]) => {
      const input = h('input', { type: 'color', oninput: ev => { settings.colors[name] = ev.target.value; applyColors(); saveSettings(); } });
      input.value = settings.colors[name];
      colorGrid.append(h('span', {}, label), input);
    });
    const num = (label, key, min) => {
      const input = h('input', { type: 'number', min: String(min), oninput: ev => {
        const v = Math.max(min, parseInt(ev.target.value, 10) || min);
        settings[key] = v; saveSettings(); refresh();
      } });
      input.value = settings[key];
      return h('label', { class: 'kvnr-f' }, h('span', {}, label), input);
    };
    const check = (label, key) => {
      const input = h('input', { type: 'checkbox', onchange: ev => { settings[key] = ev.target.checked; saveSettings(); refresh(); } });
      input.checked = !!settings[key];
      return h('label', { class: 'kvnr-chk' }, input, label);
    };
    showModal(h('div', { class: 'kvnr-box' },
      h('h3', {}, 'Settings'),
      h('div', { class: 'kvnr-sec' }, 'Status colors'), colorGrid,
      num('"Coming soon" starts this many days before the release', 'soonDays', 1),
      num('Re-check a series with no date every (days)', 'checkEveryDays', 1),
      num('Remind me to update the MangaBaka database every (days)', 'dbDays', 1),
      check('Show the tracker button on every series', 'showAll'),
      check('Show the next-volume card on series pages', 'nextCard'),
      h('div', { class: 'kvnr-actions' },
        btn('Reset colors', '', () => { settings.colors = Object.assign({}, DEFAULT_COLORS); applyColors(); saveSettings(); openSettings(); }),
        btn('Reset button position', '', () => { settings.pos = null; saveSettings(); applyFabPos(); placePanel(); }),
        btn('Close', 'kvnr-pri', closeModal))));
  }

  // ---------- "View all" window ----------
  const va = { q: '', filter: 'all', sort: 'priority' };

  function openViewAll() {
    const list = h('div', { class: 'kvnr-vlist' });
    const count = h('span', { class: 'kvnr-count' });
    const fill = () => {
      const q = va.q.trim().toLowerCase();
      let rows = allRows().filter(r => FILTERS[va.filter](r.s));
      if (q) rows = rows.filter(r => ((r.e.title || '') + ' ' + noteOf(r.e)).toLowerCase().includes(q));
      sortRows(rows, va.sort);
      const kids = rows.length ? rows.map(r => rowEl(r.key, r.e, r.s, { back: openViewAll })) : [h('div', { class: 'kvnr-empty' }, 'No series match.')];
      list.replaceChildren(...kids);
      count.textContent = `${rows.length} of ${Object.keys(data).length} shown`;
    };
    const select = (options, value, onPick) => {
      const el = h('select', { class: 'kvnr-sel', onchange: ev => { onPick(ev.target.value); fill(); } },
        options.map(([v, l]) => h('option', { value: v }, l)));
      el.value = value;
      return el;
    };
    const search = h('input', { type: 'text', class: 'kvnr-search', placeholder: 'Search title or note...', oninput: ev => { va.q = ev.target.value; fill(); } });
    search.value = va.q;
    const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: importJSON });

    showModal(h('div', { class: 'kvnr-box kvnr-wide' },
      h('div', { class: 'kvnr-ptitle' }, h('h3', { style: 'margin:0' }, 'All tracked series'), count),
      h('div', { class: 'kvnr-tools' }, search,
        select([['all', 'All'], ['attention', 'Needs attention'], ['out', 'Already out'], ['dated', 'Has a date'], ['nodate', 'No date yet'], ['done', 'No more volumes']], va.filter, v => { va.filter = v; }),
        select([['priority', 'Sort: priority'], ['date', 'Sort: date'], ['title', 'Sort: title']], va.sort, v => { va.sort = v; })),
      list,
      h('div', { class: 'kvnr-foot' },
        btn('Export calendar (.ics)', '', exportICS),
        btn('Backup (.json)', '', exportJSON),
        btn('Restore backup', '', () => fileInput.click()),
        btn('MangaBaka database', '', openDatabase),
        btn(`Hidden series (${hiddenIds().length})`, '', openHidden),
        btn('Re-read metadata', '', () => { cache = {}; detMemo = {}; saveKey(KEY_CACHE, cache); refresh(); }),
        btn('Settings', '', openSettings),
        btn('Close', '', closeModal),
        fileInput)));
    fill();
  }

  // ---------- Hidden (not licensed) series ----------
  const hiddenIds = () => Object.keys(ovr).filter(id => ovr[id].mode === 'no');

  function openHidden() {
    const ids = hiddenIds();
    const rows = ids.length ? ids.map(id => {
      const url = urlFor(id), title = ovr[id].title || titleOf(id);
      return h('div', { class: 'kvnr-row' },
        h('div', { class: 'kvnr-row-top' },
          url ? h('a', { class: 'kvnr-link', href: url }, title) : h('b', {}, title),
          btn('Treat as licensed again', '', () => { setOverride(id, 'auto'); refresh(); openHidden(); })));
    }) : [h('div', { class: 'kvnr-empty' }, 'No hidden series.')];
    showModal(h('div', { class: 'kvnr-box' },
      h('h3', {}, 'Hidden series'),
      h('div', { class: 'kvnr-hint', style: 'margin-bottom:8px' }, 'These series are ignored by the tracker (no frame or button) until you restore them.'),
      h('div', { class: 'kvnr-vlist' }, rows),
      h('div', { class: 'kvnr-foot' }, btn('Back', '', openViewAll), btn('Close', '', closeModal))));
  }

  // ---------- Series cards on the page ----------
  // strict = the series page itself (used by cards); loose = also sub-pages like /series/1/volume/2
  function parseSeriesHref(href, loose) {
    let u;
    try { u = new URL(href, location.href); } catch (err) { return null; }
    if (u.origin !== location.origin) return null;
    const m = u.pathname.match(loose ? /^\/library\/(\d+)\/series\/(\d+)/ : /^\/library\/(\d+)\/series\/(\d+)\/?$/);
    return m ? { lib: m[1], id: m[2] } : null;
  }
  const currentRef = () => parseSeriesHref(location.href, true);
  const currentSeriesId = () => { const r = currentRef(); return r ? r.id : null; };

  function badgeInfo(id) {
    const e = data['k:' + id];
    if (!e) return { text: '+ Release', cls: 'kvnr-badge kvnr-add' };
    const s = status(e);
    return { text: s.icon + ' ' + s.short, cls: 'kvnr-badge kvnr-t-' + s.tone };
  }

  function decorate() {
    let dirty = false;
    document.querySelectorAll('.card-item-container').forEach(card => {
      if (card.closest('.kvnr-next-card')) return;
      const a = card.querySelector('.card-title a[href]');
      const ref = a && parseSeriesHref(a.getAttribute('href'), false);
      if (!ref) return;
      const id = ref.id, key = 'k:' + id, e = data[key];
      libMap[id] = ref.lib;
      ensureMeta(id);
      if (e && !e.lib) { e.lib = ref.lib; dirty = true; }

      const lic = isLicensed(id);
      const hide = isHidden(id) && !e;
      let frame = card.querySelector(':scope > .kvnr-frame');
      let badge = card.querySelector(':scope > .kvnr-badge');
      if (hide || !(lic || e || settings.showAll)) {
        if (frame) frame.remove();
        if (badge) badge.remove();
        return;
      }

      const color = e ? status(e).color : 'gold';
      const frameCls = 'kvnr-frame kvnr-c-' + color;
      if (!frame) { frame = h('div', { class: frameCls }); card.append(frame); }
      if (frame.className !== frameCls) frame.className = frameCls;

      const info = badgeInfo(id);
      if (!badge) {
        badge = h('span', { class: info.cls, onclick: ev => { ev.preventDefault(); ev.stopPropagation(); openModal(badge.dataset.id, badge.dataset.title); } }, info.text);
        card.append(badge);
      }
      badge.dataset.id = id;
      badge.dataset.title = card.getAttribute('aria-label') || '';
      if (badge.className !== info.cls) badge.className = info.cls;
      if (badge.textContent !== info.text) badge.textContent = info.text;
    });
    if (dirty) saveKey(KEY_DATA, data);
  }

  // ---------- Next-volume card on the series page ----------
  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="233" viewBox="0 0 160 233"><rect width="160" height="233" fill="#1f2229"/>' +
    '<text x="80" y="112" font-family="sans-serif" font-size="38" text-anchor="middle" fill="#555c6b">?</text>' +
    '<text x="80" y="142" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#6b7384">No cover yet</text></svg>');

  function scrollParent(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  }
  function nearEnd(container) {
    const sp = scrollParent(container);
    return !sp || sp.scrollHeight - sp.scrollTop - sp.clientHeight < 900;
  }

  function buildNextCard(tpl, id, e, s) {
    const node = tpl.cloneNode(true);
    node.classList.add('kvnr-next-card');
    node.querySelectorAll('.bulk-mode, .progress-banner, .download, .overlay-information, .card-actions, .kvnr-badge, .kvnr-frame').forEach(n => n.remove());
    const root = node.querySelector('.card-item-container');
    const label = e.volume || 'Next volume';
    root.setAttribute('aria-label', `${label} (upcoming)`);
    const img = node.querySelector('img');
    if (img) { img.removeAttribute('srcset'); img.alt = ''; img.src = e.cover || PLACEHOLDER; }
    const text = node.querySelector('.card-content');
    if (text) text.textContent = `${label} - ${e.date || 'date to be announced'}`;
    const link = node.querySelector('.card-title a');
    if (link) { link.removeAttribute('href'); link.textContent = label; }

    const store = storeOf(e);
    root.append(
      h('div', { class: 'kvnr-frame kvnr-dash kvnr-c-' + s.color }),
      h('span', { class: 'kvnr-badge kvnr-t-' + s.tone }, s.icon + ' ' + s.short),
      h('button', { class: 'kvnr-edit', type: 'button', title: 'Edit', onclick: ev => { ev.stopPropagation(); openModal(id); } }, '\u270E'));
    root.addEventListener('click', () => { if (store) window.open(store, '_blank', 'noopener'); else openModal(id); });
    return node;
  }

  function syncNextCard() {
    const existing = Array.from(document.querySelectorAll('.kvnr-next-card'));
    const id = currentSeriesId();
    const e = id ? data['k:' + id] : null;
    const pane = document.querySelector('.tab-pane.active .card-container');
    const tab = document.querySelector('.carousel-tabs-container .nav-link.active');
    const tabOk = !!tab && /storyline|volumes?|chapters?/i.test(tab.textContent);
    const tpl = pane ? pane.querySelector('app-entity-card:not(.kvnr-next-card)') : null;

    if (!settings.nextCard || !e || status(e).kind === 'done' || !pane || !tabOk || !tpl || !nearEnd(pane)) {
      existing.forEach(n => n.remove());
      return;
    }
    const s = status(e);
    const sig = [id, e.volume, e.date, e.store, e.note, e.cover ? e.cover.length : 0, s.kind, s.color, todayISO()].join('|');
    let node = existing.find(n => pane.contains(n)) || null;
    existing.forEach(n => { if (n !== node) n.remove(); });
    if (!node || node.dataset.sig !== sig) {
      const fresh = buildNextCard(tpl, id, e, s);
      fresh.dataset.sig = sig;
      if (node) node.replaceWith(fresh); else pane.append(fresh);
      node = fresh;
    }
    if (pane.lastElementChild !== node) pane.append(node);
  }

  // ---------- Floating button + popup (both can be dragged) ----------
  let fab = null;
  let panel = null;
  let panelOpen = false;
  let suppressClick = false;
  const attentionCount = () => allRows().filter(r => ATTN.includes(r.s.kind)).length;

  function clampPos(x, y) {
    const w = fab ? fab.offsetWidth : 120, hgt = fab ? fab.offsetHeight : 40;
    return { x: Math.max(0, Math.min(x, window.innerWidth - w)), y: Math.max(0, Math.min(y, window.innerHeight - hgt)) };
  }
  function applyFabPos() {
    if (!fab) return;
    if (!settings.pos) { fab.style.left = ''; fab.style.top = ''; fab.style.right = ''; fab.style.bottom = ''; return; }
    const p = clampPos(settings.pos.x, settings.pos.y);
    fab.style.left = p.x + 'px'; fab.style.top = p.y + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto';
  }
  function placePanel() {
    if (!panel || !fab) return;
    const f = fab.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const above = f.top + f.height / 2 > vh / 2;
    let top = above ? f.top - ph - 8 : f.bottom + 8;
    let left = f.left + f.width / 2 > vw / 2 ? f.right - pw : f.left;
    top = Math.max(8, Math.min(top, vh - ph - 8));
    left = Math.max(8, Math.min(left, vw - pw - 8));
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
  }

  // Dragging either the button or the popup title moves the button (the popup follows it).
  function makeDraggable(handle) {
    let active = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || ev.target.closest('button:not(#kvnr-fab), a, input, select')) return;
      const r = fab.getBoundingClientRect();
      active = true; moved = false; sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
      handle.setPointerCapture(ev.pointerId);
    });
    handle.addEventListener('pointermove', ev => {
      if (!active) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      settings.pos = clampPos(ox + dx, oy + dy);
      applyFabPos(); placePanel();
    });
    const end = ev => {
      if (!active) return;
      active = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      if (moved) { saveSettings(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function renderFab() {
    if (!fab) {
      fab = h('button', { id: 'kvnr-fab', type: 'button', onclick: () => { if (suppressClick) return; panelOpen = !panelOpen; renderPanel(); } });
      document.body.append(fab);
      makeDraggable(fab);
      applyFabPos();
    }
    const n = attentionCount();
    const txt = '\u{1F4C5} Releases' + (n ? ` (${n})` : '');
    const dot = dbAlert();
    const sig = txt + '|' + dot;
    if (fab.dataset.sig !== sig) {
      fab.dataset.sig = sig;
      fab.textContent = txt;
      if (dot) fab.append(h('span', { class: 'kvnr-dot', title: 'MangaBaka database needs updating' }));
    }
    fab.classList.toggle('kvnr-alert', n > 0);
  }

  function currentBlock(cur) {
    const e = data['k:' + cur];
    const state = isHidden(cur) ? 'Hidden: marked as not licensed' : detect(cur).text;
    return h('div', { class: 'kvnr-cur' },
      e ? rowEl('k:' + cur, e, status(e)) : h('b', {}, titleOf(cur)),
      h('div', { class: 'kvnr-hint', style: 'margin:3px 0 6px' }, state),
      e ? '' : btn(isHidden(cur) ? '+ Track anyway' : '+ Track next release', 'kvnr-pri', () => openModal(cur)),
      ' ', isHidden(cur) ? btn('Treat as licensed again', '', () => { setOverride(cur, 'auto'); refresh(); }) : btn('Not licensed - hide', '', () => { setOverride(cur, 'no', titleOf(cur)); refresh(); }),
      ' ', btn('Inspect', '', () => inspect(cur)));
  }

  function dbBanner() {
    if (!dbAlert()) return '';
    const text = idx ? `The MangaBaka database is ${dbAgeDays()} days old. Update it to catch newly licensed series.` : 'Import the MangaBaka database so the script knows which series are licensed.';
    return h('div', { class: 'kvnr-banner' }, text,
      h('div', { class: 'kvnr-actions' },
        btn(idx ? 'Update database' : 'Import database', 'kvnr-pri', openDatabase),
        btn('Remind me tomorrow', '', () => { settings.dbSnooze = Date.now() + 86400000; saveSettings(); refresh(); })));
  }

  function renderPanel() {
    if (panel) { panel.remove(); panel = null; }
    if (!panelOpen) return;

    const ref = currentRef();
    const cur = ref ? ref.id : null;
    if (cur) { libMap[cur] = ref.lib; ensureMeta(cur, true); }

    const errs = Object.values(cache).filter(c => c.err).length;
    const warn = errs ? h('div', { class: 'kvnr-warn' }, `${errs} series could not be read from Kavita. Use "Inspect" on a series page to see the error.`) : '';

    const att = sortRows(allRows().filter(r => ATTN.includes(r.s.kind) && r.key !== 'k:' + cur), 'priority');
    const shown = att.slice(0, CFG.maxPanelRows);
    const list = shown.length ? shown.map(r => rowEl(r.key, r.e, r.s)) : [h('div', { class: 'kvnr-empty' }, 'Nothing else needs attention right now.')];
    const more = att.length > shown.length ? h('div', { class: 'kvnr-more' }, `+ ${att.length - shown.length} more needing attention`) : '';

    const title = h('div', { class: 'kvnr-ptitle kvnr-drag', title: 'Drag to move' }, h('h4', {}, 'Next releases'), h('span', { class: 'kvnr-count' }, `${Object.keys(data).length} tracked`));
    panel = h('div', { id: 'kvnr-panel' },
      title, dbBanner(),
      cur ? currentBlock(cur) : '', warn,
      h('div', { class: 'kvnr-sec' }, 'Needs attention'), list, more,
      h('div', { class: 'kvnr-foot' },
        btn(`View all (${Object.keys(data).length})`, 'kvnr-pri', () => { panelOpen = false; renderPanel(); openViewAll(); }),
        btn('Export calendar (.ics)', '', exportICS),
        btn('Settings', '', openSettings)));
    document.body.append(panel);
    makeDraggable(title);
    placePanel();
  }

  // Shows exactly what is stored in Kavita for one series and what the script concluded.
  async function inspect(id) {
    showModal(h('div', { class: 'kvnr-box' }, h('h3', {}, 'Reading metadata...')));
    try {
      const m = await fetchMeta(id);
      saveKey(KEY_CACHE, cache); scheduleRefresh();
      const c = cache[id];
      const out = Object.assign({
        seriesId: id, detection: detect(id).text, myMangaBakaId: mbIds[id] || null,
        kavitaExternalIds: c.ext, linksFound: parseLinks(c.sum.webLinks),
      }, c.sum, { allFieldNames: Object.keys(m) });
      showModal(h('div', { class: 'kvnr-box' }, h('h3', {}, 'What the script sees'), h('pre', {}, JSON.stringify(out, null, 2)), btn('Close', '', closeModal)));
    } catch (err) {
      showModal(h('div', { class: 'kvnr-box' }, h('h3', {}, 'Could not read metadata'), h('pre', {}, String(err.message || err)), btn('Close', '', closeModal)));
    }
  }

  // ---------- Export / import ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportJSON() {
    const keep = { colors: settings.colors, soonDays: settings.soonDays, checkEveryDays: settings.checkEveryDays, dbDays: settings.dbDays };
    download('kavita-next-releases.json', JSON.stringify({ version: 3, data, overrides: ovr, mbIds, settings: keep }, null, 2), 'application/json');
  }
  function importJSON(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    f.text().then(txt => {
      try {
        const parsed = JSON.parse(txt);
        if (parsed && parsed.version >= 2) {
          Object.assign(data, parsed.data || {}); Object.assign(ovr, parsed.overrides || {}); saveKey(KEY_OVR, ovr);
          if (parsed.mbIds) { Object.assign(mbIds, parsed.mbIds); saveKey(KEY_MB, mbIds); }
          if (parsed.settings) {
            const s = parsed.settings;
            if (s.colors) settings.colors = Object.assign({}, DEFAULT_COLORS, s.colors);
            ['soonDays', 'checkEveryDays', 'dbDays'].forEach(k => { if (s[k]) settings[k] = s[k]; });
            saveSettings(); applyColors();
          }
        } else Object.assign(data, parsed);
        saveKey(KEY_DATA, data); detMemo = {}; refresh(); alert('Backup restored.');
      } catch (err) { alert('That file is not a valid backup.'); }
    });
  }

  // Dated series become all-day events; series with no date become a monthly "check" event.
  // Delete the old "Manga releases" calendar in your calendar app, then import the new file.
  function exportICS() {
    const esc = s => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ymd = d => d.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const seq = Math.floor(Date.now() / 60000);
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kvnr//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Manga releases'];
    Object.entries(data).forEach(([key, e]) => {
      if (status(e).kind === 'done') return;
      const id = key.slice(2), t = e.title || key, store = storeOf(e), note = noteOf(e);
      let start, summary, rrule = null;
      if (e.date) { start = e.date; summary = `${t}: ${e.volume || 'next volume'} releases`; }
      else {
        start = addDays(e.checked || e.added || todayISO(), settings.checkEveryDays);
        if (start < todayISO()) start = todayISO();
        summary = `Check release date: ${t}`; rrule = 'RRULE:FREQ=MONTHLY';
      }
      const desc = [note, store ? 'Store: ' + store : '', urlFor(id) ? 'Kavita: ' + urlFor(id) : ''].filter(Boolean).join('\n');
      L.push('BEGIN:VEVENT', `UID:kvnr-${key.replace(/[^\w-]/g, '_')}@local`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(start)}`, `SEQUENCE:${seq}`, `LAST-MODIFIED:${stamp}`, `SUMMARY:${esc(summary)}`);
      if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
      if (store) L.push(`URL:${store}`);
      if (rrule) L.push(rrule);
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Manga release', 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    download('manga-releases.ics', L.join('\r\n'), 'text/calendar');
    toast('Calendar file saved. In your calendar app, delete the old "Manga releases" calendar first, then import this file into a new one.', 12000);
  }

  // ---------- Startup ----------
  const safe = fn => { try { fn(); } catch (err) { console.warn('[kvnr]', err); } };
  function refresh() {
    safe(decorate);
    safe(syncNextCard);
    safe(renderFab);
    if (panelOpen) safe(renderPanel);
  }

  function toast(msg, ms) {
    const old = document.getElementById('kvnr-toast');
    if (old) old.remove();
    const t = h('div', { id: 'kvnr-toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), ms || 7000);
  }

  refresh();
  loadIndex().then(() => {
    refreshCurrent();
    refresh();
    const parts = [];
    const n = attentionCount();
    if (n > 0) parts.push(`${n} series need attention: a volume is out, coming soon, or due for a date check.`);
    if (dbAlert()) parts.push(idx ? `The MangaBaka database is ${dbAgeDays()} days old.` : 'Import the MangaBaka database to detect licensed series.');
    if (parts.length) setTimeout(() => toast(parts.join(' ')), 1200);
  });

  let lastUrl = location.href;
  let timer;
  const quickSync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      safe(decorate);
      safe(syncNextCard);
      if (location.href !== lastUrl) { lastUrl = location.href; refreshCurrent(); if (panelOpen) safe(renderPanel); }
    }, 350);
  };
  new MutationObserver(quickSync).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('scroll', quickSync, true);
  window.addEventListener('resize', () => { applyFabPos(); placePanel(); });
})();
