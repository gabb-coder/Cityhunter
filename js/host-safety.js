// Host feature: GPS lost and out of zone.
//
// GPS lost: a player whose position has gone stale keeps their last ping on
// the other side's map. Once the grace period runs out the host player is
// told and that player's circle is allowed to keep widening (js/host-play.js
// marks the ping `lost`, the map lifts the radius cap).
//
// Out of zone: a prey outside the zone gets a countdown. At zero their live
// position is shown to every hunter until they are back inside.

import { CONFIG } from './config.js';
import { dist } from './util.js';

export function installSafety(host) {
  const G = () => host.G;

  function graceOut(p) {
    if (p.gps.graceOut) return;
    p.gps.graceOut = true;
    const boss = G().players[G().hostPid];
    if (boss && boss !== p) host.note(boss, p.name + ' has had no GPS for ' + CONFIG.gps.graceSec + ' s. Their circle is now widening.', 'hunter');
    host.dirty = true;
  }

  // The client's own grace countdown ran out.
  host.on('gps', (p, m) => {
    if (host.inMatch && m.graceOut) {
      if (p.gps.lostT == null) p.gps.lostT = G().T;
      graceOut(p);
    }
  });

  host.hooks.live.push((now) => {
    const g = G();
    const z = host.zoneNow();
    for (const p of host.active()) {
      const fresh = host.fresh(p, now);

      // ---- GPS ----
      if (fresh) {
        if (p.gps.lostT != null || p.gps.graceOut) {
          p.gps = { lostT: null, graceOut: false };
          host.dirty = true;
        }
      } else {
        if (p.gps.lostT == null) p.gps.lostT = g.T;
        if (g.T - p.gps.lostT > CONFIG.gps.graceSec * 1000) graceOut(p);
      }

      // ---- zone (prey only, and only on a position we trust) ----
      if (p.role !== 'prey' || !fresh || !z) continue;
      const outside = dist(p.pos, z) > z.r;
      if (outside) {
        if (p.out.sinceT == null) {
          p.out.sinceT = g.T;
          host.dirty = true;
        }
        if (!p.out.revealed && g.T - p.out.sinceT >= CONFIG.zone.outGraceSec * 1000) {
          p.out.revealed = true;
          host.evAll({ type: 'toast', tone: 'hunter', text: p.name + ' left the zone: live position revealed' }, (q) => q.role === 'hunter');
        }
      } else if (p.out.sinceT != null) {
        if (p.out.revealed) host.evAll({ type: 'toast', text: p.name + ' is back inside the zone' }, (q) => q.role === 'hunter');
        p.out = { sinceT: null, revealed: false };
        host.dirty = true;
      }
    }
  });

  host.hooks.view.push((p, v) => {
    if (!host.inMatch) return;
    v.me.out = { sinceT: p.out.sinceT, revealed: p.out.revealed };
    v.me.gps = { graceOut: p.gps.graceOut };
    if (p.role === 'hunter') {
      for (const q of host.prey()) {
        if (q.out.revealed && q.pos) v.live.push({ id: q.id, name: q.name, kind: 'revealed', lat: q.pos.lat, lng: q.pos.lng });
      }
    }
  });
}
