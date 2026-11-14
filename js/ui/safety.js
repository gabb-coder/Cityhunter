// Safety: the pre-match reminder, the "I need help" button, the join QR
// code and the sound on/off switch.

/* global qrcode */
import { $, esc, store, showCode } from '../util.js';
import { icon } from '../icons.js';
import { cue } from '../sound.js';
import { app, snap } from '../state.js';
import { act, render, openModal, closeModal, confirmModal, toast } from './core.js';
import { bannerHooks, mapItemHooks } from './game.js';

const SEEN_KEY = 'ch2.safety';

// ---------------------------------------------------------------- reminder
const RULES = [
  ['Roads come first', 'Stop at every road and crossing. No catch is worth stepping into traffic.'],
  ['Public places only', 'Stay out of private property, building sites, railways and anywhere marked no entry. No climbing.'],
  ['Eyes up', 'Look where you are going. Check the map when you are standing still.'],
  ['A tag is a light touch', 'No grabbing, tackling or blocking. Give other people on the street plenty of room.'],
  ['Need help? Say so', 'The lifebuoy button on the map pauses the match for everyone and shows them where you are.']
];

function safetyHtml(first) {
  return '<h2>PLAY SAFE</h2>' +
    '<ol class="safety-list">' + RULES.map((r) => '<li><strong>' + r[0] + '</strong><span>' + r[1] + '</span></li>').join('') + '</ol>' +
    '<button type="button" class="btn btn-lime" data-act="safety-ok">' + (first ? 'I’ll play safe' : 'Got it') + '</button>';
}

act('safety', () => openModal(safetyHtml(false)));
act('safety-ok', () => {
  const s = snap();
  if (s) store.set(SEEN_KEY, s.code, sessionStorage);
  closeModal();
});

// Shown once per lobby, the first time this phone lands in it.
app.bus.on('screen', (name) => {
  const s = snap();
  if (name !== 'lobby' || !s) return;
  if (store.get(SEEN_KEY, null, sessionStorage) === s.code) return;
  openModal(safetyHtml(true));
});

// ---------------------------------------------------------------- help
act('help', () => {
  const s = snap();
  if (!s || !app.session.inMatch) return;
  if (s.help) return toast(s.help.you ? 'Help is already requested' : s.help.name + ' has already asked for help');
  confirmModal(
    { title: 'Need help?', body: 'This pauses the match for everyone, sounds an alarm on their phones and shows them where you are.', yes: 'Pause and ask for help', tone: 'btn-hunter' },
    () => app.session.send({ k: 'help', on: true }));
});
act('help-ok', () => app.session.send({ k: 'help', on: false }));

app.bus.on('ev:help', (e) => {
  cue('help');
  toast(e.name + ' needs help. The match is paused.', 'hunter', 8000);
});

bannerHooks.push((out, s) => {
  const h = s.help;
  if (!h) return;
  const canEnd = h.you || s.me.host;
  out.push('<div class="banner hunter big help-banner" role="alert"><span class="banner-text">' +
    '<span class="head">' + (h.you ? 'HELP REQUESTED' : esc(h.name.toUpperCase()) + ' NEEDS HELP') + '</span>' +
    '<span>' + (h.you ? 'Everyone can see where you are. The match is paused.' : 'The match is paused. Their position is on your map.') + '</span></span>' +
    (canEnd ? '<button type="button" class="btn btn-sm help-end" data-act="help-ok">' + (h.you ? 'I’m OK' : 'Resume') + '</button>' : '') +
  '</div>');
});

mapItemHooks.push((items, s) => {
  const h = s.help;
  if (h && !h.you && h.lat != null) items.push({ id: 'help', type: 'dot', tone: 'lime', lat: h.lat, lng: h.lng, label: h.name + ' · NEEDS HELP', strong: true });
});

// ---------------------------------------------------------------- join QR
export function joinUrl(code) {
  return location.origin + location.pathname + '?join=' + code;
}

act('qr', () => {
  const s = snap();
  if (!s) return;
  const url = joinUrl(s.code);
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  openModal(
    '<h2>Scan to join</h2>' +
    // Always black on white with a quiet zone, whatever the theme.
    '<div class="qr-box" role="img" aria-label="QR code that opens this lobby">' + qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }) + '</div>' +
    '<p class="qr-code mono">' + esc(showCode(s.code)) + '</p>' +
    '<p class="small muted qr-note">Point a phone camera at the code. It opens City Hunter with this lobby filled in.</p>' +
    '<button type="button" class="btn btn-quiet" data-act="modal-close">Close</button>');
});

// ---------------------------------------------------------------- sound switch
export function soundButton(extraClass = '') {
  const on = app.sound.on;
  return '<button type="button" class="icon-btn ' + extraClass + '" data-act="sound" aria-pressed="' + on + '" aria-label="' +
    (on ? 'Sound alerts on. Tap to mute.' : 'Sound alerts off. Tap to turn on.') + '">' + icon(on ? 'sound' : 'mute', 22) + '</button>';
}
act('sound', () => {
  const on = app.sound.toggle();
  toast(on ? 'Sound alerts on' : 'Sound alerts off', on ? 'lime' : '', 1500);
  render();
});
