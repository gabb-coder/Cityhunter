// Screen 2: Lobby (host and guest views share this file).

import { $, esc, setHTML, showCode, span, metres, plural } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, MODES, RULE_OPTIONS, RULE_LABELS } from '../config.js';
import { app, snap } from '../state.js';
import { tr } from '../i18n.js';
import { setupButton } from './history.js';
import { act, onRender, screen, toast, openModal, closeModal, confirmModal, roleName } from './core.js';
import { zoneCard } from './zone.js';
import { joinUrl } from './safety.js';
import { reportLink } from './extras.js';

const root = $('#s-lobby');
const fmtRule = (key, v) => (key === 'zoneRadiusM' ? metres(v) : key === 'zoneShrinkTo' ? (v >= 1 ? 'Off' : Math.round(v * 100) + '%') : span(v));

function modeCard(m, on, host) {
  return '<button type="button" class="mode-card" data-act="mode" data-mode="' + m.id + '" aria-pressed="' + on + '"' + (host ? '' : ' disabled') + '>' +
    '<span class="mode-top"><span class="lime-ink">' + icon(m.icon, 24) + '</span><span class="radio" aria-hidden="true"></span></span>' +
    '<span class="head mode-name">' + esc(m.name) + '</span>' +
    '<span class="small muted">' + esc(m.blurb) + '</span>' +
  '</button>';
}

function playerRow(p, host) {
  const state = !p.conn ? 'Offline' : p.host ? 'Host' : p.ready ? 'Ready' : 'Not ready';
  const stateCls = !p.conn ? 'hunter-ink' : p.ready || p.host ? 'lime-ink' : 'muted';
  const chip = p.role === 'spectator' ? '<span class="chip chip-sm chip-spectator">WATCHING</span>' : host
    ? '<button type="button" class="chip chip-sm chip-' + p.role + '" data-act="role" data-id="' + p.id + '" aria-label="' + esc(p.name) + ' starts as ' + roleName(p.role) + '. Tap to switch.">' + roleName(p.role) + '</button>'
    : '<span class="chip chip-sm chip-' + p.role + '">' + roleName(p.role) + '</span>';
  return '<li class="card player">' +
    '<span class="avatar ' + p.role + '" aria-hidden="true">' + esc(p.name.charAt(0)) + '</span>' +
    '<span class="player-main"><span class="mono player-name"><span translate="no">' + esc(p.name) + '</span>' + (p.you ? ' (you)' : '') + '</span>' +
    '<span class="player-state ' + stateCls + '">' + state + '</span></span>' +
    chip +
  '</li>';
}

function renderLobby() {
  const s = snap();
  if (screen() !== 'lobby' || !s) return;
  const host = s.me.host;
  const players = s.players.filter((p) => p.role !== 'spectator');
  const watchers = s.players.filter((p) => p.role === 'spectator');
  const watching = s.me.role === 'spectator';
  const unread = app.session.unread.all + app.session.unread.team;
  const ready = players.filter((p) => p.ready || p.host).length;
  const hunters = players.filter((p) => p.role === 'hunter').length;
  const prey = players.length - hunters;
  const fix = app.geo && app.geo.fix;

  let footNote = plural(players.length, 'player') + ' · ' + ready + ' ready · ' + plural(hunters, 'hunter');
  let canStart = true;
  if (host) {
    if (players.length < CONFIG.lobby.minPlayers) { canStart = false; footNote = 'Waiting for players to join'; }
    else if (!hunters || !prey) { canStart = false; footNote = 'You need at least one hunter and one prey'; }
    else if (!fix && !s.zoneCenter) { canStart = false; footNote = app.geo && app.geo.status === 'denied' ? 'Allow location access to set the play zone' : 'Set the play zone on the map, or wait for your GPS fix'; }
  }

  const rules = Object.keys(RULE_LABELS).map((key) =>
    '<button type="button" class="rule-row" data-act="rule" data-rule="' + key + '"' + (host ? '' : ' disabled') + '>' +
      '<span>' + RULE_LABELS[key] + '</span>' +
      '<span class="mono rule-val">' + (key === 'zoneRadiusM' && s.zoneShape ? 'Drawn shape' : fmtRule(key, s.rules[key])) + (host ? '<span class="muted">' + icon('chevRight', 18, 2.5) + '</span>' : '') + '</span>' +
    '</button>').join('');

  const stepper = '<div class="rule-row stepper-row"><span>Starting hunters</span>' +
    (host
      ? '<div class="stepper">' +
          '<button type="button" class="step" data-act="hunters" data-d="-1" aria-label="Fewer hunters"' + (hunters <= 1 ? ' disabled' : '') + '>' + icon('minus', 20, 2.5) + '</button>' +
          '<span class="mono step-n hunter-ink" aria-live="polite">' + hunters + '</span>' +
          '<button type="button" class="step" data-act="hunters" data-d="1" aria-label="More hunters"' + (prey <= 1 ? ' disabled' : '') + '>' + icon('plus', 20, 2.5) + '</button>' +
        '</div>'
      : '<span class="mono step-n hunter-ink">' + hunters + '</span>') +
    '</div>';

  const footBtn = watching
    ? '<button type="button" class="btn btn-xl btn-line" disabled>WATCHING · WAITING FOR HOST</button>'
    : host
    ? '<button type="button" class="btn btn-xl btn-lime" data-act="start"' + (canStart ? '' : ' disabled') + '>START HUNT' + icon('arrowRight', 22, 2.5) + '</button>'
    : '<button type="button" class="btn btn-xl ' + (s.me.ready ? 'btn-line' : 'btn-lime') + '" data-act="ready" aria-pressed="' + s.me.ready + '">' +
        (s.me.ready ? 'READY · WAITING FOR HOST' : 'I’M READY') + '</button>';

  setHTML(root,
    '<header class="topbar">' +
      '<button type="button" class="icon-btn sm" data-act="leave" aria-label="Leave lobby">' + icon('chevLeft', 22, 2.5) + '</button>' +
      '<h1>LOBBY</h1>' +
      (host
        ? '<button type="button" class="chip chip-line" data-act="admin" aria-label="Open host console">HOST' + icon('gear', 16, 2.25) + '</button>'
        : '<span class="chip chip-line">PLAYER</span>') +
    '</header>' +
    '<div class="scroll lobby-body">' +
      '<section class="card code-card" aria-label="Lobby code">' +
        '<div class="code-main"><span class="label">Lobby code</span>' +
          '<span class="mono code-big lime-ink">' + esc(showCode(s.code)) + '</span>' +
          '<span class="small muted">Friends enter this on the home screen</span></div>' +
        '<div class="code-btns">' +
          '<button type="button" class="icon-btn share-btn" data-act="qr" aria-label="Show a QR code to join">' + icon('qr', 24) + '</button>' +
          '<button type="button" class="icon-btn share-btn" data-act="share" aria-label="Share lobby code">' + icon('share', 24) + '</button>' +
        '</div>' +
      '</section>' +
      '<section class="block"><h2 class="label">Mode</h2><div class="mode-grid">' +
        Object.values(MODES).map((m) => modeCard(m, m.id === s.mode, host)).join('') +
      '</div></section>' +
      '<section class="block"><h2 class="label">Rules</h2><div class="card rows">' + rules + stepper + '</div>' +
        (host ? setupButton(s) : '') +
        '</section>' +
      zoneCard(s, host) +
      '<section class="block"><div class="block-head"><h2 class="label">Players · ' + players.length + '</h2>' +
        '<button type="button" class="btn btn-sm lobby-chat" data-act="chat">' + icon('chat', 18) + 'Lobby chat' + (unread ? '<span class="badge" aria-label="' + unread + ' unread">' + unread + '</span>' : '') + '</button></div>' +
        '<ul class="players">' + players.concat(watchers).map((p) => playerRow(p, host)).join('') + '</ul>' +
        '<p class="small muted">' + (host ? 'Tap a role chip to choose who starts as a hunter.' : 'The host picks the starting hunters.') + '</p>' +
      '</section>' +
      '<div class="link-row"><button type="button" class="btn btn-quiet safety-link" data-act="safety">' + icon('shieldPlain', 18) + 'Safety rules</button>' +
        reportLink() + '</div>' +
    '</div>' +
    '<footer class="foot-bar pad-b">' +
      '<span class="small muted foot-note">' + esc(footNote) + '</span>' + footBtn +
    '</footer>');
}

act('mode', (el) => app.session.send({ k: 'cfg', mode: el.dataset.mode }));
act('hunters', (el) => app.session.send({ k: 'cfg', hunters: Number(el.dataset.d) }));
act('role', (el) => app.session.send({ k: 'role', id: el.dataset.id }));
act('ready', () => app.session.send({ k: 'ready', ready: !snap().me.ready }));

act('rule', (el) => {
  const key = el.dataset.rule;
  const cur = snap().rules[key];
  // With a drawn zone there is no radius to pick: open the zone editor instead.
  if (key === 'zoneRadiusM' && snap().zoneShape) {
    const edit = document.querySelector('[data-act="zone-edit"]');
    return edit && edit.click();
  }
  openModal(
    '<h2>' + RULE_LABELS[key] + '</h2>' +
    '<div class="opt-grid">' + RULE_OPTIONS[key].map((v) =>
      '<button type="button" class="opt" data-act="rule-set" data-rule="' + key + '" data-v="' + v + '" aria-pressed="' + (v === cur) + '">' + fmtRule(key, v) + '</button>').join('') +
    '</div><button type="button" class="btn btn-quiet" data-act="modal-close">Cancel</button>');
});
act('rule-set', (el) => {
  app.session.send({ k: 'cfg', rule: el.dataset.rule, value: Number(el.dataset.v) });
  closeModal();
});

act('start', () => {
  const fix = app.geo && app.geo.fix;
  if (!fix && !snap().zoneCenter) return toast('Set the play zone on the map, or wait for your GPS fix');
  app.session.send({ k: 'start', center: fix ? { lat: fix.lat, lng: fix.lng } : null });
});

act('share', async () => {
  const s = snap();
  const url = joinUrl(s.code);
  const text = tr('Join my City Hunter lobby:') + ' ' + showCode(s.code);
  try {
    if (navigator.share) await navigator.share({ title: 'City Hunter', text, url });
    else {
      await navigator.clipboard.writeText(text + ' ' + url);
      toast('Invite link copied', 'lime');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('Code: ' + showCode(s.code));
  }
});

act('leave', () => {
  const s = snap();
  if (s && s.me.host && s.players.length > 1) {
    confirmModal({ title: 'Close this lobby?', body: 'Everyone in it will be sent back to the home screen.', yes: 'Close lobby', tone: 'btn-hunter' }, () => app.go.leave());
  } else app.go.leave();
});

onRender(renderLobby);
app.bus.on('session', (session) => session.on('chat', () => screen() === 'lobby' && renderLobby()));
app.bus.on('screen', (name) => name === 'lobby' && renderLobby());
