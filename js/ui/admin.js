// Host admin console: match controls and per-player actions.

import { $, esc, setHTML, clock, showCode } from '../util.js';
import { icon } from '../icons.js';
import { app, snap } from '../state.js';
import { act, onRender, setLayer, confirmModal, roleChip } from './core.js';

const root = $('#s-admin');
const send = (op, extra) => app.session.send({ k: 'admin', op, ...extra });

function statusLine(p, inMatch) {
  if (p.dropped) return ['Out of the match', 'muted'];
  if (!p.conn) return ['Offline ' + clock(p.offSec) + (inMatch ? ' · spot held ' + clock(Math.max(0, p.holdSec - p.offSec)) : ''), 'hunter-ink'];
  if (!inMatch) return [p.host ? 'Host' : 'Connected', 'lime-ink'];
  if (p.gpsOut) return ['No GPS · grace over, circle widening', 'hunter-ink'];
  if (p.gpsAge == null) return ['No GPS fix yet', 'hunter-ink'];
  if (p.gpsAge > 12) return ['No GPS for ' + p.gpsAge + ' s', 'hunter-ink'];
  if (p.revealed) return ['Out of zone · revealed to hunters', 'hunter-ink'];
  if (p.outZone) return ['Out of zone · countdown running', 'hunter-ink'];
  return ['GPS ±' + p.acc + ' m', p.acc > 30 ? 'hunter-ink' : 'muted'];
}

function renderAdmin() {
  const s = snap();
  if (app.ui.layer !== 'admin' || !s) return;
  if (!s.me.host || !s.admin) return setLayer(null);
  const inMatch = s.phase === 'headstart' || s.phase === 'live';

  const controls = inMatch
    ? '<section class="block"><h2 class="label">Match</h2><div class="admin-grid">' +
        '<button type="button" class="btn" data-act="adm" data-op="' + (s.paused ? 'resume' : 'pause') + '">' + icon(s.paused ? 'play' : 'pause', 20, 2.5) + (s.paused ? 'Resume' : 'Pause') + '</button>' +
        '<button type="button" class="btn" data-act="adm" data-op="ping"' + (s.phase === 'live' ? '' : ' disabled') + '>' + icon('scan', 20) + 'Ping now</button>' +
        '<button type="button" class="btn" data-act="adm" data-op="time" data-min="5">' + icon('plus', 20, 2.5) + '5 min</button>' +
        '<button type="button" class="btn" data-act="adm" data-op="time" data-min="-5">' + icon('minus', 20, 2.5) + '5 min</button>' +
        '<button type="button" class="btn btn-hunter-line wide" data-act="adm-end">End match now</button>' +
      '</div></section>'
    : '';

  const rows = s.admin.map((p) => {
    const [text, cls] = statusLine(p, inMatch);
    const actions = (inMatch && !p.dropped
        ? '<button type="button" class="btn btn-sm" data-act="adm" data-op="role" data-id="' + p.id + '">Make ' + (p.role === 'prey' ? 'hunter' : 'prey') + '</button>' +
          '<button type="button" class="btn btn-sm" data-act="adm" data-op="gc" data-amt="50" data-id="' + p.id + '">+50 GC</button>'
        : '') +
      (p.host ? '' : '<button type="button" class="btn btn-sm btn-hunter-line" data-act="adm-kick" data-id="' + p.id + '" data-name="' + esc(p.name) + '">Remove</button>');
    return '<li class="card admin-player">' +
      '<div class="admin-row"><span class="avatar ' + p.role + '" aria-hidden="true">' + esc(p.name.charAt(0)) + '</span>' +
        '<span class="player-main"><span class="mono player-name">' + esc(p.name) + (p.host ? ' (you)' : '') + '</span><span class="player-state ' + cls + '">' + text + '</span></span>' +
        (inMatch ? '<span class="mono admin-gc lime-ink">' + p.gc + ' GC</span>' : '') + roleChip(p.role, 'chip-sm') + '</div>' +
      (actions ? '<div class="admin-actions">' + actions + '</div>' : '') +
    '</li>';
  }).join('');

  setHTML(root,
    '<header class="topbar">' +
      '<button type="button" class="icon-btn sm" data-act="layer-close" aria-label="Close host console">' + icon('chevLeft', 22, 2.5) + '</button>' +
      '<h1>HOST CONSOLE</h1>' +
      '<span class="chip chip-line mono">' + esc(showCode(s.code)) + '</span>' +
    '</header>' +
    '<div class="scroll admin-body pad-b">' + controls +
      '<section class="block"><h2 class="label">Players · ' + s.admin.length + '</h2><ul class="players">' + rows + '</ul>' +
      '<p class="small muted">The console shows connection and GPS health only. It never shows where anyone is.</p></section>' +
    '</div>');
}

act('admin', () => setLayer('admin'));
act('adm', (el) => {
  const d = el.dataset;
  send(d.op, { id: d.id, min: d.min ? Number(d.min) : undefined, amt: d.amt ? Number(d.amt) : undefined });
});
act('adm-end', () => confirmModal(
  { title: 'End the match now?', body: 'It ends for everyone with no winner.', yes: 'End match', tone: 'btn-hunter' },
  () => { send('end'); setLayer(null); }));
act('adm-kick', (el) => confirmModal(
  { title: 'Remove ' + el.dataset.name + '?', body: 'They are dropped from this lobby and cannot rejoin it.', yes: 'Remove player', tone: 'btn-hunter' },
  () => send('kick', { id: el.dataset.id })));

onRender(renderAdmin);
