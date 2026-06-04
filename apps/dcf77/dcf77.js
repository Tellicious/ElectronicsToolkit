(() => {
  'use strict';
  const U = window.Utilities;

  // ===== Time helpers =====================================================
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

  // Civil-time components for an instant in a given IANA zone.
  function zoneParts(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    const p = {}; f.formatToParts(date).forEach(x => { p[x.type] = x.value; });
    const wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const Y = +p.year, M = +p.month, D = +p.day;
    const asUTC = Date.UTC(Y, M - 1, D, +p.hour, +p.minute, +p.second);
    const offset = Math.round((asUTC - date.getTime()) / 60000); // minutes east of UTC
    const doy = Math.floor((Date.UTC(Y, M - 1, D) - Date.UTC(Y, 0, 1)) / 86400000) + 1;
    const dowSun = wmap[p.weekday];               // 0=Sun .. 6=Sat
    return {
      Y, M, D, hh: +p.hour, mm: +p.minute, ss: +p.second,
      year2: Y % 100, doy, dowSun, dowMon: dowSun === 0 ? 7 : dowSun, offset,
    };
  }

  // BCD bit test: is `weight` set in the BCD representation of `value`?
  function bcdBit(value, w) {
    if (w >= 100) return (Math.floor(value / 100) & (w / 100)) ? 1 : 0;
    if (w >= 10) return (Math.floor(value / 10) % 10 & (w / 10)) ? 1 : 0;
    return (value % 10 & w) ? 1 : 0;
  }
  function setW(sym, value, pairs) { pairs.forEach(([s, w]) => { if (bcdBit(value, w)) sym[s] = '1'; }); }

  // ===== Per-second amplitude segments ====================================
  // Each second is described as an ordered list of {d: milliseconds, a: amplitude}.
  const segFull = () => [{ d: 1000, a: 1 }];
  const segLowFirst = (lowMs, lowA) => [{ d: lowMs, a: lowA }, { d: 1000 - lowMs, a: 1 }];
  const segHighFirst = (highMs, lowA) => [{ d: highMs, a: 1 }, { d: 1000 - highMs, a: lowA }];

  // ===== Station encoders (each returns 60 second-programs) ================
  // DCF77 — Germany, 77.5 kHz, CET/CEST, encodes the upcoming minute.
  function dcf77Program(anchor) {
    const p = zoneParts(anchor, 'Europe/Berlin'), dst = p.offset === 120;
    const b = new Array(60).fill(0);
    if (dst) b[17] = 1; else b[18] = 1;
    b[20] = 1;
    const put = (start, v, ws) => ws.forEach((w, i) => { b[start + i] = bcdBit(v, w); });
    const par = (a, z) => { let x = 0; for (let i = a; i <= z; i++) x ^= b[i]; return x; };
    put(21, p.mm, [1, 2, 4, 8, 10, 20, 40]); b[28] = par(21, 27);
    put(29, p.hh, [1, 2, 4, 8, 10, 20]); b[35] = par(29, 34);
    put(36, p.D, [1, 2, 4, 8, 10, 20]);
    put(42, p.dowMon, [1, 2, 4]);
    put(45, p.M, [1, 2, 4, 8, 10]);
    put(50, p.year2, [1, 2, 4, 8, 10, 20, 40, 80]);
    b[58] = par(36, 57);
    return b.map((bit, i) => i === 59 ? segFull() : (bit ? segLowFirst(200, 0.15) : segLowFirst(100, 0.15)));
  }

  // WWVB — USA, 60 kHz, UTC, encodes the current minute.
  function wwvbProgram(anchor) {
    const p = zoneParts(anchor, 'UTC');
    const usDst = zoneParts(anchor, 'America/New_York').offset === -240;
    const sym = new Array(60).fill('0');
    [0, 9, 19, 29, 39, 49, 59].forEach(i => (sym[i] = 'M'));
    setW(sym, p.mm, [[1, 40], [2, 20], [3, 10], [5, 8], [6, 4], [7, 2], [8, 1]]);
    setW(sym, p.hh, [[12, 20], [13, 10], [15, 8], [16, 4], [17, 2], [18, 1]]);
    setW(sym, p.doy, [[22, 200], [23, 100], [25, 80], [26, 40], [27, 20], [28, 10], [30, 8], [31, 4], [32, 2], [33, 1]]);
    sym[36] = '1'; sym[38] = '1';                 // DUT1 sign +, magnitude 0
    setW(sym, p.year2, [[45, 80], [46, 40], [47, 20], [48, 10], [50, 8], [51, 4], [52, 2], [53, 1]]);
    if (isLeap(p.Y)) sym[55] = '1';
    if (usDst) { sym[57] = '1'; sym[58] = '1'; }
    return sym.map(s => s === 'M' ? segLowFirst(800, 0.15) : s === '1' ? segLowFirst(500, 0.15) : segLowFirst(200, 0.15));
  }

  // JJY — Japan, 40/60 kHz, JST, encodes the current minute.
  function jjyProgram(anchor) {
    const p = zoneParts(anchor, 'Asia/Tokyo');
    const sym = new Array(60).fill('0');
    [0, 9, 19, 29, 39, 49, 59].forEach(i => (sym[i] = 'M'));
    setW(sym, p.mm, [[1, 40], [2, 20], [3, 10], [5, 8], [6, 4], [7, 2], [8, 1]]);
    setW(sym, p.hh, [[12, 20], [13, 10], [15, 8], [16, 4], [17, 2], [18, 1]]);
    setW(sym, p.doy, [[22, 200], [23, 100], [25, 80], [26, 40], [27, 20], [28, 10], [30, 8], [31, 4], [32, 2], [33, 1]]);
    const par = secs => secs.reduce((a, s) => a ^ (sym[s] === '1' ? 1 : 0), 0);
    if (par([12, 13, 15, 16, 17, 18])) sym[36] = '1';   // PA1 hour parity (even)
    if (par([1, 2, 3, 5, 6, 7, 8])) sym[37] = '1';      // PA2 minute parity (even)
    setW(sym, p.year2, [[41, 80], [42, 40], [43, 20], [44, 10], [45, 8], [46, 4], [47, 2], [48, 1]]);
    if (p.dowSun & 4) sym[50] = '1'; if (p.dowSun & 2) sym[51] = '1'; if (p.dowSun & 1) sym[52] = '1';
    return sym.map(s => s === 'M' ? segHighFirst(200, 0.1) : s === '1' ? segHighFirst(500, 0.1) : segHighFirst(800, 0.1));
  }

  // MSF — UK, 60 kHz, GMT/BST, OOK, encodes the upcoming minute.
  function msfProgram(anchor) {
    const p = zoneParts(anchor, 'Europe/London'), bst = p.offset === 60;
    const A = new Array(60).fill(0), B = new Array(60).fill(0);
    const setA = (v, pairs) => pairs.forEach(([s, w]) => { A[s] = bcdBit(v, w); });
    setA(p.year2, [[17, 80], [18, 40], [19, 20], [20, 10], [21, 8], [22, 4], [23, 2], [24, 1]]);
    setA(p.M, [[25, 10], [26, 8], [27, 4], [28, 2], [29, 1]]);
    setA(p.D, [[30, 20], [31, 10], [32, 8], [33, 4], [34, 2], [35, 1]]);
    if (p.dowSun & 4) A[36] = 1; if (p.dowSun & 2) A[37] = 1; if (p.dowSun & 1) A[38] = 1;
    setA(p.hh, [[39, 20], [40, 10], [41, 8], [42, 4], [43, 2], [44, 1]]);
    setA(p.mm, [[45, 40], [46, 20], [47, 10], [48, 8], [49, 4], [50, 2], [51, 1]]);
    const oddPar = (a, z) => { let x = 0; for (let i = a; i <= z; i++) x ^= A[i]; return x ? 0 : 1; };
    B[54] = oddPar(17, 24); B[55] = oddPar(25, 35); B[56] = oddPar(36, 38); B[57] = oddPar(39, 51);
    B[58] = bst ? 1 : 0;
    const segs = new Array(60);
    for (let i = 0; i < 60; i++) {
      if (i === 0) { segs[0] = [{ d: 500, a: 0 }, { d: 500, a: 1 }]; continue; }
      segs[i] = [{ d: 100, a: 0 }, { d: 100, a: A[i] ? 0 : 1 }, { d: 100, a: B[i] ? 0 : 1 }, { d: 700, a: 1 }];
    }
    return segs;
  }

  // BPC — China, 68.5 kHz, CST, 20-second frame ×3, encodes the current minute.
  function bpcProgram(anchor) {
    const p = zoneParts(anchor, 'Asia/Shanghai');
    const h12 = p.hh % 12, pm = p.hh >= 12 ? 1 : 0;
    const segs = new Array(60);
    for (let blk = 0; blk < 3; blk++) {
      const base = blk * 20, secVal = blk * 20;
      const ms = new Array(20).fill(0), ls = new Array(20).fill(0);
      ms[1] = secVal === 40 ? 1 : 0; ls[1] = secVal === 20 ? 1 : 0;
      ms[3] = h12 & 8 ? 1 : 0; ls[3] = h12 & 4 ? 1 : 0; ms[4] = h12 & 2 ? 1 : 0; ls[4] = h12 & 1 ? 1 : 0;
      ms[5] = p.mm & 32 ? 1 : 0; ls[5] = p.mm & 16 ? 1 : 0; ms[6] = p.mm & 8 ? 1 : 0; ls[6] = p.mm & 4 ? 1 : 0;
      ms[7] = p.mm & 2 ? 1 : 0; ls[7] = p.mm & 1 ? 1 : 0;
      ls[8] = p.dowMon & 4 ? 1 : 0; ms[9] = p.dowMon & 2 ? 1 : 0; ls[9] = p.dowMon & 1 ? 1 : 0;
      ms[10] = pm;
      let par1 = 0; for (let s = 1; s <= 9; s++) par1 ^= ms[s] ^ ls[s]; ls[10] = par1;
      ls[11] = p.D & 16 ? 1 : 0; ms[12] = p.D & 8 ? 1 : 0; ls[12] = p.D & 4 ? 1 : 0; ms[13] = p.D & 2 ? 1 : 0; ls[13] = p.D & 1 ? 1 : 0;
      ms[14] = p.M & 8 ? 1 : 0; ls[14] = p.M & 4 ? 1 : 0; ms[15] = p.M & 2 ? 1 : 0; ls[15] = p.M & 1 ? 1 : 0;
      ms[16] = p.year2 & 32 ? 1 : 0; ls[16] = p.year2 & 16 ? 1 : 0; ms[17] = p.year2 & 8 ? 1 : 0; ls[17] = p.year2 & 4 ? 1 : 0;
      ms[18] = p.year2 & 2 ? 1 : 0; ls[18] = p.year2 & 1 ? 1 : 0; ms[19] = p.year2 & 64 ? 1 : 0;
      let par2 = 0; for (let s = 11; s <= 18; s++) par2 ^= ms[s] ^ ls[s]; ls[19] = par2;
      for (let s = 0; s < 20; s++) {
        if (s === 0) { segs[base] = segFull(); continue; }
        const v = ms[s] * 2 + ls[s];
        segs[base + s] = segLowFirst((v + 1) * 100, 0.1);
      }
    }
    return segs;
  }

  // ===== Station registry =================================================
  const STATIONS = {
    dcf77: { label: 'DCF77 — Germany (77.5 kHz)', tz: 'Europe/Berlin', offsetMin: 1, carriers: [19375, 15500, 18500], program: dcf77Program, zone: p => p.offset === 120 ? 'CEST' : 'CET' },
    wwvb: { label: 'WWVB — USA (60 kHz)', tz: 'UTC', offsetMin: 0, carriers: [20000], program: wwvbProgram, zone: () => 'UTC' },
    jjy40: { label: 'JJY-40 — Japan (40 kHz)', tz: 'Asia/Tokyo', offsetMin: 0, carriers: [20000], program: jjyProgram, zone: () => 'JST' },
    jjy60: { label: 'JJY-60 — Japan (60 kHz)', tz: 'Asia/Tokyo', offsetMin: 0, carriers: [20000], program: jjyProgram, zone: () => 'JST' },
    msf: { label: 'MSF — UK (60 kHz)', tz: 'Europe/London', offsetMin: 1, carriers: [20000], program: msfProgram, zone: p => p.offset === 60 ? 'BST' : 'GMT' },
    bpc: { label: 'BPC — China (68.5 kHz)', tz: 'Asia/Shanghai', offsetMin: 0, carriers: [22833], program: bpcProgram, zone: () => 'CST' },
  };
  let station = STATIONS.dcf77;

  // ===== Audio engine =====================================================
  let ctx = null, node = null, wakeLock = null;
  let media = null, running = false, lastPlayMinute = 0, uiTimer = null;

  // A silent loop claims the media playback session (needed alongside transmit).
  function silentWavDataUri(seconds) {
    const sr = 8000, n = Math.floor(sr * seconds), bytes = 44 + n * 2;
    const dv = new DataView(new ArrayBuffer(bytes));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, n * 2, true);
    let bin = ''; const u8 = new Uint8Array(dv.buffer);
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function startMediaUnlock() {
    try {
      if (!media) { media = new Audio(silentWavDataUri(0.4)); media.loop = true; media.setAttribute('playsinline', ''); }
      const pr = media.play(); if (pr && pr.catch) pr.catch(() => { });
    } catch (_) { }
  }
  function stopMediaUnlock() { try { if (media) media.pause(); } catch (_) { } }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { }
  }
  function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (_) { } }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  });

  function selCarrier() { return +document.getElementById('carrier').value; }

  function enqueueNext() {
    if (!node) return;
    lastPlayMinute += 60000;
    node.port.postMessage({ type: 'enqueue', frame: station.program(new Date(lastPlayMinute + station.offsetMin * 60000)) });
  }

  async function start() {
    if (running) return;
    const status = document.getElementById('status');
    try {
      startMediaUnlock();
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ sampleRate: 48000, latencyHint: 'playback' });
      await ctx.audioWorklet.addModule('dcf77-worklet.js');
      await ctx.resume();

      node = new AudioWorkletNode(ctx, 'timesig-processor', { outputChannelCount: [2] });
      node.connect(ctx.destination);
      node.port.onmessage = e => { if (e.data && e.data.type === 'needFrame' && running) enqueueNext(); };
      node.port.postMessage({ type: 'config', carrier: selCarrier(), amp: 1.0 });

      await new Promise(r => setTimeout(r, 1000 - (Date.now() % 1000))); // align to next second

      const now = Date.now();
      const startSecond = new Date(now).getSeconds();
      lastPlayMinute = Math.floor(now / 60000) * 60000;
      node.port.postMessage({ type: 'start', startSecond, frame: station.program(new Date(lastPlayMinute + station.offsetMin * 60000)) });
      enqueueNext();

      running = true;
      await requestWakeLock();
      setPlaying(true);
      uiTimer = setInterval(updateReadout, 250); updateReadout();
      status.textContent = `Transmitting · ${ctx.sampleRate} Hz`;
    } catch (err) {
      status.textContent = 'Could not start audio: ' + (err && err.message || err);
      stop();
    }
  }

  function stop() {
    running = false;
    if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    if (node) { try { node.port.postMessage({ type: 'stop' }); } catch (_) { } }
    stopMediaUnlock();
    try { if (ctx) ctx.close(); } catch (_) { }
    ctx = null; node = null;
    releaseWakeLock();
    setPlaying(false);
    document.getElementById('status').textContent = 'Stopped.';
  }

  function setPlaying(on) {
    const btn = document.getElementById('playBtn');
    btn.classList.toggle('dcf-play--on', on);
    btn.querySelector('.dcf-play__label').textContent = on ? 'Stop' : 'Play';
    document.getElementById('station').disabled = on;
    document.getElementById('carrier').disabled = on;
  }

  function updateReadout() {
    const now = new Date();
    const minuteStart = Math.floor(now.getTime() / 60000) * 60000;
    const anchor = new Date(minuteStart + station.offsetMin * 60000); // minute actually encoded
    const p = zoneParts(anchor, station.tz);
    const f = n => String(n).padStart(2, '0');
    U.setText('encTime', `${f(p.hh)}:${f(p.mm)}  ${f(p.D)}.${f(p.M)}.${p.Y}`);
    U.setText('encZone', station.zone(p));
    U.setText('encSecond', `Second ${f(now.getSeconds())} / 59`);
  }

  // ===== Wire up ==========================================================
  function fillCarriers() {
    U.fillSelect(document.getElementById('carrier'), station.carriers.map(c => [c + ' Hz', c]), station.carriers[0]);
  }
  U.fillSelect(document.getElementById('station'), Object.entries(STATIONS).map(([k, v]) => [v.label, k]), 'dcf77');
  fillCarriers();
  updateReadout();

  document.getElementById('station').addEventListener('change', e => {
    station = STATIONS[e.target.value] || STATIONS.dcf77;
    fillCarriers();
    updateReadout();
  });
  document.getElementById('playBtn').addEventListener('click', () => (running ? stop() : start()));
  window.addEventListener('pagehide', stop);
})();
