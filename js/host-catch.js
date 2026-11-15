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
  //   inRange  within rangeM, plus slack for the two phones' GPS accuracy
  //   stale    the prey has no fresh fix (GPS lost or offline): the PIN decides
  //   why      'gps' when the hunter has no live fix. A hunter always needs
  //            one, otherwise switching GPS off would widen their reach.
  function range(h, q, now = Date.now()) {
    if (!h.pos || !host.fresh(h, now)) return { inRange: false, stale: false, why: 'gps' };
    // The prey never had a fix at all: the PIN alone decides (if allowed).
    if (!q.pos) return { inRange: C.allowWhenGpsStale, stale: true };
    const d = dist(h.pos, q.pos);
    const stale = !host.fresh(q, now);
    let limit = C.rangeM + Math.min(h.pos.acc + q.pos.acc, C.accuracySlackMaxM);
    if (stale) {
      if (!C.allowWhenGpsStale) return { inRange: false, stale };
      // The prey may have moved since their last fix: allow for walking pace.
      limit += Math.min(((now - q.posAt) / 1000) * C.staleSlackMps, C.staleSlackMaxM);
    }
    return { inRange: d <= limit, stale };
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
    const q = host.player(m.target);
    if (h.role !== 'hunter' || h.dropped || G().phase !== 'live' || G().paused || !q || q.role !== 'prey' || q.dropped) return;
    clearTagsBy(h);
    if (range(h, q).inRange) q.tag = { by: h.id, T: G().T };
  });

  host.on('catch:cancel', (h) => clearTagsBy(h));

  host.on('catch:submit', (h, m) => {
    const g = G();
    const q = host.player(m.target);
    const reply = (ok, reason, extra) => host.to(h, { k: 'catch:result', ok, reason, target: m.target, ...extra });

    if (h.role !== 'hunter' || h.dropped || g.phase !== 'live') return reply(false, 'state');
    if (g.paused) return reply(false, 'paused');
    if (!q || q.role !== 'prey' || q.dropped) return reply(false, 'state');
    if (h.penaltyT > g.T) return reply(false, 'penalty', { lockSec: Math.ceil((h.penaltyT - g.T) / 1000) });
    if (h.lock.untilT > g.T) return reply(false, 'locked', { lockSec: Math.ceil((h.lock.untilT - g.T) / 1000) });
    const r = range(h, q);
    if (!r.inRange) return reply(false, r.why === 'gps' ? 'gps' : 'range');
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
      // Who can be caught right now: yes or no only. The live distance to a
      // prey is never sent, so this cannot be used to home in on one.
      v.me.noFix = !host.fresh(p, now);
      v.targets = host.prey().map((q) => {
        const r = range(p, q, now);
        return { id: q.id, name: q.name, inRange: r.inRange, stale: r.stale, safe: inSafeHouse(q) };
      });
    } else if (p.role === 'prey') {
      // Only a hunter who has started a catch on this prey is ever named.
      const by = p.tag ? g.players[p.tag.by] : null;
      if (by) v.me.tag = { key: by.id + ':' + p.tag.T, by: by.name };
    }
  });
}
