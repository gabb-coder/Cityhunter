// Leaflet wrapper for both map screens.
//
// Colours are read from the CSS custom properties, so the map follows the
// theme tokens instead of duplicating them. Tile layers (one per theme) come
// from CONFIG.map.tiles; attribution is always shown.

/* global L */
import { CONFIG } from './config.js';
import { esc } from './util.js';
import { theme } from './theme.js';

const M_PER_DEG = 111320;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Point `m` metres from `c` on bearing `deg` (fine at city scale).
export function offsetPoint(c, m, deg) {
  const a = (deg * Math.PI) / 180;
  return {
    lat: c.lat + (m * Math.cos(a)) / M_PER_DEG,
    lng: c.lng + (m * Math.sin(a)) / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180))
  };
}

function ring(c, r, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = offsetPoint(c, r, (i / n) * 360);
    pts.push([p.lat, p.lng]);
  }
  return pts;
}

const tagIcon = (text, cls) => L.divIcon({ className: 'map-tag-wrap', html: '<span class="map-tag ' + cls + '">' + esc(text) + '</span>', iconSize: [0, 0] });

export class MapView {
  constructor(el) {
    this.map = L.map(el, { zoomControl: false, zoomSnap: 0.25, minZoom: 3, maxZoom: 20, attributionControl: false, tap: false });
    L.control.attribution({ position: 'bottomleft', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(this.map);
    this.map.setView([0, 0], 2);
    this.tiles = null;
    this.zone = null;
    this.zoneKey = '';
    this.me = null;
    this.items = new Map();     // id -> { key, layers[], circle, tag, label }
    this.follow = true;
    this.framed = false;
    this.pad = { top: 130, bottom: 320 };
    this.map.on('dragstart', () => { this.follow = false; });
    this.applyTheme();
    theme.on('change', () => this.applyTheme());
  }

  applyTheme() {
    const sun = theme.get() === 'sun';
    if (this.tiles) this.tiles.remove();
    const t = CONFIG.map.tiles[sun ? 'sun' : 'dark'];
    this.tiles = L.tileLayer(t.url, { subdomains: t.subdomains || 'abc', maxZoom: 20, maxNativeZoom: t.maxNativeZoom || 19, attribution: t.attribution });
    this.tiles.addTo(this.map);
    this.tiles.bringToBack();
    this.map.getPane('tilePane').style.filter = t.filter || '';
    this.c = {
      sun,
      hunter: cssVar('--hunter'), hunterInk: cssVar('--hunter-ink'),
      prey: cssVar('--prey-dot'), preyInk: cssVar('--prey-ink'),
      lime: cssVar('--lime-ink'), edge: cssVar('--zone-edge'), ring: cssVar('--dot-ring'),
      mask: Number(cssVar('--zone-mask')) || 0.5
    };
    // Rebuild everything in the new colours.
    this.zoneKey = '';
    for (const it of this.items.values()) it.layers.forEach((l) => l.remove());
    this.items.clear();
    if (this.me) { this.me.layers.forEach((l) => l.remove()); this.me = null; }
  }

  resize() {
    this.map.invalidateSize();
  }

  // ---- play zone: everything outside is dimmed, the edge is dashed ----
  setZone(z) {
    const key = z ? [z.lat, z.lng, z.r].join(',') : '';
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    if (this.zone) this.zone.forEach((l) => l.remove());
    this.zone = null;
    if (!z) return;
    const world = [[-89, -360], [89, -360], [89, 360], [-89, 360]];
    const mask = L.polygon([world, ring(z, z.r)], { stroke: false, fillColor: '#0A0C0B', fillOpacity: this.c.mask, interactive: false });
    const edge = L.circle([z.lat, z.lng], { radius: z.r, color: this.c.edge, weight: this.c.sun ? 3 : 2.5, dashArray: '10 8', fill: false, interactive: false });
    this.zone = [mask.addTo(this.map), edge.addTo(this.map)];
    if (!this.framed) this.frame(z);
  }

  frame(z) {
    this.framed = true;
    this.map.fitBounds(L.latLng(z.lat, z.lng).toBounds(z.r * 2.2), { paddingTopLeft: [12, this.pad.top], paddingBottomRight: [12, this.pad.bottom], animate: false });
  }

  // ---- my own marker: accuracy halo + heading ----
  setMe(m) {
    if (!m) {
      if (this.me) { this.me.layers.forEach((l) => l.remove()); this.me = null; }
      return;
    }
    const key = [m.role, m.ghost, m.hdg == null ? 'x' : Math.round(m.hdg / 5), m.stale].join('|');
    const ll = [m.lat, m.lng];
    if (!this.me) {
      const halo = L.circle(ll, { radius: m.acc, stroke: false, fillColor: m.role === 'hunter' ? this.c.hunter : this.c.prey, fillOpacity: 0.18, interactive: false }).addTo(this.map);
      const mark = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(this.map);
      this.me = { halo, mark, layers: [halo, mark], key: '' };
    }
    this.me.halo.setLatLng(ll).setRadius(m.acc);
    this.me.mark.setLatLng(ll);
    if (this.me.key !== key) {
      this.me.key = key;
      this.me.halo.setStyle({ fillColor: m.role === 'hunter' ? this.c.hunter : this.c.prey });
      const rot = m.hdg == null ? 0 : m.hdg;
      const wedge = m.hdg == null ? '' :
        '<svg class="me-wedge" width="72" height="72" viewBox="0 0 72 72" style="transform:rotate(' + rot + 'deg)"><path d="M36 36 L24 6 A32 32 0 0 1 48 6 Z"/></svg>';
      const body = m.role === 'hunter' && m.hdg != null
        ? '<svg class="me-arrow" width="30" height="30" viewBox="0 0 24 24" style="transform:rotate(' + rot + 'deg)"><path d="M12 2l7 19-7-4-7 4Z"/></svg>'
        : wedge + '<span class="me-dot"></span>';
      this.me.mark.setIcon(L.divIcon({
        className: 'me-wrap',
        html: '<div class="me-mark ' + m.role + (m.ghost ? ' ghost' : '') + (m.stale ? ' stale' : '') + '">' + body + '</div>',
        iconSize: [72, 72], iconAnchor: [36, 36]
      }));
    }
    if (this.follow) this.centerOn(m, false);
  }

  // Centre a point in the part of the map that is not covered by UI.
  centerOn(p, animate = true, zoom) {
    const z = zoom || this.map.getZoom();
    const pt = this.map.project([p.lat, p.lng], z).add([0, (this.pad.bottom - this.pad.top) / 2]);
    this.map.setView(this.map.unproject(pt, z), z, { animate });
  }

  recenter(p) {
    this.follow = true;
    if (p) this.centerOn(p, true, Math.max(this.map.getZoom(), CONFIG.map.zoom));
  }

  // ---- everything else, keyed so markers are reused between updates ----
  // item: { id, type:'ping'|'dot'|'area'|'tag', lat, lng, r, tone:'hunter'|'prey'|'lime',
  //         label, strong, hdg }
  setItems(list) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let cur = this.items.get(it.id);
      const key = [it.type, it.tone, it.strong, it.hdg == null ? 'x' : it.hdg].join('|');
      if (cur && cur.key !== key) {
        cur.layers.forEach((l) => l.remove());
        cur = null;
      }
      if (!cur) {
        cur = this.build(it, key);
        this.items.set(it.id, cur);
      }
      const ll = [it.lat, it.lng];
      if (cur.circle) cur.circle.setLatLng(ll).setRadius(it.r);
      if (cur.dot) cur.dot.setLatLng(ll);
      if (cur.arrow) cur.arrow.setLatLng(ll);
      if (cur.tag) {
        // labels sit just below the circle
        const at = it.type === 'dot' || it.type === 'tag' ? it : offsetPoint(it, it.r || 0, 180);
        cur.tag.setLatLng([at.lat, at.lng]);
        if (cur.label !== it.label) {
          cur.label = it.label;
          cur.tag.setIcon(tagIcon(it.label, it.tone + (it.strong ? ' strong' : '') + (it.type === 'dot' ? ' small' : '') + (it.below ? ' low' : '')));
        }
      }
    }
    for (const [id, cur] of this.items) {
      if (!seen.has(id)) {
        cur.layers.forEach((l) => l.remove());
        this.items.delete(id);
      }
    }
  }

  build(it, key) {
    const c = this.c;
    const col = it.tone === 'hunter' ? c.hunter : it.tone === 'lime' ? c.edge : c.prey;
    const line = it.tone === 'hunter' ? c.hunterInk : it.tone === 'lime' ? c.edge : c.preyInk;
    const cur = { key, layers: [], label: null };
    const add = (l) => { cur.layers.push(l.addTo(this.map)); return l; };
    const ll = [it.lat, it.lng];
    if (it.type === 'ping' || it.type === 'area') {
      cur.circle = add(L.circle(ll, {
        radius: it.r, color: line, weight: c.sun ? 2.5 : it.strong ? 2 : 1.5, dashArray: '7 6',
        fillColor: col, fillOpacity: it.type === 'area' ? 0.1 : c.sun ? 0.18 : 0.13, interactive: false
      }));
    }
    if (it.type === 'ping' || it.type === 'dot') {
      cur.dot = add(L.circleMarker(ll, { radius: it.type === 'dot' ? 7 : 6, color: c.ring, weight: 3, fillColor: col, fillOpacity: 1, interactive: false }));
    }
    if (it.hdg != null) {
      cur.arrow = add(L.marker(ll, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'me-wrap', iconSize: [44, 44], iconAnchor: [22, 22],
          html: '<svg class="trk-arrow ' + it.tone + '" width="44" height="44" viewBox="0 0 24 24" style="transform:rotate(' + it.hdg + 'deg)"><path d="M12 1l5 9h-3.4v8h-3.2v-8H7Z"/></svg>' })
      }));
    }
    if (it.label != null) cur.tag = add(L.marker(ll, { interactive: false, keyboard: false, icon: tagIcon('', '') }));
    return cur;
  }
}
