(() => {
    'use strict'; const U = window.Utilities;
    const formatNumber = U.formatNumber;
    function fmtPf(p) { if (!isFinite(p)) return '—'; if (p >= 1e6) return `${formatNumber(p / 1e6, 4)} µF`; if (p >= 1e3) return `${formatNumber(p / 1e3, 4)} nF`; return `${formatNumber(p, 4)} pF` }
    function engineering(v, unit) { return U.engineeringExponent(v, unit, 4); }
    function decode(raw) { let s = raw.trim().toLowerCase().replace(/µ/g, 'u').replace(/\s/g, ''); if (!s) return null; if (/^\d{3}[a-z]?$/.test(s)) { let p = Number(s[0] + s[1]) * 10 ** Number(s[2]); return { pf: p, meta: '3-digit ceramic code' } } let m = s.match(/^(\d+(?:\.\d+)?)(p|pf|n|nf|u|uf|m|mf)$/); if (m) { let v = Number(m[1]), u = m[2][0]; let pf = u === 'p' ? v : u === 'n' ? v * 1e3 : u === 'u' ? v * 1e6 : v * 1e9; return { pf, meta: 'explicit value' } } m = s.match(/^(\d+)(p|n|u)(\d+)$/); if (m) { let pf = Number(`${m[1]}.${m[3]}`) * ({ p: 1, n: 1e3, u: 1e6 })[m[2]]; return { pf, meta: 'decimal letter notation' } } return { error: 'Try 104, 103, 4n7, 100nF, or 0.1uF.' } }
    const i = document.getElementById('capCode'), v = document.getElementById('capValue'), m = document.getElementById('capMeta'); function r() { let d = decode(i.value); if (!d) { v.textContent = '—'; m.textContent = 'Enter the marking printed on the part.'; return } if (d.error) { v.textContent = '—'; m.textContent = d.error; return } v.textContent = fmtPf(d.pf); m.textContent = `${d.meta} • ${engineering(d.pf * 1e-12, 'F')}`; } i.addEventListener('input', r); r();
})();
