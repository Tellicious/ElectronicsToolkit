/* SensorKit — lightweight canvas time-series chart.
 *
 * opts: { color, scale(rawY)->displayY, fmt(displayY)->string, xfmt(sec)->string, empty }
 * Stores raw Y values; `scale` converts to display units at draw time so a unit
 * toggle is just a redraw. x is elapsed seconds.
 *
 * Interaction:
 *   • one finger / mouse drag → crosshair + value tooltip
 *   • two fingers            → pan & zoom the time axis
 *   • double-tap             → reset to auto-fit (follows new data)
 * Call resize() after the container changes size (e.g. fullscreen).
 */
(function (root) {
  'use strict';

  const PAD = { l: 46, r: 10, t: 10, b: 26 };
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const defaultXfmt = s => {
    s = Math.round(s);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  };

  class TimeSeriesChart {
    constructor(container, opts = {}) {
      this.opts = Object.assign({ color: '#0a84ff', scale: v => v, fmt: v => String(Math.round(v)), xfmt: defaultXfmt, empty: 'Waiting for data…' }, opts);
      this.container = container;
      this.xs = []; this.ys = [];
      this.hoverX = null;
      this.view = null;            // {x0,x1} when zoomed/panned; null = auto-fit
      this.pointers = new Map();   // active pointerId → x pixel
      this.gesture = null;         // {a,b} previous two pointer x's during pinch
      this.lastTap = 0;
      this._raf = 0;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sk-canvas';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this._bind();
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(container);
      }
      this.resize();
    }

    _bind() {
      const cv = this.canvas;
      const xOf = e => e.clientX - cv.getBoundingClientRect().left;
      cv.addEventListener('pointerdown', e => {
        cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, xOf(e));
        if (this.pointers.size === 1) { this.hoverX = xOf(e); this._tapStart = { t: Date.now(), x: xOf(e) }; }
        else if (this.pointers.size === 2) { this.hoverX = null; const v = [...this.pointers.values()]; this.gesture = { a: v[0], b: v[1] }; }
        this._draw();
      });
      cv.addEventListener('pointermove', e => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, xOf(e));
        if (this.pointers.size >= 2 && this.gesture) {
          const v = [...this.pointers.values()];
          this._pinch(this.gesture.a, this.gesture.b, v[0], v[1]);
          this.gesture = { a: v[0], b: v[1] };
        } else if (this.pointers.size === 1) {
          this.hoverX = xOf(e);
        }
        this._draw();
        if (e.cancelable) e.preventDefault();
      });
      const up = e => {
        if (this._tapStart && this.pointers.size === 1) {
          const dt = Date.now() - this._tapStart.t, dx = Math.abs(xOf(e) - this._tapStart.x);
          if (dt < 250 && dx < 8) {
            if (Date.now() - this.lastTap < 300) { this.view = null; this.hoverX = null; } // double-tap → reset
            this.lastTap = Date.now();
          }
        }
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.gesture = null;
        if (this.pointers.size === 0) this.hoverX = null;
        this._draw();
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', e => { if (this.pointers.size === 0) { this.hoverX = null; this._draw(); } });
    }

    _extent() { return this.xs.length ? [this.xs[0], this.xs[this.xs.length - 1]] : [0, 1]; }

    _pinch(aPrev, bPrev, aCur, bCur) {
      const [dmin, dmax] = this._extent();
      const full = (dmax - dmin) || 1;
      if (!this.view) this.view = { x0: dmin, x1: dmax };
      const plotW = this.W - PAD.l - PAD.r;
      const dpp = (this.view.x1 - this.view.x0) / plotW;
      const cPrev = (aPrev + bPrev) / 2, cCur = (aCur + bCur) / 2;
      const spanPrev = Math.max(1, Math.abs(bPrev - aPrev)), spanCur = Math.max(1, Math.abs(bCur - aCur));
      let newDpp = dpp * (spanPrev / spanCur);
      const minDpp = 1 / plotW, maxDpp = full / plotW;        // clamp 1s min span, full extent max
      newDpp = Math.max(minDpp, Math.min(maxDpp, newDpp));
      const dataAtCenter = this.view.x0 + (cPrev - PAD.l) * dpp;
      let nx0 = dataAtCenter - (cCur - PAD.l) * newDpp;
      let nx1 = nx0 + newDpp * plotW;
      const range = nx1 - nx0;
      if (range >= full) { this.view = null; return; }          // zoomed all the way out → auto-fit
      if (nx0 < dmin) { nx0 = dmin; nx1 = dmin + range; }
      if (nx1 > dmax) { nx1 = dmax; nx0 = dmax - range; }
      this.view = { x0: nx0, x1: nx1 };
    }

    setOptions(patch) { Object.assign(this.opts, patch); this._schedule(); }
    clear() { this.xs = []; this.ys = []; this.hoverX = null; this.view = null; this._schedule(); }
    push(x, y) { if (!Number.isFinite(y)) return; this.xs.push(x); this.ys.push(y); this._schedule(); }
    _schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); }); }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this._draw();
    }

    _draw() {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (!ctx || !W || !H) return;
      ctx.clearRect(0, 0, W, H);
      const ink3 = cssVar('--ink-3') || '#8e8e93';
      const grid = cssVar('--border') || '#d8d8dc';
      const color = (this.opts.color || '').trim() || '#0a84ff';
      const n = this.ys.length;
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      if (n < 1) { ctx.fillStyle = ink3; ctx.fillText(this.opts.empty, 12, H / 2); return; }

      const S = this.opts.scale;
      const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
      const [dmin, dmax] = this._extent();
      const vx0 = this.view ? this.view.x0 : dmin, vx1 = this.view ? this.view.x1 : dmax;
      const xr = (vx1 - vx0) || 1;

      // Y range over the visible window.
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < n; i++) { if (this.xs[i] < vx0 || this.xs[i] > vx1) continue; const s = S(this.ys[i]); if (s < ymin) ymin = s; if (s > ymax) ymax = s; }
      if (!Number.isFinite(ymin)) { ymin = S(this.ys[n - 1]); ymax = ymin; }
      if (ymin === ymax) { ymin -= 1; ymax += 1; }
      // Apply fixed bounds if provided
      if (Number.isFinite(this.opts.yMin)) ymin = this.opts.yMin;
      if (Number.isFinite(this.opts.yMax)) ymax = this.opts.yMax;
      // Otherwise apply symmetric or padding
      if (!Number.isFinite(this.opts.yMin) && !Number.isFinite(this.opts.yMax)) {
        if (this.opts.symmetric !== false) { const A = Math.max(Math.abs(ymin), Math.abs(ymax)) || 1; ymin = -A; ymax = A; }
        const yp = (ymax - ymin) * 0.12; ymin -= yp; ymax += yp;
      }

      const px = x => PAD.l + (x - vx0) / xr * plotW;
      const py = s => PAD.t + (1 - (s - ymin) / (ymax - ymin)) * plotH;

      // Y grid + labels (5 horizontal lines).
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = ink3; ctx.textAlign = 'left';
      for (let i = 0; i < 5; i++) {
        const val = ymax - i * (ymax - ymin) / 4;
        const y = py(val);
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.fillText(this.opts.fmt(val), 4, y);
      }

      // X axis: 5 evenly spaced ticks (gridline + label), reflecting the view.
      ctx.textBaseline = 'alphabetic';
      const XT = 5;
      for (let i = 0; i < XT; i++) {
        const frac = i / (XT - 1);
        const xv = vx0 + frac * (vx1 - vx0);
        const xx = PAD.l + frac * plotW;
        ctx.strokeStyle = grid; ctx.globalAlpha = 0.45;
        ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, H - PAD.b); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = ink3;
        ctx.textAlign = i === 0 ? 'left' : i === XT - 1 ? 'right' : 'center';
        ctx.fillText(this.opts.xfmt(xv), xx, H - 6);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

      // Series (clipped to plot rect).
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW, plotH); ctx.clip();
      const maxPts = Math.max(64, Math.floor(plotW));
      const step = Math.max(1, Math.floor(n / maxPts));
      if (n === 1) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(this.xs[0]), py(S(this.ys[0])), 3.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i += step) {
          const X = px(this.xs[i]), Y = py(S(this.ys[i]));
          started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true);
        }
        ctx.lineTo(px(this.xs[n - 1]), py(S(this.ys[n - 1])));
        ctx.stroke();
      }
      ctx.restore();

      // Crosshair (nearest visible sample).
      if (this.hoverX != null) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < n; i += step) {
          if (this.xs[i] < vx0 || this.xs[i] > vx1) continue;
          const d = Math.abs(px(this.xs[i]) - this.hoverX);
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) {
          const X = px(this.xs[best]), Y = py(S(this.ys[best]));
          ctx.strokeStyle = ink3; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(X, PAD.t); ctx.lineTo(X, H - PAD.b); ctx.stroke();
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, Math.PI * 2); ctx.fill();
          const label = `${this.opts.fmt(S(this.ys[best]))} · ${this.opts.xfmt(this.xs[best])}`;
          const tw = ctx.measureText(label).width + 10;
          let tx = X + 6; if (tx + tw > W - PAD.r) tx = X - 6 - tw;
          ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(tx, PAD.t, tw, 18);
          ctx.fillStyle = '#fff'; ctx.fillText(label, tx + 5, PAD.t + 9);
        }
      }
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.TimeSeriesChart = TimeSeriesChart;
})(typeof window !== 'undefined' ? window : globalThis);
