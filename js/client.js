// The player's side of a match: latest snapshot from the host, a local
// estimate of game time, position reporting, chat and the recorded route.

import { CONFIG } from './config.js';
import { Emitter, dist, store } from './util.js';

const PATH_KEY = 'ch2.path';

export class Session extends Emitter {
  constructor({ link, token, name, isHost, geo }) {
    super();
    this.link = link;
    this.token = token;
    this.name = name;
    this.isHost = isHost;
    this.geo = geo;
    this.id = null;
    this.snap = null;
    this.recvAt = 0;
    this.frozenT = null;
    this.lastEvN = null;
    this.chat = { team: [], all: [] };
    this.unread = { team: 0, all: 0 };
    this.chatOpen = null;
    this.path = [];
    this.pathKey = null;
    this.lastPosSent = 0;
    this.closed = false;

    link.on('message', (m) => this.onMessage(m));
    link.on('up', () => this.hello());
    link.on('state', () => this.onLink());
    this.offFix = geo.on('fix', () => this.onFix());
    this.beat = setInterval(() => this.heartbeat(), CONFIG.net.heartbeatSec * 1000);
  }

  get inMatch() {
    return !!this.snap && (this.snap.phase === 'headstart' || this.snap.phase === 'live');
  }

  hello() {
    this.link.send({ k: 'hello', token: this.token, name: this.name });
  }

  send(msg) {
    return this.link.send(msg);
  }

  // Best estimate of game time right now. The match clock keeps running
  // while MY connection is down, and freezes while the HOST is unreachable.
  T() {
    const s = this.snap;
    if (!s) return 0;
    if (!this.inMatch || s.paused) return s.T;
    if (this.frozenT != null) return this.frozenT;
    return s.T + (performance.now() - this.recvAt);
  }

  onLink() {
    const st = this.link.state;
    const hostGone = st.status !== 'online' && st.cause === 'host';
    if (hostGone && this.frozenT == null && this.snap) {
      // Freeze at the last moment the host was demonstrably alive.
      this.frozenT = this.snap.T + Math.min(performance.now() - this.recvAt, CONFIG.net.heartbeatTimeoutSec * 1000);
    }
    if (!hostGone && this.frozenT != null && st.cause === 'self') this.frozenT = null;
    this.emit('link', st);
    this.emit('update');
  }

  onMessage(m) {
    switch (m.k) {
      case 'welcome':
        this.id = m.id;
        break;
      case 'snap':
        this.onSnap(m);
        break;
      case 'chat':
        this.onChat(m);
        break;
      case 'chathist':
        this.chat[m.ch] = m.list || [];
        this.emit('chat');
        break;
      case 'reject':
      case 'bye':
        this.emit(m.k, m.reason);
        break;
      default:
        this.emit(m.k, m);
    }
  }

  onSnap(s) {
    const prev = this.snap;
    this.snap = s;
    this.recvAt = performance.now();
    this.frozenT = null;

    // A new match: start a fresh route.
    const key = s.code + ':' + s.round;
    if (this.pathKey !== key) {
      this.pathKey = key;
      const saved = store.get(PATH_KEY, null, sessionStorage);
      this.path = saved && saved.key === key ? saved.pts : [];
    }
    if (prev && prev.me.role !== s.me.role) {
      this.chat.team = [];
      this.unread.team = 0;
      this.emit('role', s.me.role, prev.me.role);
    }
    if (prev && prev.phase !== s.phase) this.emit('phase', s.phase, prev.phase);

    // Events are delivered once. After a page reload the backlog is skipped.
    const evs = s.ev || [];
    if (this.lastEvN == null) this.lastEvN = evs.length ? evs[evs.length - 1].n : 0;
    for (const e of evs) {
      if (e.n > this.lastEvN) {
        this.lastEvN = e.n;
        this.emit('event', e);
      }
    }
    this.emit('update');
  }

  onChat(m) {
    const ch = m.ch === 'all' ? 'all' : 'team';
    const list = this.chat[ch];
    if (list.some((x) => x.n === m.n)) return;
    list.push(m);
    if (list.length > CONFIG.chat.history) list.shift();
    if (this.chatOpen !== ch && m.from !== this.id) this.unread[ch]++;
    this.emit('chat', m);
  }

  // ---- position ----
  onFix() {
    const fix = this.geo.fix;
    if (!this.inMatch || !fix) return;
    const last = this.path[this.path.length - 1];
    if (!last || dist({ lat: last[0], lng: last[1] }, fix) >= CONFIG.gps.minMoveM) {
      this.path.push([+fix.lat.toFixed(6), +fix.lng.toFixed(6), this.snap.me.role === 'hunter' ? 1 : 0]);
      if (this.path.length > 3000) this.path.splice(0, this.path.length - 3000);
      if (this.path.length % 5 === 0) store.set(PATH_KEY, { key: this.pathKey, pts: this.path }, sessionStorage);
    }
    if (Date.now() - this.lastPosSent >= CONFIG.net.posSendSec * 1000) this.sendPos();
  }

  sendPos() {
    const fix = this.geo.fix;
    if (!this.inMatch || !fix || this.geo.blocked) return;
    if (Date.now() - fix.at > CONFIG.gps.lostAfterSec * 1000) return;
    this.lastPosSent = Date.now();
    this.send({ k: 'pos', lat: fix.lat, lng: fix.lng, acc: fix.acc, hdg: fix.hdg });
  }

  heartbeat() {
    if (this.closed) return;
    const peer = this.link.peer;
    this.send({ k: 'hb', peer: peer && peer.open ? peer.id : null });
    if (Date.now() - this.lastPosSent >= CONFIG.net.posSendSec * 1000) this.sendPos();
  }

  close() {
    this.closed = true;
    clearInterval(this.beat);
    this.offFix();
  }
}
