// Getting back into a match after a reload, a crashed tab or a dead phone.
//
//   sessionStorage 'ch2.session'  this tab was in a match: resume on load
//   localStorage   'ch2.last'     last match on this device: offered on Home
//   localStorage   'ch2.host'     the host's saved game (js/host-resilience.js)

import { store } from './util.js';
import { app } from './state.js';
import { HOST_SAVE_KEY, loadHostSave } from './host-resilience.js';

const TOKEN_KEY = 'ch2.token';
const SESSION_KEY = 'ch2.session';
const LAST_KEY = 'ch2.last';
const OFFER_FOR_MS = 30 * 60 * 1000;

let current = null;

function remember() {
  if (!current) return;
  store.set(LAST_KEY, { ...current, token: store.get(TOKEN_KEY, null, sessionStorage), at: Date.now() });
}

app.bus.on('joined', (info) => {
  current = info;
  remember();
});
setInterval(() => app.session && remember(), 10000);

// Leaving on purpose (or being told to go) ends the offer to come back.
app.bus.on('cleanup', () => {
  if (current && current.host) store.del(HOST_SAVE_KEY);
  current = null;
  store.del(LAST_KEY);
});
app.bus.on('join-failed', () => store.del(LAST_KEY));

function lastMatch() {
  const last = store.get(LAST_KEY);
  if (!last || !last.code || Date.now() - last.at > OFFER_FOR_MS) return null;
  if (last.host && !loadHostSave()) return null;
  return last;
}

app.go.resumable = () => (app.session ? null : lastMatch());

app.go.resume = () => {
  const last = lastMatch();
  if (!last || app.session) return;
  if (last.token) store.set(TOKEN_KEY, last.token, sessionStorage);
  if (last.host) {
    const saved = loadHostSave();
    if (saved && saved.code === last.code) return app.go.host(last.name, saved.G);
  } else {
    app.go.join(last.name, last.code, true);
  }
};

app.go.forget = () => {
  const last = store.get(LAST_KEY);
  if (last && last.host) store.del(HOST_SAVE_KEY);
  store.del(LAST_KEY);
};

// Same tab reloaded mid-match: go straight back in.
app.bus.on('boot', () => {
  const here = store.get(SESSION_KEY, null, sessionStorage);
  if (here && lastMatch() && lastMatch().code === here.code) app.go.resume();
});

// Guard against an accidental refresh or back-swipe during a match.
window.addEventListener('beforeunload', (e) => {
  if (app.session && app.session.inMatch) {
    e.preventDefault();
    e.returnValue = '';
  }
});
