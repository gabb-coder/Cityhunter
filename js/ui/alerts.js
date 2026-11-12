// GPS signal lost (sheet + growing last-fix circle) and Outside the zone
// (orange border, GET BACK IN countdown, direction to the nearest edge).

import { $, esc, setHTML, setText, clock, dist, bearing, compass, metres } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { app, snap } from '../state.js';
import { offsetPoint } from '../map.js';
import { act, onRender, onTick, screen, render, openModal } from './core.js';
import { mapItemHooks } from './game.js';

const GC = CONFIG.gps;
const ZC = CONFIG.zone;
const st = { gpsMin: false, gpsTold: false, outLocalT: null, sheetWasMin: null };

const playing = () => screen() === 'game' && app.session && app.session.inMatch;

// ---------------------------------------------------------------- GPS lost
// Seconds of grace left (negative once it has run out).
function graceLeft() {
  return GC.graceSec - Math.max(0, app.geo.silence() - GC.lostAfterSec);
}

function renderGps() {
  const sheet = $('#gps-sheet');
  const lost = playing() && app.geo.lost;
  if (!lost) {
    sheet.hidden = true;
    st.gpsMin = false;
    st.gpsTold = false;
    return;
  }
  sheet.hidden = false;
  const denied = app.geo.status === 'denied' || app.geo.status === 'unsupported';
  const over = graceLeft() <= 0;
  sheet.className = st.gpsMin ? 'gps-sheet min' : 'gps-sheet';

  if (st.gpsMin) {
    setHTML(sheet,
      '<button type="button" class="gps-bar" data-act="gps-min" aria-label="Show GPS help">' +
        '<span class="gps-ico">' + icon('noGps', 22, 2.5) + '</span>' +
        '<span class="gps-bar-text"><strong>GPS SIGNAL LOST</strong><span>Grace <span class="mono" data-grace></span></span></span>' +
        '<span class="gps-show">Show</span></button>');
    return;
  }

  setHTML(sheet,
    '<div class="gps-head"><span class="gps-ico big">' + icon('noGps', 28, 2.5) + '</span>' +
      '<h1 class="head" id="gps-title">' + (denied ? 'LOCATION IS OFF' : 'GPS SIGNAL LOST') + '</h1></div>' +
    '<p id="gps-body">' + (denied
      ? 'City Hunter cannot read your location. Turn it on for this site, then tap Retry.'
      : 'Hunters still see your last fix. Get back under open sky: away from tall buildings, tunnels and covered walkways.') + '</p>' +
    '<div class="grace' + (over ? ' over' : '') + '">' +
      '<div class="grace-top"><span class="label">Grace period</span><span class="mono grace-clock" data-grace></span></div>' +
      '<div class="bar"><i id="grace-bar"></i></div>' +
      '<span class="small muted">' + (over
        ? 'The grace period is over. The host has been told and your circle on the other side’s map is growing.'
        : 'If no new fix arrives before this runs out, the host is told and your circle on hunters’ maps starts growing.') + '</span>' +
    '</div>' +
    '<div class="gps-btns"><button type="button" class="btn btn-line" data-act="gps-settings">Location settings</button>' +
      '<button type="button" class="btn btn-lime" data-act="gps-retry">Retry GPS</button></div>' +
    '<button type="button" class="btn btn-quiet gps-hide" data-act="gps-min">Hide and keep playing</button>');
}

function tickGps() {
  if (!playing() || !app.geo.lost) return;
  const left = graceLeft();
  for (const el of document.querySelectorAll('#gps-sheet [data-grace]')) setText(el, clock(left));
  const bar = $('#grace-bar');
  if (bar) bar.style.width = Math.max(0, Math.min(100, (left / GC.graceSec) * 100)).toFixed(1) + '%';
  // Grace ran out: notify the host once.
  if (left <= 0 && !st.gpsTold) {
    st.gpsTold = app.session.send({ k: 'gps', graceOut: true });
    render();
  }
}

act('gps-min', () => {
  st.gpsMin = !st.gpsMin;
  render();
});
act('gps-retry', () => {
  const g = app.geo;
  if (g.simulated) return;
  g.stop();
  g.start();
});
act('gps-settings', () => openModal(
  '<h2>Turn location on</h2>' +
  '<ol class="steps-list">' +
    '<li><strong>iPhone:</strong> Settings → Privacy &amp; Security → Location Services → on. Then Safari Websites (or your browser) → While Using, with Precise Location on.</li>' +
    '<li><strong>Android:</strong> Settings → Location → on. Then tap the lock icon in the address bar → Permissions → Location → Allow.</li>' +
    '<li>Battery saver and low-power modes can switch GPS off. Turn them off while you play.</li>' +
  '</ol>' +
  '<button type="button" class="btn btn-lime" data-act="modal-close">Got it</button>'));

// My own last fix, as a circle that keeps growing while there is no signal.
mapItemHooks.push((items, s) => {
  const fix = app.geo.fix;
  if (!app.geo.lost || !fix) return;
  const quiet = app.geo.silence();
  const cap = graceLeft() <= 0 ? CONFIG.ping.lostMaxRadiusM : CONFIG.ping.maxRadiusM;
  items.push({
    id: 'lostfix', type: 'area', tone: s.me.role, lat: fix.lat, lng: fix.lng,
    r: Math.min(Math.max(CONFIG.ping.baseRadiusM, fix.acc) + quiet * CONFIG.ping.growMps, cap),
    label: 'Last fix · ' + clock(quiet) + ' ago'
  });
});

// ---------------------------------------------------------------- out of zone
function zoneState(s) {
  const fix = app.geo.fix;
  const z = s.zone;
  if (!z || !fix || app.geo.lost) return s.me.out && s.me.out.sinceT != null ? { out: true, d: null } : { out: false };
  const d = dist(fix, z);
  return { out: d > z.r, d: d - z.r, brg: bearing(fix, z), edge: offsetPoint(z, z.r, bearing(z, fix)) };
}

function walkTime(m) {
  const sec = m / ZC.walkSpeedMps;
  if (sec < 90) return 'about ' + Math.max(5, Math.round(sec / 5) * 5) + ' s walking';
  return 'about ' + Math.round(sec / 60) + ' min walking';
}

function renderZone() {
  const s = snap();
  const box = $('#oz');
  const border = $('#zone-border');
  const zs = playing() && s ? zoneState(s) : { out: false };
  if (!zs.out) {
    box.hidden = true;
    border.hidden = true;
    st.outLocalT = null;
    if (st.sheetWasMin != null) {
      app.ui.sheetMin = st.sheetWasMin;
      st.sheetWasMin = null;
      render();
    }
    return;
  }
  // Keep the map visible: shrink the bottom sheet while the alert is up.
  if (st.sheetWasMin == null) {
    st.sheetWasMin = app.ui.sheetMin;
    app.ui.sheetMin = true;
    render();
  }
  if (st.outLocalT == null) st.outLocalT = app.session.T();
  box.hidden = false;
  border.hidden = false;

  const prey = s.me.role === 'prey';
  const revealed = prey && s.me.out && s.me.out.revealed;
  const top = prey
    ? '<span class="mono oz-kicker">' + (revealed ? 'YOUR LIVE POSITION IS REVEALED' : 'YOU LEFT THE PLAY ZONE') + '</span>' +
      '<div class="oz-row"><h1 class="head">GET BACK IN</h1><span class="mono oz-clock" role="timer" id="oz-clock">' + (revealed ? 'LIVE' : '') + '</span></div>' +
      '<p>' + (revealed
        ? 'Every hunter can see exactly where you are until you’re back inside the zone.'
        : 'When this hits zero, your exact live position is shown to every hunter until you’re back inside.') + '</p>'
    : '<span class="mono oz-kicker">YOU LEFT THE PLAY ZONE</span>' +
      '<div class="oz-row"><h1 class="head">GET BACK IN</h1></div>' +
      '<p>The hunt is inside the dashed line. Prey out here are revealed to you live.</p>';

  const dir = zs.d != null
    ? '<span class="oz-arrow"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(' + Math.round(zs.brg) + 'deg)"><path d="M12 2l7 19-7-4-7 4Z"/></svg></span>' +
      '<span class="oz-dir"><span class="head">Head ' + compass(zs.brg) + '</span><span>' + metres(Math.max(1, zs.d)) + ' to the nearest edge · ' + walkTime(zs.d) + '</span></span>'
    : '<span class="oz-arrow">' + icon('noGps', 30, 2.5) + '</span><span class="oz-dir"><span class="head">No GPS fix</span><span>Head back toward the middle of the zone.</span></span>';

  setHTML(box,
    '<section class="oz-top" role="alert">' + top + '</section>' +
    '<section class="oz-bottom card-strong" aria-label="Way back to the zone">' + dir + '</section>');
  tickZone();
}

function tickZone() {
  const s = snap();
  const el = $('#oz-clock');
  if (!el || !s || !playing()) return;
  if (s.me.out && s.me.out.revealed) return setText(el, 'LIVE');
  const since = s.me.out && s.me.out.sinceT != null ? s.me.out.sinceT : st.outLocalT;
  const left = ZC.outGraceSec - (app.session.T() - since) / 1000;
  const sec = Math.max(0, Math.ceil(left));
  setText(el, Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'));
}

// Label the nearest point of the zone edge on the map.
mapItemHooks.push((items, s) => {
  const zs = zoneState(s);
  if (zs.out && zs.edge) items.push({ id: 'edge', type: 'tag', tone: 'lime', lat: zs.edge.lat, lng: zs.edge.lng, label: 'Zone edge · ' + metres(Math.max(1, zs.d)) });
});

onRender(renderGps);
onRender(renderZone);
onTick(tickGps);
onTick(tickZone);
app.geo.on('status', render);
app.geo.on('fix', () => playing() && renderZone());
