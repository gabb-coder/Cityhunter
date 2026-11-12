// City Hunter: every tunable value lives in this file.
//
// CONFIG    rule values for the v2 mechanics (timers, distances, penalties).
// ECONOMY   Glowcoin amounts.
// MODES     the two game modes and their default rules.
// ABILITIES the shop catalogue.
//
// ECONOMY, MODES and ABILITIES were filled in from the design prototype.
// Replace them with the real values from the original game.

export const CONFIG = {
  version: '2.0.0',

  // Catch PIN: the host checks the PIN and the hunter-prey distance.
  catch: {
    pinLength: 4,
    rangeM: 15,              // hunter must be this close to the prey
    accuracySlackMaxM: 20,   // extra distance allowed for poor GPS (capped)
    maxWrongPins: 3,         // wrong PINs before a hunter is locked out
    lockoutSec: 30,          // lockout length after too many wrong PINs
    allowWhenGpsStale: true, // a correct PIN still counts if a fix is stale
    nearHunterM: 60          // "I've been caught" only names a hunter this close
  },

  // GPS lost / weak.
  gps: {
    lostAfterSec: 10,        // no fix for this long = GPS lost
    keepAliveMaxAgeSec: 30,  // a phone standing still may reuse a fix this old
    graceSec: 120,           // grace before the host is told
    weakAccuracyM: 30,       // accuracy worse than this shows a HUD warning
    minMoveM: 4              // movement needed to record a route point
  },

  // Out of zone.
  zone: {
    outGraceSec: 30,         // "GET BACK IN" countdown before live reveal
    walkSpeedMps: 1.4        // used for the "about 30 s walking" estimate
  },

  // Pings and how they are drawn.
  ping: {
    urgentSec: 20,           // NEXT PING bar turns orange in the last N s
    firstPingAtRelease: true,// ping everyone the moment hunters are released
    proximityAlertM: 150,    // prey banner when a hunter ping is this close
    baseRadiusM: 20,         // smallest ping circle
    growMps: 1.2,            // prey circles grow this fast with ping age
    maxRadiusM: 250,         // cap for a normal ping circle
    lostMaxRadiusM: 2000     // cap once a player's GPS grace has run out
  },

  // Networking, heartbeats and reconnection.
  net: {
    peerIdPrefix: 'cityhunter2-',
    peerServer: null,        // null = PeerJS cloud, or { host, port, path, secure }
    iceServers: null,        // null = PeerJS defaults
    heartbeatSec: 2,         // client -> host heartbeat interval
    heartbeatTimeoutSec: 8,  // silence before a link counts as down
    snapshotSec: 1,          // host -> client state interval
    posSendSec: 2,           // how often a client sends its position
    dialTimeoutSec: 7,       // one reconnect attempt gives up after this
    reconnectBackoffSec: [1, 2, 3, 5, 8],
    spotHoldSec: 300,        // a disconnected player's spot is held this long
    hostOfflineHoldSec: 180, // match stays paused this long without the host
    hostSaveSec: 2,          // host writes its recovery snapshot this often
    lobbyDropSec: 45         // offline lobby players are removed after this
  },

  lobby: {
    codeLength: 6,
    nameMaxLength: 12,
    minPlayers: 2,
    maxPlayers: 16
  },

  chat: { maxLength: 200, history: 60 },

  // Map tiles, one layer per theme.
  // CARTO's dark_all / light_all now answer "API key required" without a
  // key, so the default is OpenStreetMap's standard tiles: darkened with a
  // CSS filter for the dark theme, lightly muted for the sun theme.
  // To use CARTO (or any other provider) put its URL template here, for
  // example 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  // plus whatever key parameter your CARTO account gives you.
  map: {
    zoom: 17,
    tiles: {
      dark: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        subdomains: 'abc',
        maxNativeZoom: 19,
        filter: 'invert(1) hue-rotate(180deg) saturate(0.3) brightness(0.8) contrast(0.92)',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      },
      sun: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        subdomains: 'abc',
        maxNativeZoom: 19,
        filter: 'grayscale(0.6) contrast(1.08) brightness(1.02)',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    }
  }
};

export const ECONOMY = {
  startingGC: 100,
  perPingSurvived: 20,
  perCatch: 150,
  survivorBonus: 200       // prey still free when the clock runs out
};

export const MODES = {
  DEAD_RECKONING: {
    id: 'DEAD_RECKONING',
    name: 'Dead Reckoning',
    icon: 'compass',
    blurb: 'Prey show up only as timed pings. Hunters work from the last fix.',
    rules: { matchSec: 2700, headStartSec: 180, pingSec: 120, zoneRadiusM: 600 }
  },
  SKIRMISH: {
    id: 'SKIRMISH',
    name: 'Skirmish',
    icon: 'bolt',
    blurb: 'Tighter zone, shorter clock. Built for one park and fast rounds.',
    rules: { matchSec: 900, headStartSec: 60, pingSec: 45, zoneRadiusM: 250 }
  }
};

// Choices offered when the host taps a rule row in the lobby.
export const RULE_OPTIONS = {
  matchSec: [300, 600, 900, 1200, 1800, 2700, 3600, 5400],
  headStartSec: [30, 60, 120, 180, 300],
  pingSec: [30, 45, 60, 90, 120, 180, 300],
  zoneRadiusM: [100, 150, 250, 400, 600, 800, 1000, 1500]
};

export const RULE_LABELS = {
  matchSec: 'Match length',
  headStartSec: 'Head start',
  pingSec: 'Prey ping every',
  zoneRadiusM: 'Play zone radius'
};

export const ABILITIES = {
  ghost: {
    id: 'ghost', side: 'prey', name: 'Ghost', cost: 120, icon: 'ghost',
    effect: 'Your next ping is skipped. Hunters see nothing new.',
    hint: 'Skip your next ping'
  },
  decoy: {
    id: 'decoy', side: 'prey', name: 'Decoy', cost: 80, icon: 'decoy',
    effect: 'Drop a fake ping where you stand, then walk away.',
    hint: 'Drop a fake ping',
    pings: 2
  },
  jammer: {
    id: 'jammer', side: 'prey', name: 'Jammer', cost: 150, icon: 'jammer',
    effect: 'Your ping circle doubles in size for 5 minutes.',
    hint: 'Double your circle',
    durationSec: 300, factor: 2
  },
  safehouse: {
    id: 'safehouse', side: 'prey', name: 'Safe House', cost: 200, icon: 'shield',
    effect: 'Mark a 30 m spot. You cannot be caught inside it for 90 s.',
    hint: 'No catches here',
    radiusM: 30, durationSec: 90
  },
  scan: {
    id: 'scan', side: 'hunter', name: 'Scan', cost: 150, icon: 'scan',
    effect: 'Force an instant ping of every prey right now.',
    hint: 'Ping all prey now'
  },
  tracker: {
    id: 'tracker', side: 'hunter', name: 'Tracker', cost: 120, icon: 'tracker',
    effect: 'See the nearest prey’s direction of travel for the next 2 pings.',
    hint: 'Show direction of travel',
    pings: 2
  },
  radar: {
    id: 'radar', side: 'hunter', name: 'Proximity Radar', cost: 100, icon: 'radar',
    effect: 'Buzz when any prey is within 100 m, for 3 minutes.',
    hint: 'Buzz within 100 m',
    rangeM: 100, durationSec: 180, repeatSec: 15
  },
  lockdown: {
    id: 'lockdown', side: 'hunter', name: 'Lockdown', cost: 200, icon: 'lockdown',
    effect: 'Shrink the play zone by 20% for 5 minutes.',
    hint: 'Shrink the zone',
    shrink: 0.2, durationSec: 300
  }
};

// The hunter sheet's one-tap ability button (buys it if you own none).
export const HUNTER_QUICK_ABILITY = 'scan';
