// Screen 3: Role reveal + head start countdown.

import { $, esc, setHTML, setText, clock, span } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, MODES } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, onTick, screen, render } from './core.js';

const root = $('#s-reveal');

const RINGS = '<svg class="role-rings" aria-hidden="true" width="300" height="300" viewBox="0 0 300 300" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="2"><circle cx="150" cy="150" r="60"/><circle cx="150" cy="150" r="100"/><circle cx="150" cy="150" r="140"/></svg>';

function renderReveal() {
  const s = snap();
  if (screen() !== 'reveal' || !s) return;
  const prey = s.me.role === 'prey';
  const every = span(s.rules.pingSec);
  const pin = s.me.pin || '';
  const shown = app.ui.pinShown;

  const blurb = prey
    ? 'Stay inside the zone and stay hidden. Your position goes out as a ping every ' + every + '.'
    : 'Hold your position until the head start ends. Then chase the pings: every prey shows up every ' + every + '.';

  const card = prey
    ? '<section class="card pin-card">' +
        '<div class="pin-head"><span class="label">Your catch PIN</span>' +
          '<button type="button" class="btn btn-sm" data-act="pin-toggle" aria-pressed="' + shown + '">' + (shown ? 'Hide PIN' : 'Show PIN') + '</button></div>' +
        '<div class="pin-row" ' + (shown ? 'role="img" aria-label="Your catch PIN: ' + esc(pin.split('').join(' ')) + '"' : 'aria-label="PIN hidden"') + '>' +
          [0, 1, 2, 3].map((i) => '<span class="mono">' + (shown ? esc(pin.charAt(i)) : '•') + '</span>').join('') +
        '</div>' +
        '<p class="small muted">Only give this to a hunter who has physically tagged you. The host checks they are within ' + CONFIG.catch.rangeM + ' m.</p>' +
      '</section>'
    : '<section class="card pin-card">' +
        '<span class="label">How a catch works</span>' +
        '<p>Tag the prey, tap <strong>CATCH</strong>, then type the ' + CONFIG.catch.pinLength + '-digit PIN from their screen. You must be within ' + CONFIG.catch.rangeM + ' m.</p>' +
      '</section>';

  setHTML(root,
    '<div class="scroll reveal">' +
      '<section class="role-panel ' + s.me.role + '">' + RINGS +
        '<span class="mono kicker">ROLE ASSIGNED · ' + esc(MODES[s.mode].name.toUpperCase()) + '</span>' +
        '<span class="head you-are">YOU ARE</span>' +
        '<h1 class="head role-big">' + (prey ? 'PREY' : 'HUNTER') + '</h1>' +
        '<p>' + blurb + '</p>' +
      '</section>' +
      '<section class="hs">' +
        '<span class="label" id="hs-label">Head start</span>' +
        '<span class="mono hs-clock" role="timer" aria-live="off" id="hs-clock">00:00</span>' +
        '<div class="bar"><i id="hs-bar" class="' + s.me.role + '"></i></div>' +
        '<p class="muted" id="hs-note"></p>' +
      '</section>' +
      card +
      '<div class="grow"></div>' +
      '<div class="reveal-foot pad-b"><button type="button" class="btn btn-xl btn-lime" data-act="open-map">OPEN MAP' + icon('arrowRight', 22, 2.5) + '</button></div>' +
    '</div>');
  tickReveal();
}

function tickReveal() {
  const s = snap();
  if (screen() !== 'reveal' || !s) return;
  const left = Math.max(0, (s.headT - app.session.T()) / 1000);
  const total = s.rules.headStartSec || 1;
  const live = s.phase !== 'headstart';
  setText($('#hs-clock'), clock(live ? 0 : left));
  setText($('#hs-label'), live ? 'The hunt is live' : 'Head start');
  const bar = $('#hs-bar');
  if (bar) bar.style.width = (live ? 0 : Math.min(100, (left / total) * 100)).toFixed(1) + '%';
  setText($('#hs-note'), live
    ? (s.me.role === 'prey' ? 'Hunters are moving. Open the map and keep your distance.' : 'You are released. Open the map and start hunting.')
    : (s.me.role === 'prey' ? 'Hunters are locked in place until the clock hits zero. Use it to get distance and cover.' : 'You are locked in place until the clock hits zero. Prey are using it to get away.'));
}

act('pin-toggle', () => {
  app.ui.pinShown = !app.ui.pinShown;
  render();
});
act('open-map', () => {
  app.ui.mapOpen = true;
  app.ui.pinShown = false;
  app.go.route();
});

onRender(renderReveal);
onTick(tickReveal);
app.bus.on('screen', (name) => name === 'reveal' && renderReveal());
