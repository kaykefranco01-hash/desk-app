// Desk app (plan B): polls static JSON under the secret data path. No keys, no tokens in this file.
(() => {
  const BASE = 'https://eaggelbvxpglfxsmcldr.supabase.co/storage/v1/object/public/desk';
  const POLL_S = 15;
  const $ = id => document.getElementById(id);
  const AGENTS = [['scanner','Scanner','#64d2ff','Listening for graduations'],['auditor','Auditor','#fff','No coin taken apart yet'],
    ['analyst','Analyst','#ffd60a','Scoring'],['executor','Executor','#00d35a','0 trades'],['risk','Risk','#ff6b9a','Guarding']];

  // 1. read #d={DATA_PATH} once, keep it in localStorage, wipe the fragment from the address bar
  const m = location.hash.match(/(?:^#|&)d=([A-Za-z0-9]{32,64})/);
  if (m) { localStorage.setItem('desk_d', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  const D = localStorage.getItem('desk_d');

  let last = null, lastOkAt = null, failCount = 0, countdown = 0, timer = null;
  const fmtUsd = v => '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const fmtTime = d => d ? d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : 'never';

  function showErr(msg) { const e = $('err'); e.textContent = msg; e.hidden = false; }
  function hideErr() { $('err').hidden = true; }

  function render(s) {
    const b = $('balance'); b.classList.remove('skel'); b.textContent = fmtUsd(s.balance);
    $('paper').hidden = s.mode !== 'PAPER';
    const pct = Number(s.today_pct || 0); $('today').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    $('mult').textContent = Number(s.multiplier || 1).toFixed(2) + '×';
    $('updated').textContent = fmtTime(new Date(s.ts));
    $('hosting-note').hidden = !s.hosting_test;
    const has = window.DeskChart.line($('chart'), [], s.night_start);
    $('chart-empty').hidden = has;
    const ag = s.agents || {}; let running = 0;
    const cards = AGENTS.map(([k, name, color, idle]) => {
      const a = ag[k] || {}; if (a.running) running++;
      return `<div class="card"><div class="name" style="color:${color}"><span class="dot ${a.running ? 'on' : ''}"></span>${name}</div>
        <div class="big">${idle}</div><div class="st num">${a.running ? 'running' : 'no heartbeat'}${a.heartbeat ? ' · ' + fmtTime(new Date(a.heartbeat)) : ''}</div></div>`;
    }).join('');
    $('carousel').innerHTML = cards; $('agents-list').innerHTML = cards; $('agents-running').textContent = running;
    $('acc-mode').textContent = s.mode;
    if (s.account) { $('acc-profile').href = s.account.profile_url; $('acc-invite').dataset.url = s.account.signup_url; }
    if (s.settings) $('acc-settings').innerHTML = Object.entries(s.settings).map(([k, v]) =>
      `<div class="row"><span class="k">${k}</span><span class="v num">${v === null ? '—' : String(v)}</span></div>`).join('');
  }

  async function poll() {
    clearInterval(timer);
    if (!D) {
      showErr('Desk offline · no desk link on this device · last update never');
      // iOS keeps home-screen storage apart from Safari: let the owner paste the desk link once here.
      const box = document.createElement('div'); box.className = 'group';
      box.innerHTML = '<div class="row"><input id="paste" placeholder="Paste your desk link" autocomplete="off" style="flex:1;min-height:44px;background:none;border:0;color:#fff;font:inherit"></div>';
      document.querySelector('#tab-home').prepend(box);
      $('paste').addEventListener('change', e => { const mm = e.target.value.match(/#d=([A-Za-z0-9]{32,64})/);
        if (mm) { localStorage.setItem('desk_d', mm[1]); location.reload(); } });
      return;
    }
    try {
      const r = await fetch(`${BASE}/d/${D}/state.json?t=${Date.now()}`, {cache: 'no-store'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const s = await r.json();
      const age = (Date.now() - new Date(s.ts).getTime()) / 1000;
      last = s; lastOkAt = new Date(s.ts); render(s);
      if (age > POLL_S * 4) throw new Error('stale');
      failCount = 0; hideErr(); setTimeout(poll, POLL_S * 1000);
    } catch (e) {
      failCount++; countdown = Math.min(POLL_S * failCount, 60);
      const tick = () => { showErr(`Desk offline · retrying in ${countdown}s · last update ${fmtTime(lastOkAt)}`);
        if (countdown-- <= 0) { clearInterval(timer); poll(); } };
      tick(); timer = setInterval(tick, 1000);
    }
  }

  // tabs
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-go]'); if (!t) return;
    const go = t.dataset.go;
    document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== 'tab-' + go);
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === go));
    window.scrollTo(0, 0);
  });
  $('acc-invite').addEventListener('click', async () => {
    const url = $('acc-invite').dataset.url; if (!url) return;
    if (navigator.share) { try { await navigator.share({url}); } catch (_) {} }
    else { await navigator.clipboard.writeText(url); $('acc-invite').firstChild.textContent = 'Link copied '; }
  });
  window.addEventListener('resize', () => last && render(last));

  // loading state: skeleton blocks are in the markup until the first good read
  $('carousel').innerHTML = AGENTS.map(() => '<div class="card skel"></div>').join('');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  poll();
})();
