// City Hunter service worker: makes the app installable and keeps the app
// shell available on a weak or missing signal.
//
// Strategy: NETWORK FIRST with a short timeout, cache as the fallback.
// Every player in a match must run the same code as the host, so a phone
// with a connection always gets the current files; the cache is only used
// when the network is slow or gone. Only same-origin GET requests are
// handled: map tiles, fonts and the reconnect probe (a HEAD request) go
// straight to the network.

const CACHE = 'cityhunter-shell-v2.1.0';
const TIMEOUT_MS = 3500;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/screens.css', 'css/game.css', 'css/catch.css', 'css/alerts.css', 'css/results.css', 'css/extras.css',
  'js/app.js', 'js/state.js', 'js/config.js', 'js/util.js', 'js/icons.js', 'js/theme.js', 'js/sound.js',
  'js/geo.js', 'js/map.js', 'js/net.js', 'js/client.js', 'js/voice.js', 'js/resume.js',
  'js/host.js', 'js/host-play.js', 'js/host-catch.js', 'js/host-admin.js', 'js/host-safety.js', 'js/host-resilience.js', 'js/host-fairplay.js',
  'js/ui/core.js', 'js/ui/home.js', 'js/ui/lobby.js', 'js/ui/reveal.js', 'js/ui/game.js', 'js/ui/shop.js', 'js/ui/chat.js',
  'js/ui/catch.js', 'js/ui/results.js', 'js/ui/admin.js', 'js/ui/alerts.js', 'js/ui/net.js', 'js/ui/zone.js', 'js/ui/safety.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/peerjs.min.js', 'vendor/qrcode.js',
  'icons/icon.svg', 'icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Query strings (?join=CODE, ?sim=...) all map to the same page.
    const key = req.mode === 'navigate' ? 'index.html' : url.pathname;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
