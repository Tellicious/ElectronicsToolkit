/* SensorKit — multi-trace plot with pan/zoom + live-follow (time-domain scopes).
 *
 * Unlike LivePlot (which replaces its data every frame), MultiPlot ACCUMULATES
 * the full history of samples so the time axis can be zoomed and scrolled all
 * the way back to the start of the record. It draws several series over a
 * shared axis with a tappable show/hide legend. Raw Y values are stored and
 * converted to display units via opts.scale at draw time, so a unit toggle is
 * just a redraw.
 *
 *   const p = new SensorKit.MultiPlot(frameEl, {
 *     series: [{ key:'x', label:'X', color:'#ff3b30' }, … ],
 *     followSpan: 4,                  // live window width, seconds
 *     scale: v => v,                  // raw -> display units (read live)
 *     fmtX: s => s.toFixed(0)+'s', fmtY: v => v.toFixed(2),
 *   });
 *   p.push(tSeconds, { x, y, z, mag });   // append one sample (raw units)
 *   p.pushBreak();                        // break the trace (e.g. on pause)
 *   p.redraw();                           // force a redraw (e.g. unit change)
 *   p.toggle('mag');                      // show / hide a trace
 *   p.clear();                            // reset to an empty, live-following plot
 *
 * Interaction (mirrors TimeSeriesChart):
 *   • one finger / mouse  → crosshair + per-series value tooltip
 *   • two fingers         → pinch-zoom & pan the time axis
 *   • mouse wheel         → zoom the time axis about the cursor
 *   • double-tap          → resume live-follow
 *
 * The legend is inserted as a sibling right after the frame element, so the
 * canvas keeps filling the frame exactly like LivePlot does.
 */
(function (root) {
  'use strict';

  const PAD = { l: 44, r: 8, t: 8, b: 18 };
  const cssVar = n => (typeof getComputedStyle !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(n).trim() : '');
  // First index i with arr[i] >= v (arr sorted ascending).
  const lowerBound = (arr, v) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return lo;
  };

  class MultiPlot {
    constructor(container, opts = {}) {
      this.opts = Object.assign({
        series: [], scale: v => v, followSpan: 4, minSpan: 0.2,
        yMin: null, yMax: null, symmetric: false,
        fmtY: v => v.toFixed(0), fmtX: s => String(Math.round(s)),
        empty: 'Waiting for data…', legend: true,
      }, opts);
      this.container = container;
      this.xs = [];                 // elapsed seconds, ascending
      this.data = {};               // key -> [raw values]
      this.opts.series.forEach(s => { this.data[s.key] = []; });
      this.visible = {};
      this.opts.series.forEach(s => { this.visible[s.key] = s.visible !== false; });

      this.mode = 'follow';         // 'follow' | 'fit' | 'manual'
      this.view = null;             // {x0,x1} when mode === 'manual'
      this.hoverX = null;
      this.pointers = new Map();    // pointerId -> x pixel
      this.gesture = null;          // {a,b} previous two pointer x's during pinch
      this.lastTap = 0;
      this._tapStart = null;
      this._breakNext = false;
      this._raf = 0;

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sk-canvas';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.chips = null; this.legendEl = null;
      if (this.opts.legend && this.opts.series.length) this._buildLegend();

      this._bind();
      if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(container); }
      this.resize();
    }

    // ---- legend -----------------------------------------------------------
    _buildLegend() {
      const leg = document.createElement('div');
      leg.className = 'sk-legend';
      this.chips = {};
      this.opts.series.forEach(s => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sk-legend__chip';
        chip.dataset.key = s.key;
        const dot = document.createElement('span');
        dot.className = 'sk-legend__dot';
        dot.style.background = s.color;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(s.label));
        chip.addEventListener('click', () => this.toggle(s.key));
        this.chips[s.key] = chip;
        leg.appendChild(chip);
      });
      // Sibling after the frame so the canvas still fills the frame 100%.
      if (typeof this.container.insertAdjacentElement === 'function') this.container.insertAdjacentElement('afterend', leg);
      else this.container.appendChild(leg);
      this.legendEl = leg;
      this._paintLegend();
    }
    _paintLegend() {
      if (!this.chips) return;
      this.opts.series.forEach(s => this.chips[s.key].classList.toggle('sk-legend__chip--off', !this.visible[s.key]));
    }
    toggle(key) { this.visible[key] = !this.visible[key]; this._paintLegend(); this._schedule(); }
    setVisible(key, on) { this.visible[key] = !!on; this._paintLegend(); this._schedule(); }

    // ---- data -------------------------------------------------------------
    push(x, byKey) {
      if (this._breakNext) {
        if (this.xs.length) { this.xs.push(x); this.opts.series.forEach(s => this.data[s.key].push(NaN)); }
        this._breakNext = false;
      }
      this.xs.push(x);
      this.opts.series.forEach(s => { const v = byKey ? byKey[s.key] : NaN; this.data[s.key].push(Number.isFinite(v) ? v : NaN); });
      // A frozen, scrolled-back window doesn't change when newer samples land
      // off its right edge — skip the redraw so inspecting history stays cheap.
      if (this.mode === 'manual' && this.view && x > this.view.x1) return;
      this._schedule();
    }
    pushBreak() { this._breakNext = true; }
    setScale(fn) { if (typeof fn === 'function') this.opts.scale = fn; this._schedule(); }
    setOptions(p) { Object.assign(this.opts, p); this._schedule(); }
    redraw() { this._schedule(); }
    clear() {
      this.xs = []; this.opts.series.forEach(s => { this.data[s.key] = []; });
      this.mode = 'follow'; this.view = null; this.hoverX = null; this._breakNext = false;
      this._schedule();
    }
    _schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); }); }

    // ---- view helpers -----------------------------------------------------
    _extent() { const n = this.xs.length; return n ? [this.xs[0], this.xs[n - 1]] : [0, 1]; }
    _visibleRange() {
      const [dmin, dmax] = this._extent();
      if (this.mode === 'manual' && this.view) return { x0: this.view.x0, x1: this.view.x1 };
      if (this.mode === 'fit') return { x0: dmin, x1: dmax };
      return { x0: Math.max(dmin, dmax - this.opts.followSpan), x1: dmax };   // follow
    }

    // Zoom to `newSpan` seconds keeping the data under `centerPx` fixed.
    _zoomTo(centerPx, prev, newSpan) {
      const [dmin, dmax] = this._extent();
      const full = (dmax - dmin) || 1;
      const plotW = this.W - PAD.l - PAD.r;
      if (newSpan >= full) { this.mode = 'fit'; this.view = null; return; }
      newSpan = Math.max(this.opts.minSpan, newSpan);
      const fx = Math.min(1, Math.max(0, (centerPx - PAD.l) / plotW));
      const dataAt = prev.x0 + fx * (prev.x1 - prev.x0);
      let nx0 = dataAt - fx * newSpan, nx1 = nx0 + newSpan;
      if (nx0 < dmin) { nx0 = dmin; nx1 = dmin + newSpan; }
      if (nx1 > dmax) { nx1 = dmax; nx0 = dmax - newSpan; }
      this.mode = 'manual'; this.view = { x0: nx0, x1: nx1 };
    }

    // Translate the visible window by `delta` seconds (no-op when fully out).
    _panBy(delta) {
      const [dmin, dmax] = this._extent();
      const full = (dmax - dmin) || 1;
      const cur = this._visibleRange();
      const span = cur.x1 - cur.x0;
      if (span >= full) return;
      let nx0 = cur.x0 + delta, nx1 = nx0 + span;
      if (nx0 < dmin) { nx0 = dmin; nx1 = dmin + span; }
      if (nx1 > dmax) { nx1 = dmax; nx0 = dmax - span; }
      this.mode = 'manual'; this.view = { x0: nx0, x1: nx1 };
    }

    _pinch(aPrev, bPrev, aCur, bCur) {
      if (this.xs.length < 2) return;
      const [dmin, dmax] = this._extent();
      const full = (dmax - dmin) || 1;
      const cur = this._visibleRange();
      const plotW = this.W - PAD.l - PAD.r;
      const dpp = (cur.x1 - cur.x0) / plotW;
      const cPrev = (aPrev + bPrev) / 2, cCur = (aCur + bCur) / 2;
      const spanPrev = Math.max(1, Math.abs(bPrev - aPrev)), spanCur = Math.max(1, Math.abs(bCur - aCur));
      let newDpp = dpp * (spanPrev / spanCur);
      const minDpp = this.opts.minSpan / plotW, maxDpp = full / plotW;
      newDpp = Math.max(minDpp, Math.min(maxDpp, newDpp));
      const dataAtCenter = cur.x0 + (cPrev - PAD.l) * dpp;
      let nx0 = dataAtCenter - (cCur - PAD.l) * newDpp;
      let nx1 = nx0 + newDpp * plotW;
      const range = nx1 - nx0;
      if (range >= full) { this.mode = 'fit'; this.view = null; return; }   // fully out → fit whole record
      if (nx0 < dmin) { nx0 = dmin; nx1 = dmin + range; }
      if (nx1 > dmax) { nx1 = dmax; nx0 = dmax - range; }
      this.mode = 'manual'; this.view = { x0: nx0, x1: nx1 };
    }

    _bind() {
      const cv = this.canvas;
      const xOf = e => e.clientX - cv.getBoundingClientRect().left;
      cv.addEventListener('pointerdown', e => {
        cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, xOf(e));
        if (this.pointers.size === 1) { this.hoverX = xOf(e); this._tapStart = { t: Date.now(), x: xOf(e) }; }
        else if (this.pointers.size === 2) { this.hoverX = null; this._tapStart = null; const v = [...this.pointers.values()]; this.gesture = { a: v[0], b: v[1] }; }
        this._schedule();
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
        if (e.cancelable) e.preventDefault();
        this._schedule();
      });
      const up = e => {
        const wasSingle = this.pointers.size === 1;
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.gesture = null;
        if (this.pointers.size === 0) {
          if (wasSingle && this._tapStart) {
            const dt = Date.now() - this._tapStart.t, moved = Math.abs(xOf(e) - this._tapStart.x);
            if (dt < 250 && moved < 8) {
              const now = Date.now();
              if (now - this.lastTap < 320) { this.mode = 'follow'; this.view = null; this.lastTap = 0; }  // double-tap → live
              else this.lastTap = now;
            }
          }
          this.hoverX = null; this._tapStart = null;
        }
        this._schedule();
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { if (this.pointers.size === 0) { this.hoverX = null; this._schedule(); } });
      cv.addEventListener('wheel', e => {
        if (this.xs.length < 2) return;
        e.preventDefault();
        const cur = this._visibleRange();
        const span = cur.x1 - cur.x0;
        // Shift-wheel or a horizontal trackpad swipe pans; a plain wheel zooms.
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const plotW = this.W - PAD.l - PAD.r;
          this._panBy(((e.shiftKey ? e.deltaY : e.deltaX) / plotW) * span);
        } else {
          this._zoomTo(xOf(e), cur, span * Math.exp(e.deltaY * 0.0015));  // wheel down → zoom out
        }
        this._schedule();
      }, { passive: false });
    }

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
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      const xs = this.xs, data = this.data;
      const series = this.opts.series.filter(s => this.visible[s.key]);
      const n = xs.length;
      if (n < 2 || !series.length) { ctx.fillStyle = ink3; ctx.textAlign = 'left'; ctx.fillText(this.opts.empty, 12, H / 2); return; }

      const S = this.opts.scale || (v => v);
      const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
      const { x0, x1 } = this._visibleRange();
      const xr = (x1 - x0) || 1;
      const px = x => PAD.l + (x - x0) / xr * plotW;

      // Visible index window (+1 each side for line continuity).
      let iLo = lowerBound(xs, x0) - 1; if (iLo < 0) iLo = 0;
      let iHi = lowerBound(xs, x1);     if (iHi > n - 1) iHi = n - 1;

      // Y range over the visible window.
      let ymin = this.opts.yMin, ymax = this.opts.yMax;
      if (ymin == null || ymax == null) {
        let lo = Infinity, hi = -Infinity;
        for (const s of series) {
          const ys = data[s.key];
          for (let i = iLo; i <= iHi; i++) { const v = ys[i]; if (!Number.isFinite(v)) continue; const d = S(v); if (d < lo) lo = d; if (d > hi) hi = d; }
        }
        if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
        if (lo === hi) { lo -= 1; hi += 1; }
        if (this.opts.symmetric) { const A = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -A; hi = A; }
        const pad = (hi - lo) * 0.1;
        if (ymin == null) ymin = lo - pad;
        if (ymax == null) ymax = hi + pad;
      }
      const yr = (ymax - ymin) || 1;
      const py = v => PAD.t + (1 - (v - ymin) / yr) * plotH;

      // Y gridlines + labels.
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = ink3; ctx.textAlign = 'left';
      for (let i = 0; i < 5; i++) {
        const val = ymax - i * yr / 4, y = py(val);
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.fillText(this.opts.fmtY(val), 4, y);
      }

      // X gridlines + labels (5 across the visible window).
      const XT = 5;
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < XT; i++) {
        const xv = x0 + (i / (XT - 1)) * xr, xx = px(xv);
        ctx.strokeStyle = grid; ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(xx, PAD.t); ctx.lineTo(xx, H - PAD.b); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = ink3;
        ctx.textAlign = i === 0 ? 'left' : i === XT - 1 ? 'right' : 'center';
        ctx.fillText(this.opts.fmtX(xv), xx, H - 5);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

      // Series traces (clip to plot; decimate to pixel columns when dense).
      ctx.save();
      ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW, plotH); ctx.clip();
      ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
      const dense = (iHi - iLo) > plotW * 2;
      for (const s of series) {
        const ys = data[s.key];
        ctx.strokeStyle = s.color; ctx.beginPath();
        if (dense) {
          // Per-pixel-column min/max envelope (adjacent 1px bars read as a filled trace).
          let col = -1, lo = 0, hi = 0, open = false;
          for (let i = iLo; i <= iHi; i++) {
            const raw = ys[i];
            if (!Number.isFinite(raw)) { if (open) { ctx.moveTo(col, lo); ctx.lineTo(col, hi); } open = false; col = -1; continue; }
            const X = Math.round(px(xs[i])), Y = py(S(raw));
            if (X !== col) { if (open) { ctx.moveTo(col, lo); ctx.lineTo(col, hi); } col = X; lo = Y; hi = Y; open = true; }
            else { if (Y < lo) lo = Y; if (Y > hi) hi = Y; }
          }
          if (open) { ctx.moveTo(col, lo); ctx.lineTo(col, hi); }
        } else {
          let started = false;
          for (let i = iLo; i <= iHi; i++) {
            const v = ys[i];
            if (!Number.isFinite(v)) { started = false; continue; }
            const X = px(xs[i]), Y = py(S(v));
            started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true);
          }
        }
        ctx.stroke();
      }
      ctx.restore();

      // Crosshair with per-series value tooltip (nearest visible sample).
      if (this.hoverX != null) {
        let best = -1, bd = Infinity;
        for (let i = iLo; i <= iHi; i++) { const d = Math.abs(px(xs[i]) - this.hoverX); if (d < bd) { bd = d; best = i; } }
        if (best >= 0) {
          const X = px(xs[best]);
          ctx.strokeStyle = ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, PAD.t); ctx.lineTo(X, H - PAD.b); ctx.stroke();
          const lines = [];
          series.forEach(s => {
            const v = data[s.key][best];
            if (!Number.isFinite(v)) return;
            const dv = S(v);
            ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X, py(dv), 3, 0, Math.PI * 2); ctx.fill();
            lines.push({ c: s.color, t: `${s.label} ${this.opts.fmtY(dv)}` });
          });
          if (lines.length) {
            const lh = 13, tw = Math.max(...lines.map(l => ctx.measureText(l.t).width)) + 16, th = lines.length * lh + 6;
            let tx = X + 6; if (tx + tw > W - PAD.r) tx = X - 6 - tw; if (tx < PAD.l) tx = PAD.l;
            const ty = PAD.t;
            ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(tx, ty, tw, th);
            ctx.textAlign = 'left';
            lines.forEach((l, i) => {
              const yy = ty + 6 + i * lh + lh / 2;
              ctx.fillStyle = l.c; ctx.beginPath(); ctx.arc(tx + 7, yy, 3, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#fff'; ctx.fillText(l.t, tx + 14, yy);
            });
          }
        }
      }

      // "Zoomed" badge so it's obvious how to get back to the live view.
      if (this.mode !== 'follow') {
        const label = 'Zoomed · double-tap for live';
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W - PAD.r - tw, PAD.t, tw, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(label, W - PAD.r - tw + 6, PAD.t + 8);
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { MultiPlot };
  root.SensorKit = root.SensorKit || {};
  root.SensorKit.MultiPlot = MultiPlot;
})(typeof window !== 'undefined' ? window : globalThis);
