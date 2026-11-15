// Kept on this phone only:
//   past matches  a short record of each finished match (Home, "Past matches")
//   last setup    the mode, rules and zone the host last started with, so the
//                 next lobby can be set up the same way in one tap

import { esc, store, clock, dist, span, metres } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, MODES, RULE_LABELS, RULE_OPTIONS } from '../config.js';
import { app, snap } from '../state.js';
import { act, openModal, closeModal, confirmModal, toast, render } from './core.js';

const HISTORY_KEY = 'ch2.history';
const SETUP_KEY = 'ch2.setup';

// ---------------------------------------------------------------- past matches
export const history = () => store.get(HISTORY_KEY, []) || [];

function record(s) {
  const me = s.me;
  const r = s.result;
  if (!r || me.role === 'spectator' || app.practice) return;
  const key = s.code + ':' + s.round;
  const list = history();
  if (list.some((h) => h.key === key)) return;
  const mine = r.board.find((x) => x.id === me.id) || {};
  list.unshift({
    key, at: Date.now(), mode: r.mode, winner: r.winner, reason: r.reason,
    startRole: me.startRole, role: me.role,
    survived: mine.startRole === 'prey' ? (mine.caughtL == null ? r.L : mine.caughtL) : null,
    catches: mine.catches || 0, earned: mine.earned || 0, players: r.board.length,
    place: Math.max(1, r.board.findIndex((x) => x.id === me.id) + 1),
    awards: (r.awards || []).filter((a) => a.pid === me.id).map((a) => a.id)
  });
  store.set(HISTORY_KEY, list.slice(0, CONFIG.history.keep));
}

const outcome = (h) => {
  if (h.winner === 'none') return { text: 'No winner', cls: 'muted' };
  const won = (h.winner === 'prey' && h.role === 'prey') || (h.winner === 'hunters' && h.startRole === 'hunter');
  if (won) return { text: 'Won', cls: 'lime-ink' };
  if (h.winner === 'hunters') return { text: h.startRole === 'prey' ? 'Caught' : 'Hunters won', cls: 'hunter-ink' };
  return { text: h.role === 'prey' ? 'Survived' : 'Prey survived', cls: 'prey-ink' };
};

const day = (at) => {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
};

function historyHtml() {
  const list = history();
  const rows = list.map((h) => {
    const o = outcome(h);
    const mode = MODES[h.mode] ? MODES[h.mode].name : h.mode;
    const bits = [];
    if (h.survived != null) bits.push('<span>survived ' + clock(h.survived) + '</span>');
    if (h.catches) bits.push('<span>' + (h.catches === 1 ? '1 catch' : h.catches + ' catches') + '</span>');
    bits.push('<span>' + h.earned + ' GC</span>');
    if (h.awards && h.awards.length) bits.push('<span>' + (h.awards.length === 1 ? '1 award' : h.awards.length + ' awards') + '</span>');
    return '<li class="card past">' +
      '<span class="past-main"><span class="past-top"><strong class="' + o.cls + '">' + o.text + '</strong><span class="mono past-date" translate="no">' + day(h.at) + '</span></span>' +
      '<span class="small muted past-line"><span>' + esc(mode) + '</span><span>' + h.players + ' players</span><span>started as ' + (h.startRole === 'hunter' ? 'hunter' : 'prey') + '</span></span>' +
      '<span class="small past-line">' + bits.join('') + '</span></span>' +
    '</li>';
  }).join('');
  return '<h2>PAST MATCHES</h2>' +
    '<p class="small muted">Kept on this phone only.</p>' +
    '<ul class="past-list modal-scroll">' + rows + '</ul>' +
    '<button type="button" class="btn btn-lime" data-act="modal-close">Close</button>' +
    '<button type="button" class="btn btn-quiet" data-act="history-clear">Clear the list</button>';
}

act('history', () => (history().length ? openModal(historyHtml()) : toast('No matches played on this phone yet')));
act('history-clear', () => confirmModal(
  { title: 'Clear past matches?', body: 'This removes the list from this phone. It cannot be undone.', yes: 'Clear the list', tone: 'btn-hunter' },
  () => {
    store.del(HISTORY_KEY);
    render();
  }));

// ---------------------------------------------------------------- last setup
let lobbySetup = null;   // what the host's lobby looked like a moment ago

// Only values the lobby can actually be set to count as a difference.
const sameRules = (saved, now) => Object.keys(RULE_LABELS).every((k) => !RULE_OPTIONS[k].includes(saved[k]) || saved[k] === now[k]);
const sameZone = (a, b) => (!a && !b) || (!!a && !!b && dist(a, b) < 5);

export function savedSetup() {
  const v = store.get(SETUP_KEY, null);
  return v && MODES[v.mode] && v.rules ? v : null;
}

// The saved setup, if it would change anything in this lobby.
function offer(s) {
  const saved = savedSetup();
  if (!saved || !s.me.host) return null;
  const zone = usableZone(saved);
  if (saved.mode === s.mode && sameRules(saved.rules, s.rules) && (!zone || sameZone(zone, s.zoneCenter))) return null;
  return saved;
}

// A saved zone is only offered when the host is still near it.
function usableZone(saved) {
  const fix = app.geo.fix;
  if (!saved.zoneCenter) return null;
  if (fix && dist(fix, saved.zoneCenter) > 3000) return null;
  return saved.zoneCenter;
}

export function setupButton(s) {
  const saved = offer(s);
  if (!saved) return '';
  return '<button type="button" class="btn btn-sm setup-use" data-act="setup-use">' + icon('replay', 18) +
    '<span class="setup-text"><span>Use last setup</span><span class="muted setup-what">' + esc(MODES[saved.mode].name) + ' · ' + span(saved.rules.matchSec) + ' · ' + metres(saved.rules.zoneRadiusM) + '</span></span></button>';
}

act('setup-use', () => {
  const s = snap();
  const saved = s && offer(s);
  if (!saved) return;
  const send = (m) => app.session.send({ k: 'cfg', ...m });
  send({ mode: saved.mode });                       // resets the rules to that mode's defaults...
  for (const key of Object.keys(RULE_LABELS)) {     // ...then each saved value goes on top
    if (RULE_OPTIONS[key].includes(saved.rules[key])) send({ rule: key, value: saved.rules[key] });
  }
  const zone = usableZone(saved);
  if (zone) send({ zone });
  toast('Last setup applied', 'lime', 1800);
  closeModal();
});

app.bus.on('session', (session) => {
  lobbySetup = null;
  session.on('update', () => {
    const s = session.snap;
    if (!s) return;
    if (s.phase === 'ended') return record(s);
    if (!s.me.host || app.practice) return;
    if (s.phase === 'lobby') {
      lobbySetup = { mode: s.mode, rules: { ...s.rules }, zoneCenter: s.zoneCenter || null };
    } else if (lobbySetup) {
      // The match just started: this is the setup to offer next time.
      store.set(SETUP_KEY, { ...lobbySetup, at: Date.now() });
      lobbySetup = null;
    }
  });
});
