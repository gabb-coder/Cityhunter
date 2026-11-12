// Host feature: heartbeats, spot hold, isolation pause and host recovery.
//
// Every client sends a heartbeat every CONFIG.net.heartbeatSec; the host's
// snapshots are the heartbeat the other way. Either side treats
// heartbeatTimeoutSec of silence as a dropped link.
//
//   one player silent   their spot is held for spotHoldSec, the match runs on
//   everyone silent     the host is the one that is cut off: it pauses the
//                       clock until somebody is back (clients have frozen
//                       theirs and show HOST OFFLINE)
//   host page reloaded  the game is restored from localStorage under the
//                       same peer ID, so clients' redial loops find it again

import { CONFIG } from './config.js';
import { store } from './util.js';

export const HOST_SAVE_KEY = 'ch2.host';
const N = CONFIG.net;

export function loadHostSave() {
  const s = store.get(HOST_SAVE_KEY);
  if (!s || !s.G || s.G.v !== 2 || Date.now() - s.at > 12 * 3600 * 1000) return null;
  const now = Date.now();
  for (const p of Object.values(s.G.players)) {
    p.cid = null;
    p.conn = false;
    p.peer = null;
    p.lastHeard = now;
  }
  return s;
}

export function installResilience(host) {
  const G = () => host.G;
  let lastSave = 0;
  let isolatedAt = 0;

  const save = () => {
    lastSave = Date.now();
    const me = G().players[G().hostPid];
    store.set(HOST_SAVE_KEY, { at: lastSave, code: G().code, name: me ? me.name : '', G: JSON.parse(JSON.stringify(G(), (k, v) => (k === 'cid' ? undefined : v))) });
  };
  host.save = save;
  window.addEventListener('pagehide', () => !host.stopped && save());

  host.hooks.tick.push((now, dt) => {
    const g = G();
    const remotes = host.all().filter((p) => !host.isHost(p));

    for (const p of remotes) {
      // Heartbeat timeout: the link is gone even if WebRTC has not noticed.
      if (p.conn && now - p.lastHeard > N.heartbeatTimeoutSec * 1000) {
        p.conn = false;
        if (p.cid != null) {
          host.cids.delete(p.cid);
          host.net.drop(p.cid);
          p.cid = null;
        }
        host.dirty = true;
      }
      if (p.conn || p.dropped) continue;
      if (host.inMatch) {
        // Spot hold only counts match time, so a host outage costs nobody.
        if (!g.paused) {
          p.offMs += dt;
          if (p.offMs > N.spotHoldSec * 1000) host.drop(p, 'timeout');
        }
      } else if (g.phase === 'lobby') {
        p.offMs += dt;
        if (p.offMs > N.lobbyDropSec * 1000) host.removePlayer(p);
      }
    }

    // Isolation: nobody can hear the host.
    if (host.inMatch) {
      const alive = remotes.filter((p) => !p.dropped);
      const anyone = alive.some((p) => p.conn);
      const hostCutOff = !host.net.signal || navigator.onLine === false;
      const isolated = alive.length > 0 && !anyone && (alive.length >= 2 || hostCutOff);
      if (isolated) {
        if (!isolatedAt) isolatedAt = now;
        host.pause('isolated');
        // Clients give up after hostOfflineHoldSec; so does the host.
        if (now - isolatedAt > (N.hostOfflineHoldSec + 20) * 1000) host.end('none', 'host-lost');
      } else {
        isolatedAt = 0;
        if (g.paused && g.pauseReason === 'isolated') host.resume('isolated');
      }
    } else {
      isolatedAt = 0;
    }

    if (now - lastSave > N.hostSaveSec * 1000) save();
  });

  for (const hook of ['start', 'end', 'lobby']) host.hooks[hook].push(() => setTimeout(save, 0));
}
