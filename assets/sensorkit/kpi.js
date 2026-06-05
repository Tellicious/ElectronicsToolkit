/* SensorKit — KPI tile grid. specs: [{ key, label }]. update({key: text}). */
(function (root) {
  'use strict';

  class KpiGrid {
    constructor(container, specs) {
      this.els = {};
      container.classList.add('sk-kpis');
      container.innerHTML = specs.map(s =>
        `<div class="sk-kpi"><div class="sk-kpi__label">${s.label}</div>` +
        `<div class="sk-kpi__value" data-k="${s.key}">—</div></div>`
      ).join('');
      specs.forEach(s => { this.els[s.key] = container.querySelector(`[data-k="${s.key}"]`); });
    }
    update(values) {
      for (const k in values) {
        const el = this.els[k];
        if (el) el.textContent = values[k];
      }
    }
  }

  root.SensorKit = root.SensorKit || {};
  root.SensorKit.KpiGrid = KpiGrid;
})(typeof window !== 'undefined' ? window : globalThis);
