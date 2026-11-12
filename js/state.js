// One shared object every module reads. app.js fills it in.

import { Emitter } from './util.js';
import { Geo } from './geo.js';

export const app = {
  session: null,   // client-side view of the match (js/client.js)
  host: null,      // authoritative game, only on the host's phone (js/host.js)
  net: null,       // HostNet or ClientNet (js/net.js)
  geo: new Geo(),  // GPS watcher (js/geo.js)
  map: null,       // Leaflet wrapper (js/map.js)
  voice: null,     // push-to-talk (js/voice.js)
  go: {},          // flow actions: host(), join(), leave() ... set by app.js
  bus: new Emitter(),

  // Pure UI state: which layer is open, toggles, dismissed banners.
  ui: {
    mapOpen: false,
    layer: null,          // 'shop' | 'chat' | 'catch' | 'tagged' | 'converted' | 'admin'
    pinShown: false,
    shopTab: null,
    chatTab: 'team',
    sheetMin: false,
    convertedBanner: null,
    selfTag: false,
    tagDismissed: null
  }
};

export const snap = () => (app.session ? app.session.snap : null);
export const me = () => (app.session && app.session.snap ? app.session.snap.me : null);
