// Offline map: when a match starts, ask the service worker to save the map
// tiles that cover the play zone, so the map still draws on a weak signal.
// Tiles you look at are kept too. See the "tiles" part of sw.js.
//
// Kept deliberately small (CONFIG.map.offline): free tile servers such as
// OpenStreetMap's do not allow bulk downloading.

/* global L */
import { CONFIG } from './config.js';
import { app } from './state.js';
import { tileConfig } from './map.js';
import { note } from './diag.js';

const O = CONFIG.map.offline;
let savedFor = null;

// Slippy-map tile numbers for a point.
function tileXY(lat, lng, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n) };
}

// Every tile URL covering the zone (plus a margin) at the chosen zooms.
export function zoneTileUrls(zone) {
  const t = tileConfig();
  const subs = t.subdomains || 'abc';
  const retina = typeof L !== 'undefined' && L.Browser && L.Browser.retina && t.url.includes('{r}') ? '@2x' : '';
  const reach = (zone.base || zone.r) * O.margin;
  const dLat = reach / 111320;
  const dLng = reach / (111320 * Math.cos((zone.lat * Math.PI) / 180));
  const urls = [];
  for (const z of O.zooms) {
    if (z > (t.maxNativeZoom || 19)) continue;
    const a = tileXY(zone.lat + dLat, zone.lng - dLng, z);   // north-west
    const b = tileXY(zone.lat - dLat, zone.lng + dLng, z);   // south-east
    const count = (b.x - a.x + 1) * (b.y - a.y + 1);
    if (urls.length + count > O.maxTiles) continue;           // skip a zoom rather than overshoot
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) {
        urls.push(t.url.replace('{s}', subs[Math.abs(x + y) % subs.length]).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{r}', retina));
      }
    }
  }
  return urls;
}

function saveZone() {
  const s = app.session && app.session.snap;
  if (!O.enabled || !s || !s.zone || !app.session.inMatch) return;
  const key = s.code + ':' + s.round;
  if (savedFor === key) return;
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return;                       // not installed or first visit: nothing to do
  savedFor = key;
  const urls = zoneTileUrls(s.zone);
  note('map', 'saving ' + urls.length + ' tiles for the zone');
  sw.postMessage({ type: 'tiles', urls, keep: O.keepTiles });
}

if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'tiles-done') {
      app.tilesSaved = e.data;
      note('map', 'tiles saved: ' + e.data.ok + ' of ' + e.data.total);
    }
  });
}

app.bus.on('session', (session) => session.on('update', saveZone));
