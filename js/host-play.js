// Host feature: pings, Glowcoin, the ability shop, abilities, chat, and the
// rules for who sees whom on the map.

import { CONFIG, ECONOMY, ABILITIES } from './config.js';
import { dist, bearing } from './util.js';

const P = CONFIG.ping;

export function installPlay(host) {
  const G = () => host.G;

  // ---------------------------------------------------------- pings
  // scheduled: the regular timed ping (pays prey, burns Ghost, ages decoys)
  // otherwise: a forced ping from Scan or the host console
  host.doPing = ({ scheduled = false, onlyPrey = false } = {}) => {
    const g = G();
    const now = Date.now();
    for (const p of host.active()) {
      if (onlyPrey && p.role !== 'prey') continue;
      if (p.role === 'prey' && scheduled) {
        p.gc += ECONOMY.perPingSurvived;
        p.earned += ECONOMY.perPingSurvived;
        p.pings++;
        if (p.fx.ghost) {
          p.fx.ghost = false;
          host.note(p, 'Ghost used: this ping was skipped', 'lime');
          continue;
        }
      }
      // No fresh position (GPS lost or offline): the old ping stands and
      // its circle keeps growing on the other side's map.
      if (!host.fresh(p, now)) continue;
      p.ping = {
        lat: p.pos.lat, lng: p.pos.lng, acc: p.pos.acc, t: g.T,
        prev: p.ping ? { lat: p.ping.lat, lng: p.ping.lng } : null
      };
    }
    if (scheduled) {
      g.pingNo++;
      // Decoys show up alongside the real ping for a few cycles.
      g.decoys = g.decoys.filter((d) => d.left-- > 0);
      for (const d of g.decoys) d.t = g.T;
      for (const h of host.hunters()) {
        if (h.fx.tracker && g.pingNo > h.fx.tracker.fromPing + ABILITIES.tracker.pings) h.fx.tracker = null;
      }
    }
    host.dirty = true;
  };

  host.hooks.live.push((now) => {
    const g = G();
    while (host.inMatch && g.T >= g.nextPingT) {
      host.doPing({ scheduled: true });
      g.nextPingT += g.rules.pingSec * 1000;
    }
    if (g.lock && g.lock.untilT <= g.T) {
      g.lock = null;
      host.evAll({ type: 'toast', text: 'Lockdown over: the zone is back to full size' });
    }
    // Proximity Radar
    const R = ABILITIES.radar;
    for (const h of host.hunters()) {
      if (!(h.fx.radarT > g.T) || !host.fresh(h, now)) continue;
      if (now - (h.fx.radarAt || 0) < R.repeatSec * 1000) continue;
      const near = host.prey().some((q) => host.fresh(q, now) && dist(h.pos, q.pos) <= R.rangeM);
      if (near) {
        h.fx.radarAt = now;
        host.ev(h, { type: 'radar' });
      }
    }
  });

  // ---------------------------------------------------------- shop
  host.on('buy', (p, m) => {
    const a = ABILITIES[m.id];
    if (!a || !host.inMatch) return;
    if (p.gc < a.cost) return host.note(p, 'You need ' + (a.cost - p.gc) + ' more GC for ' + a.name);
    p.gc -= a.cost;
    p.inv[a.id] = (p.inv[a.id] || 0) + 1;
  });

  const take = (p, id) => {
    if (!(p.inv[id] > 0)) return false;
    p.inv[id]--;
    return true;
  };

  const USE = {
    ghost(p) {
      if (p.fx.ghost) {           // tap again to cancel and get it back
        p.fx.ghost = false;
        p.inv.ghost = (p.inv.ghost || 0) + 1;
        return;
      }
      if (take(p, 'ghost')) p.fx.ghost = true;
    },
    decoy(p) {
      if (!host.fresh(p)) return host.note(p, 'Decoy needs a GPS fix');
      if (!take(p, 'decoy')) return;
      const g = G();
      g.decoys.push({ id: ++g.evN, owner: p.id, lat: p.pos.lat, lng: p.pos.lng, acc: p.pos.acc, t: null, left: ABILITIES.decoy.pings });
      host.note(p, 'Decoy armed. It appears at your next ping.', 'lime');
    },
    jammer(p) {
      if (take(p, 'jammer')) p.fx.jamT = G().T + ABILITIES.jammer.durationSec * 1000;
    },
    safehouse(p) {
      if (!host.fresh(p)) return host.note(p, 'Safe House needs a GPS fix');
      if (!take(p, 'safehouse')) return;
      const a = ABILITIES.safehouse;
      p.fx.safe = { lat: p.pos.lat, lng: p.pos.lng, r: a.radiusM, untilT: G().T + a.durationSec * 1000 };
    },
    scan(p) {
      if (!take(p, 'scan')) return;
      host.doPing({ onlyPrey: true });
      host.evAll({ type: 'toast', text: p.name + ' used Scan: fresh fix on every prey', tone: 'hunter' }, (q) => q.role === 'hunter' && q !== p);
      host.evAll({ type: 'toast', text: 'Hunters used Scan: your position was pinged', tone: 'hunter' }, (q) => q.role === 'prey');
      host.note(p, 'Scan complete', 'lime');
    },
    tracker(p) {
      if (!host.fresh(p)) return host.note(p, 'Tracker needs a GPS fix');
      const seen = host.prey().filter((q) => q.ping).sort((a, b) => dist(p.pos, a.ping) - dist(p.pos, b.ping));
      if (!seen.length) return host.note(p, 'No prey has pinged yet');
      if (!take(p, 'tracker')) return;
      p.fx.tracker = { target: seen[0].id, fromPing: G().pingNo };
      host.note(p, 'Tracking ' + seen[0].name + ' for the next ' + ABILITIES.tracker.pings + ' pings', 'lime');
    },
    radar(p) {
      if (take(p, 'radar')) p.fx.radarT = G().T + ABILITIES.radar.durationSec * 1000;
    },
    lockdown(p) {
      const g = G();
      if (g.lock) return host.note(p, 'A Lockdown is already running');
      if (!take(p, 'lockdown')) return;
      const a = ABILITIES.lockdown;
      g.lock = { untilT: g.T + a.durationSec * 1000, factor: 1 - a.shrink, by: p.id };
      host.evAll({ type: 'toast', text: 'Lockdown: the zone shrinks by ' + Math.round(a.shrink * 100) + '% for ' + Math.round(a.durationSec / 60) + ' min', tone: 'hunter' });
    }
  };

  host.on('use', (p, m) => {
    const a = ABILITIES[m.id];
    const g = G();
    if (!a || !host.inMatch || g.paused) return;
    if (a.side !== p.role) return host.note(p, a.name + ' is a ' + a.side + ' ability');
    if (a.side === 'hunter' && g.phase !== 'live') return host.note(p, 'Locked until the head start ends');
    USE[a.id](p);
  });

  // ---------------------------------------------------------- chat
  const channelOf = (p, ch) => (ch === 'all' || !host.inMatch ? 'all' : p.role);

  host.on('chat', (p, m) => {
    const g = G();
    const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, CONFIG.chat.maxLength);
    if (!text) return;
    const key = channelOf(p, m.ch);
    const entry = { k: 'chat', n: ++g.chatN, ch: key === 'all' ? 'all' : 'team', from: p.id, name: p.name, role: p.role, text, T: Math.round(g.T) };
    g.chat[key].push(entry);
    if (g.chat[key].length > CONFIG.chat.history) g.chat[key].shift();
    for (const q of host.all()) if (key === 'all' || q.role === key) host.to(q, entry);
  });

  const sendHistory = (p) => {
    const g = G();
    host.to(p, { k: 'chathist', ch: 'all', list: g.chat.all });
    host.to(p, { k: 'chathist', ch: 'team', list: host.inMatch ? g.chat[p.role] : [] });
  };
  host.hooks.hello.push(sendHistory);
  host.hooks.convert.push((q) => sendHistory(q));   // joins the hunter channel
  host.hooks.start.push(() => host.all().forEach(sendHistory));

  // ---------------------------------------------------------- who sees what
  const pingRadius = (q) => {
    const jam = q.fx.jamT > G().T ? ABILITIES.jammer.factor : 1;
    return Math.round(Math.max(P.baseRadiusM, q.ping.acc) * jam);
  };

  host.hooks.view.push((p, v) => {
    const g = G();
    if (!host.inMatch) return;
    const now = Date.now();
    v.pingNo = g.pingNo;

    const tr = p.fx.tracker;
    const trTarget = tr ? g.players[tr.target] : null;
    v.me.fx = {
      ghost: !!p.fx.ghost,
      jamT: p.fx.jamT > g.T ? p.fx.jamT : 0,
      safe: p.fx.safe && p.fx.safe.untilT > g.T ? p.fx.safe : null,
      radarT: p.fx.radarT > g.T ? p.fx.radarT : 0,
      tracker: trTarget && trTarget.role === 'prey' ? { name: trTarget.name, left: tr.fromPing + ABILITIES.tracker.pings - g.pingNo } : null,
      decoys: g.decoys.filter((d) => d.owner === p.id).map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, left: d.left }))
    };

    if (p.role === 'hunter') {
      // Prey: last ping only (plus any decoys, which look identical).
      for (const q of host.prey()) {
        if (!q.ping) continue;
        const item = { id: q.id, name: q.name, kind: 'prey', lat: q.ping.lat, lng: q.ping.lng, r: pingRadius(q), t: q.ping.t, lost: q.gps.graceOut };
        if (tr && tr.target === q.id && g.pingNo > tr.fromPing && q.ping.prev && dist(q.ping.prev, q.ping) > 3) {
          item.hdg = Math.round(bearing(q.ping.prev, q.ping));
        }
        v.pings.push(item);
      }
      for (const d of g.decoys) {
        const owner = g.players[d.owner];
        if (d.t == null || !owner || owner.role !== 'prey' || !owner.ping) continue;
        v.pings.push({ id: 'decoy' + d.id, name: owner.name, kind: 'prey', lat: d.lat, lng: d.lng, r: pingRadius(owner), t: d.t });
      }
      // Teammates: live.
      for (const q of host.hunters()) {
        if (q === p || !q.pos) continue;
        v.live.push({ id: q.id, name: q.name, kind: 'mate', lat: q.pos.lat, lng: q.pos.lng, stale: !host.fresh(q, now) });
      }
    } else {
      // Prey see where the hunters were at the last ping.
      for (const q of host.hunters()) {
        if (!q.ping) continue;
        v.pings.push({ id: q.id, name: q.name, kind: 'hunter', lat: q.ping.lat, lng: q.ping.lng, r: Math.round(Math.max(P.baseRadiusM, q.ping.acc)), t: q.ping.t });
      }
    }
  });
}
