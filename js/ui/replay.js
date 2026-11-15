// Results: the match replay (everyone's routes on one map) and the
// shareable result card.
//
// Routes come from the host once the match is over: per player, a list of
// [lat, lng, 0 prey | 1 hunter, seconds of live play]. If the host never
// sent them (it went offline for good), this phone's own recorded path is
// used instead.

import { $, esc, clock, dist, metres } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG, MODES } from '../config.js';
import { app, snap } from '../state.js';
import { act, toast } from './core.js';
import { tr } from '../i18n.js';

const W = 358, H = 220, PAD = 20;
let scene = null;   // the last built replay: { routes, maxT, X, Y }
let raf = 0;

function routesFor(s) {
  const sent = app.session.routes;
  if (sent && sent.round === s.round && sent.list.length) return sent.list.map((r) => ({ ...r, me: r.id === s.me.id }));
  // Fallback: only my own path, with no timing. Spread it over the match.
  const own = app.session.path || [];
  if (own.length < 2) return [];
  const L = s.result ? s.result.L : 1;
  return [{ id: s.me.id, name: s.me.name, me: true, caughtAt: s.me.caughtAt, caughtL: s.me.caughtL, pts: own.map((p, i) => [p[0], p[1], p[2], Math.round((i / (own.length - 1)) * L)]) }];
}

function build(s) {
  const routes = routesFor(s);
  if (!routes.length) return null;
  const all = routes.flatMap((r) => r.pts);
  const midLat = (Math.min(...all.map((p) => p[0])) + Math.max(...all.map((p) => p[0]))) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = all.map((p) => p[1] * kx), ys = all.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 2e-4);
  const sc = Math.min((W - PAD * 2) / span, (H - PAD * 2) / span);
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const X = (lng) => ox + (lng * kx - minX) * sc;
  const Y = (lat) => H - oy - (lat - minY) * sc;
  let maxT = 1;
  for (const r of routes) {
    r.xy = r.pts.map((p) => ({ x: X(p[1]), y: Y(p[0]), role: p[2], t: p[3] }));
    r.km = r.pts.reduce((sum, p, i) => (i ? sum + dist({ lat: r.pts[i - 1][0], lng: r.pts[i - 1][1] }, { lat: p[0], lng: p[1] }) : 0), 0);
    maxT = Math.max(maxT, r.xy[r.xy.length - 1].t);
  }
  return { routes, maxT, X, Y };
}

// Points of one route up to time t, split into prey / hunter stretches.
function strokes(route, t) {
  const out = [];
  let cur = null;
  let head = route.xy[0];
  for (let i = 0; i < route.xy.length; i++) {
    const p = route.xy[i];
    if (p.t > t) {
      // Slide the head between the last shown point and the next one.
      const prev = route.xy[i - 1];
      if (prev && p.t > prev.t) {
        const k = (t - prev.t) / (p.t - prev.t);
        head = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k, role: prev.role };
        if (cur) cur.pts.push(head);
      }
      break;
    }
    if (!cur || cur.role !== p.role) {
      const join = cur ? [cur.pts[cur.pts.length - 1]] : [];
      cur = { role: p.role, pts: join };
      out.push(cur);
    }
    cur.pts.push(p);
    head = p;
  }
  return { out, head };
}

function draw(sceneNow, t) {
  let svg = '';
  // Other players first, me on top.
  const order = sceneNow.routes.slice().sort((a, b) => a.me - b.me);
  for (const r of order) {
    const { out, head } = strokes(r, t);
    for (const g of out) {
      if (g.pts.length < 2) continue;
      svg += '<polyline class="route-line ' + (g.role ? 'hunter' : 'prey') + (r.me ? ' me' : '') + '" points="' + g.pts.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') + '"/>';
    }
    if (r.caughtAt && r.caughtL != null && t >= r.caughtL) {
      svg += '<circle class="route-ring' + (r.me ? ' me' : '') + '" cx="' + sceneNow.X(r.caughtAt.lng).toFixed(1) + '" cy="' + sceneNow.Y(r.caughtAt.lat).toFixed(1) + '" r="' + (r.me ? 9 : 6) + '"/>';
    }
    svg += '<circle class="route-end ' + (head.role ? 'hunter' : 'prey') + (r.me ? ' me' : '') + '" cx="' + head.x.toFixed(1) + '" cy="' + head.y.toFixed(1) + '" r="' + (r.me ? 6 : 4.5) + '"/>' +
      '<text class="route-name' + (r.me ? ' me' : '') + '" x="' + (head.x + 8).toFixed(1) + '" y="' + (head.y + 4).toFixed(1) + '" translate="no">' + esc(r.name) + '</text>';
  }
  return svg;
}

// The replay card for the results screen.
export function replayCard(s, mine) {
  scene = build(s);
  if (!scene) return '<section class="card route empty" aria-label="Match replay"><p class="muted">No routes were recorded this match.</p></section>';
  const me = scene.routes.find((r) => r.me);
  const everyone = scene.routes.length > 1;
  const note = mine && mine.caughtL != null
    ? 'Ring: ' + (mine.caughtBy ? 'caught by ' + esc(mine.caughtBy) : 'converted') + ' at ' + clock(mine.caughtL)
    : 'Blue as prey, orange as hunter';
  const title = me
    ? 'Your route · ' + (me.km >= 1000 ? (me.km / 1000).toFixed(1) + ' km' : metres(me.km))
    : scene.routes.length + ' routes';
  return '<section class="card route" aria-label="Match replay">' +
    '<svg class="route-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of ' + (everyone ? 'everyone’s routes' : 'your route') + '" id="replay-svg">' + draw(scene, scene.maxT) + '</svg>' +
    '<div class="route-foot"><span class="route-text"><strong>' + title + '</strong>' +
      '<span class="small muted">' + note + (everyone ? ' · thick line is you' : '') + '</span></span>' +
      '<span class="mono replay-clock" id="replay-clock"></span>' +
      '<button type="button" class="btn btn-sm" data-act="replay">' + icon('replay', 18) + 'Replay</button></div>' +
  '</section>';
}

// Play the match back from the start.
act('replay', () => {
  const svg = $('#replay-svg');
  if (!svg || !scene) return;
  cancelAnimationFrame(raf);
  const total = CONFIG.replay.seconds * 1000;
  const t0 = performance.now();
  const now = scene;
  const frame = (ts) => {
    const k = Math.min(1, (ts - t0) / total);
    const t = k * now.maxT;
    svg.innerHTML = draw(now, t);
    const label = $('#replay-clock');
    if (label) label.textContent = k < 1 ? clock(t) : '';
    if (k < 1 && svg.isConnected) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
});

// ---------------------------------------------------------------- share card
// A 1080 x 1350 image: result, your numbers and the route map.
const CW = 1080, CH = 1350;

async function drawCard(s) {
  const r = s.result;
  const mine = r.board.find((x) => x.id === s.me.id) || {};
  const rank = r.board.findIndex((x) => x.id === s.me.id) + 1;
  try {
    await Promise.all([document.fonts.load('700 96px "Chakra Petch"'), document.fonts.load('700 48px "JetBrains Mono"'), document.fonts.load('600 40px Inter')]);
  } catch (e) { /* system fonts will do */ }

  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const g = c.getContext('2d');
  const head = '"Chakra Petch", "PingFang SC", "Microsoft YaHei", sans-serif';
  const mono = '"JetBrains Mono", ui-monospace, monospace';
  const body = 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const LIME = '#C8FF2E', ORANGE = '#FF6B2C', BLUE = '#5CC8FF', INK = '#0A0C0B', TEXT = '#F4F7F5', MUTED = '#A3ADA7';

  g.fillStyle = INK;
  g.fillRect(0, 0, CW, CH);
  // faint target rings
  g.strokeStyle = '#1E2622';
  g.lineWidth = 3;
  for (const rad of [180, 330, 480]) { g.beginPath(); g.arc(CW - 60, 120, rad, 0, Math.PI * 2); g.stroke(); }

  // wordmark
  g.strokeStyle = LIME;
  g.lineWidth = 8;
  g.beginPath(); g.arc(104, 112, 30, 0, Math.PI * 2); g.stroke();
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { g.beginPath(); g.moveTo(104 + dx * 22, 112 + dy * 22); g.lineTo(104 + dx * 48, 112 + dy * 48); g.stroke(); }
  g.fillStyle = TEXT;
  g.font = '700 54px ' + head;
  g.textBaseline = 'middle';
  g.fillText('CITY HUNTER', 172, 114);

  // headline
  const win = r.winner === 'hunters' ? ['HUNTERS', 'WIN', ORANGE] : r.winner === 'prey' ? ['PREY', 'SURVIVED', BLUE] : ['NO', 'WINNER', TEXT];
  g.fillStyle = win[2];
  g.font = '700 168px ' + head;
  g.textBaseline = 'alphabetic';
  g.fillText(tr(win[0]), 72, 370);
  g.fillText(tr(win[1]), 72, 520);
  g.fillStyle = MUTED;
  g.font = '700 30px ' + mono;
  g.fillText(clock(r.L) + '  ·  ' + tr(MODES[r.mode].name).toUpperCase(), 76, 580);

  // my line
  g.fillStyle = TEXT;
  g.font = '700 54px ' + mono;
  g.fillText(s.me.name, 72, 680);
  if (rank) {
    g.fillStyle = LIME;
    g.font = '700 40px ' + mono;
    const label = '#' + rank + ' / ' + r.board.length;
    g.fillText(label, CW - 72 - g.measureText(label).width, 680);
  }

  // stat tiles
  const survived = mine.startRole === 'prey' ? clock(mine.caughtL == null ? r.L : mine.caughtL) : '—';
  const tiles = [[survived, tr('survived as prey'), BLUE], [String(mine.catches || 0), tr(mine.catches === 1 ? 'catch as hunter' : 'catches as hunter'), ORANGE], ['+' + (mine.earned || 0), tr('Glowcoin earned'), LIME]];
  tiles.forEach((tile, i) => {
    const x = 72 + i * 320, y = 730, w = 296, h = 180;
    g.fillStyle = '#151917';
    g.strokeStyle = '#2C332F';
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(x, y, w, h, 28); g.fill(); g.stroke();
    g.fillStyle = tile[2];
    g.font = '700 64px ' + mono;
    g.fillText(tile[0], x + 28, y + 88);
    g.fillStyle = MUTED;
    g.font = '600 28px ' + body;
    g.fillText(tile[1], x + 28, y + 140);
  });

  // route map
  const box = { x: 72, y: 950, w: CW - 144, h: 290 };
  g.fillStyle = '#0E1210';
  g.strokeStyle = '#2C332F';
  g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 28); g.fill(); g.stroke();
  const sc = build(s);
  if (sc) {
    const k = Math.min(box.w / W, box.h / H);
    const dx = box.x + (box.w - W * k) / 2, dy = box.y + (box.h - H * k) / 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const route of sc.routes.slice().sort((a, b) => a.me - b.me)) {
      for (const seg of strokes(route, sc.maxT).out) {
        if (seg.pts.length < 2) continue;
        g.strokeStyle = seg.role ? ORANGE : BLUE;
        g.globalAlpha = route.me ? 1 : 0.45;
        g.lineWidth = route.me ? 9 : 5;
        g.beginPath();
        seg.pts.forEach((p, i) => (i ? g.lineTo(dx + p.x * k, dy + p.y * k) : g.moveTo(dx + p.x * k, dy + p.y * k)));
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  g.fillStyle = MUTED;
  g.font = '600 28px ' + body;
  g.fillText(location.host + location.pathname.replace(/index\.html$/, ''), 72, CH - 48);
  return c;
}

act('share-card', async () => {
  const s = snap();
  if (!s || !s.result) return;
  const canvas = await drawCard(s);
  app.lastCard = canvas;   // for tests
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'city-hunter-result.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'City Hunter' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  // No share sheet (desktop): save the image instead.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Result image saved', 'lime', 2000);
});
