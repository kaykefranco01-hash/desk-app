/* Grok Bot desk app. Plain JS, no build. Only real numbers from the desk; never demo data. */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const COLORS = { scanner: '#64d2ff', analyst: '#ffd60a', brain: '#bf5af2', executor: '#00d35a', risk: '#ff6b9a' };
  const ICONS = {
    scanner: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9 3h-2.1a7 7 0 0 0-1-2.4l1.5-1.5-1.5-1.5-1.5 1.5A7 7 0 0 0 13 5.1V3h-2v2.1a7 7 0 0 0-2.4 1L7.1 4.6 5.6 6.1l1.5 1.5A7 7 0 0 0 6.1 10H4v2h2.1a7 7 0 0 0 1 2.4l-1.5 1.5 1.5 1.5 1.5-1.5a7 7 0 0 0 2.4 1V19h2v-2.1a7 7 0 0 0 2.4-1l1.5 1.5 1.5-1.5-1.5-1.5a7 7 0 0 0 1-2.4H21z"/>',
    analyst: '<path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7m0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8"/>',
    brain: '<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-3 3c0 1.2.7 2.2 1.7 2.7A3 3 0 0 0 6 17a3 3 0 0 0 3 3V3m6 0v17a3 3 0 0 0 3-3 3 3 0 0 0 1.3-5.3A3 3 0 0 0 21 9a3 3 0 0 0-3-3 3 3 0 0 0-3-3"/>',
    executor: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    risk: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z"/>'
  };
  let TOKEN = null, PLANB = null, range = 'LIVE', lastState = null, lastOk = 0, termAfter = 0, failN = 0, actBefore = null;
  const FIX = new URLSearchParams(location.search).get('fixture');
  // GitHub Pages host: read-only PAPER snapshots that desk2 pushes every 15 s to branch desk2-live, one folder per 15 s bucket.
  // A new path on raw.githubusercontent.com is fresh right after the push, so we read the newest finished bucket.
  const GH = /github\.io$/.test(location.hostname) ? 'https://raw.githubusercontent.com/kaykefranco01-hash/desk-app/desk2-live/b/' : null;
  const PERIOD = 5, PERIODS = [5, 15]; let curB = null;
  async function ghGet(f, isState) {
    const nowSec = Date.now() / 1000;
    const tries = [];
    const add = b => { if (b > 0 && !tries.includes(b)) tries.push(b); };
    if (isState || curB == null) {
      for (const p of PERIODS) { const now = Math.floor(nowSec / p); for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16]) add(now - k); }
    } else { add(curB); add(curB - 1); add(curB - 2); }
    for (const b of tries) {
      if (isState && curB != null && b < curB) continue;
      let r; try { r = await fetch(GH + b + '/' + f, { cache: 'no-store', referrerPolicy: 'no-referrer' }); } catch (e) { continue; }
      if (r.ok) { if (isState) curB = b; return f.endsWith('.jpg') ? r : r.json(); }
    }
    if (isState && curB != null) { const r = await fetch(GH + curB + '/' + f, { referrerPolicy: 'no-referrer' }); if (r.ok) return r.json(); }
    throw new Error('no snapshot');
  }

  // ---------- auth ----------
  function boot() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t')) { localStorage.setItem('desk_token', h.get('t')); history.replaceState(null, '', location.pathname + location.search); }
    if (h.get('d')) { localStorage.setItem('desk_planb', h.get('d')); history.replaceState(null, '', location.pathname + location.search); }
    TOKEN = localStorage.getItem('desk_token'); PLANB = localStorage.getItem('desk_planb');
    if (GH) { PLANB = 'gh'; TOKEN = null; return true; }
    if (!TOKEN && !PLANB) { $('#paste').hidden = false; return false; }
    return true;
  }
  $('#paste-go').onclick = () => { const v = $('#paste-input').value.trim(); const i = v.indexOf('#'); if (i >= 0) { location.hash = v.slice(i); location.reload(); } };

  const PLANB_MAP = p => {
    if (p.startsWith('/state')) return 'state.json';
    if (p.startsWith('/chart')) return 'chart/' + (new URLSearchParams(p.split('?')[1]).get('range') || 'LIVE') + '.json';
    if (p.startsWith('/activity')) return 'activity.json';
    if (p.startsWith('/terminal')) return 'terminal.json';
    if (p.startsWith('/screen.jpg')) return 'screen.jpg';
    if (p.startsWith('/cursors')) return 'cursors.json';
    const m = p.match(/^\/(coin|audit)\/([^?]+)/); if (m) return m[1] + '/' + m[2] + '.json';
    const b = p.match(/^\/bots\/(\w+)\/decisions/); if (b) return 'bots/' + b[1] + '/decisions.json';
    return null;
  };
  async function api(path, opt = {}) {
    if (PLANB) {
      const f = PLANB_MAP(path); if (!f) throw new Error('read-only (plan B): use Telegram');
      if (GH) return ghGet(f, f === 'state.json');
      const r = await fetch(PLANB.replace(/\/$/, '') + '/' + f + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }
    const r = await fetch('/api' + path, { ...opt, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem('desk_token'); $('#paste').hidden = false; throw new Error('401'); }
    const j = await r.json(); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  const screenUrl = () => GH ? (curB != null ? GH + curB + '/screen.jpg' : '') : PLANB ? PLANB.replace(/\/$/, '') + '/screen.jpg?v=' + Date.now() : '/api/screen.jpg?t=' + encodeURIComponent(TOKEN) + '&v=' + Date.now();

  // ---------- format ----------
  const money = v => v == null ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hms = ts => { const d = new Date(ts * 1000); return d.toTimeString().slice(0, 8); };
  const hm = ts => new Date(ts * 1000).toTimeString().slice(0, 5);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = ts => { const s = Date.now() / 1000 - ts; return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };
  const safeImg = u => (typeof u === 'string' && /^https:\/\//.test(u) && u.length < 500 && !/\s/.test(u)) ? u : null;
  const initial = (name, mint) => {
    const s = String(name || mint || '?').replace(/^[^A-Za-z0-9]+/, '');
    const ch = (s[0] || '?').toUpperCase();
    return /[A-Z0-9]/.test(ch) ? ch : '?';
  };
  function av(name, img, mint, cls) {
    const u = safeImg(img), ch = initial(name, mint);
    let h = 0; for (const x of String(mint || name || '')) h = (h * 31 + x.charCodeAt(0)) >>> 0;
    const bg = `background:hsl(${h % 360} 55% 38%)`;
    if (!u) return `<span class="cav ${cls || ''}" style="${bg}">${ch}</span>`;
    return `<span class="cav ${cls || ''}" style="${bg}"><img src="${esc(u)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display='none';this.parentNode.appendChild(document.createTextNode('${ch}'))"></span>`;
  }

  // ---------- odometer ----------
  function odometer(el, value) {
    const txt = money(value), [whole, cents] = txt.split('.');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el.dataset.v === txt) return; const first = !el.dataset.v; el.dataset.v = txt;
    const chars = (whole + '.' + cents).split('');
    if (el.children.length !== chars.length || first) {
      el.innerHTML = chars.map((ch, i) => /\d/.test(ch) ? `<span class="d${i > whole.length ? ' cents' : ''}"><span class="s">${[...'0123456789'].map(n => `<span>${n}</span>`).join('')}</span></span>` : `<span class="${i >= whole.length ? 'cents' : ''}">${ch}</span>`).join('');
    }
    let k = 0;
    chars.forEach((ch, i) => { const c = el.children[i]; if (/\d/.test(ch) && c.firstChild) { const s = c.firstChild; s.style.transitionDelay = reduce ? '0ms' : (k++ * 30) + 'ms'; s.style.transform = `translateY(-${(+ch) * 1.05}em)`; } else if (!/\d/.test(ch)) c.textContent = ch; });
  }

  // ---------- render home ----------
  function renderState(st) {
    lastState = st; lastOk = Date.now(); failN = 0; $('#err').hidden = true;
    if (PLANB && st.updated && Date.now() / 1000 - st.updated > 90) { $('#err').hidden = false; $('#err').textContent = `Desk not publishing · last update ${hm(st.updated)}`; }
    const fake = !!(st.fixture || /TEST-(PAWS|GATO|RUG)/.test(JSON.stringify(st || {}))); $('#banner').hidden = !fake; if (fake) $('#banner').textContent = 'TEST FIXTURE · PAPER · not real trades';
    odometer($('#balance'), st.balance);
    $('#mode-pill').hidden = false; $('#mode-pill').textContent = st.mode; $('#mode-pill').className = 'pill ' + (st.mode === 'LIVE' ? 'green' : 'orange');
    const t = st.today_pct || 0; $('#today').textContent = (t >= 0 ? '+' : '') + t.toFixed(2) + '% today'; $('#today').className = t >= 0 ? 'green' : 'red';
    $('#mult').hidden = !st.multiplier; $('#mult').textContent = (st.multiplier || 0).toFixed(2) + '×';
    $('#wl').innerHTML = `${st.trades} trade${st.trades === 1 ? '' : 's'} · <span class="green">${st.wins} W</span> · <span class="red">${st.losses} L</span>`;
    const mk = $('#market'); mk.textContent = st.market; mk.className = 'pill small ' + (st.market_mode === 'RED' ? 'red' : st.market_mode === 'GREEN' ? 'green' : 'grey');
    $('#fomo-state').textContent = st.fomo_logged_out ? 'FOMO logged out' : (st.fomo_ok_at ? 'FOMO ok ' + ago(st.fomo_ok_at) : '');
    const sec = Math.max(0, Math.floor(Date.now() / 1000 - st.started_at));
    $('#elapsed').textContent = [sec / 3600, sec / 60 % 60, sec % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');
    $('#working').classList.toggle('idle', !st.in_window); $('#working-label').textContent = st.in_window ? 'Working' : 'Waiting for night';
    const fresh = st.last_frame_at && (Date.now() / 1000 - st.last_frame_at) < (PLANB ? 60 : 5);
    $('#live-dot').className = 'dot ' + (fresh ? 'red' : 'grey');
    $('#live-label').textContent = fresh ? "Live · Bot's computer" : (st.last_frame_at ? 'Last frame ' + hm(st.last_frame_at) : "Bot's computer");
    $('#lane').textContent = st.lane || 'Idle'; $('#lane').style.color = st.lane_bot ? COLORS[st.lane_bot] : '';
    $('#screen-private').hidden = !st.private; $('#screen-empty').hidden = !!st.last_frame_at || st.private;
    const o = st.last_order;
    $('#last-order').innerHTML = o ? `${av(o.symbol, o.image, o.mint, 'sm')}<span>${o.side === 'buy' ? 'Bought' : 'Sold'} ${esc(o.symbol || o.mint.slice(0, 4))} · ${money(o.fill_usd || o.usd)} · ${o.mode === 'PAPER' ? 'PAPER' : (o.status === 'done' ? 'verified' : esc(o.status))} <span class="checks">${o.mode === 'PAPER' ? '' : [o.screen_ok, o.api_ok, o.chain_ok].map(x => x ? '✓' : '·').join('')}</span></span>` : 'No orders yet';
    if (st.cursors) { renderCursors(st.cursors, $('#cursor-layer')); if (st.cursors.work) renderWork(st.cursors.work); }
    $('#bots-head').textContent = `Bots · ${Object.keys(COLORS).filter(b => st.heartbeats && st.heartbeats[b] && Date.now() / 1000 - st.heartbeats[b] < 120).length} running`;
    const pos = st.positions || [];
    $('#open-pos-wrap').hidden = !pos.length;
    if (pos.length) {
      $('#open-pos').innerHTML = pos.map(p => {
        const pnl = p.pnl_pct, cls = pnl == null ? '' : pnl >= 0 ? 'green' : 'red';
        return `<div class="row" data-mint="${esc(p.mint)}">${av(p.symbol, p.image, p.mint)}<div class="mid"><div>${esc(p.symbol)}</div><div>${money(p.size_usd)} in${p.price != null ? ' · $' + Number(p.price).toPrecision(4) : ''}</div></div><div class="val ${cls}">${pnl == null ? '—' : (pnl >= 0 ? '+' : '') + Number(pnl).toFixed(1) + '%'}</div></div>`;
      }).join('');
      $('#open-pos').querySelectorAll('.row').forEach(row => row.onclick = () => openCoin(row.dataset.mint));
    }
  }
  function renderError() {
    failN++; const n = Math.min(30, 2 * failN);
    $('#working').classList.add('idle'); $('#working-label').textContent = 'Offline'; $('#live-dot').className = 'dot grey';
    if (!lastState) { $('#screen-empty').hidden = false; $('#screen-empty').textContent = 'Desk offline'; }
    $('#err').hidden = false; $('#err').textContent = `Desk offline · retrying in ${n}s · last update ${lastOk ? new Date(lastOk).toTimeString().slice(0, 5) : 'never'}`;
    return n;
  }
  async function loadChart() {
    try { const d = await api('/chart?range=' + range); const ok = DeskChart.line($('#chart'), d); $('#chart-empty').hidden = ok; }
    catch (e) { $('#chart-empty').hidden = false; }
  }
  $$('#ranges button').forEach(b => b.onclick = () => { $$('#ranges button').forEach(x => x.classList.remove('on')); b.classList.add('on'); range = b.dataset.r; loadChart(); });

  // double buffered screen
  let front = 'a';
  // GitHub raw images are blocked as <img> cross-origin on some browsers (ORB): load them through fetch -> blob.
  function setImg(img, url) {
    if (!url) return;
    if (!GH) { img.src = url; return; }
    fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' }).then(r => r.ok ? r.blob() : null).then(b => {
      if (!b) return; const old = img.dataset.obj; img.src = URL.createObjectURL(b); img.dataset.obj = img.src; if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    }).catch(() => { });
  }
  const CURSOR_ORDER = ['scanner', 'analyst', 'risk', 'brain', 'executor'];
  const CURSOR_COLORS = { scanner: '#64d2ff', analyst: '#64d2ff', risk: '#ffd60a', brain: '#bf5af2', executor: '#00d35a' };
  function ensureCursors(layer) {
    if (!layer || layer.dataset.ready) return layer;
    layer.innerHTML = CURSOR_ORDER.map(b => `<div class="cur" data-bot="${b}" style="color:${CURSOR_COLORS[b]};left:8%;top:80%">
      <svg class="ptr" width="18" height="18" viewBox="0 0 22 22"><path d="M2 2 L2 18 L7 13 L11 21 L14 19.5 L10 12 L17 12 Z" fill="${CURSOR_COLORS[b]}" stroke="#000" stroke-width="1.2"/></svg>
      <i class="rip"></i><i class="caret" hidden></i>
      <div class="tag">@${b}</div>
    </div>`).join('');
    layer.dataset.ready = '1';
    return layer;
  }
  function actionOf(b, c) {
    if (c.action) return c.action;
    if (b === 'executor' && lastState && lastState.lane_bot === 'executor') return 'type';
    if (!c.ts) return (b === 'risk' && lastState && lastState.positions && lastState.positions.length) ? 'hover' : 'idle';
    const age = Date.now() / 1000 - c.ts;
    if (age < 8) return (b === 'executor' && /Clicking Buy/.test(c.bubble || '')) ? 'type' : 'click';
    if (age < 45) return 'hover';
    return 'idle';
  }
  function fitLayer(layer, cursors, wrap) {
    if (!layer || !wrap) return;
    const vw = (cursors && cursors.viewport && cursors.viewport.w) || 1600;
    const vh = (cursors && cursors.viewport && cursors.viewport.h) || 1000;
    const wr = wrap.getBoundingClientRect();
    if (!wr.width) return;
    const scale = Math.min(wr.width / vw, wr.height / vh);
    const dw = vw * scale, dh = vh * scale;
    layer.style.left = ((wr.width - dw) / 2) + 'px';
    layer.style.top = ((wr.height - dh) / 2) + 'px';
    layer.style.width = dw + 'px';
    layer.style.height = dh + 'px';
  }
  const cursorPlay = {};
  let cursorRaf = 0;
  function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function posAlong(path, u, period, loop) {
    if (!path || !path.length) return null;
    if (path.length === 1) return path[0];
    period = period || 10;
    if (loop) {
      const w = ((u % period) + period) % period;
      const f = (w / period) * path.length;
      const i = Math.floor(f) % path.length;
      const j = (i + 1) % path.length;
      const e = ease(f - Math.floor(f));
      const A = path[i], B = path[j];
      return { x: lerp(+A.x, +B.x, e), y: lerp(+A.y, +B.y, e), action: (e < 0.5 ? A.action : B.action) || 'hover' };
    }
    const t0 = path[0].ts, t1 = path[path.length - 1].ts;
    if (t0 != null && t1 != null && t1 > t0) {
      if (u <= 0) return path[0];
      const t = path[0].ts + u;
      if (t >= t1) return path[path.length - 1];
      for (let i = 0; i < path.length - 1; i++) {
        const A = path[i], B = path[i + 1];
        if (t >= A.ts && t <= B.ts) {
          const e = ease((t - A.ts) / Math.max(1e-6, B.ts - A.ts));
          return { x: lerp(+A.x, +B.x, e), y: lerp(+A.y, +B.y, e), action: (e < 0.5 ? A.action : B.action) || A.action || 'hover' };
        }
      }
    }
    const w = Math.max(0, Math.min(period, u));
    const f = (w / period) * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const e = ease(f - i);
    const A = path[i], B = path[i + 1];
    return { x: lerp(+A.x, +B.x, e), y: lerp(+A.y, +B.y, e), action: (e < 0.5 ? A.action : B.action) || 'hover' };
  }
  function placeCursor(el, b, c, pos) {
    if (!el || !pos) return;
    const x = Math.max(0, Math.min(1, +pos.x || 0)), y = Math.max(0, Math.min(1, +pos.y || 0));
    el.style.left = (x * 100) + '%';
    el.style.top = (y * 100) + '%';
    const act = pos.action || actionOf(b, c || {});
    el.classList.toggle('idle', act === 'idle');
    el.classList.toggle('hover', act === 'hover');
    el.classList.toggle('type', act === 'type');
    el.classList.toggle('flip', x > 0.62);
    const caret = el.querySelector('.caret'); if (caret) caret.hidden = act !== 'type';
    if (act === 'click' && el.dataset.ts !== String((c && c.ts) || '')) {
      el.classList.remove('click'); void el.offsetWidth; el.classList.add('click');
      el.dataset.ts = String((c && c.ts) || '');
      setTimeout(() => el.classList.remove('click'), 800);
    } else if (act !== 'click') { el.classList.remove('click'); }
  }
  function applyCursors() {
    const now = Date.now() / 1000;
    document.querySelectorAll('.cursor-layer').forEach(layer => {
      CURSOR_ORDER.forEach(b => {
        const el = layer.querySelector('[data-bot="' + b + '"]');
        const st = cursorPlay[b];
        if (!el || !st) return;
        let pos;
        if (st.path && st.path.length) {
          const u = st.loop ? now : (now - st.t0);
          pos = posAlong(st.path, u, st.period, st.loop && st.path.length >= 2);
        } else {
          pos = st.cur;
        }
        placeCursor(el, b, st.cur, pos);
      });
    });
  }
  function tickCursors() {
    applyCursors();
    cursorRaf = requestAnimationFrame(tickCursors);
  }
  function renderCursors(cursors, layer) {
    if (!cursors || !layer) return;
    const wrap = layer.closest('.screen-wrap') || $('#screen-wrap');
    ensureCursors(layer);
    fitLayer(layer, cursors, wrap);
    const map = cursors.cursors || {};
    CURSOR_ORDER.forEach(b => {
      const c = map[b];
      if (!c) { delete cursorPlay[b]; return; }
      const path = Array.isArray(c.path) ? c.path : [];
      const period = +c.period || 10;
      const loop = !!c.loop;
      const key = path.map(p => (+p.x).toFixed(3) + ',' + (+p.y).toFixed(3)).join('>');
      const prev = cursorPlay[b];
      if (!prev || prev.key !== key || prev.loop !== loop) {
        cursorPlay[b] = { path, period, loop, key, t0: Date.now() / 1000, cur: c };
      } else {
        prev.path = path; prev.period = period; prev.cur = c;
      }
    });
    applyCursors();
    if (!cursorRaf) cursorRaf = requestAnimationFrame(tickCursors);
  }
  function loadScreen() {
    if (!lastState || !lastState.last_frame_at || lastState.private) return;
    const back = front === 'a' ? 'b' : 'a', img = $('#screen-' + back);
    img.onload = () => { img.classList.remove('back'); $('#screen-' + front).classList.add('back'); front = back; if (lastState.cursors) renderCursors(lastState.cursors, $('#cursor-layer')); };
    setImg(img, screenUrl());
    if (lastState.cursors) renderCursors(lastState.cursors, $('#cursor-layer'));
  }
  $('#screen-wrap').onclick = () => openScreen();
  addEventListener('resize', () => { if (lastState && lastState.cursors) renderCursors(lastState.cursors, $('#cursor-layer')); });

  function botIcons(activeBot) {
    $('#bot-icons').innerHTML = Object.keys(COLORS).map(b => `<div class="bot-icon${b === activeBot ? ' active' : ''}" style="color:${COLORS[b]}" title="${b}"><svg viewBox="0 0 24 24" fill="${COLORS[b]}">${ICONS[b]}</svg></div>`).join('');
  }
  async function loadTerminal() {
    try {
      const d = await api('/terminal?after=' + termAfter);
      const rows = PLANB ? d.rows.filter(r => r.id > termAfter) : d.rows; if (!rows.length) return;
      const box = $('#terminal'); if (!termAfter) box.innerHTML = '';
      rows.forEach(r => { termAfter = Math.max(termAfter, r.id);
        const div = document.createElement('div'); div.className = 'ln';
        div.innerHTML = `<span class="t">${hms(r.ts)}</span><span class="b" style="color:${COLORS[r.bot] || '#fff'}">${esc(r.bot.toUpperCase())}:</span><span>${esc(r.text)}</span>`;
        box.appendChild(div); });
      while (box.children.length > 200) box.firstChild.remove();
      box.scrollTop = box.scrollHeight;
      const last = rows[rows.length - 1]; botIcons(last.bot);
      $('#term-coin').innerHTML = last.symbol ? `${av(last.symbol, last.image, last.mint, 'sm')}<span>${esc(last.symbol)}${last.mint ? ' ' + esc(last.mint.slice(0, 4) + '…' + last.mint.slice(-4)) : ''}</span>` : '—';
    } catch (e) { }
  }
  async function loadTradeDetails() {
    try {
      const d = await api('/activity'); const rows = d.rows || [];
      renderActivity($('#home-activity'), rows.slice(0, 5));
      const buy = rows.find(r => r.kind === 'bought' || r.kind === 'copied');
      if (!buy) { $('#trade-details').innerHTML = '<div class="empty">Waiting for the first trade</div>'; return; }
      const sells = rows.filter(r => r.kind === 'sold' || r.kind === 'stopped').slice(0, 3);
      $('#trade-details').innerHTML = `<div class="props"><span>Coin</span><span class="coin-line">${av(buy.title, buy.image, buy.mint, 'sm')}${esc(buy.title.replace(/^(Bought|Copied) /, ''))}</span><span>Direction</span><span>BUY</span><span>Size</span><span>${esc(buy.value)}</span><span>When</span><span>${hm(buy.ts)}</span></div>` +
        sells.map(s => `<div class="journal"><b class="${String(s.value).startsWith('-') ? 'red' : 'green'}">${esc(s.title)}</b> @ ${hms(s.ts)} · ${esc(s.subtitle)} · <span class="${String(s.value).startsWith('-') ? 'red' : 'green'}">${esc(s.value)}</span></div>`).join('');
    } catch (e) { }
  }

  // ---------- bots ----------
  const BOT_LINE = {
    scanner: (d) => { const k = d.rows.find(r => r.verdict === 'kill'), p = d.rows.find(r => r.verdict === 'pass');
      return `<div class="count">${d.today} pools today</div>` + (k ? `<div class="line strike">${esc(k.text)}</div>` : '') + (p ? `<div class="line">${esc(p.text)}</div>` : ''); },
    analyst: (d) => `<div class="count">${d.today} taken apart</div><div class="strips">${'<i></i>'.repeat(8)}</div>` + (d.rows[0] ? `<div class="line">${esc(d.rows[0].text)}</div>` : ''),
    brain: (d) => `<div class="count">Sizing</div>` + (d.rows[0] ? `<div class="line">${esc(d.rows[0].text)}</div>` : '') + `<div class="line secondary small">80+ = full size · under 80 = half size</div>`,
    executor: (d) => `<div class="count">${lastState ? lastState.trades : 0} trades</div>` + (d.rows[0] ? `<div class="line">${esc(d.rows[0].text)}</div>` : ''),
    risk: (d) => `<div class="count">Guarding</div><div class="line"><span class="pill red small">stop -${(window.__set && window.__set.risk && window.__set.risk.stop_pct.value) || 25}%</span> <span class="pill green small">trail ${(window.__set && window.__set.executor && window.__set.executor.trail_pct.value) || 40}%</span></div>` + (d.rows[0] ? `<div class="line">${esc(d.rows[0].text)}</div>` : '')
  };
  async function loadBots() {
    const cards = [], full = [];
    for (const b of Object.keys(COLORS)) {
      let d = { rows: [], today: 0, paused: false };
      try { d = await api(`/bots/${b}/decisions`); d.today = d.today ?? d.rows.length; } catch (e) { }
      const alive = lastState && lastState.heartbeats && lastState.heartbeats[b] && Date.now() / 1000 - lastState.heartbeats[b] < 120;
      const head = `<h3><span class="dot" style="background:${alive ? COLORS[b] : 'var(--ter)'}"></span><span style="color:${COLORS[b]}">${b[0].toUpperCase() + b.slice(1)}</span></h3>`;
      const body = d.rows.length ? BOT_LINE[b](d) : '<div class="line secondary">Nothing yet tonight</div>';
      cards.push(`<div class="botcard">${head}${body}</div>`);
      full.push(`<div class="card">${head}<div class="row" style="min-height:44px"><div class="mid"><div>${d.today} today</div></div>
        <label class="secondary small">${d.paused ? 'Paused' : 'Running'} <input type="checkbox" data-pause="${b}" ${d.paused ? '' : 'checked'} ${PLANB ? 'disabled' : ''}></label></div>
        ${d.rows.map(r => `<div class="row" style="min-height:44px">${r.mint ? av(r.symbol || r.text, r.image, r.mint, 'sm') : ''}<div class="mid"><div class="small">${esc(r.text)}</div><div>${hms(r.ts)}${r.coin_url ? ` · <a class="link" href="${esc(r.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}</div></div></div>`).join('') || '<div class="empty">Nothing yet tonight</div>'}
        <button class="link" data-go="account">Settings</button></div>`);
    }
    $('#carousel').innerHTML = cards.join(''); $('#bots-full').innerHTML = full.join('');
    $$('[data-pause]').forEach(i => i.onchange = async () => { try { await api(`/bots/${i.dataset.pause}/${i.checked ? 'resume' : 'pause'}`, { method: 'POST' }); } catch (e) { alert(e.message); } loadBots(); });
    bindGo();
  }

  // ---------- activity ----------
  function renderWork(work) {
    const box = $('#desk-work'); if (!box) return;
    work = work || (lastState && lastState.cursors && lastState.cursors.work);
    if (!work || !(work.risk || (work.decisions && work.decisions.length) || work.layer)) { box.hidden = true; box.innerHTML = ''; return; }
    const dec = (work.decisions || []).map(r => `<div class="ln"><span class="t">${esc(r.clock || hm(r.ts) || '')}</span><span class="b" style="color:${CURSOR_COLORS[r.bot] || COLORS[r.bot] || '#fff'}">@${esc(r.bot)}</span><span>${esc(r.text)}</span></div>`).join('');
    const layer = work.layer ? `<div class="ln"><span class="t">${esc(work.layer.clock || '')}</span><span class="b" style="color:${CURSOR_COLORS.risk}">@risk</span><span>${esc(work.layer.text)}</span></div>` : '';
    box.hidden = false;
    box.innerHTML = `<h3>Desk work</h3>${work.risk ? `<pre>${esc(work.risk)}</pre>` : ''}${dec}${layer}`;
  }
  function renderActivity(el, rows) {
    if (!rows.length) { el.innerHTML = '<div class="empty">Nothing yet tonight</div>'; return; }
    el.innerHTML = rows.map(r => { const neg = String(r.value).startsWith('-');
      const fallback = { bought: '↗', sold: '$', stopped: '■', rejected: '×', copied: '⧉' }[r.kind] || '·';
      const icon = r.mint ? av(r.title, r.image, r.mint) : `<div class="ic">${fallback}</div>`;
      return `<div class="row" data-kind="${r.kind}" data-mint="${esc(r.mint || '')}">${icon}<div class="mid"><div>${esc(r.title)}</div><div>${esc(r.subtitle)}${r.coin_url ? ` · <a class="link" href="${esc(r.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>` : ''}</div></div><div class="val ${r.kind === 'sold' && !neg ? 'green' : neg || r.kind === 'stopped' ? 'red' : ''}">${esc(r.value)}</div></div>`; }).join('');
    el.querySelectorAll('.row').forEach(row => row.onclick = e => { if (e.target.tagName === 'A' || !row.dataset.mint) return; row.dataset.kind === 'rejected' ? openAudit(row.dataset.mint) : openCoin(row.dataset.mint); });
  }
  async function loadActivity(more) {
    try { const d = await api('/activity' + (more && actBefore ? '?before=' + actBefore : '')); const rows = d.rows || [];
      if (!more) renderWork(d.work);
      if (more) { const tmp = document.createElement('div'); renderActivity(tmp, rows); $('#activity-list').append(...tmp.children); } else renderActivity($('#activity-list'), rows);
      actBefore = rows.length ? rows[rows.length - 1].id : null; $('#more-activity').hidden = PLANB || rows.length < 30;
    } catch (e) { $('#activity-list').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  $('#more-activity').onclick = () => loadActivity(true);

  // ---------- account ----------
  async function loadAccount() {
    try {
      const [a, s] = await Promise.all([api('/account'), api('/settings')]); window.__set = s.settings;
      $('#account-top').innerHTML = `
        <div class="row"><div class="mid"><div>Mode</div><div>${a.mode === 'PAPER' ? 'PAPER · no real money' : 'LIVE'}</div></div><span class="pill ${a.mode === 'PAPER' ? 'orange' : 'green'}">${a.mode}</span></div>
        <div class="row"><div class="mid"><div>Cash</div><div>${a.mode === 'PAPER' ? 'simulated' : 'FOMO'}</div></div><div class="val">${money(a.cash)}</div></div>
        <div class="row"><div class="mid"><div>Your FOMO profile</div><div>${esc(a.fomo_handle || 'handle not set (STEP 1)')}</div></div><a class="link" href="${esc(a.profile_url)}" target="_blank" rel="noopener">Open</a></div>
        <div class="row"><div class="mid"><div>Invite a friend</div><div>FOMO signup link</div></div><button class="link" id="invite">Share</button></div>
        <div class="row"><div class="mid"><div>Vault</div><div>${esc(a.vault)}</div></div></div>
        <div class="row"><div class="mid"><div>Pushes</div><div>${esc(a.push)}</div></div><button class="link" id="testpush">Send test push</button></div>
        <div class="row"><div class="mid"><div>Notifications</div><div>Home screen only</div></div><button class="link" id="enablepush">Enable</button></div>`;
      $('#invite').onclick = () => navigator.share ? navigator.share({ url: a.signup_url, title: 'FOMO' }) : window.open(a.signup_url);
      $('#testpush').onclick = async () => { try { await api('/push', { method: 'POST', body: JSON.stringify({ test: true }) }); } catch (e) { alert(e.message); } };
      $('#enablepush').onclick = enablePush;
      $('#settings').innerHTML = Object.entries(s.settings).map(([grp, items]) => `<div class="setgroup"><h4>${grp}</h4>${Object.entries(items).map(([k, it]) => {
        const id = grp + '.' + k, num = typeof it.default === 'number';
        return `<div class="setrow"><span>${k.replace(/_/g, ' ')}</span><input ${num ? 'type="number" step="any"' : 'type="text"'} value="${esc(it.value)}" data-key="${id}" ${PLANB ? 'disabled' : ''}>${num ? `<input type="range" min="${it.min}" max="${it.max}" step="${(it.max - it.min) > 50 ? 1 : 0.1}" value="${it.value}" data-range="${id}" ${PLANB ? 'disabled' : ''}>` : ''}</div>`; }).join('')}</div>`).join('');
      $$('[data-range]').forEach(r => r.oninput = () => { $(`[data-key="${r.dataset.range}"]`).value = r.value; });
      $$('[data-range]').forEach(r => r.onchange = () => save(r.dataset.range, r.value));
      $$('[data-key]').forEach(i => i.onchange = () => save(i.dataset.key, i.value));
      const picks = a.picks || [];
      $('#picks').innerHTML = `<div class="card"><div class="row"><div class="mid"><div>Copy picks</div><div>${esc(a.copy_picks)}</div></div></div></div>` +
        (picks.length ? picks.map(p => `<div class="card"><b>#${p.rank} ${esc(p.handle)}</b> <span class="green">7d +$${Math.round(p.pnl_7d)}</span> <span class="green">30d +$${Math.round(p.pnl_30d)}</span><div class="secondary small">${esc(p.why || '')}</div></div>`).join('') : '<div class="card empty">No picks yet (off until STEP 15 passes)</div>');
    } catch (e) { $('#account-top').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  async function save(key, value) { try { await api('/settings', { method: 'POST', body: JSON.stringify({ key, value }) }); } catch (e) { alert(e.message); loadAccount(); } }
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !window.matchMedia('(display-mode: standalone)').matches) { alert('Add Grok Bot to your Home Screen first'); return; }
    alert('Web push needs the VAPID key on the desk; Telegram is the default notifier.');
  }

  // ---------- overlays ----------
  function overlay(html) { $('#overlay-body').innerHTML = `<button class="link" id="ov-close">‹ Back</button>` + html; $('#overlay').hidden = false; $('#ov-close').onclick = () => $('#overlay').hidden = true; }
  function openScreen() { overlay(`<div class="screen-wrap" style="margin-top:8px;border-radius:12px;overflow:hidden;touch-action:pinch-zoom"><img id="ov-screen" style="object-fit:contain"><div id="ov-cursors" class="cursor-layer" aria-hidden="true"></div></div><a class="btn ghost" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${lastState && lastState.positions[0] ? esc(lastState.positions[0].link) : 'https://fomo.family/r/profeta7zz'}" target="_blank" rel="noopener">Open on FOMO</a>`); setImg($('#ov-screen'), screenUrl()); if (lastState && lastState.cursors) renderCursors(lastState.cursors, $('#ov-cursors')); }
  async function openCoin(mint) {
    overlay('<div class="empty">Loading…</div>');
    try { const d = await api('/coin/' + mint); const c = d.coin || {}, p = d.position;
      const age = c.migrated_at ? Math.round((Date.now() / 1000 - c.migrated_at) / 3600) + 'h old' : '';
      const since = p && d.price ? (100 * (d.price / p.entry_price - 1)) : null;
      overlay(`<h2 class="coin-head" style="margin:8px 0 0">${av(c.symbol || c.name, d.image || c.image, mint)}${esc(c.name || c.symbol || mint.slice(0, 6))} <span class="pill orange">${esc(d.mode)}</span></h2>
        <div class="secondary">${esc(c.symbol || '')} · Solana · ${age} ${d.shield ? `<span class="chip">🛡 ${d.shield}</span>` : ''}</div>
        <div class="big" style="font-size:48px;margin-top:8px">${d.price != null ? '$' + Number(d.price).toPrecision(4) : '—'}</div>
        ${since != null ? `<div class="${since >= 0 ? 'green' : 'red'}">${since >= 0 ? '▲' : '▼'} ${Math.abs(since).toFixed(1)}% since entry</div>` : ''}
        <div class="card"><canvas id="cc" height="200" style="width:100%"></canvas><div id="cc-empty" class="empty" hidden>No candles yet</div></div>
        <div class="stats3"><div><small>Market cap</small>${d.market_cap != null ? '$' + Math.round(d.market_cap).toLocaleString() : '—'}</div><div><small>Liquidity</small>${d.liquidity != null ? '$' + Math.round(d.liquidity).toLocaleString() : '—'}</div><div><small>Holders</small>${d.holders ?? '—'}</div></div>${d.score != null ? `<div class="secondary small" style="margin-top:6px">Analyst score ${d.score}</div>` : ''}
        ${p ? `<div class="card">Your position · ${money(p.size_usd)} in · Executor${p.closed_at ? ' · closed: ' + esc(p.exit_reason) : ''}</div>` : ''}
        ${d.layers && d.layers.length ? `<div class="card"><div class="row-head"><span>Audit</span></div><div class="discs">${d.layers.map(l => `<div class="disc ${l.pass === 1 || l.pass === '1' ? 'ok' : l.pass === 0 || l.pass === '0' ? 'bad' : 'na'}"><b>${l.pass === 1 || l.pass === '1' ? '✓' : l.pass === 0 || l.pass === '0' ? '✕' : '·'}</b><span>${esc(l.name || l.layer)}</span><small>${esc(l.value_text || '')}</small></div>`).join('')}</div></div>` : ''}
        ${d.decisions && d.decisions.length ? `<div class="card dec-list"><div class="row-head"><span>Desk work</span></div>${d.decisions.map(r => `<div class="ln"><span class="t mono tertiary">${hms(r.ts)}</span><span class="b" style="color:${CURSOR_COLORS[r.bot] || COLORS[r.bot] || '#fff'}">@${esc(r.bot)}</span><span>${esc(r.text)}</span></div>`).join('')}</div>` : ''}
        <a class="btn ghost" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${esc(d.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>
        ${p && !p.closed_at && !PLANB ? '<button class="btn red" id="sellnow">Sell now</button>' : ''}`);
      $('#cc-empty').hidden = DeskChart.candles($('#cc'), d.candles, p && !p.closed_at ? p.stop_price : null);
      const sb = $('#sellnow'); if (sb) sb.onclick = () => sellSheet(mint, c.symbol);
    } catch (e) { overlay(`<div class="err">${esc(e.message)}</div>`); }
  }
  function sellSheet(mint, sym) {
    $('#sheet-body').innerHTML = `<h3>Sell ${esc(sym)}</h3>${[25, 50, 100].map(p => `<button class="btn ghost" data-pct="${p}">${p}%</button>`).join('')}<button class="btn ghost" id="sh-cancel">Cancel</button>`;
    $('#sheet').hidden = false; $('#sh-cancel').onclick = () => $('#sheet').hidden = true;
    $$('[data-pct]').forEach(b => b.onclick = () => { $('#sheet-body').innerHTML = `<h3>Sell ${b.dataset.pct}% of ${esc(sym)} now?</h3><button class="btn red" id="confirm-sell">Confirm sell</button><button class="btn ghost" id="sh-cancel2">Cancel</button>`;
      $('#sh-cancel2').onclick = () => $('#sheet').hidden = true;
      $('#confirm-sell').onclick = async () => { try { await api('/sell/' + mint, { method: 'POST', body: JSON.stringify({ pct: +b.dataset.pct, confirm: true }) }); } catch (e) { alert(e.message); } $('#sheet').hidden = true; openCoin(mint); }; });
  }
  async function openAudit(mint) {
    overlay('<div class="empty">Loading…</div>');
    try { const d = await api('/audit/' + mint); const c = d.coin || {};
      overlay(`<h2 class="coin-head" style="margin:8px 0 0">${av(c.symbol, d.image || c.image, mint)}${esc(c.symbol || mint.slice(0, 6))} · Audit</h2><div class="discs" id="discs">${d.layers.map(l => `<div class="disc na" data-pass="${l.pass}"><b>${l.layer}</b><span>${esc(l.name)}</span><small>${esc(l.value_text)}</small></div>`).join('') || '<div class="empty">No audit yet</div>'}</div>
        <div class="card">${esc(d.social)}${d.score && d.score.score != null ? ' · score ' + d.score.score : ''}</div>
        <a class="btn ghost" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${esc(d.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`);
      const discs = $$('#discs .disc'); let i = 0;
      const step = () => { if (i > 0) discs[i - 1].classList.remove('beam'); if (i >= discs.length) return; const el = discs[i]; el.classList.add('beam'); el.classList.remove('na');
        const p = el.dataset.pass; el.classList.add(p === '1' ? 'ok' : p === '0' ? 'bad' : 'na'); el.querySelector('b').textContent = p === '1' ? '✓' : p === '0' ? '✕' : '·'; i++; setTimeout(step, 220); };
      setTimeout(step, 200);
    } catch (e) { overlay(`<div class="err">${esc(e.message)}</div>`); }
  }

  // ---------- tabs ----------
  function go(t) { $$('.tab').forEach(x => x.classList.remove('active')); $('#tab-' + t).classList.add('active'); $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === t));
    if (t === 'activity') loadActivity(); if (t === 'account') loadAccount(); if (t === 'bots') loadBots(); window.scrollTo(0, 0); }
  function bindGo() { $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go)); }
  window.__desk = { go, openCoin, openAudit, openScreen };

  // ---------- loops ----------
  async function tick() {
    let wait = PLANB ? PERIOD * 1000 : 2000;
    try { const first = !lastState; renderState(await api('/state')); if (first) loadBots(); loadScreen(); } catch (e) { if (e.message === '401') return; wait = renderError() * 1000; }
    setTimeout(tick, wait);
  }
  if (boot()) {
    botIcons(null); bindGo(); tick(); loadChart(); loadTerminal(); loadTradeDetails(); loadBots(); api('/settings').then(s => window.__set = s.settings).catch(() => { });
    setInterval(loadChart, PLANB ? PERIOD * 1000 : 5000); setInterval(loadTerminal, PLANB ? PERIOD * 1000 : 2000); setInterval(loadTradeDetails, PLANB ? PERIOD * 1000 : 5000);
    setInterval(loadBots, PLANB ? PERIOD * 1000 : 15000); setInterval(loadScreen, PLANB ? PERIOD * 1000 : 1000);
    if ('serviceWorker' in navigator && !FIX) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
