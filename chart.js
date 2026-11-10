// Hand-drawn canvas charts. No chart library. devicePixelRatio aware.
window.DeskChart = {
  line(canvas, points, startValue) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const midY = h * 0.55;
    // dashed start line
    c.strokeStyle = 'rgba(235,235,245,0.3)'; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(16, midY); c.lineTo(w - 16, midY); c.stroke(); c.setLineDash([]);
    if (!points || points.length < 2) return false;
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]).concat([startValue]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = t => 16 + (w - 32) * (x1 === x0 ? 1 : (t - x0) / (x1 - x0));
    const Y = v => h - 16 - (h - 32) * (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0));
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(235,235,245,0.3)'; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(16, Y(startValue)); c.lineTo(w - 16, Y(startValue)); c.stroke(); c.setLineDash([]);
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,211,90,0.25)'); g.addColorStop(1, 'rgba(0,211,90,0)');
    c.beginPath(); points.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
    c.strokeStyle = '#00d35a'; c.lineWidth = 2; c.stroke();
    c.lineTo(X(x1), h); c.lineTo(X(x0), h); c.closePath(); c.fillStyle = g; c.fill();
    return true;
  }
};
