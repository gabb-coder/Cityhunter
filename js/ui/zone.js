// Play zone: the preview card in the lobby and the host's map editor.
//
// Three tools in the editor:
//   Circle       the zone circle stays in the middle of the screen and the
//                host drags the map underneath it, then picks a radius
//   Draw shape   tap the map to put down corners: for a park that is not round
//   No-go areas  tap out areas nobody should enter (a road, a building site);
//                they are marked on everyone's map during the match
//
// Until a zone is set, it is a circle centred on wherever the host is
// standing when the hunt starts.

/* global L */
import { $, setHTML, metres } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, RULE_OPTIONS } from '../config.js';
import { app, snap } from '../state.js';
import { staticMap, makeTileLayer, tileConfig } from '../map.js';
import { polyArea, polyRadius, selfCrossing } from '../geom.js';
import { theme } from '../theme.js';
import { act, onRender, setLayer, toast } from './core.js';

const Z = CONFIG.zone;
const root = $('#s-zone');
const st = {
  map: null, tiles: null, circle: null, drawn: [],
  r: 0, centre: null,
  tool: 'circle',      // which tab is open: circle | draw | nogo
  kind: 'circle',      // what the zone will be: circle | shape
  poly: [],            // corners of the drawn zone
  nogo: []             // no-go areas; the last one is the one being drawn
};

// Round so GPS jitter does not reload the preview every second.
const snapPoint = (p) => ({ lat: Math.round(p.lat * 5000) / 5000, lng: Math.round(p.lng * 5000) / 5000 });
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function areaText(m2) {
  if (m2 >= 10000) return (m2 / 10000).toFixed(m2 >= 100000 ? 0 : 1) + ' ha';
  return Math.round(m2 / 100) * 100 + ' m²';
}

// ---- lobby card ----
export function zoneCard(s, host) {
  const shape = s.zoneShape;
  const picked = s.zoneCenter;
  const fix = app.geo.fix;
  const center = picked || (host && fix ? snapPoint(fix) : null);
  const nogo = s.nogo || [];
  const where = shape ? 'Drawn on the map by the host'
    : picked ? 'Placed on the map by the host'
    : host ? 'Centred on you when the hunt starts' : 'Centred on the host when the hunt starts';
  const size = shape ? 'Drawn shape · ' + areaText(polyArea(shape)) : metres(s.rules.zoneRadiusM) + ' radius';
  return '<section class="block"><h2 class="label">Play zone</h2><div class="card zone-card">' +
    (center ? staticMap(center, shape ? polyRadius(center, shape) : s.rules.zoneRadiusM, 150, { poly: shape, nogo })
      : '<div class="smap empty"><span class="muted">' + (host ? 'Waiting for your GPS fix…' : 'The host has not placed the zone yet') + '</span></div>') +
    '<div class="zone-foot"><span class="zone-text"><strong>' + size + '</strong><span class="small muted">' + where + '</span>' +
      (nogo.length ? '<span class="small hunter-ink zone-nogo-n">' + (nogo.length === 1 ? '1 no-go area marked' : nogo.length + ' no-go areas marked') + '</span>' : '') + '</span>' +
      (host
        ? (picked || nogo.length ? '<button type="button" class="btn btn-sm btn-quiet" data-act="zone-reset">Reset</button>' : '') +
          '<button type="button" class="btn btn-sm" data-act="zone-edit">' + icon('pin', 18) + 'Set on map</button>'
        : '') +
    '</div></div></section>';
}

// ---- editor ----
function build() {
  root.innerHTML =
    '<header class="topbar">' +
      '<button type="button" class="icon-btn sm" data-act="layer-close" aria-label="Back to lobby">' + icon('chevLeft', 22, 2.5) + '</button>' +
      '<h1>PLAY ZONE</h1>' +
      '<span class="chip chip-line mono" id="zone-r"></span>' +
    '</header>' +
    '<div class="zone-map-wrap"><div id="zone-map" aria-label="Map for placing the play zone"></div>' +
      '<span class="zone-cross" id="zone-cross" aria-hidden="true"></span>' +
      '<p class="zone-hint" id="zone-hint" role="status"></p></div>' +
    '<footer class="foot-bar pad-b">' +
      '<div class="tabs zone-tabs" role="group" aria-label="Zone tool" id="zone-tabs"></div>' +
      '<div id="zone-tools"></div>' +
      '<div class="row2"><button type="button" class="btn" data-act="zone-here">' + icon('recenter', 20) + 'My location</button>' +
        '<button type="button" class="btn btn-lime head zone-done" data-act="zone-done">SET ZONE</button></div>' +
    '</footer>';
  st.map = L.map($('#zone-map'), { zoomControl: false, zoomSnap: 0.25, minZoom: 3, maxZoom: 20, attributionControl: false });
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(st.map);
  // Circle tool: the circle rides in the middle of the screen.
  st.map.on('move', () => {
    if (st.tool !== 'circle' || !st.circle) return;
    st.centre = st.map.getCenter();
    st.circle.setLatLng(st.centre);
  });
  st.map.on('click', (e) => addCorner(e.latlng));
  applyTiles();
}

function applyTiles() {
  if (!st.map) return;
  if (st.tiles) st.tiles.remove();
  st.tiles = makeTileLayer().addTo(st.map);
  st.map.getPane('tilePane').style.filter = tileConfig().filter || '';
  if (st.circle) st.circle.setStyle({ color: cssVar('--zone-edge') });
  draw();
}
theme.on('change', applyTiles);

function frame(center) {
  st.map.fitBounds(L.latLng(center.lat, center.lng).toBounds(st.r * 2.6), { animate: false });
}

function addCorner(ll) {
  const p = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)];
  if (st.tool === 'draw') {
    if (st.poly.length >= Z.maxCorners) return toast('A shape can have up to ' + Z.maxCorners + ' corners');
    st.poly.push(p);
    st.kind = 'shape';
  } else if (st.tool === 'nogo') {
    if (!st.nogo.length) st.nogo.push([]);
    const cur = st.nogo[st.nogo.length - 1];
    if (cur.length >= Z.maxCorners) return toast('A shape can have up to ' + Z.maxCorners + ' corners');
    cur.push(p);
  } else return;
  draw();
  renderZone();
}

// Redraw the shapes on the editor map.
function draw() {
  if (!st.map) return;
  st.drawn.forEach((l) => l.remove());
  st.drawn = [];
  const add = (l) => st.drawn.push(l.addTo(st.map));
  const edge = cssVar('--zone-edge'), hunter = cssVar('--hunter'), ringCol = cssVar('--dot-ring');
  const shape = (pts, col, active, fill) => {
    if (pts.length >= 3) add(L.polygon(pts, { color: col, weight: 3, dashArray: '10 8', fillColor: col, fillOpacity: fill, interactive: false }));
    else if (pts.length === 2) add(L.polyline(pts, { color: col, weight: 3, dashArray: '10 8', interactive: false }));
    if (active) for (const p of pts) add(L.circleMarker(p, { radius: 7, color: ringCol, weight: 3, fillColor: col, fillOpacity: 1, interactive: false }));
  };
  if (st.circle) {
    if (st.kind === 'circle') st.circle.addTo(st.map);
    else st.circle.remove();
  }
  if (st.kind === 'shape') shape(st.poly, edge, st.tool === 'draw', 0.08);
  st.nogo.forEach((a, i) => shape(a, hunter, st.tool === 'nogo' && i === st.nogo.length - 1, 0.25));
}

function setTool(tool) {
  st.tool = tool;
  if (tool === 'circle') {
    st.kind = 'circle';
    // Put the circle back under the middle of the screen.
    st.centre = st.map.getCenter();
    if (st.circle) st.circle.setLatLng(st.centre);
  } else if (tool === 'draw' && st.poly.length) {
    st.kind = 'shape';
  }
  draw();
  renderZone();
}

function setRadius(r) {
  st.r = r;
  const c = st.map.getCenter();
  st.circle.setRadius(r);
  frame({ lat: c.lat, lng: c.lng });
  renderZone();
}

const usableNogo = () => st.nogo.filter((a) => a.length >= 3);

function renderZone() {
  if (app.ui.layer !== 'zone' || !st.map) return;
  const tab = (id, label) => '<button type="button" class="tab all" data-act="zone-tool" data-tool="' + id + '" aria-pressed="' + (st.tool === id) + '">' + label + '</button>';
  setHTML($('#zone-tabs'), tab('circle', 'Circle') + tab('draw', 'Draw shape') + tab('nogo', 'No-go areas'));
  $('#zone-cross').hidden = st.tool !== 'circle';

  const area = st.poly.length >= 3 ? polyArea(st.poly) : 0;
  $('#zone-r').textContent = st.kind === 'shape' ? (area ? areaText(area) : '—') : metres(st.r);

  let hint, tools;
  if (st.tool === 'circle') {
    hint = 'Drag the map. The dashed circle is the play zone.';
    tools = '<div class="zone-radii" role="group" aria-label="Zone radius">' + RULE_OPTIONS.zoneRadiusM.map((v) =>
      '<button type="button" class="opt" data-act="zone-radius" data-v="' + v + '" aria-pressed="' + (v === st.r) + '">' + metres(v) + '</button>').join('') + '</div>';
  } else if (st.tool === 'draw') {
    hint = st.poly.length < 3 ? 'Tap the map to put down the corners of the play zone. At least 3.' : 'Tap to add another corner, or set the zone.';
    tools = '<div class="zone-edit-row">' +
      '<button type="button" class="btn btn-sm" data-act="zone-undo"' + (st.poly.length ? '' : ' disabled') + '>Undo corner</button>' +
      '<button type="button" class="btn btn-sm btn-quiet" data-act="zone-clear"' + (st.poly.length ? '' : ' disabled') + '>Clear shape</button></div>';
  } else {
    const cur = st.nogo[st.nogo.length - 1] || [];
    const done = usableNogo().length;
    hint = !cur.length ? 'Tap the map around an area nobody should enter: a road, a building site.'
      : cur.length < 3 ? 'Keep tapping: an area needs at least 3 corners.' : 'Tap to add a corner, or start another area.';
    tools = '<div class="zone-edit-row">' +
      '<button type="button" class="btn btn-sm" data-act="zone-undo"' + (cur.length ? '' : ' disabled') + '>Undo corner</button>' +
      '<button type="button" class="btn btn-sm" data-act="zone-nogo-new"' + (cur.length >= 3 && st.nogo.length < Z.maxNoGo ? '' : ' disabled') + '>Another area</button>' +
      '<button type="button" class="btn btn-sm btn-quiet" data-act="zone-clear"' + (st.nogo.some((a) => a.length) ? '' : ' disabled') + '>Clear all</button></div>' +
      '<p class="small muted zone-count">' + (done === 1 ? '1 no-go area' : done + ' no-go areas') + ' · shown on everyone’s map</p>';
  }
  $('#zone-hint').textContent = hint;
  setHTML($('#zone-tools'), tools);
}

act('zone-edit', () => {
  const s = snap();
  if (!s || !s.me.host) return;
  setLayer('zone');
  if (!st.map) build();
  st.r = s.rules.zoneRadiusM;
  st.poly = (s.zoneShape || []).map((p) => p.slice());
  st.nogo = (s.nogo || []).map((a) => a.map((p) => p.slice()));
  st.kind = st.poly.length ? 'shape' : 'circle';
  st.tool = st.poly.length ? 'draw' : 'circle';
  const fix = app.geo.fix;
  const center = s.zoneCenter || (fix ? { lat: fix.lat, lng: fix.lng } : null);
  st.map.invalidateSize();
  if (!st.circle) {
    const edge = cssVar('--zone-edge');
    st.circle = L.circle([0, 0], { radius: st.r, color: edge, weight: 3, dashArray: '10 8', fillColor: edge, fillOpacity: 0.08, interactive: false });
  }
  st.circle.setRadius(st.r);
  if (st.poly.length) st.map.fitBounds(L.polygon(st.poly).getBounds().pad(0.3), { animate: false });
  else if (center) frame(center);
  else {
    st.map.setView([20, 0], 2);
    toast('No GPS fix yet: drag the map to where you want to play');
  }
  st.centre = st.map.getCenter();
  st.circle.setLatLng(st.centre);
  draw();
  renderZone();
});

act('zone-tool', (el) => setTool(el.dataset.tool));
act('zone-radius', (el) => setRadius(Number(el.dataset.v)));

act('zone-undo', () => {
  if (st.tool === 'draw') st.poly.pop();
  else if (st.tool === 'nogo' && st.nogo.length) {
    const cur = st.nogo[st.nogo.length - 1];
    cur.pop();
    if (!cur.length && st.nogo.length > 1) st.nogo.pop();
  }
  draw();
  renderZone();
});
act('zone-clear', () => {
  if (st.tool === 'draw') st.poly = [];
  else if (st.tool === 'nogo') st.nogo = [];
  draw();
  renderZone();
});
act('zone-nogo-new', () => {
  st.nogo = usableNogo();
  if (st.nogo.length < Z.maxNoGo) st.nogo.push([]);
  renderZone();
});

act('zone-here', () => {
  const fix = app.geo.fix;
  if (!fix) return toast('Waiting for a GPS fix');
  frame(fix);
});

act('zone-done', () => {
  const nogo = usableNogo();
  if (st.kind === 'shape') {
    if (st.poly.length < 3) return toast('Put down at least 3 corners, or switch to Circle');
    if (selfCrossing(st.poly)) return toast('The sides of the shape cross. Undo a corner and try again.', 'hunter');
    if (polyArea(st.poly) < Z.minAreaM2) return toast('That shape is too small to play in', 'hunter');
    app.session.send({ k: 'cfg', shape: st.poly, nogo });
  } else {
    const c = st.centre || st.map.getCenter();
    app.session.send({ k: 'cfg', rule: 'zoneRadiusM', value: st.r, zone: { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) }, shape: null, nogo });
  }
  setLayer(null);
});

act('zone-reset', () => app.session.send({ k: 'cfg', zone: null }));

app.zoneEditor = st;   // for tests
onRender(renderZone);
