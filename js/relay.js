// Relay: a second way for a phone to reach the host.
//
// Normally every player holds a direct WebRTC link to the host (js/net.js).
// On some mobile networks two phones cannot open one. Then the game falls
// back to passing its messages through a relay: a hosted WebSocket service
// (Supabase Realtime) that forwards whatever is sent on a named channel to
// everybody else on that channel.
//
// The relay must not be able to read the game, and neither must anyone who
// guesses a channel name. So each player and the host agree a secret first:
//
//   door     realtime:ch2-<code>         the host listens here
//   private  realtime:ch2-<code>-<id>    one per relayed player
//
//   1. the player joins its private channel and knocks on the door with a
//      fresh public key
//   2. the host joins that private channel and answers with its public key
//   3. both derive the same AES-GCM key (ECDH P-256); every game message
//      from then on is encrypted with it and numbered, so it cannot be read,
//      changed or replayed
//
// What a relayed player loses: voice chat (that is WebRTC audio), and about
// a second of freshness.
//
// The wire format is the Phoenix channels protocol that Supabase Realtime
// speaks. tests/servers.js has a tiny stand-in for it.

import { CONFIG } from './config.js';
import { Emitter, uid } from './util.js';

const R = CONFIG.relay;

export const relayOn = () => !!(R.enabled && R.url && window.WebSocket && window.crypto && crypto.subtle);

const doorTopic = (code) => 'realtime:ch2-' + code.toLowerCase();
const privTopic = (code, id) => doorTopic(code) + '-' + id;

// ---------------------------------------------------------------- bytes
const b64 = (buf) => {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- crypto
const newKeys = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
const exportPub = async (keys) => b64(await crypto.subtle.exportKey('raw', keys.publicKey));

async function sharedKey(keys, theirPub) {
  const pub = await crypto.subtle.importKey('raw', unb64(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// One encrypted, ordered, replay-proof stream in each direction.
class Sealed {
  constructor(key, dir) {
    this.key = key;
    this.out = 0;
    this.in = 0;
    this.dir = dir;                    // 'h' host -> player, 'p' player -> host
    this.queue = Promise.resolve();    // keeps messages in the order they were sent
  }
  seal(msg) {
    const n = ++this.out;
    const job = this.queue.then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(this.dir) }, this.key, enc.encode(JSON.stringify({ n, m: msg })));
      return { i: b64(iv), d: b64(data) };
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async open(packet, fromDir) {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(packet.i), additionalData: enc.encode(fromDir) }, this.key, unb64(packet.d));
    const body = JSON.parse(dec.decode(data));
    if (!(body.n > this.in)) return null;   // old or repeated: drop
    this.in = body.n;
    return body.m;
  }
}

// ---------------------------------------------------------------- socket
// A minimal Phoenix-channels client: join topics, broadcast, heartbeat, and
// reconnect with every topic re-joined.
class RelaySocket extends Emitter {
  constructor() {
    super();
    this.ws = null;
    this.ref = 0;
    this.topics = new Set();
    this.joined = new Set();
    this.closed = false;
    this.tries = 0;
    this.beat = null;
    this.timer = null;
  }
  get open() {
    return !!this.ws && this.ws.readyState === 1;
  }
  connect() {
    if (this.closed) return;
    clearTimeout(this.timer);
    let ws;
    try {
      ws = new WebSocket(R.url + '?apikey=' + encodeURIComponent(R.key) + '&vsn=1.0.0');
    } catch (e) {
      return this._retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.tries = 0;
      this.joined.clear();
      for (const t of this.topics) this._join(t);
      clearInterval(this.beat);
      this.beat = setInterval(() => this._raw('phoenix', 'heartbeat', {}), R.heartbeatSec * 1000);
      this.emit('open');
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && this.topics.has(m.topic)) {
        if (!this.joined.has(m.topic)) {
          this.joined.add(m.topic);
          this.emit('joined', m.topic);
        }
      } else if (m.event === 'broadcast' && m.payload && m.payload.payload) {
        this.emit('message', m.topic, m.payload.payload);
      } else if (m.event === 'phx_error' || m.event === 'phx_close') {
        this.joined.delete(m.topic);
        if (this.topics.has(m.topic)) setTimeout(() => this.open && this._join(m.topic), 1000);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.beat);
      this.joined.clear();
      this.emit('close');
      this._retry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }
  _retry() {
    if (this.closed) return;
    const steps = CONFIG.net.reconnectBackoffSec;
    this.timer = setTimeout(() => this.connect(), steps[Math.min(this.tries++, steps.length - 1)] * 1000);
  }
  _raw(topic, event, payload) {
    if (!this.open) return false;
    try {
      this.ws.send(JSON.stringify({ topic, event, payload, ref: String(++this.ref), join_ref: topic }));
      return true;
    } catch (e) {
      return false;
    }
  }
  _join(topic) {
    this._raw(topic, 'phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } });
  }
  join(topic) {
    if (this.topics.has(topic)) return;
    this.topics.add(topic);
    if (this.open) this._join(topic);
  }
  leave(topic) {
    if (!this.topics.delete(topic)) return;
    this.joined.delete(topic);
    this._raw(topic, 'phx_leave', {});
  }
  send(topic, payload) {
    return this.joined.has(topic) && this._raw(topic, 'broadcast', { type: 'broadcast', event: 'm', payload });
  }
  close() {
    this.closed = true;
    clearInterval(this.beat);
    clearTimeout(this.timer);
    try { if (this.ws) this.ws.close(); } catch (e) { /* gone */ }
    this.ws = null;
  }
}

// ---------------------------------------------------------------- host end
// Emits: 'message' (cid, msg), 'down' (cid). cids look like 'r:ab12cd34'.
export class RelayHost extends Emitter {
  constructor(code) {
    super();
    this.code = code;
    this.sock = new RelaySocket();
    this.links = new Map();          // id -> { sealed, lastRx, pub }
    this.keys = null;
    this.pub = null;
    this.door = doorTopic(code);
    this.sock.on('message', (topic, p) => this._onMessage(topic, p));
  }
  async start() {
    try {
      this.keys = await newKeys();
      this.pub = await exportPub(this.keys);
      this.sock.join(this.door);
      this.sock.connect();
    } catch (e) { /* no relay on this device: direct links still work */ }
  }
  async _onMessage(topic, p) {
    try {
      if (topic === this.door) {
        if (!p || p.t !== 'knock' || !/^[a-z0-9]{8,16}$/.test(p.id) || typeof p.pub !== 'string' || p.pub.length > 200) return;
        let link = this.links.get(p.id);
        if (!link || link.pub !== p.pub) {
          if (this.links.size >= R.maxLinks && !link) return;
          link = { pub: p.pub, sealed: new Sealed(await sharedKey(this.keys, p.pub), 'h'), lastRx: Date.now() };
          this.links.set(p.id, link);
          this.sock.join(privTopic(this.code, p.id));
        }
        // Answer on the private channel (repeated knocks get repeated answers).
        const answer = () => this.sock.send(privTopic(this.code, p.id), { t: 'welcome', pub: this.pub });
        if (!answer()) setTimeout(answer, 600);
        return;
      }
      const id = topic.slice(this.door.length + 1);
      const link = this.links.get(id);
      if (!link || !p || p.t !== 'm') return;
      const msg = await link.sealed.open(p, 'p');
      if (msg == null) return;
      link.lastRx = Date.now();
      if (msg && typeof msg === 'object' && typeof msg.k === 'string') this.emit('message', 'r:' + id, msg);
    } catch (e) { /* not for us, or tampered with: ignore */ }
  }
  has(cid) {
    return this.links.has(String(cid).slice(2));
  }
  send(cid, msg) {
    const id = String(cid).slice(2);
    const link = this.links.get(id);
    if (!link || !this.sock.open) return false;
    link.sealed.seal(msg).then((packet) => this.sock.send(privTopic(this.code, id), { t: 'm', ...packet })).catch(() => {});
    return true;
  }
  drop(cid) {
    const id = String(cid).slice(2);
    if (!this.links.delete(id)) return;
    setTimeout(() => this.sock.leave(privTopic(this.code, id)), 300);
  }
  destroy() {
    this.sock.close();
    this.links.clear();
  }
}

// ---------------------------------------------------------------- player end
// Emits: 'up' (secret agreed, ready to send), 'message' (msg), 'down'.
export class RelayClient extends Emitter {
  constructor(code) {
    super();
    this.code = code;
    this.id = uid(10);
    this.sock = new RelaySocket();
    this.sealed = null;
    this.keys = null;
    this.pub = null;
    this.knock = null;
    this.ready = false;
    this.closed = false;
    this.topic = privTopic(code, this.id);
    this.door = doorTopic(code);
    this.sock.on('message', (topic, p) => this._onMessage(topic, p));
    this.sock.on('close', () => {
      if (this.ready) {
        this.ready = false;
        this.emit('down');
      }
    });
  }
  async start() {
    try {
      this.keys = await newKeys();
      this.pub = await exportPub(this.keys);
      this.sock.join(this.topic);
      this.sock.join(this.door);
      this.sock.connect();
      // Knock until the host answers (it may not be listening yet).
      const knock = () => !this.ready && !this.closed && this.sock.send(this.door, { t: 'knock', id: this.id, pub: this.pub });
      this.sock.on('joined', knock);
      this.knock = setInterval(knock, R.knockEverySec * 1000);
    } catch (e) {
      this.emit('down');
    }
  }
  async _onMessage(topic, p) {
    if (topic !== this.topic || !p) return;
    try {
      if (p.t === 'welcome' && !this.sealed && typeof p.pub === 'string') {
        this.sealed = new Sealed(await sharedKey(this.keys, p.pub), 'p');
        this.ready = true;
        clearInterval(this.knock);
        this.sock.leave(this.door);
        this.emit('up');
      } else if (p.t === 'm' && this.sealed) {
        const msg = await this.sealed.open(p, 'h');
        if (msg && typeof msg === 'object' && typeof msg.k === 'string') this.emit('message', msg);
      }
    } catch (e) { /* not ours: ignore */ }
  }
  send(msg) {
    if (!this.ready || !this.sock.open) return false;
    this.sealed.seal(msg).then((packet) => this.sock.send(this.topic, { t: 'm', ...packet })).catch(() => {});
    return true;
  }
  destroy() {
    this.closed = true;
    this.ready = false;
    clearInterval(this.knock);
    this.sock.close();
  }
}
