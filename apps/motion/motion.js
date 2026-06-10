/* Motion — accelerometer + gyroscope visualiser.
 *
 * Reads the DeviceMotion stream (iOS requires a permission prompt fired from a
 * user gesture), keeps a short rolling buffer of raw samples, and renders:
 *   • three per-axis (X/Y/Z) summary boxes — current accel, AC RMS, signed
 *     peak |accel|, and current gyro — plus sample rate and dominant frequency,
 *   • merged live X/Y/Z + magnitude scopes for accel and rotation, which can be
 *     zoomed and scrolled back to the start of the record,
 *   • an amplitude spectrum for a selectable channel, and
 *   • a vibration-history trace.
 *
 * DeviceMotion events arrive irregularly (~60 Hz on iOS, so usable spectrum to
 * ~30 Hz). For the FFT the chosen channel is resampled onto a uniform grid at
 * the measured mean rate before transforming; that effective rate is shown in
 * the top tile. Acceleration is stored in m/s² and rotation in °/s; display
 * units are converted on the fly.
 */
(() => {
  'use strict';

  const U = window.Utilities;
  const SK = window.SensorKit;
  const F = SK.format;
  const G = 9.80665; // standard gravity, m/s²

  // --- Settings (persisted under motion.*) -------------------------------
  const ls = localStorage;
  const SETTINGS = {
    accelSource: ls.getItem('motion.accelSource') || 'linear', // linear | gravity
    accelUnit: ls.getItem('motion.accelUnit') || 'ms2',        // ms2 | g
    gyroUnit: ls.getItem('motion.gyroUnit') || 'dps',          // dps | rads
    target: ls.getItem('motion.target') || 'a:z',              // (a|g):(x|y|z|mag)
    window: ls.getItem('motion.window') || 'hanning',
    fftSize: parseInt(ls.getItem('motion.fftSize'), 10) || 256,
    coupling: ls.getItem('motion.coupling') || 'ac',           // ac | dc
    logX: ls.getItem('motion.logX') === 'on',
    db: ls.getItem('motion.db') === 'on',
    peakCount: parseInt(ls.getItem('motion.peakCount'), 10) || 3,
    smoothing: ls.getItem('motion.smoothing') != null ? parseFloat(ls.getItem('motion.smoothing')) : 0.5,
    logging: ls.getItem('motion.logging') === 'on',
  };

  const BUF_SECONDS = 22;   // rolling raw-sample buffer (covers a 1024-pt window)
  const SCOPE_SECONDS = 4;  // default (live) time-domain window
  const SLOW_MS = 120;      // cadence for FFT / readouts / stats refresh
  const AXES = ['x', 'y', 'z'];
  const AXU = { x: 'X', y: 'Y', z: 'Z' };

  // --- Unit helpers ------------------------------------------------------
  const accFactor = () => (SETTINGS.accelUnit === 'g' ? 1 / G : 1);
  const accUnitLabel = () => (SETTINGS.accelUnit === 'g' ? 'g' : 'm/s²');
  const gyrFactor = () => (SETTINGS.gyroUnit === 'rads' ? Math.PI / 180 : 1);
  const gyrUnitLabel = () => (SETTINGS.gyroUnit === 'rads' ? 'rad/s' : '°/s');
  const num = (v, d = 2, dash = '—') => (Number.isFinite(v) ? v.toFixed(d) : dash);

  // --- Charts ------------------------------------------------------------
  const AX = [
    { key: 'x', label: 'X', color: '#ff3b30' },
    { key: 'y', label: 'Y', color: '#34c759' },
    { key: 'z', label: 'Z', color: '#0a84ff' },
    { key: 'mag', label: '|a|', color: '#af52de' },
  ];
  const GX = AX.map((s, i) => ({ key: s.key, color: s.color, label: i === 3 ? '|ω|' : s.label }));

  // Time axis in elapsed seconds; "1.2s" close-up, "m:ss" once zoomed way out.
  const fmtSec = s => {
    s = Math.max(0, s);
    if (s < 60) return (s < 10 ? s.toFixed(1) : String(Math.round(s))) + 's';
    const m = Math.floor(s / 60), ss = Math.round(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
  };

  const accChart = new SK.MultiPlot(document.getElementById('chartAcc'), {
    series: AX, symmetric: false, followSpan: SCOPE_SECONDS,
    scale: v => v * accFactor(), fmtX: fmtSec, fmtY: v => v.toFixed(2),
    empty: 'Start to view acceleration',
  });
  const gyrChart = new SK.MultiPlot(document.getElementById('chartGyr'), {
    series: GX, symmetric: false, followSpan: SCOPE_SECONDS,
    scale: v => v * gyrFactor(), fmtX: fmtSec, fmtY: v => v.toFixed(1),
    empty: 'Start to view rotation',
  });

  const spectrum = new SK.LivePlot(document.getElementById('chartSpec'), {
    color: '#ff9f0a', symmetric: false, fill: true, peakLine: true, yMin: 0,
    fmtX: v => v.toFixed(1) + ' Hz', fmtY: v => v.toFixed(2), empty: 'Start to view spectrum',
  });
  const hist = new SK.TimeSeriesChart(document.getElementById('chartHist'), {
    color: '#34c759', symmetric: false, fmt: v => v.toFixed(2), empty: 'Vibration RMS appears here',
  });

  // --- CSV (logged in SI base units regardless of display unit) ----------
  const csv = new SK.CsvLogger([
    { key: 'iso', header: 'time_iso' }, { key: 'elapsed', header: 'elapsed_s' }, { key: 'src', header: 'accel_source' },
    { key: 'ax', header: 'ax_ms2' }, { key: 'ay', header: 'ay_ms2' }, { key: 'az', header: 'az_ms2' }, { key: 'amag', header: 'amag_ms2' },
    { key: 'gx', header: 'gx_dps' }, { key: 'gy', header: 'gy_dps' }, { key: 'gz', header: 'gz_dps' }, { key: 'gmag', header: 'gmag_dps' },
  ]);

  // --- FFT ---------------------------------------------------------------
  const fft = new SK.FFT({
    size: SETTINGS.fftSize, sampleRate: 60, window: SETTINGS.window,
    coupling: SETTINGS.coupling, peakCount: SETTINGS.peakCount, smoothing: SETTINGS.smoothing,
  });

  // --- Capture state -----------------------------------------------------
  let buf = [];               // [{ t, lin{x,y,z}|null, grav{x,y,z}|null, rot{x,y,z}|null }]
  let listening = false, rafId = 0, lastSlow = 0, lastHist = 0;
  const st = { running: false, started: false, startT: 0, peakSigned: { x: NaN, y: NaN, z: NaN } };

  const nowS = () => performance.now() / 1000;
  const elapsed = () => (st.startT ? nowS() - st.startT : 0);
  const vget = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const accelOf = s => (SETTINGS.accelSource === 'gravity' ? s.grav : s.lin);
  const mag3 = o => (o ? Math.hypot(o.x, o.y, o.z) : NaN);

  function targetValSI(s) {
    const [sensor, ch] = SETTINGS.target.split(':');
    const src = sensor === 'a' ? accelOf(s) : s.rot;
    if (!src) return NaN;
    return ch === 'mag' ? Math.hypot(src.x, src.y, src.z) : src[ch];
  }
  function targetMeta() {
    const [sensor, ch] = SETTINGS.target.split(':');
    const isA = sensor === 'a';
    const chLabel = ch === 'mag' ? (isA ? '|a|' : '|ω|') : ch.toUpperCase();
    return {
      sensor, ch, isA, name: `${isA ? 'Accel' : 'Gyro'} ${chLabel}`,
      factor: isA ? accFactor() : gyrFactor(), unit: isA ? accUnitLabel() : gyrUnitLabel(),
    };
  }

  // --- DeviceMotion handler ---------------------------------------------
  function onMotion(e) {
    const t = nowS();
    const a = e.acceleration, ag = e.accelerationIncludingGravity, r = e.rotationRate;
    const s = {
      t,
      lin: a ? { x: vget(a.x), y: vget(a.y), z: vget(a.z) } : null,
      grav: ag ? { x: vget(ag.x), y: vget(ag.y), z: vget(ag.z) } : null,
      // W3C: beta ≈ rotation about X, gamma ≈ about Y, alpha ≈ about Z.
      rot: r ? { x: vget(r.beta), y: vget(r.gamma), z: vget(r.alpha) } : null,
    };
    buf.push(s);
    const cut = t - BUF_SECONDS;
    while (buf.length && buf[0].t < cut) buf.shift();

    if (!st.running) return;

    const ac = accelOf(s), ro = s.rot;

    // Per-axis signed peak: keep the largest |value|, with its original sign.
    if (ac) for (const a2 of AXES) {
      const v = ac[a2];
      if (Number.isFinite(v) && (!Number.isFinite(st.peakSigned[a2]) || Math.abs(v) > Math.abs(st.peakSigned[a2]))) st.peakSigned[a2] = v;
    }

    // Feed the scopes (raw units; the charts scale to display units at draw time).
    const x = s.t - st.startT;
    accChart.push(x, ac ? { x: ac.x, y: ac.y, z: ac.z, mag: Math.hypot(ac.x, ac.y, ac.z) } : { x: NaN, y: NaN, z: NaN, mag: NaN });
    gyrChart.push(x, ro ? { x: ro.x, y: ro.y, z: ro.z, mag: Math.hypot(ro.x, ro.y, ro.z) } : { x: NaN, y: NaN, z: NaN, mag: NaN });

    if (SETTINGS.logging) {
      const am = mag3(ac), gm = mag3(ro);
      csv.addRow({
        iso: new Date().toISOString(), elapsed: elapsed().toFixed(3), src: SETTINGS.accelSource,
        ax: ac ? num(ac.x, 5, '') : '', ay: ac ? num(ac.y, 5, '') : '', az: ac ? num(ac.z, 5, '') : '', amag: num(am, 5, ''),
        gx: ro ? num(ro.x, 4, '') : '', gy: ro ? num(ro.y, 4, '') : '', gz: ro ? num(ro.z, 4, '') : '', gmag: num(gm, 4, ''),
      });
    }
  }

  // --- Sampling helpers --------------------------------------------------
  function effRate() {
    const m = buf.length;
    if (m < 5) return 60;
    const tEnd = buf[m - 1].t, t0 = tEnd - 1.0;
    let i = m - 1;
    while (i > 0 && buf[i - 1].t >= t0) i--;
    const span = tEnd - buf[i].t, n = (m - 1) - i;
    return span > 0 ? n / span : 60;
  }
  const bufferSpan = () => (buf.length ? buf[buf.length - 1].t - buf[0].t : 0);

  // Linear-interpolate a channel onto N uniform points ending at tEnd.
  function resample(valFn, N, fs, tEnd) {
    const m = buf.length;
    if (m < 2) return null;
    const out = new Float32Array(N), dt = 1 / fs;
    let j = 0;
    for (let i = 0; i < N; i++) {
      const tt = tEnd - (N - 1 - i) * dt;
      while (j < m - 1 && buf[j + 1].t < tt) j++;
      const a = buf[j], b = buf[Math.min(j + 1, m - 1)];
      const va = valFn(a), vb = valFn(b);
      let v;
      if (b === a || b.t === a.t) v = va;
      else if (!Number.isFinite(va)) v = vb;
      else if (!Number.isFinite(vb)) v = va;
      else { const f = (tt - a.t) / (b.t - a.t); v = va * (1 - f) + vb * f; }
      out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
  }

  // Samples within the recent SCOPE_SECONDS window (used for the box RMS).
  function recentData(channelOf) {
    if (buf.length < 2) return null;
    const tEnd = buf[buf.length - 1].t, t0 = tEnd - SCOPE_SECONDS;
    const X = [], Y = [], Z = [], M = [];
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i]; if (s.t < t0) continue;
      const o = channelOf(s);
      X.push(o ? o.x : NaN); Y.push(o ? o.y : NaN); Z.push(o ? o.z : NaN);
      M.push(o ? Math.hypot(o.x, o.y, o.z) : NaN);
    }
    return X.length > 1 ? { x: X, y: Y, z: Z, mag: M } : null;
  }

  const scaleArr = (arr, k) => (k === 1 ? arr : arr.map(v => v * k));

  // Mean-removed (AC) statistics over a value list.
  function acStats(vals) {
    let n = 0, sum = 0, mn = Infinity, mx = -Infinity;
    for (const v of vals) { if (!Number.isFinite(v)) continue; n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!n) return { rms: NaN, p2p: NaN, peakAbs: NaN };
    const mean = sum / n;
    let sq = 0, pk = 0;
    for (const v of vals) { if (!Number.isFinite(v)) continue; const d = v - mean; sq += d * d; if (Math.abs(d) > pk) pk = Math.abs(d); }
    return { rms: Math.sqrt(sq / n), p2p: mx - mn, peakAbs: pk };
  }

  // --- Per-axis summary boxes -------------------------------------------
  function paintUnits() {
    const au = accUnitLabel(), gu = gyrUnitLabel();
    AXES.forEach(a => { U.setText('uAcc' + AXU[a], au); U.setText('uGyr' + AXU[a], gu); });
  }

  function updateBoxes(accWin) {
    const ka = accFactor(), kg = gyrFactor();
    const latest = buf.length ? buf[buf.length - 1] : null;
    const ac = latest ? accelOf(latest) : null;
    const ro = latest ? latest.rot : null;
    for (const a of AXES) {
      const X = AXU[a];
      U.setText('cur' + X, ac && Number.isFinite(ac[a]) ? (ac[a] * ka).toFixed(2) : '—');
      const r = accWin ? acStats(accWin[a]).rms : NaN;
      U.setText('rms' + X, Number.isFinite(r) ? (r * ka).toFixed(2) : '—');
      const pk = st.peakSigned[a], pkv = Number.isFinite(pk) ? pk * ka : NaN;
      U.setText('pk' + X, Number.isFinite(pkv) ? (pkv > 0 ? '+' : '') + pkv.toFixed(2) : '—');
      U.setText('gyr' + X, ro && Number.isFinite(ro[a]) ? (ro[a] * kg).toFixed(1) : '—');
    }
  }

  // --- Slow stats / FFT refresh -----------------------------------------
  function updateSlow() {
    const accWin = recentData(accelOf);
    updateBoxes(accWin);

    // Vibration history (magnitude RMS over the recent window).
    if (accWin) {
      const sM = acStats(scaleArr(accWin.mag, accFactor()));
      if (st.running && performance.now() - lastHist > 500 && Number.isFinite(sM.rms)) {
        lastHist = performance.now();
        hist.push(elapsed(), sM.rms);
      }
    }

    // Sample rate + spectrum (resample selected channel → FFT) + dominant freq.
    const fs = effRate(), N = SETTINGS.fftSize, need = N / fs;
    const ready = buf.length >= 8 && bufferSpan() >= need * 0.98;
    if (ready) {
      fft.configure({ size: N, sampleRate: fs, window: SETTINGS.window, coupling: SETTINGS.coupling, peakCount: SETTINGS.peakCount, smoothing: SETTINGS.smoothing });
      const meta = targetMeta();
      const sig = resample(targetValSI, N, fs, buf[buf.length - 1].t);
      if (sig) {
        const res = fft.process(sig);
        const k = meta.factor;
        const xs = Array.from(res.freqs);
        const ys = SETTINGS.db
          ? Array.from(res.mag, v => 20 * Math.log10(Math.max(v * k, 1e-9)))
          : Array.from(res.mag, v => v * k);
        spectrum.setOptions({
          logX: SETTINGS.logX,
          yMin: SETTINGS.db ? null : 0, yMax: null,
          xMin: SETTINGS.logX ? Math.max(res.df, 0.2) : 0, xMax: fs / 2,
          fmtY: v => (SETTINGS.db ? v.toFixed(0) : v.toFixed(meta.isA ? 3 : 2)),
        });
        const peaks = (res.peaks || []).filter(p => Number.isFinite(p.freq)).map(p => ({ x: p.freq, label: p.freq.toFixed(1) + ' Hz' }));
        spectrum.setPeaks(peaks.length ? peaks : null);
        spectrum.setData(xs, ys);
        const dom = (res.peaks && res.peaks[0] && Number.isFinite(res.peaks[0].freq)) ? res.peaks[0].freq : NaN;
        U.setText('domFreq', Number.isFinite(dom) ? dom.toFixed(2) + ' Hz' : '— Hz');
      }
    } else {
      U.setText('domFreq', '— Hz');
    }

    if (st.running) {
      U.setText('status', ready ? `Recording · ${fs.toFixed(1)} Hz` : `Recording · ${fs.toFixed(1)} Hz · filling ${need.toFixed(1)} s window`);
      controls.set(null, { hasData: true, canLog: csv.count > 0 });
    }
  }

  // --- Animation loop (drives the slow refresh; scopes redraw on push) ---
  function loop() {
    if (!st.running) { rafId = 0; return; } // pause → stop scheduling frames
    const now = performance.now();
    if (now - lastSlow >= SLOW_MS) { lastSlow = now; updateSlow(); }
    rafId = requestAnimationFrame(loop);
  }

  // --- Permission + listener --------------------------------------------
  async function ensurePermission() {
    const D = window.DeviceMotionEvent;
    if (!D) return { ok: false, reason: 'Motion sensors are not available on this device.' };
    if (typeof D.requestPermission === 'function') {
      try {
        const res = await D.requestPermission();
        if (res !== 'granted') return { ok: false, reason: 'Motion access denied. Enable it in Settings → Safari → Motion & Orientation Access.' };
      } catch (_) {
        return { ok: false, reason: 'Could not request motion access.' };
      }
    }
    return { ok: true };
  }
  function addListener() { if (!listening) { window.addEventListener('devicemotion', onMotion); listening = true; } }
  function removeListener() { if (listening) { window.removeEventListener('devicemotion', onMotion); listening = false; } }

  // --- Controls ----------------------------------------------------------
  const controls = new SK.ControlBar(document.getElementById('controls'), {
    async onStart() {
      const perm = await ensurePermission();
      if (!perm.ok) { U.setText('status', perm.reason); return; }
      addListener();
      if (!st.startT) st.startT = nowS();
      st.running = true; st.started = true;
      U.wakeLock.acquire();
      U.setText('status', 'Recording');
      controls.set('running', { hasData: true, canLog: csv.count > 0 });
      lastSlow = 0;
      if (!rafId) loop();
    },
    onStop() {
      st.running = false;
      accChart.pushBreak(); gyrChart.pushBreak();   // break the traces across the pause gap
      U.wakeLock.release();
      U.setText('status', 'Paused');
      controls.set('paused', { hasData: st.started, canLog: csv.count > 0 });
    },
    onReset() {
      st.running = false; st.started = false; st.startT = 0;
      st.peakSigned = { x: NaN, y: NaN, z: NaN };
      buf = [];
      removeListener();
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      csv.clear();
      accChart.clear(); gyrChart.clear(); spectrum.clear(); spectrum.setPeaks(null); hist.clear();
      updateBoxes(null);
      paintUnits();
      U.setText('domFreq', '— Hz');
      U.wakeLock.release();
      U.setText('status', 'Tap Start to begin (motion permission required).');
      controls.set('idle', { hasData: false, canLog: false });
    },
    onLog() {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      csv.export(`motion-${stamp}.csv`);
    },
  });

  // --- Settings: segmented pills ----------------------------------------
  function paintSeg(id, val) {
    const g = document.getElementById(id); if (!g) return;
    g.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('seg__btn--active', b.dataset.value === val));
  }
  function wireSeg(id, onPick) {
    const g = document.getElementById(id); if (!g) return;
    g.querySelectorAll('.seg__btn').forEach(b => b.addEventListener('click', () => onPick(b.dataset.value)));
  }

  paintSeg('segSource', SETTINGS.accelSource);
  wireSeg('segSource', v => {
    SETTINGS.accelSource = v; ls.setItem('motion.accelSource', v); paintSeg('segSource', v);
    // Linear and +gravity aren't comparable: break the accel trace at the switch
    // (so earlier samples stay scrollable) and reset the per-axis peaks.
    st.peakSigned = { x: NaN, y: NaN, z: NaN };
    accChart.pushBreak();
    updateBoxes(recentData(accelOf));
  });

  paintSeg('segAccUnit', SETTINGS.accelUnit);
  wireSeg('segAccUnit', v => {
    SETTINGS.accelUnit = v; ls.setItem('motion.accelUnit', v); paintSeg('segAccUnit', v);
    paintUnits(); accChart.redraw(); updateBoxes(recentData(accelOf));
  });

  paintSeg('segGyrUnit', SETTINGS.gyroUnit);
  wireSeg('segGyrUnit', v => {
    SETTINGS.gyroUnit = v; ls.setItem('motion.gyroUnit', v); paintSeg('segGyrUnit', v);
    paintUnits(); gyrChart.redraw(); updateBoxes(recentData(accelOf));
  });

  paintSeg('segCouple', SETTINGS.coupling);
  wireSeg('segCouple', v => { SETTINGS.coupling = v; ls.setItem('motion.coupling', v); paintSeg('segCouple', v); fft.configure({ coupling: v }); });

  paintSeg('segLogX', SETTINGS.logX ? 'log' : 'lin');
  wireSeg('segLogX', v => { SETTINGS.logX = v === 'log'; ls.setItem('motion.logX', SETTINGS.logX ? 'on' : 'off'); paintSeg('segLogX', v); });

  paintSeg('segDb', SETTINGS.db ? 'db' : 'lin');
  wireSeg('segDb', v => { SETTINGS.db = v === 'db'; ls.setItem('motion.db', SETTINGS.db ? 'on' : 'off'); paintSeg('segDb', v); });

  // --- Settings: selects + range ----------------------------------------
  // Overall absolute value (|a| / |ω|) listed before the individual axes.
  const TARGETS = [
    ['Accel — |a|', 'a:mag'], ['Accel — X', 'a:x'], ['Accel — Y', 'a:y'], ['Accel — Z', 'a:z'],
    ['Gyro — |ω|', 'g:mag'], ['Gyro — X', 'g:x'], ['Gyro — Y', 'g:y'], ['Gyro — Z', 'g:z'],
  ];
  U.fillSelect(document.getElementById('selTarget'), TARGETS, SETTINGS.target);
  document.getElementById('selTarget').addEventListener('change', e => { SETTINGS.target = e.target.value; ls.setItem('motion.target', e.target.value); });

  const WIN_LABELS = { rectangular: 'Rectangular', triangle: 'Triangle', hanning: 'Hanning', hamming: 'Hamming', blackman: 'Blackman', blackmanHarris: 'Blackman–Harris' };
  U.fillSelect(document.getElementById('selWindow'), SK.FFT.WINDOWS.map(w => [WIN_LABELS[w] || w, w]), SETTINGS.window);
  document.getElementById('selWindow').addEventListener('change', e => { SETTINGS.window = e.target.value; ls.setItem('motion.window', e.target.value); fft.configure({ window: SETTINGS.window }); });

  U.fillSelect(document.getElementById('selSize'), [128, 256, 512, 1024].map(n => [String(n), n]), SETTINGS.fftSize);
  document.getElementById('selSize').addEventListener('change', e => { SETTINGS.fftSize = parseInt(e.target.value, 10); ls.setItem('motion.fftSize', e.target.value); fft.configure({ size: SETTINGS.fftSize }); });

  U.fillSelect(document.getElementById('selSmooth'), [['Off', 0], ['Light', 0.5], ['Medium', 0.8]], SETTINGS.smoothing);
  document.getElementById('selSmooth').addEventListener('change', e => { SETTINGS.smoothing = parseFloat(e.target.value); ls.setItem('motion.smoothing', e.target.value); fft.configure({ smoothing: SETTINGS.smoothing }); });

  const peaksR = document.getElementById('selPeaks');
  peaksR.value = SETTINGS.peakCount;
  const paintPeaks = () => U.setText('peaksVal', String(SETTINGS.peakCount));
  peaksR.addEventListener('input', () => { SETTINGS.peakCount = parseInt(peaksR.value, 10); ls.setItem('motion.peakCount', peaksR.value); paintPeaks(); fft.configure({ peakCount: SETTINGS.peakCount }); });

  const logToggle = document.getElementById('logToggle');
  logToggle.checked = SETTINGS.logging;
  logToggle.addEventListener('change', () => { SETTINGS.logging = logToggle.checked; ls.setItem('motion.logging', logToggle.checked ? 'on' : 'off'); });

  // --- Fullscreen panels -------------------------------------------------
  const resizers = {
    chartAcc: () => accChart.resize(), chartGyr: () => gyrChart.resize(),
    chartSpec: () => spectrum.resize(), chartHist: () => hist.resize(),
  };
  document.querySelectorAll('[data-fs]').forEach(btn => btn.addEventListener('click', () => {
    const panel = btn.closest('[data-panel]'), frame = panel.querySelector('.sk-frame');
    panel.classList.toggle('sk-panel--fs');
    setTimeout(() => { const r = resizers[frame.id]; if (r) r(); }, 60);
  }));

  // --- Boot --------------------------------------------------------------
  paintUnits();
  updateBoxes(null);
  U.setText('domFreq', '— Hz');
  paintPeaks();
  controls.set('idle', { hasData: false, canLog: false });

  window.addEventListener('pagehide', () => {
    if (rafId) cancelAnimationFrame(rafId);
    removeListener();
    U.wakeLock.release();
  });
})();
