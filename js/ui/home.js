// Screen 1: Home.

import { $, esc, store, cleanCode, showCode, clock, setHTML, setText } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { app } from '../state.js';
import { act, onRender, onTick, themeButton, toast, screen } from './core.js';
import { soundButton } from './safety.js';
import { reportLink } from './extras.js';
import { i18n } from '../i18n.js';
import { history } from './history.js';

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
          '<span class="mono">BUILD ' + CONFIG.version + '</span>' +
          '<span id="home-theme" class="home-theme"></span></div>' +
        '<h1 class="head home-title" translate="no">CITY <br>HUNTER</h1>' +
        '<p class="home-pitch">Real streets, real chase. Hunters track the pings, prey run for cover, and every catch flips a player to the other side.</p>' +
      '</div>' +
      '<ol class="steps">' +
        STEPS.map((s, i) => '<li class="card"><span class="mono lime-ink">0' + (i + 1) + '</span><span>' + s + '</span></li>').join('') +
      '</ol>' +
      '<div class="grow"></div>' +
      '<form class="home-form" id="home-form" novalidate>' +
        '<div id="home-joining" aria-live="polite"></div>' +
        '<div id="home-resume"></div>' +
        '<div id="home-invite"></div>' +
        '<div id="home-install"></div>' +
        '<label class="label" for="callsign">Your callsign</label>' +
        '<input id="callsign" class="field" maxlength="' + CONFIG.lobby.nameMaxLength + '" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">' +
        '<button type="button" class="btn btn-xl btn-lime" data-act="host">HOST A HUNT' + icon('arrowRight', 22, 2.5) + '</button>' +
        '<div class="divider"><span></span>or join a lobby<span></span></div>' +
        '<div class="join-row">' +
          '<input id="join-code" class="field code" aria-label="Lobby code" placeholder="CODE" maxlength="' + (CONFIG.lobby.codeLength + 1) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go">' +
          '<button type="submit" class="btn btn-line head join-btn">JOIN</button>' +
        '</div>' +
        '<div class="home-more">' +
          '<button type="button" class="btn btn-sm btn-quiet" data-act="howto">' + icon('help', 18) + 'How to play</button>' +
          '<button type="button" class="btn btn-sm btn-quiet" data-act="practice">' + icon('flag', 18) + 'Practice round</button>' +
          '<button type="button" class="btn btn-sm btn-quiet" data-act="watch">' + icon('eye', 18) + 'Watch a match</button>' +
          '<button type="button" class="btn btn-sm btn-quiet" data-act="history" id="home-history">' + icon('replay', 18) + 'Past matches</button>' +
        '</div>' +
        '<p class="home-foot small muted">' + icon('lock', 16) + '<span>Your location is shared with your lobby only while a match is live.</span></p>' +
        '<div class="home-links"><span id="home-lang"></span>' +
          '<button type="button" class="btn btn-quiet report-link" data-act="privacy">' + icon('lock', 18) + 'Privacy</button>' + reportLink() + '</div>' +
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

  // ?join=CODE links from the share button: the code is filled in, so
  // joining becomes the main action and hosting steps back.
  const q = new URLSearchParams(location.search).get('join');
  if (q && cleanCode(q).length === CONFIG.lobby.codeLength) {
    code.value = cleanCode(q).slice(0, CONFIG.lobby.codeLength);
    root.querySelector('.home').classList.add('invited');
    root.querySelector('.join-btn').classList.replace('btn-line', 'btn-lime');
    root.querySelector('[data-act="host"]').classList.replace('btn-lime', 'btn-line');
    setTimeout(() => root.querySelector('.join-row').scrollIntoView({ block: 'center' }), 250);
    $('#home-invite').innerHTML = '<p class="card invite-note">' + icon('check', 18, 2.5) + '<span><strong class="mono" translate="no">' + esc(showCode(code.value)) + '</strong> <span>You were invited to this lobby. Pick a callsign and tap JOIN.</span></span></p>';
  }
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

function join(watch = false) {
  const name = callsign();
  if (!name) return;
  const code = cleanCode($('#join-code').value);
  if (code.length !== CONFIG.lobby.codeLength) {
    toast('Lobby codes are ' + CONFIG.lobby.codeLength + ' characters');
    $('#join-code').focus();
    return;
  }
  app.go.join(name, code, false, { watch });
}

act('host', () => {
  const name = callsign();
  if (name) app.go.host(name);
});
act('watch', () => join(true));
act('practice', () => {
  const name = callsign();
  if (name) app.go.practice(name);
});

// Language switch: shows the language you would switch TO, in that language.
function langButton() {
  const next = i18n.next();
  return '<button type="button" class="btn btn-quiet lang-btn" data-act="lang" lang="' + next.code + '" translate="no" aria-label="' + next.aria + '">' + icon('globe', 18) + next.name + '</button>';
}
act('lang', () => {
  i18n.set(i18n.next().code);
  renderHome();
});

act('join-cancel', () => app.go.cancelJoin());

const SPINNER = '<svg class="spin" width="36" height="36" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="21" fill="none" stroke-width="5" class="spin-track"/><path d="M26 5 A21 21 0 0 1 47 26" fill="none" stroke-width="5" stroke-linecap="round" class="spin-arc"/></svg>';

// While a join is under way (no word from the host yet): say so, and lock
// the form so a second tap cannot start another one.
function renderJoining() {
  const j = app.session && !app.session.snap ? app.ui.joining : null;
  const box = $('#home-joining');
  for (const el of root.querySelectorAll('#home-form input, #home-form button:not([data-act="join-cancel"])')) {
    if (el.closest('#home-joining, .home-links')) continue;
    el.disabled = !!j;
  }
  root.querySelector('.home').classList.toggle('busy', !!j);
  if (!j) return setHTML(box, '');
  setHTML(box,
    '<div class="card card-strong joining" role="status">' + SPINNER +
      '<span class="joining-text"><strong><span>' + (j.rejoin ? 'Rejoining' : j.watch ? 'Opening' : 'Joining') + '</span> <span class="mono" translate="no">' + esc(showCode(j.code)) + '</span>…</strong>' +
        '<span class="small muted" id="joining-note"></span></span>' +
      '<button type="button" class="btn btn-sm" data-act="join-cancel">Cancel</button>' +
    '</div>');
  tickJoining();
}

function tickJoining() {
  const j = app.session && !app.session.snap ? app.ui.joining : null;
  const el = $('#joining-note');
  if (!j || !el) return;
  const waited = (Date.now() - j.since) / 1000;
  setText(el, j.rejoin
    ? (waited < 6 ? 'Looking for the host' : 'Waiting for the host to come back · ' + clock(CONFIG.net.hostOfflineHoldSec - waited) + ' left')
    : (waited < 6 ? 'Contacting the host' : 'Still trying. Check the code and your connection.'));
}

act('resume', () => app.go.resume());
act('resume-forget', () => {
  app.go.forget();
  renderHome();
});

function renderHome() {
  if (screen() !== 'home') return;
  $('#home-theme').innerHTML = soundButton('sm') + themeButton('sm');
  $('#home-lang').innerHTML = langButton();
  renderInstall();
  renderJoining();
  // "Past matches" only once there is one.
  const past = $('#home-history');
  if (past) past.hidden = !history().length;
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

// ---- install as an app ----
// Chrome / Android offer a real install prompt. iPhone Safari has no prompt,
// so it gets a one-line hint instead. Nothing shows once it is installed.
let installEvent = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  renderHome();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  renderHome();
});

function renderInstall() {
  const box = $('#home-install');
  if (!box) return;
  if (standalone()) box.innerHTML = '';
  else if (installEvent) {
    box.innerHTML = '<button type="button" class="btn btn-sm install-btn" data-act="install">' + icon('install', 18) + 'Install City Hunter on this phone</button>';
  } else if (isIos()) {
    box.innerHTML = '<p class="small muted install-hint">' + icon('install', 16) + '<span>For full screen: tap Share, then \u201CAdd to Home Screen\u201D.</span></p>';
  } else box.innerHTML = '';
}

act('install', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  renderHome();
});

build();
onRender(renderHome);
onTick(() => screen() === 'home' && tickJoining());
app.bus.on('screen', (name) => name === 'home' && renderHome());
