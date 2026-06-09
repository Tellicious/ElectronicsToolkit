(() => {
  'use strict';
  const U = window.Utilities;

  // ===== Configuration ===================================================
  const A4 = 440;                          // reference pitch (fixed)
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const TOL_CENTS = 5;                     // |cents| <= this reads as in tune
  const RMS_GATE = 0.005;                  // ignore frames quieter than this
  const DET_MS = 90;                       // detection cadence (ms)
  const HOLD_MS = 5000;                     // keep last reading this long after sound stops

  // Pitch detection — YIN (de Cheveigné & Kawahara, 2002). YIN is the de-facto
  // standard for instrument tuners: a time-domain difference function with
  // cumulative-mean normalization that stays accurate at low frequencies and is
  // largely immune to the octave errors that plague raw autocorrelation and
  // FFT/HPS detectors.
  const FFT_SIZE = 8192;                   // analyser time-domain buffer length
  const YIN_W = 4096;                      // integration window (samples)
  const YIN_TAUMAX = 2048;                 // longest lag searched (≈ lowest pitch)
  const YIN_THRESHOLD = 0.12;              // accept the first CMND dip below this
  const YIN_NOPITCH = 0.60;                // CMND above this everywhere ⇒ unpitched

  // Reading smoothing — deliberately light; YIN is already steady frame to frame.
  const MEDIAN_N = 3;                      // tiny median rejects the odd glitch frame
  const FREQ_SMOOTH = 0.5;                 // frequency EMA factor (lower = livelier)
  const SNAP_RATIO = 0.04;                 // jumps over this (~⅔ semitone) snap, not damp

  // ===== Note math =======================================================
  const log2 = x => Math.log(x) / Math.LN2;
  function noteToMidi(name) {
    const m = /^([A-G])(#|♯)?(-?\d+)$/.exec(name);
    if (!m) return null;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return (parseInt(m[3], 10) + 1) * 12 + base + (m[2] ? 1 : 0);
  }
  const midiToFreq = n => A4 * Math.pow(2, (n - 69) / 12);
  const midiToName = n => SHARP[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  const centsTo = (f, ref) => 1200 * log2(f / ref);
  const nearestMidi = f => Math.round(69 + 12 * log2(f / A4));

  // ===== Instruments =====================================================
  // Each instrument fixes its open-string set (for the chips and the
  // nearest-string highlight) and, through band(), the frequency range YIN
  // searches for the fundamental.
  const strings = names => names.map(nm => { const midi = noteToMidi(nm); return { name: nm, midi, freq: midiToFreq(midi) }; });
  const INSTRUMENTS = {
    guitar: { label: 'Guitar', strings: strings(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']) },
    bass: { label: 'Bass', strings: strings(['E1', 'A1', 'D2', 'G2']) },
    ukulele: { label: 'Ukulele', strings: strings(['G4', 'C4', 'E4', 'A4']) },
    violin: { label: 'Violin', strings: strings(['G3', 'D4', 'A4', 'E5']) },
    free: { label: 'Free', strings: null },
  };
  const ORDER = ['guitar', 'bass', 'ukulele', 'violin', 'free'];

  let instKey = localStorage.getItem('tuner.instrument') || 'guitar';
  if (!INSTRUMENTS[instKey]) instKey = 'guitar';
  let inst = INSTRUMENTS[instKey];

  // ===== DOM =============================================================
  const el = id => document.getElementById(id);
  const noteMain = el('noteMain'), notePrev = el('notePrev'), noteNext = el('noteNext');
  const centsVal = el('centsVal'), dirVal = el('dirVal'), freqVal = el('freqVal');
  const meter = el('meter'), marker = el('marker'), zone = el('zone');
  const stringCard = el('stringCard'), stringRow = el('stringRow');
  const startBtn = el('startBtn'), startLabel = el('startLabel'), statusEl = el('status');

  // Static meter furniture: in-tune zone + cents ticks.
  zone.style.left = (50 - TOL_CENTS) + '%';
  zone.style.width = (2 * TOL_CENTS) + '%';
  (function ticks() {
    const wrap = el('meterTicks');
    for (let c = -50; c <= 50; c += 10) {
      const t = document.createElement('div');
      t.className = 'tuner-meter__tick' + (c === 0 ? ' tuner-meter__tick--center' : '');
      t.style.left = (50 + c) + '%';
      wrap.appendChild(t);
    }
  })();

  // ===== Instrument + string UI ==========================================
  function buildInstruments() {
    const g = el('segInstrument');
    g.innerHTML = ORDER.map(k => `<button class="seg__btn" type="button" data-value="${k}">${INSTRUMENTS[k].label}</button>`).join('');
    [...g.querySelectorAll('.seg__btn')].forEach(b => b.addEventListener('click', () => setInstrument(b.dataset.value)));
    paintInstruments();
  }
  function paintInstruments() {
    [...el('segInstrument').querySelectorAll('.seg__btn')].forEach(b =>
      b.classList.toggle('seg__btn--active', b.dataset.value === instKey));
  }
  function buildStringRow() {
    if (!inst.strings) { stringCard.hidden = true; stringRow.innerHTML = ''; return; }
    stringCard.hidden = false;
    stringRow.innerHTML = inst.strings.map((s, i) => `<div class="tuner-chip" data-i="${i}">${s.name}</div>`).join('');
  }
  function paintStringRow(active, inTune) {
    if (!inst.strings) return;
    [...stringRow.children].forEach((c, i) => {
      c.classList.toggle('tuner-chip--active', i === active);
      c.classList.toggle('tuner-chip--tuned', i === active && inTune);
    });
  }
  function setInstrument(key) {
    if (!INSTRUMENTS[key] || key === instKey) return;
    instKey = key; inst = INSTRUMENTS[key];
    localStorage.setItem('tuner.instrument', key);
    paintInstruments();
    buildStringRow();
    resetReading();          // band() now reflects the new instrument
  }

  // ===== Audio + DSP =====================================================
  let ctx = null, stream = null, source = null, analyser = null;
  let buf = null;                          // most-recent time-domain samples
  const cmnd = new Float32Array(YIN_TAUMAX + 2);   // reused CMND scratch buffer
  let rafId = 0, lastDet = 0, started = false;

  // Hz band the fundamental may live in — bounds the YIN lag search.
  function band() {
    if (inst.strings) {
      const f = inst.strings.map(s => s.freq);
      return [Math.min(...f) * 0.80, Math.max(...f) * 1.30];
    }
    return [30, 2100];                     // free mode: cover most instruments
  }

  // YIN pitch detector: difference function + cumulative-mean normalization +
  // absolute threshold + parabolic interpolation. Returns the fundamental in
  // Hz, or null when the frame is too quiet or has no clear pitch.
  function detect() {
    if (!buf) return null;
    const sr = ctx ? ctx.sampleRate : 48000;
    const [fmin, fmax] = band();
    const tauMin = Math.max(2, Math.floor(sr / fmax));
    const tauMax = Math.min(YIN_TAUMAX, Math.floor(sr / fmin) + 2, buf.length - 2);
    if (tauMax <= tauMin) return null;
    const W = Math.min(YIN_W, buf.length - tauMax);
    if (W < 2) return null;
    const base = buf.length - (W + tauMax);          // analyse the newest samples

    // Signal gate: ignore near-silence.
    let ss = 0;
    for (let j = 0; j < W; j++) { const v = buf[base + j]; ss += v * v; }
    if (Math.sqrt(ss / W) < RMS_GATE) return null;

    // Difference function d(τ) and its cumulative-mean-normalized form d'(τ).
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) { const diff = buf[base + j] - buf[base + j + tau]; sum += diff * diff; }
      running += sum;
      cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    // Absolute threshold: the first dip below the threshold, descended to its
    // local minimum, is the period — this is what makes YIN octave-robust.
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (cmnd[t] < YIN_THRESHOLD) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t; break;
      }
    }
    if (tau < 0) {                                   // nothing crossed the threshold
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
      if (cmnd[best] > YIN_NOPITCH) return null;      // too unclear → no pitch
      tau = best;
    }

    // Parabolic interpolation of the minimum for sub-sample (sub-cent) accuracy.
    const x0 = cmnd[tau - 1], x1 = cmnd[tau], x2 = (tau + 1 <= tauMax) ? cmnd[tau + 1] : cmnd[tau];
    const denom = x0 + x2 - 2 * x1;
    let period = tau;
    if (denom > 0) { let off = 0.5 * (x0 - x2) / denom; if (off > 1) off = 1; else if (off < -1) off = -1; period = tau + off; }
    return sr / period;
  }

  // ===== Reading state + render ==========================================
  let holdUntil = 0;

  // Frequency smoothing. A short median rejects single-frame glitches
  // (including the odd octave slip); an EMA then damps the residual wobble so
  // the needle holds still. A large jump (you've moved to another string)
  // snaps straight through instead of crawling, so re-plucking responds at once.
  let fHist = [], fEma = null;
  function smoothFreq(f) {
    fHist.push(f);
    if (fHist.length > MEDIAN_N) fHist.shift();
    const med = fHist.slice().sort((a, b) => a - b)[fHist.length >> 1];
    if (fEma == null) fEma = med;
    else if (Math.abs(med / fEma - 1) > SNAP_RATIO) { fEma = med; fHist = [med]; }
    else fEma = fEma * FREQ_SMOOTH + med * (1 - FREQ_SMOOTH);
    return fEma;
  }

  function resetReading() { fHist = []; fEma = null; holdUntil = 0; renderIdle(); }

  function renderIdle() {
    noteMain.textContent = '—';
    notePrev.textContent = ''; noteNext.textContent = '';
    centsVal.textContent = '';
    dirVal.textContent = ''; dirVal.className = 'tuner-dir';
    freqVal.textContent = '';
    setMarker(0, false, true);
    paintStringRow(-1, false);
  }

  function setMarker(cents, inTune, dim) {
    marker.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
    meter.classList.toggle('tuner-meter--in', inTune && !dim);
    meter.classList.toggle('tuner-meter--dim', !!dim);
  }

  function process(fRaw) {
    const now = performance.now();
    if (fRaw == null) {
      if (now > holdUntil) { if (started) statusEl.textContent = 'Listening…'; renderIdle(); }
      return;
    }
    statusEl.textContent = '';
    holdUntil = now + HOLD_MS;

    const f = smoothFreq(fRaw);

    let label, cents, prev = '', next = '', active = -1;
    if (inst.strings) {
      let bi = 0, bc = Infinity;
      inst.strings.forEach((s, i) => { const c = centsTo(f, s.freq); if (Math.abs(c) < Math.abs(bc)) { bc = c; bi = i; } });
      active = bi; cents = bc; label = inst.strings[bi].name;
    } else {
      const midi = nearestMidi(f);
      cents = centsTo(f, midiToFreq(midi));
      label = midiToName(midi); prev = midiToName(midi - 1); next = midiToName(midi + 1);
    }

    const inTune = Math.abs(cents) <= TOL_CENTS;
    const r = Math.round(cents);

    noteMain.textContent = label;
    notePrev.textContent = prev; noteNext.textContent = next;
    centsVal.textContent = (r > 0 ? '+' : '') + r + ' ¢';
    if (inTune) { dirVal.textContent = 'In tune'; dirVal.className = 'tuner-dir tuner-dir--ok'; }
    else if (cents < 0) { dirVal.textContent = '↑ tune up'; dirVal.className = 'tuner-dir'; }
    else { dirVal.textContent = '↓ tune down'; dirVal.className = 'tuner-dir'; }
    freqVal.textContent = f.toFixed(1) + ' Hz';
    setMarker(cents, inTune, false);
    paintStringRow(active, inTune);
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!started || !analyser) return;
    const now = performance.now();
    if (now - lastDet < DET_MS) return;
    lastDet = now;
    analyser.getFloatTimeDomainData(buf);
    process(detect());
  }

  // ===== Start / lifecycle ===============================================
  async function start() {
    U.wakeLock.acquire();
    try {
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      if (ctx.state !== 'running') { showStart('Tap to start listening'); return false; }
      if (!source) source = ctx.createMediaStreamSource(stream);
      if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = FFT_SIZE; analyser.smoothingTimeConstant = 0; source.connect(analyser); }
      if (!buf) buf = new Float32Array(analyser.fftSize);
      started = true;
      hideStart();
      statusEl.textContent = 'Listening…';
      if (!rafId) loop();
      return true;
    } catch (e) {
      started = false;
      U.wakeLock.release();
      showStart(e && e.name === 'NotAllowedError' ? 'Microphone access needed — tap to retry' : 'Mic unavailable — tap to retry');
      return false;
    }
  }
  function showStart(msg) { startLabel.textContent = msg; startBtn.hidden = false; statusEl.textContent = ''; }
  function hideStart() { startBtn.hidden = true; }

  startBtn.addEventListener('click', start);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (!started) start(); else if (ctx && ctx.state !== 'running') ctx.resume(); }
    else if (ctx) ctx.suspend();
  });
  window.addEventListener('pagehide', () => {
    started = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; source = null; analyser = null; }
    if (ctx) { try { ctx.close(); } catch (_) { } ctx = null; }
    U.wakeLock.release();
  });

  // ===== Boot ============================================================
  buildInstruments();
  buildStringRow();
  renderIdle();
  start();   // auto-listen on open; falls back to a tap where the platform needs a gesture
})();
