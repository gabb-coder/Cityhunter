// Practice round: a solo match against simulated players, so a first-timer
// can learn the map, pings, the shop and the PIN catch before a real hunt.
//
// It runs the real host game with no network. Your own position is
// simulated too (tap the map to walk), so it works on a sofa. Bots move once
// a second: prey wander and flee, hunters hold for the head start and then
// chase the last ping, exactly the information a human hunter would have.

import { CONFIG, ECONOMY } from './config.js';
import { dist, bearing } from './util.js';
import { offsetPoint } from './map.js';
import { NullNet } from './net.js';
import { app, snap } from './state.js';
import { toast } from './ui/core.js';
import { bannerHooks } from './ui/game.js';

const DEFAULT_START = { lat: 51.5073, lng: -0.1657 };
const RULES = { matchSec: 420, headStartSec: 20, pingSec: 20, zoneRadiusM: 220, zoneShrinkTo: 1 };
const BOTS = [
  { name: 'VIPER', role: 'hunter', at: [150, 30] },
  { name: 'KESTREL', role: 'hunter', at: [140, 250] },
  { name: 'NOMAD', role: 'prey', at: [80, 120] },
  { name: 'JUNO', role: 'prey', at: [90, 310] }
];
const SPEED = { prey: 1.5, hunter: 1.7, you: 4 };   // metres per second
const BOT_CATCH_M = 10;
const BOT_PIN_DELAY_MS = 6000;

let timer = null;
let brains = new Map();   // bot id -> { goal, goalAt, tagAt }

function addBot(host, def, center) {
  const p = host.newPlayer('bot:' + def.name, def.name);
  p.bot = true;
  p.ready = true;
  p.role = def.role;
  p.spawn = offsetPoint(center, def.at[0], def.at[1]);
  return p;
}

function place(host, bot, pos, hdg) {
  host.handle(bot, { k: 'pos', lat: pos.lat, lng: pos.lng, acc: 5, hdg });
}

function step(host) {
  const G = host.G;
  if (!host.inMatch || G.paused) return;
  const zone = host.zoneNow();
  const now = Date.now();
  const hunters = host.hunters();
  const prey = host.prey();

  for (const bot of host.active()) {
    if (!bot.bot) continue;
    const here = bot.pos || bot.spawn;
    const mind = brains.get(bot.id) || {};
    brains.set(bot.id, mind);
    let goal = null;

    if (bot.role === 'prey') {
      const threat = hunters.filter((h) => h.pos).sort((a, b) => dist(here, a.pos) - dist(here, b.pos))[0];
      if (threat && dist(here, threat.pos) < 70) {
        goal = offsetPoint(here, 40, bearing(threat.pos, here));          // run directly away
      } else {
        if (!mind.goal || now - mind.goalAt > 20000 || dist(here, mind.goal) < 8) {
          mind.goal = offsetPoint(zone, Math.random() * zone.r * 0.7, Math.random() * 360);
          mind.goalAt = now;
        }
        goal = mind.goal;
      }
      if (dist(goal, zone) > zone.r * 0.9) goal = zone;                    // never leave the zone
    } else if (G.phase === 'live') {
      // Chase the nearest last-known ping, like a human hunter would.
      const seen = prey.filter((q) => q.ping).sort((a, b) => dist(here, a.ping) - dist(here, b.ping))[0];
      goal = seen ? seen.ping : zone;

      // Close enough to someone for real? Make the catch.
      const near = prey.filter((q) => q.pos && dist(here, q.pos) <= BOT_CATCH_M)[0];
      if (near && near.bot) {
        credit(host, bot, near);
      } else if (near) {
        // You: show the real flow. Your phone flips to the PIN screen, and
        // a few seconds later the bot "types it in".
        if (!near.tag || near.tag.by !== bot.id) {
          near.tag = { by: bot.id, T: G.T };
          mind.tagAt = now;
          host.dirty = true;
        } else if (now - mind.tagAt > BOT_PIN_DELAY_MS) {
          credit(host, bot, near);
        }
      } else {
        for (const q of prey) if (q.tag && q.tag.by === bot.id) q.tag = null;
      }
    }

    if (goal && dist(here, goal) > 1) {
      const move = Math.min(SPEED[bot.role], dist(here, goal));
      const hdg = bearing(here, goal);
      place(host, bot, offsetPoint(here, move, hdg), hdg);
    } else {
      place(host, bot, here, null);
    }
  }
}

function credit(host, hunter, prey) {
  hunter.catches++;
  hunter.gc += ECONOMY.perCatch;
  hunter.earned += ECONOMY.perCatch;
  host.convert(prey, hunter, 'catch');
  host.evAll({ type: 'toast', tone: 'hunter', text: hunter.name + ' caught ' + prey.name + ' · ' + host.prey().length + ' prey left' }, (p) => p !== prey);
  host.checkEnd();
}

export function startPractice(name) {
  if (app.session) return;
  app.practice = true;
  const fix = app.geo.fix;
  const start = fix ? { lat: fix.lat, lng: fix.lng } : DEFAULT_START;
  app.geo.simulate(start.lat, start.lng);
  app.geo.start();

  const host = app.go.startLocal({ code: 'TRYOUT', net: new NullNet(), name });
  host.G.practice = true;
  Object.assign(host.G.rules, RULES);
  brains = new Map();
  for (const def of BOTS) addBot(host, def, start);

  // In a real match the PIN is on the other player's screen. Here the bots
  // have no screen, so the catch screen is told theirs.
  host.hooks.view.push((p, v) => {
    if (p.bot) return;
    v.practice = { pins: Object.fromEntries(host.prey().filter((q) => q.bot).map((q) => [q.name, q.pin])) };
  });

  const me = host.G.players[host.G.hostPid];
  host.start(me, start);
  for (const bot of host.all()) if (bot.bot) place(host, bot, bot.spawn, null);
  timer = setInterval(() => step(host), 1000);
  toast('Practice round: tap the map to walk', 'lime', 5000);
}

app.bus.on('mapclick', (p) => {
  if (app.practice && !app.ui.marking) app.geo.walkTo(p, SPEED.you);
});

app.bus.on('cleanup', () => {
  if (!app.practice) return;
  clearInterval(timer);
  app.practice = false;
  app.geo.unsimulate();
});

// One line of coaching at a time, under the HUD.
bannerHooks.push((out, s) => {
  if (!app.practice) return;
  let tip;
  if (s.me.role === 'prey') {
    if (s.phase === 'headstart') tip = 'Practice: tap the map to walk. Get away from the hunters before the head start ends.';
    else if ((s.pingNo || 0) <= 1) tip = 'Your position was just pinged to the hunters. The bar at the top counts down to the next ping.';
    else if (!Object.keys(s.me.inv || {}).length) tip = 'Orange circles show where hunters were last seen. Open the Shop: Ghost skips your next ping.';
    else tip = 'Stay inside the dashed zone and keep moving. If a hunter reaches you, your PIN screen opens.';
  } else {
    tip = 'Now you hunt. Walk to a blue circle, tap CATCH, and type the PIN. In a real match it is on their phone.';
  }
  out.unshift('<div class="banner lime coach" role="status"><span>' + tip + '</span></div>');
});

app.go.practice = startPractice;
