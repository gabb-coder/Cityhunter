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

      // ---- zone (prey only) ----
      if (p.role !== 'prey' || !z) continue;
      // Without a fresh fix nobody can say they came back in, so a prey who
      // was last seen outside stays "outside": the countdown keeps running.
      const outside = fresh ? dist(p.pos, z) > z.r : p.out.sinceT != null;
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

  // ---- "Need help": pause for everyone and show where the player is ----
  host.on('help', (p, m) => {
    const g = G();
    if (!host.inMatch) return;
    if (m.on) {
      // Only someone playing can stop the match.
      if (g.help || p.role === 'spectator' || p.dropped) return;
      g.help = { by: p.id, T: g.T };
      host.pause('help');
      host.evAll({ type: 'help', name: p.name }, (q) => q !== p);
    } else if (g.help && (g.help.by === p.id || host.isHost(p))) {
      host.endHelp();
    }
  });

  // Players can keep walking while the clock is stopped. So that the pause
  // cannot be used to slip away, a prey who asked for it is shown live to
  // the hunters for a short while after play resumes.
  host.endHelp = () => {
    const g = G();
    if (!g.help) return;
    const asker = g.players[g.help.by];
    g.help = null;
    host.resume('help');
    host.evAll({ type: 'toast', text: 'Match resumed', tone: 'lime' });
    const sec = CONFIG.safety.revealAfterHelpSec;
    if (asker && asker.role === 'prey' && !asker.dropped && sec > 0 && g.phase === 'live') {
      asker.helpRevealT = g.T + sec * 1000;
      host.note(asker, 'Hunters can see you live for ' + sec + ' s after a help pause', 'hunter');
    }
  };

  host.hooks.view.push((p, v) => {
    const g = G();
    const h = g.help && g.players[g.help.by];
    if (!host.inMatch || !h) return;
    v.help = { id: h.id, name: h.name, you: h === p };
    if (CONFIG.safety.showHelperLocation && h.pos) {
      v.help.lat = h.pos.lat;
      v.help.lng = h.pos.lng;
    }
  });

  host.hooks.view.push((p, v) => {
    if (!host.inMatch) return;
    const g = G();
    const now = Date.now();
    v.me.out = { sinceT: p.out.sinceT, revealed: p.out.revealed };
    v.me.gps = { graceOut: p.gps.graceOut };
    if (p.helpRevealT > g.T) v.me.helpRevealT = p.helpRevealT;
    if (p.role === 'hunter') {
      for (const q of host.prey()) {
        const why = q.out.revealed ? 'zone' : q.helpRevealT > g.T ? 'help' : null;
        if (why && q.pos) v.live.push({ id: q.id, name: q.name, kind: 'revealed', why, lat: q.pos.lat, lng: q.pos.lng, stale: !host.fresh(q, now) });
      }
    }
  });
}
