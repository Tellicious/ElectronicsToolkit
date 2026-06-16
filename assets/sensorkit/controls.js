/* SensorKit — control bar. Primary Start/Stop(/Resume) + Reset + Log.
 * handlers: { onStart, onStop, onReset, onLog }
 * set(state, {hasData, canLog}) where state ∈ 'idle'|'running'|'paused'.
 */
(function (root) {
  'use strict';

  class ControlBar {
    constructor(container, handlers) {
      this.h = handlers || {};
      this.state = 'idle';
      this.hasData = false;
      this.canLog = false;
      container.classList.add('btn-row');
      container.innerHTML =
        '<button class="btn btn--primary" data-a="primary" type="button">Start</button>' +
        '<button class="btn" data-a="reset" type="button">Reset</button>' +
        '<button class="btn" data-a="log" type="button">Save Log</button>';
      this.primary = container.querySelector('[data-a="primary"]');
      this.resetBtn = container.querySelector('[data-a="reset"]');
      this.logBtn = container.querySelector('[data-a="log"]');
      this.primary.addEventListener('click', () =>
        this.state === 'running' ? this.h.onStop && this.h.onStop() : this.h.onStart && this.h.onStart());
      this.resetBtn.addEventListener('click', () => this.h.onReset && this.h.onReset());
      this.logBtn.addEventListener('click', () => this.h.onLog && this.h.onLog());
      this.render();
    }
    set(state, opts = {}) {
      if (state) this.state = state;
      if ('hasData' in opts) this.hasData = opts.hasData;
      if ('canLog' in opts) this.canLog = opts.canLog;
      this.render();
    }
    render() {
      const running = this.state === 'running';
      this.primary.textContent = running ? 'Stop' : (this.state === 'paused' ? 'Resume' : 'Start');
      this.primary.classList.toggle('btn--stop', running);
      this.resetBtn.disabled = running || !this.hasData;
      this.logBtn.disabled = running || !this.canLog;
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.ControlBar = ControlBar;
})(typeof window !== 'undefined' ? window : globalThis);
