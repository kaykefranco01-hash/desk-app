// Hand-drawn <canvas> charts: Home line, Coin candles, Analyst score ring. No chart library. devicePixelRatio aware.
(() => {
  const RM = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    return {c, w, h};
  }
  const FAM = '-apple-system, "SF Pro Text", BlinkMacSystemFont, Inter, "Helvetica Neue", sans-serif';
  const FONT = '600 12px ' + FAM;

  // ---- Home line chart: green when the book is at/above the night start, red in drawdown; gradient fill; trade dots
  // with floating labels ("COIN bought $x" blue, "COIN sold +$x" green, "COIN stop -$x" red) that never overlap ----
  const lineState = new WeakMap();
  const money = v => '$' + Math.abs(Number(v)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  function markText(m) {   // [coin, action] from the mark's fields; falls back to the server label
    if (!m.name) return [null, m.label || ''];
    const u = m.usd;
    if (m.kind === 'bought') return [m.name, 'bought' + (u != null ? ' ' + money(u) : '')];
    if (m.kind === 'stop') return [m.name, 'stop ' + (u != null ? '-' + money(u) : '')];
    return [m.name, 'sold ' + (u != null ? (u >= 0 ? '+' : '-') + money(u) : '')];
  }
  function markColor(m) {
    if (m.kind === 'bought') return '#0a84ff';
    if (m.usd != null) return m.usd >= 0 ? '#30d158' : '#ff453a';
    return m.color || '#30d158';
  }
  function drawLine(canvas, data, prog, markAlpha) {
    if (!canvas.clientWidth) return (data.points || []).length > 1;
    const {c, w, h} = setup(canvas);
    const pts = data.points || [], start = data.startValue;
    const top = 8, bot = 14, padX = 14, markH = 40, nRows = 2;
    if (pts.length < 2) {
      c.strokeStyle = 'rgba(235,235,245,0.25)'; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(padX, h * 0.6); c.lineTo(w - padX, h * 0.6); c.stroke(); c.setLineDash([]);
      return false;
    }
    let use = pts;
    if (prog < 1 && pts.length > 2) {            // new point slides in
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      use = pts.slice(0, -1).concat([[a[0] + (b[0] - a[0]) * prog, a[1] + (b[1] - a[1]) * prog]]);
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat(start != null ? [start] : []);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.08; y0 -= pad;
    const X = t => padX + (w - 2 * padX - 8) * (x1 === x0 ? 1 : (t - x0) / (x1 - x0));
    const Y = v => (h - bot) - (h - bot - top - nRows * markH) * ((v - y0) / (y1 - y0));
    const lastV = pts[pts.length - 1][1], up = start == null || lastV >= start;
    const col = up ? '#30d158' : '#ff453a', rgb = up ? '48,209,88' : '255,69,58';
    if (start != null) {
      c.strokeStyle = 'rgba(235,235,245,0.18)'; c.lineWidth = 1; c.setLineDash([3, 5]);
      c.beginPath(); c.moveTo(padX, Y(start)); c.lineTo(w - padX, Y(start)); c.stroke(); c.setLineDash([]);
    }
    const yTop = Math.min(...use.map(p => Y(p[1])));
    const g = c.createLinearGradient(0, yTop, 0, h); g.addColorStop(0, `rgba(${rgb},0.30)`); g.addColorStop(0.7, `rgba(${rgb},0.06)`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.beginPath(); use.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.save(); c.shadowColor = `rgba(${rgb},0.55)`; c.shadowBlur = 8;
    c.strokeStyle = col; c.lineWidth = 2.2; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); c.restore();
    const last = use[use.length - 1];
    c.lineTo(X(last[0]), h); c.lineTo(X(use[0][0]), h); c.closePath(); c.fillStyle = g; c.fill();
    // live head dot
    c.fillStyle = `rgba(${rgb},0.25)`; c.beginPath(); c.arc(X(last[0]), Y(last[1]), 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(X(last[0]), Y(last[1]), 3.6, 0, Math.PI * 2); c.fill();
    // trade markers: dot on the line + dashed stem + a two-line label card above
    const valAt = t => { let best = pts[0]; for (const p of pts) { if (p[0] <= t) best = p; } return best[1]; };
    const placed = [];
    for (const m of (data.marks || []).slice().sort((a, b) => a.ts - b.ts)) {
      if (m.ts < x0 || m.ts > x1 + 60) continue;
      const [coin, act] = markText(m), mc = markColor(m), a = markAlpha(m);
      const mx = X(Math.min(m.ts, x1)), my = Y(valAt(m.ts));
      c.font = '700 12px ' + FAM; const w1 = coin ? c.measureText(coin).width + (m.mult ? c.measureText(m.mult.toFixed(2) + 'x').width + 14 : 0) : 0;
      c.font = '600 12px ' + FAM; const w2 = c.measureText(act).width;
      const tw = Math.max(w1, w2) + 18, th = coin ? 34 : 20;
      const cx = Math.min(Math.max(mx, padX + tw / 2), w - padX - tw / 2);
      let row = 0;
      while (row < 6 && placed.some(p => p.row === row && Math.abs(p.cx - cx) < (p.tw + tw) / 2 + 4)) row++;
      placed.push({cx, tw, row});
      const ly = Math.max(2, Math.min(my - th - 14, top + (nRows - 1) * markH + 4) - row * (th + 4));
      c.globalAlpha = a;
      c.strokeStyle = mc + '99'; c.lineWidth = 1; c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(mx, ly + th); c.lineTo(mx, my - 5); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(10,10,12,0.92)'; roundRect(c, cx - tw / 2, ly, tw, th, 9); c.fill();
      c.fillStyle = mc + '26'; roundRect(c, cx - tw / 2, ly, tw, th, 9); c.fill();
      c.strokeStyle = mc; c.lineWidth = 1.2; roundRect(c, cx - tw / 2 + .5, ly + .5, tw - 1, th - 1, 9); c.stroke();
      c.textBaseline = 'middle'; let tx = cx - tw / 2 + 9;
      if (coin) {
        c.font = '700 12px ' + FAM; c.fillStyle = '#fff'; c.fillText(coin, tx, ly + 10);
        if (m.mult) { const bx = tx + c.measureText(coin).width + 6, bt = m.mult.toFixed(2) + 'x'; c.font = '700 10px ' + FAM;
          const bw = c.measureText(bt).width + 8; c.fillStyle = mc + '40'; roundRect(c, bx, ly + 3.5, bw, 13, 6); c.fill(); c.fillStyle = mc; c.fillText(bt, bx + 4, ly + 10.5); }
        c.font = '600 12px ' + FAM; c.fillStyle = mc; c.fillText(act, tx, ly + 24);
      } else { c.font = '600 12px ' + FAM; c.fillStyle = mc; c.fillText(act, tx, ly + th / 2 + .5); }
      c.fillStyle = '#000'; c.beginPath(); c.arc(mx, my, 5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = mc; c.lineWidth = 2; c.beginPath(); c.arc(mx, my, 4.2, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
    return true;
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function line(canvas, data) {
    const st = lineState.get(canvas) || {n: 0, seen: new Set(), born: new Map()};
    const n = (data.points || []).length, grew = st.n && n > st.n;
    st.n = n; lineState.set(canvas, st);
    const now = performance.now();
    for (const m of data.marks || []) { const k = m.ts + m.label; if (!st.seen.has(k)) { st.seen.add(k); st.born.set(k, RM() ? 0 : now); } }
    const alpha = m => { const b = st.born.get(m.ts + m.label) || 0; return Math.min(1, (performance.now() - b) / 200); };
    if (RM() || !grew) { const r = drawLine(canvas, data, 1, alpha); animMarks(canvas, data, alpha); return r; }
    const t0 = performance.now();
    const step = () => { const p = Math.min(1, (performance.now() - t0) / 250); drawLine(canvas, data, p, alpha); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); return n >= 2;
  }
  function animMarks(canvas, data, alpha) {
    if (!(data.marks || []).some(m => alpha(m) < 1)) return;
    const step = () => { drawLine(canvas, data, 1, alpha); if ((data.marks || []).some(m => alpha(m) < 1)) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ---- Coin candles (1-min OHLC from db.prices) + volume bars + orange dashed "Risk trailing stop" ----
  function candles(canvas, cs, riskLine, entry) {
    if (!canvas || !canvas.clientWidth) return false;
    const {c, w, h} = setup(canvas);
    const padX = 16, volH = h * 0.18, top = 14, bot = volH + 18;
    if (!cs || !cs.length) {
      c.fillStyle = 'rgba(235,235,245,0.6)'; c.font = '15px -apple-system, sans-serif'; c.textAlign = 'center';
      c.fillText('No candles yet', w / 2, h / 2); c.textAlign = 'left'; return false;
    }
    const lows = cs.map(k => k.l).concat(riskLine ? [riskLine] : []).concat(entry ? [entry] : []);
    const highs = cs.map(k => k.h).concat(riskLine ? [riskLine] : []).concat(entry ? [entry] : []);
    let lo = Math.min(...lows), hi = Math.max(...highs); if (hi - lo <= 0) { hi *= 1.01; lo *= 0.99; }
    const Y = v => top + (h - bot - top) * (1 - (v - lo) / (hi - lo));
    const n = Math.max(cs.length, 20), slot = (w - 2 * padX) / n, bw = Math.max(2, slot * 0.62);
    const vmax = Math.max(...cs.map(k => k.v || 0), 1e-9);
    cs.forEach((k, i) => {
      const x = padX + slot * (n - cs.length + i) + slot / 2, up = k.c >= k.o, col = up ? '#00d35a' : '#ff453a';
      c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x, Y(k.h)); c.lineTo(x, Y(k.l)); c.stroke();
      const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      c.fillStyle = col; c.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
      const vh = (k.v || 0) / vmax * (volH - 4);
      c.fillStyle = up ? 'rgba(0,211,90,0.35)' : 'rgba(255,69,58,0.35)'; c.fillRect(x - bw / 2, h - vh - 2, bw, vh);
    });
    if (riskLine) {
      c.strokeStyle = '#ff9f0a'; c.setLineDash([6, 4]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(padX, Y(riskLine)); c.lineTo(w - padX, Y(riskLine)); c.stroke(); c.setLineDash([]);
      c.font = FONT; c.fillStyle = '#ff9f0a'; c.fillText('Risk trailing stop', padX + 4, Y(riskLine) - 8);
    }
    return true;
  }

  // ---- Analyst score ring 0-100, green from the setting ----
  function ring(canvas, score, greenFrom) {
    if (!canvas || !canvas.clientWidth) return;
    const {c, w, h} = setup(canvas);
    const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    if (r <= 4) return;
    c.lineWidth = 10; c.lineCap = 'round';
    c.strokeStyle = '#2c2c2e'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    if (score != null) {
      c.strokeStyle = score >= greenFrom ? '#00d35a' : '#ffd60a';
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); c.stroke();
    }
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 ' + Math.round(r * 0.7) + 'px -apple-system, "SF Pro Display", sans-serif';
    c.fillText(score == null ? '—' : String(score), cx, cy + 1);
    c.textAlign = 'left';
  }
  window.DeskChart = {line, candles, ring};
})();
