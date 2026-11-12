// Bootstrap and flow: host a lobby, join one, leave, and pick the screen
// that matches the current match phase.

import { CONFIG } from './config.js';
import { store, uid, makeCode, buzz, showCode } from './util.js';
import { app } from './state.js';
import { Geo } from './geo.js';
import { HostNet, ClientNet, LocalLink } from './net.js';
import { Host } from './host.js';
import { Session } from './client.js';
import { showScreen, setLayer, render, toast } from './ui/core.js';
import './ui/home.js';
import './ui/lobby.js';
import './ui/reveal.js';

const TOKEN_KEY = 'ch2.token';       // sessionStorage: this tab's player identity
const SESSION_KEY = 'ch2.session';   // sessionStorage: survives a reload of this tab

// Features register here as later modules load (host side and client side).
app.hostFeatures = [];

// ---- URL switches for testing ----
const params = new URLSearchParams(location.search);
if (params.get('ps')) {
  // ?ps=localhost:9000 -> use a self-hosted PeerServer
  const [h, port] = params.get('ps').split(':');
  CONFIG.net.peerServer = { host: h, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && h !== 'localhost' };
}

app.geo = new Geo();
if (params.get('sim')) {
  // ?sim=lat,lng -> fake GPS; tap the map to walk
  const [lat, lng] = params.get('sim').split(',').map(Number);
  app.sim = true;
  app.geo.simulate(isFinite(lat) && isFinite(lng) ? lat : 51.5073, isFinite(lat) && isFinite(lng) ? lng : -0.1657);
}
app.geo.on('status', render);

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
    mapOpen: false, pinShown: false, shopTab: null, chatTab: 'team', sheetMin: false,
    convertedBanner: null, selfTag: false, tagDismissed: null
  });
  setLayer(null);
}

// ---- pick the screen for the current phase ----
function route() {
  const s = app.session && app.session.snap;
  if (!s) return showScreen('home');
  if (s.phase === 'lobby') {
    if (app.ui.mapOpen) resetUi();
    showScreen('lobby');
  } else if (s.phase === 'ended') {
    if (app.ui.layer && app.ui.layer !== 'admin') setLayer(null);
    showScreen('results');
  } else {
    showScreen(app.ui.mapOpen ? 'game' : 'reveal');
  }
}

function bind(session) {
  app.session = session;
  session.on('update', () => {
    route();
    render();
  });
  session.on('event', (e) => {
    if (e.type === 'toast') toast(e.text, e.tone || '');
    if (e.type === 'release') {
      buzz([120, 80, 120]);
      toast(session.snap.me.role === 'hunter' ? 'Head start over. Go hunt.' : 'Hunters are released. Stay hidden.', 'hunter');
    }
    app.bus.emit('ev:' + e.type, e);
  });
  session.on('reject', (reason) => {
    const why = {
      'in-progress': 'That match has already started',
      full: 'That lobby is full',
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

function cleanup() {
  if (app.session) app.session.close();
  if (app.host) app.host.stop();
  if (app.net) app.net.destroy();
  app.bus.emit('cleanup');
  app.session = null;
  app.host = null;
  app.net = null;
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
    toast('Opening lobby…');
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
  const local = new LocalLink(net);
  const host = new Host({ code, net, local, saved });
  for (const install of app.hostFeatures) install(host);
  app.net = net;
  app.host = host;
  const session = new Session({ link: local, token: myToken(), name, isHost: true, geo: app.geo });
  if (saved) app.ui.mapOpen = saved.phase !== 'lobby';
  bind(session);
  host.addLocal(myToken(), name);
  store.set(SESSION_KEY, { code, host: true, name }, sessionStorage);
  app.bus.emit('joined', { code, host: true, name });
}

// ---- join a lobby ----
function joinGame(name, code, rejoin = false) {
  if (app.session) return;
  app.geo.start();
  const net = new ClientNet(code);
  app.net = net;
  const session = new Session({ link: net, token: myToken(), name, isHost: false, geo: app.geo });
  if (rejoin) app.ui.mapOpen = true;
  bind(session);
  toast(rejoin ? 'Rejoining ' + showCode(code) + '…' : 'Joining ' + showCode(code) + '…');
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
}

function leave() {
  if (!app.session) return cleanup();
  app.session.send({ k: 'leave' });
  app.bus.emit('left');
  if (!app.session.isHost) setTimeout(cleanup, 150);
}

app.go = { host: hostGame, join: joinGame, leave, route, cleanup, resumable: () => null, resume: () => {}, forget: () => {} };

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

window.CH = app;   // console access for debugging and tests
route();
render();
queueMicrotask(() => app.bus.emit('boot'));
