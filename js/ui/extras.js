// v2.2 extras on the map and menus: problem report, battery saver,
// shrinking-zone display, team map pins and the Tracker target picker.

import { $, esc, setHTML, setText, clock, metres, dist, store } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, ABILITIES } from '../config.js';
import { cue } from '../sound.js';
import { buildReport } from '../diag.js';
import { app, snap } from '../state.js';
import { act, onRender, onTick, screen, render, openModal, closeModal, confirmModal, toast } from './core.js';
import { bannerHooks, mapItemHooks, mapButtonHooks } from './game.js';

const playing = () => screen() === 'game' && app.session && app.session.inMatch;

// ---------------------------------------------------------------- problem report
let reportText = '';

act('report', async () => {
  reportText = await buildReport();
  const lines = reportText.split('\n').length;
  openModal(
    '<h2>Problem report</h2>' +
    '<p class="muted">This is a log of what happened on this phone: connection, GPS and errors. It has no positions, PINs or chat. Send it to whoever looks after the game.</p>' +
    '<textarea class="report-text" readonly aria-label="Report text" translate="no" rows="8">' + esc(reportText) + '</textarea>' +
    '<p class="small muted">' + lines + ' lines</p>' +
    (navigator.share ? '<button type="button" class="btn btn-lime" data-act="report-share">' + icon('share', 20) + 'Send report</button>' : '') +
    '<button type="button" class="btn" data-act="report-copy">Copy report</button>' +
    '<button type="button" class="btn btn-quiet" data-act="modal-close">Close</button>');
});

act('report-share', async () => {
  try {
    await navigator.share({ title: 'City Hunter problem report', text: reportText });
  } catch (e) { /* cancelled */ }
});

act('report-copy', async () => {
  try {
    await navigator.clipboard.writeText(reportText);
    toast('Report copied', 'lime', 1800);
  } catch (e) {
    const box = $('.report-text');
    if (box) {
      box.focus();
      box.select();
    }
    toast('Select the text and copy it');
  }
});

export const reportLink = (cls = '') =>
  '<button type="button" class="btn btn-quiet report-link ' + cls + '" data-act="report">' + icon('warn', 18) + 'Report a problem</button>';

// ---------------------------------------------------------------- battery saver
// Redraws the map less often, reports position less often, and blanks the
// screen to a dark clock after a while without a touch. Any alert wakes it.
const SAVER_KEY = 'ch2.saver';
let lastTouch = Date.now();
let dimmed = false;

app.saver = {
  on: store.get(SAVER_KEY, false) === true,
  toggle() {
    this.on = !this.on;
    store.set(SAVER_KEY, this.on);
    lastTouch = Date.now();
    return this.on;
  }
};

const wake = () => {
  lastTouch = Date.now();
  if (dimmed) {
    dimmed = false;
    renderDim();
  }
};
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, wake, { capture: true, passive: true });
const WAKE_CUES = ['near', 'tagged', 'zone', 'gps', 'release', 'converted', 'help', 'radar', 'caught'];
app.bus.on('cue', (name) => WAKE_CUES.includes(name) && wake());

function renderDim() {
  const box = $('#dim');
  const s = snap();
  const show = dimmed && playing() && !app.ui.layer && !!s;
  box.hidden = !show;
  if (!show) return;
  setHTML(box,
    '<span class="chip chip-' + s.me.role + '">' + (s.me.role === 'hunter' ? 'HUNTER' : s.me.role === 'spectator' ? 'WATCHING' : 'PREY') + '</span>' +
    '<span class="mono dim-clock" role="timer" id="dim-clock"></span>' +
    '<span class="dim-ping">Next ping <span class="mono" id="dim-ping"></span></span>' +
    '<span class="dim-hint">' + icon('saver', 18) + 'Battery saver · tap to wake</span>');
  tickDim();
}

function tickDim() {
  const s = snap();
  if (!playing() || !s) {
    if (dimmed) wake();
    return;
  }
  if (app.saver.on && !dimmed && !app.ui.layer && Date.now() - lastTouch > CONFIG.saver.dimAfterSec * 1000) {
    dimmed = true;
    renderDim();
  }
  if (!dimmed) return;
  const T = app.session.T();
  setText($('#dim-clock'), clock(((s.phase === 'headstart' ? s.headT : s.endT) - T) / 1000));
  setText($('#dim-ping'), clock((s.nextPingT - T) / 1000));
}

act('saver', () => {
  const on = app.saver.toggle();
  toast(on ? 'Battery saver on: the screen dims after ' + CONFIG.saver.dimAfterSec + ' s' : 'Battery saver off', on ? 'lime' : '', 2500);
  render();
});

// ---------------------------------------------------------------- shrinking zone
let shrinkCued = null;

bannerHooks.push((out, s, T) => {
  const z = s.zone;
  if (!z || !z.final || s.phase !== 'live') return;
  if (T < z.shrinkStartT) return;
  const key = s.code + ':' + s.round;
  if (shrinkCued !== key) {
    shrinkCued = key;
    // Only at the moment it starts, not for someone who joins later.
    if (T - z.shrinkStartT < 5000) {
      cue('zone');
      toast('The zone has started to close in', 'hunter');
    }
  }
  // The running status is a line in the HUD (js/ui/game.js), not a banner.
});

// Where the zone will end up.
mapItemHooks.push((items, s) => {
  const z = s.zone;
  if (z && z.final && z.r > z.final + 2) items.push({ id: 'final', type: 'area', tone: 'lime', lat: z.lat, lng: z.lng, r: z.final, label: 'Final zone' });
});

// ---------------------------------------------------------------- team map pins
const myPin = (s) => (s.marks || []).find((k) => k.mine);

mapButtonHooks.push((s) => {
  if (s.me.role === 'spectator') return null;
  const has = !!myPin(s);
  const on = !!app.ui.marking;
  return {
    col: 'main',
    html: '<button type="button" class="icon-btn" data-act="pin" aria-pressed="' + (on || has) + '" aria-label="' +
      (has ? 'Remove your team pin' : on ? 'Cancel placing a pin' : 'Drop a pin for your team') + '">' + icon('pin', 22) + '</button>'
  };
});

act('pin', () => {
  const s = snap();
  if (!s || !app.session.inMatch) return;
  if (myPin(s)) {
    app.session.send({ k: 'mark', clear: true });
    toast('Pin removed', '', 1500);
  } else {
    app.ui.marking = !app.ui.marking;
  }
  render();
});

app.bus.on('mapclick', (p) => {
  if (!app.ui.marking || !playing()) return;
  app.ui.marking = false;
  app.session.send({ k: 'mark', lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  toast('Pin dropped for your team', 'lime', 1800);
  render();
});

bannerHooks.push((out) => {
  if (app.ui.marking) out.add(1, '<div class="banner lime" role="status">' + icon('pin', 20) + '<span>Tap the map where your team should look</span></div>');
});

mapItemHooks.push((items, s, T) => {
  for (const k of s.marks || []) {
    items.push({
      id: 'mk' + k.id, type: 'dot', tone: 'lime', lat: k.lat, lng: k.lng, strong: true,
      label: (k.mine ? 'Your pin' : k.name + '’s pin') + ' · ' + clock((k.untilT - T) / 1000)
    });
  }
});

app.bus.on('ev:mark', (e) => {
  cue('msg');
  toast(e.name + ' dropped a pin on the map', 'lime');
});
app.bus.on('cleanup', () => {
  app.ui.marking = false;
});

// ---------------------------------------------------------------- Tracker: choose who to follow
// Called by the ability slot instead of using Tracker straight away.
export function pickTrackerTarget() {
  const s = snap();
  const fix = app.geo.fix;
  // One row per prey. A prey with decoys out has several circles; the
  // nearest one is used for the distance (nobody can tell which is real).
  const seen = new Map();
  for (const pg of s.pings) {
    if (pg.kind !== 'prey') continue;
    const id = pg.pid || pg.id;
    const d = fix ? dist(fix, pg) : null;
    const had = seen.get(id);
    if (!had || (d != null && d < had.d)) seen.set(id, { id, name: pg.name, d });
  }
  const list = Array.from(seen.values()).sort((a, b) => (a.d == null ? 1e9 : a.d) - (b.d == null ? 1e9 : b.d));
  if (!list.length) return toast('No prey has pinged yet');
  openModal(
    '<h2>Track which prey?</h2>' +
    '<p class="muted">' + esc(ABILITIES.tracker.effect) + '</p>' +
    '<div class="pick-list">' + list.map((p) =>
      '<button type="button" class="btn pick" data-act="tracker-pick" data-id="' + esc(p.id) + '">' +
        '<span class="mono" translate="no">' + esc(p.name) + '</span><span class="muted">' + (p.d == null ? '' : 'last seen ' + metres(p.d)) + '</span></button>').join('') +
    '</div><button type="button" class="btn btn-quiet" data-act="modal-close">Cancel</button>');
}
act('tracker-pick', (el) => {
  app.session.send({ k: 'use', id: 'tracker', target: el.dataset.id });
  closeModal();
});

// Replaces the plain "use" action from the map sheet: Tracker asks first.
act('use', (el) => {
  const id = el.dataset.id;
  const s = snap();
  if (id === 'tracker' && !(s.me.fx && s.me.fx.tracker)) return pickTrackerTarget();
  app.session.send({ k: 'use', id });
});

// ---------------------------------------------------------------- map menu
// Everything that is not needed every minute: sound, battery saver, the
// safety rules, a problem report, and the way out of the match.
function menuBody() {
  const s = snap();
  if (!s) return '';
  const me = s.me;
  const toggle = (name, ico, title, sub, on) =>
    '<button type="button" class="menu-row" data-act="' + name + '" role="switch" aria-checked="' + on + '">' + icon(ico, 22) +
      '<span class="menu-text"><strong>' + title + '</strong><span class="small muted">' + sub + '</span></span>' +
      '<span class="switch' + (on ? ' on' : '') + '" aria-hidden="true"><i></i></span></button>';
  const link = (name, ico, title, sub, cls = '') =>
    '<button type="button" class="menu-row ' + cls + '" data-act="' + name + '">' + icon(ico, 22) +
      '<span class="menu-text"><strong>' + title + '</strong>' + (sub ? '<span class="small muted">' + sub + '</span>' : '') + '</span>' + icon('chevRight', 18, 2.25) + '</button>';
  const leave = app.practice ? ['Exit practice', 'Back to the home screen']
    : me.role === 'spectator' ? ['Stop watching', 'Back to the home screen']
    : me.host ? ['End match and leave', 'You are the host: this ends the match for everyone']
    : ['Leave match', 'You are out for the rest of this match'];
  return toggle('sound', app.sound.on ? 'sound' : 'mute', 'Sound alerts', app.sound.on ? 'On: pings, warnings and catches make a sound' : 'Off: this phone stays silent', app.sound.on) +
    (me.role === 'spectator' ? '' : toggle('saver', 'saver', 'Battery saver', 'Dims the screen after ' + CONFIG.saver.dimAfterSec + ' s and updates less often', app.saver.on)) +
    link('safety', 'shield', 'Safety rules', '') +
    link('report', 'warn', 'Report a problem', '') +
    link('menu-leave', 'exit', leave[0], leave[1], 'danger');
}

act('menu', () => openModal(
  '<h2>MENU</h2><div class="menu-list" id="menu-body">' + menuBody() + '</div>' +
  '<button type="button" class="btn btn-quiet" data-act="modal-close">Close</button>'));

// Keep the switches in step after a tap.
onRender(() => {
  const box = $('#menu-body');
  if (box && !$('#modal').hidden) setHTML(box, menuBody());
});

act('menu-leave', () => {
  const s = snap();
  if (!s) return closeModal();
  if (app.practice || s.me.role === 'spectator') {
    closeModal();
    return app.go.leave();
  }
  confirmModal(s.me.host
    ? { title: 'End the match for everyone?', body: 'You are the host. If you leave, the match ends for every player. To stop the match but keep the lobby, use the host console instead.', yes: 'End match and leave', tone: 'btn-hunter' }
    : { title: 'Leave this match?', body: s.me.role === 'prey' ? 'You are out for the rest of this match, and the hunters are told. If you come back you join the hunters.' : 'You are out for the rest of this match.', yes: 'Leave match', tone: 'btn-hunter' },
  () => app.go.leave());
});

onRender(renderDim);
onTick(tickDim);
