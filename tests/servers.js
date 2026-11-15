// Test servers: a static file server for the game (repo root) on :8080 and a
// local PeerJS signalling server on :9000, so tests never touch the internet.

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
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

http.createServer((req, res) => {
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

PeerServer({ port: 9000, host: '127.0.0.1', path: '/', alive_timeout: 15000 }, () => console.log('signalling on :9000'));
