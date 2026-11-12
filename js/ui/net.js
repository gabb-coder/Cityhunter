// Connection lost (you) and Host offline overlays.

import { $, esc, setHTML, setText, clock } from '../util.js';
import { CONFIG } from '../config.js';
import { app } from '../state.js';
import { act, onRender, onTick, render, toast, confirmModal } from './core.js';

const N = CONFIG.net;
let lastPingWall = 0;
let lastPingNo = -1;

const offlineSec = (st) => (st.downSince ? (Date.now() - st.downSince) / 1000 : 0);

function mode() {
  const sess = app.session;
  if (!sess || !sess.snap || sess.abandoned) return null;
  const st = sess.link.state;
  if (st.status !== 'reconnecting') return null;
  return st.cause === 'host' ? 'host' : 'self';
}

const SPINNER = '<svg class="spin" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="21" fill="none" stroke-width="5" class="spin-track"/><path d="M26 5 A21 21 0 0 1 47 26" fill="none" stroke-width="5" stroke-linecap="round" class="spin-arc"/></svg>';

function renderNet() {
  const box = $('#net');
  const m = mode();
  box.hidden = !m;
  if (!m) return;
  const sess = app.session;
  const s = sess.snap;
  const inMatch = sess.inMatch;
  const hostName = (s.players.find((p) => p.host) || {}).name || 'the host';
  const hunter = s.me.role === 'hunter';

  let title, body, facts;
  if (m === 'host') {
    title = 'HOST OFFLINE';
    body = inMatch
      ? 'The host’s phone dropped out, so the match is paused for everyone. Stay where you are: the clock and pings resume the moment the host is back.'
      : 'The host’s phone dropped out. The lobby comes back as soon as they reconnect.';
    facts = inMatch
      ? [['Match clock', '<span id="net-f1"></span>'], [hunter ? 'Last prey ping' : 'Your last ping', '<span id="net-f2"></span>'], ['If host doesn’t return', 'Match ends, no winner']]
      : [['Waiting for', esc(hostName)], ['Gives up in', '<span id="net-f3"></span>']];
  } else {
    title = 'CONNECTION LOST';
    body = inMatch
      ? 'Your phone lost its connection. The match keeps running, and ' + (hunter ? 'your team sees your last position' : 'hunters see your last ping') + ' until you’re back.'
      : 'Your phone lost its connection to the lobby. Trying to get you back in.';
    facts = inMatch
      ? [['Offline for', '<span id="net-f4"></span>'], ['Match clock', '<span id="net-f1"></span>'], ['Your spot is held for', '<span id="net-f5"></span>']]
      : [['Offline for', '<span id="net-f4"></span>']];
  }

  setHTML(box,
    '<section class="net-card card-strong ' + m + '" role="alertdialog" aria-labelledby="net-title">' +
      '<div class="net-head">' + SPINNER + '<div><h1 class="head" id="net-title">' + title + '</h1>' +
        '<span class="mono net-status" id="net-status" aria-live="polite"></span></div></div>' +
      '<p>' + body + '</p>' +
      '<ul class="net-facts">' + facts.map((f) => '<li><span>' + f[0] + '</span><span class="mono">' + f[1] + '</span></li>').join('') + '</ul>' +
      '<div class="net-btns"><button type="button" class="btn btn-lime" data-act="net-retry">Retry now</button>' +
        '<button type="button" class="btn btn-quiet net-leave" data-act="net-leave">Leave match</button></div>' +
    '</section>');
  tickNet();
}

function tickNet() {
  const sess = app.session;
  if (sess && sess.snap && sess.snap.pingNo !== lastPingNo) {
    lastPingNo = sess.snap.pingNo;
    lastPingWall = Date.now();
  }
  const m = mode();
  if (!m) return;
  const st = sess.link.state;
  const s = sess.snap;
  const off = offlineSec(st);
  const hostName = (s.players.find((p) => p.host) || {}).name || 'the host';
  const left = clock((s.endT - sess.T()) / 1000);
  const hold = N.hostOfflineHoldSec - off;

  setText($('#net-status'), m === 'host'
    ? 'Waiting for ' + hostName + ' · ' + clock(hold) + ' left'
    : 'Reconnecting · attempt ' + Math.max(1, st.attempt));
  setText($('#net-f1'), (m === 'host' ? 'Paused at ' : 'Running · ') + left);
  setText($('#net-f2'), lastPingWall ? clock((Date.now() - lastPingWall) / 1000) + ' ago' : 'none yet');
  setText($('#net-f3'), clock(hold));
  setText($('#net-f4'), clock(off));
  setText($('#net-f5'), off < N.spotHoldSec ? clock(N.spotHoldSec - off) : 'released: you rejoin as a hunter');

  // The host never came back.
  if (m === 'host' && hold <= 0) {
    if (sess.inMatch) {
      sess.abandon();
      app.net.destroy();
      render();
    } else {
      app.go.cleanup();
      toast('The host did not come back', 'hunter');
    }
  }
}

act('net-retry', () => app.net && app.net.retryNow());
act('net-leave', () => confirmModal(
  { title: 'Leave this match?', body: 'You give up your spot and go back to the home screen.', yes: 'Leave match', tone: 'btn-hunter' },
  () => app.go.cleanup()));

app.bus.on('session', (session) => session.on('link', render));
onRender(renderNet);
onTick(tickNet);
