// Screen 9: Results, leaderboard and route replay.

import { $, esc, setHTML, clock, joinNames, plural } from '../util.js';
import { icon } from '../icons.js';
import { MODES } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, screen, confirmModal } from './core.js';
import { replayCard } from './replay.js';
import { reportLink } from './extras.js';

const root = $('#s-results');
function longSpan(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return (m ? plural(m, 'minute') + ' ' : '') + plural(s, 'second');
}

function headline(r) {
  if (r.winner === 'hunters') {
    const lc = r.lastCatch;
    const how = lc && lc.hunter ? esc(lc.hunter) + ' caught the last prey, ' + esc(lc.prey) + ', with ' + longSpan(r.leftSec) + ' left.'
      : 'Every prey is out, with ' + longSpan(r.leftSec) + ' left.';
    return { cls: 'hunter', title: 'HUNTERS<br>WIN', text: how };
  }
  if (r.winner === 'prey') {
    return { cls: 'prey', title: 'PREY<br>SURVIVED', text: esc(joinNames(r.survivors)) + ' outlasted the hunters.' };
  }
  return {
    cls: 'none', title: 'NO<br>WINNER',
    text: r.reason === 'host-lost' ? 'The host did not come back, so the match was called off.' : 'The host ended the match early.'
  };
}

function story(row, r, top) {
  if (row.dropped && row.caughtWhy !== 'catch') return 'Left the match';
  if (row.startRole === 'hunter') return 'Starting hunter' + (row.catches && row.catches === top ? ' · MVP' : '');
  if (row.caughtL == null) return r.winner === 'prey' ? 'Survived the whole hunt' : 'Still free at the end';
  const last = r.winner === 'hunters' && r.lastCatch && r.lastCatch.prey === row.name;
  return last ? 'Last prey standing · ' + clock(row.caughtL) : 'Prey → hunter at ' + clock(row.caughtL);
}

function renderResults() {
  const s = snap();
  if (screen() !== 'results' || !s || !s.result) return;
  const r = s.result;
  const me = s.me;
  const h = headline(r);
  const mine = r.board.find((x) => x.id === me.id) || {};
  const top = Math.max(0, ...r.board.map((x) => x.catches));

  const survived = mine.startRole === 'prey' ? clock(mine.caughtL == null ? r.L : mine.caughtL) : '—';
  const watching = me.role === 'spectator';
  const stats =
    '<div class="stat"><span class="mono prey-ink">' + survived + '</span><span>survived as prey</span></div>' +
    '<div class="stat"><span class="mono hunter-ink">' + (mine.catches || 0) + '</span><span>' + (mine.catches === 1 ? 'catch' : 'catches') + ' as hunter</span></div>' +
    '<div class="stat"><span class="mono lime-ink">+' + (mine.earned || 0) + '</span><span>Glowcoin earned</span></div>';

  const board = r.board.map((row, i) =>
    '<li class="card rank' + (row.id === me.id ? ' you' : '') + '">' +
      '<span class="mono rank-n">' + (i + 1) + '</span>' +
      '<span class="rank-main"><span class="mono rank-name"><span translate="no">' + esc(row.name) + '</span>' + (row.id === me.id ? ' (you)' : '') + '</span>' +
        '<span class="small muted">' + esc(story(row, r, top)) + '</span></span>' +
      '<span class="rank-side"><span class="mono lime-ink">' + row.earned + ' GC</span><span class="small muted">' + plural(row.catches, 'catch', 'catches') + '</span></span>' +
    '</li>').join('');

  const routeCard = replayCard(s, mine);

  setHTML(root,
    '<div class="scroll results">' +
      '<section class="res-head ' + h.cls + '">' +
        '<span class="mono kicker">MATCH OVER · ' + clock(r.L) + ' · ' + esc(MODES[r.mode].name.toUpperCase()) + '</span>' +
        '<h1 class="head">' + h.title + '</h1><p>' + h.text + '</p>' +
      '</section>' +
      // A spectator has no match of their own to show or share.
      (watching ? '' : '<section class="block" aria-label="Your match"><div class="block-head"><h2 class="label">Your match</h2>' +
        '<button type="button" class="btn btn-sm share-card" data-act="share-card">' + icon('camera', 18) + 'Share result</button></div>' +
        '<div class="stats">' + stats + '</div></section>') +
      '<section class="block"><h2 class="label">Leaderboard</h2><ol class="board">' + board + '</ol></section>' +
      routeCard +
      reportLink() +
    '</div>' +
    '<footer class="foot-bar res-foot pad-b">' +
      '<button type="button" class="btn btn-line" data-act="res-home">' + icon('home', 20) + 'Home</button>' +
      (me.host
        ? '<button type="button" class="btn btn-lime head rematch" data-act="rematch">' + icon('replay', 20, 2.5) + (app.practice ? 'PRACTICE AGAIN' : 'REMATCH') + '</button>'
        : r.reason === 'host-lost' ? ''
        : '<button type="button" class="btn btn-lime head rematch" disabled>WAITING FOR HOST</button>') +
    '</footer>');
}

act('rematch', () => {
  if (!app.practice) return app.session.send({ k: 'rematch' });
  const name = app.session.name;
  app.go.cleanup();
  app.go.practice(name);
});
act('res-home', () => {
  const sess = app.session;
  if (!sess || sess.abandoned) return app.go.cleanup();
  // The host going Home closes the lobby for everyone still in it.
  const s = sess.snap;
  const others = s && s.me.host && !app.practice ? s.players.filter((p) => !p.you && p.conn).length : 0;
  if (!others) return app.go.leave();
  confirmModal(
    { title: 'Close the lobby for everyone?', body: 'You are the host. Going home sends the other ' + (others === 1 ? 'player' : others + ' players') + ' back to their home screen. Tap Rematch instead to play again with the same group.', yes: 'Close the lobby', tone: 'btn-hunter' },
    () => app.go.leave());
});

onRender(renderResults);
app.bus.on('screen', (name) => name === 'results' && renderResults());
