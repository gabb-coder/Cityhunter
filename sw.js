// City Hunter service worker: makes the app installable and keeps the app
// shell available on a weak or missing signal.
//
// Strategy: NETWORK FIRST with a short timeout, cache as the fallback.
// Every player in a match must run the same code as the host, so a phone
// with a connection always gets the current files; the cache is only used
// when the network is slow or gone. Only same-origin GET requests are
// handled that way; fonts and the reconnect probe (a HEAD request) go
// straight to the network.
//
// Map tiles are the exception: they are served CACHE FIRST from their own
// cache. The page asks for the play zone's tiles to be saved when a match
// starts (js/tiles.js), and every tile that is viewed is kept as well.

const CACHE = 'cityhunter-shell-v2.2.0';
const TILES = 'cityhunter-tiles-v1';
const TILE_PATH = /\/\d+\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)$/;
const TIMEOUT_MS = 3500;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/screens.css', 'css/game.css', 'css/catch.css', 'css/alerts.css', 'css/results.css', 'css/extras.css', 'css/more.css',
  'js/app.js', 'js/state.js', 'js/config.js', 'js/util.js', 'js/icons.js', 'js/theme.js', 'js/sound.js',
  'js/geo.js', 'js/map.js', 'js/net.js', 'js/client.js', 'js/voice.js', 'js/resume.js',
  'js/diag.js', 'js/i18n.js', 'js/lang/zh.js', 'js/practice.js', 'js/tiles.js',
  'js/host.js', 'js/host-play.js', 'js/host-catch.js', 'js/host-admin.js', 'js/host-safety.js', 'js/host-resilience.js', 'js/host-fairplay.js',
  'js/ui/core.js', 'js/ui/home.js', 'js/ui/lobby.js', 'js/ui/reveal.js', 'js/ui/game.js', 'js/ui/shop.js', 'js/ui/chat.js',
  'js/ui/catch.js', 'js/ui/results.js', 'js/ui/admin.js', 'js/ui/alerts.js', 'js/ui/net.js', 'js/ui/zone.js', 'js/ui/safety.js',
  'js/ui/extras.js', 'js/ui/replay.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/peerjs.min.js', 'vendor/qrcode.js',
  'icons/icon.svg', 'icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_PATH.test(url.pathname)) return event.respondWith(tile(req));
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

// ---------------------------------------------------------------- tiles
// Cache first: a saved tile is used at once; anything else is fetched and
// kept for next time.
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone());
  return res;
}

async function fetchTile(cache, url) {
  if (await cache.match(url)) return true;
  try {
    // CORS first (a real response that is cheap to store); if the tile
    // server does not allow it, fall back to an opaque one.
    let res = await fetch(url, { mode: 'cors' }).catch(() => null);
    if (!res || !res.ok) res = await fetch(url, { mode: 'no-cors' });
    if (!res.ok && res.type !== 'opaque') return false;
    await cache.put(url, res);
    return true;
  } catch (e) {
    return false;
  }
}

async function saveTiles(urls, keep) {
  const cache = await caches.open(TILES);
  let ok = 0;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) if (await fetchTile(cache, queue.shift())) ok++;
  };
  await Promise.all([worker(), worker(), worker(), worker()]);   // four at a time: gentle on the tile server
  // Oldest out once there are too many.
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - (keep || 800)))) await cache.delete(k);
  return { ok, total: urls.length };
}

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'tiles' || !Array.isArray(msg.urls)) return;
  event.waitUntil(saveTiles(msg.urls.slice(0, 400), msg.keep).then((result) => {
    if (event.source) event.source.postMessage({ type: 'tiles-done', ...result });
  }));
});
