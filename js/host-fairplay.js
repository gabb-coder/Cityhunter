// Host feature: fair play.
//
//   Impossible moves   a position that implies an impossible speed is flagged
//                      to the host player and shown in the host console. It
//                      is a flag, not a verdict: GPS does glitch.
//   Head-start hold    hunters must stay near where they stood when the head
//                      start began. A hunter who is outside that circle when
//                      the head start ends cannot catch for a penalty period.

import { CONFIG } from './config.js';
import { dist } from './util.js';

const F = CONFIG.fair;

export function installFairplay(host) {
  const G = () => host.G;
  const boss = () => G().players[G().hostPid];

  host.hooks.pos.push((p, next, now) => {
    const g = G();
    if (g.practice) return;   // practice rounds teleport on purpose

    // ---- impossible moves ----
    if (p.pos && p.posAt) {
      const dt = Math.max(1, (now - p.posAt) / 1000);
      // Only count what the two accuracy circles cannot explain.
      const moved = dist(p.pos, next) - p.pos.acc - next.acc;
      if (moved >= F.jumpMinM && moved / dt > F.maxSpeedMps) {
        p.flags.jumps++;
        if (now - p.flags.lastAt > F.flagRepeatSec * 1000) {
          p.flags.lastAt = now;
          const b = boss();
          if (b) host.note(b, p.name + ' moved ' + Math.round(moved) + ' m in ' + Math.round(dt) + ' s: GPS glitch or spoofing', 'hunter');
        }
        host.dirty = true;
      }
    }

    // ---- head-start hold ----
    if (g.phase === 'headstart' && p.role === 'hunter') {
      // The start point is the first fix of the head start. One that only
      // shows up late (GPS switched on after walking off) does not count.
      if (!p.hold) p.hold = { lat: next.lat, lng: next.lng, out: false, d: 0, late: g.T > F.holdSetWithinSec * 1000 };
      // Poor accuracy excuses some of the distance, but only so much.
      const d = Math.max(0, dist(p.hold, next) - Math.min(next.acc, F.holdAccSlackMaxM));
      const out = d > F.holdRadiusM;
      if (out !== p.hold.out) host.dirty = true;
      p.hold.out = out;
      p.hold.d = Math.round(d);
    }
  });

  // Head start over: anyone still out of position pays for it.
  host.hooks.release.push(() => {
    const g = G();
    if (g.practice) return;
    const now = Date.now();
    for (const h of host.hunters()) {
      // Only hunters who started the match as hunters had a point to hold
      // (not late joiners, and not a prey the host moved across).
      if (h.late || h.startRole !== 'hunter') continue;
      // In position means a live fix inside the circle. A hunter whose GPS
      // is off at release cannot show that, so they are treated as out.
      const noFix = !h.hold || h.hold.late || !host.fresh(h, now);
      if (!noFix && !h.hold.out) continue;
      const b = boss();
      if (F.holdPenaltySec > 0) {
        h.penaltyT = g.T + F.holdPenaltySec * 1000;
        host.note(h, (noFix ? 'No GPS fix at your start point when the head start ended' : 'You left your start point during the head start') + ': no catches for ' + F.holdPenaltySec + ' s', 'hunter');
      }
      if (b && b !== h) host.note(b, noFix ? h.name + ' had no GPS fix at their start point when the head start ended' : h.name + ' left their start point during the head start (' + h.hold.d + ' m)', 'hunter');
    }
  });

  host.hooks.view.push((p, v) => {
    const g = G();
    if (!host.inMatch) return;
    if (p.role === 'hunter') {
      if (g.phase === 'headstart' && p.hold) v.me.hold = { lat: p.hold.lat, lng: p.hold.lng, r: F.holdRadiusM, out: p.hold.out, d: p.hold.d };
      v.me.penaltyT = p.penaltyT > g.T ? p.penaltyT : 0;
    }
    if (p.role === 'hunter' && g.phase === 'headstart' && !p.hold) v.me.holdWait = true;   // no fix yet: no start point
    if (v.admin) for (const row of v.admin) row.jumps = g.players[row.id] ? g.players[row.id].flags.jumps : 0;
  });
}
