// Screen 9: Results, leaderboard and route replay.

import { $, esc, setHTML, clock, dist, metres, joinNames, plural } from '../util.js';
import { icon } from '../icons.js';
import { MODES } from '../config.js';
import { app, snap } from '../state.js';
import { act, onRender, screen } from './core.js';

const root = $('#s-results');
const W = 358, H = 190, PAD = 18;

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

// Own route as an SVG: blue while prey, orange after conversion, a ring
// where the catch happened. Returns { svg, km }.
function routeSvg(s) {
  const pts = app.session.path || [];
  if (pts.length < 2) return null;
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = lngs.map((v) => v * kx), ys = lats;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);
  const sc = Math.min((W - PAD * 2) / span, (H - PAD * 2) / span);
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const X = (lng) => ox + (lng * kx - minX) * sc;
  const Y = (lat) => H - oy - (lat - minY) * sc;

  let total = 0;
  const seg = { 0: [], 1: [] };
  let cur = null;
  pts.forEach((p, i) => {
    if (i) total += dist({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: p[0], lng: p[1] });
    if (!cur || cur.role !== p[2]) {
      const start = cur ? [cur.pts[cur.pts.length - 1]] : [];
      cur = { role: p[2], pts: start };
      seg[p[2]].push(cur);
    }
    cur.pts.push(X(p[1]).toFixed(1) + ',' + Y(p[0]).toFixed(1));
  });
  const lines = (role, cls) => seg[role].map((g) => '<polyline class="route-line ' + cls + '" pathLength="1" points="' + g.pts.join(' ') + '"/>').join('');
  const at = s.me.caughtAt;
  const ring = at ? '<circle class="route-ring" cx="' + X(at.lng).toFixed(1) + '" cy="' + Y(at.lat).toFixed(1) + '" r="9"/>' : '';
  const a = pts[0], b = pts[pts.length - 1];
  const svg = '<svg class="route-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of your route">' +
    lines(0, 'prey') + lines(1, 'hunter') + ring +
    '<circle class="route-end start" cx="' + X(a[1]).toFixed(1) + '" cy="' + Y(a[0]).toFixed(1) + '" r="5"/>' +
    '<circle class="route-end ' + (b[2] ? 'hunter' : 'prey') + '" cx="' + X(b[1]).toFixed(1) + '" cy="' + Y(b[0]).toFixed(1) + '" r="6"/>' +
  '</svg>';
  return { svg, km: total };
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
  const stats =
    '<div class="stat"><span class="mono prey-ink">' + survived + '</span><span>survived as prey</span></div>' +
    '<div class="stat"><span class="mono hunter-ink">' + (mine.catches || 0) + '</span><span>' + (mine.catches === 1 ? 'catch' : 'catches') + ' as hunter</span></div>' +
    '<div class="stat"><span class="mono lime-ink">+' + (mine.earned || 0) + '</span><span>Glowcoin earned</span></div>';

  const board = r.board.map((row, i) =>
    '<li class="card rank' + (row.id === me.id ? ' you' : '') + '">' +
      '<span class="mono rank-n">' + (i + 1) + '</span>' +
      '<span class="rank-main"><span class="mono rank-name">' + esc(row.name) + (row.id === me.id ? ' (you)' : '') + '</span>' +
        '<span class="small muted">' + esc(story(row, r, top)) + '</span></span>' +
      '<span class="rank-side"><span class="mono lime-ink">' + row.earned + ' GC</span><span class="small muted">' + plural(row.catches, 'catch', 'catches') + '</span></span>' +
    '</li>').join('');

  const route = routeSvg(s);
  const caughtNote = mine.caughtL != null
    ? 'Ring: ' + (mine.caughtBy ? 'caught by ' + esc(mine.caughtBy) : 'converted') + ' at ' + clock(mine.caughtL)
    : 'Blue as prey, orange as hunter';
  const routeCard = route
    ? '<section class="card route" aria-label="Route replay">' + route.svg +
        '<div class="route-foot"><span class="route-text"><strong>Your route · ' + (route.km >= 1000 ? (route.km / 1000).toFixed(1) + ' km' : metres(route.km)) + '</strong>' +
          '<span class="small muted">' + caughtNote + '</span></span>' +
          '<button type="button" class="btn btn-sm" data-act="replay">' + icon('replay', 18) + 'Replay</button></div>' +
      '</section>'
    : '<section class="card route empty" aria-label="Route replay"><p class="muted">No route was recorded for you this match.</p></section>';

  setHTML(root,
    '<div class="scroll results">' +
      '<section class="res-head ' + h.cls + '">' +
        '<span class="mono kicker">MATCH OVER · ' + clock(r.L) + ' · ' + esc(MODES[r.mode].name.toUpperCase()) + '</span>' +
        '<h1 class="head">' + h.title + '</h1><p>' + h.text + '</p>' +
      '</section>' +
      '<section class="block" aria-label="Your match"><h2 class="label">Your match</h2><div class="stats">' + stats + '</div></section>' +
      '<section class="block"><h2 class="label">Leaderboard</h2><ol class="board">' + board + '</ol></section>' +
      routeCard +
    '</div>' +
    '<footer class="foot-bar res-foot pad-b">' +
      '<button type="button" class="btn btn-line" data-act="res-home">' + icon('home', 20) + 'Home</button>' +
      (me.host
        ? '<button type="button" class="btn btn-lime head rematch" data-act="rematch">' + icon('replay', 20, 2.5) + 'REMATCH</button>'
        : '<button type="button" class="btn btn-lime head rematch" disabled>WAITING FOR HOST</button>') +
    '</footer>');
}

act('rematch', () => app.session.send({ k: 'rematch' }));
act('res-home', () => app.go.leave());

// Redraw the route from start to finish.
act('replay', () => {
  const lines = Array.from(root.querySelectorAll('.route-line'));
  if (!lines.length || !lines[0].animate) return;
  const each = Math.max(350, 3200 / lines.length);
  lines.forEach((el, i) => {
    el.style.strokeDasharray = '1';
    el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: each, delay: i * each, fill: 'backwards', easing: 'linear' });
  });
  const ring = root.querySelector('.route-ring');
  if (ring) ring.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: each * lines.length, fill: 'backwards' });
});

onRender(renderResults);
app.bus.on('screen', (name) => name === 'results' && renderResults());
