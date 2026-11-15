// Shared helpers: every "player" is an isolated browser context with its own
// fake GPS, so one test can run a whole match between several phones.

const base = require('@playwright/test');

const ORIGIN = 'http://127.0.0.1:8080';
// HARVEST=1 collects every string the app shows into harvest.jsonl (for translators).
const HARVEST = process.env.HARVEST ? '&harvest' : '';
const URL = ORIGIN + '/index.html?ps=127.0.0.1:9000' + HARVEST;
const HOME = { latitude: 51.5073, longitude: -0.1657, accuracy: 5 };

// A point `north` and `east` metres from HOME.
const offset = (north, east, accuracy = 5) => ({
  latitude: HOME.latitude + north / 111320,
  longitude: HOME.longitude + east / (111320 * Math.cos((HOME.latitude * Math.PI) / 180)),
  accuracy
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (page) => page.evaluate(() => window.CH.session && window.CH.session.snap);
const gameT = (page) => page.evaluate(() => Math.round(window.CH.session.T()));

// Change CONFIG values on one page (each page has its own copy).
const config = (page, patch) => page.evaluate(async (patch) => {
  const { CONFIG } = await import('./js/config.js');
  for (const [group, values] of Object.entries(patch)) Object.assign(CONFIG[group], values);
}, patch);

class Game {
  constructor(browser) {
    this.browser = browser;
    this.contexts = [];
    this.timers = [];
  }

  async context(geo = HOME, opts = {}) {
    const ctx = await this.browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true,
      geolocation: geo, permissions: ['geolocation', 'microphone'],
      serviceWorkers: opts.serviceWorkers || 'block'
    });
    // Keep tests off the internet: no map tiles, no web fonts.
    // (The local signalling server on :9000 must stay reachable.)
    if (!opts.online) await ctx.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
    this.contexts.push(ctx);
    return ctx;
  }

  // Open the game as a new player. Returns the page with a few extras.
  async player(name, geo = HOME, opts = {}) {
    const ctx = await this.context(geo, opts);
    const page = await ctx.newPage();
    page.who = name;
    page.ctx = ctx;
    page.geo = geo;
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    // A real GPS keeps producing fixes: re-issue the mock position like one.
    const timer = setInterval(() => ctx.setGeolocation(page.geo).catch(() => {}), 2000);
    this.timers.push(timer);
    page.setGeo = async (g) => {
      page.geo = g;
      await ctx.setGeolocation(g);
    };
    await page.goto(opts.url || URL);
    if (name) await page.fill('#callsign', name);
    return page;
  }

  // The safety reminder opens the first time a phone lands in a lobby.
  async inLobby(page) {
    await page.waitForSelector('#s-lobby:not([hidden]) .code-big', { timeout: 25000 });
    const ok = page.locator('[data-act=safety-ok]');
    await ok.waitFor({ timeout: 5000 });
    await ok.click();
  }

  async host(name, geo) {
    const page = await this.player(name, geo);
    await page.click('[data-act=host]');
    await this.inLobby(page);
    return page;
  }

  async join(name, code, geo) {
    const page = await this.player(name, geo);
    await page.fill('#join-code', code);
    await page.click('.join-btn');
    await this.inLobby(page);
    return page;
  }

  // Host + guests in a lobby. names[0] hosts.
  async lobby(names, geos = []) {
    const pages = [await this.host(names[0], geos[0] || HOME)];
    const code = (await snap(pages[0])).code;
    for (let i = 1; i < names.length; i++) pages.push(await this.join(names[i], code, geos[i] || offset(40 * i, 30 * i)));
    await base.expect.poll(async () => (await snap(pages[0])).players.length).toBe(names.length);
    return pages;
  }

  // A started match with the given hunters and rules. Everyone has the map open.
  async match(names, hunters, rules = {}, geos = [], opts = {}) {
    const pages = await this.lobby(names, geos);
    const A = pages[0];
    await A.evaluate(({ hunters, rules }) => {
      const h = window.CH.host;
      for (const p of h.all()) h.setLobbyRole(p, hunters.includes(p.name) ? 'hunter' : 'prey');
      Object.assign(h.G.rules, rules);
      h.dirty = true;
    }, { hunters, rules });
    await base.expect.poll(async () => (await snap(A)).players.filter((p) => p.role === 'hunter').length).toBe(hunters.length);
    if (opts.beforeStart) await opts.beforeStart(pages);
    await A.click('[data-act=start]');
    for (const p of pages) await p.waitForSelector('#s-reveal:not([hidden]) [data-act=open-map]', { timeout: 10000 });
    if (!opts.stayOnReveal) for (const p of pages) await p.click('[data-act=open-map]');
    return pages;
  }

  async close() {
    this.timers.forEach(clearInterval);
    if (HARVEST) {
      const all = new Set();
      for (const ctx of this.contexts) {
        for (const page of ctx.pages()) {
          const got = await page.evaluate(() => (window.CH && window.CH.i18n.harvest ? Array.from(window.CH.i18n.harvest) : [])).catch(() => []);
          got.forEach((t) => all.add(t));
        }
      }
      require('fs').appendFileSync(require('path').join(__dirname, 'harvest.jsonl'), JSON.stringify(Array.from(all)) + '\n');
    }
    for (const ctx of this.contexts) await ctx.close().catch(() => {});
  }
}

const test = base.test.extend({
  game: async ({ browser }, use) => {
    const game = new Game(browser);
    await use(game);
    await game.close();
  }
});

// Type a PIN on the Confirm catch keypad.
async function typePin(page, pin) {
  for (const d of pin) await page.click('[data-act=key][data-k="' + d + '"]');
}

const live = (page) => base.expect.poll(async () => (await snap(page)).phase, { timeout: 20000 }).toBe('live');

module.exports = { test, expect: base.expect, Game, HOME, URL, ORIGIN, offset, sleep, snap, gameT, config, typePin, live };
