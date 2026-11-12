// Screen 1: Home.

import { $, esc, store, cleanCode, showCode } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { app } from '../state.js';
import { act, onRender, themeButton, toast, screen } from './core.js';

const NAME_KEY = 'ch2.name';
const root = $('#s-home');

const STEPS = ['Run during the head start', 'Survive every ping', 'Caught? Now you hunt'];

function build() {
  root.innerHTML =
    '<div class="home scroll">' +
      '<svg class="home-rings" aria-hidden="true" width="520" height="520" viewBox="0 0 520 520" fill="none" stroke-width="1.5">' +
        '<circle cx="260" cy="260" r="80"/><circle cx="260" cy="260" r="150"/><circle cx="260" cy="260" r="220"/><path d="M260 20V500M20 260H500"/></svg>' +
      '<div class="home-top">' +
        '<div class="home-build"><span class="lime-ink">' + icon('logo', 28, 2.5) + '</span>' +
          '<span class="mono">BUILD ' + CONFIG.version + ' · GPS MANHUNT</span>' +
          '<span id="home-theme" class="home-theme"></span></div>' +
        '<h1 class="head home-title">CITY<br>HUNTER</h1>' +
        '<p class="home-pitch">Real streets, real chase. Hunters track the pings, prey run for cover, and every catch flips a player to the other side.</p>' +
      '</div>' +
      '<ol class="steps">' +
        STEPS.map((s, i) => '<li class="card"><span class="mono lime-ink">0' + (i + 1) + '</span><span>' + s + '</span></li>').join('') +
      '</ol>' +
      '<div class="grow"></div>' +
      '<form class="home-form" id="home-form" novalidate>' +
        '<div id="home-resume"></div>' +
        '<label class="label" for="callsign">Your callsign</label>' +
        '<input id="callsign" class="field" maxlength="' + CONFIG.lobby.nameMaxLength + '" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">' +
        '<button type="button" class="btn btn-xl btn-lime" data-act="host">HOST A HUNT' + icon('arrowRight', 22, 2.5) + '</button>' +
        '<div class="divider"><span></span>or join a lobby<span></span></div>' +
        '<div class="join-row">' +
          '<input id="join-code" class="field code" aria-label="Lobby code" placeholder="CODE" maxlength="' + (CONFIG.lobby.codeLength + 1) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go">' +
          '<button type="submit" class="btn btn-line head join-btn">JOIN</button>' +
        '</div>' +
        '<p class="home-foot small muted">' + icon('lock', 16) + '<span>Your location is shared with your lobby only while a match is live.</span></p>' +
      '</form>' +
    '</div>';

  const name = $('#callsign');
  name.value = store.get(NAME_KEY, '') || '';
  name.addEventListener('input', () => {
    name.value = name.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '');
    store.set(NAME_KEY, name.value.trim());
  });
  const code = $('#join-code');
  code.addEventListener('input', () => {
    code.value = cleanCode(code.value).slice(0, CONFIG.lobby.codeLength);
  });
  $('#home-form').addEventListener('submit', (e) => {
    e.preventDefault();
    join();
  });

  // ?join=CODE links from the share button.
  const q = new URLSearchParams(location.search).get('join');
  if (q) code.value = cleanCode(q).slice(0, CONFIG.lobby.codeLength);
}

function callsign() {
  const el = $('#callsign');
  const v = el.value.trim();
  if (!v) {
    toast('Pick a callsign first');
    el.focus();
    return null;
  }
  return v;
}

function join() {
  const name = callsign();
  if (!name) return;
  const code = cleanCode($('#join-code').value);
  if (code.length !== CONFIG.lobby.codeLength) {
    toast('Lobby codes are ' + CONFIG.lobby.codeLength + ' characters');
    $('#join-code').focus();
    return;
  }
  app.go.join(name, code);
}

act('host', () => {
  const name = callsign();
  if (name) app.go.host(name);
});
act('resume', () => app.go.resume());
act('resume-forget', () => {
  app.go.forget();
  renderHome();
});

function renderHome() {
  if (screen() !== 'home') return;
  $('#home-theme').innerHTML = themeButton('sm');
  const r = app.go.resumable ? app.go.resumable() : null;
  $('#home-resume').innerHTML = r
    ? '<div class="card card-strong resume">' +
        '<span><span class="label">' + (r.host ? 'Your hosted lobby' : 'Match in progress') + '</span>' +
        '<span class="mono resume-code">' + esc(showCode(r.code)) + '</span></span>' +
        '<button type="button" class="btn btn-sm btn-lime" data-act="resume">' + (r.host ? 'Resume hosting' : 'Rejoin') + '</button>' +
        '<button type="button" class="icon-btn sm" data-act="resume-forget" aria-label="Forget this match">' + icon('x', 18, 2.5) + '</button>' +
      '</div>'
    : '';
}

build();
onRender(renderHome);
app.bus.on('screen', (name) => name === 'home' && renderHome());
