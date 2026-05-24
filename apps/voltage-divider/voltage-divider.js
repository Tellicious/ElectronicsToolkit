(() => {
    'use strict'; const U = window.Utilities;
    const n = U.readNumber;
    function eng(v, u) { return U.engineering(v, u, 4, [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]); }
    function render() { const vin = n('vin'), r1 = n('r1'), r2 = n('r2'), out = document.getElementById('vdValue'), meta = document.getElementById('vdMeta'); if (!(r1 > 0 && r2 > 0) && vin !== 0) { out.textContent = '—'; meta.textContent = 'Enter positive resistor values.'; return } const v = vin * r2 / (r1 + r2), i = vin / (r1 + r2); out.textContent = eng(v, 'V'); meta.textContent = `Current ${eng(i, 'A')} • Total resistance ${eng(r1 + r2, 'Ω')}` }
    U.wireInputs('input', render);
    render();
})();
