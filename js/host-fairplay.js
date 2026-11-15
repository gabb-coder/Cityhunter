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
      if (!p.hold) p.hold = { lat: next.lat, lng: next.lng, out: false, d: 0 };
      const d = Math.max(0, dist(p.hold, next) - next.acc);
      const out = d > F.holdRadiusM;
      if (out !== p.hold.out) host.dirty = true;
      p.hold.out = out;
      p.hold.d = Math.round(d);
    }
  });

  // Head start over: anyone still out of position pays for it.
  host.hooks.release.push(() => {
    const g = G();
    for (const h of host.hunters()) {
      if (!h.hold || !h.hold.out) continue;
      const b = boss();
      if (F.holdPenaltySec > 0) {
        h.penaltyT = g.T + F.holdPenaltySec * 1000;
        host.note(h, 'You left your start point during the head start: no catches for ' + F.holdPenaltySec + ' s', 'hunter');
      }
      if (b && b !== h) host.note(b, h.name + ' left their start point during the head start (' + h.hold.d + ' m)', 'hunter');
    }
  });

  host.hooks.view.push((p, v) => {
    const g = G();
    if (!host.inMatch) return;
    if (p.role === 'hunter') {
      if (g.phase === 'headstart' && p.hold) v.me.hold = { lat: p.hold.lat, lng: p.hold.lng, r: F.holdRadiusM, out: p.hold.out, d: p.hold.d };
      v.me.penaltyT = p.penaltyT > g.T ? p.penaltyT : 0;
    }
    if (v.admin) for (const row of v.admin) row.jumps = g.players[row.id] ? g.players[row.id].flags.jumps : 0;
  });
}
