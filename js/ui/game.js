// Screens 4 and 6: the live map for prey and hunters.
// One Leaflet map; the HUD, banners and bottom sheet change with your role.

import { $, esc, setHTML, setText, clock, ago, metres, dist, buzz, plural } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, ECONOMY, ABILITIES, HUNTER_QUICK_ABILITY } from '../config.js';
import { app, snap } from '../state.js';
import { MapView } from '../map.js';
import { act, onRender, onTick, screen, render, setLayer, toast, themeButton, roleChip } from './core.js';

const P = CONFIG.ping;

// Other modules add map items / banners / HUD state through these hooks.
export const mapItemHooks = [];
export const bannerHooks = [];

// ---------------------------------------------------------------- map
function ensureMap() {
  if (!app.map) {
    app.map = new MapView($('#map'));
    if (app.sim) app.map.map.on('click', (e) => app.geo.simulate(e.latlng.lat, e.latlng.lng));
  }
  return app.map;
}

app.bus.on('screen', (name) => {
  if (name !== 'game') {
    $('#toasts').style.top = '';
    return;
  }
  const map = ensureMap();
  map.resize();
  map.framed = false;
  map.zoneKey = '';
  map.follow = true;
  renderGame();
  // First view: the whole zone. Then follow the player.
  const fix = app.geo.fix;
  if (fix) setTimeout(() => map.centerOn(fix, false, CONFIG.map.zoom), 50);
});
app.bus.on('cleanup', () => {
  if (app.map) { app.map.framed = false; app.map.setItems([]); app.map.setMe(null); app.map.setZone(null); }
});

// Circle radius for a ping seen by the other side.
function pingRadiusNow(pg, T) {
  if (pg.kind !== 'prey') return pg.r;
  const age = Math.max(0, (T - pg.t) / 1000);
  return Math.min(pg.r + age * P.growMps, pg.lost ? P.lostMaxRadiusM : P.maxRadiusM);
}

function updateMap() {
  const s = snap();
  const map = app.map;
  if (!map || !s || screen() !== 'game') return;
  const T = app.session.T();
  const fix = app.geo.fix;
  const me = s.me;

  map.pad.top = ($('#hud').offsetHeight || 100) + 24;
  map.pad.bottom = ($('#sheet').offsetHeight || 300) + 8;
  // Map buttons sit above the sheet, and above any alert card docked on it.
  let lift = 0;
  for (const el of document.querySelectorAll('#oz:not([hidden]) .oz-bottom, #gps-sheet.min:not([hidden])')) lift += el.offsetHeight + 12;
  $('#map-btns').style.bottom = map.pad.bottom + 12 + lift + 'px';
  const hud = $('#hud');
  // Banners and toasts go under whichever top card is showing.
  const ozTop = document.querySelector('#oz:not([hidden]) .oz-top');
  const below = (ozTop ? ozTop.offsetTop + ozTop.offsetHeight : hud.offsetTop + hud.offsetHeight) + 8;
  $('#banners').style.top = below + 'px';
  // Toasts drop in under the HUD and banners instead of covering them.
  $('#toasts').style.top = app.ui.layer ? '' : below + $('#banners').offsetHeight + ($('#banners').offsetHeight ? 8 : 0) + 'px';
  $('#s-game').style.setProperty('--sheet-h', map.pad.bottom + 'px');

  map.setZone(s.zone);
  if (fix) map.setMe({ lat: fix.lat, lng: fix.lng, acc: fix.acc, hdg: fix.hdg, role: me.role, ghost: !!me.fx.ghost, stale: app.geo.lost });

  const items = [];
  for (const pg of s.pings) {
    const age = T - pg.t;
    const tracked = pg.hdg != null;
    items.push({
      id: 'p' + pg.id, type: 'ping', tone: pg.kind, lat: pg.lat, lng: pg.lng, r: pingRadiusNow(pg, T),
      label: pg.name + ' · ' + (pg.lost ? 'NO GPS · ' : '') + ago(age), strong: tracked || age < 15000, hdg: tracked ? pg.hdg : null
    });
  }
  for (const l of s.live) {
    items.push({
      id: 'l' + l.id, type: 'dot', tone: l.kind === 'mate' ? 'hunter' : 'prey', lat: l.lat, lng: l.lng,
      label: l.name + ' · ' + (l.kind === 'revealed' ? 'LIVE · out of zone' : l.stale ? 'last seen' : 'live'), strong: l.kind === 'revealed'
    });
  }
  const fx = me.fx || {};
  if (fx.safe) {
    items.push({ id: 'safe', type: 'area', tone: 'lime', lat: fx.safe.lat, lng: fx.safe.lng, r: fx.safe.r, label: 'SAFE HOUSE · ' + clock((fx.safe.untilT - T) / 1000) });
  }
  for (const d of fx.decoys || []) items.push({ id: 'dc' + d.id, type: 'tag', tone: 'lime', lat: d.lat, lng: d.lng, label: 'DECOY · ' + plural(d.left, 'ping') + ' left' });
  if (fx.ghost && fix) items.push({ id: 'ghost', type: 'tag', tone: 'lime', lat: fix.lat, lng: fix.lng, label: 'GHOST · skips next ping', below: true });
  for (const fn of mapItemHooks) fn(items, s, T);
  map.setItems(items);
}

// ---------------------------------------------------------------- HUD
function gpsChip() {
  const g = app.geo;
  if (g.lost || !g.fix) return '<span class="chip chip-sm chip-warn" id="hud-gps">' + icon('noGps', 16, 2.25) + 'NO GPS</span>';
  if (g.status === 'weak') return '<span class="chip chip-sm chip-warn" id="hud-gps">' + icon('warn', 14, 2.5) + 'WEAK GPS ±' + g.fix.acc + ' m</span>';
  return '<span class="mono hud-gps" id="hud-gps">GPS ±' + g.fix.acc + ' m</span>';
}

function renderHud(s) {
  const hunter = s.me.role === 'hunter';
  const c = s.counts;
  const counts = hunter ? plural(c.prey, 'prey', 'prey') + ' left' : plural(c.prey, 'prey', 'prey') + ' · ' + plural(c.hunters, 'hunter');
  setHTML($('#hud'),
    '<div class="hud card-strong role-' + s.me.role + '">' +
      '<div class="hud-top">' + roleChip(s.me.role) +
        '<span class="hud-clock"><span class="mono" role="timer" aria-live="off" id="hud-clock">00:00</span><span class="hud-left" id="hud-left">left</span></span>' +
        '<span class="hud-side"><span class="hud-counts">' + counts + '</span>' + gpsChip() + '</span>' +
      '</div>' +
      '<div class="hud-ping"><span class="label" id="hud-ping-label">' + (hunter ? 'Next prey ping' : 'Next ping') + '</span>' +
        '<div class="bar"><i id="hud-bar"></i></div><span class="mono" id="hud-ping">00:00</span></div>' +
    '</div>');
}

function tickHud() {
  const s = snap();
  if (screen() !== 'game' || !s) return;
  const T = app.session.T();
  const head = s.phase === 'headstart';
  setText($('#hud-clock'), clock(((head ? s.headT : s.endT) - T) / 1000));
  setText($('#hud-left'), s.paused ? 'paused' : head ? 'head start' : 'left');
  const total = s.rules.pingSec;
  const left = Math.max(0, (s.nextPingT - T) / 1000);
  setText($('#hud-ping'), clock(left));
  const bar = $('#hud-bar');
  if (bar) {
    bar.style.width = Math.min(100, (left / total) * 100).toFixed(1) + '%';
    const urgent = s.me.role === 'prey' && left <= P.urgentSec && !head;
    bar.classList.toggle('urgent', urgent);
    $('#hud-ping').classList.toggle('urgent', urgent);
  }
  updateMap();
  tickSheet(s, T);
}

// ---------------------------------------------------------------- banners
function proximity(s) {
  const fix = app.geo.fix;
  if (s.me.role !== 'prey' || !fix) return null;
  let best = null;
  for (const pg of s.pings) {
    if (pg.kind !== 'hunter') continue;
    const d = dist(fix, pg);
    if (d <= P.proximityAlertM && (!best || d < best.d)) best = { d, name: pg.name };
  }
  return best;
}

let lastProx = '';
function renderBanners(s) {
  const out = [];
  const T = app.session.T();
  if (s.paused) {
    out.push('<div class="banner neutral" role="status">' + icon('pause', 20, 2.5) + '<span>' +
      (s.pauseReason === 'isolated' ? 'Paused: waiting for players to reconnect' : 'Match paused by the host') + '</span></div>');
  }
  for (const fn of bannerHooks) fn(out, s, T);
  if (s.phase === 'headstart' && s.me.role === 'hunter') {
    out.push('<div class="banner hunter" role="status">' + icon('lock', 20, 2.5) + '<span>Hold your position until the head start ends</span></div>');
  }
  const prox = proximity(s);
  if (prox) {
    out.push('<div class="banner hunter" role="status">' + icon('warn', 20, 2.5) + '<span>' + esc(prox.name) + '’s last ping was ' + metres(Math.round(prox.d / 10) * 10) + ' from you</span></div>');
    if (lastProx !== prox.name) buzz(200);
  }
  lastProx = prox ? prox.name : '';
  if (app.ui.talking) out.push('<div class="banner neutral" role="status">' + icon('mic', 20) + '<span>' + esc(app.ui.talking) + ' is talking</span></div>');
  setHTML($('#banners'), out.slice(0, 3).join(''));
}

// ---------------------------------------------------------------- sheet
function slotState(a, me, T) {
  const fx = me.fx || {};
  if (a.id === 'ghost' && fx.ghost) return { on: true, sub: 'Active · tap to cancel' };
  if (a.id === 'jammer' && fx.jamT) return { on: true, sub: 'Active · ' + clock((fx.jamT - T) / 1000), live: 'jamT' };
  if (a.id === 'safehouse' && fx.safe) return { on: true, sub: 'Active · ' + clock((fx.safe.untilT - T) / 1000), live: 'safe' };
  if (a.id === 'decoy' && fx.decoys && fx.decoys.length) return { on: true, sub: plural(fx.decoys.length, 'decoy') + ' out' };
  if (a.id === 'radar' && fx.radarT) return { on: true, sub: 'Active · ' + clock((fx.radarT - T) / 1000), live: 'radarT' };
  if (a.id === 'tracker' && fx.tracker) return { on: true, sub: 'On ' + fx.tracker.name };
  return { on: false, sub: a.hint };
}

function slot(a, me, T, compact) {
  const n = me.inv[a.id] || 0;
  const st = slotState(a, me, T);
  const canTap = n > 0 || (a.id === 'ghost' && st.on);
  return '<button type="button" class="slot' + (compact ? ' compact' : '') + '" data-act="use" data-id="' + a.id + '" aria-pressed="' + st.on + '"' + (canTap ? '' : ' disabled') +
    ' aria-label="' + esc(a.name) + ', ' + n + ' owned. ' + esc(st.sub) + '">' +
    '<span class="slot-top"><span class="' + a.side + '-ink">' + icon(a.icon, 24) + '</span><span class="mono slot-n">×' + n + '</span></span>' +
    '<span class="slot-text"><span class="slot-name">' + esc(a.name) + '</span><span class="slot-sub" data-live="' + (st.live || '') + '">' + esc(st.sub) + '</span></span>' +
  '</button>';
}

function chatBtn(label, cls) {
  const n = app.session.unread.team + app.session.unread.all;
  return '<button type="button" class="' + cls + '" data-act="chat">' + icon('chat', cls === 'tile' ? 22 : 20) +
    '<span>' + label + '</span>' + (n ? '<span class="badge" aria-label="' + n + ' unread">' + n + '</span>' : '') + '</button>';
}

function wallet(me, note) {
  return '<div class="wallet"><span class="lime-ink">' + icon('coin', 28) + '</span>' +
    '<span class="wallet-main"><span class="mono gc lime-ink">' + me.gc + ' <small>GC</small></span><span class="wallet-note">' + note + '</span></span>' +
    '<button type="button" class="btn btn-sm shop-btn" data-act="shop">Shop</button></div>';
}

function nearestPrey(s) {
  const fix = app.geo.fix;
  if (!fix) return null;
  let best = null;
  for (const pg of s.pings) {
    if (pg.kind !== 'prey') continue;
    const d = dist(fix, pg);
    if (!best || d < best.d) best = { d, name: pg.name };
  }
  return best;
}

function catchSub(s) {
  if (s.phase === 'headstart') return 'Locked until the head start ends';
  const t = (s.targets || []).filter((x) => x.inRange).sort((a, b) => a.d - b.d)[0];
  if (t) return t.name + ' is ' + metres(t.d) + ' away · in range';
  const n = nearestPrey(s);
  if (n) return 'Nearest: ' + n.name + ', last seen ' + metres(n.d) + ' away';
  return 'No prey pinged yet';
}

function renderSheet(s) {
  const me = s.me;
  const T = app.session.T();
  const min = app.ui.sheetMin;
  const handle = '<button type="button" class="sheet-handle" data-act="sheet-toggle" aria-expanded="' + !min + '" aria-label="' + (min ? 'Expand panel' : 'Collapse panel') + '"><span></span></button>';
  let html;
  if (me.role === 'prey') {
    const owned = Object.values(ABILITIES).filter((a) => a.side === 'prey' && ((me.inv[a.id] || 0) > 0 || slotState(a, me, T).on));
    const slots = owned.map((a) => slot(a, me, T)).join('') +
      (owned.length < 3 ? '<button type="button" class="slot add" data-act="shop" aria-label="Add an ability from the shop">' + icon('plus', 24, 2.5) + '<span>Add slot</span></button>' : '');
    html = handle +
      (min ? '' : wallet(me, '+' + ECONOMY.perPingSurvived + ' for every ping you survive') +
        '<div class="slots' + (owned.length > 3 ? ' many' : '') + '">' + slots + '</div>') +
      '<div class="row2">' + chatBtn('Prey chat', 'btn') +
        '<button type="button" class="btn btn-hunter-line" data-act="self-tag">I’ve been caught</button></div>';
  } else {
    const q = ABILITIES[HUNTER_QUICK_ABILITY];
    const qn = me.inv[q.id] || 0;
    const locked = s.phase !== 'live';
    const quickLabel = qn > 0 ? q.name + ' ×' + qn : me.gc >= q.cost ? q.name + ' · ' + q.cost : q.name + ' · need ' + (q.cost - me.gc);
    const extra = Object.values(ABILITIES).filter((a) => a.side === 'hunter' && a.id !== q.id && ((me.inv[a.id] || 0) > 0 || slotState(a, me, T).on));
    html = handle +
      (min ? '' : wallet(me, '+' + ECONOMY.perCatch + ' for every catch')) +
      '<button type="button" class="catch-btn" data-act="catch-open"' + (locked ? ' disabled' : '') + '>' + icon('target', 34, 2.5) +
        '<span class="catch-text"><span class="head">CATCH</span><span class="catch-sub" id="catch-sub">' + esc(catchSub(s)) + '</span></span></button>' +
      (min || !extra.length ? '' : '<div class="slots compact-row' + (extra.length > 3 ? ' many' : '') + '">' + extra.map((a) => slot(a, me, T, true)).join('') + '</div>') +
      '<div class="row3">' +
        '<button type="button" class="tile quick" data-act="quick"' + (locked || (qn === 0 && me.gc < q.cost) ? ' disabled' : '') + '><span class="hunter-ink">' + icon(q.icon, 22) + '</span><span>' + esc(quickLabel) + '</span></button>' +
        chatBtn('Hunter chat', 'tile') +
        '<button type="button" class="tile ptt" data-ptt aria-pressed="false" aria-label="Hold to talk to your team">' + icon('mic', 22) + '<span class="ptt-text">Hold to talk</span></button>' +
      '</div>';
  }
  const sheet = $('#sheet');
  sheet.setAttribute('aria-label', me.role === 'prey' ? 'Abilities and actions' : 'Hunter actions');
  sheet.className = 'sheet role-' + me.role;
  setHTML(sheet, html);
}

// Countdown text inside active ability slots (no full re-render needed).
function tickSheet(s, T) {
  const fx = s.me.fx || {};
  for (const el of document.querySelectorAll('#sheet [data-live]')) {
    const k = el.dataset.live;
    if (!k) continue;
    const until = k === 'safe' ? fx.safe && fx.safe.untilT : fx[k];
    if (until) setText(el, 'Active · ' + clock((until - T) / 1000));
  }
}

function mapButtons(s) {
  setHTML($('#map-btns'),
    (s.me.host ? '<button type="button" class="icon-btn" data-act="admin" aria-label="Host console">' + icon('gear', 22) + '</button>' : '') +
    themeButton() +
    '<button type="button" class="icon-btn" data-act="recenter" aria-label="Recenter map on me">' + icon('recenter', 22) + '</button>');
}

function renderGame() {
  const s = snap();
  if (screen() !== 'game' || !s || !s.me) return;
  $('#s-game').className = 'screen screen-map role-' + s.me.role;
  renderHud(s);
  renderBanners(s);
  renderSheet(s);
  mapButtons(s);
  tickHud();
}

// ---------------------------------------------------------------- actions
act('recenter', () => {
  if (!app.geo.fix) return toast('Waiting for a GPS fix');
  app.map.recenter(app.geo.fix);
});
act('sheet-toggle', () => {
  app.ui.sheetMin = !app.ui.sheetMin;
  render();
});
act('shop', () => setLayer('shop'));
act('chat', () => setLayer('chat'));
act('use', (el) => app.session.send({ k: 'use', id: el.dataset.id }));
act('quick', () => {
  const q = ABILITIES[HUNTER_QUICK_ABILITY];
  if (!(snap().me.inv[q.id] > 0)) app.session.send({ k: 'buy', id: q.id });
  app.session.send({ k: 'use', id: q.id });
});

app.bus.on('ev:radar', () => {
  buzz([200, 100, 200, 100, 200]);
  toast('Radar: a prey is within ' + ABILITIES.radar.rangeM + ' m', 'hunter');
});

onRender(renderGame);
onTick(tickHud);
app.geo.on('fix', () => screen() === 'game' && updateMap());
