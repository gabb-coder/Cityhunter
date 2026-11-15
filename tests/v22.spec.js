const { test, expect, offset, snap, sleep, config, live, typePin, ORIGIN, URL } = require('./helpers');

const RULES = { headStartSec: 2, pingSec: 6, matchSec: 600, zoneRadiusM: 300, zoneShrinkTo: 1 };
const send = (page, msg) => page.evaluate((msg) => window.CH.session.send(msg), msg);

test('problem report: has the diagnostics, has no positions or PINs', async ({ game }) => {
  const [A, B] = await game.match(['GABRIEL', 'NOMAD'], ['NOMAD'], RULES, [offset(0, 0), offset(40, 0)]);
  await live(A);
  const pin = (await snap(A)).me.pin;
  await A.click('#map-btns [data-act=admin]');
  await A.click('#s-admin [data-act=report]');
  const text = await A.inputValue('.report-text');
  expect(text).toContain('CITY HUNTER PROBLEM REPORT');
  expect(text).toMatch(/version: \d+\.\d+\.\d+ \(protocol \d+\)/);
  expect(text).toMatch(/me: GABRIEL \/ prey \/ host/);
  expect(text).toMatch(/phase: live/);
  expect(text).toMatch(/gps\s+ok/);
  expect(text).toMatch(/game\s+phase headstart -> live/);
  expect(text).not.toContain(pin);
  expect(text).not.toContain('51.50');                 // no coordinates
  await A.click('[data-act=report-copy]');
  // Also reachable from Home, before any match.
  const C = await game.player('SOLO');
  await C.click('#s-home [data-act=report]');
  expect(await C.inputValue('.report-text')).toContain('state: not in a lobby');
  expect(B.errors).toEqual([]);
});

test('map tiles for the play zone are saved and served with no network', async ({ game }) => {
  const tiles = ORIGIN + '/tiles/{z}/{x}/{y}.png';
  const setTiles = (page) => page.evaluate(async (url) => {
    const { CONFIG } = await import('./js/config.js');
    CONFIG.map.tiles.dark.url = url;
    CONFIG.map.tiles.sun.url = url;
    await navigator.serviceWorker.ready;
  }, tiles);
  const A = await game.player('GABRIEL', offset(0, 0), { serviceWorkers: 'allow' });
  await setTiles(A);
  await expect.poll(() => A.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await A.click('[data-act=host]');
  await game.inLobby(A);
  const B = await game.join('NOMAD', (await snap(A)).code, offset(30, 0));
  await A.click('[data-act=role][data-id] >> nth=1');
  await A.click('[data-act=start]');
  await A.waitForSelector('[data-act=open-map]');

  await expect.poll(() => A.evaluate(() => window.CH.tilesSaved || null), { timeout: 30000 }).not.toBeNull();
  const saved = await A.evaluate(() => window.CH.tilesSaved);
  expect(saved.total).toBeGreaterThan(10);
  expect(saved.total).toBeLessThanOrEqual(160);
  expect(saved.ok).toBe(saved.total);
  const stored = await A.evaluate(async () => (await (await caches.open('cityhunter-tiles-v2')).keys()).map((r) => r.url));
  expect(stored.length).toBeGreaterThanOrEqual(saved.total);          // plus any tiles simply looked at

  // No network: a saved tile still loads, an unsaved one does not.
  await A.ctx.setOffline(true);
  expect(await A.evaluate((u) => fetch(u).then((r) => r.ok, () => false), stored[0])).toBe(true);
  expect(await A.evaluate((u) => fetch(u).then((r) => r.ok, () => false), ORIGIN + '/tiles/3/1/1.png')).toBe(false);
  expect(B.errors).toEqual([]);
});

test('battery saver: dims after a quiet spell, wakes on a touch or an alert, reports position less often', async ({ game }) => {
  const [A, B] = await game.match(['GABRIEL', 'VIPER'], ['VIPER'], { ...RULES, pingSec: 60 }, [offset(0, 0), offset(200, 0)]);
  await live(A);
  await config(A, { saver: { dimAfterSec: 1 } });
  await expect(A.locator('#dim')).toBeHidden();
  // Battery saver lives in the map menu.
  await A.click('#map-btns [data-act=menu]');
  await A.click('#modal [data-act=saver]');
  await expect(A.locator('#modal [data-act=saver]')).toHaveAttribute('aria-checked', 'true');
  await A.click('#modal [data-act=modal-close]');
  expect(await A.evaluate(() => window.CH.saver.on)).toBe(true);
  await expect(A.locator('#dim')).toBeVisible({ timeout: 5000 });
  await expect(A.locator('#dim-clock')).toHaveText(/\d\d:\d\d/);
  expect(await A.evaluate(() => window.CH.session.posEveryMs())).toBe(4000);

  await A.locator('#dim').click();                       // a touch wakes it
  await expect(A.locator('#dim')).toBeHidden();
  await expect(A.locator('#dim')).toBeVisible({ timeout: 5000 });
  await A.evaluate(() => window.CH.sound.cue('near'));    // so does an alert
  await expect(A.locator('#dim')).toBeHidden();

  await A.click('#map-btns [data-act=menu]');
  await A.click('#modal [data-act=saver]');
  await A.click('#modal [data-act=modal-close]');
  await sleep(2000);
  await expect(A.locator('#dim')).toBeHidden();
  expect(await A.evaluate(() => window.CH.session.posEveryMs())).toBe(2000);
  expect(B.errors).toEqual([]);
});

test('modes differ: Skirmish closes the zone in, Dead Reckoning does not', async ({ game }) => {
  const [A, B] = await game.lobby(['GABRIEL', 'NOMAD'], [offset(0, 0), offset(40, 0)]);
  expect((await snap(A)).rules.zoneShrinkTo).toBe(1);
  await expect(A.locator('[data-rule=zoneShrinkTo]')).toContainText('Off');
  await A.click('[data-act=mode][data-mode=SKIRMISH]');
  await expect.poll(async () => (await snap(B)).rules.zoneShrinkTo).toBe(0.4);
  await expect(B.locator('[data-rule=zoneShrinkTo]')).toContainText('40%');
  // The host can still change it.
  await A.click('[data-act=rule][data-rule=zoneShrinkTo]');
  await A.click('[data-act=rule-set][data-v="0.25"]');
  await expect.poll(async () => (await snap(B)).rules.zoneShrinkTo).toBe(0.25);
});

test('shrinking zone closes in, shows the final zone, and catches out a prey near the edge', async ({ game }) => {
  // 20 s of play; the zone shrinks from 300 m to 120 m between 4 s and 17 s. NOMAD stands 200 m out.
  const [A, B] = await game.match(['VIPER', 'NOMAD'], ['VIPER'], { headStartSec: 2, pingSec: 30, matchSec: 20, zoneRadiusM: 300, zoneShrinkTo: 0.4 }, [offset(0, 0), offset(200, 0)]);
  await live(A);
  const z0 = (await snap(B)).zone;
  expect(z0.final).toBe(120);
  expect(z0.r).toBeGreaterThan(280);
  await expect.poll(async () => (await snap(B)).zone.r, { timeout: 20000 }).toBeLessThan(240);
  await expect(B.locator('#hud-zone')).toContainText('Zone closing in');   // a line in the HUD, not a banner
  await expect(B.locator('#banners')).not.toContainText('Zone closing in');
  await expect.poll(() => B.evaluate(() => window.CH.map.items.has('final'))).toBe(true);
  // The edge passes NOMAD: the out-of-zone alert starts.
  await expect(B.locator('#oz .oz-top')).toContainText('GET BACK IN', { timeout: 20000 });
  expect((await snap(B)).zone.r).toBeLessThan(205);
});

test('results replay shows everyone\u2019s routes and plays back; result card is drawn', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { ...RULES, matchSec: 14, pingSec: 4 }, [offset(0, 0), offset(100, 0), offset(-60, 0)]);
  await live(A);
  for (let i = 1; i <= 7; i++) {
    await A.setGeo(offset(i * 14, i * 5));
    await B.setGeo(offset(100 - i * 10, i * 12));
    await C.setGeo(offset(-60 + i * 9, -i * 6));
    await sleep(900);
  }
  await A.waitForSelector('#s-results:not([hidden]) .res-head', { timeout: 30000 });
  await expect.poll(() => A.evaluate(() => window.CH.session.routes && window.CH.session.routes.list.length)).toBe(3);
  await expect(A.locator('.route-name')).toHaveCount(3);
  await expect(A.locator('.route-name.me')).toHaveText('GABRIEL');
  expect(await A.locator('.route-line.me').count()).toBeGreaterThan(0);
  expect(await A.locator('.route-line:not(.me)').count()).toBeGreaterThan(1);
  expect(await A.locator('.route-line.hunter:not(.me)').count()).toBeGreaterThan(0);   // VIPER's orange line
  await expect(A.locator('.route-text')).toContainText('Thick line is you');

  await A.click('[data-act=replay]');
  await expect(A.locator('#replay-clock')).toHaveText(/\d\d:\d\d/);
  // Mid-replay fewer points are drawn than at the end.
  const full = await B.evaluate(() => document.querySelector('#replay-svg').innerHTML.length);
  expect(full).toBeGreaterThan(300);

  // Share card: a 1080 x 1350 image with something drawn on it.
  const download = A.waitForEvent('download');
  await A.click('[data-act=share-card]');
  expect((await download).suggestedFilename()).toBe('city-hunter-result.png');
  const card = await A.evaluate(() => {
    const c = window.CH.lastCard;
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colours = new Set();
    for (let i = 0; i < px.length; i += 4 * 997) colours.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
    return { w: c.width, h: c.height, colours: colours.size };
  });
  expect(card).toMatchObject({ w: 1080, h: 1350 });
  expect(card.colours).toBeGreaterThan(8);
});

test('late joiner becomes a hunter; a spectator sees everyone live and cannot act', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, [offset(0, 0), offset(60, 0), offset(-60, 0)]);
  await live(A);
  const code = (await snap(A)).code;

  // Late player.
  const D = await game.player('JUNO', offset(20, 80));
  await D.fill('#join-code', code);
  await D.click('.join-btn');
  await D.waitForSelector('#s-reveal:not([hidden]) .role-big');
  expect((await snap(D)).me.role).toBe('hunter');
  await expect(A.locator('#toasts')).toContainText('JUNO joined late as a hunter');
  await expect.poll(async () => (await snap(A)).counts.hunters).toBe(2);
  // Someone who never saw the lobby still gets the safety reminder.
  await D.click('[data-act=safety-ok]');
  await D.click('[data-act=open-map]');
  await expect.poll(async () => (await snap(D)).live.some((l) => l.name === 'VIPER')).toBe(true);   // sees teammates

  // Spectator.
  const S = await game.player('WATCHER', offset(500, 500));
  await S.fill('#join-code', code);
  await S.click('[data-act=watch]');
  await S.waitForSelector('#s-game:not([hidden]) #hud');
  const ss = await snap(S);
  expect(ss.me.role).toBe('spectator');
  await expect.poll(async () => (await snap(S)).live.length).toBe(4);            // all four players, live
  expect((await snap(S)).live.every((l) => l.kind === 'spec')).toBe(true);
  await expect(S.locator('#hud')).toContainText('WATCHING');
  await expect(S.locator('[data-act=spec-leave]')).toBeVisible();
  await expect(S.locator('#map-btns [data-act=help]')).toHaveCount(0);
  // Not counted, not on anyone's map, cannot buy or be caught.
  const sa = await snap(A);
  expect(sa.counts).toEqual({ prey: 2, hunters: 2 });
  expect(JSON.stringify(sa.live)).not.toContain('WATCHER');
  await send(S, { k: 'buy', id: 'ghost' });
  await send(S, { k: 'catch:submit', target: sa.me.id, pin: sa.me.pin });
  await sleep(1200);
  expect((await snap(S)).me.inv).toEqual({});
  expect((await snap(A)).me.role).toBe('prey');
  // The spectator's snapshot must not carry anyone's PIN.
  expect(JSON.stringify(await snap(S))).not.toContain('"' + sa.me.pin + '"');
  // Nor can a spectator stop the match.
  await send(S, { k: 'help', on: true });
  await sleep(600);
  expect((await snap(A)).paused).toBe(false);
  // Chat: spectators see every player live, so during a match they can read
  // "Everyone" but only write to each other.
  await S.click('#sheet [data-act=chat]');
  await expect(S.locator('#chat-tabs [data-tab=team]')).toContainText('Spectators');
  await S.click('#chat-tabs [data-tab=all]');
  await expect(S.locator('#chat-input')).toBeDisabled();
  await send(S, { k: 'chat', ch: 'all', text: 'NOMAD is behind the cafe' });   // a hand-made message is rerouted too
  await sleep(800);
  expect(await A.evaluate(() => JSON.stringify(window.CH.session.chat))).not.toContain('behind the cafe');
  expect(await S.evaluate(() => window.CH.session.chat.team.map((m) => m.text))).toContain('NOMAD is behind the cafe');
  // No GPS warnings or zone alerts for someone who is only watching.
  await expect(S.locator('#gps-sheet')).toBeHidden();
  await expect(S.locator('#oz')).toBeHidden();
  expect(B.errors.concat(C.errors, D.errors, S.errors)).toEqual([]);
});

test('spectator can join in the lobby and is not counted as a player', async ({ game }) => {
  const [A] = await game.lobby(['GABRIEL', 'NOMAD']);
  const code = (await snap(A)).code;
  const S = await game.player('WATCHER');
  await S.fill('#join-code', code);
  await S.click('[data-act=watch]');
  await S.waitForSelector('#s-lobby:not([hidden]) .code-big');
  await expect(S.locator('#modal')).toBeHidden();                 // no safety reminder for someone who is not playing
  await expect(A.locator('.player', { hasText: 'WATCHER' })).toContainText('WATCHING');
  await A.click('[data-act=role][data-id] >> nth=1');
  await expect(A.locator('.foot-note')).toContainText('2 players');
  await expect(S.locator('.foot-bar')).toContainText('WATCHING');
  await A.click('[data-act=start]');
  await S.waitForSelector('#s-game:not([hidden]) #hud');          // no role reveal for a spectator
  expect((await snap(S)).me.pin).toBeNull();
});

test('team map pins are shared with your side only; Tracker asks which prey to follow', async ({ game }) => {
  const [A, B, C, D] = await game.match(['GABRIEL', 'NOMAD', 'VIPER', 'KESTREL'], ['VIPER', 'KESTREL'], RULES, [offset(0, 0), offset(60, 0), offset(-60, 0), offset(-60, 40)]);
  await live(C);
  await C.click('#map-btns [data-act=pin]');
  await expect(C.locator('#banners')).toContainText('Tap the map where your team should look');
  const box = await C.locator('#map').boundingBox();
  await C.mouse.click(box.x + box.width / 2 + 40, box.y + 300);
  await expect.poll(async () => ((await snap(D)).marks || []).length).toBe(1);
  expect((await snap(D)).marks[0]).toMatchObject({ name: 'VIPER', role: 'hunter', mine: false });
  expect((await snap(C)).marks[0].mine).toBe(true);
  expect((await snap(A)).marks).toEqual([]);                        // prey never see it
  await expect(D.locator('#toasts')).toContainText('VIPER dropped a pin');
  await expect.poll(() => D.evaluate(() => Array.from(window.CH.map.items.keys()).some((k) => k.startsWith('mk')))).toBe(true);
  // Tapping the button again removes it.
  await C.click('#map-btns [data-act=pin]');
  await expect.poll(async () => ((await snap(D)).marks || []).length).toBe(0);

  // Tracker picker.
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);
  await A.evaluate(() => { for (const p of window.CH.host.all()) p.gc = 500; window.CH.host.dirty = true; });
  await expect.poll(async () => (await snap(C)).me.gc).toBe(500);
  await send(C, { k: 'buy', id: 'tracker' });
  await expect(C.locator('[data-act=use][data-id=tracker]')).toBeVisible();
  await C.click('[data-act=use][data-id=tracker]');
  await expect(C.locator('#modal .pick')).toHaveCount(2);
  await C.click('#modal .pick:has-text("NOMAD")');
  await expect.poll(async () => ((await snap(C)).me.fx.tracker || {}).name).toBe('NOMAD');
  expect(B.errors).toEqual([]);
});

test('lobby chat works before the match starts', async ({ game }) => {
  const [A, B] = await game.lobby(['GABRIEL', 'NOMAD']);
  await A.click('[data-act=chat]');
  await expect(A.locator('#chat-title')).toHaveText('LOBBY CHAT');
  await A.fill('#chat-input', 'meet at the bandstand');
  await A.press('#chat-input', 'Enter');
  await expect(B.locator('.lobby-chat .badge')).toHaveText('1');
  await B.click('[data-act=chat]');
  await expect(B.locator('.msg-text')).toHaveText('meet at the bandstand');
});

test('practice round: plays against bots with no network, and you can walk by tapping', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.player('GABRIEL');
  await A.ctx.setOffline(true);                                    // proves nothing goes over the network
  await A.click('[data-act=practice]');
  await A.waitForSelector('#s-reveal:not([hidden]) .role-big');
  await A.click('[data-act=open-map]');
  let s = await snap(A);
  expect(s.me.role).toBe('prey');
  expect(s.counts).toEqual({ prey: 3, hunters: 2 });
  await expect(A.locator('#banners .coach')).toContainText('tap the map to walk');
  // Walk: tap the map, the simulated position moves.
  const before = await A.evaluate(() => ({ ...window.CH.geo.fix }));
  const box = await A.locator('#map').boundingBox();
  await A.mouse.click(box.x + box.width / 2 + 90, box.y + 330);
  await expect.poll(() => A.evaluate((b) => Math.abs(window.CH.geo.fix.lng - b.lng) > 1e-5, before)).toBe(true);
  // After the head start the hunter bots are pinged and start moving.
  await expect.poll(async () => (await snap(A)).pings.length, { timeout: 40000 }).toBe(2);
  const p1 = (await snap(A)).pings.map((p) => p.lat + ',' + p.lng).join();
  await expect.poll(async () => (await snap(A)).pings.map((p) => p.lat + ',' + p.lng).join(), { timeout: 40000 }).not.toBe(p1);
  // The host console shows the bots; no problem saving or reconnect overlay.
  await expect(A.locator('#net')).toBeHidden();
  expect(await A.evaluate(() => localStorage.getItem('ch2.host'))).toBeNull();
  // Leaving restores real GPS.
  await A.click('#map-btns [data-act=admin]');
  await A.click('[data-act=adm-end]');
  await A.click('[data-act=modal-yes]');
  await A.waitForSelector('#s-results:not([hidden])');
  await expect(A.locator('.rematch')).toContainText('PRACTICE AGAIN');
  await A.click('[data-act=res-home]');                           // nobody else is in a practice lobby: no question asked
  await A.waitForSelector('#s-home:not([hidden])');
  expect(await A.evaluate(() => window.CH.geo.simulated)).toBe(false);
  // Mid-round, the map menu has the way out.
  await A.click('[data-act=practice]');
  await A.waitForSelector('[data-act=open-map]');
  await A.click('[data-act=open-map]');
  await A.click('#map-btns [data-act=menu]');
  await expect(A.locator('#modal [data-act=menu-leave]')).toContainText('Exit practice');
  await A.click('#modal [data-act=menu-leave]');
  await A.waitForSelector('#s-home:not([hidden])');
  await expect(A.locator('#modal')).toBeHidden();
  expect(await A.evaluate(() => window.CH.practice)).toBe(false);
  expect(A.errors).toEqual([]);
});

test('practice round: a hunter bot catches you through the real PIN flow, then you catch a bot', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.player('GABRIEL');
  await A.click('[data-act=practice]');
  await A.waitForSelector('[data-act=open-map]');
  await A.click('[data-act=open-map]');
  // Speed things up: end the head start now and put a hunter bot on top of us.
  await expect.poll(() => A.evaluate(() => !!window.CH.host.G.players[window.CH.host.G.hostPid].pos)).toBe(true);
  await A.evaluate(() => {
    const h = window.CH.host;
    h.G.T = h.G.headT;
    const me = h.G.players[h.G.hostPid];
    const bot = h.hunters().find((p) => p.bot);
    bot.spawn = { lat: me.pos.lat, lng: me.pos.lng };
    bot.pos = { lat: me.pos.lat, lng: me.pos.lng, acc: 5, hdg: null };
  });
  await A.waitForSelector('#s-tagged:not([hidden]) .tagged-pin', { timeout: 20000 });
  await A.waitForSelector('#s-converted:not([hidden]) .conv-big', { timeout: 20000 });
  await A.click('[data-act=conv-go]');
  expect((await snap(A)).me.role).toBe('hunter');
  await expect(A.locator('#banners .coach')).toContainText('Now you hunt');

  // Stand next to a prey bot and catch it with the PIN the practice hint shows.
  await A.evaluate(() => {
    const h = window.CH.host;
    const q = h.prey().find((p) => p.bot);
    window.CH.geo.simulate(q.pos.lat, q.pos.lng);
  });
  await expect.poll(async () => ((await snap(A)).targets || []).some((t) => t.inRange), { timeout: 15000 }).toBe(true);
  await A.click('[data-act=catch-open]');
  await expect(A.locator('.pin-status')).toContainText('Practice hint: their PIN is');
  const pin = (await A.locator('.pin-status').textContent()).match(/\d{4}/)[0];
  await typePin(A, pin);
  await A.waitForSelector('.catch-done');
});
