// Service worker for Electronics Toolkit PWA
//
// Strategy: FULL PRECACHE + NETWORK-FIRST at runtime.
//
//  • On install, EVERY asset in the app (all pages, scripts, styles and
//    icons — not just the shell) is fetched fresh and stored in the cache
//    keyed by VERSION. This means the whole app works offline immediately
//    after the first visit, regardless of which sub-apps have ever been
//    opened.
//  • At runtime every request still goes to the network first and the
//    cache copy is refreshed on success, so online users always get the
//    latest deployed code. The cache is the fallback when offline.
//  • Because each VERSION gets its own cache and the install step always
//    re-fetches the full manifest, bumping VERSION (i.e. deploying an
//    update) transparently re-caches everything from scratch and the old
//    cache is dropped on activate.

const VERSION = 'electronicsToolkit-v1.0.36';

// Complete list of everything the app needs to run fully offline.
// Keep this in sync when adding/removing files (it's the single source of
// truth for what gets pre-cached). Paths are relative to the SW scope (root).
const PRECACHE_ASSETS = [
  // App shell
  './',
  './index.html',
  './manifest.json',

  // Shared assets
  './assets/styles.css',
  './assets/app.js',
  './assets/sensorkit/format.js',
  './assets/sensorkit/csv.js',
  './assets/sensorkit/kpi.js',
  './assets/sensorkit/controls.js',
  './assets/sensorkit/chart.js',
  './assets/sensorkit/liveplot.js',
  './assets/sensorkit/fft.js',
  './assets/sensorkit/multiplot.js',
  './assets/sensorkit/sensorkit.css',
  './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/leaflet/leaflet.css',
  './assets/vendor/leaflet/images/marker-icon.png',
  './assets/vendor/leaflet/images/marker-icon-2x.png',
  './assets/vendor/leaflet/images/marker-shadow.png',
  './assets/vendor/leaflet/images/layers.png',
  './assets/vendor/leaflet/images/layers-2x.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',

  // Sub-apps — pages
  './apps/awg-converter/index.html',
  './apps/battery-life/index.html',
  './apps/capacitor/index.html',
  './apps/time-signal/index.html',
  './apps/tuner/index.html',
  './apps/gps/index.html',
  './apps/mic/index.html',
  './apps/motion/index.html',
  './apps/led-resistor/index.html',
  './apps/number-converter/index.html',
  './apps/op-amp-gain/index.html',
  './apps/resistor/index.html',
  './apps/series-parallel/index.html',
  './apps/settings/index.html',
  './apps/smd-resistor/index.html',
  './apps/voltage-divider/index.html',

  // Sub-apps — scripts
  './apps/awg-converter/awg-converter.js',
  './apps/battery-life/battery-life.js',
  './apps/capacitor/capacitor.js',
  './apps/time-signal/time-signal.js',
  './apps/time-signal/time-signal-worklet.js',
  './apps/tuner/tuner.js',
  './apps/gps/gps.js',
  './apps/mic/mic.js',
  './apps/motion/motion.js',
  './apps/led-resistor/led-resistor.js',
  './apps/number-converter/number-converter.js',
  './apps/op-amp-gain/op-amp-gain.js',
  './apps/resistor/resistor.js',
  './apps/series-parallel/series-parallel.js',
  './apps/smd-resistor/smd-resistor.js',
  './apps/voltage-divider/voltage-divider.js',

  // Sub-apps — styles
  './apps/number-converter/number-converter.css',
  './apps/resistor/resistor.css',
  './apps/time-signal/time-signal.css',
  './apps/motion/motion.css',
  './apps/tuner/tuner.css',
  './apps/voltage-divider/voltage-divider.css',
];

// Fetch every asset bypassing the HTTP cache so a freshly-deployed version is
// genuinely re-cached, then store it. Individual failures are tolerated so one
// missing/renamed file can't block the whole operation. Returns a small summary
// the caller (install, or the "Re-download" button) can report.
async function precache() {
  const cache = await caches.open(VERSION);
  let failed = 0;
  await Promise.allSettled(
    PRECACHE_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res.clone());
        } else {
          throw new Error('bad status ' + (res && res.status));
        }
      } catch (err) {
        failed++;
        console.warn('[SW] precache skip', url, err.message);
      }
    })
  );
  return { ok: true, total: PRECACHE_ASSETS.length, cached: PRECACHE_ASSETS.length - failed, failed };
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Listen for an explicit "skipWaiting" message from the page —
// used to activate a pending SW immediately without waiting for
// all tabs to close.
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // "Re-download the whole program": re-fetch every precached asset and store
  // it (overwriting in place). localStorage — where all settings live — is
  // never touched, so preferences survive. Replies on the port the page sent.
  if (data.type === 'RECACHE') {
    const reply = (msg) => { if (event.ports && event.ports[0]) event.ports[0].postMessage(msg); };
    event.waitUntil(
      precache()
        .then(reply)
        .catch((err) => reply({ ok: false, error: String((err && err.message) || err) }))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Only handle same-origin requests; let everything else go straight to network.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

/**
 * Network-first: try the network. On success, update the cache and return
 * the fresh response. On failure (offline / network error), fall back to
 * any cached copy. If nothing's cached either, return a synthetic offline
 * response for navigations.
 */
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    // `cache: 'no-store'` makes the browser bypass HTTP cache too,
    // so we always hit the actual server.
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.status === 200) {
      // Update cache in the background — don't await, so we return ASAP.
      cache.put(request, fresh.clone()).catch(() => { });
    }
    return fresh;
  } catch (err) {
    // Network failed — try cache.
    const cached = await cache.match(request);
    if (cached) return cached;

    // For navigations, fall back to the shell.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }

    // Nothing we can do — return a stub so the fetch promise resolves.
    return new Response('Offline and no cached copy available.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
