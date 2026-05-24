(() => {
    'use strict'; let busy = false; const ids = ['awg', 'mm', 'mm2', 'inch', 'in2']; const Util = window.Utilities; const $id = Util.byId; const v = Util.readNumber;
    const formatNumber = Util.formatFixedNumber;
    function put(id, x) { if (!isFinite(x)) { $id(id).value = ''; return } if (id === 'awg') $id(id).value = String(Math.round(x)); else if (id === 'in2') $id(id).value = formatNumber(x, 5); else $id(id).value = formatNumber(x, 4) }
    function fromAwg(a) { return 0.127 * Math.pow(92, (36 - a) / 39) } function awgFromMm(d) { return 36 - 39 * Math.log(d / 0.127) / Math.log(92) } function update(src) { if (busy) return; busy = true; let d; let x = v(src); if (src === 'awg') { x = Math.round(x); if (String($id(src).value) !== '' && $id(src).value !== String(x)) $id(src).value = String(x) } if (!(x > 0)) { ids.filter(i => i !== src).forEach(i => $id(i).value = ''); busy = false; return } if (src === 'awg') d = fromAwg(x); if (src === 'mm') d = x; if (src === 'mm2') d = 2 * Math.sqrt(x / Math.PI); if (src === 'inch') d = x * 25.4; if (src === 'in2') d = 2 * Math.sqrt((x * 645.16) / Math.PI); const area = Math.PI * d * d / 4; if (src !== 'awg') put('awg', awgFromMm(d)); if (src !== 'mm') put('mm', d); if (src !== 'mm2') put('mm2', area); if (src !== 'inch') put('inch', d / 25.4); if (src !== 'in2') put('in2', area / 645.16); busy = false }
    Util.wireInputs(ids, el => update(el.id), { precision: el => el.id === 'in2' ? 5 : 4, fixed: true });
    $id('awg').value = '24'; update('awg');
})();
