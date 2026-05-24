(() => {
    'use strict'; const U = window.Utilities;
    let kind = 'r', conn = 's';
    const $ = id => document.getElementById(id);
    const R_UNITS = [['MΩ', 1e6], ['kΩ', 1e3], ['Ω', 1], ['mΩ', 1e-3]];
    const C_UNITS = [['F', 1], ['mF', 1e-3], ['nF', 1e-9], ['µF', 1e-6], ['pF', 1e-12]];
    const parseInputString = U.parseNumber;
    function n(i) { const raw = parseInputString($('v' + i).value); if (!(raw > 0)) return null; const sel = $('unit' + i); return raw * Number(sel.value || 1) }
    function eng(v, u) { return U.engineering(v, u, 4); }
    function fillUnits() { const opts = kind === 'r' ? R_UNITS : C_UNITS; for (let i = 1; i <= 4; i++) { const sel = $('unit' + i); const old = sel.value; sel.innerHTML = opts.map(([label, m]) => `<option value="${m}">${label}</option>`).join(''); const def = kind === 'r' ? 1 : 1e-6; sel.value = opts.some(([, m]) => String(m) === old) ? old : String(def); } }
    function setSeg() { ['res', 'cap'].forEach(id => $(id).classList.toggle('seg__btn--active', (id === 'res') === (kind === 'r')));['series', 'parallel'].forEach(id => $(id).classList.toggle('seg__btn--active', (id === 'series') === (conn === 's'))); fillUnits(); render() }
    function render() { const vals = [1, 2, 3, 4].map(n).filter(Boolean), out = $('spValue'), meta = $('spMeta'), unit = kind === 'r' ? 'Ω' : 'F'; if (!vals.length) { out.textContent = '—'; meta.textContent = 'Enter up to four positive values.'; return } let eq; if (kind === 'r') eq = conn === 's' ? vals.reduce((a, b) => a + b, 0) : 1 / vals.reduce((a, b) => a + 1 / b, 0); else eq = conn === 's' ? 1 / vals.reduce((a, b) => a + 1 / b, 0) : vals.reduce((a, b) => a + b, 0); out.textContent = eng(eq, unit); meta.textContent = `${kind === 'r' ? 'Resistors' : 'Capacitors'} in ${conn === 's' ? 'series' : 'parallel'} • ${vals.length} value${vals.length === 1 ? '' : 's'}` }
    U.wireInputs(['v1', 'v2', 'v3', 'v4'], render);
    ['unit1', 'unit2', 'unit3', 'unit4'].forEach(id => $(id).addEventListener('change', render)); $('res').onclick = () => { kind = 'r'; setSeg() }; $('cap').onclick = () => { kind = 'c'; setSeg() }; $('series').onclick = () => { conn = 's'; setSeg() }; $('parallel').onclick = () => { conn = 'p'; setSeg() }; setSeg();
})();