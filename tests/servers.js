// Test servers, so tests never touch the internet:
//   :8080  static file server for the game (repo root)
//   :9000  PeerJS signalling server
//   :9100  stand-in for the relay (the part of the Phoenix channels protocol
//          that js/relay.js uses: join, leave, broadcast, heartbeat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PeerServer } = require('peer');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};

// A 1x1 PNG stands in for every map tile (tests never reach a real tile server).
const reports = [];
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

http.createServer((req, res) => {
  // Stand-in for the problem-report table: POST adds a row, GET lists them.
  if (req.url.startsWith('/__reports')) {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { reports.push({ ...JSON.parse(body), key: req.headers.apikey }); } catch (e) { /* ignore */ }
        res.writeHead(201);
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(reports));
  }
  // What the relay stand-in has carried (so a test can check it was used, and that nothing readable went through).
  if (req.url.startsWith('/__relay')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(relayStats));
  }
  if (/^\/tiles\/\d+\/\d+\/\d+\.png/.test(req.url)) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
    return res.end(TILE);
  }
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || /[\\/](tests|server|node_modules|\.git)[\\/]/.test(file)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(8080, '127.0.0.1', () => console.log('game on http://127.0.0.1:8080'));

// ---- relay stand-in ----
const { WebSocketServer } = require('ws');
const relay = new WebSocketServer({ port: 9100, host: '127.0.0.1' });
const rooms = new Map();          // topic -> Set of sockets
const relayStats = { messages: 0, joins: 0 };
relay.on('connection', (ws) => {
  ws.topics = new Set();
  const reply = (m, status = 'ok') => ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status, response: {} }, ref: m.ref }));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.event === 'heartbeat') return reply(m);
    if (m.event === 'phx_join') {
      if (!rooms.has(m.topic)) rooms.set(m.topic, new Set());
      rooms.get(m.topic).add(ws);
      ws.topics.add(m.topic);
      relayStats.joins++;
      return reply(m);
    }
    if (m.event === 'phx_leave') {
      if (rooms.has(m.topic)) rooms.get(m.topic).delete(ws);
      ws.topics.delete(m.topic);
      return reply(m);
    }
    if (m.event === 'broadcast' && ws.topics.has(m.topic)) {
      relayStats.messages++;
      relayStats.last = JSON.stringify(m.payload).slice(0, 400);
      for (const other of rooms.get(m.topic) || []) {
        if (other !== ws && other.readyState === 1) other.send(JSON.stringify({ topic: m.topic, event: 'broadcast', payload: m.payload, ref: null }));
      }
    }
  });
  ws.on('close', () => {
    for (const t of ws.topics) if (rooms.has(t)) rooms.get(t).delete(ws);
  });
});
console.log('relay stand-in on :9100');

PeerServer({ port: 9000, host: '127.0.0.1', path: '/', alive_timeout: 15000 }, () => console.log('signalling on :9000'));
