// Host feature: the admin console. Only the host player may send these.

import { CONFIG } from './config.js';

export function installAdmin(host) {
  const G = () => host.G;

  const OPS = {
    pause() {
      host.pause('admin');
    },
    resume() {
      host.resume();
    },
    end() {
      if (host.inMatch) host.end('none', 'host-ended');
    },
    // Force a ping of everyone right now (pays no Glowcoin, ignores Ghost).
    ping() {
      if (G().phase === 'live') {
        host.doPing({});
        host.evAll({ type: 'toast', text: 'The host forced a ping' });
      }
    },
    time(m) {
      const g = G();
      if (!host.inMatch) return;
      const add = Math.max(-30, Math.min(30, Number(m.min) || 0)) * 60000;
      g.endT = Math.max(g.T + 10000, g.endT + add);
    },
    gc(m) {
      const q = G().players[m.id];
      if (q) q.gc = Math.max(0, q.gc + (Number(m.amt) || 0));
    },
    role(m) {
      const q = G().players[m.id];
      if (!q || !host.inMatch || q.dropped) return;
      if (q.role === 'prey') {
        host.convert(q, null, 'admin');
        host.checkEnd();
      } else {
        q.role = 'prey';
        q.pin = host.newPin();
        q.caughtT = null;
        q.caughtBy = null;
        q.caughtWhy = null;
        q.caughtAt = null;
        q.fx = {};
        host.note(q, 'The host moved you back to prey', 'prey');
        for (const fn of host.hooks.hello) fn(q);   // resend the right chat channel
      }
    },
    kick(m) {
      const q = G().players[m.id];
      if (!q || host.isHost(q)) return;
      q.kicked = true;
      (G().banned = G().banned || []).push(q.token);
      if (host.inMatch) {
        host.to(q, { k: 'bye', reason: 'kicked' });
        host.drop(q, 'kicked');
        if (q.cid != null) {
          host.cids.delete(q.cid);
          host.net.drop(q.cid);
          q.cid = null;
          q.conn = false;
        }
      } else {
        host.removePlayer(q, 'kicked');
      }
    }
  };

  host.on('admin', (p, m) => {
    if (!host.isHost(p) || !OPS[m.op]) return;
    OPS[m.op](m);
  });

  // Player health for the console: status only, never positions.
  host.hooks.view.push((p, v) => {
    if (!host.isHost(p)) return;
    const now = Date.now();
    v.admin = host.all().map((q) => ({
      id: q.id, name: q.name, role: q.role, conn: q.conn, dropped: q.dropped, host: host.isHost(q), gc: q.gc,
      acc: q.pos ? Math.round(q.pos.acc) : null,
      gpsAge: q.pos ? Math.round((now - q.posAt) / 1000) : null,
      gpsOut: q.gps.graceOut,
      outZone: q.out.sinceT != null, revealed: q.out.revealed,
      offSec: q.conn ? 0 : Math.round((q.offMs || 0) / 1000),
      holdSec: CONFIG.net.spotHoldSec
    }));
  });
}
