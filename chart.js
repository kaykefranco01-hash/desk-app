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
  const FONT = '600 12px -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif';

  // ---- Home line chart: green line + gradient fill, dashed start line, marks that never overlap ----
  const lineState = new WeakMap();
  function drawLine(canvas, data, prog, markAlpha) {
    if (!canvas.clientWidth) return (data.points || []).length > 1;
    const {c, w, h} = setup(canvas);
    const pts = data.points || [], start = data.startValue;
    const top = 26, bot = 18, padX = 16;
    if (pts.length < 2) {
      c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(padX, h * 0.55); c.lineTo(w - padX, h * 0.55); c.stroke(); c.setLineDash([]);
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
    const nRows = 3, markH = 18;
    const X = t => padX + (w - 2 * padX) * (x1 === x0 ? 1 : (t - x0) / (x1 - x0));
    const Y = v => (h - bot) - (h - bot - top - nRows * markH) * ((v - y0) / (y1 - y0));
    if (start != null) {
      c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(padX, Y(start)); c.lineTo(w - padX, Y(start)); c.stroke(); c.setLineDash([]);
    }
    const g = c.createLinearGradient(0, top, 0, h); g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
    c.beginPath(); use.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.strokeStyle = '#00d35a'; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    const last = use[use.length - 1];
    c.lineTo(X(last[0]), h); c.lineTo(X(use[0][0]), h); c.closePath(); c.fillStyle = g; c.fill();
    // marks: above the line; a later mark that would overlap moves up a row
    c.font = FONT; c.textBaseline = 'middle';
    const placed = [];
    const valAt = t => { let best = pts[0]; for (const p of pts) { if (p[0] <= t) best = p; } return best[1]; };
    for (const m of (data.marks || []).slice().sort((a, b) => a.ts - b.ts)) {
      if (m.ts < x0 || m.ts > x1 + 60) continue;
      const tw = c.measureText(m.label).width + 14, cx = Math.min(Math.max(X(Math.min(m.ts, x1)), padX + tw / 2), w - padX - tw / 2);
      let row = 0;
      while (placed.some(p => p.row === row && Math.abs(p.cx - cx) < (p.tw + tw) / 2 + 4)) row++;
      placed.push({cx, tw, row});
      const baseY = Math.min(Y(valAt(m.ts)) - 16, h - bot - 16);
      const y = Math.max(10, baseY - row * markH);
      const a = markAlpha(m);
      c.globalAlpha = a;
      c.fillStyle = m.color + '2e'; roundRect(c, cx - tw / 2, y - 9, tw, 18, 9); c.fill();
      c.fillStyle = m.color; c.fillText(m.label, cx - tw / 2 + 7, y + 0.5);
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
