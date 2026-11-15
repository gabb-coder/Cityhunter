// Bootstrap and flow: host a lobby, join one, leave, and pick the screen
// that matches the current match phase.

import { CONFIG } from './config.js';
import { store, uid, makeCode, showCode } from './util.js';
import { cue } from './sound.js';
import { app } from './state.js';
import { HostNet, ClientNet, LocalLink } from './net.js';
import './diag.js';
import { Host } from './host.js';
import { Session } from './client.js';
import { showScreen, setLayer, render, toast, closeModal } from './ui/core.js';
import './ui/home.js';
import './ui/lobby.js';
import './ui/reveal.js';
import './ui/game.js';
import './ui/shop.js';
import './ui/chat.js';
import './ui/catch.js';
import './ui/results.js';
import './ui/admin.js';
import './ui/alerts.js';
import './ui/net.js';
import './ui/zone.js';
import './ui/safety.js';
import './ui/extras.js';
import './ui/replay.js';
import './practice.js';
import './tiles.js';
import { i18n } from './i18n.js';
import './resume.js';
import './voice.js';
import { installPlay } from './host-play.js';
import { installCatch } from './host-catch.js';
import { installAdmin } from './host-admin.js';
import { installSafety } from './host-safety.js';
import { installResilience } from './host-resilience.js';
import { installFairplay } from './host-fairplay.js';
import { installAwards } from './host-awards.js';
import './update.js';
import './ui/info.js';
import './ui/history.js';
import './ui/scan.js';

const TOKEN_KEY = 'ch2.token';       // sessionStorage: this tab's player identity
const SESSION_KEY = 'ch2.session';   // sessionStorage: survives a reload of this tab

// Features register here as later modules load (host side and client side).
app.hostFeatures = [installPlay, installCatch, installAdmin, installSafety, installResilience, installFairplay, installAwards];

// ---- URL switches for testing ----
const params = new URLSearchParams(location.search);
if (params.get('ps')) {
  // ?ps=localhost:9000 -> use a self-hosted PeerServer
  const [h, port] = params.get('ps').split(':');
  CONFIG.net.peerServer = { host: h, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && h !== 'localhost' };
}

if (params.get('sim')) {
  // ?sim=lat,lng -> fake GPS; tap the map to walk
  const [lat, lng] = params.get('sim').split(',').map(Number);
  app.sim = true;
  app.geo.simulate(isFinite(lat) && isFinite(lng) ? lat : 51.5073, isFinite(lat) && isFinite(lng) ? lng : -0.1657);
}
app.geo.on('status', render);
app.bus.on('mapclick', (p) => app.sim && !app.practice && app.geo.simulate(p.lat, p.lng));

function myToken() {
  let t = store.get(TOKEN_KEY, null, sessionStorage);
  if (!t) {
    t = uid(24);
    store.set(TOKEN_KEY, t, sessionStorage);
  }
  return t;
}

function resetUi() {
  Object.assign(app.ui, {
    mapOpen: false, pinShown: false, shopTab: null, chatTab: 'team',
    sheetMin: window.innerHeight < 700,   // short screens start with the panel folded so the map is visible
    convertedBanner: null, selfTag: false, tagDismissed: null
  });
  setLayer(null);
}

// Phases seen so far, to notice the moment a match starts.
let lastPhase = null;

// ---- pick the screen for the current phase ----
function route() {
  const s = app.session && app.session.snap;
  if (!s) {
    lastPhase = null;
    return showScreen('home');
  }
  if (app.ui.joining) {
    app.ui.joining = null;
    render();
  }
  // The match just started while this phone was in the lobby: clear away
  // lobby chat or any open picker so the role reveal is not hidden.
  if (lastPhase === 'lobby' && s.phase !== 'lobby') {
    setLayer(null);
    closeModal();
    cue('start');
  }
  lastPhase = s.phase;
  if (s.phase === 'lobby') {
    if (app.ui.mapOpen) resetUi();
    showScreen('lobby');
  } else if (s.phase === 'ended') {
    if (app.ui.layer && app.ui.layer !== 'admin') setLayer(null);
    showScreen('results');
  } else {
    if (s.me.role === 'spectator') app.ui.mapOpen = true;   // nothing to reveal to a spectator
    showScreen(app.ui.mapOpen ? 'game' : 'reveal');
  }
}

function bind(session) {
  app.session = session;
  session.on('update', () => {
    if (session.snap) i18n.setNames(session.snap.players.map((p) => p.name));
    route();
    render();
  });
  session.on('event', (e) => {
    if (e.type === 'toast') toast(e.text, e.tone || '');
    if (e.type === 'release') {
      cue('release');
      toast(session.snap.me.role === 'hunter' ? 'Head start over. Go hunt.' : 'Hunters are released. Stay hidden.', 'hunter');
    }
    app.bus.emit('ev:' + e.type, e);
  });
  session.on('reject', (reason) => {
    const why = {
      'in-progress': 'That match has already started',
      'no-watch': 'This host does not allow spectators',
      full: 'That lobby is full',
      kicked: 'The host removed you from that lobby',
      version: 'Your app is out of date. Reload the page and try again.',
      bad: 'Could not join that lobby'
    }[reason] || 'Could not join that lobby';
    cleanup();
    toast(why, 'hunter');
  });
  session.on('bye', (reason) => {
    cleanup();
    if (reason === 'host-left') toast('The host closed the lobby', 'hunter');
    if (reason === 'kicked') toast('The host removed you from the match', 'hunter');
  });
  app.bus.emit('session', session);
}

// keepOffer: leave the "Rejoin" card on Home (the match may still be there).
function cleanup({ keepOffer = false } = {}) {
  if (app.session) app.session.close();
  if (app.host) app.host.stop();
  if (app.net) app.net.destroy();
  app.bus.emit('cleanup', { keepOffer });
  app.session = null;
  app.host = null;
  app.net = null;
  app.ui.joining = null;
  app.geo.stop();                    // stop reading the location once out of a match
  closeModal();
  store.del(SESSION_KEY, sessionStorage);
  resetUi();
  route();
  render();
}

// ---- host a lobby ----
async function hostGame(name, saved = null) {
  if (app.session) return;
  app.geo.start();
  let net, code;
  if (saved) {
    code = saved.code;
    net = new HostNet(code);
    net.start({ keepTrying: true });   // registers when the old ID frees up
  } else {
    toast('Opening lobby…', '', 1500);
    for (let i = 0; ; i++) {
      code = makeCode(CONFIG.lobby.codeLength);
      net = new HostNet(code);
      try {
        await net.start();
        break;
      } catch (e) {
        net.destroy();
        if (e && e.type === 'unavailable-id' && i < 3) continue;
        return toast('Could not reach the game server. Check your connection.', 'hunter');
      }
    }
  }
  startLocal({ code, net, saved, name });
  if (saved) app.ui.mapOpen = saved.phase !== 'lobby';
  store.set(SESSION_KEY, { code, host: true, name }, sessionStorage);
  app.bus.emit('joined', { code, host: true, name });
}

// The host game plus this phone's own player, wired together in-process.
// Also used by practice rounds (js/practice.js), which have no network.
function startLocal({ code, net, saved = null, name }) {
  const local = new LocalLink(net);
  const host = new Host({ code, net, local, saved });
  for (const install of app.hostFeatures) install(host);
  app.net = net;
  app.host = host;
  const session = new Session({ link: local, token: myToken(), name, isHost: true, geo: app.geo });
  bind(session);
  host.addLocal(myToken(), name);
  return host;
}

// ---- join a lobby ----
function joinGame(name, code, rejoin = false, opts = {}) {
  if (app.session) return;
  if (!opts.watch) app.geo.start();        // spectators are never asked for their location
  const net = new ClientNet(code, { patient: rejoin });
  app.net = net;
  // Home shows a "Joining…" card until the first snapshot arrives.
  app.ui.joining = { code, rejoin, watch: !!opts.watch, since: Date.now() };
  const session = new Session({ link: net, token: myToken(), name, isHost: false, geo: app.geo, watch: !!opts.watch });
  if (rejoin) app.ui.mapOpen = true;
  bind(session);
  net.on('state', (st) => {
    if (st.status !== 'failed') return;
    cleanup();
    app.bus.emit('join-failed', { code });
    toast(st.error === 'not-found' ? 'No lobby with code ' + showCode(code) : 'Could not connect. Check your connection.', 'hunter');
  });
  net.on('up', () => {
    store.set(SESSION_KEY, { code, host: false, name }, sessionStorage);
    app.bus.emit('joined', { code, host: false, name });
  });
  net.start();
  render();
}

function leave() {
  if (!app.session) return cleanup();
  app.session.send({ k: 'leave' });
  app.bus.emit('left');
  if (!app.session.isHost) setTimeout(cleanup, 150);
}

// Stop trying to join. A rejoin keeps its card on Home for another go.
function cancelJoin() {
  const j = app.ui.joining;
  if (!j || !app.session || app.session.snap) return;
  cleanup({ keepOffer: j.rejoin });
}

// A rejoin waits for the host as long as a live match would.
setInterval(() => {
  const j = app.ui.joining;
  if (!j || !j.rejoin || !app.session || app.session.snap) return;
  if (Date.now() - j.since < CONFIG.net.hostOfflineHoldSec * 1000) return;
  cleanup({ keepOffer: true });
  toast('Could not get back into ' + showCode(j.code) + '. The host may have gone.', 'hunter', 6000);
}, 1000);

Object.assign(app.go, { host: hostGame, join: joinGame, leave, route, cleanup, startLocal, cancelJoin });

// ---- keep the screen awake during a match ----
let wakeLock = null;
async function syncWake() {
  const want = !!app.session && app.session.inMatch && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* denied or unsupported: nothing to do */ }
}
document.addEventListener('visibilitychange', syncWake);
setInterval(syncWake, 5000);
app.wakeHeld = () => !!wakeLock;

// ---- installable app: register the service worker (see sw.js) ----
if ('serviceWorker' in navigator && !params.has('nosw') && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

app.i18n = i18n;
window.CH = app;   // console access for debugging and tests
route();
render();
queueMicrotask(() => app.bus.emit('boot'));
