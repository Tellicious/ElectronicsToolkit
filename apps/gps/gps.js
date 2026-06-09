(() => {
  'use strict';
  const U = window.Utilities;
  const F = window.SensorKit.format;
  const SK = window.SensorKit;
  const fin = v => (Number.isFinite(v) ? v : '');

  // --- Settings (persisted) ----------------------------------------------
  const SETTINGS = {
    coord: localStorage.getItem('gps.coordFormat') || 'dec',
    speed: localStorage.getItem('gps.speedUnit') || 'mps',
    thr: parseFloat(localStorage.getItem('gps.threshold')) || 0.5, // m/s
    logging: localStorage.getItem('gps.logging') === 'on',
  };

  // --- KPI tiles ---------------------------------------------------------
  const kpi = new SK.KpiGrid(document.getElementById('kpis'), [
    { key: 'speed', label: 'Speed' },
    { key: 'heading', label: 'Heading' },
    { key: 'distance', label: 'Distance' },
    { key: 'maxSpeed', label: 'Max speed' },
    { key: 'avgSpeed', label: 'Avg speed' },
    { key: 'movingTime', label: 'Moving time' },
    { key: 'avgAcc', label: 'Avg accuracy' },
  ]);

  // --- Charts ------------------------------------------------------------
  const speedChart = new SK.TimeSeriesChart(document.getElementById('chartSpeed'),
    { color: '#0a84ff', symmetric: false, yMin: 0, scale: v => (SETTINGS.speed === 'kmh' ? v * 3.6 : v), fmt: v => v.toFixed(1) });
  const altChart = new SK.TimeSeriesChart(document.getElementById('chartAlt'),
    { color: '#34c759', symmetric: false, fmt: v => v.toFixed(0) });
  const hdgChart = new SK.TimeSeriesChart(document.getElementById('chartHdg'),
    { color: '#ff9f0a', symmetric: false, fmt: v => v.toFixed(0) });

  function panelTitle(frameId) {
    return document.getElementById(frameId).closest('[data-panel]').querySelector('.sk-panel__title');
  }
  function refreshChartTitles() {
    panelTitle('chartSpeed').textContent = `Speed (${F.speedUnitLabel(SETTINGS.speed)})`;
    panelTitle('chartAlt').textContent = 'Altitude (m)';
    panelTitle('chartHdg').textContent = 'Heading (°)';
  }

  // --- Map (Leaflet) -----------------------------------------------------
  let map = null, trackLine = null, posMarker = null, centered = false;
  function initMap() {
    if (!window.L) return;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    trackLine = L.polyline([], { color: '#0a84ff', weight: 4 }).addTo(map);
    posMarker = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#0a84ff', fillOpacity: 1 });
  }

  // --- CSV ---------------------------------------------------------------
  const csv = new SK.CsvLogger([
    { key: 'iso', header: 'time_iso' }, { key: 'elapsed', header: 'elapsed_s' },
    { key: 'lat', header: 'lat_deg' }, { key: 'lon', header: 'lon_deg' },
    { key: 'alt', header: 'alt_m' }, { key: 'hacc', header: 'h_acc_m' }, { key: 'vacc', header: 'v_acc_m' },
    { key: 'speed', header: 'speed_mps' }, { key: 'heading', header: 'heading_deg' },
  ]);

  // --- Session state -----------------------------------------------------
  const st = {
    running: false, started: false, startEpoch: 0, n: 0,
    dist: 0, maxSpeed: 0, movingMs: 0, accSum: 0, accN: 0, prevAcc: null,
    avgSpeed() { return this.movingMs > 0 ? this.dist / (this.movingMs / 1000) : 0; },
    avgAcc() { return this.accN > 0 ? this.accSum / this.accN : NaN; },
  };
  let last = null, prev = null, lastFixT = 0, watchId = null;

  // --- Geolocation -------------------------------------------------------
  function toSample(pos) {
    const c = pos.coords, t = pos.timestamp;
    let speed = (typeof c.speed === 'number' && c.speed >= 0) ? c.speed : NaN;
    let heading = (typeof c.heading === 'number' && c.heading >= 0) ? c.heading : NaN;
    if (prev && (!Number.isFinite(speed) || !Number.isFinite(heading))) {
      const dt = (t - prev.t) / 1000;
      if (dt > 0) {
        const d = F.haversine(prev.lat, prev.lon, c.latitude, c.longitude);
        if (!Number.isFinite(speed)) speed = d / dt;
        if (!Number.isFinite(heading) && d / dt > 0.5) heading = F.bearing(prev.lat, prev.lon, c.latitude, c.longitude);
      }
    }
    return { t, lat: c.latitude, lon: c.longitude, alt: c.altitude, hAcc: c.accuracy, vAcc: c.altitudeAccuracy, speed, heading };
  }

  function renderReadout() {
    if (!last) return;
    U.setText('lat', F.coord(last.lat, 'lat', SETTINGS.coord));
    U.setText('lon', F.coord(last.lon, 'lon', SETTINGS.coord));
    U.setText('alt', F.metres(last.alt));
    U.setText('hacc', F.accuracy(last.hAcc));
    U.setText('vacc', F.accuracy(last.vAcc));
  }

  function renderKpis() {
    const has = st.n > 0;
    kpi.update({
      speed: last ? F.speed(last.speed, SETTINGS.speed) : '—',
      heading: last ? F.heading(last.heading) : '—',
      distance: has ? F.distance(st.dist) : '—',
      maxSpeed: has ? F.speed(st.maxSpeed, SETTINGS.speed) : '—',
      avgSpeed: has ? F.speed(st.avgSpeed(), SETTINGS.speed) : '—',
      movingTime: has ? F.duration(st.movingMs) : '—',
      avgAcc: has ? F.accuracy(st.avgAcc()) : '—',
    });
  }

  function onPos(pos) {
    const s = toSample(pos);
    const interval = lastFixT ? ((s.t - lastFixT) / 1000) : null;
    lastFixT = s.t;
    last = s;

    // Map position marker + follow (live, even before Start).
    if (map) {
      posMarker.setLatLng([s.lat, s.lon]);
      if (!centered) { posMarker.addTo(map); map.setView([s.lat, s.lon], 16); centered = true; }
      else if (st.running) map.panTo([s.lat, s.lon]);
    }

    if (st.running) {
      st.n++;
      if (Number.isFinite(s.hAcc)) { st.accSum += s.hAcc; st.accN++; }
      if (Number.isFinite(s.speed)) st.maxSpeed = Math.max(st.maxSpeed, s.speed);
      if (st.prevAcc) {
        const dt = (s.t - st.prevAcc.t) / 1000;
        const d = F.haversine(st.prevAcc.lat, st.prevAcc.lon, s.lat, s.lon);
        if (dt > 0 && d / dt >= SETTINGS.thr) { st.dist += d; st.movingMs += dt * 1000; }
      }
      st.prevAcc = { t: s.t, lat: s.lat, lon: s.lon };

      const e = (s.t - st.startEpoch) / 1000;
      speedChart.push(e, s.speed);
      if (Number.isFinite(s.alt)) altChart.push(e, s.alt);
      if (Number.isFinite(s.heading)) hdgChart.push(e, s.heading);
      if (map) trackLine.addLatLng([s.lat, s.lon]);

      if (SETTINGS.logging) csv.addRow({
        iso: new Date(s.t).toISOString(), elapsed: e.toFixed(2),
        lat: s.lat.toFixed(7), lon: s.lon.toFixed(7),
        alt: fin(s.alt), hacc: fin(s.hAcc), vacc: fin(s.vAcc), speed: fin(s.speed), heading: fin(s.heading),
      });
      controls.set(null, { hasData: true, canLog: csv.count > 0 });
    }

    prev = { t: s.t, lat: s.lat, lon: s.lon };
    renderReadout();
    renderKpis();
    U.setText('status', (st.running ? 'Recording' : 'Live') + (interval ? ` · ${interval.toFixed(1)} s/fix` : ''));
  }

  function onErr(err) {
    U.setText('status', err.code === 1 ? 'Location permission denied'
      : err.code === 2 ? 'Position unavailable'
        : err.code === 3 ? 'Location request timed out' : (err.message || 'Location error'));
  }

  function startWatch() {
    if (!('geolocation' in navigator)) { U.setText('status', 'Geolocation not supported'); return; }
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  // --- Controls ----------------------------------------------------------
  const controls = new SK.ControlBar(document.getElementById('controls'), {
    onStart() {
      if (!st.startEpoch) st.startEpoch = Date.now();
      st.prevAcc = null; st.running = true; st.started = true;
      U.wakeLock.acquire();
      controls.set('running', { hasData: true, canLog: csv.count > 0 });
    },
    onStop() {
      st.running = false; st.prevAcc = null;
      U.wakeLock.release();
      controls.set('paused', { hasData: st.started, canLog: csv.count > 0 });
    },
    onReset() {
      st.running = false; st.started = false; st.startEpoch = 0; st.n = 0; st.dist = 0; st.maxSpeed = 0;
      st.movingMs = 0; st.accSum = 0; st.accN = 0; st.prevAcc = null;
      csv.clear();
      speedChart.clear(); altChart.clear(); hdgChart.clear();
      if (trackLine) trackLine.setLatLngs([]);
      U.wakeLock.release();
      renderKpis();
      controls.set('idle', { hasData: false, canLog: false });
    },
    onLog() {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      csv.export(`gps-${stamp}.csv`);
    },
  });

  // --- Settings ----------------------------------------------------------
  // CSV logging plus the GPS readout settings (coordinate format, speed unit,
  // movement threshold) now live on this page and apply live.
  const logToggle = document.getElementById('logToggle');
  logToggle.checked = SETTINGS.logging;
  logToggle.addEventListener('change', () => {
    SETTINGS.logging = logToggle.checked;
    localStorage.setItem('gps.logging', logToggle.checked ? 'on' : 'off');
  });

  function pills(id, key, store, after) {
    const g = document.getElementById(id), bs = [...g.querySelectorAll('.seg__btn')];
    const paint = v => bs.forEach(b => b.classList.toggle('seg__btn--active', b.dataset.value === v));
    bs.forEach(b => b.addEventListener('click', () => {
      SETTINGS[key] = b.dataset.value; localStorage.setItem(store, b.dataset.value); paint(b.dataset.value); if (after) after();
    }));
    paint(SETTINGS[key]);
  }
  pills('segCoord', 'coord', 'gps.coordFormat', renderReadout);
  pills('segSpeed', 'speed', 'gps.speedUnit', () => { refreshChartTitles(); speedChart.setOptions({}); renderKpis(); paintThr(); });

  const thr = document.getElementById('gpsThr');
  thr.value = SETTINGS.thr;
  function paintThr() {
    const v = parseFloat(thr.value);
    U.setText('gpsThrVal', SETTINGS.speed === 'kmh' ? (v * 3.6).toFixed(1) + ' km/h' : v.toFixed(1) + ' m/s');
  }
  thr.addEventListener('input', () => { SETTINGS.thr = parseFloat(thr.value); localStorage.setItem('gps.threshold', thr.value); paintThr(); });
  paintThr();

  // --- Center map on current position ------------------------------------
  document.getElementById('mapCenter').addEventListener('click', () => {
    if (map && last) map.setView([last.lat, last.lon], Math.max(map.getZoom(), 16));
  });

  // --- Fullscreen panels -------------------------------------------------
  const resizers = {
    map: () => map && map.invalidateSize(),
    chartSpeed: () => speedChart.resize(), chartAlt: () => altChart.resize(), chartHdg: () => hdgChart.resize(),
  };
  document.querySelectorAll('[data-fs]').forEach(btn => btn.addEventListener('click', () => {
    const panel = btn.closest('[data-panel]');
    const frame = panel.querySelector('.sk-frame');
    panel.classList.toggle('sk-panel--fs');
    setTimeout(() => { const r = resizers[frame.id]; if (r) r(); }, 60);
  }));

  // --- Boot --------------------------------------------------------------
  refreshChartTitles();
  renderKpis();
  initMap();
  startWatch();
  window.addEventListener('pagehide', () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); });
})();
