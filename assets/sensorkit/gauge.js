/* SensorKit — radial gauge (speedometer / tachometer style).
 *
 * Draws a circular gauge once — sweep arc, tick ladder with numeric labels, a
 * needle, a centre hub, and a large digital readout — then exposes cheap
 * per-frame updates that only rotate the needle, fill the progress arc, and set
 * the readout text (no full re-render). The dial auto-fits a faster reading via
 * setMax().
 *
 *   const g = new SK.Gauge(el, { min: 0, max: 250, major: 50, minor: 10,
 *                                unit: 'km/h', decimals: 0 });
 *   g.update(value);   // rotate needle + fill arc + set readout
 *   g.setMax(300);     // re-render the ladder for a higher top end
 *
 * Colours are taken from the app's CSS custom properties through inline styles,
 * so the gauge follows the light/dark theme automatically. `el` is an element
 * or an element id. Reusable by any app needing a dial (currently: Dashboard).
 */
(function (root) {
  'use strict';

  // --- Fixed geometry, in a 240×240 view box ----------------------------
  const CX = 120, CY = 120;
  const R_ARC = 104;     // radius of the track / progress arc and tick tops
  const R_MAJOR = 88;    // inner radius of a (long) major tick
  const R_MINOR = 96;    // inner radius of a (short) minor tick
  const R_LABEL = 74;    // radius of the numeric tick labels
  const R_NEEDLE = 86;   // needle tip radius
  const A_START = 210;   // value = min sits here (math degrees, lower-left)
  const A_SWEEP = 240;   // total sweep, clockwise over the top to lower-right
  const DEG = Math.PI / 180;

  const r2 = n => Math.round(n * 100) / 100;
  const r3 = n => Math.round(n * 1000) / 1000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // Math angle (0° = east, CCW positive) → point in the view box (y flipped).
  function pt(angleDeg, r) {
    const a = angleDeg * DEG;
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
  }
  // Fraction 0..1 of the scale → math angle along the sweep.
  const angleOf = frac => A_START - frac * A_SWEEP;
  // Whole numbers print plainly (no "100.0" on a speed dial).
  const fmtTick = v => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : String(v));

  class Gauge {
    constructor(el, opts = {}) {
      this.el = typeof el === 'string' ? document.getElementById(el) : el;
      this.min = opts.min || 0;
      this.max = opts.max || 100;
      this.major = opts.major || 20;
      this.minor = opts.minor || (this.major / 5);
      this.unit = opts.unit || '';
      this.decimals = opts.decimals != null ? opts.decimals : 0;
      this.value = this.min;
      this.render();
    }

    // Build the complete SVG (static ladder + needle + readout) in one shot.
    render() {
      const span = (this.max - this.min) || 1;
      const minorN = Math.round(span / this.minor);
      const majorN = Math.round(span / this.major);
      const onMajor = v => Math.abs((v - this.min) / this.major - Math.round((v - this.min) / this.major)) < 1e-6;

      const parts = [];

      // Minor ticks (skip those that coincide with a major).
      for (let j = 0; j <= minorN; j++) {
        const v = this.min + j * this.minor;
        if (v > this.max + 1e-6 || onMajor(v)) continue;
        const a = angleOf((v - this.min) / span);
        const [x1, y1] = pt(a, R_ARC), [x2, y2] = pt(a, R_MINOR);
        parts.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" style="stroke:var(--ink-3)" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>`);
      }
      // Major ticks + numeric labels.
      for (let i = 0; i <= majorN; i++) {
        const v = this.min + i * this.major;
        if (v > this.max + 1e-6) continue;
        const a = angleOf((v - this.min) / span);
        const [x1, y1] = pt(a, R_ARC), [x2, y2] = pt(a, R_MAJOR);
        parts.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" style="stroke:var(--ink-2)" stroke-width="2.6" stroke-linecap="round"/>`);
        const [lx, ly] = pt(a, R_LABEL);
        parts.push(`<text x="${r2(lx)}" y="${r2(ly + 4)}" text-anchor="middle" style="fill:var(--ink-2);font-family:var(--font-sans)" font-size="12" font-weight="600">${fmtTick(v)}</text>`);
      }

      const arc = this._arcPath(96);
      const svg =
        `<svg viewBox="0 10 240 180" style="display:block;width:100%;height:auto" role="img" aria-label="${esc(this.unit)} gauge">` +
          `<path d="${arc}" fill="none" style="stroke:var(--border)" stroke-width="6" stroke-linecap="round"/>` +
          `<path class="sk-gauge__fill" d="${arc}" fill="none" style="stroke:var(--accent)" stroke-width="6" stroke-linecap="round" pathLength="1" stroke-dasharray="0 1"/>` +
          parts.join('') +
          `<g class="sk-gauge__needle"><path d="M ${CX} ${CY - R_NEEDLE} L ${CX - 4.5} ${CY + 8} L ${CX + 4.5} ${CY + 8} Z" style="fill:var(--accent)"/></g>` +
          `<circle cx="${CX}" cy="${CY}" r="9" style="fill:var(--surface);stroke:var(--ink-3)" stroke-width="2"/>` +
          `<text class="sk-gauge__value" x="${CX}" y="161" text-anchor="middle" style="fill:var(--ink);font-family:var(--font-mono)" font-size="40" font-weight="750">—</text>` +
          `<text x="${CX}" y="182" text-anchor="middle" style="fill:var(--ink-3);font-family:var(--font-sans)" font-size="13" font-weight="600">${esc(this.unit)}</text>` +
        `</svg>`;
      this.el.innerHTML = svg;
      this.needle = this.el.querySelector('.sk-gauge__needle');
      this.fill = this.el.querySelector('.sk-gauge__fill');
      this.readout = this.el.querySelector('.sk-gauge__value');
      this.update(this.value);
    }

    // Sweep arc as a sampled polyline path (no arc-flag ambiguity); the start of
    // the path is value = min, so a stroke-dasharray fill reveals min → value.
    _arcPath(n) {
      let d = '';
      for (let i = 0; i <= n; i++) {
        const [x, y] = pt(angleOf(i / n), R_ARC);
        d += (i === 0 ? 'M ' : ' L ') + r2(x) + ' ' + r2(y);
      }
      return d;
    }

    setMax(max) {
      if (!(max > this.min) || max === this.max) return;
      this.max = max;
      this.render();
    }

    update(value) {
      this.value = value;
      const v = Number.isFinite(value) ? value : this.min;
      const frac = Math.max(0, Math.min(1, (v - this.min) / ((this.max - this.min) || 1)));
      // SVG rotation is clockwise; 0° = straight up at mid-scale, ±120° at ends.
      const rot = -120 + frac * A_SWEEP;
      if (this.needle) this.needle.setAttribute('transform', `rotate(${r2(rot)} ${CX} ${CY})`);
      if (this.fill) this.fill.setAttribute('stroke-dasharray', `${r3(frac)} 1`);
      if (this.readout) this.readout.textContent = Number.isFinite(value) ? value.toFixed(this.decimals) : '—';
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.Gauge = Gauge;
})(typeof window !== 'undefined' ? window : globalThis);
