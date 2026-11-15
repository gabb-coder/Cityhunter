// Host feature: handover.
//
// If the host's phone dies, the match used to end with no winner. Now one
// player is the deputy: the host sends them a backup of the match every few
// seconds, and if the host stays unreachable the deputy's phone becomes the
// host (js/app.js, takeOver) under the same lobby code. Everyone else is
// already redialling that code, so they land on the new host by themselves.
//
// The backup is slimmed first. A deputy is a player, so it must not hold
// what a player may not see: no positions, pings, routes, PINs, decoys,
// Safe House spots, team pins or team chat. After a takeover every prey gets
// a new PIN and everyone is pinged afresh from their next position.
//
// If the old host comes back, it finds its lobby code held by someone else
// (js/net.js, "holder") and rejoins as an ordinary player.

import { CONFIG } from './config.js';

const N = CONFIG.net;

export function slimGame(G) {
  const g = JSON.parse(JSON.stringify(G, (k, v) => (k === 'cid' ? undefined : v)));
  g.decoys = [];
  g.marks = [];
  g.help = null;
  g.chat = { all: (g.chat && g.chat.all) || [], prey: [], hunter: [], spectator: [] };
  for (const p of Object.values(g.players)) {
    p.pos = null;
    p.posAt = 0;
    p.ping = null;
    p.pin = null;
    p.path = [];
    p.owed = null;
    p.tag = null;
    p.ev = [];
    p.peer = null;
    p.caughtAt = null;
    p.closest = null;
    if (p.hold) p.hold = null;
    if (p.fx) delete p.fx.safe;
  }
  return g;
}

export function installHandover(host) {
  const G = () => host.G;
  let lastPick = 0;
  let lastBackup = 0;

  // The deputy: the first connected player who is not the host, preferring
  // a direct link over the relay.
  const pick = () => {
    const ok = host.all().filter((p) => !host.isHost(p) && !p.bot && p.conn && !p.dropped && p.role !== 'spectator' && p.cid != null);
    return ok.find((p) => !(host.net.isRelay && host.net.isRelay(p.cid))) || ok[0] || null;
  };

  const sendBackup = () => {
    const g = G();
    const dep = g.players[g.deputy];
    if (!dep || !host.inMatch) return;
    lastBackup = Date.now();
    host.to(dep, { k: 'backup', at: lastBackup, G: slimGame(g) });
  };

  host.hooks.tick.push((now) => {
    const g = G();
    if (!N.handover || g.practice) return;
    if (now - lastPick >= 1000) {
      lastPick = now;
      const dep = pick();
      const id = dep ? dep.id : null;
      if (id !== g.deputy) {
        g.deputy = id;
        host.dirty = true;
        lastBackup = 0;                  // the new deputy gets a backup at once
      }
    }
    if (g.deputy && host.inMatch && now - lastBackup >= N.backupSec * 1000) sendBackup();
  });
  // Fresh backups at the moments that matter most.
  for (const hook of ['start', 'convert', 'release']) host.hooks[hook].push(() => setTimeout(sendBackup, 0));

  host.hooks.view.push((p, v) => {
    const g = G();
    const dep = g.players[g.deputy];
    if (host.inMatch && dep) v.deputy = { id: dep.id, name: dep.name };
  });

  // This phone has just taken over from a host that disappeared.
  if (G().takeover) {
    const g = G();
    const by = g.takeover.by;
    delete g.takeover;
    const used = new Set();
    for (const p of host.all()) {
      if (p.role === 'prey' && !p.dropped) p.pin = host.newPin(used);
      if (host.inMatch && g.phase === 'live' && p.role !== 'spectator' && !p.dropped) p.owed = { pay: false };
    }
    host.evAll({ type: 'toast', tone: 'lime', text: by + ' is now the host' }, (p) => !host.isHost(p));
  }
}
