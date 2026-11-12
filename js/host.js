// The authoritative game. Runs only on the host's phone.
//
// Clients send small intent messages ({k:'ready'}, {k:'pos'}, ...). The host
// applies them to G and sends every player a snapshot tailored to what that
// player is allowed to see. Nothing a client claims is trusted beyond its
// own position.
//
// Game time `G.T` is milliseconds of match time. It only advances while the
// match is running, so pausing (admin pause, host offline) costs nobody time.
//
// Features plug in with host.on(kind, handler) and host.hooks.*:
//   js/host-play.js        pings, Glowcoin, shop, abilities, chat
//   js/host-catch.js       catch PIN
//   js/host-admin.js       host console
//   js/host-safety.js      GPS lost, out of zone
//   js/host-resilience.js  heartbeats, spot hold, host recovery

import { CONFIG, MODES, ECONOMY, RULE_OPTIONS } from './config.js';
import { randomDigits, uid } from './util.js';

function matchFields() {
  return {
    startRole: null,
    gc: 0, earned: 0, inv: {}, fx: {},
    pin: null,
    pos: null, posAt: 0,          // live position + wall-clock time received
    ping: null,                   // last ping others may see
    gps: { lostAt: 0, graceOut: false, told: false },
    out: { sinceT: null, revealed: false },
    caughtT: null, caughtBy: null, caughtWhy: null, caughtAt: null,
    catches: 0, pings: 0,
    tag: null, selfTag: false,
    lock: { wrong: 0, untilT: 0 },
    ev: []
  };
}

function newGame(code) {
  return {
    v: 2, code,
    phase: 'lobby',               // lobby | headstart | live | ended
    mode: 'DEAD_RECKONING',
    rules: { ...MODES.DEAD_RECKONING.rules },
    round: 0,
    T: 0, headT: 0, endT: 0, nextPingT: 0, pingNo: 0,
    paused: false, pauseReason: null,
    zone: null, lock: null,
    players: {}, order: [], hostPid: null, hunterStack: [],
    decoys: [], chat: { all: [], prey: [], hunter: [] },
    evN: 0, chatN: 0,
    lastCatch: null, result: null
  };
}

export class Host {
  constructor({ code, net, local, saved }) {
    this.net = net;
    this.local = local;
    this.G = saved || newGame(code);
    this.handlers = {};
    this.hooks = { tick: [], live: [], view: [], start: [], convert: [], end: [], hello: [], lobby: [] };
    this.cids = new Map();        // connection id -> player id
    this.dirty = true;
    this.lastTick = Date.now();
    this.lastSnap = 0;
    this.stopped = false;

    local.host = this;
    net.on('message', (cid, msg, peerId) => this.fromNet(cid, msg, peerId));
    net.on('down', (cid) => this.linkDown(cid));

    this.coreHandlers();
    this.timer = setInterval(() => this.tick(), 250);
  }

  // ------------------------------------------------------------ helpers
  on(kind, fn) {
    this.handlers[kind] = fn;
  }
  get inMatch() {
    return this.G.phase === 'headstart' || this.G.phase === 'live';
  }
  all() {
    return this.G.order.map((id) => this.G.players[id]);
  }
  active() {
    return this.all().filter((p) => !p.dropped);
  }
  prey() {
    return this.active().filter((p) => p.role === 'prey');
  }
  hunters() {
    return this.active().filter((p) => p.role === 'hunter');
  }
  isHost(p) {
    return p.id === this.G.hostPid;
  }
  // Seconds of live play (after the head start).
  liveSec(T = this.G.T) {
    return Math.max(0, (T - this.G.headT) / 1000);
  }
  // Is this player's position recent enough to trust?
  fresh(p, now = Date.now()) {
    return !!p.pos && now - p.posAt < (CONFIG.gps.lostAfterSec + CONFIG.net.posSendSec + 2) * 1000;
  }
  zoneNow() {
    const z = this.G.zone;
    if (!z) return null;
    const lock = this.G.lock && this.G.lock.untilT > this.G.T ? this.G.lock : null;
    return { lat: z.lat, lng: z.lng, r: Math.round(z.r * (lock ? lock.factor : 1)), base: z.r, lockT: lock ? lock.untilT : 0 };
  }

  to(p, msg) {
    if (p.cid === 'local') this.local.deliver(msg);
    else if (p.cid != null) this.net.send(p.cid, msg);
  }
  // Queue an event (toast, banner, screen change) for one player. Events
  // ride inside snapshots, so a player who reconnects still receives them.
  ev(p, e) {
    e.n = ++this.G.evN;
    p.ev.push(e);
    if (p.ev.length > 12) p.ev.shift();
    this.dirty = true;
  }
  evAll(e, filter) {
    for (const p of this.all()) if (!filter || filter(p)) this.ev(p, { ...e });
  }
  note(p, text, tone = '') {
    this.ev(p, { type: 'toast', text, tone });
  }

  // ------------------------------------------------------------ links
  addLocal(token, name) {
    let p = this.G.players[this.G.hostPid];
    if (!p) {
      p = this.newPlayer(token, name);
      this.G.hostPid = p.id;
      p.ready = true;
    }
    p.cid = 'local';
    p.conn = true;
    p.lastHeard = Date.now();
    p.offMs = 0;
    this.to(p, { k: 'welcome', id: p.id, code: this.G.code });
    for (const fn of this.hooks.hello) fn(p);
    this.dirty = true;
    return p;
  }

  newPlayer(token, name) {
    const names = new Set(this.all().map((q) => q.name));
    let n = name, i = 2;
    while (names.has(n)) n = name.slice(0, CONFIG.lobby.nameMaxLength - 1) + i++;
    const p = {
      id: uid(6), token, name: n,
      role: 'prey', ready: false,
      conn: true, cid: null, peer: null, lastHeard: Date.now(), offMs: 0, dropped: false,
      ...matchFields()
    };
    this.G.players[p.id] = p;
    this.G.order.push(p.id);
    return p;
  }

  fromLocal(msg) {
    const p = this.G.players[this.G.hostPid];
    if (p && !this.stopped) this.handle(p, msg);
  }

  fromNet(cid, msg, peerId) {
    if (this.stopped) return;
    if (msg.k === 'hello') return this.hello(cid, msg, peerId);
    const p = this.G.players[this.cids.get(cid)];
    if (p) this.handle(p, msg);
  }

  hello(cid, msg, peerId) {
    const G = this.G;
    const token = String(msg.token || '').slice(0, 64);
    const name = String(msg.name || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').trim().slice(0, CONFIG.lobby.nameMaxLength);
    const reject = (reason) => {
      this.net.send(cid, { k: 'reject', reason });
      this.net.drop(cid);
    };
    if (!token || !name) return reject('bad');

    let p = this.all().find((q) => q.token === token);
    if (p && p.cid === 'local') return reject('bad');
    if ((p && p.kicked) || (G.banned || []).includes(token)) return reject('kicked');
    if (p) {
      // A returning player: swap the link, keep everything else.
      if (p.cid != null && p.cid !== cid) {
        this.cids.delete(p.cid);
        this.net.drop(p.cid);
      }
      p.dropped = false;
    } else {
      if (G.phase !== 'lobby') return reject('in-progress');
      if (G.order.length >= CONFIG.lobby.maxPlayers) return reject('full');
      p = this.newPlayer(token, name);
    }
    p.cid = cid;
    p.peer = peerId || null;
    p.conn = true;
    p.lastHeard = Date.now();
    p.offMs = 0;
    this.cids.set(cid, p.id);
    this.to(p, { k: 'welcome', id: p.id, code: G.code });
    for (const fn of this.hooks.hello) fn(p);
    this.dirty = true;
  }

  linkDown(cid) {
    const p = this.G.players[this.cids.get(cid)];
    this.cids.delete(cid);
    if (!p || p.cid !== cid) return;
    p.cid = null;
    p.conn = false;
    this.dirty = true;
  }

  handle(p, msg) {
    p.lastHeard = Date.now();
    if (!p.conn) {
      p.conn = true;
      p.offMs = 0;
      this.dirty = true;
    }
    const fn = this.handlers[msg.k];
    if (!fn) return;
    try {
      fn(p, msg);
    } catch (e) {
      console.error('[host]', msg.k, e);
    }
    if (msg.k !== 'pos' && msg.k !== 'hb') this.dirty = true;
  }

  removePlayer(p, reason) {
    const G = this.G;
    if (reason) this.to(p, { k: 'bye', reason });
    if (p.cid != null && p.cid !== 'local') {
      this.cids.delete(p.cid);
      this.net.drop(p.cid);
    }
    delete G.players[p.id];
    G.order = G.order.filter((id) => id !== p.id);
    G.hunterStack = G.hunterStack.filter((id) => id !== p.id);
    this.dirty = true;
  }

  // A player is gone for good this match. Prey forfeit to the hunters so
  // the match can still finish; coming back later they hunt.
  drop(p, why = 'left') {
    if (p.dropped) return;
    if (p.role === 'prey' && this.inMatch) this.convert(p, null, why);
    p.dropped = true;
    p.tag = null;
    this.evAll({ type: 'toast', text: p.name + (why === 'kicked' ? ' was removed' : ' is out of the match') }, (q) => q !== p);
    this.checkEnd();
  }

  // ------------------------------------------------------------ lobby
  coreHandlers() {
    const lobbyOnly = (fn) => (p, m) => this.G.phase === 'lobby' && fn(p, m);
    const hostOnly = (fn) => (p, m) => this.isHost(p) && fn(p, m);

    this.on('hb', (p, m) => {
      if (m.peer) p.peer = String(m.peer).slice(0, 80);
    });

    this.on('pos', (p, m) => {
      if (!this.inMatch) return;
      const lat = Number(m.lat), lng = Number(m.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      p.pos = { lat, lng, acc: Math.max(1, Math.min(5000, Number(m.acc) || 50)), hdg: isFinite(m.hdg) ? Number(m.hdg) : null };
      p.posAt = Date.now();
    });

    this.on('ready', lobbyOnly((p, m) => {
      p.ready = !!m.ready;
    }));

    this.on('cfg', hostOnly(lobbyOnly((p, m) => {
      const G = this.G;
      if (m.mode && MODES[m.mode]) {
        G.mode = m.mode;
        G.rules = { ...MODES[m.mode].rules };
      }
      if (m.rule && RULE_OPTIONS[m.rule] && RULE_OPTIONS[m.rule].includes(m.value)) G.rules[m.rule] = m.value;
      if (m.hunters === 1) {
        const pool = this.all().filter((q) => q.role === 'prey');
        if (pool.length > 1) this.setLobbyRole(pool[Math.floor(Math.random() * pool.length)], 'hunter');
      }
      if (m.hunters === -1) {
        const stack = G.hunterStack.filter((id) => G.players[id] && G.players[id].role === 'hunter');
        const q = G.players[stack.pop()] || this.all().filter((x) => x.role === 'hunter').pop();
        if (q) this.setLobbyRole(q, 'prey');
      }
    })));

    this.on('role', hostOnly(lobbyOnly((p, m) => {
      const q = this.G.players[m.id];
      if (q) this.setLobbyRole(q, q.role === 'hunter' ? 'prey' : 'hunter');
    })));

    this.on('start', hostOnly(lobbyOnly((p, m) => this.start(p, m.center))));

    this.on('leave', (p) => {
      if (this.isHost(p)) return this.shutdown('host-left');
      if (this.G.phase === 'lobby' || this.G.phase === 'ended') this.removePlayer(p);
      else {
        this.drop(p, 'left');
        if (p.cid != null) {
          this.cids.delete(p.cid);
          this.net.drop(p.cid);
          p.cid = null;
          p.conn = false;
        }
      }
    });

    this.on('rematch', hostOnly(() => this.toLobby()));
  }

  setLobbyRole(q, role) {
    q.role = role;
    this.G.hunterStack = this.G.hunterStack.filter((id) => id !== q.id);
    if (role === 'hunter') this.G.hunterStack.push(q.id);
  }

  start(p, center) {
    const G = this.G;
    const list = this.all();
    const nHunters = list.filter((q) => q.role === 'hunter').length;
    if (list.length < CONFIG.lobby.minPlayers) return this.note(p, 'You need at least ' + CONFIG.lobby.minPlayers + ' players');
    if (!nHunters || nHunters === list.length) return this.note(p, 'You need at least one hunter and one prey');
    const lat = Number(center && center.lat), lng = Number(center && center.lng);
    if (!isFinite(lat) || !isFinite(lng)) return this.note(p, 'Waiting for your GPS fix to set the play zone');

    G.round++;
    G.phase = 'headstart';
    G.T = 0;
    G.paused = false;
    G.pauseReason = null;
    G.headT = G.rules.headStartSec * 1000;
    G.endT = G.headT + G.rules.matchSec * 1000;
    G.nextPingT = G.headT + (CONFIG.ping.firstPingAtRelease ? 0 : G.rules.pingSec * 1000);
    G.pingNo = 0;
    G.zone = { lat, lng, r: G.rules.zoneRadiusM };
    G.lock = null;
    G.decoys = [];
    G.lastCatch = null;
    G.result = null;
    G.chat.prey = [];
    G.chat.hunter = [];

    // One random PIN per prey per match. It only ever travels inside that
    // prey's own snapshot.
    const used = new Set();
    for (const q of list) {
      Object.assign(q, matchFields());
      q.dropped = false;
      q.startRole = q.role;
      q.gc = ECONOMY.startingGC;
      if (q.role === 'prey') q.pin = this.newPin(used);
    }
    for (const fn of this.hooks.start) fn();
    this.lastTick = Date.now();
  }

  newPin(used = new Set(this.all().map((q) => q.pin).filter(Boolean))) {
    let pin;
    do pin = randomDigits(CONFIG.catch.pinLength); while (used.has(pin));
    used.add(pin);
    return pin;
  }

  toLobby() {
    const G = this.G;
    if (G.phase !== 'ended') return;
    G.phase = 'lobby';
    G.paused = false;
    G.pauseReason = null;
    G.zone = null;
    G.result = null;
    for (const q of this.all().slice()) {
      if (!q.conn && !this.isHost(q)) {
        this.removePlayer(q);
        continue;
      }
      const role = q.startRole || 'prey';
      Object.assign(q, matchFields());
      q.role = role;
      q.dropped = false;
      q.ready = this.isHost(q);
    }
    for (const fn of this.hooks.lobby) fn();
  }

  // ------------------------------------------------------------ match
  // Prey -> hunter. `by` is the hunter who made the catch, or null for a
  // forfeit / admin action.
  convert(q, by, why = 'catch') {
    const G = this.G;
    if (q.role !== 'prey') return;
    q.role = 'hunter';
    q.caughtT = G.T;
    q.caughtBy = by ? by.id : null;
    q.caughtWhy = why;
    q.caughtAt = q.pos ? { lat: q.pos.lat, lng: q.pos.lng } : null;
    q.pin = null;
    q.tag = null;
    q.selfTag = false;
    q.fx = {};
    q.out = { sinceT: null, revealed: false };
    G.decoys = G.decoys.filter((d) => d.owner !== q.id);
    G.lastCatch = { hunter: by ? by.name : null, prey: q.name, T: G.T };
    const left = this.prey().length;
    this.ev(q, {
      type: 'converted', by: by ? by.name : null, why,
      L: Math.round(this.liveSec()), pings: q.pings, bonus: q.pings * ECONOMY.perPingSurvived, gc: q.gc,
      mates: this.hunters().filter((h) => h !== q).map((h) => h.name), left
    });
    for (const fn of this.hooks.convert) fn(q, by, why);
    this.dirty = true;
  }

  checkEnd() {
    if (this.inMatch && this.prey().length === 0) this.end('hunters', 'all-caught');
  }

  end(winner, reason) {
    const G = this.G;
    if (!this.inMatch) return;
    if (winner === 'prey') {
      for (const q of this.prey()) {
        q.gc += ECONOMY.survivorBonus;
        q.earned += ECONOMY.survivorBonus;
      }
    }
    const byId = (id) => (G.players[id] ? G.players[id].name : null);
    const board = this.all().map((q) => ({
      id: q.id, name: q.name, startRole: q.startRole, role: q.role,
      earned: q.earned, gc: q.gc, catches: q.catches, pings: q.pings,
      caughtL: q.caughtT == null ? null : Math.round(this.liveSec(q.caughtT)),
      caughtBy: byId(q.caughtBy), caughtWhy: q.caughtWhy, dropped: q.dropped
    }));
    board.sort((a, b) => b.earned - a.earned || b.catches - a.catches || a.name.localeCompare(b.name));
    G.result = {
      winner, reason,
      L: Math.round(this.liveSec()),
      leftSec: Math.max(0, Math.round((G.endT - G.T) / 1000)),
      mode: G.mode,
      lastCatch: G.lastCatch ? { hunter: G.lastCatch.hunter, prey: G.lastCatch.prey } : null,
      survivors: this.prey().map((q) => q.name),
      board
    };
    G.phase = 'ended';
    G.paused = false;
    G.pauseReason = null;
    for (const q of this.all()) q.tag = null;
    for (const fn of this.hooks.end) fn();
    this.dirty = true;
  }

  pause(reason) {
    if (!this.inMatch || this.G.paused) return;
    this.G.paused = true;
    this.G.pauseReason = reason;
    this.dirty = true;
  }
  resume(reason) {
    const G = this.G;
    if (!G.paused || (reason && G.pauseReason !== reason)) return;
    G.paused = false;
    G.pauseReason = null;
    this.lastTick = Date.now();
    this.dirty = true;
  }

  // ------------------------------------------------------------ loop
  tick() {
    if (this.stopped) return;
    const G = this.G;
    const now = Date.now();
    let dt = now - this.lastTick;
    this.lastTick = now;
    // The tab was suspended (screen locked, app switched). Clients saw the
    // host go quiet and froze their clocks, so do not charge that time.
    if (dt > 3000) dt = 0;

    for (const fn of this.hooks.tick) fn(now, dt);

    if (this.inMatch && !G.paused) {
      G.T += dt;
      if (G.phase === 'headstart' && G.T >= G.headT) {
        G.phase = 'live';
        this.evAll({ type: 'release' });
      }
      if (G.phase === 'live') {
        for (const fn of this.hooks.live) fn(now, dt);
        if (this.inMatch && G.T >= G.endT) this.end('prey', 'time');
      }
    }

    if (this.dirty || now - this.lastSnap >= CONFIG.net.snapshotSec * 1000) this.broadcast(now);
  }

  broadcast(now = Date.now()) {
    this.dirty = false;
    this.lastSnap = now;
    for (const p of this.all()) if (p.cid != null) this.to(p, this.view(p));
  }

  // What one player is allowed to know right now.
  view(p) {
    const G = this.G;
    const inMatch = this.inMatch;
    const v = {
      k: 'snap',
      T: Math.round(G.T),
      phase: G.phase, paused: G.paused, pauseReason: G.pauseReason,
      code: G.code, mode: G.mode, rules: G.rules, round: G.round,
      headT: G.headT, endT: G.endT, nextPingT: G.nextPingT,
      zone: this.zoneNow(),
      players: this.all().map((q) => ({
        id: q.id, name: q.name, role: q.role, ready: q.ready, conn: q.conn,
        host: this.isHost(q), you: q === p, dropped: q.dropped,
        // voice peer IDs go to teammates only
        peer: inMatch && q !== p && q.role === p.role ? q.peer : undefined
      })),
      counts: { prey: this.prey().length, hunters: this.hunters().length },
      me: {
        id: p.id, name: p.name, role: p.role, startRole: p.startRole, ready: p.ready, host: this.isHost(p),
        gc: p.gc, earned: p.earned, inv: p.inv, fx: {},
        pin: p.role === 'prey' ? p.pin : null,
        catches: p.catches, pings: p.pings,
        caughtL: p.caughtT == null ? null : Math.round(this.liveSec(p.caughtT)),
        caughtAt: p.caughtAt
      },
      pings: [], live: [],
      ev: p.ev,
      result: G.phase === 'ended' ? G.result : null
    };
    for (const fn of this.hooks.view) fn(p, v);
    return v;
  }

  // The host is leaving: tell everyone and stop.
  shutdown(reason) {
    for (const p of this.all()) if (p.cid !== 'local') this.to(p, { k: 'bye', reason });
    this.stop();
    this.local.deliver({ k: 'bye', reason: 'self' });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
