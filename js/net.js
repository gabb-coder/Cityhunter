// PeerJS transport.
//
// Topology is a star: every player holds one data channel to the host and
// the host relays everything. The host's peer ID is derived from the lobby
// code, so a host that reloads comes back under the same ID and clients can
// redial it without learning anything new.
//
//   HostNet    the host's end: accepts connections, tracks them by `cid`
//   ClientNet  a guest's end: one connection to the host, with a heartbeat
//              watchdog and an automatic redial loop
//   LocalLink  the host's own player talks to the host game in-process

/* global Peer */
import { CONFIG } from './config.js';
import { Emitter } from './util.js';

const N = CONFIG.net;

export const hostPeerId = (code) => N.peerIdPrefix + code.toLowerCase();

function peerOptions() {
  const o = { debug: 1 };
  if (N.peerServer) Object.assign(o, N.peerServer);
  if (N.iceServers) o.config = { iceServers: N.iceServers };
  return o;
}

const wire = (msg) => JSON.parse(JSON.stringify(msg));

// ---------------------------------------------------------------- host
export class HostNet extends Emitter {
  constructor(code) {
    super();
    this.id = hostPeerId(code);
    this.conns = new Map();
    this.nextCid = 1;
    this.peer = null;
    this.closed = false;
    this.signal = false;      // connected to the signalling server?
    this.watch = null;
  }

  // Resolves once the host ID is registered. With keepTrying (resuming a
  // match) an "ID taken" error is retried: after a crash the signalling
  // server can hold the old registration for up to a minute.
  start({ keepTrying = false } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const open = () => {
        if (!settled) { settled = true; resolve(); }
      };
      const fail = (err) => {
        if (!settled && !keepTrying) { settled = true; reject(err); return true; }
        return false;
      };
      this._make(open, fail);
    });
  }

  _make(onOpen, onFail) {
    if (this.closed) return;
    const peer = new Peer(this.id, peerOptions());
    this.peer = peer;
    this.emit('peer', peer);

    peer.on('open', () => {
      this.signal = true;
      this.emit('signal', true);
      onOpen();
    });

    peer.on('connection', (conn) => this._accept(conn));

    peer.on('disconnected', () => {
      this.signal = false;
      this.emit('signal', false);
    });

    peer.on('error', (err) => {
      console.warn('[host net]', err.type, err.message);
      if (err.type === 'peer-unavailable') return;
      if (onFail(err)) {
        this.closed = true;
        try { peer.destroy(); } catch (e) { /* already gone */ }
      }
    });

    // Signalling watchdog: re-register whenever the socket is gone. A fatal
    // error (including "ID taken" while resuming) destroys the peer, so it
    // is rebuilt under the same ID.
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (this.closed) return clearInterval(this.watch);
      if (this.peer !== peer) return;
      if (peer.destroyed) {
        this.signal = false;
        this._make(onOpen, onFail);
      } else if (peer.disconnected) {
        try { peer.reconnect(); } catch (e) { /* retried on the next pass */ }
      }
    }, 4000);
  }

  _accept(conn) {
    const cid = this.nextCid++;
    this.conns.set(cid, conn);
    conn.on('data', (msg) => {
      if (msg && typeof msg === 'object' && typeof msg.k === 'string') this.emit('message', cid, msg, conn.peer);
    });
    const down = () => {
      if (this.conns.get(cid) !== conn) return;
      this.conns.delete(cid);
      this.emit('down', cid);
    };
    conn.on('close', down);
    conn.on('error', down);
  }

  send(cid, msg) {
    const conn = this.conns.get(cid);
    if (!conn || !conn.open) return false;
    try {
      conn.send(msg);
      return true;
    } catch (e) {
      return false;
    }
  }

  drop(cid) {
    const conn = this.conns.get(cid);
    this.conns.delete(cid);
    if (conn) setTimeout(() => { try { conn.close(); } catch (e) { /* gone */ } }, 200);
  }

  destroy() {
    this.closed = true;
    clearInterval(this.watch);
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* gone */ }
  }
}

// ---------------------------------------------------------------- client
export class ClientNet extends Emitter {
  constructor(code) {
    super();
    this.hostId = hostPeerId(code);
    this.peer = null;
    this.conn = null;
    this.closed = false;
    this.everOnline = false;
    this.lastRx = 0;
    this.timer = null;
    this.dialTimer = null;
    this.gen = 0;
    // status: connecting | online | reconnecting | failed
    // cause:  null | 'self' (my connection) | 'host' (host unreachable)
    this.state = { status: 'connecting', cause: null, attempt: 0, downSince: 0, error: null };
    this.watchdog = setInterval(() => this._watch(), 1000);
    this._online = () => this.state.status === 'reconnecting' && this.retryNow();
    window.addEventListener('online', this._online);
  }

  start() {
    this._attempt();
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', this.state);
  }

  _attempt() {
    if (this.closed) return;
    clearTimeout(this.timer);
    clearTimeout(this.dialTimer);
    const gen = ++this.gen;
    this._set({ attempt: this.state.attempt + 1 });
    this.dialTimer = setTimeout(() => gen === this.gen && this._fail('timeout'), N.dialTimeoutSec * 1000);
    if (this.state.status === 'reconnecting') this._probe(gen);

    const peer = this.peer;
    if (!peer || peer.destroyed) this._makePeer(gen);
    else if (peer.disconnected) {
      try { peer.reconnect(); } catch (e) { this._makePeer(gen); }
    } else this._dial(gen);
  }

  _makePeer(gen) {
    try { if (this.peer && !this.peer.destroyed) this.peer.destroy(); } catch (e) { /* gone */ }
    const peer = new Peer(peerOptions());
    this.peer = peer;
    this.emit('peer', peer);
    peer.on('open', () => this.peer === peer && this._dial(this.gen));
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      console.warn('[net]', err.type);
      if (this.state.status === 'online') return;
      if (err.type === 'peer-unavailable') {
        // Voice calls to an offline teammate raise this too: only react
        // when it is the host that the signalling server cannot find.
        if (!String(err.message || '').includes(this.hostId)) return;
        this._set({ cause: 'host' });
        this._fail('host-missing');
      } else {
        this._fail(err.type);
      }
    });
    // Signalling dropped while the data channel is still up: quietly
    // re-register so voice calls and later redials keep working.
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (this.peer === peer && !this.closed && !peer.destroyed && peer.disconnected && this.state.status === 'online') {
          try { peer.reconnect(); } catch (e) { /* next redial rebuilds it */ }
        }
      }, 2000);
    });
  }

  _dial(gen) {
    if (this.closed || gen !== this.gen) return;
    if (this.conn) { try { this.conn.close(); } catch (e) { /* gone */ } }
    const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'json' });
    this.conn = conn;
    conn.on('open', () => {
      if (this.conn !== conn || this.closed) return;
      clearTimeout(this.dialTimer);
      this.gen++;
      this.everOnline = true;
      this.lastRx = Date.now();
      this._set({ status: 'online', cause: null, attempt: 0, downSince: 0, error: null });
      this.emit('up');
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn) return;
      this.lastRx = Date.now();
      if (msg && typeof msg === 'object' && typeof msg.k === 'string') this.emit('message', msg);
    });
    const down = () => this.conn === conn && this._down();
    conn.on('close', down);
    conn.on('error', down);
  }

  // One attempt failed: give up (first join) or back off and try again.
  _fail(reason) {
    if (this.closed) return;
    clearTimeout(this.dialTimer);
    this.gen++;
    if (!this.everOnline) {
      if (reason === 'host-missing' || this.state.attempt >= 3) {
        this._set({ status: 'failed', error: reason === 'host-missing' ? 'not-found' : 'network' });
        return;
      }
    }
    const steps = N.reconnectBackoffSec;
    const wait = steps[Math.min(this.state.attempt - 1, steps.length - 1)] * 1000;
    // A dead signalling socket is replaced rather than nursed.
    if (reason === 'timeout' && this.peer && !this.peer.open) {
      try { this.peer.destroy(); } catch (e) { /* gone */ }
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._attempt(), wait);
  }

  _down() {
    if (this.closed || this.state.status !== 'online') return;
    try { if (this.conn) this.conn.close(); } catch (e) { /* gone */ }
    this.conn = null;
    this._set({ status: 'reconnecting', cause: navigator.onLine === false ? 'self' : null, attempt: 0, downSince: Date.now() });
    this.emit('down');
    this._attempt();
  }

  _watch() {
    if (this.state.status !== 'online') return;
    if (Date.now() - this.lastRx > N.heartbeatTimeoutSec * 1000) this._down();
  }

  // Is it me or the host? Fetch a tiny same-origin resource: if that works
  // my connection is fine, so the host must be the one that is unreachable.
  async _probe(gen) {
    if (navigator.onLine === false) return this._set({ cause: 'self' });
    let ok = false;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch('index.html?probe=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      ok = res.ok;
    } catch (e) {
      ok = false;
    }
    if (this.closed || this.state.status !== 'reconnecting') return;
    this._set({ cause: ok ? 'host' : 'self' });
  }

  retryNow() {
    if (this.closed || this.state.status === 'online') return;
    if (this.state.status === 'failed') this._set({ status: 'connecting', attempt: 0, error: null });
    this._attempt();
  }

  send(msg) {
    const conn = this.conn;
    if (!conn || !conn.open || this.state.status !== 'online') return false;
    try {
      conn.send(msg);
      return true;
    } catch (e) {
      return false;
    }
  }

  destroy() {
    this.closed = true;
    clearInterval(this.watchdog);
    clearTimeout(this.timer);
    clearTimeout(this.dialTimer);
    window.removeEventListener('online', this._online);
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* gone */ }
  }
}

// ---------------------------------------------------------------- local
// The host's own player. Messages are copied through JSON so the host game
// and the host's UI never share objects, exactly like a real connection.
export class LocalLink extends Emitter {
  constructor(net) {
    super();
    this.state = { status: 'online', cause: null, attempt: 0, downSince: 0, error: null };
    this.host = null;
    this.net = net;
  }
  get peer() {
    return this.net ? this.net.peer : null;
  }
  send(msg) {
    const copy = wire(msg);
    queueMicrotask(() => this.host && this.host.fromLocal(copy));
    return true;
  }
  deliver(msg) {
    const copy = wire(msg);
    queueMicrotask(() => this.emit('message', copy));
  }
  retryNow() {}
  destroy() {
    this.host = null;
  }
}
