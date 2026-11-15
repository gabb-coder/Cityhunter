# City Hunter

A real-world GPS manhunt for phones. Hunters chase prey on a live map; a caught prey becomes a hunter. Vanilla JS, PeerJS (WebRTC, peer to peer), Leaflet. No framework and no build step.

> **Game facts are placeholders.** The ability names and prices, Glowcoin amounts and mode presets in `js/config.js` came from the design prototype, because the original game code was not in this repo when v2 was built. Replace `ECONOMY`, `MODES` and `ABILITIES` with the real values.

## Run it

Serve the folder with any static server and open it on each phone:

```bash
python3 -m http.server 8080
```

Phones only give GPS to HTTPS pages, so for real play it needs an HTTPS address. The live copy is on Vercel at <https://cityhunter-eight.vercel.app/>, and every push to `main` redeploys it. `localhost` is fine for desk testing.

Players can install it: Android shows an "Install" button on Home, and on iPhone it is Share → Add to Home Screen. Installed, it runs full screen and the app shell still opens on a weak signal (`manifest.webmanifest`, `sw.js`).

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
| `catch.allowWhenGpsStale` | true | A correct PIN still counts if the prey has no fresh fix. The hunter always needs a live one |
| `catch.staleSlackMps` / `staleSlackMaxM` | 2 / 200 | Extra distance allowed per second since the prey's last fix, and its cap |
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
| `fair.maxSpeedMps` / `jumpMinM` | 12 / 80 | A move faster and farther than this between two fixes is flagged to the host |
| `fair.holdRadiusM` | 30 | Hunters must stay this close to their start point during the head start |
| `fair.holdPenaltySec` | 60 | A hunter outside it at release, or with no GPS fix there, cannot catch for this long (0 = warn only) |
| `fair.holdAccSlackMaxM` / `holdSetWithinSec` | 30 / 30 | How much poor accuracy can excuse, and how soon the start point must be fixed |
| `safety.showHelperLocation` | true | Everyone sees where a player who asked for help is |
| `safety.revealAfterHelpSec` | 60 | A prey who paused the match is shown live to hunters for this long afterwards (0 = off) |
| `late.joinAsHunter` / `allowSpectators` / `maxSpectators` | true / true / 8 | A player arriving mid-match joins the hunters; "Watch a match" is allowed; how many may watch |
| `marks.lifeSec` | 180 | How long a team map pin stays |
| `saver.dimAfterSec` / `mapRefreshMs` / `posSendSec` | 20 / 1000 / 4 | Battery saver: when the screen goes dark, and how often the map and position update |
| `replay.minMoveM` / `maxPoints` / `seconds` | 8 / 500 / 9 | Route recording detail and the length of the animated replay |
| `zone.shrinkStartFrac` / `shrinkEndFrac` | 0.2 / 0.85 | When a shrinking zone starts closing and when it reaches its final size |
| `zone.maxCorners` / `minAreaM2` / `maxSpanM` | 12 / 1500 / 6000 | Limits for a zone the host draws |
| `zone.maxNoGo` / `noGoTellHostSec` | 6 / 20 | No-go areas per match, and how long before the host is told about a player inside one |
| `scan.enabled` / `everyMs` / `maxSidePx` | true / 160 / 640 | Scan to catch: on or off, how often a camera frame is checked, and the size frames are shrunk to |
| `awards.*` | see file | Thresholds for the end-of-match awards |
| `map.offline.zooms` / `maxTiles` / `keepTiles` | 15–17 / 160 / 800 | Map tiles saved for the play zone at match start |
| `protocol` | 7 | Bump when messages change; phones on an older cached copy are turned away |
| `net.heartbeatSec` / `heartbeatTimeoutSec` | 2 / 8 | Heartbeat interval and the silence that counts as a dropped link |
| `net.spotHoldSec` | 300 | A disconnected player's spot is held this long |
| `net.hostOfflineHoldSec` | 180 | Match stays paused this long waiting for the host |
| `net.handover` / `handoverAfterSec` / `backupSec` | true / 45 / 5 | A deputy takes over as host after this long; how often it is sent a backup |
| `relay.*` | see file | Relay server, when to fall back to it, and how often a relayed player is updated |
| `reports.*` | see file | Where problem reports go, and limits. Off until the table exists |
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

## Added in 2.1

- **Sound alerts** (`js/sound.js`): short synthesised tones for a ping, a hunter nearby, being tagged, leaving the zone, losing GPS, release, a catch and a help request. iPhones cannot vibrate from a web page, so sound is their only alert. The switch is on Home; on iPhone the ringer switch also mutes it.
- **Play zone on a map** (`js/ui/zone.js`): the host drags a map under a fixed circle and picks the radius. Guests see the preview in the lobby. Left unset, the zone is centred on the host at start.
- **Join by QR code**: the lobby shows a QR code of the join link.
- **Compass heading** (`js/geo.js`): the direction wedge uses the phone's compass, so it works standing still. iPhone asks for motion permission when the map is first opened.
- **Fair play** (`js/host-fairplay.js`): impossible moves are flagged to the host and listed in the host console. Hunters who leave their start point during the head start are warned, and one who is still out of position at release cannot catch for `fair.holdPenaltySec`.
- **Safety**: a short reminder opens the first time a phone enters a lobby. The lifebuoy button on the map pauses the match for everyone, sounds an alarm and shows them where that player is; the player or the host resumes.

## Added in 2.2

- **Problem report** (`js/diag.js`): "Report a problem" on Home, in the lobby, the host console, the results screen and the connection overlay. It packages this phone's recent connection, GPS and error log as text to share. It contains no positions, PINs or chat.
- **Offline map for the zone** (`js/tiles.js`, `sw.js`): when a match starts, the service worker saves the tiles covering the play zone; tiles you look at are kept too. Limits are in `CONFIG.map.offline`. Keep them small on free tile servers, which do not allow bulk downloads.
- **Battery saver**: a switch in the map menu. The map and position update less often, and the screen goes to a dark clock after `saver.dimAfterSec` without a touch. Any alert wakes it.
- **Modes differ**: Skirmish has a shrinking zone by default, Dead Reckoning a fixed one. "Zone shrinks to" is a lobby rule, so the host can change either.
- **Shrinking zone**: closes in steadily between two points of the match. The map shows the final zone, and the HUD has a line while it shrinks. The shrink times are fixed at the start, so adding time in the host console does not move the zone.
- **Everyone's routes in the replay** (`js/ui/replay.js`): the host records each player's route and sends them once at the end. The replay animates all of them, with yours drawn thicker.
- **Late join and spectators**: someone joining mid-match becomes a hunter. "Watch a match" on Home joins as a spectator, who sees everyone live and is not counted. During a match spectators can read the everyone chat but only write to each other. Spectators are never asked for their location.
- **Team map pins**: the pin button, then tap the map. Only your side sees it. Tracker now asks which prey to follow.
- **Practice round** (`js/practice.js`): a solo match against bots with no network, with one line of coaching at a time. Your position is simulated; tap the map to walk.
- **Lobby chat**, and a **shareable result image** from the results screen.
- **Chinese (Simplified)**: the globe button on Home switches language; a Chinese-language phone starts in Chinese.

## Changed in 2.2.1

Fixes from a full review of every feature.

- **Fair play, checked by the host**
  - A ping that falls due while a player has no GPS fix is owed: it lands, and is paid for, when their next position arrives. Switching GPS off around ping time gains nothing.
  - A hunter needs a live GPS fix to catch. Only the prey's fix may be stale.
  - A hunter with no fix at their start point when the head start ends gets the same penalty as one who walked off.
  - Hunters are told only whether a prey is in range, never the live distance. "I've been caught" shows the PIN and names nobody.
  - Decoys carry the same fields, ids and times as the real ping, including after Scan.
  - A prey who uses the help button is shown live to hunters for `safety.revealAfterHelpSec` after play resumes. Spectators cannot pause the match.
  - Ability ids, admin commands and player ids from other phones are looked up as own properties only.
- **Map menu**: the three-line button on the map holds sound, battery saver, the safety rules, the problem report and **Leave match** (for the host: end the match for everyone).
- **Joining**: Home shows a progress card with Cancel. A guest who reloads while the host is away keeps trying for `net.hostOfflineHoldSec` instead of giving up after a few seconds.
- **Small phones** (about 667 px tall or less): Home goes straight to the form, the safety list scrolls above a fixed button, OPEN MAP and the catch keypad are always on screen, and the map panel starts folded.
- **Clearer states**: CATCH says why it is off (paused, no GPS fix, penalty); the prey's PIN screen closes when the hunter cancels; lobby chat closes when the match starts; the host is asked before Home closes the lobby for everyone; a hunter outside the zone gets one line instead of the full alert.
- **Chat**: a converted prey gets the hunter channel's history.
- **Map tile storage**: tiles are fetched with CORS and only real (non-opaque) responses are stored, so the saved map takes kilobytes instead of hundreds of megabytes.

## Added in 2.3

- **New-version prompt** (`js/update.js`, `version.json`): a page left open checks now and then and offers a reload on Home, in the lobby and on the results screen, never mid-match. Keep `version.json`, `CONFIG.version` and the cache name in `sw.js` in step (a test checks this).
- **Link preview**: Open Graph tags in `index.html` and `icons/og.png`. The URLs are absolute, so change them if the site moves.
- **How to play** and a **privacy note** on Home (`js/ui/info.js`). `index.html?privacy` opens the note directly.
- **Awards** (`js/host-awards.js`): longest survivor, first catch, top hunter, most ground covered and closest call, shown on the results screen. Limits are in `CONFIG.awards`.
- **Past matches and last setup** (`js/ui/history.js`): each phone keeps its own last `history.keep` results, and the host's next lobby offers "Use last setup".
- **iPhone engine tests**: tests tagged `@webkit` also run in WebKit, the engine behind every iPhone browser.

## Added in 2.4

- **Scan to catch** (`js/ui/scan.js`): the prey's PIN screen also shows a QR code with the same information, and the hunter can scan it instead of typing. The code only ever appears on the prey's own screen, and the host still checks the distance. Decoding uses the browser's detector where there is one and the bundled `vendor/jsQR.js` everywhere else (loaded only when the scanner opens). `CONFIG.scan.enabled = false` hides it.
- **Drawn zones** (`js/geom.js`, `js/ui/zone.js`): the zone editor has three tools: Circle, Draw shape (tap out up to `zone.maxCorners` corners) and No-go areas. A drawn zone is `{ lat, lng, r, poly }`, where lat/lng/r describe the circle around it, so map framing and saved tiles work unchanged. Containment, the out-of-zone direction, shrinking and Lockdown all follow the shape.
- **No-go areas**: up to `zone.maxNoGo` shapes marked on everyone's map. A player inside one gets a warning and a sound; the host is told if they stay `zone.noGoTellHostSec`. There is no game penalty.

## Added in 2.5

- **Relay fallback** (`js/relay.js`): when a phone cannot open a direct link to the host (some mobile networks), its messages go through a hosted WebSocket relay (Supabase Realtime, settings in `CONFIG.relay`). Each relayed player and the host agree a key first (ECDH P-256), and every message is AES-GCM encrypted and numbered, so the relay and anyone guessing a channel name see only ciphertext. A relayed player has no voice chat and gets snapshots every `relay.snapshotSec`. `?relay=off` turns it off, `?relayonly` forces it (testing).
- **Host handover** (`js/host-handover.js`): one connected player is the deputy and receives a slimmed backup of the match every `net.backupSec` (no positions, pings, routes, PINs, decoys or team chat). If the host is unreachable for `net.handoverAfterSec`, the deputy's phone becomes the host under the same lobby code; prey get new PINs and everyone is pinged afresh. A returning old host finds the code held by someone else and rejoins as a player.
- **Problem reports to the organisers** (`js/report-send.js`): "Send to the organisers" in the report window, and automatic reports after a failure once the player has agreed (asked once, never mid-match). Reports go to an insert-only table (`CONFIG.reports`). **`reports.enabled` is `false` until that table exists**; the SQL is in `server/reports.sql`.
- With the relay, two WebKit test browsers can play each other, so there is now a multi-phone test on the iPhone engine.

### Adding a language

The UI is written in English and translated as it is drawn (`js/i18n.js`), so no screen code changes. Copy `js/lang/zh.js`, translate the right-hand sides, and register it in `LANGS` in `js/i18n.js`. Opening the game with `?harvest` and reading `CH.i18n.harvest` in the console lists every string seen so far. `tests/zh.spec.js` plays a whole match and fails if any English is left on screen. Mark anything that must never be translated (names, codes, chat) with `translate="no"`.

## Your own connection servers

The game uses the free public PeerJS cloud to let phones find each other. `server/` holds a ready-to-deploy copy of that server and `render.yaml` deploys it on Render; `server/README.md` has the steps, including the relay (TURN) settings for phones on mobile data. Nothing is deployed until you do it.

## Tests

`tests/` runs whole matches between several headless browsers with fake GPS and a local signalling server. It covers every feature above, including spectators, practice rounds, saved map tiles, a 360 x 640 phone, and a full match in Chinese. `tests/fixes.spec.js` holds a regression test for each fix in 2.2.1.

Every test runs in Chromium. Tests tagged `@webkit` run in WebKit as well (`npx playwright install webkit` first). Playwright's WebKit cannot open phone-to-phone links between two test browsers, so those cover everything one phone does alone: Home, hosting a lobby, the zone picker, practice rounds.

```bash
cd tests
```

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

GitHub runs the same suite on every pull request and push to `main` (`.github/workflows/test.yml`). The game itself still has no build step and no dependencies; `tests/` and `server/` are not deployed.

## Testing at a desk

- `?sim=51.5073,-0.1657` fakes GPS at that point; tap the map to walk.
- `?ps=localhost:9000` uses a local PeerServer instead of the PeerJS cloud.
- `window.CH` exposes the app state in the console. `CH.geo.blocked = true` simulates losing GPS.
- `?nosw` skips the service worker.
- `?harvest` records every string shown (for translators).
- Practice round on Home needs no second phone.
- Open one tab per player. Each tab is a separate player.

## Limits to know about

- iOS and Android suspend a page when the screen locks. The app holds a screen wake lock during a match, but a locked or backgrounded phone stops sending GPS, and a locked host pauses the match for everyone.
- After a host crash the PeerJS cloud can keep the old ID registered for up to about a minute; the host retries until it frees up.
- There is no host migration. If the host cannot come back, the match ends with no winner.
- Fair-play flags are hints for the host, not proof: GPS does jump on its own.
- When you change files, bump the cache name in `sw.js`, and bump `CONFIG.protocol` if messages changed.
- Voice is live WebRTC audio to teammates only and needs microphone permission.

## Layout

```
index.html            screens and layers (empty containers)
manifest.webmanifest  install metadata; sw.js keeps the shell available offline
css/base.css          tokens, themes, shared components
css/*.css             one file per group of screens
js/config.js          every tunable value
js/host*.js           authoritative game (host phone only)
js/client.js          a player's view of the match
js/net.js             PeerJS transport, heartbeats, redial
js/geo.js, map.js     GPS watcher, Leaflet wrapper
js/ui/*.js            one module per screen
js/i18n.js, js/lang/  language switch and dictionaries
vendor/               Leaflet 1.9.4, PeerJS 1.5.4, qrcode-generator 1.4.4
server/               optional signalling server (not deployed with the game)
tests/                multi-browser Playwright tests (dev only)
```
