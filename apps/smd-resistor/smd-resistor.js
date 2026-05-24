(() => {
    'use strict'; const U = window.Utilities;
    const E96 = [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976];
    const MULT = { Z: -3, Y: -2, R: -2, X: -1, S: -1, A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
    const formatNumber = U.formatNumber;
    function fmtOhms(o) { if (!isFinite(o)) return '—'; let a = Math.abs(o), v, u; if (a >= 1e6) { v = o / 1e6; u = 'MΩ' } else if (a >= 1e3) { v = o / 1e3; u = 'kΩ' } else { v = o; u = 'Ω' } return `${formatNumber(v, 4)} ${u}` }
    function engineering(v, unit) { return U.engineeringExponent(v, unit, 4); }
    function decode(raw) { let s = raw.trim().toUpperCase().replace(/Ω/g, ''); if (!s) return null; if (/^0+$/.test(s)) return { ohms: 0, meta: 'zero-ohm jumper' }; if (/^[0-9]+R[0-9]*$|^[0-9]*R[0-9]+$/.test(s)) return { ohms: Number(s.replace('R', '.')), meta: 'R notation' }; if (/^\d{3}$/.test(s)) { let d = s.slice(0, 2), m = +s[2]; return { ohms: Number(d) * 10 ** m, meta: '3-digit code' } } if (/^\d{4}$/.test(s)) { let d = s.slice(0, 3), m = +s[3]; return { ohms: Number(d) * 10 ** m, meta: '4-digit code' } } if (/^\d{2}[A-Z]$/.test(s)) { let n = +s.slice(0, 2), m = MULT[s[2]]; if (n >= 1 && n <= 96 && m !== undefined) return { ohms: E96[n - 1] * 10 ** m, meta: 'EIA-96 code' } } return { error: 'Unsupported marking. Try 472, 4701, 4R7, or 01C.' } }
    const input = document.getElementById('code'), value = document.getElementById('value'), meta = document.getElementById('meta');
    function render() { let r = decode(input.value); if (!r) { value.textContent = '—'; meta.textContent = 'Enter the marking printed on the part.'; return } if (r.error) { value.textContent = '—'; meta.textContent = r.error; return } value.textContent = fmtOhms(r.ohms); meta.textContent = `${r.meta} • ${engineering(r.ohms, 'Ohm')}`; }
    input.addEventListener('input', render); render();
})();
