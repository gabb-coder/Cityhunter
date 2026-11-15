// "How to play" (four short screens) and the privacy note. Both open from Home.

import { $, setHTML } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, ECONOMY } from '../config.js';
import { app } from '../state.js';
import { act, openModal, closeModal } from './core.js';

// ---------------------------------------------------------------- how to play
const STEPS = [
  {
    icon: 'users', tone: 'prey',
    title: 'Two sides',
    lines: [
      'A few players start as hunters. Everyone else is prey.',
      'Prey get a head start to run and hide. Hunters wait where they stand until it ends.',
      'Stay inside the dashed play zone on the map.'
    ]
  },
  {
    icon: 'scan', tone: 'lime',
    title: 'Pings',
    lines: [
      'Nobody is shown live. Every so often the game pings: hunters see where each prey was at that moment, and prey see where the hunters were.',
      'Between pings a circle grows around the last position. The prey is somewhere inside it.',
      'Prey earn ' + ECONOMY.perPingSurvived + ' Glowcoin for each ping they survive, to spend on abilities in the Shop.'
    ]
  },
  {
    icon: 'target', tone: 'hunter',
    title: 'The catch',
    lines: [
      'Hunters: get within ' + CONFIG.catch.rangeM + ' m, tag the prey with a light touch, then tap CATCH.',
      'The prey’s phone shows a code and a ' + CONFIG.catch.pinLength + '-digit PIN. Scan the code with your camera, or type the PIN.',
      'The game checks you really are close. No PIN, no catch.'
    ]
  },
  {
    icon: 'replay', tone: 'lime',
    title: 'Caught? Now you hunt',
    lines: [
      'A caught prey joins the hunters. The hunt ends when every prey is caught, or the clock runs out and the survivors win.',
      'Roads come first: stop at every crossing. Public places only.',
      'Need help? The lifebuoy button pauses the match for everyone.'
    ]
  }
];

let step = 0;

function howHtml() {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return '<div class="how" aria-live="polite">' +
      '<span class="how-ico ' + s.tone + '">' + icon(s.icon, 36) + '</span>' +
      '<span class="mono how-n">' + (step + 1) + ' / ' + STEPS.length + '</span>' +
      '<h2>' + s.title + '</h2>' +
      '<ul class="how-list modal-scroll">' + s.lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>' +
    '</div>' +
    '<div class="how-btns">' +
      '<button type="button" class="btn btn-line" data-act="how-back"' + (step === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button type="button" class="btn btn-lime" data-act="how-next">' + (last ? 'Got it' : 'Next') + '</button>' +
    '</div>' +
    (last ? '<button type="button" class="btn btn-quiet" data-act="how-practice">' + icon('flag', 18) + 'Try a practice round</button>' : '');
}

const drawHow = () => {
  const card = $('#modal .modal-card');
  if (card) setHTML(card, howHtml());
};

act('howto', () => {
  step = 0;
  openModal(howHtml());
});
act('how-next', () => {
  if (step === STEPS.length - 1) return closeModal();
  step++;
  drawHow();
});
act('how-back', () => {
  step = Math.max(0, step - 1);
  drawHow();
});
act('how-practice', () => {
  closeModal();
  const el = $('[data-act="practice"]');
  if (el) el.click();
});

// ---------------------------------------------------------------- privacy
const PRIVACY = [
  ['Your location',
    'City Hunter reads your location only while you are in a lobby or a match. It is sent to the host’s phone, which decides what other players may see: a ping every so often, never a live trail, unless the rules reveal you (outside the zone, or after a help request).',
    'When you leave the match the app stops reading your location.'],
  ['Who can see what',
    'Your callsign and chat messages go to the people in your lobby. Your catch PIN goes to nobody: it is shown on your own screen only.',
    'Spectators see every player live. Players cannot see spectators.'],
  ['Where it goes',
    'Game data travels between the players’ phones. The host’s phone keeps the match while it runs; nothing about your position is stored on a server.',
    'A connection service helps phones find each other and sees your network address and the lobby code. The map comes from OpenStreetMap, which sees your network address and the area you look at. Fonts come from Google Fonts.'],
  ['On this phone',
    'Your callsign, theme, language, sound setting, saved map pieces and your own past results are kept on this phone so the app works next time. Clearing the site’s data in your browser removes them.'],
  ['Camera',
    'The camera is on only while the scan screen is open, to read the code on another player’s phone. The picture is read on your phone and is never sent or saved.'],
  ['Voice',
    'The microphone is on only while you hold the talk button. Audio goes straight to your teammates and is not recorded.'],
  ['Problem reports',
    'A report is a log of connection, GPS and error events. It has no positions, PINs or chat. It is only shared when you choose to send it.'],
  ['Younger players',
    'If you are under 16, ask a parent or guardian before you play, and play with people you know.'],
  ['Questions',
    'Ask the person who organised your game. They can tell you who runs this copy of City Hunter.']
];

act('privacy', () => openModal(
  '<h2>PRIVACY</h2>' +
  '<div class="privacy modal-scroll">' + PRIVACY.map((sec) =>
    '<section><h3>' + sec[0] + '</h3>' + sec.slice(1).map((p) => '<p>' + p + '</p>').join('') + '</section>').join('') + '</div>' +
  '<button type="button" class="btn btn-lime" data-act="modal-close">Close</button>'));

// index.html?privacy opens it directly (for a link in an invite or a store listing).
app.bus.on('boot', () => {
  if (new URLSearchParams(location.search).has('privacy')) setTimeout(() => $('[data-act="privacy"]') && $('[data-act="privacy"]').click(), 100);
});

// Other modules can add a paragraph (e.g. the relay, automatic reports).
export const privacySections = PRIVACY;
