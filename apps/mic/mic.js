(() => {
  'use strict';
  const U = window.Utilities;
  const SK = window.SensorKit;
  const F = SK.format;
  const dB = x => (Number.isFinite(x) ? Math.max(0, x).toFixed(1) + ' dB' : '—');

  // --- Settings (persisted) ----------------------------------------------
  const SETTINGS = {
    weighting: localStorage.getItem('mic.weighting') || 'a',     // z|a|c
    timeWeight: localStorage.getItem('mic.timeWeight') || 'fast', // fast|slow|impulse
    cal: (localStorage.getItem('mic.cal') != null ? parseFloat(localStorage.getItem('mic.cal')) : 120), // dBFS->SPL offset (0 dBFS ~ 120 dB SPL)
    logging: localStorage.getItem('mic.logging') === 'on',
    window: localStorage.getItem('mic.window') || 'hanning',
    fftSize: parseInt(localStorage.getItem('mic.fftSize')) || 16384,
    decim: parseInt(localStorage.getItem('mic.decim')) || 1,      // sampling-rate divisor
    coupling: localStorage.getItem('mic.coupling') || 'ac',
    peakCount: parseInt(localStorage.getItem('mic.peakCount')) || 1,
    smoothing: (localStorage.getItem('mic.smoothing') != null ? parseFloat(localStorage.getItem('mic.smoothing')) : 0.8),
  };

  // --- Frequency weighting (linear gain, normalised to 0 dB at 1 kHz) ----
  function Wlin(f, type) {
    if (type === 'z') return 1;
    const f2 = f * f;
    if (type === 'a') {
      const ra = (12194 ** 2 * f2 * f2) /
        ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
      return ra * 1.258925;   // +2.00 dB
    }
    const rc = (12194 ** 2 * f2) / ((f2 + 20.6 ** 2) * (f2 + 12194 ** 2));
    return rc * 1.006932;     // +0.06 dB
  }

  // --- UI components -----------------------------------------------------
  const kpi = new SK.KpiGrid(document.getElementById('kpis'), [
    { key: 'leq', label: 'L_eq' }, { key: 'lmax', label: 'L_max' }, { key: 'l90', label: 'L90' },
    { key: 'sel', label: 'SEL' }, { key: 'duration', label: 'Duration' },
  ]);

  const scope = new SK.LivePlot(document.getElementById('chartScope'),
    { color: '#0a84ff', symmetric: false, yMin: -0.05, yMax: 0.05, fmtX: v => v.toFixed(0) + 'ms', fmtY: v => v.toFixed(3), empty: 'Start to view waveform' });
  const spectrum = new SK.LivePlot(document.getElementById('chartSpec'),
    { color: '#ff9f0a', symmetric: false, yMin: -60, yMax: 95, logX: true, fill: true, peakLine: true, fmtX: v => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)), fmtY: v => v.toFixed(0), empty: 'Start to view spectrum' });
  const levelHist = new SK.TimeSeriesChart(document.getElementById('chartLevel'),
    { color: '#34c759', symmetric: false, yMin: 30, fmt: v => v.toFixed(0) });

  // --- CSV ---------------------------------------------------------------
  const csv = new SK.CsvLogger([
    { key: 'iso', header: 'time_iso' }, { key: 'elapsed', header: 'elapsed_s' },
    { key: 'lp', header: 'Lp_db' }, { key: 'leq', header: 'Leq_db' },
    { key: 'weight', header: 'weighting' }, { key: 'dom', header: 'dominant_hz' },
  ]);

  // --- Audio + DSP state -------------------------------------------------
  let ctx = null, stream = null, source = null, analyser = null, fft = null;
  let buf = null, dec = null, specDb = null, scopeXs = null, scopeYs = null, rafId = 0;
  let ring = null, ringLen = 0, ringW = 0;          // rolling raw-sample buffer for the scope
  let pSmooth = 1e-12, primed = false, lastFrameT = 0, lastSlow = 0;
  const st = {
    running: false, started: false, startT: 0, runMs: 0, warmT: 0,
    sumPdt: 0, sumT: 0, lMax: -Infinity, lMin: Infinity, lp: [],
  };

  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
  function buffers() {
    const N = SETTINGS.fftSize, M = SETTINGS.decim;
    if (analyser) analyser.fftSize = Math.min(32768, nextPow2(N * M));
    buf = new Float32Array(analyser ? analyser.fftSize : nextPow2(N * M));
    dec = new Float32Array(N);
    specDb = new Float32Array(N / 2);
    const fsEff = (ctx ? ctx.sampleRate : 48000) / M;
    if (ctx) { const rl = Math.ceil(2.2 * ctx.sampleRate); if (!ring || ring.length !== rl) { ring = new Float32Array(rl); ringW = 0; } ringLen = ring.length; }
    if (!fft) fft = new SK.FFT({ size: N, sampleRate: fsEff, window: SETTINGS.window, coupling: SETTINGS.coupling, peakCount: SETTINGS.peakCount, smoothing: SETTINGS.smoothing });
    else fft.configure({ size: N, sampleRate: fsEff, window: SETTINGS.window, coupling: SETTINGS.coupling, peakCount: SETTINGS.peakCount, smoothing: SETTINGS.smoothing });
    updateSpectrumAxis();
  }

  // Spectrum x-axis. Linear starts at 0 Hz; log uses decade ticks from 20 Hz.
  // Either way the max is the Nyquist of the (decimated) sampling rate.
  function specTicks(fmax) {
    const t = [];
    for (let f = 20; f < 100; f += 10) if (f <= fmax) t.push(f);
    for (let f = 100; f < 1000; f += 100) if (f <= fmax) t.push(f);
    for (let f = 1000; f <= 10000; f += 1000) if (f <= fmax) t.push(f);
    if (fmax > 10000) t.push(fmax);
    if (t.length && t[t.length - 1] !== fmax) t.push(fmax);
    return t;
  }
  function updateSpectrumAxis() {
    const nyq = ((ctx ? ctx.sampleRate : 48000) / SETTINGS.decim) / 2;
    const fmax = Math.min(20000, nyq);
    const labelSet = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(f => f <= fmax);
    if (labelSet.length && labelSet[labelSet.length - 1] !== fmax) labelSet.push(fmax);
    spectrum.setOptions({ logX: true, xMin: 20, xMax: fmax, xTicks: specTicks(fmax), xLabels: labelSet });
  }

  // Scope: show the most recent >= 1 s of audio from the ring buffer.
  function fillScope() {
    if (!ring || !ctx) return;
    const fsRaw = ctx.sampleRate, fsEff = fsRaw / SETTINGS.decim;
    let sec = Math.max(1.0, SETTINGS.fftSize / fsEff); sec = Math.min(sec, 2.0);
    const rawCount = Math.min(ringLen, Math.round(sec * fsRaw));
    const stride = Math.max(1, Math.floor(rawCount / 1200));
    const count = Math.floor(rawCount / stride);
    if (!scopeXs || scopeXs.length !== count) { scopeXs = new Float32Array(count); scopeYs = new Float32Array(count); }
    let idx = ((ringW - rawCount) % ringLen + ringLen) % ringLen;
    for (let i = 0; i < count; i++) {
      scopeYs[i] = ring[idx];                       // raw waveform amplitude
      scopeXs[i] = (i * stride / fsRaw) * 1000;     // ms
      idx += stride; if (idx >= ringLen) idx -= ringLen;
    }
    scope.setData(scopeXs, scopeYs);
  }

  async function startAudio() {
    try {
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      if (!source) source = ctx.createMediaStreamSource(stream);
      if (!analyser) { analyser = ctx.createAnalyser(); analyser.smoothingTimeConstant = 0; source.connect(analyser); }
      buffers();
      refreshRates();
      return true;
    } catch (e) {
      U.setText('status', e.name === 'NotAllowedError' ? 'Microphone permission denied' : ('Microphone error: ' + (e.message || e)));
      return false;
    }
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!st.running || !analyser) return;
    const now = performance.now();
    let dt = (now - lastFrameT) / 1000; lastFrameT = now;
    if (!(dt > 0) || dt > 0.5) dt = 0.03;

    analyser.getFloatTimeDomainData(buf);
    if (ring) {
      let nNew = Math.round(ctx.sampleRate * dt);
      nNew = Math.max(1, Math.min(buf.length, nNew));
      const from = buf.length - nNew;
      for (let i = 0; i < nNew; i++) { ring[ringW] = buf[from + i]; if (++ringW >= ringLen) ringW = 0; }
    }
    const N = SETTINGS.fftSize, M = SETTINGS.decim, start = buf.length - N * M;
    let mean = 0;
    for (let i = 0; i < N; i++) { let acc = 0; for (let m = 0; m < M; m++) acc += buf[start + i * M + m]; dec[i] = acc / M; mean += dec[i]; }
    mean /= N;
    let ss = 0; for (let i = 0; i < N; i++) { const v = dec[i] - mean; ss += v * v; }
    const rms = Math.sqrt(ss / N);

    const res = fft.process(dec);
    const mg = res.mag, fr = res.freqs;
    let up = 0, wp = 0;
    for (let k = 1; k < mg.length; k++) { const p = mg[k] * mg[k]; up += p; const w = Wlin(fr[k], SETTINGS.weighting); wp += w * w * p; }
    const wf = up > 0 ? Math.sqrt(wp / up) : 1;
    const wrms = rms * wf;
    const p = wrms * wrms + 1e-20;

    if (!primed) { pSmooth = p; primed = true; }       // prime to avoid a startup dip
    else {
      const tau = SETTINGS.timeWeight === 'slow' ? 1.0 : SETTINGS.timeWeight === 'impulse' ? (p > pSmooth ? 0.035 : 1.5) : 0.125;
      const a = Math.exp(-dt / tau);
      pSmooth = pSmooth * a + p * (1 - a);
    }
    const Lp = 10 * Math.log10(pSmooth) + SETTINGS.cal;
    const warm = (now - st.warmT) < 400;   // mic/EMA warm-up: don't pollute metrics or history

    if (!warm) {
      st.sumPdt += p * dt; st.sumT += dt; st.runMs += dt * 1000;
      if (Lp > st.lMax) st.lMax = Lp;
      if (Lp < st.lMin) st.lMin = Lp;
    }

    U.setText('levelVal', Math.max(0, Lp).toFixed(1));
    const dom = res.peaks[0];
    U.setText('domFreq', dom ? dom.freq.toFixed(1) + ' Hz' : '— Hz');

    fillScope();
    for (let k = 0; k < mg.length; k++) specDb[k] = 20 * Math.log10(Math.max(mg[k], 1e-9)) + 20 * Math.log10(Wlin(fr[k], SETTINGS.weighting)) + SETTINGS.cal;
    spectrum.setPeaks(res.peaks.map(pk => ({ x: pk.freq, label: Math.round(pk.freq) + ' Hz' })));
    spectrum.setData(fr, specDb);

    if (!warm && now - lastSlow >= 250) {
      lastSlow = now;
      const elapsed = st.runMs / 1000;
      levelHist.push(elapsed, Math.max(0, Lp));
      st.lp.push(Lp);
      renderKpis();
      if (SETTINGS.logging) csv.addRow({ iso: new Date().toISOString(), elapsed: elapsed.toFixed(2), lp: Lp.toFixed(1), leq: curLeq().toFixed(1), weight: SETTINGS.weighting.toUpperCase(), dom: dom ? dom.freq.toFixed(1) : '' });
      controls.set(null, { hasData: true, canLog: csv.count > 0 });
    }
  }

  function curLeq() { return st.sumT > 0 ? 10 * Math.log10(st.sumPdt / st.sumT) + SETTINGS.cal : NaN; }
  function percentile(arr, n) { // level exceeded n% of the time
    if (!arr.length) return NaN;
    const s = arr.slice().sort((a, b) => b - a);
    return s[Math.min(s.length - 1, Math.floor((n / 100) * s.length))];
  }
  function renderKpis() {
    const leq = curLeq();
    kpi.update({
      leq: dB(leq), lmax: dB(st.lMax === -Infinity ? NaN : st.lMax),
      l90: dB(percentile(st.lp, 90)), sel: dB(st.sumT > 0 ? leq + 10 * Math.log10(st.sumT) : NaN),
      duration: st.runMs > 0 ? F.duration(st.runMs) : '—',
    });
  }

  // --- Controls ----------------------------------------------------------
  const controls = new SK.ControlBar(document.getElementById('controls'), {
    async onStart() {
      const ok = await startAudio();
      if (!ok) return;
      st.running = true; st.started = true;
      if (!st.startT) st.startT = performance.now();
      lastFrameT = performance.now(); lastSlow = 0; primed = false; st.warmT = performance.now();
      U.wakeLock.acquire();
      U.setText('status', 'Recording');
      controls.set('running', { hasData: true, canLog: csv.count > 0 });
      if (!rafId) loop();
    },
    onStop() {
      st.running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (ctx) ctx.suspend();
      U.wakeLock.release();
      U.setText('status', 'Paused');
      controls.set('paused', { hasData: st.started, canLog: csv.count > 0 });
    },
    onReset() {
      st.running = false; st.started = false; st.startT = 0; st.runMs = 0;
      st.sumPdt = 0; st.sumT = 0; st.lMax = -Infinity; st.lMin = Infinity; st.lp = [];
      pSmooth = 1e-12; primed = false; ring = null; ringLen = 0; ringW = 0; scopeXs = null; scopeYs = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; source = null; analyser = null; }
      if (ctx) { ctx.close(); ctx = null; }
      csv.clear();
      scope.clear(); spectrum.clear(); levelHist.clear();
      U.setText('levelVal', '—'); U.setText('domFreq', '— Hz');
      U.wakeLock.release();
      renderKpis();
      U.setText('status', 'Tap Start to begin (microphone permission required).');
      controls.set('idle', { hasData: false, canLog: false });
    },
    onLog() {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      csv.export(`sound-${stamp}.csv`);
    },
  });

  // --- Settings wiring ---------------------------------------------------
  function levelSub() {
    const w = SETTINGS.weighting.toUpperCase(), t = SETTINGS.timeWeight[0].toUpperCase() + SETTINGS.timeWeight.slice(1);
    U.setText('levelSub', `L${w === 'Z' ? 'Z' : w} · ${t}`);
  }
  function pills(id, key, store, after) {
    const g = document.getElementById(id), bs = [...g.querySelectorAll('.seg__btn')];
    const paint = v => bs.forEach(b => b.classList.toggle('seg__btn--active', b.dataset.value === v));
    bs.forEach(b => b.addEventListener('click', () => { SETTINGS[key] = b.dataset.value; localStorage.setItem(store, b.dataset.value); paint(b.dataset.value); if (after) after(); }));
    paint(SETTINGS[key]);
  }
  pills('segWeight', 'weighting', 'mic.weighting', levelSub);
  pills('segTime', 'timeWeight', 'mic.timeWeight', levelSub);
  pills('segCouple', 'coupling', 'mic.coupling', () => fft && fft.configure({ coupling: SETTINGS.coupling }));
  levelSub();

  const cal = document.getElementById('calInput');
  cal.value = SETTINGS.cal;
  function paintCal() { U.setText('calVal', SETTINGS.cal.toFixed(0) + ' dB'); }
  cal.addEventListener('input', () => { SETTINGS.cal = parseFloat(cal.value); localStorage.setItem('mic.cal', cal.value); paintCal(); });
  paintCal();

  U.fillSelect(document.getElementById('selWindow'),
    [['Rectangular', 'rectangular'], ['Triangle', 'triangle'], ['Hanning', 'hanning'], ['Hamming', 'hamming'], ['Blackman', 'blackman'], ['Blackman-Harris', 'blackmanHarris']], SETTINGS.window);
  U.fillSelect(document.getElementById('selSize'),
    [256, 512, 1024, 2048, 4096, 8192, 16384, 32768].map(n => [String(n), n]), SETTINGS.fftSize);
  U.fillSelect(document.getElementById('selSmooth'),
    [['Off', 0], ['Low', 0.5], ['Medium', 0.8], ['High', 0.95]], SETTINGS.smoothing);

  function refreshRates() {
    const base = ctx ? ctx.sampleRate : 48000;
    const opts = [];
    [1, 2, 4, 8].forEach(M => { if (SETTINGS.fftSize * M <= 32768) opts.push([Math.round(base / M) + ' Hz', M]); });
    if (!opts.some(o => o[1] === SETTINGS.decim)) SETTINGS.decim = opts[0][1];
    U.fillSelect(document.getElementById('selRate'), opts, SETTINGS.decim);
  }
  refreshRates();
  updateSpectrumAxis();
  document.getElementById('selWindow').addEventListener('change', e => { SETTINGS.window = e.target.value; localStorage.setItem('mic.window', e.target.value); buffers(); });
  document.getElementById('selSize').addEventListener('change', e => { SETTINGS.fftSize = +e.target.value; localStorage.setItem('mic.fftSize', e.target.value); refreshRates(); buffers(); });
  document.getElementById('selRate').addEventListener('change', e => { SETTINGS.decim = +e.target.value; localStorage.setItem('mic.decim', e.target.value); buffers(); });
  document.getElementById('selSmooth').addEventListener('change', e => { SETTINGS.smoothing = +e.target.value; localStorage.setItem('mic.smoothing', e.target.value); fft && fft.configure({ smoothing: SETTINGS.smoothing }); });

  const peaks = document.getElementById('selPeaks');
  peaks.value = SETTINGS.peakCount;
  function paintPeaks() { U.setText('peaksVal', String(SETTINGS.peakCount)); }
  peaks.addEventListener('input', () => { SETTINGS.peakCount = +peaks.value; localStorage.setItem('mic.peakCount', peaks.value); paintPeaks(); if (fft) fft.configure({ peakCount: SETTINGS.peakCount }); });
  paintPeaks();

  const logToggle = document.getElementById('logToggle');
  logToggle.checked = SETTINGS.logging;
  logToggle.addEventListener('change', () => { SETTINGS.logging = logToggle.checked; localStorage.setItem('mic.logging', logToggle.checked ? 'on' : 'off'); });

  // --- Fullscreen --------------------------------------------------------
  const resizers = { chartScope: () => scope.resize(), chartSpec: () => spectrum.resize(), chartLevel: () => levelHist.resize() };
  document.querySelectorAll('[data-fs]').forEach(btn => btn.addEventListener('click', () => {
    const panel = btn.closest('[data-panel]'), frame = panel.querySelector('.sk-frame');
    panel.classList.toggle('sk-panel--fs');
    setTimeout(() => { const r = resizers[frame.id]; if (r) r(); }, 60);
  }));

  renderKpis();
  window.addEventListener('pagehide', () => { if (rafId) cancelAnimationFrame(rafId); if (stream) stream.getTracks().forEach(t => t.stop()); if (ctx) ctx.close(); });
})();
