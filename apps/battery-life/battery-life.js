(() => { 'use strict'; const U = window.Utilities;
    const n = U.readNumber;
    function fmt(x, sig = 4) { return U.formatNumber(x, sig) }
    function render() { const c = n('cap'), i = n('cur'), e = n('eff') / 100, out = document.getElementById('batValue'), meta = document.getElementById('batMeta'); if (!(c > 0 && i > 0 && e > 0)) { out.textContent = '—'; meta.textContent = 'Enter capacity, current and usable percentage.'; return } const h = c * e / i, d = h / 24; out.textContent = h < 48 ? `${fmt(h, 3)} h` : `${fmt(d, 3)} days`; meta.textContent = `${fmt(h, 4)} hours at ${fmt(e * 100, 3)}% usable capacity.` }
    U.wireInputs('input', render);
    render(); })();
