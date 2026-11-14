# Signalling server

City Hunter needs a small server so phones can find each other. By default it uses the free public PeerJS cloud, which has no uptime promise. This folder is your own copy of that server.

## Deploy

**Render (free plan):** in Render choose New + → Blueprint and pick this repo. `render.yaml` at the repo root does the rest. You get an address like `cityhunter-signalling.onrender.com`.

Any Node host works: run `npm install && npm start` in this folder. It listens on `$PORT`.

The host must support WebSockets and long-lived connections, so Vercel and other serverless platforms will not work.

## Point the game at it

In `js/config.js`:

```js
net: {
  peerServer: { host: 'cityhunter-signalling.onrender.com', port: 443, path: '/', secure: true },
```

Free plans sleep when idle, so the first lobby after a quiet spell can take up to a minute to open.

## Mobile data (TURN)

Phones on 4G/5G sometimes cannot connect to each other directly and need a relay. The game currently relies on PeerJS's free shared relay. For dependable play, sign up with a TURN provider (Cloudflare Calls, Metered, Twilio) and put the servers they give you in `js/config.js`:

```js
net: {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:YOUR_TURN_HOST:3478', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' }
  ],
```

Anything in `js/config.js` is public, so use the short-lived or rate-limited credentials your provider offers for browser use.
