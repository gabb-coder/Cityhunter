// Host feature: catch PIN.
//
// The host made one random PIN per prey at match start (host.js) and only
// ever puts it in that prey's own snapshot. A hunter submits {target, pin};
// the host checks the PIN, the hunter-prey distance and Safe House, then
// tells the hunter the result and converts the prey. PINs are never
// broadcast, and a wrong guess never reveals the right one.

import { CONFIG, ECONOMY } from './config.js';
import { dist } from './util.js';

const C = CONFIG.catch;
const TAG_TTL_MS = 60000;

export function installCatch(host) {
  const G = () => host.G;

  // Distance check between a hunter and a prey.
  //   d        live distance in metres (null if either has never had a fix)
  //   inRange  d <= rangeM, plus slack for the two phones' GPS accuracy
  //   stale    one side has no fresh fix (GPS lost or offline)
  function range(h, q, now = Date.now()) {
    // Never had a fix at all: the PIN alone decides (if the config allows it).
    if (!h.pos || !q.pos) return { d: null, inRange: C.allowWhenGpsStale, stale: true };
    const d = dist(h.pos, q.pos);
    const slack = Math.min(h.pos.acc + q.pos.acc, C.accuracySlackMaxM);
    const stale = !host.fresh(h, now) || !host.fresh(q, now);
    let limit = C.rangeM + slack;
    if (stale) {
      if (!C.allowWhenGpsStale) return { d, inRange: false, stale };
      // Someone without a fix may have moved since: allow for walking pace.
      const age = Math.max(now - h.posAt, now - q.posAt) / 1000;
      limit += Math.min(age * 2, 200);
    }
    return { d, inRange: d <= limit, stale };
  }

  const inSafeHouse = (q) => {
    const s = q.fx.safe;
    return !!s && s.untilT > G().T && !!q.pos && dist(q.pos, s) <= s.r;
  };

  const clearTagsBy = (h) => {
    for (const q of host.all()) if (q.tag && q.tag.by === h.id) q.tag = null;
  };

  // The hunter picked a target on the Confirm catch screen: the prey's phone
  // switches to the big-PIN screen.
  host.on('catch:start', (h, m) => {
    const q = G().players[m.target];
    if (h.role !== 'hunter' || G().phase !== 'live' || !q || q.role !== 'prey' || q.dropped) return;
    clearTagsBy(h);
    if (range(h, q).inRange) q.tag = { by: h.id, T: G().T };
  });

  host.on('catch:cancel', (h) => clearTagsBy(h));

  host.on('catch:submit', (h, m) => {
    const g = G();
    const q = g.players[m.target];
    const reply = (ok, reason, extra) => host.to(h, { k: 'catch:result', ok, reason, target: m.target, ...extra });

    if (h.role !== 'hunter' || h.dropped || g.phase !== 'live' || g.paused) return reply(false, 'state');
    if (!q || q.role !== 'prey' || q.dropped) return reply(false, 'state');
    if (h.lock.untilT > g.T) return reply(false, 'locked', { lockSec: Math.ceil((h.lock.untilT - g.T) / 1000) });
    if (!range(h, q).inRange) return reply(false, 'range');
    if (inSafeHouse(q)) return reply(false, 'safe');

    if (String(m.pin || '') !== q.pin) {
      h.lock.wrong++;
      if (h.lock.wrong >= C.maxWrongPins) {
        h.lock.wrong = 0;
        h.lock.untilT = g.T + C.lockoutSec * 1000;
        return reply(false, 'locked', { lockSec: C.lockoutSec });
      }
      return reply(false, 'pin', { triesLeft: C.maxWrongPins - h.lock.wrong });
    }

    h.lock.wrong = 0;
    h.catches++;
    h.gc += ECONOMY.perCatch;
    h.earned += ECONOMY.perCatch;
    clearTagsBy(h);
    host.convert(q, h, 'catch');
    const left = host.prey().length;
    reply(true, null, { name: q.name, gc: ECONOMY.perCatch, left });
    host.evAll({ type: 'toast', tone: 'hunter', text: h.name + ' caught ' + q.name + ' · ' + left + ' prey left' }, (p) => p !== h && p !== q);
    host.checkEnd();
  });

  // "I've been caught": the prey opened the PIN screen themselves.
  host.on('tagged:self', (q, m) => {
    q.selfTag = q.role === 'prey' && !!m.on;
  });

  host.hooks.live.push(() => {
    const g = G();
    for (const q of host.all()) if (q.tag && g.T - q.tag.T > TAG_TTL_MS) q.tag = null;
  });

  host.hooks.view.push((p, v) => {
    const g = G();
    if (!host.inMatch) return;
    const now = Date.now();
    if (p.role === 'hunter') {
      v.me.lock = { triesLeft: C.maxWrongPins - p.lock.wrong, untilT: p.lock.untilT > g.T ? p.lock.untilT : 0 };
      // Who can be caught right now. A live distance is only shown for prey
      // already in range; everyone else is measured from their last ping.
      v.targets = host.prey().map((q) => {
        const r = range(p, q, now);
        return {
          id: q.id, name: q.name, inRange: r.inRange, stale: r.stale, safe: inSafeHouse(q),
          d: r.inRange && r.d != null ? Math.round(r.d) : p.pos && q.ping ? Math.round(dist(p.pos, q.ping)) : null
        };
      });
    } else {
      const by = p.tag ? g.players[p.tag.by] : null;
      if (by && by.pos && p.pos) {
        v.me.tag = { key: by.id + ':' + p.tag.T, by: by.name, d: Math.round(dist(by.pos, p.pos)) };
      } else if (by) {
        v.me.tag = { key: by.id + ':' + p.tag.T, by: by.name, d: null };
      } else if (p.selfTag && p.pos) {
        // Only name a hunter who is close enough to plausibly be the tagger,
        // so this screen cannot be used as a hunter radar.
        const near = host.hunters().filter((h) => host.fresh(h, now))
          .map((h) => ({ h, d: dist(h.pos, p.pos) })).filter((x) => x.d <= C.nearHunterM).sort((a, b) => a.d - b.d)[0];
        v.me.near = near ? { by: near.h.name, d: Math.round(near.d) } : null;
      }
    }
  });
}
