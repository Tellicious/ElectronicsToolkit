/* SensorKit — shared formatting and geo helpers.
 *
 * Pure functions reused across the sensor apps (GPS now; motion / mic later).
 * Exposed as window.SensorKit.format in the browser and module.exports in node
 * so the math can be unit-tested headlessly.
 */
(function (root) {
  'use strict';

  const R_EARTH = 6371000; // mean Earth radius, metres
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  // Great-circle distance between two lat/lon points, in metres.
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Initial bearing from point 1 to point 2, degrees in [0, 360).
  function bearing(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // --- Coordinate formatting --------------------------------------------
  // mode: 'dec' (decimal degrees) | 'dms' (degrees/minutes/seconds).
  // kind: 'lat' | 'lon' (selects N/S vs E/W hemisphere).
  function coord(value, kind, mode, dash = '—') {
    if (!isNum(value)) return dash;
    const hemi = kind === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    const a = Math.abs(value);
    if (mode === 'dms') {
      const d = Math.floor(a);
      const mFull = (a - d) * 60;
      const m = Math.floor(mFull);
      const s = (mFull - m) * 60;
      return `${d}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″ ${hemi}`;
    }
    return `${a.toFixed(6)}° ${hemi}`;
  }

  // --- Speed -------------------------------------------------------------
  // unit: 'mps' | 'kmh'. Input is always metres/second.
  const speedUnitLabel = unit => (unit === 'kmh' ? 'km/h' : 'm/s');
  const speedValue = (mps, unit) => (unit === 'kmh' ? mps * 3.6 : mps);
  function speed(mps, unit, decimals = 1, dash = '—') {
    if (!isNum(mps)) return dash;
    return `${speedValue(mps, unit).toFixed(decimals)} ${speedUnitLabel(unit)}`;
  }

  // --- Other readouts ----------------------------------------------------
  const metres = (m, decimals = 1, dash = '—') => (isNum(m) ? `${m.toFixed(decimals)} m` : dash);
  const accuracy = (m, decimals = 1, dash = '—') => (isNum(m) ? `±${m.toFixed(decimals)} m` : dash);

  const CARD8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function heading(deg, dash = '—') {
    if (!isNum(deg)) return dash;
    const d = ((deg % 360) + 360) % 360;
    return `${Math.round(d)}° ${CARD8[Math.round(d / 45) % 8]}`;
  }

  function distance(m, dash = '—') {
    if (!isNum(m)) return dash;
    return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
  }

  // Duration in ms → H:MM:SS (hours dropped when zero).
  function duration(ms, dash = '—') {
    if (!isNum(ms) || ms < 0) return dash;
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  const format = {
    haversine, bearing,
    coord, speed, speedValue, speedUnitLabel,
    metres, accuracy, heading, distance, duration,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = format;
  root.SensorKit = root.SensorKit || {};
  root.SensorKit.format = format;
})(typeof window !== 'undefined' ? window : globalThis);
