// Desk app (plan B). Reads only the published JSON under d/{DATA_PATH}/ in the public bucket.
// No key, token or data path is in this file: the path arrives once in the URL fragment (#d=...) and lives in
// localStorage on the device. Every FOMO link shown is taken verbatim from the JSON (links.py on the server);
// this file never builds, shortens or wraps one. Write actions are read-only here: they go via Telegram (STEP 9).
(() => {
  'use strict';
  const BASE = 'https://eaggelbvxpglfxsmcldr.supabase.co/storage/v1/object/public/desk';
  const STATE_S = 15, EVENTS_S = 5, SCREEN_S = 15;
  const $ = id => document.getElementById(id);
  const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const safe = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : null;   // pass-through only, never built here
  const ORDER = ['scanner', 'auditor', 'analyst', 'executor', 'risk'];
  const NAMES = {scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk'};
  const COLORS = {scanner: '#64d2ff', auditor: '#ffffff', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a'};

  // ---------- 1. desk link from the fragment -> localStorage, then wipe the fragment ----------
  (function readFragment() {
    const h = location.hash.replace(/^#/, ''); if (!h) return;
    const p = new URLSearchParams(h), d = p.get('d'), t = p.get('t');
    if (d && /^[A-Za-z0-9]{32,64}$/.test(d)) localStorage.setItem('desk_d', d);
    if (t && /^[A-Za-z0-9_\-]{20,200}$/.test(t)) localStorage.setItem('desk_t', t);   // STEP 7 login token: kept on device, unused in plan B
    if (d || t) history.replaceState(null, '', location.pathname + location.search);
  })();
  const D = localStorage.getItem('desk_d');

  // ---------- formatting ----------
  const usd = (v, dp = 2) => v == null || isNaN(v) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(Number(v)).toLocaleString('en-US', {minimumFractionDigits: dp, maximumFractionDigits: dp});
  const usdK = v => { if (v == null || isNaN(v)) return '—'; const a = Math.abs(v);
    return a >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : usd(v); };
  const pct = v => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const price = v => { if (v == null || !(v > 0)) return v === 0 ? '$0' : '—'; if (v >= 1) return usd(v, 4); const dp = Math.min(12, 3 - Math.floor(Math.log10(v))); return '$' + Number(v).toFixed(dp); };
  const hm = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) : '—';
  const hms = d => d ? d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : 'never';
  const short = m => m ? m.slice(0, 4) + '…' + m.slice(-4) : '';
  const left = s => s == null ? '—' : (s >= 3600 ? Math.floor(s / 3600) + 'h ' : '') + Math.floor(s % 3600 / 60) + 'm';

  // ---------- data ----------
  const cache = {};                  // name -> last good JSON (kept on screen while offline)
  let lastOk = null, offline = false, failN = 0, retryAt = 0;
  async function get(name) {
    let r;
    try { r = await fetch(`${BASE}/d/${D}/${name}.json?t=${Date.now()}`, {cache: 'no-store', referrerPolicy: 'no-referrer'}); }
    catch (e) { const n = new Error('network'); n.net = true; throw n; }
    if (r.status === 400 || r.status === 404) { const e = new Error('missing'); e.missing = true; throw e; }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.net = true; throw e; }
    const j = await r.json(); cache[name] = j; return j;
  }
  async function tryGet(name) { try { return await get(name); } catch (e) { if (e.missing) { cache[name] = null; return null; } throw e; } }

  // ---------- error row: one red row under the navbar of the visible screen ----------
  function errRow() {
    const vis = document.querySelector('.tab:not([hidden]) .err-slot'), e = $('err');
    if (!offline) { e.hidden = true; return; }
    const n = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    e.textContent = D ? `Desk offline · retrying in ${n}s · last update ${hms(lastOk)}` : 'Desk offline · no desk link on this device · last update never';
    if (vis && e.parentNode !== vis) vis.appendChild(e);
    e.hidden = false;
  }
  setInterval(errRow, 1000);

  // ---------- odometer ----------
  function odometer(el, text) {
    if (el.dataset.v === text) return;
    const old = el.dataset.v || ''; el.dataset.v = text; el.classList.remove('skel');
    el.setAttribute('aria-label', text);
    const same = old.length === text.length && el.querySelector('.od');
    if (!same || RM()) {
      el.innerHTML = '<span class="od">' + [...text].map(ch => /\d/.test(ch)
        ? `<span class="od-d"><span class="od-s" style="transform:translateY(-${ch}0%)">${[...'0123456789'].map(d => `<span>${d}</span>`).join('')}</span></span>`
        : `<span class="od-c">${esc(ch)}</span>`).join('') + '</span>';
      return;
    }
    const kids = el.querySelector('.od').children, n = text.length;
    let k = 0;
    for (let i = n - 1; i >= 0; i--) {
      const ch = text[i], node = kids[i];
      if (/\d/.test(ch) && node.classList.contains('od-d')) {
        if (ch !== old[i]) { const s = node.firstChild; s.style.transitionDelay = (k * 30) + 'ms'; s.style.transform = `translateY(-${ch}0%)`; k++; }
      } else if (node.textContent !== ch) node.textContent = ch;
    }
  }

  function fitBalance() {
    const el = $('balance'), row = el.parentNode, pill = $('paper');
    el.style.fontSize = '';
    const room = row.clientWidth - (pill.hidden ? 0 : pill.offsetWidth + 12);
    let fs = 66; while (el.scrollWidth > room && fs > 40) { fs -= 2; el.style.fontSize = fs + 'px'; }
  }
  addEventListener('resize', fitBalance);

  // ---------- navigation ----------
  const stack = []; let tab = 'home';
  const visible = () => stack.length ? stack[stack.length - 1].scr : 'tab-' + tab;
  function show(id) {
    document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== id);
    $('tabbar').hidden = id.startsWith('scr-');
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === tab));
    errRow();
  }
  function go(t, anchor) {
    stack.length = 0; tab = t; show('tab-' + t); window.scrollTo(0, 0);
    refreshScreen().then(() => { if (anchor) { const a = $(anchor); if (a) a.scrollIntoView(); } });
  }
  function push(scr, arg) { stack.push({scr, arg}); history.pushState({s: stack.length}, ''); show(scr); window.scrollTo(0, 0); refreshScreen(true); }
  function back() { if (!stack.length) return; stack.pop(); show(visible()); refreshScreen(); }
  addEventListener('popstate', () => { if (stack.length) back(); });

  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-back]'); if (b) { history.back(); return; }
    const c = ev.target.closest('[data-coin]'); if (c && c.dataset.coin) { ev.preventDefault(); push('scr-coin', c.dataset.coin); return; }
    const a = ev.target.closest('[data-audit]'); if (a) { ev.preventDefault(); push('scr-audit', a.dataset.audit); return; }
    const g = ev.target.closest('[data-go]'); if (g) { ev.preventDefault(); go(g.dataset.go, g.dataset.anchor); return; }
    const r = ev.target.closest('[data-range]'); if (r) { range = r.dataset.range; renderRanges(); loadChart(); return; }
    const inv = ev.target.closest('#invite'); if (inv) { invite(inv.dataset.url); return; }
    const ro = ev.target.closest('[data-ro]'); if (ro) { toast(ro.dataset.ro); }
  });
  $('btn-search').onclick = () => push('scr-search');
  $('btn-bell').onclick = () => push('scr-bell');
  $('ranges').querySelectorAll('button').forEach(b => { b.dataset.range = b.dataset.r; });

  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
  async function invite(url) {
    if (!safe(url)) return;
    try { if (navigator.share) { await navigator.share({url}); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Link copied');
  }
  const viaNote = (w, extra) => w && w.readOnly
    ? `<div class="ro-note">${w.writeVia === 'none' ? esc(w.note || 'Not available in plan B') : 'Read-only here · use Telegram' + (w.command || extra ? ': <b>' + esc(extra || w.command) + '</b>' : '')}</div>` : '';

  // ---------- HOME ----------
  let range = 'LIVE';
  function renderRanges() { $('ranges').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.r === range)); }
  async function loadChart() {
    try { const c = await tryGet('chart/' + range); if (c) drawChart(c); } catch (e) { if (cache['chart/' + range]) drawChart(cache['chart/' + range]); }
  }
  function drawChart(c) {
    window.DeskChart.line($('chart'), c);
    $('chart-empty').textContent = c.empty || 'Waiting for the first trade';
    $('chart-empty').hidden = !c.empty && (c.points || []).length > 1;
  }

  function renderState(s) {
    odometer($('balance'), usd(s.balance));
    $('paper').hidden = s.mode !== 'PAPER'; $('coin-paper').hidden = s.mode !== 'PAPER'; fitBalance();
    const t = $('today'); t.classList.remove('skel-i'); t.textContent = pct(s.today_pct); t.className = 'num today ' + ((s.today_pct || 0) >= 0 ? 'green' : 'red');
    const m = $('mult'); m.classList.remove('skel-i'); m.textContent = Number(s.multiplier || 1).toFixed(2) + '×';
    $('updated').textContent = hms(new Date(s.ts));
    const running = ORDER.filter(a => (s.agents || {})[a] && s.agents[a].running).length;
    $('agents-running').textContent = running; $('agents-running').classList.remove('skel-i');
    $('carousel').innerHTML = ORDER.map(a => card(a, (s.cards || {})[a] || {}, s)).join('');
    const an = (s.cards || {}).analyst; const rc = $('ring-analyst'); if (rc && an) window.DeskChart.ring(rc, an.score, an.greenFrom || 70);
    const ex = $('bar-exec'); if (ex) requestAnimationFrame(() => ex.style.width = ex.dataset.w + '%');
  }
  function dot(c) { return `<span class="dot ${c.paused ? 'paused' : c.running ? 'on' : ''}"></span>`; }
  function card(a, c, s) {
    const head = `<div class="card-h"><div class="name" style="color:${COLORS[a]}">${dot(c)}${esc(c.title || NAMES[a])}</div><span class="ter small">${c.paused ? 'paused' : c.running ? 'running' : 'no heartbeat'}</span></div>`;
    let body = '', foot = '';
    if (a === 'scanner') {
      body = `<div class="big num">${c.pools || 0} pool${c.pools === 1 ? '' : 's'}</div>` + (c.feed && c.feed.length
        ? `<div class="feed">${c.feed.slice(0, 5).map(f => `<a class="fr ${f.verdict === 'kill' ? 'kill' : 'pass'}" data-coin="${esc(f.mint)}" href="#"><span class="n">${esc(f.name || short(f.mint))}</span><span class="r">${f.verdict === 'kill' ? esc(f.reason || 'killed') : '→ auditor'}</span></a>`).join('')}</div>`
        : `<div class="lbl">${esc(c.empty || 'Listening for graduations')}</div>`);
    } else if (a === 'auditor') {
      const cur = c.current;
      body = `<div class="big num">${c.takenApart || 0} taken apart</div>` +
        `<div class="strips">${(cur ? cur.strips : Array.from({length: 8}, (_, i) => ({n: i + 1, state: 'idle'}))).map(x => `<div class="strip ${x.state === 'not checked' ? '' : esc(x.state)}">${x.n}</div>`).join('')}</div>` +
        `<div class="lbl" style="margin-top:12px">${cur ? `<a data-audit="${esc(cur.mint)}" href="#">${esc(cur.name)} · ${esc(cur.status)}</a>` : '<a data-audit="" href="#">No coin taken apart yet ›</a>'}</div>`;
      foot = `<span>${c.rejected || 0} rejected</span><span>${c.enabled === false ? 'off' : ''}</span>`;
    } else if (a === 'analyst') {
      body = `<div class="big">${esc(c.label || 'Scoring')}</div><canvas id="ring-analyst" class="ring"></canvas>`;
      foot = `<span>${c.score == null ? 'No coin scored yet' : 'green from ' + (c.greenFrom || 70)}</span><span>${esc(c.mode || '')}</span>`;
    } else if (a === 'executor') {
      const l = c.last, w = l ? (l.status === 'bought' ? 100 : 60) : 0;
      body = `<div class="big num">${c.trades || 0} trades</div>` +
        (l ? `<div class="lbl num">${usd(l.sizeUsd)} · ${esc(l.stackPct)}% of stack</div><div class="bar"><i id="bar-exec" data-w="${w}"></i></div><div class="lbl">${l.status === 'bought' ? '✓ Filled' : 'Executing... ' + w + '%'}</div>`
           : `<div class="lbl">No trade yet tonight · ${esc(c.stackPctSetting)}% of stack per trade</div>`);
    } else if (a === 'risk') {
      body = `<div class="big">${esc(c.label || c.lastExit || 'Guarding')}</div><div class="lbl num">${c.guarding || 0} open position${c.guarding === 1 ? '' : 's'}</div>`;
      foot = `<span class="pills">${(c.pills || []).map(p => `<span class="pill ${p.color === '#00d35a' ? 'green' : 'red'}">${esc(p.text)}</span>`).join('')}</span>`;
    }
    return `<div class="card" data-go="agents" data-anchor="ag-${a}">${head}${body}<div class="foot">${foot}</div></div>`;
  }
  const ACT_ICO = {bought: ['#0a84ff', 'B'], sold: ['#00d35a', 'S'], stopped: ['#ff453a', 'S'], rejected: ['#2c2c2e', '×']};
  function actRow(r) {
    const [col, ch] = ACT_ICO[r.kind] || ['#2c2c2e', '·'];
    const val = r.value || '', cls = r.kind === 'stopped' || /^-/.test(val) ? 'red' : (r.kind === 'sold' && /^\+/.test(val) ? 'green' : 'sec');
    const attr = r.mint ? (r.opens === 'coin' ? `data-coin="${esc(r.mint)}"` : `data-audit="${esc(r.mint)}"`) : '';
    return `<button class="item" ${attr}><span class="ico" style="background:${col};color:${col === '#2c2c2e' ? '#fff' : '#000'}">${ch}</span>
      <span class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></span><span class="v num ${cls}">${esc(val.split(' · ')[0])}${val.includes(' · ') ? `<div class="s">${esc(val.split(' · ').slice(1).join(' · '))}</div>` : ''}</span></button>`;
  }
  function renderHomeActivity(a) {
    $('home-activity').innerHTML = a && a.rows && a.rows.length ? a.rows.slice(0, 5).map(actRow).join('') : `<div class="empty-row">${esc((a && a.empty) || 'Nothing yet tonight')}</div>`;
  }

  // ---------- AGENTS TAB ----------
  async function renderAgents() {
    const s = cache.state || {}, out = [];
    const ds = await Promise.all(ORDER.map(a => tryGet(`agents/${a}/decisions`).catch(() => cache[`agents/${a}/decisions`])));
    ORDER.forEach((a, i) => {
      const c = (s.cards || {})[a] || {}, d = ds[i] || {}, p = d.pause || {readOnly: true, writeVia: 'telegram'};
      const locked = p.locked || (a === 'risk' && c.pauseLocked);
      const cmd = locked ? 'locked while a position is open' : (p.command || c.pauseCommand || `${c.paused ? 'resume' : 'pause'} ${NAMES[a]}`);
      out.push(`<div class="acard" id="ag-${a}"><div class="acard-h">${dot(c)}<span class="nm" style="color:${COLORS[a]}">${esc(c.title || NAMES[a])}</span>
        <span class="sw-wrap" data-ro="${locked ? 'Risk is locked while a position is open' : 'Read-only here · send “' + cmd + '” in Telegram'}"><span class="switch ro ${c.paused ? '' : 'on'}" role="switch" aria-checked="${!c.paused}" aria-disabled="true"></span></span></div>
        <div class="cnt num">${c.paused ? 'Paused' : c.running ? 'Running' : 'No heartbeat'} · ${d.todayCount == null ? '—' : d.todayCount} today</div>
        ${locked ? '<div class="ro-note">Pause is locked while a position is open</div>' : viaNote(p, cmd)}
        ${(d.decisions || []).length ? d.decisions.slice(0, 20).map(x => {
          const bad = /kill|reject|stop|missed|skipped/.test(x.verdict), good = /pass|cleared|bought|trail/.test(x.verdict);
          const u = safe(x.link);
          return `<div class="dec"><span class="tm">${hm(x.time)}</span>${u ? `<a class="cn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(x.coin || short(x.mint))}</a>` : `<span class="cn">${esc(x.coin || short(x.mint))}</span>`}
            <span class="vr ${bad ? 'bad' : good ? 'good' : ''}">${esc(x.verdict)}${x.reason ? ' · ' + esc(x.reason) : ''}</span></div>`; }).join('')
          : `<div class="dec"><span></span><span class="sec">${a === 'scanner' ? 'Listening for graduations' : a === 'auditor' ? 'No coin taken apart yet' : 'No decisions yet'}</span><span></span></div>`}
        <button class="link-row" data-go="account" data-anchor="set-${a}">Settings <span class="chev">›</span></button></div>`);
    });
    $('agents-list').innerHTML = out.join('');
  }

  // ---------- ACTIVITY TAB ----------
  let actRows = [], actOlder = null;
  async function renderActivity(more) {
    if (!more) {
      const a = await tryGet('activity').catch(() => cache.activity);
      actRows = (a && a.rows) || []; actOlder = null;
      if (a && a.before) { const k = Math.floor((a.before - 2) / 30); actOlder = {page: k, before: a.before}; }
    } else if (actOlder) {
      const p = await tryGet('activity/p' + actOlder.page).catch(() => null);
      if (p) { const rows = p.rows.filter(r => r.id < actOlder.before); actRows = actRows.concat(rows);
        const lastId = rows.length ? rows[rows.length - 1].id : actOlder.before;
        actOlder = p.older ? {page: actOlder.page - 1, before: lastId} : null; if (actOlder && actOlder.page < 0) actOlder = null; }
    }
    $('activity-list').innerHTML = actRows.length ? actRows.map(actRow).join('') : `<div class="empty-row">${esc((cache.activity && cache.activity.empty) || 'Nothing yet tonight')}</div>`;
    $('activity-more').hidden = !actOlder;
  }
  $('activity-more').onclick = () => renderActivity(true);

  // ---------- ACCOUNT TAB ----------
  const LBL = {scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', analyst_rules: 'Analyst (rules)', executor: 'Executor', risk: 'Risk', desk: 'Desk'};
  async function renderAccount() {
    const [acc, st] = await Promise.all([tryGet('account').catch(() => cache.account), tryGet('settings').catch(() => cache.settings)]);
    if (!acc) { $('account-body').innerHTML = skelBlocks(4); return; }
    const prof = safe(acc.profile_url), sign = safe(acc.SIGNUP_URL), tg = acc.telegram || {};
    let h = `<div class="group">
      <div class="row" data-ro="Read-only here · send “paper” or “live” in Telegram"><span class="k">Mode</span><span class="seg"><span class="${acc.mode === 'PAPER' ? 'on' : ''}">PAPER</span><span class="${acc.mode === 'LIVE' ? 'on' : ''}">LIVE</span></span></div>
      <div class="row"><span class="k">Stack</span><span class="v num">${usd(acc.stack)}</span></div></div>
      ${viaNote(acc.modeSwitch, 'paper | live')}${acc.modeSwitch && acc.modeSwitch.liveNeeds ? `<div class="ghead">LIVE: ${esc(acc.modeSwitch.liveNeeds)}</div>` : ''}${viaNote(acc.stackEdit)}
      <div class="group">
      ${prof ? `<a class="row" href="${esc(prof)}" target="_blank" rel="noopener noreferrer"><span class="k">Your FOMO profile</span><span class="v">${esc(acc.fomo_handle || '')} <span class="chev">›</span></span></a>` : ''}
      ${sign ? `<button class="row" id="invite" data-url="${esc(sign)}"><span class="k">Invite a friend</span><span class="chev">›</span></button>` : ''}</div>
      <div class="ghead">Telegram</div><div class="group">
      <div class="row"><span class="k">Telegram</span><span class="v ${tg.connected ? 'green' : 'red'}">${tg.connected ? 'Connected' : 'Not connected'}</span></div>
      <div class="row" data-ro="Read-only here · send “test push” in Telegram"><span class="k" style="color:var(--ter)">Send test push</span><span class="v small">via Telegram</span></div></div>
      ${viaNote(tg.testPush)}
      <div class="ghead">Notifications</div><div class="group"><div class="row"><span class="k" style="color:var(--ter)">Enable notifications</span><span class="v small">Not available</span></div></div>
      <div class="ro-note">${esc((acc.webPush && acc.webPush.note) || 'plan B: no web push, Telegram only')}</div>`;
    if (st && st.groups) {
      h += `<div class="ghead">Settings</div>` + viaNote(st, st.command);
      for (const [g, keys] of Object.entries(st.groups)) {
        h += `<div class="ghead" id="set-${esc(g)}">${esc((st.labels || {})[g] || LBL[g] || g)}</div><div class="group">` +
          Object.entries(keys).map(([k, v]) => setRow(k, v)).join('') + '</div>';
      }
      if (st.changeLog && st.changeLog.length) h += `<div class="ghead">Change log</div><div class="group">${st.changeLog.slice(0, 10).map(c => `<div class="row"><span class="k small">${esc(c.key || '')}</span><span class="v small num">${esc(c.old)} → ${esc(c.new)} · ${hm(c.time || c.ts_iso)}</span></div>`).join('')}</div>`;
    }
    $('account-body').innerHTML = h;
  }
  function setRow(k, v) {
    const val = v.value, ro = `data-ro="Read-only here · send “set ${esc(v.key)} to …” in Telegram"`;
    let ctl;
    if (v.kind === 'bool') ctl = `<span class="sw-wrap" ${ro}><span class="switch ro ${val ? 'on' : ''}" aria-disabled="true"></span></span>`;
    else if (v.kind === 'enum') ctl = `<span class="seg" ${ro}>${(v.choices || []).map(c => `<span class="${c === val ? 'on' : ''}">${esc(c)}</span>`).join('')}</span>`;
    else if (typeof val === 'number' && v.min != null && v.max != null) {
      const step = v.kind === 'int' ? 1 : (v.max - v.min <= 1 ? 0.01 : 'any');
      return `<div class="setrow" ${ro}><div class="top"><span>${esc(k)}</span><span class="mm">${esc(v.min)}–${esc(v.max)}</span></div>
        <div class="ctl"><input type="range" min="${v.min}" max="${v.max}" step="${step}" value="${val}" disabled aria-label="${esc(v.key)}"><input class="numf" value="${esc(val)}" disabled aria-label="${esc(v.key)} value"></div></div>`;
    } else ctl = `<input class="numf" value="${esc(val == null ? '' : val)}" disabled aria-label="${esc(v.key)}" style="width:150px">`;
    return `<div class="setrow"><div class="top"><span>${esc(k)}</span>${ctl}</div></div>`;
  }

  // ---------- COIN SCREEN ----------
  async function renderCoin(mint, first) {
    if (first) { $('coin-navt').textContent = ''; $('coin-body').innerHTML = skelBlocks(3, true); }
    let c;
    try { c = await tryGet('coin/' + mint); } catch (e) { c = cache['coin/' + mint]; if (!c) return; }
    if (!c) { $('coin-navt').textContent = short(mint); $('coin-body').innerHTML = `<div class="empty-row">No data for this coin yet</div>`; return; }
    $('coin-navt').textContent = c.name || short(mint);
    const p = c.position, x = c.exitLines, st = c.stats || {}, u = safe(c.coin_url);
    const sh = c.shield ? `<a class="shield ${c.shield === '8/8' ? '' : 'bad'}" data-audit="${esc(mint)}" href="#">${esc(c.shield)}</a>` : `<a class="shield none" data-audit="${esc(mint)}" href="#">not audited</a>`;
    let h = `<div class="coin-h"><span class="nm">${esc(c.name || short(mint))}</span>${sh}</div>
      <div class="coin-sub">${esc(c.subtitle || ((c.symbol || '?') + ' · Solana'))}</div>
      <div class="price num">${price(c.price)}</div>
      ${p && p.open && p.sinceEntryPct != null ? `<div class="since num ${p.sinceEntryPct >= 0 ? 'green' : 'red'}">${p.sinceEntryPct >= 0 ? '▲' : '▼'} ${Math.abs(p.sinceEntryPct).toFixed(2)}% since entry</div>` : `<div class="since sec small">${c.priceAt ? 'price at ' + hm(c.priceAt) : 'No price yet'}</div>`}
      <div class="candle-wrap"><canvas id="candles" aria-label="1-minute candles"></canvas></div>
      <div class="stats"><div><div class="k">Market cap</div><div class="v num">${usdK(st.marketCapUsd)}</div></div><div><div class="k">Liquidity</div><div class="v num">${usdK(st.liquidityUsd)}</div></div>
      <div><div class="k">24h volume</div><div class="v num">${usdK(st.volume24hUsd)}</div></div><div><div class="k">Holders</div><div class="v num">${esc(st.holders == null ? 'n/a' : st.holders)}</div></div></div>`;
    if (p) {
      h += `<div class="pos"><div class="t">Your position · ${usd(p.sizeUsd)} in · ${esc(p.agent || 'Executor')}</div>
        <div class="ln"><span class="sec">Entry</span><span class="num">${price(p.entryPrice)}</span></div>
        ${p.open ? '' : `<div class="ln"><span class="sec">Closed · ${esc(p.exitReason)}</span><span class="num ${(p.pnlUsd || 0) >= 0 ? 'green' : 'red'}">${usd(p.pnlUsd)}</span></div>`}</div>`;
      if (p.open && x) h += `<div class="pos"><div class="t">Exit</div>
        <div class="ln"><span class="sec">Stop line · -${esc(x.stopPct)}%</span><span class="num red">${price(x.stopPrice)}</span></div>
        <div class="ln"><span class="sec">Trail line · ${esc(x.trailPct)}%</span><span class="num ${x.trailActive ? 'green' : 'ter'}">${x.trailActive ? price(x.trailLine) : 'from ' + price(x.trailStartPrice)}</span></div>
        <div class="ln"><span class="sec">Time left to timeout</span><span class="num">${left(x.timeLeftS)}</span></div></div>`;
    }
    if (u) h += `<div class="sticky-cta"><a class="btn-fomo ${p && p.open ? 'sell' : ''}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(c.button || (p && p.open ? 'Sell on FOMO' : 'Buy on FOMO'))}</a></div>`;
    $('coin-body').innerHTML = h;
    window.DeskChart.candles($('candles'), c.candles, x && x.riskTrailingStop, p && p.entryPrice);
  }

  // ---------- AUDITOR SCREEN: 8 discs read by a cyan beam ----------
  let beam = {mint: null, at: 0, timer: 0};
  async function renderAudit(mint, first) {
    if (first) { clearTimeout(beam.timer); beam = {mint, at: 0, timer: 0}; $('audit-body').innerHTML = skelBlocks(3, true); }
    let a = null;
    if (mint) { try { a = await tryGet('audit/' + mint); } catch (e) { a = cache['audit/' + mint]; if (!a && !first) return; } }
    if (!a || a.empty) {
      $('audit-body').innerHTML = `<div class="disc-stage">${Array.from({length: 8}, () => '<div class="disc nc"></div>').join('')}</div>
        <div class="verdict"><div class="h">${esc((a && a.empty) || 'No coin taken apart yet')}</div><div class="s">The Auditor checks 8 layers before anything reaches the Executor.</div></div>`;
      return;
    }
    const u = safe(a.coin_url), t = a.toggle || {};
    const known = a.layers.map(l => l.value != null);
    if (first || !$('disc-stage')) {
      $('audit-body').innerHTML = `<div class="coin-h"><a class="nm" data-coin="${esc(mint)}" href="#">${esc(a.name || short(mint))}</a></div>
        <div class="disc-stage" id="disc-stage">${a.layers.map(l => `<div class="disc" id="disc-${l.n}"><i></i></div>`).join('')}<div class="beam" id="beam"></div></div>
        <div class="verdict" id="verdict"></div><div class="group" id="layers"></div>
        <div class="group"><div class="row" data-ro="Read-only here · send “set auditor.enabled to off” in Telegram (it asks twice)"><span class="k">Take apart before buying</span>
        <span class="sw-wrap"><span class="switch ro ${t.value ? 'on' : ''}" aria-disabled="true"></span></span></div></div>${viaNote(t, 'set auditor.enabled to on|off')}
        ${u ? `<a class="btn-fomo" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ''}`;
      if (RM()) beam.at = 8;
    }
    const paint = () => {
      a.layers.forEach((l, i) => {
        const d = $('disc-' + l.n); if (!d) return; const shown = i < beam.at;
        d.className = 'disc' + (shown ? (l.value === 'not checked' ? ' nc' : l.pass ? ' pass' : ' red') : '');
        d.firstChild.textContent = shown && l.value !== 'not checked' ? (l.pass ? '✓' : '✕') : '';
      });
      $('layers').innerHTML = a.layers.map((l, i) => { const shown = i < beam.at;
        return `<div class="lrow"><span class="st ${shown && l.value !== 'not checked' ? (l.pass ? 'pass' : 'red') : ''}">${shown && l.value !== 'not checked' ? (l.pass ? '✓' : '✕') : l.n}</span>
          <span><div>${esc(l.name)}</div>${shown && l.source ? `<div class="src">${esc(l.source)}</div>` : ''}</span>
          <span class="lv ${!shown || l.value === 'not checked' ? 'nc' : ''}">${shown ? esc(l.value) : (known[i] ? '' : 'waiting…')}</span></div>`; }).join('');
      const done = beam.at >= 8 || (a.result && a.result.status !== 'running' && a.layers.slice(beam.at).every(l => l.value == null || l.value === 'not checked'));
      const r = a.result;
      $('verdict').innerHTML = done && r && r.status !== 'running'
        ? `<div class="h ${r.status === 'rejected' ? 'red' : 'green'}">${esc(r.headline)}</div><div class="s">${esc(r.sub || '')}</div>`
        : `<div class="h">taking apart...</div><div class="s">${a.layersChecked || 0}/8 layers</div>`;
      const bm = $('beam'), stage = $('disc-stage');
      if (bm && stage) { const d = $('disc-' + Math.min(8, beam.at + 1)); bm.classList.toggle('on', !done && !RM());
        if (d) bm.style.top = (d.offsetTop + d.offsetHeight / 2 - 1) + 'px'; }
    };
    const stepBeam = () => {
      paint();
      if (beam.at >= 8 || beam.mint !== mint) return;
      if (!known[beam.at]) return;                 // the server hasn't sent this layer: the beam waits on it
      beam.timer = setTimeout(() => { beam.timer = setTimeout(() => { beam.at++; stepBeam(); }, 150); }, 350);
    };
    clearTimeout(beam.timer); stepBeam();
  }

  // ---------- SEARCH ----------
  $('search-in').addEventListener('input', renderSearch);
  async function renderSearch() {
    const idx = cache.index || await tryGet('index').catch(() => null);
    const q = $('search-in').value.trim().toLowerCase(), coins = (idx && idx.coins) || [];
    const hits = coins.filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q) || c.mint.toLowerCase().includes(q)).slice(0, 50);
    $('search-list').innerHTML = hits.length ? hits.map(c => `<button class="item" data-coin="${esc(c.mint)}"><span class="ico" style="background:#2c2c2e;color:#fff">${esc((c.name || '?')[0])}</span>
      <span class="mid"><div class="t">${esc(c.name || short(c.mint))}</div><div class="s">${esc(c.symbol ? c.symbol + ' · ' : '')}${esc(short(c.mint))}</div></span><span class="v sec small">${c.audit ? 'audited' : ''}</span></button>`).join('')
      : `<div class="empty-row">${coins.length ? 'No coin matches' : 'No coins seen tonight yet'}</div>`;
  }

  // ---------- BELL: unread pushes (signal, fill, exit) ----------
  const PUSH = ['signal', 'fill', 'exit'];
  const seen = () => Number(localStorage.getItem('desk_seen') || 0);
  const coinName = m => { const c = ((cache.index || {}).coins || []).find(x => x.mint === m); return c ? c.name : short(m); };
  function pushText(e) {
    const n = e.name || coinName(e.mint), sign = (e.pnlUsd || 0) >= 0 ? '+' : '-';
    if (e.kind === 'signal') return `Buy ${n} · ${usd(e.sizeUsd)}${e.stackPct != null ? ' · ' + e.stackPct + '% of stack' : ''}`;
    if (e.kind === 'fill') return `Bought ${n} · ${usd(e.sizeUsd)}`;
    if (e.reason === 'stop') return `${n} hit the -${e.stopPct}% stop · -${usd(Math.abs(e.pnlUsd || 0)).slice(1)}`;
    return `Sold ${n} · ${sign}${usd(Math.abs(e.pnlUsd || 0))} (${e.pct >= 0 ? '+' : ''}${Number(e.pct || 0).toFixed(1)}%)`;
  }
  function renderBellDot() { const ev = (cache.events && cache.events.events) || []; $('bell-dot').hidden = !ev.some(e => PUSH.includes(e.kind) && e.seq > seen()); }
  function renderBell() {
    const ev = ((cache.events && cache.events.events) || []).filter(e => PUSH.includes(e.kind)).reverse(), s = seen();
    $('bell-list').innerHTML = ev.length ? ev.map(e => { const u = safe(e.link);
      return `<div class="item"><span class="ico" style="background:${e.kind === 'exit' ? ((e.pnlUsd || 0) >= 0 ? '#00d35a' : '#ff453a') : '#0a84ff'}">${e.seq > s ? '•' : ''}</span>
        <span class="mid" data-coin="${esc(e.mint || '')}"><div class="t">Grok Bot · ${hm(e.ts)}</div><div class="s">${e.mode === 'PAPER' ? 'PAPER · ' : ''}${esc(pushText(e))}</div></span>
        ${u ? `<a class="v" style="color:var(--green);min-height:44px;display:flex;align-items:center" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${e.kind === 'exit' ? 'Sell on FOMO' : 'Buy on FOMO'}</a>` : ''}</div>`; }).join('')
      : `<div class="empty-row">No pushes yet tonight</div>`;
    const top = (cache.events && cache.events.lastSeq) || 0; if (top > s) localStorage.setItem('desk_seen', String(top)); renderBellDot();
  }

  // ---------- loading blocks in the final layout ----------
  function skelBlocks(n, coin) {
    return (coin ? '<div class="skel-block" style="height:34px;width:60%;margin-top:12px"></div><div class="skel-block" style="height:52px;width:50%;margin-top:12px"></div><div class="skel-block" style="height:240px;margin-top:12px"></div>' : '') +
      Array.from({length: n}, () => '<div class="skel-block" style="height:64px;margin-top:12px"></div>').join('');
  }
  function loadingLayout() {
    $('carousel').innerHTML = Array.from({length: 2}, () => '<div class="card skel-block"></div>').join('');
    $('home-activity').innerHTML = Array.from({length: 3}, () => '<div class="item"><span class="ico skel-block"></span><span class="mid"><div class="skel-i" style="width:55%">x</div><div class="skel-i" style="width:35%;margin-top:4px">x</div></span></div>').join('');
    $('agents-list').innerHTML = skelBlocks(5).replace(/height:64px/g, 'height:180px');
    $('activity-list').innerHTML = Array.from({length: 6}, () => '<div class="item"><span class="ico skel-block"></span><span class="mid"><div class="skel-i" style="width:55%">x</div></span></div>').join('');
    $('account-body').innerHTML = skelBlocks(5);
    window.DeskChart.line($('chart'), {points: []});
  }

  // ---------- refresh loop ----------
  async function refreshScreen(first) {
    if (!D) return;
    const v = visible(), top = stack[stack.length - 1];
    try {
      if (v === 'tab-home') { if (cache.state) renderState(cache.state); await loadChart(); renderHomeActivity(await tryGet('activity')); }
      else if (v === 'tab-agents') await renderAgents();
      else if (v === 'tab-activity') await renderActivity(false);
      else if (v === 'tab-account') await renderAccount();
      else if (v === 'scr-coin') await renderCoin(top.arg, first);
      else if (v === 'scr-audit') await renderAudit(top.arg, first);
      else if (v === 'scr-search') { if (first) $('search-in').value = ''; await tryGet('index'); await renderSearch(); }
      else if (v === 'scr-bell') renderBell();
    } catch (e) { if (e && e.net) fail(); else console.error(e); }
  }
  function fail() { if (offline && retryAt > Date.now()) return; failN++; offline = true; retryAt = Date.now() + Math.min(STATE_S * failN, 60) * 1000; errRow(); }
  let stateT = 0;
  async function pollState() {
    clearTimeout(stateT);
    try {
      const s = await get('state');
      try { renderState(s); } catch (err) { console.error(err); }
      const age = (Date.now() - new Date(s.ts).getTime()) / 1000;
      if (age > STATE_S * 4) throw new Error('stale');
      lastOk = new Date(s.ts); offline = false; failN = 0; errRow();
      stateT = setTimeout(pollState, STATE_S * 1000);
    } catch (e) {
      if (cache.state) lastOk = lastOk || new Date(cache.state.ts);
      fail(); stateT = setTimeout(pollState, retryAt - Date.now());
    }
  }
  let lastSeq = 0;
  async function pollEvents() {
    try {
      const e = await get('events');
      if (e.lastSeq !== lastSeq) {
        const fresh = (e.events || []).filter(x => x.seq > lastSeq); lastSeq = e.lastSeq;
        if (fresh.some(x => x.kind === 'balance')) { const b = fresh.filter(x => x.kind === 'balance').pop(); if (cache.state && b.value != null) { odometer($('balance'), usd(b.value)); fitBalance(); } }
        renderBellDot();
        const v = visible(), top = stack[stack.length - 1];
        if (v === 'scr-audit' && fresh.some(x => x.kind === 'audit_layer' && top && x.mint === top.arg)) renderAudit(top.arg);
        if (v === 'tab-home' && fresh.some(x => x.kind !== 'audit_layer')) pollState();
      }
    } catch (err) { /* state.json drives the offline row */ }
    setTimeout(pollEvents, EVENTS_S * 1000);
  }
  setInterval(() => { if (D && !offline) refreshScreen(); }, SCREEN_S * 1000);
  addEventListener('resize', () => { if (cache['chart/' + range]) drawChart(cache['chart/' + range]); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && D) { pollState(); refreshScreen(); } });

  // ---------- start ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  renderRanges();
  if (!D) {
    offline = true; errRow();
    // iOS keeps home-screen storage apart from Safari: the owner pastes the desk link once.
    const box = document.createElement('div'); box.className = 'group'; box.id = 'paste-box';
    box.innerHTML = '<div class="row"><input id="paste" placeholder="Paste your desk link" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-height:44px;background:none;border:0;color:#fff;font:inherit"></div>';
    $('tab-home').querySelector('.err-slot').after(box);
    $('paste').addEventListener('change', e => { const mm = e.target.value.match(/#(?:.*&)?d=([A-Za-z0-9]{32,64})/);
      if (mm) { localStorage.setItem('desk_d', mm[1]); location.reload(); } else toast('That is not a desk link'); });
    loadingLayout(); $('balance').textContent = '—'; $('balance').classList.remove('skel');
    $('today').textContent = ''; $('mult').hidden = true; $('agents-running').textContent = '—'; $('agents-running').classList.remove('skel-i');
    $('home-activity').innerHTML = '<div class="empty-row">Open your desk link once on this device</div>';
    $('carousel').innerHTML = ''; return;
  }
  loadingLayout();
  pollState().then(() => { refreshScreen(); tryGet('index').catch(() => {}); pollEvents(); });
})();
