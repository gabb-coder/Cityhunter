// Play zone: the preview card in the lobby and the host's map picker.
//
// The picker keeps the zone circle in the middle of the screen; the host
// drags the map underneath it. Until a point is picked, the zone is centred
// on wherever the host is standing when the hunt starts.

/* global L */
import { $, esc, setHTML, metres } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, RULE_OPTIONS } from '../config.js';
import { app, snap } from '../state.js';
import { staticMap, makeTileLayer, tileConfig } from '../map.js';
import { theme } from '../theme.js';
import { act, onRender, render, setLayer, toast } from './core.js';

const root = $('#s-zone');
const st = { map: null, tiles: null, circle: null, r: 0 };

// Round so GPS jitter does not reload the preview every second.
const snapPoint = (p) => ({ lat: Math.round(p.lat * 5000) / 5000, lng: Math.round(p.lng * 5000) / 5000 });

// ---- lobby card ----
export function zoneCard(s, host) {
  const picked = s.zoneCenter;
  const fix = app.geo.fix;
  const center = picked || (host && fix ? snapPoint(fix) : null);
  const where = picked ? 'Placed on the map by the host'
    : host ? 'Centred on you when the hunt starts' : 'Centred on the host when the hunt starts';
  return '<section class="block"><h2 class="label">Play zone</h2><div class="card zone-card">' +
    (center ? staticMap(center, s.rules.zoneRadiusM)
      : '<div class="smap empty"><span class="muted">' + (host ? 'Waiting for your GPS fix…' : 'The host has not placed the zone yet') + '</span></div>') +
    '<div class="zone-foot"><span class="zone-text"><strong>' + metres(s.rules.zoneRadiusM) + ' radius</strong><span class="small muted">' + where + '</span></span>' +
      (host
        ? (picked ? '<button type="button" class="btn btn-sm btn-quiet" data-act="zone-reset">Reset</button>' : '') +
          '<button type="button" class="btn btn-sm" data-act="zone-edit">' + icon('pin', 18) + 'Set on map</button>'
        : '') +
    '</div></div></section>';
}

// ---- picker ----
function build() {
  root.innerHTML =
    '<header class="topbar">' +
      '<button type="button" class="icon-btn sm" data-act="layer-close" aria-label="Back to lobby">' + icon('chevLeft', 22, 2.5) + '</button>' +
      '<h1>PLAY ZONE</h1>' +
      '<span class="chip chip-line mono" id="zone-r"></span>' +
    '</header>' +
    '<div class="zone-map-wrap"><div id="zone-map" aria-label="Drag the map to place the play zone"></div>' +
      '<span class="zone-cross" aria-hidden="true"></span>' +
      '<p class="zone-hint">Drag the map. The dashed circle is the play zone.</p></div>' +
    '<footer class="foot-bar pad-b">' +
      '<div class="zone-radii" role="group" aria-label="Zone radius" id="zone-radii"></div>' +
      '<div class="row2"><button type="button" class="btn" data-act="zone-here">' + icon('recenter', 20) + 'My location</button>' +
        '<button type="button" class="btn btn-lime head zone-done" data-act="zone-done">SET ZONE</button></div>' +
    '</footer>';
  st.map = L.map($('#zone-map'), { zoomControl: false, zoomSnap: 0.25, minZoom: 3, maxZoom: 20, attributionControl: false });
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(st.map);
  st.map.on('move', () => st.circle && st.circle.setLatLng(st.map.getCenter()));
  applyTiles();
}

function applyTiles() {
  if (!st.map) return;
  if (st.tiles) st.tiles.remove();
  st.tiles = makeTileLayer().addTo(st.map);
  st.map.getPane('tilePane').style.filter = tileConfig().filter || '';
  const edge = getComputedStyle(document.documentElement).getPropertyValue('--zone-edge').trim();
  if (st.circle) st.circle.setStyle({ color: edge });
}
theme.on('change', applyTiles);

function frame(center) {
  st.map.fitBounds(L.latLng(center.lat, center.lng).toBounds(st.r * 2.6), { animate: false });
}

function setRadius(r) {
  st.r = r;
  const c = st.map.getCenter();
  st.circle.setRadius(r);
  frame({ lat: c.lat, lng: c.lng });
  renderZone();
}

function renderZone() {
  if (app.ui.layer !== 'zone' || !st.map) return;
  $('#zone-r').textContent = metres(st.r);
  setHTML($('#zone-radii'), RULE_OPTIONS.zoneRadiusM.map((v) =>
    '<button type="button" class="opt" data-act="zone-radius" data-v="' + v + '" aria-pressed="' + (v === st.r) + '">' + metres(v) + '</button>').join(''));
}

act('zone-edit', () => {
  const s = snap();
  if (!s || !s.me.host) return;
  setLayer('zone');
  if (!st.map) build();
  st.r = s.rules.zoneRadiusM;
  const fix = app.geo.fix;
  const center = s.zoneCenter || (fix ? { lat: fix.lat, lng: fix.lng } : null);
  st.map.invalidateSize();
  if (!st.circle) {
    const edge = getComputedStyle(document.documentElement).getPropertyValue('--zone-edge').trim();
    st.circle = L.circle([0, 0], { radius: st.r, color: edge, weight: 3, dashArray: '10 8', fillColor: edge, fillOpacity: 0.08, interactive: false }).addTo(st.map);
  }
  st.circle.setRadius(st.r);
  if (center) frame(center);
  else {
    st.map.setView([20, 0], 2);
    toast('No GPS fix yet: drag the map to where you want to play');
  }
  st.circle.setLatLng(st.map.getCenter());
  renderZone();
});

act('zone-radius', (el) => setRadius(Number(el.dataset.v)));

act('zone-here', () => {
  const fix = app.geo.fix;
  if (!fix) return toast('Waiting for a GPS fix');
  frame(fix);
});

act('zone-done', () => {
  const c = st.map.getCenter();
  app.session.send({ k: 'cfg', rule: 'zoneRadiusM', value: st.r, zone: { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) } });
  setLayer(null);
});

act('zone-reset', () => app.session.send({ k: 'cfg', zone: null }));

onRender(renderZone);
