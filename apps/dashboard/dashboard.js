/* Car Dashboard — a tach-style speed dial + a 2D g-meter.
 *
 * Speed comes from Geolocation (coords.speed, with a haversine fallback shared
 * with the GPS app) and drives the shared SensorKit gauge. Lateral / fore-aft
 * g-force comes from DeviceMotion: we prefer the OS linear acceleration
 * (gravity already removed) and fall back to accelerationIncludingGravity minus
 * a slow gravity estimate. The phone is assumed mounted UPRIGHT — portrait,
 * screen facing the driver, top edge up — so device X = lateral and device Z =
 * fore/aft (gravity then sits on device Y). Start auto-zeros any resting bias.
 * Directional peaks (brake / accel / left / right, with braking plotted upward)
 * and the peak magnitude are kept in localStorage and survive reloads until
 * Reset.
 */
(() => {
  'use strict';

  const U = window.Utilities;
  const SK = window.SensorKit;
  const F = SK.format;
  const G = 9.80665;            // standard gravity, m/s²
  const MAX_KEY = 'dashboard.gmax';

  // --- Speed gauge (shared component) ------------------------------------
  let dialMax = 250;           // km/h; grows if exceeded this session
  const gauge = new SK.Gauge(document.getElementById('speedGauge'), {
    min: 0, max: dialMax, major: 50, minor: 10, unit: 'km/h', decimals: 0,
  });

  // --- 2D g-meter pad ----------------------------------------------------
  const PAD_C = 100, FS = 1.5, TICK = 0.5, PAD_SCALE = 90 / FS;   // centre, and px-per-g
  const dot = buildPad(document.getElementById('gPad'));

  function buildPad(el) {
    const C = PAD_C, S = PAD_SCALE, R2 = FS * S;
    const line = (x1, y1, x2, y2, tok, w, op) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:var(--${tok})" stroke-width="${w}" stroke-linecap="round"${op ? ` opacity="${op}"` : ''}/>`;
    let s = '';
    s += `<circle cx="${C}" cy="${C}" r="${R2}" fill="none" style="stroke:var(--border)" stroke-width="2"/>`;
    for (let k = 1; k < FS / TICK; k++) {                          // tick ladder: three uniform, thick ticks per arm
      const r = k * TICK * S, len = 6;
      s += line(C - r, C - len, C - r, C + len, 'ink-2', 3);
      s += line(C + r, C - len, C + r, C + len, 'ink-2', 3);
      s += line(C - len, C - r, C + len, C - r, 'ink-2', 3);
      s += line(C - len, C + r, C + len, C + r, 'ink-2', 3);
    }
    s += `<text x="${C + R2}" y="${C + R2 * 2 / 3}" text-anchor="end" style="fill:var(--ink-3);font-family:var(--font-sans)" font-size="9">${FS} g</text>`;
    el.innerHTML =
      `<svg viewBox="0 0 200 200" style="display:block;width:100%;height:auto" role="img" aria-label="Lateral and fore-aft g-force">` +
      s +
      `<circle class="dashboard-gmeter__dot" cx="${C}" cy="${C}" r="8" style="fill:var(--accent)"/>` +
      `</svg>`;
    return el.querySelector('.dashboard-gmeter__dot');
  }

  // --- Persisted peaks ---------------------------------------------------
  function loadMax() {
    try {
      const o = JSON.parse(localStorage.getItem(MAX_KEY) || '{}');
      return { brake: +o.brake || 0, accel: +o.accel || 0, left: +o.left || 0, right: +o.right || 0, peak: +o.peak || 0 };
    } catch (_) { return { brake: 0, accel: 0, left: 0, right: 0, peak: 0 }; }
  }
  function saveMax() { try { localStorage.setItem(MAX_KEY, JSON.stringify(gmax)); } catch (_) { } }
  const gmax = loadMax();

  // --- State -------------------------------------------------------------
  let running = false, rafId = 0, watchId = null, motionOn = false;
  let targetSpeed = 0, dispSpeed = 0, speedSeen = 0;     // km/h
  let prevFix = null;
  let gravX = 0, gravY = 0, gravZ = 0, gravInit = false;  // gravity estimate (fallback path)
  let zeroX = 0, zeroY = 0, zeroZ = 0, zeroing = false, zeroAcc = null;
  let curX = 0, curY = 0;                                 // smoothed current g (curX lateral, curY fore/aft)
  let lastSave = 0, lastPaint = 0;
  let validCount = 0;

  const MIN_VALID = 4;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r2 = n => Math.round(n * 100) / 100;
  const num = (v, dash) => (Number.isFinite(v) ? v.toFixed(2) : dash);

  // --- Geolocation (speed) ----------------------------------------------

  function onPos(pos) {
    if (pos.coords.accuracy > 50) { validCount = 0; return; }  // reset on bad fix
    if (++validCount < MIN_VALID) return;  // need N consecutive good fixes
    const c = pos.coords, t = pos.timestamp;
    let mps = (typeof c.speed === 'number' && c.speed >= 0) ? c.speed : NaN;
    if (!Number.isFinite(mps) && prevFix) {
      const dt = (t - prevFix.t) / 1000;
      if (dt > 0) mps = F.haversine(prevFix.lat, prevFix.lon, c.latitude, c.longitude) / dt;
    }
    prevFix = { t, lat: c.latitude, lon: c.longitude };
    if (Number.isFinite(mps)) {
      targetSpeed = F.speedValue(mps, 'kmh');
      if (targetSpeed > speedSeen) speedSeen = targetSpeed;
      const want = Math.max(250, Math.ceil(speedSeen / 50) * 50);
      if (want > dialMax) { dialMax = want; gauge.setMax(dialMax); }
    }
    if (running && !zeroing) U.setText('status', 'Live');
  }
  function onErr(err) {
    U.setText('status',
      err.code === 1 ? 'Location permission denied' :
        err.code === 2 ? 'Position unavailable' :
          err.code === 3 ? 'Location request timed out' : (err.message || 'Location error'));
  }
  function startWatch() {
    if (!('geolocation' in navigator)) { U.setText('status', 'Geolocation not supported'); return; }
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  // --- DeviceMotion (g-force) -------------------------------------------
  // Upright mount: device X → lateral, device Z → fore/aft, gravity on Y.
  function onMotion(e) {
    const ag = e.accelerationIncludingGravity;
    if (ag && Number.isFinite(ag.x) && Number.isFinite(ag.y) && Number.isFinite(ag.z)) {
      if (!gravInit) { gravX = ag.x; gravY = ag.y; gravZ = ag.z; gravInit = true; }  // seed converged
      gravX = gravX * 0.99 + ag.x * 0.01;        // slow gravity estimate (~1.6 s)
      gravY = gravY * 0.99 + ag.y * 0.01;
      gravZ = gravZ * 0.99 + ag.z * 0.01;
    }

    // Linear acceleration (gravity removed): prefer the OS value, else ag − gravity.
    let ax, ay, az;
    const a = e.acceleration;
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) {
      ax = a.x; ay = a.y; az = a.z;
    } else if (ag && Number.isFinite(ag.x)) {
      ax = ag.x - gravX; ay = ag.y - gravY; az = ag.z - gravZ;
    } else { return; }

    // Tilt-compensated fore/aft: project accel onto the true horizontal in the Y–Z
    // plane (⊥ gravity). + = braking, like raw az was — but here the sign comes from
    // gravity, so it's the same on iOS and Android and survives a pitched mount.
    const mYZ = Math.hypot(gravY, gravZ) || 1;
    const azC = (az * gravY - ay * gravZ) / mYZ;

    // Auto-zero: average the first ~0.6 s after Start to null any resting bias.
    if (zeroing) {
      zeroAcc.x += ax; zeroAcc.z += azC; zeroAcc.n++;
      if (performance.now() - zeroAcc.t0 >= 600) {
        zeroX = zeroAcc.x / Math.max(1, zeroAcc.n);
        zeroZ = zeroAcc.z / Math.max(1, zeroAcc.n);
        zeroing = false;
        U.setText('status', 'Live');
      }
      return;
    }

    const lat = (ax - zeroX) / G;   // device X → lateral (unchanged)
    const lon = (azC - zeroZ) / G;   // tilt-compensated fore/aft (+ = braking)
    curX = curX * 0.75 + lat * 0.25;
    curY = curY * 0.75 + lon * 0.25;

    if (running) {
      if (curY > gmax.brake) gmax.brake = curY;     // +Z (up) = brake
      if (-curY > gmax.accel) gmax.accel = -curY;    // -Z (down) = accel
      if (curX > gmax.right) gmax.right = curX;       // +X = right turn
      if (-curX > gmax.left) gmax.left = -curX;       // −X = left turn
      const mag = Math.hypot(curX, curY);
      if (mag > gmax.peak) gmax.peak = mag;
      const now = performance.now();
      if (now - lastSave > 1000) { lastSave = now; saveMax(); }
    }
  }
  function addMotion() { if (!motionOn) { window.addEventListener('devicemotion', onMotion); motionOn = true; } }
  function removeMotion() { if (motionOn) { window.removeEventListener('devicemotion', onMotion); motionOn = false; } }

  function ensureMotion() {
    const D = window.DeviceMotionEvent;
    if (!D) return Promise.resolve({ ok: false, reason: 'Motion sensors unavailable' });
    if (typeof D.requestPermission === 'function') {
      return D.requestPermission()
        .then(res => res === 'granted' ? { ok: true } : { ok: false, reason: 'Motion access denied (Settings → Safari → Motion & Orientation Access)' })
        .catch(() => ({ ok: false, reason: 'Could not request motion access' }));
    }
    return Promise.resolve({ ok: true });
  }

  // --- Render loop (needle easing + dot + readouts) ----------------------
  function paintPeaks() {
    U.setText('gBrake', num(gmax.brake, '0.00'));
    U.setText('gAccel', num(gmax.accel, '0.00'));
    U.setText('gLeft', num(gmax.left, '0.00'));
    U.setText('gRight', num(gmax.right, '0.00'));
    U.setText('gPeak', num(gmax.peak, '0.00'));
    U.setText('gCur', (running && motionOn && !zeroing) ? num(Math.hypot(curX, curY), '—') : '—');
  }

  function loop() {
    if (!running) { rafId = 0; return; }
    // Ease the needle/readout toward the latest (≈1 Hz) GPS speed.
    dispSpeed += (targetSpeed - dispSpeed) * 0.15;
    if (Math.abs(targetSpeed - dispSpeed) < 0.05) dispSpeed = targetSpeed;
    gauge.update(dispSpeed);
    // Live dot (clamped just past the ring). +X→right, +Z(brake)→up.
    dot.setAttribute('cx', r2(clamp(PAD_C + curX * PAD_SCALE, 4, 196)));
    dot.setAttribute('cy', r2(clamp(PAD_C - curY * PAD_SCALE, 4, 196)));
    const now = performance.now();
    if (now - lastPaint > 100) { lastPaint = now; paintPeaks(); }
    rafId = requestAnimationFrame(loop);
  }

  // --- Start / stop ------------------------------------------------------
  const startBtn = document.getElementById('startBtn');
  function setBtn(on) {
    startBtn.textContent = on ? 'Stop' : 'Start';
    startBtn.classList.toggle('btn--stop', on);
  }

  function start() {
    if (running) return;
    // Both the wake lock and the iOS motion prompt must be kicked off from this
    // user gesture, before any await — so initiate them synchronously here.
    U.wakeLock.acquire();
    const permP = ensureMotion();
    startWatch();
    running = true;
    setBtn(true);
    U.setText('status', 'Calibrating…');
    if (!rafId) loop();
    permP.then(perm => {
      if (perm.ok) {
        gravInit = false;
        addMotion();
        if (running) { zeroAcc = { x: 0, z: 0, n: 0, t0: performance.now() }; zeroing = true; }
      }
      else { U.setText('status', perm.reason + ' · speed still works'); }
    });
  }

  function stop() {
    running = false; zeroing = false;
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    removeMotion();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    U.wakeLock.release();
    saveMax();
    setBtn(false);
    paintPeaks();
    U.setText('status', 'Stopped');
  }

  startBtn.addEventListener('click', () => (running ? stop() : start()));

  document.getElementById('resetMax').addEventListener('click', () => {
    gmax.brake = gmax.accel = gmax.left = gmax.right = gmax.peak = 0;
    saveMax();
    paintPeaks();
  });

  // --- Boot --------------------------------------------------------------
  gauge.update(0);
  paintPeaks();
  U.setText('status', 'Tap Start to begin');

  window.addEventListener('pagehide', () => {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    removeMotion();
    if (rafId) cancelAnimationFrame(rafId);
    U.wakeLock.release();
    saveMax();
  });
})();
