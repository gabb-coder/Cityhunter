// Host feature: end-of-match awards.
//
// Worked out from what the host already knows: who survived longest, who
// made the first catch, who caught the most, who covered the most ground,
// and which free prey had the closest call with a hunter.

import { CONFIG } from './config.js';
import { dist } from './util.js';

const A = CONFIG.awards;

export function installAwards(host) {
  const G = () => host.G;
  let lastScan = 0;

  host.hooks.start.push(() => {
    G().firstCatch = null;
  });

  // Closest approach: how near a hunter got to each prey still free.
  host.hooks.live.push((now) => {
    if (now - lastScan < 1000) return;
    lastScan = now;
    const hunters = host.hunters().filter((h) => host.fresh(h, now));
    if (!hunters.length) return;
    for (const q of host.prey()) {
      if (!host.fresh(q, now)) continue;
      for (const h of hunters) {
        const d = dist(q.pos, h.pos);
        if (q.closest == null || d < q.closest) q.closest = d;
      }
    }
  });

  host.hooks.convert.push((q, by, why) => {
    const g = G();
    if (why === 'catch' && by && !g.firstCatch) g.firstCatch = { pid: by.id, name: by.name, other: q.name, sec: Math.round(host.liveSec()) };
  });

  const pathMetres = (p) => {
    let m = 0;
    for (let i = 1; i < p.path.length; i++) m += dist({ lat: p.path[i - 1][0], lng: p.path[i - 1][1] }, { lat: p.path[i][0], lng: p.path[i][1] });
    return m;
  };
  const top = (list, value) => {
    let best = null;
    for (const p of list) {
      const v = value(p);
      if (v != null && (!best || v > best.v)) best = { p, v };
    }
    return best;
  };

  host.hooks.end.push(() => {
    const g = G();
    if (!g.result) return;
    const players = host.players().filter((p) => !p.dropped);
    const out = [];
    const add = (id, p, value, other) => out.push({ id, pid: p.id, name: p.name, value: Math.round(value), other });
    if (players.length >= A.minPlayers) {
      const startedPrey = players.filter((p) => p.startRole === 'prey');
      const survivor = top(startedPrey, (p) => ((p.caughtT == null ? g.T : p.caughtT) - g.headT) / 1000);
      if (survivor && survivor.v > 0) add('survivor', survivor.p, survivor.v);

      if (g.firstCatch) out.push({ id: 'first', pid: g.firstCatch.pid, name: g.firstCatch.name, value: g.firstCatch.sec, other: g.firstCatch.other });

      const hunter = top(players, (p) => (p.catches >= A.topHunterMinCatches ? p.catches : null));
      if (hunter) add('hunter', hunter.p, hunter.v);

      const walker = top(players, (p) => { const m = pathMetres(p); return m >= A.minDistanceM ? m : null; });
      if (walker) add('distance', walker.p, walker.v);

      // Still free at the end, after a hunter got this close.
      const free = players.filter((p) => p.role === 'prey' && p.closest != null && p.closest <= A.escapeWithinM);
      const escape = top(free, (p) => -p.closest);
      if (escape) add('escape', escape.p, -escape.v);
    }
    g.result.awards = out;
  });
}
