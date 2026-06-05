/* SensorKit — CSV logger. Schema-driven row buffer with Share/download export.
 * columns: [{ key, header }]. Exposed as SensorKit.CsvLogger; testable in node.
 */
(function (root) {
  'use strict';

  function cell(v) {
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  class CsvLogger {
    constructor(columns) {
      this.columns = columns;
      this.rows = [];
    }
    get count() { return this.rows.length; }
    clear() { this.rows = []; }
    addRow(obj) { this.rows.push(this.columns.map(c => cell(obj[c.key]))); }
    toString() {
      const head = this.columns.map(c => c.header).join(',');
      const body = this.rows.map(r => r.join(',')).join('\n');
      return body ? head + '\n' + body + '\n' : head + '\n';
    }
    async export(filename) {
      const blob = new Blob([this.toString()], { type: 'text/csv' });
      try {
        const file = new File([blob], filename, { type: 'text/csv' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return;
        }
      } catch (_) { /* user cancelled or unsupported — fall through to download */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { CsvLogger };
  root.SensorKit = root.SensorKit || {};
  root.SensorKit.CsvLogger = CsvLogger;
})(typeof window !== 'undefined' ? window : globalThis);
