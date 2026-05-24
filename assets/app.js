/* Shared Electronics Toolkit app helpers */
(function () {
  'use strict';
  const KEY = 'utilities.theme';
  const root = document.documentElement;

  function applyTheme(mode) {
    const safe = ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto';
    root.dataset.theme = safe;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const dark = safe === 'dark' || (safe === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    }
  }

  function compactNumberText(raw) {
    return String(raw ?? '').trim().replace(/\u2009|\u200A|\s/g, '');
  }

  function normalizeNumber(raw) {
    let s = compactNumberText(raw);
    if (!s) return '';

    const sign = s.match(/^[-+]/)?.[0] || '';
    if (sign) s = s.slice(1);

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma) {
      // App convention: dot = thousands separator, comma = decimal separator.
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (hasDot) {
      const groupedThousands = /^\d{1,3}(\.\d{3})+$/.test(s);
      if (groupedThousands) {
        s = s.replace(/\./g, '');
      } else {
        // Keep a single dot as a decimal separator for direct keyboard input.
        // If multiple dots are present and it is not valid grouping, use the
        // last dot as decimal and strip earlier dots defensively.
        const dots = (s.match(/\./g) || []).length;
        if (dots > 1) {
          const idx = s.lastIndexOf('.');
          s = s.slice(0, idx).replace(/\./g, '') + s.slice(idx);
        }
      }
    }

    return sign + s;
  }

  function parseNumber(raw) {
    const normalized = normalizeNumber(raw);
    if (!normalized) return NaN;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }

  function groupInteger(integer) {
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function localizeNumberText(text) {
    const [integer, fraction] = String(text).split('.');
    const sign = integer.startsWith('-') || integer.startsWith('+') ? integer[0] : '';
    const unsigned = sign ? integer.slice(1) : integer;
    const grouped = sign + groupInteger(unsigned);
    return fraction ? `${grouped},${fraction}` : grouped;
  }

  function formatNumber(value, precision = 4, fallback = '—') {
    if (!Number.isFinite(value)) return fallback;
    return localizeNumberText(Number(value.toPrecision(precision)).toString());
  }

  function formatFixedNumber(value, decimals = 4, fallback = '') {
    if (!Number.isFinite(value)) return fallback;
    return localizeNumberText(Number(value.toFixed(decimals)).toString());
  }

  function formatInput(el, precision = 4) {
    const value = parseNumber(el.value);
    if (Number.isNaN(value)) return;
    el.value = formatNumber(value, precision);
  }

  function unformatInput(el) {
    el.value = normalizeNumber(el.value);
  }

  function engineering(value, unit, precision = 4, prefixes) {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return `0 ${unit}`;
    const table = prefixes || [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
    const a = Math.abs(value);
    for (const [multiplier, prefix] of table) {
      if (a >= multiplier) return `${formatNumber(value / multiplier, precision)} ${prefix}${unit}`;
    }
    return `${formatNumber(value, precision)} ${unit}`;
  }

  function engineeringExponent(value, unit, precision = 4) {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return `0 ${unit}`;
    const exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
    const coefficient = value / 10 ** exponent;
    return `${formatNumber(coefficient, precision)}×10^${exponent} ${unit}`;
  }

  function setText(target, value) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (el) el.textContent = value;
  }

  function setHTML(target, value) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (el) el.innerHTML = value;
  }



  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function svgAttrs(attrs = {}) {
    return Object.entries(attrs)
      .filter(([, value]) => value !== null && value !== undefined && value !== false)
      .map(([key, value]) => value === true ? key : `${key}="${escapeHTML(value)}"`)
      .join(' ');
  }

  function svgEl(name, attrs = {}, children = '') {
    const attrText = svgAttrs(attrs);
    const open = attrText ? `<${name} ${attrText}` : `<${name}`;
    const content = Array.isArray(children) ? children.join('') : String(children ?? '');
    return content ? `${open}>${content}</${name}>` : `${open}/>`;
  }

  function svg(viewBox, children, attrs = {}) {
    return svgEl('svg', Object.assign({ viewBox, xmlns: 'http://www.w3.org/2000/svg' }, attrs), children);
  }

  function setSVG(target, value) {
    setHTML(target, value);
  }

  function wire(x1, y1, x2, y2, attrs = {}) {
    return svgEl('line', Object.assign({ x1, y1, x2, y2 }, attrs));
  }

  function path(d, attrs = {}) {
    return svgEl('path', Object.assign({ d }, attrs));
  }

  function polyline(points, attrs = {}) {
    return svgEl('polyline', Object.assign({ points: Array.isArray(points) ? points.join(' ') : points }, attrs));
  }

  function polygon(points, attrs = {}) {
    return svgEl('polygon', Object.assign({ points: Array.isArray(points) ? points.join(' ') : points }, attrs));
  }

  function circle(cx, cy, r, attrs = {}) {
    return svgEl('circle', Object.assign({ cx, cy, r }, attrs));
  }

  function rect(x, y, width, height, attrs = {}) {
    return svgEl('rect', Object.assign({ x, y, width, height }, attrs));
  }

  function text(x, y, content, attrs = {}) {
    return svgEl('text', Object.assign({ x, y }, attrs), content);
  }

  function tspan(content, attrs = {}) {
    return svgEl('tspan', attrs, escapeHTML(content));
  }

  function resistor(points, attrs = {}) {
    return polyline(points, attrs);
  }

  function ground(x, y, attrs = {}) {
    return [
      wire(x - 17, y, x + 17, y, attrs),
      wire(x - 11, y + 11, x + 11, y + 11, attrs),
      wire(x - 5, y + 22, x + 5, y + 22, attrs),
    ].join('');
  }

  function node(cx, cy, filled = true) {
    return circle(cx, cy, 6, filled ? { fill: 'currentColor', stroke: 'none' } : { fill: 'var(--surface-2)' });
  }

  function terminal(cx, cy) {
    return node(cx, cy, false);
  }

  const Shapes = {
    attrs: svgAttrs,
    el: svgEl,
    svg,
    setSVG,
    wire,
    path,
    polyline,
    polygon,
    circle,
    rect,
    text,
    tspan,
    resistor,
    ground,
    node,
    terminal,
  };

  function fillSelect(select, options, selectedValue) {
    if (!select) return;
    select.innerHTML = options.map(([label, value]) => `<option value="${value}">${label}</option>`).join('');
    if (selectedValue != null) select.value = String(selectedValue);
  }

  // --- DOM helpers shared by the sub-apps ---------------------------------

  // Resolve a target to an element. Accepts an id string or an element.
  function byId(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  // Parse the numeric value currently typed into an input (by id or element).
  function readNumber(target) {
    const el = byId(target);
    return el ? parseNumber(el.value) : NaN;
  }

  // Resolve a list of targets to elements. Accepts an array of ids/elements,
  // a single element, a NodeList/array, or a CSS selector string.
  function resolveElements(targets) {
    if (targets == null) return [];
    if (typeof targets === 'string') return Array.from(document.querySelectorAll(targets));
    if (typeof targets.length === 'number' && typeof targets !== 'function') {
      return Array.from(targets, byId).filter(Boolean);
    }
    return [byId(targets)].filter(Boolean);
  }

  // Wire up the standard input lifecycle shared across every calculator:
  //   • input  → run the supplied handler (recompute the result)
  //   • blur   → reformat the field with grouping/precision
  //   • focus  → strip formatting back to a raw, editable number
  //
  // `targets` may be an array of ids, a NodeList, an element, or a selector.
  // `opts.precision` is either a number or a function (el) => number, applied
  // per-field on blur. `opts.fixed` selects fixed-decimal formatting
  // (toFixed) instead of the default significant-figure formatting. The
  // handler is invoked with the element that changed.
  function wireInputs(targets, handler, opts = {}) {
    const precisionOpt = opts.precision;
    const useFixed = !!opts.fixed;
    const elements = resolveElements(targets);
    elements.forEach((el) => {
      el.addEventListener('input', () => { if (handler) handler(el); });
      el.addEventListener('blur', () => {
        if (!el.value) return;
        const raw = typeof precisionOpt === 'function' ? precisionOpt(el) : precisionOpt;
        const precision = raw == null ? 4 : raw;
        if (useFixed) {
          const value = parseNumber(el.value);
          if (!Number.isNaN(value)) el.value = formatFixedNumber(value, precision);
        } else {
          formatInput(el, precision);
        }
      });
      el.addEventListener('focus', () => unformatInput(el));
    });
    return elements;
  }

  window.Utilities = Object.assign(window.Utilities || {}, {
    parseNumber,
    normalizeNumber,
    formatNumber,
    formatFixedNumber,
    formatInput,
    unformatInput,
    engineering,
    engineeringExponent,
    setText,
    setHTML,
    setSVG,
    fillSelect,
    byId,
    readNumber,
    wireInputs,
    svgAttrs,
    svgEl,
    svg,
    Shapes,
  });

  window.UtilitiesSettings = {
    get theme() { return localStorage.getItem(KEY) || 'auto'; },
    set theme(v) { localStorage.setItem(KEY, v); applyTheme(v); },
    applyTheme,
  };
  applyTheme(localStorage.getItem(KEY) || 'auto');
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(localStorage.getItem(KEY) || 'auto'));

  // --- Service worker registration (shared by every page) -----------------
  //
  // This used to be a ~30-line block copy-pasted into the hub and the
  // resistor page (and missing from every other sub-app). It now lives here
  // once, so it runs on *every* page that loads app.js and there's a single
  // place to change the update behaviour.
  //
  // The SW lives at the site root (sw.js) with root scope, but app.js is
  // loaded from pages at different depths (./assets/app.js from the root,
  // ../../assets/app.js from a sub-app). We derive the root from this
  // script's own resolved URL — it always ends in `assets/app.js` — so the
  // registration works regardless of which page we're on.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const script = document.currentScript;
    const src = script && script.src;
    // Strip the trailing "assets/app.js" to get the site root URL.
    const root = src ? src.replace(/assets\/app\.js(?:\?.*)?$/, '') : './';
    const swUrl = root + 'sw.js';

    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register(swUrl, {
          scope: root,
          // Bypass the HTTP cache for the SW file itself, so updates to
          // sw.js are detected on every load.
          updateViaCache: 'none',
        });

        // Check for an updated SW right now.
        reg.update().catch(() => { });

        // When a new SW takes control, reload once to get fresh assets.
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });

        // If a new SW is waiting/installed, tell it to activate immediately.
        function promoteWaiting(worker) {
          if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        }
        if (reg.waiting) promoteWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => promoteWaiting(installing));
        });
      } catch (e) {
        // SW registration failed (probably http:// or file://) — that's fine,
        // the app still works without offline support.
      }
    });
  }
  registerServiceWorker();
})();
