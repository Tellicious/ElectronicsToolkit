(() => {
  'use strict';

  const U = window.Utilities;
  const S = U.Shapes;
  let mode = 'non';
  const $ = id => document.getElementById(id);
  const n = id => U.parseNumber($(id).value);

  function label(x, y, main, sub) {
    return S.text(x, y, `${main}${S.tspan(sub, { x: x + 19, y: y + 8, 'font-size': 16 })}`);
  }

  function labels(items) {
    return S.el('g', { fill: 'currentColor', style: 'font:600 30px var(--font-sans);' }, items.join(''));
  }

  function strokes(items) {
    return S.el('g', { stroke: 'currentColor', 'stroke-width': 2.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, items.join(''));
  }

  function renderInvertingSchematic() {
    const drawing = strokes([
      S.polygon('244,103 244,249 389,176', { fill: 'none' }),
      S.wire(67, 164, 117, 164),
      S.terminal(59, 164),
      S.resistor('117,164 128,153 139,175 150,153 161,175 172,153 183,175 194,164'),
      S.wire(194, 164, 244, 164),
      S.node(219, 164),
      S.path('M219 164V51H275'),
      S.resistor('275,51 286,40 297,62 308,40 319,62 330,40 341,62 352,51'),
      S.path('M352 51H434V176'),
      S.wire(389, 176, 464, 176),
      S.node(434, 176),
      S.terminal(464, 176),
      S.path('M244 219H198V253'),
      S.ground(198, 253),
    ]);

    const text = labels([
      label(17, 172, 'V', 'in'),
      label(143, 113, 'R', 'in'),
      label(297, 31, 'R', 'f'),
      label(476, 184, 'V', 'out'),
      S.text(255, 159, '−', { style: 'font-size:38px;' }),
      S.text(256, 228, '+', { style: 'font-size:38px;' }),
    ]);

    return S.svg('0 0 544 302', [drawing, text], { fill: 'none', 'aria-label': 'Inverting amplifier schematic' });
  }

  function renderNonInvertingSchematic() {
    const drawing = strokes([
      S.polygon('136,20 136,177 292,98', { fill: 'none' }),
      S.wire(82, 52, 136, 52),
      S.terminal(75, 52),
      S.wire(292, 98, 383, 98),
      S.node(348, 98),
      S.terminal(383, 98),
      S.path('M136 145H86V241'),
      S.node(86, 241),
      S.wire(86, 241, 86, 270),
      S.resistor('86,270 73,282 99,295 73,308 99,321 73,334 99,347 86,359'),
      S.wire(86, 359, 86, 384),
      S.ground(86, 384),
      S.wire(86, 241, 166, 241),
      S.resistor('166,241 178,229 190,253 202,229 214,253 226,229 238,253 250,241'),
      S.path('M250 241H348V98'),
    ]);

    const text = labels([
      label(23, 61, 'V', 'in'),
      label(36, 317, 'R', 'in'),
      label(196, 218, 'R', 'f'),
      label(393, 107, 'V', 'out'),
      S.text(146, 63, '+', { style: 'font-size:38px;' }),
      S.text(148, 150, '−', { style: 'font-size:38px;' }),
    ]);

    return S.svg('-42.5 0 544 428', [drawing, text], { fill: 'none', 'aria-label': 'Non-inverting amplifier schematic' });
  }

  function schematic() {
    const el = $('opSchematic');
    if (!el) return;
    S.setSVG(el, mode === 'inv' ? renderInvertingSchematic() : renderNonInvertingSchematic());
  }

  function set(m) {
    mode = m;
    $('noninv').classList.toggle('seg__btn--active', m === 'non');
    $('inv').classList.toggle('seg__btn--active', m === 'inv');
    schematic();
    render();
  }

  function render() {
    const rin = n('rin'), rf = n('rf'), out = $('opValue'), meta = $('opMeta');
    if (!(rin > 0 && rf >= 0)) {
      out.textContent = '—';
      meta.textContent = 'Enter positive resistor values.';
      return;
    }
    const g = mode === 'non' ? 1 + rf / rin : -(rf / rin);
    out.textContent = `${U.formatNumber(g, 5)}×`;
    meta.textContent = mode === 'non' ? 'Non-inverting: Av = 1 + Rf/Rin' : 'Inverting: Av = -Rf/Rin';
  }

  U.wireInputs(['rin', 'rf'], render, { precision: 5 });
  $('noninv').onclick = () => set('non');
  $('inv').onclick = () => set('inv');
  set('non');
})();
