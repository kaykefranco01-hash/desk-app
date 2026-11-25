/* Hand-drawn canvas charts, devicePixelRatio aware. No libraries. */
window.DeskChart = (function () {
  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight || +cv.getAttribute('height');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return [c, w, h];
  }
  function line(cv, data) {
    const [c, w, h] = setup(cv);
    const pts = data.points || [];
    if (pts.length < 2) return false;
    const pad = { t: 22, b: 8, l: 4, r: 4 };
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat([data.startValue || pts[0][1]]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), dy = (y1 - y0) || 1;
    const X = t => pad.l + (t - x0) / ((x1 - x0) || 1) * (w - pad.l - pad.r);
    const Y = v => pad.t + (1 - (v - y0) / dy) * (h - pad.t - pad.b);
    const up = pts[pts.length - 1][1] >= (data.startValue || pts[0][1]);
    const col = up ? '#00d35a' : '#ff453a';
    if (data.startValue) { c.setLineDash([3, 4]); c.strokeStyle = 'rgba(235,235,245,.3)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, Y(data.startValue)); c.lineTo(w, Y(data.startValue)); c.stroke(); c.setLineDash([]); }
    const g = c.createLinearGradient(0, pad.t, 0, h); g.addColorStop(0, up ? 'rgba(0,211,90,.28)' : 'rgba(255,69,58,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.lineTo(X(x1), h); c.lineTo(X(x0), h); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    const last = pts[pts.length - 1]; c.fillStyle = col; c.beginPath(); c.arc(X(last[0]), Y(last[1]), 3.5, 0, 7); c.fill();
    c.font = '600 11px -apple-system,system-ui'; c.textAlign = 'center';
    (data.marks || []).forEach(m => {
      if (m.ts < x0 || m.ts > x1) return;
      let v = pts[0][1]; for (const p of pts) { if (p[0] <= m.ts) v = p[1]; else break; }
      const color = m.kind === 'bought' || m.kind === 'copied' ? '#0a84ff' : (String(m.label).startsWith('-') ? '#ff453a' : '#00d35a');
      c.fillStyle = color; c.beginPath(); c.arc(X(m.ts), Y(v), 3, 0, 7); c.fill();
      c.fillText(String(m.label).slice(0, 18), Math.min(Math.max(X(m.ts), 40), w - 40), Math.max(Y(v) - 8, 11));
    });
    return true;
  }
  function candles(cv, cs, exitLine) {
    const [c, w, h] = setup(cv);
    if (!cs || !cs.length) return false;
    const lo = Math.min(...cs.map(k => k.l), exitLine || Infinity), hi = Math.max(...cs.map(k => k.h)), d = (hi - lo) || 1;
    const Y = v => 8 + (1 - (v - lo) / d) * (h - 16), bw = Math.max(2, (w - 8) / cs.length - 2);
    cs.forEach((k, i) => { const x = 4 + i * (bw + 2), col = k.c >= k.o ? '#00d35a' : '#ff453a'; c.strokeStyle = c.fillStyle = col;
      c.beginPath(); c.moveTo(x + bw / 2, Y(k.h)); c.lineTo(x + bw / 2, Y(k.l)); c.stroke(); c.fillRect(x, Y(Math.max(k.o, k.c)), bw, Math.max(1, Math.abs(Y(k.o) - Y(k.c)))); });
    if (exitLine) { c.setLineDash([5, 4]); c.strokeStyle = '#ff9f0a'; c.beginPath(); c.moveTo(0, Y(exitLine)); c.lineTo(w, Y(exitLine)); c.stroke(); c.setLineDash([]); }
    return true;
  }
  return { line, candles };
})();
