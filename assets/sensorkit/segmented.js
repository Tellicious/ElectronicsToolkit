/* SensorKit — segmented pill control.
 *
 * Wraps a container of `.seg__btn[data-value]` buttons: paints the active
 * button and reports the chosen value. This replaces the per-app paint/wire
 * helpers that motion, mic and gps each carried, and the Settings page theme
 * picker, so the DOM logic lives in one place.
 *
 *   const seg = new SK.Segmented(el, { value: 'a', onChange: v => {...} });
 *   seg.set('b');   // update the active button WITHOUT firing onChange
 *   seg.value;      // current value
 *
 * `el` may be an element or an element id. `onChange` fires only on user
 * clicks, never on construction or on set(), so callers can drive it from
 * persisted state without re-entrancy.
 */
(function (root) {
  'use strict';

  class Segmented {
    constructor(el, opts = {}) {
      this.el = typeof el === 'string' ? document.getElementById(el) : el;
      this.onChange = opts.onChange || null;
      this.btns = this.el ? [...this.el.querySelectorAll('.seg__btn')] : [];
      this.value = opts.value != null ? opts.value : null;
      this.btns.forEach(b => b.addEventListener('click', () => {
        this.value = b.dataset.value;
        this.paint();
        if (this.onChange) this.onChange(this.value);
      }));
      this.paint();
    }

    set(value) {
      this.value = value;
      this.paint();
      return this;
    }

    paint() {
      this.btns.forEach(b => b.classList.toggle('seg__btn--active', b.dataset.value === this.value));
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.Segmented = Segmented;
})(typeof window !== 'undefined' ? window : globalThis);
