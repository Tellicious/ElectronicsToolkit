/* SensorKit — live X-Y plot for fast-updating data (scope, spectrum).
 *
 * Unlike TimeSeriesChart (which accumulates and supports pan/zoom), this
 * replaces its data every frame via setData(xs, ys). Supports a log-x axis
 * (spectra), optional fixed y-range, peak markers, and a scrub crosshair.
 */
(function (root) {
  'use strict';

  const PAD = { l: 44, r: 8, t: 8, b: 18 };
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  class LivePlot {
    constructor(container, opts = {}) {
      this.opts = Object.assign({
        color: '#0a84ff', logX: false, fill: false, yMin: null, yMax: null, symmetric: true,
        fmtY: v => v.toFixed(0), fmtX: v => String(Math.round(v)), empty: 'Waiting for audio…',
      }, opts);
      this.container = container;
      this.xs = null; this.ys = null; this.peaks = null; this.hoverX = null; this._raf = 0;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sk-canvas';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this._bind();
      if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(container); }
      this.resize();
    }
    _bind() {
      const cv = this.canvas, xat = e => e.clientX - cv.getBoundingClientRect().left;
      const mv = e => { this.hoverX = xat(e); this._schedule(); if (e.cancelable) e.preventDefault(); };
      const end = () => { this.hoverX = null; this._schedule(); };
      cv.addEventListener('pointerdown', mv);
      cv.addEventListener('pointermove', e => { if (e.buttons || e.pressure > 0) mv(e); });
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointerleave', end);
    }
    setData(xs, ys) { this.xs = xs; this.ys = ys; this._schedule(); }
    setPeaks(p) { this.peaks = p; }
    setOptions(p) { Object.assign(this.opts, p); this._schedule(); }
    clear() { this.xs = null; this.ys = null; this.peaks = null; this._schedule(); }
    _schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); }); }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = w; this.H = h; this._draw();
    }
    _draw() {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (!ctx || !W || !H) return;
      ctx.clearRect(0, 0, W, H);
      const ink3 = cssVar('--ink-3') || '#8e8e93', grid = cssVar('--border') || '#d8d8dc';
      const color = (this.opts.color || '').trim() || '#0a84ff';
      ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const xs = this.xs, ys = this.ys, n = ys ? ys.length : 0;
      if (n < 2) { ctx.fillStyle = ink3; ctx.fillText(this.opts.empty, 12, H / 2); return; }

      const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
      const log = this.opts.logX;
      let x0 = this.opts.xMin != null ? this.opts.xMin : xs[0];
      let x1 = this.opts.xMax != null ? this.opts.xMax : xs[n - 1];
      if (log) { x0 = Math.max(x0, 1e-6); x1 = Math.max(x1, x0 * 1.0001); }
      const lx0 = log ? Math.log10(x0) : x0, lx1 = log ? Math.log10(x1) : x1, lxr = (lx1 - lx0) || 1;
      const px = x => { const v = log ? Math.log10(Math.max(x, x0)) : x; return PAD.l + (v - lx0) / lxr * plotW; };

      let ymin = this.opts.yMin, ymax = this.opts.yMax;
      if (ymin == null || ymax == null) {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n; i++) { if (xs[i] < x0 || xs[i] > x1) continue; const v = ys[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
        if (lo === hi) { lo -= 1; hi += 1; }
        if (this.opts.symmetric && this.opts.yMin == null && this.opts.yMax == null) { const A = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -A; hi = A; }
        const pad = (hi - lo) * 0.1;
        if (ymin == null) ymin = lo - pad;
        if (ymax == null) ymax = hi + pad;
      }
      const py = v => PAD.t + (1 - (v - ymin) / (ymax - ymin)) * plotH;

      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = ink3; ctx.textAlign = 'left';
      for (let i = 0; i < 5; i++) {
        const val = ymax - i * (ymax - ymin) / 4;
        const y = py(val); ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.fillText(this.opts.fmtY(val), 4, y);
      }

      // X axis: explicit ticks (dense small ticks + labelled gridlines) or evenly spaced.
      ctx.textBaseline = 'alphabetic';
      if (this.opts.xTicks && this.opts.xTicks.length) {
        const labels = this.opts.xLabels || this.opts.xTicks;
        ctx.fillStyle = ink3; ctx.strokeStyle = grid;
        this.opts.xTicks.forEach(tv => {
          if (tv < x0 || tv > x1) return; const xx = px(tv);
          ctx.beginPath(); ctx.moveTo(xx, H - PAD.b); ctx.lineTo(xx, H - PAD.b - 4); ctx.stroke();
        });
        // Draw labels, dropping any that would collide with the previous one.
        const vis = labels.filter(tv => tv >= x0 && tv <= x1).map(tv => ({ tv, xx: px(tv) })).sort((a, b) => a.xx - b.xx);
        let lastRight = -1e9;
        vis.forEach((o, i) => {
          const last = i === vis.length - 1;
          const align = o.xx <= PAD.l + 4 ? 'left' : last || o.xx >= W - PAD.r - 4 ? 'right' : 'center';
          const txt = this.opts.fmtX(o.tv);
          const w = ctx.measureText(txt).width;
          const left = align === 'right' ? o.xx - w : align === 'center' ? o.xx - w / 2 : o.xx;
          if (left < lastRight + 4 && !last) return;             // collides → skip (always keep the last)
          ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(o.xx, PAD.t); ctx.lineTo(o.xx, H - PAD.b); ctx.stroke(); ctx.globalAlpha = 1;
          ctx.textAlign = align;
          ctx.fillText(txt, o.xx, H - 5);
          lastRight = left + w;
        });
      } else {
        const XT = this.opts.xTickCount || 5;
        ctx.fillStyle = ink3; ctx.strokeStyle = grid;
        for (let i = 0; i < XT; i++) {
          const frac = i / (XT - 1), xx = PAD.l + frac * plotW;
          const xv = log ? Math.pow(10, lx0 + frac * lxr) : x0 + frac * (x1 - x0);
          ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, H - PAD.b); ctx.stroke(); ctx.globalAlpha = 1;
          ctx.textAlign = i === 0 ? 'left' : i === XT - 1 ? 'right' : 'center';
          ctx.fillText(this.opts.fmtX(xv), xx, H - 5);
        }
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW, plotH); ctx.clip();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      if (this.opts.peakLine) {
        // One point per pixel column = the maximum in that column. Keeps full
        // resolution where bins are sparse (low freq on a log axis) and the
        // tallest peak where many bins crowd one pixel (high freq).
        let curCol = NaN, bestI = -1, bestV = -Infinity;
        const emit = () => { if (bestI >= 0) { const X = px(xs[bestI]), Y = py(ys[bestI]); started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true); } };
        for (let i = 0; i < n; i++) {
          if (xs[i] < x0 || xs[i] > x1) continue;
          const col = Math.round(px(xs[i]));
          if (col !== curCol) { emit(); curCol = col; bestI = i; bestV = ys[i]; }
          else if (ys[i] > bestV) { bestV = ys[i]; bestI = i; }
        }
        emit();
      } else {
        for (let i = 0; i < n; i++) {
          const X = px(xs[i]), Y = py(ys[i]);
          started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true);
        }
      }
      ctx.stroke();
      if (this.opts.fill) {
        ctx.lineTo(px(xs[n - 1]), py(ymin)); ctx.lineTo(px(xs[0]), py(ymin)); ctx.closePath();
        ctx.fillStyle = color + '22'; ctx.fill();
      }
      // Peak markers.
      if (this.peaks) {
        ctx.fillStyle = ink3; ctx.strokeStyle = color; ctx.setLineDash([3, 3]);
        this.peaks.forEach(p => {
          if (!Number.isFinite(p.x)) return;
          const X = px(p.x);
          ctx.beginPath(); ctx.moveTo(X, PAD.t); ctx.lineTo(X, H - PAD.b); ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      ctx.restore();

      // Peak labels (outside clip).
      if (this.peaks) {
        ctx.fillStyle = cssVar('--ink-2') || '#666'; ctx.textBaseline = 'top';
        this.peaks.forEach(p => {
          if (!Number.isFinite(p.x) || !p.label) return;
          let X = px(p.x); ctx.textAlign = X > W - 50 ? 'right' : 'left';
          ctx.fillText(p.label, X + (X > W - 50 ? -3 : 3), PAD.t + 2);
        });
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      }

      // Crosshair.
      if (this.hoverX != null) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < n; i++) { if (xs[i] < x0 || xs[i] > x1) continue; const d = Math.abs(px(xs[i]) - this.hoverX); if (d < bd) { bd = d; best = i; } }
        if (best >= 0) {
          const X = px(xs[best]), Y = py(ys[best]);
          ctx.strokeStyle = ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, PAD.t); ctx.lineTo(X, H - PAD.b); ctx.stroke();
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI * 2); ctx.fill();
          const label = `${this.opts.fmtX(xs[best])} · ${this.opts.fmtY(ys[best])}`;
          const tw = ctx.measureText(label).width + 10;
          let tx = X + 6; if (tx + tw > W - PAD.r) tx = X - 6 - tw;
          ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(tx, PAD.t, tw, 18);
          ctx.fillStyle = '#fff'; ctx.fillText(label, tx + 5, PAD.t + 9);
        }
      }
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.LivePlot = LivePlot;
})(typeof window !== 'undefined' ? window : globalThis);
