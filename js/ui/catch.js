// Screens 7 and 8: Confirm catch (hunter), Tagged (prey), and the
// "you are now a hunter" conversion screen.

import { $, esc, setHTML, clock, metres, buzz, joinNames, plural } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, ECONOMY } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, onTick, render, setLayer, toast } from './core.js';
import { bannerHooks } from './game.js';

const C = CONFIG.catch;
const N = C.pinLength;
const st = { target: null, pin: '', busy: false, error: null, done: null };

// ---------------------------------------------------------------- hunter
function pickTarget(id) {
  st.target = id;
  st.pin = '';
  st.error = null;
  if (id) app.session.send({ k: 'catch:start', target: id });
}

act('catch-open', () => {
  const s = snap();
  Object.assign(st, { target: null, pin: '', busy: false, error: null, done: null });
  const first = (s.targets || []).filter((t) => t.inRange && !t.safe).sort((a, b) => (a.d || 0) - (b.d || 0))[0];
  setLayer('catch');
  if (first) pickTarget(first.id);
  render();
});

act('catch-cancel', () => {
  if (app.session) app.session.send({ k: 'catch:cancel' });
  setLayer(null);
});

function errorText(m) {
  switch (m.reason) {
    case 'pin': return 'Wrong PIN. ' + plural(m.triesLeft, 'try', 'tries') + ' left.';
    case 'locked': return 'Too many wrong PINs. Locked for ' + m.lockSec + ' s.';
    case 'range': return 'Too far away. Get within ' + C.rangeM + ' m and try again.';
    case 'safe': return 'They are inside a Safe House. Wait it out.';
    default: return 'That player cannot be caught right now.';
  }
}

function submit() {
  st.busy = true;
  st.error = null;
  if (!app.session.send({ k: 'catch:submit', target: st.target, pin: st.pin })) {
    st.busy = false;
    st.pin = '';
    st.error = 'No connection to the host. Try again.';
  }
  render();
}

act('key', (el) => {
  if (st.busy || st.done || !st.target) return;
  const s = snap();
  if (s.me.lock && s.me.lock.untilT) return;
  const k = el.dataset.k;
  if (k === 'back') st.pin = st.pin.slice(0, -1);
  else if (st.pin.length < N) st.pin += k;
  st.error = null;
  render();
  if (st.pin.length === N) setTimeout(submit, 150);
});

function targetRow(t) {
  const sel = t.id === st.target;
  const can = t.inRange && !t.safe;
  const note = t.safe ? 'in a Safe House'
    : t.inRange ? (t.d != null ? '≈' + metres(t.d) + ' · ' : '') + (t.stale ? 'no GPS · PIN only' : 'in range')
    : t.d != null ? 'last seen ' + metres(t.d) + ' · too far' : 'not seen yet · too far';
  return '<label class="target' + (sel ? ' sel' : '') + (can ? '' : ' off') + '">' +
    '<input type="radio" name="target" value="' + t.id + '"' + (sel ? ' checked' : '') + (can ? '' : ' disabled') + '>' +
    '<span class="mono target-name">' + esc(t.name) + '</span>' +
    '<span class="mono target-note ' + (can ? 'lime-ink' : 'muted') + '">' + note + '</span>' +
  '</label>';
}

function renderCatch() {
  const s = snap();
  if (app.ui.layer !== 'catch' || !s) return;
  const root = $('#s-catch');

  if (st.done) {
    const d = st.done;
    setHTML(root,
      '<div class="catch-done">' +
        '<div class="done-mid">' +
          '<span class="done-check">' + icon('check', 64, 3) + '</span>' +
          '<h1 class="head">CAUGHT</h1>' +
          '<p>' + esc(d.name) + ' is now a hunter on your side.</p>' +
          '<div class="done-chips"><span class="mono done-gc">+' + d.gc + ' GC</span><span class="done-left">' + d.left + ' prey left</span></div>' +
        '</div>' +
        '<div class="done-foot pad-b"><button type="button" class="btn btn-xl btn-hunter" data-act="catch-back">BACK TO THE HUNT</button></div>' +
      '</div>');
    return;
  }

  const targets = (s.targets || []).slice().sort((a, b) => (b.inRange - a.inRange) || ((a.d == null ? 1e9 : a.d) - (b.d == null ? 1e9 : b.d)));
  // The picked prey walked out of range (or was caught by someone else).
  const cur = targets.find((t) => t.id === st.target);
  if (st.target && (!cur || !cur.inRange || cur.safe) && !st.busy) {
    st.target = null;
    st.pin = '';
  }
  if (!st.target && !st.busy) {
    const first = targets.find((t) => t.inRange && !t.safe);
    if (first) pickTarget(first.id);
  }
  const sel = targets.find((t) => t.id === st.target);
  const locked = s.me.lock && s.me.lock.untilT;

  const check = sel
    ? '<p class="range ok">' + icon('check', 18, 3) + '<span>GPS range check passed: ' + esc(sel.name) + (sel.stale || sel.d == null ? ' has no live fix, PIN decides' : ' is ≈' + metres(sel.d) + ' away (limit ' + C.rangeM + ' m)') + '</span></p>'
    : '<p class="range no">' + icon('warn', 18, 2.5) + '<span>No prey within ' + C.rangeM + ' m. Get closer, then pick who you tagged.</span></p>';

  const boxes = Array.from({ length: N }, (_, i) =>
    '<span class="mono pin-box' + (sel && !st.busy && i === st.pin.length ? ' cur' : i < st.pin.length ? ' filled' : '') + '">' + esc(st.pin.charAt(i)) + '</span>').join('');

  const status = st.busy ? '<p class="pin-status muted" role="status">Checking with the host…</p>'
    : locked ? '<p class="pin-status hunter-ink" role="alert" id="lock-msg"></p>'
    : st.error ? '<p class="pin-status hunter-ink" role="alert">' + esc(st.error) + '</p>'
    : '<p class="pin-status muted">' + (sel ? 'Ask ' + esc(sel.name) + ' to show you their screen.' : '') + '</p>';

  const keyOff = !sel || st.busy || locked ? ' disabled' : '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => '<button type="button" class="key mono" data-act="key" data-k="' + k + '"' + keyOff + '>' + k + '</button>').join('') +
    '<span aria-hidden="true"></span>' +
    '<button type="button" class="key mono" data-act="key" data-k="0"' + keyOff + '>0</button>' +
    '<button type="button" class="key back" data-act="key" data-k="back" aria-label="Delete digit"' + keyOff + '>' + icon('backspace', 26) + '</button>';

  setHTML(root,
    '<div class="catch scroll">' +
      '<header class="catch-head">' +
        '<button type="button" class="btn btn-sm btn-ghost cancel" data-act="catch-cancel">' + icon('x', 18, 2.5) + 'Cancel</button>' +
        '<span class="chip chip-hunter">HUNTER</span>' +
      '</header>' +
      '<div class="catch-title"><h1 class="head">CONFIRM CATCH</h1>' +
        '<p class="muted">Tag them, then type the ' + N + '-digit PIN on their screen.</p></div>' +
      '<fieldset class="targets" id="targets"><legend class="label">Who did you tag?</legend>' +
        (targets.length ? targets.map(targetRow).join('') : '<p class="muted">No prey left to catch.</p>') +
      '</fieldset>' +
      check +
      '<div class="pin-entry"><span class="label" id="pin-label">' + (sel ? esc(sel.name) + '’s PIN' : 'PIN') + '</span>' +
        '<div class="pin-boxes" role="group" aria-labelledby="pin-label">' + boxes + '</div>' + status + '</div>' +
      '<div class="grow"></div>' +
      '<div class="keypad pad-b">' + keys + '</div>' +
    '</div>');
  tickCatch();
}

function tickCatch() {
  const s = snap();
  const el = $('#lock-msg');
  if (!el || !s || !s.me.lock) return;
  const left = (s.me.lock.untilT - app.session.T()) / 1000;
  el.textContent = 'Too many wrong PINs. Try again in ' + clock(left) + '.';
}

$('#s-catch').addEventListener('change', (e) => {
  if (e.target.name === 'target') {
    pickTarget(e.target.value);
    render();
  }
});

act('catch-back', () => setLayer(null));

app.bus.on('session', (session) => {
  session.on('catch:result', (m) => {
    st.busy = false;
    if (m.ok) {
      st.done = { name: m.name, gc: m.gc, left: m.left };
      buzz([80, 60, 200]);
    } else {
      st.pin = '';
      st.error = errorText(m);
      buzz(300);
    }
    render();
  });
});

// ---------------------------------------------------------------- prey: tagged
const tagKey = (s) => (s.me.tag ? s.me.tag.key : null);

act('self-tag', () => {
  app.ui.selfTag = true;
  app.session.send({ k: 'tagged:self', on: true });
  setLayer('tagged');
});

act('tag-back', () => {
  const s = snap();
  app.ui.tagDismissed = s ? tagKey(s) : null;
  app.ui.selfTag = false;
  app.session.send({ k: 'tagged:self', on: false });
  setLayer(null);
});

function renderTagged() {
  const s = snap();
  if (!s || !app.session.inMatch) return;
  const me = s.me;
  // A hunter started a catch on me: jump to the PIN screen.
  if (me.role === 'prey' && me.tag && me.tag.key !== app.ui.tagDismissed && app.ui.layer !== 'tagged' && app.ui.mapOpen) {
    buzz([200, 100, 200]);
    setLayer('tagged');
  }
  if (app.ui.layer !== 'tagged') return;
  if (me.role !== 'prey') return setLayer(null);

  const who = me.tag || me.near;
  const pin = me.pin || '';
  setHTML($('#s-tagged'),
    '<div class="tagged scroll">' +
      '<div class="tagged-top"><span class="chip tagged-chip">PREY</span>' +
        '<span class="tagged-note">' + icon('sun', 16, 2.25) + (app.wakeHeld() ? 'Screen stays on · turn brightness up' : 'Turn your brightness up') + '</span></div>' +
      '<h1 class="head">' + (me.tag ? 'YOU’VE BEEN<br>TAGGED' : 'SHOW YOUR<br>PIN') + '</h1>' +
      '<p class="tagged-lead">Turn your screen to the hunter so they can type this PIN.</p>' +
      '<div class="tagged-pin" role="img" aria-label="Your catch PIN: ' + esc(pin.split('').join(' ')) + '">' +
        pin.split('').map((d) => '<span class="mono">' + esc(d) + '</span>').join('') + '</div>' +
      '<div class="tagged-wait">' +
        '<span class="tagged-av head" aria-hidden="true">' + esc(who ? who.by.charAt(0) : '?') + '</span>' +
        '<span class="tagged-who"><strong>' + (who ? 'Waiting for ' + esc(who.by) : 'Waiting for a hunter') + '</strong>' +
          '<span>' + (who ? (me.tag ? 'Confirming the catch' : 'Nearest hunter') + (who.d != null ? ' · ' + metres(who.d) + ' away' : '') : 'No hunter is close enough yet') + '</span></span>' +
        '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '</div>' +
      '<div class="grow"></div>' +
      '<div class="tagged-foot pad-b"><button type="button" class="btn tagged-back" data-act="tag-back">Not caught? Back to the map</button></div>' +
    '</div>');
}

// ---------------------------------------------------------------- prey: converted
app.bus.on('ev:converted', (e) => {
  app.ui.converted = e;
  app.ui.selfTag = false;
  buzz([300, 120, 300]);
  if (app.session && app.session.inMatch) setLayer('converted');
});

function convertedLine(e) {
  if (e.why === 'catch' && e.by) return 'CAUGHT BY ' + e.by.toUpperCase() + ' · ' + clock(e.L);
  if (e.why === 'admin') return 'MOVED BY THE HOST · ' + clock(e.L);
  return 'OUT OF THE HUNT · ' + clock(e.L);
}

function renderConverted() {
  const e = app.ui.converted;
  if (app.ui.layer !== 'converted' || !e) return;
  const s = snap();
  const left = s ? s.counts.prey : e.left;
  const join = e.mates.length ? 'You join ' + esc(joinNames(e.mates)) + '. ' : '';
  setHTML($('#s-converted'),
    '<div class="converted scroll">' +
      '<svg class="conv-rings" aria-hidden="true" width="420" height="420" viewBox="0 0 420 420" fill="none" stroke="#0A0C0B" stroke-opacity="0.12" stroke-width="3"><circle cx="210" cy="210" r="80"/><circle cx="210" cy="210" r="140"/><circle cx="210" cy="210" r="200"/><path d="M210 0V420M0 210H420"/></svg>' +
      '<span class="mono conv-kicker">' + esc(convertedLine(e)) + '</span>' +
      '<span class="head conv-now">YOU ARE NOW A</span>' +
      '<h1 class="head conv-big">HUNTER</h1>' +
      '<p class="conv-lead">' + join + (left ? plural(left, 'prey is', 'prey are') + ' still out there.' : 'That was the last prey.') + '</p>' +
      '<ul class="conv-list">' +
        '<li><span>Survival bonus · ' + plural(e.pings, 'ping') + '</span><span class="mono">+' + e.bonus + ' GC</span></li>' +
        '<li><span>Glowcoin carried over</span><span class="mono">' + e.gc + ' GC</span></li>' +
        '<li><span>Hunter channel</span><span class="conv-ok">Joined</span></li>' +
      '</ul>' +
      '<div class="grow"></div>' +
      '<button type="button" class="btn btn-xl conv-go" data-act="conv-go">START HUNTING' + icon('arrowRight', 22, 2.5) + '</button>' +
    '</div>');
}

act('conv-go', () => {
  app.ui.convertedBanner = app.ui.converted;
  app.ui.chatTab = 'team';
  setLayer(null);
});
act('banner-x', () => {
  app.ui.convertedBanner = null;
  render();
});

bannerHooks.push((out, s) => {
  const e = app.ui.convertedBanner;
  if (!e || s.me.role !== 'hunter') return;
  const n = s.counts.prey;
  out.push('<div class="banner hunter big" role="status"><span class="banner-text"><span class="head">YOU’VE BEEN CONVERTED</span><span>' +
    (e.by ? esc(e.by) + ' caught you at ' + clock(e.L) + '. ' : '') + 'Now hunt the other ' + n + '.</span></span>' +
    '<button type="button" class="banner-x" data-act="banner-x" aria-label="Dismiss">' + icon('x', 20, 2.5) + '</button></div>');
});

onRender(renderCatch);
onRender(renderTagged);
onRender(renderConverted);
onTick(tickCatch);
