(() => {
    'use strict';
    const U = window.Utilities;
    const n = U.readNumber;
    const fmtNum = U.formatNumber;

    // Engineering format without the pico prefix (matches the original readouts).
    function eng(v, u) { return U.engineering(v, u, 4, [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]); }

    // ---- Standard (IEC 60063 preferred) value series ----------------------
    // One decade each; scaled by powers of ten to reach any magnitude.
    const SERIES = {
        E12: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82],
        E24: [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91],
        E96: [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976],
    };

    // Normalize a series to mantissas in [1, 10).
    const mantissas = (s) => s.map(v => v / Math.pow(10, Math.floor(Math.log10(v))));
    const MANT = { E12: mantissas(SERIES.E12), E24: mantissas(SERIES.E24), E96: mantissas(SERIES.E96) };

    // Every standard value of `mant` lying within [lo, hi].
    function valuesInRange(mant, lo, hi) {
        const out = [];
        const kMin = Math.floor(Math.log10(lo)) - 1;
        const kMax = Math.floor(Math.log10(hi)) + 1;
        for (let k = kMin; k <= kMax; k++) {
            const scale = Math.pow(10, k);
            for (const m of mant) { const v = m * scale; if (v >= lo && v <= hi) out.push(v); }
        }
        return out;
    }

    // Choose a standard R1/R2 pair for a divider that outputs `vout` from `vin`
    // while drawing no more than `imax` amps through the chain (unloaded):
    //   Vout = Vin·R2/(R1+R2)      I = Vin/(R1+R2)
    // The continuous ideal sitting exactly at the current limit is
    //   R1 = (Vin−Vout)/Imax       R2 = Vout/Imax
    // Scaling both up preserves Vout and lowers I, so a feasible pair always
    // exists. We scan standard values around the ideal and keep the feasible
    // pair (I ≤ Imax) with the smallest Vout error, breaking ties toward the
    // lowest total resistance (stiffest output).
    function solve(vin, vout, imax, seriesName) {
        const mant = MANT[seriesName];
        const r1Ideal = (vin - vout) / imax;
        const r2Ideal = vout / imax;
        const r1Cands = valuesInRange(mant, r1Ideal / 3.2, r1Ideal * 3.2);
        const r2Cands = valuesInRange(mant, r2Ideal / 3.2, r2Ideal * 3.2);
        const tol = 1 + 1e-9;
        let best = null;
        for (const R1 of r1Cands) {
            for (const R2 of r2Cands) {
                const total = R1 + R2;
                const i = vin / total;
                if (i > imax * tol) continue;                 // over the current budget
                const vo = vin * R2 / total;
                const err = Math.abs(vo - vout) / vout;
                if (!best || err < best.err - 1e-12 ||
                    (Math.abs(err - best.err) <= 1e-12 && total < best.total)) {
                    best = { R1, R2, total, i, vo, err };
                }
            }
        }
        return { best, r1Ideal, r2Ideal };
    }

    // ---- Mode 1: Vout from Vin, R1, R2 (unchanged behaviour) --------------
    function renderVout() {
        const vin = n('vin'), r1 = n('r1'), r2 = n('r2'), out = document.getElementById('vdValue'), meta = document.getElementById('vdMeta');
        if (!(r1 > 0 && r2 > 0) && vin !== 0) { out.textContent = '—'; meta.textContent = 'Enter positive resistor values.'; return }
        const v = vin * r2 / (r1 + r2), i = vin / (r1 + r2);
        out.textContent = eng(v, 'V');
        meta.textContent = `Current ${eng(i, 'A')} • Total resistance ${eng(r1 + r2, 'Ω')}`;
    }

    // ---- Mode 2: standard R1 & R2 from Vin, Vout, Imax --------------------
    let series = 'E24';

    function renderDesign() {
        const r1El = document.getElementById('dvR1'), r2El = document.getElementById('dvR2');
        if (!r1El || !r2El) return;
        const r1Sub = document.getElementById('dvR1sub'), r2Sub = document.getElementById('dvR2sub');
        const meta = document.getElementById('dvMeta'), note = document.getElementById('dvNote');

        const clear = (msg) => {
            r1El.textContent = '—'; r2El.textContent = '—';
            r1Sub.textContent = ''; r2Sub.textContent = '';
            meta.textContent = msg || ''; note.textContent = '';
        };

        const vin = n('dvin'), vout = n('dvout'), imaxMa = n('dimax');
        if (!(vin > 0) || !(vout > 0) || !(imaxMa > 0)) { clear('Enter Vin, Vout (less than Vin) and a max current.'); return; }
        if (vout >= vin) { clear('Output voltage must be less than the input voltage.'); return; }

        const imax = imaxMa / 1000;
        const { best } = solve(vin, vout, imax, series);
        if (!best) { clear('No standard pair fits those constraints.'); return; }

        const p1 = best.i * best.i * best.R1, p2 = best.i * best.i * best.R2;
        r1El.textContent = eng(best.R1, 'Ω');
        r2El.textContent = eng(best.R2, 'Ω');
        r1Sub.textContent = `${eng(p1, 'W')} dissipated`;
        r2Sub.textContent = `${eng(p2, 'W')} dissipated`;

        const errPct = (best.vo - vout) / vout * 100;
        const errStr = `${errPct >= 0 ? '+' : '−'}${fmtNum(Math.abs(errPct), 2)}%`;
        meta.textContent = `Vout ${eng(best.vo, 'V')} (${errStr}) • ${eng(best.i, 'A')} of ${eng(imax, 'A')} max`;

        note.textContent = Math.abs(errPct) >= 2
            ? `Closest ${series} pair is ${errStr} off — use E96 or buffer the output for a tighter match.`
            : '';
    }

    // ---- Segmented controls + wiring -------------------------------------
    function paintSeg(groupId, key, value) {
        const g = document.getElementById(groupId);
        if (!g) return;
        g.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('seg__btn--active', b.dataset[key] === value));
    }

    function setMode(mode) {
        paintSeg('segMode', 'mode', mode);
        document.getElementById('modeVout').classList.toggle('vd-hide', mode !== 'vout');
        document.getElementById('modeDesign').classList.toggle('vd-hide', mode !== 'design');
    }

    const segMode = document.getElementById('segMode');
    if (segMode) segMode.addEventListener('click', (e) => { const b = e.target.closest('.seg__btn'); if (b) setMode(b.dataset.mode); });

    const segSeries = document.getElementById('segSeries');
    if (segSeries) segSeries.addEventListener('click', (e) => {
        const b = e.target.closest('.seg__btn'); if (!b) return;
        series = b.dataset.series; paintSeg('segSeries', 'series', series); renderDesign();
    });

    function render() { renderVout(); renderDesign(); }

    U.wireInputs('input', render);
    setMode('design');
    render();
})();