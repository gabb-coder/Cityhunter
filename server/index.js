// City Hunter signalling server.
//
// Phones use this only to find each other; game data then flows directly
// between them over WebRTC. It is the standard PeerJS server, nothing custom.
//
//   PORT           port to listen on (hosts like Render and Fly set this)
//   ALIVE_TIMEOUT  ms before a silent phone's ID is freed (default 60000)

const { PeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;

PeerServer({
  port,
  host: '0.0.0.0',
  path: '/',
  proxied: true,
  alive_timeout: Number(process.env.ALIVE_TIMEOUT) || 60000,
  allow_discovery: false
}, () => console.log('City Hunter signalling server listening on port ' + port));
