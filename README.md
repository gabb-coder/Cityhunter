# City Hunter

A real-world GPS manhunt for phones. Hunters chase prey on a live map; a caught prey becomes a hunter. Vanilla JS, PeerJS (WebRTC, peer to peer), Leaflet. No framework and no build step.

> **Game facts are placeholders.** The ability names and prices, Glowcoin amounts and mode presets in `js/config.js` came from the design prototype, because the original game code was not in this repo when v2 was built. Replace `ECONOMY`, `MODES` and `ABILITIES` with the real values.

## Run it

Serve the folder with any static server and open it on each phone:

```bash
python3 -m http.server 8080
```

Phones only give GPS to HTTPS pages, so for real play host it somewhere with HTTPS (GitHub Pages works as is). `localhost` is fine for desk testing.

## Theme system

- Two themes, switched by `data-theme="dark|sun"` on `<html>`. The choice is saved in `localStorage` (`ch2.theme`) and applied before first paint by a small inline script in `index.html`.
- Every colour, border weight and font weight is a CSS custom property in `css/base.css`. Components read tokens only, so a new theme is one more `[data-theme='…']` block.
- `js/theme.js` owns changes (`theme.set`, `theme.toggle`). The toggle button is on Home and on both map screens.
- The map reads the same tokens at runtime (`js/map.js`), so markers follow the theme.
- Two screens ignore the theme on purpose: **Tagged** is always light and high-contrast, and the **conversion** screen is always brand orange.
- Sun theme rules: 2 px black borders on controls, hunter `#B83A0B` with white text, prey fill `#7DD3FC` with dark text, lime text becomes `#3F6A00`, weights one step heavier and small labels +1 px.

## Config

Everything tunable is in `js/config.js`.

| Key | Default | Meaning |
|---|---|---|
| `catch.rangeM` | 15 | Hunter must be this close for a catch |
| `catch.accuracySlackMaxM` | 20 | Extra distance allowed for poor GPS accuracy (capped) |
| `catch.maxWrongPins` / `lockoutSec` | 3 / 30 | Wrong PINs before a hunter is locked out, and for how long |
| `catch.allowWhenGpsStale` | true | A correct PIN still counts if one side has no fresh fix |
| `catch.nearHunterM` | 60 | "I've been caught" only names a hunter this close |
| `gps.lostAfterSec` | 10 | No fix for this long shows the GPS-lost sheet |
| `gps.graceSec` | 120 | Grace before the host is told and the circle keeps widening |
| `gps.weakAccuracyM` | 30 | Accuracy worse than this shows WEAK GPS in the HUD |
| `gps.keepAliveMaxAgeSec` | 30 | A phone standing still may reuse a fix this old (0 = strict) |
| `zone.outGraceSec` | 30 | GET BACK IN countdown before a prey is revealed live |
| `zone.walkSpeedMps` | 1.4 | Used for the "about 30 s walking" estimate |
| `ping.urgentSec` | 20 | NEXT PING bar turns orange in the last N seconds |
| `ping.firstPingAtRelease` | true | Ping everyone the moment hunters are released |
| `ping.proximityAlertM` | 150 | Prey banner when a hunter's last ping is this close |
| `ping.baseRadiusM` / `growMps` / `maxRadiusM` | 20 / 1.2 / 250 | Prey circle size, growth with ping age, and cap |
| `ping.lostMaxRadiusM` | 2000 | Cap once a player's GPS grace has run out |
| `net.heartbeatSec` / `heartbeatTimeoutSec` | 2 / 8 | Heartbeat interval and the silence that counts as a dropped link |
| `net.spotHoldSec` | 300 | A disconnected player's spot is held this long |
| `net.hostOfflineHoldSec` | 180 | Match stays paused this long waiting for the host |
| `net.reconnectBackoffSec` | 1, 2, 3, 5, 8 | Wait between reconnect attempts |
| `net.peerServer` | null | `null` = PeerJS cloud, or `{ host, port, path, secure }` for your own PeerServer |
| `map.tiles.dark` / `map.tiles.sun` | OpenStreetMap | Tile URL, CSS filter and attribution per theme |

`ECONOMY`, `MODES`, `RULE_OPTIONS` and `ABILITIES` in the same file hold the game facts.

**Map tiles:** CARTO's `dark_all` / `light_all` now answer every keyless request with an "API key required" tile, so the default is OpenStreetMap's standard tiles, darkened with a CSS filter for the dark theme. If you have a CARTO key, put its URL template in `CONFIG.map.tiles`. OpenStreetMap's tile servers are for light use only.

## How the v2 mechanics work

The host's phone runs the authoritative game (`js/host.js` plus the `js/host-*.js` features). Every other player holds one data channel to the host. Each second the host sends each player a snapshot containing only what that player may see.

- **Catch PIN** (`js/host-catch.js`): the host makes one random 4-digit PIN per prey at match start and puts it only in that prey's own snapshot. A hunter sends `{target, pin}`; the host checks the PIN, the distance and Safe House, then replies to the hunter and converts the prey. The host's own phone necessarily holds every PIN, so a host who also plays has to be trusted.
- **GPS lost** (`js/host-safety.js`, `js/ui/alerts.js`): after the grace period the client tells the host, the host player gets a notice, and that player's ping stops refreshing so its circle keeps growing.
- **Out of zone**: the host times it and, at zero, adds that prey's live position to every hunter's snapshot until they are back inside.
- **Connection lost** (`js/net.js`, `js/ui/net.js`): clients redial the host in a loop. A same-origin probe request tells "my connection is down" from "the host is unreachable".
- **Host offline** (`js/host-resilience.js`, `js/resume.js`): the host's peer ID is derived from the lobby code and the game is saved to `localStorage` every 2 s. Reloading the host tab resumes automatically; a fresh tab on the same phone gets a "Resume hosting" card on Home. Clients freeze their clocks while the host is away and end the match with no winner after `hostOfflineHoldSec`. Game time only advances while the host is running, so downtime is never charged to the match.

## Testing at a desk

- `?sim=51.5073,-0.1657` fakes GPS at that point; tap the map to walk.
- `?ps=localhost:9000` uses a local PeerServer instead of the PeerJS cloud.
- `window.CH` exposes the app state in the console. `CH.geo.blocked = true` simulates losing GPS.
- Open one tab per player. Each tab is a separate player.

## Limits to know about

- iOS and Android suspend a page when the screen locks. The app holds a screen wake lock during a match, but a locked or backgrounded phone stops sending GPS, and a locked host pauses the match for everyone.
- After a host crash the PeerJS cloud can keep the old ID registered for up to about a minute; the host retries until it frees up.
- There is no host migration. If the host cannot come back, the match ends with no winner.
- Hunters are told to hold position during the head start; this is not enforced by GPS.
- Voice is live WebRTC audio to teammates only and needs microphone permission.

## Layout

```
index.html            screens and layers (empty containers)
css/base.css          tokens, themes, shared components
css/*.css             one file per group of screens
js/config.js          every tunable value
js/host*.js           authoritative game (host phone only)
js/client.js          a player's view of the match
js/net.js             PeerJS transport, heartbeats, redial
js/geo.js, map.js     GPS watcher, Leaflet wrapper
js/ui/*.js            one module per screen
vendor/               Leaflet 1.9.4 and PeerJS 1.5.4
```
