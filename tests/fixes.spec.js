// Regression tests for the v2.2.1 review fixes: closed cheats, clearer
// screens, small phones, and getting back in while the host is away.

const { test, expect, offset, snap, sleep, config, live, typePin, URL, ORIGIN } = require('./helpers');

const RULES = { headStartSec: 3, pingSec: 8, matchSec: 600, zoneRadiusM: 400, zoneShrinkTo: 1 };
const send = (page, msg) => page.evaluate((msg) => window.CH.session.send(msg), msg);
const ask = (page, msg, reply) => page.evaluate(({ msg, reply }) => new Promise((resolve) => {
  const s = window.CH.session;
  const off = s.on(reply, (m) => { off(); resolve(m); });
  s.send(msg);
}), { msg, reply });
const blockGps = (page, on) => page.evaluate((on) => { window.CH.geo.blocked = on; }, on);
const hostPlayer = (host, name) => host.evaluate((name) => {
  const p = window.CH.host.all().find((q) => q.name === name);
  return { gc: p.gc, pings: p.pings, owed: p.owed, penaltyT: p.penaltyT, dropped: p.dropped };
}, name);
const SMALL = { width: 360, height: 640 };
// Is the element fully inside the visible screen (no scrolling needed)?
const onScreen = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  const vp = page.viewportSize();
  return !!box && box.y >= 0 && box.y + box.height <= vp.height + 0.5 && box.x >= 0 && box.x + box.width <= vp.width + 0.5;
};

test('cheats closed: made-up ability ids, a hunter with GPS off, hunter radar on the PIN screen', async ({ game }) => {
  // NOMAD (prey) stands 8 m from VIPER (hunter).
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, [offset(150, 0), offset(8, 0), offset(0, 0)],
    { beforeStart: (pages) => config(pages[0], { gps: { lostAfterSec: 4 } }) });
  await live(C);
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(true);

  // Names that exist on every JavaScript object are not abilities, admin
  // commands or message kinds.
  const before = await snap(B);
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await send(B, { k: 'buy', id });
    await send(B, { k: 'use', id });
    await send(B, { k: 'admin', op: id });
    await send(B, { k: id });
    await send(B, { k: 'catch:start', target: id });
    await send(B, { k: 'role', id });
  }
  await sleep(1500);
  const after = await snap(B);
  expect(after.me.gc).toBe(before.me.gc);
  expect(after.me.inv).toEqual({});
  expect(after.phase).toBe('live');
  expect(await A.evaluate(() => Object.keys(window.CH.host.G.players).length)).toBe(3);

  // "I've been caught" shows the PIN but never names or measures a hunter.
  await B.click('[data-act=self-tag]');
  await expect(B.locator('.tagged-who')).toContainText('Waiting for a hunter');
  await expect(B.locator('.tagged-who')).not.toContainText('VIPER');
  expect((await snap(B)).me.near).toBeUndefined();
  await B.click('[data-act=tag-back]');

  // A hunter who switches GPS off cannot catch, even standing next to the
  // prey with the right PIN.
  const pin = (await snap(B)).me.pin;
  await blockGps(C, true);
  await expect.poll(async () => (await snap(C)).me.noFix, { timeout: 25000 }).toBe(true);
  expect((await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(false);
  const res = await ask(C, { k: 'catch:submit', target: before.me.id, pin }, 'catch:result');
  expect(res).toMatchObject({ ok: false, reason: 'gps' });
  await expect(C.locator('#catch-sub')).toContainText('No GPS fix');
  expect((await snap(B)).me.role).toBe('prey');
  await blockGps(C, false);
  await expect.poll(async () => (await snap(C)).me.noFix, { timeout: 25000 }).toBe(false);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('a prey who switches GPS off around ping time is pinged, and paid, only when the fix returns', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, [offset(0, 0), offset(60, 40), offset(-200, 60)],
    { beforeStart: (pages) => config(pages[0], { gps: { lostAfterSec: 3 } }) });
  await live(A);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);
  const paid = (await hostPlayer(A, 'NOMAD')).gc;
  const t0 = (await snap(C)).pings.find((p) => p.name === 'NOMAD').t;
  const no0 = (await snap(A)).pingNo;

  await blockGps(B, true);
  await expect.poll(async () => (await snap(A)).pingNo, { timeout: 40000 }).toBeGreaterThanOrEqual(no0 + 2);
  // Two pings went by without a position: nothing new on the hunters' map,
  // and nothing paid for "surviving" them.
  const during = await hostPlayer(A, 'NOMAD');
  expect(during.gc).toBe(paid);
  expect(during.owed).toEqual({ pay: true });
  expect((await snap(C)).pings.find((p) => p.name === 'NOMAD').t).toBe(t0);
  expect((await hostPlayer(A, 'GABRIEL')).gc).toBeGreaterThan(paid);        // the honest prey was paid as usual

  // The moment a position arrives again, the owed ping lands.
  const noBefore = (await snap(A)).pingNo;
  await blockGps(B, false);
  await expect.poll(async () => (await snap(C)).pings.find((p) => p.name === 'NOMAD').t, { timeout: 15000 }).toBeGreaterThan(t0);
  const back = await hostPlayer(A, 'NOMAD');
  expect(back.owed).toBeNull();
  expect(back.gc - paid).toBeLessThanOrEqual(40);                            // one payment for the delivered ping (two if a timed ping fell in the same moment), never three
  expect(back.gc).toBeGreaterThan(paid);
  expect((await snap(A)).pingNo - noBefore).toBeLessThanOrEqual(1);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('head start: a hunter with no GPS fix at release gets the penalty', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['NOMAD', 'VIPER'], { ...RULES, headStartSec: 12 }, [offset(0, 0), offset(60, 0), offset(-60, 0)],
    { beforeStart: (pages) => config(pages[0], { gps: { lostAfterSec: 2 } }) });
  await expect.poll(async () => !!(await snap(C)).me.hold).toBe(true);
  await blockGps(C, true);                       // GPS off for the rest of the head start
  await live(A);
  await expect.poll(async () => (await snap(C)).me.penaltyT).toBeGreaterThan(0);
  await expect(C.locator('#toasts')).toContainText('No GPS fix at your start point');
  await expect(A.locator('#toasts')).toContainText('VIPER had no GPS fix at their start point');
  expect((await snap(B)).me.penaltyT).toBe(0);   // the hunter who stayed put with GPS on is fine
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('help pause: catches are off, and a prey who asked is shown to hunters afterwards', async ({ game }) => {
  const [A, B] = await game.match(['VIPER', 'NOMAD'], ['VIPER'], RULES, [offset(0, 0), offset(8, 0)]);
  await live(A);
  await expect.poll(async () => ((await snap(A)).targets || []).some((t) => t.inRange)).toBe(true);
  await expect(A.locator('.catch-btn')).toBeEnabled();

  await B.click('#map-btns [data-act=help]');
  await B.click('[data-act=modal-yes]');
  await expect.poll(async () => (await snap(A)).paused).toBe(true);
  // Paused: the CATCH button says so instead of opening a screen that cannot work.
  await expect(A.locator('.catch-btn')).toBeDisabled();
  await expect(A.locator('#catch-sub')).toHaveText('Match paused');
  const res = await ask(A, { k: 'catch:submit', target: (await snap(B)).me.id, pin: (await snap(B)).me.pin }, 'catch:result');
  expect(res).toMatchObject({ ok: false, reason: 'paused' });

  await B.click('[data-act=help-ok]');
  await expect.poll(async () => (await snap(A)).paused).toBe(false);
  // Walking off during the pause does not hide you: live on the hunters' map for a minute.
  await expect.poll(async () => (await snap(A)).live.some((l) => l.name === 'NOMAD' && l.kind === 'revealed' && l.why === 'help')).toBe(true);
  await expect(B.locator('#banners')).toContainText('Hunters can see you live');
  expect((await snap(B)).me.helpRevealT).toBeGreaterThan(0);
  expect(A.errors.concat(B.errors)).toEqual([]);
});

test('decoys cannot be told from the real ping; adding time does not move the zone; converted prey get the hunter chat', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { ...RULES, pingSec: 6, matchSec: 120, zoneShrinkTo: 0.4 }, [offset(120, 0), offset(8, 0), offset(0, 0)]);
  await live(A);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);

  // Shrink window is fixed at the start; +5 minutes must not shift it.
  const z0 = (await snap(A)).zone;
  await send(A, { k: 'admin', op: 'time', min: 5 });
  await expect.poll(async () => (await snap(A)).endT).toBeGreaterThan(300000);
  const z1 = (await snap(A)).zone;
  expect(z1.shrinkStartT).toBe(z0.shrinkStartT);
  expect(z1.shrinkEndT).toBe(z0.shrinkEndT);
  expect(Math.abs(z1.r - z0.r)).toBeLessThan(30);

  // Decoy: drop one, walk away, wait for the next ping.
  await A.evaluate(() => { for (const p of window.CH.host.all()) p.gc = 600; window.CH.host.dirty = true; });
  await expect.poll(async () => (await snap(A)).me.gc).toBe(600);
  await send(A, { k: 'buy', id: 'decoy' });
  await send(A, { k: 'use', id: 'decoy' });
  await A.setGeo(offset(180, 60));
  const mine = async () => (await snap(C)).pings.filter((p) => p.name === 'GABRIEL');
  await expect.poll(async () => (await mine()).length, { timeout: 20000 }).toBe(2);
  let two = await mine();
  expect(Object.keys(two[0]).sort()).toEqual(Object.keys(two[1]).sort());   // same fields
  expect(two.every((p) => /^[a-z0-9]+:[01]$/.test(p.id))).toBe(true);       // ids say nothing about which is real
  expect(two[0].pid).toBe(two[1].pid);
  expect(two[0].t).toBe(two[1].t);
  expect(two[0].r).toBe(two[1].r);
  // Scan forces a fresh ping: both circles carry the new time.
  const t = two[0].t;
  await send(C, { k: 'buy', id: 'scan' });
  await send(C, { k: 'use', id: 'scan' });
  await expect.poll(async () => (await mine()).every((p) => p.t > t)).toBe(true);
  two = await mine();
  expect(two).toHaveLength(2);
  expect(two[0].t).toBe(two[1].t);

  // Hunter chat written before a catch is there for the prey who gets converted.
  await send(C, { k: 'chat', ch: 'team', text: 'meet at the north gate' });
  await C.click('[data-act=catch-open]');
  await expect(C.locator('.target.sel .target-name')).toHaveText('NOMAD');
  await typePin(C, (await snap(B)).me.pin);
  await C.waitForSelector('.catch-done');
  await B.waitForSelector('#s-converted:not([hidden])');
  await expect.poll(() => B.evaluate(() => window.CH.session.chat.team.map((m) => m.text))).toContain('meet at the north gate');
  await sleep(1500);                                                          // still there after the next snapshots
  expect(await B.evaluate(() => window.CH.session.chat.team.map((m) => m.text))).toContain('meet at the north gate');
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('map flow: lobby chat closes at the start, tagged screen closes on cancel, leave from the menu, host is asked before closing the lobby', async ({ game }) => {
  // NOMAD (prey) stands 8 m from VIPER (hunter). NOMAD has lobby chat open when the host starts.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, [offset(150, 0), offset(8, 0), offset(0, 0)],
    { beforeStart: async (pages) => {
      await pages[1].click('.lobby-chat');
      await expect(pages[1].locator('#s-chat')).toBeVisible();
    } });
  await expect(B.locator('#s-chat')).toBeHidden();
  expect(await B.evaluate(() => window.CH.sound.log)).toContain('start');
  await live(C);

  // The connection overlay must never cover a confirmation.
  const z = await A.evaluate(() => ['#modal', '#net', '#toasts'].map((s) => Number(getComputedStyle(document.querySelector(s)).zIndex)));
  expect(z[0]).toBeGreaterThan(z[1]);
  expect(z[2]).toBeGreaterThan(z[0]);

  // Hunter opens Confirm catch: the prey's PIN screen opens. Hunter cancels: it closes again.
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(true);
  await C.click('[data-act=catch-open]');
  await B.waitForSelector('#s-tagged:not([hidden]) .tagged-pin');
  await C.click('[data-act=catch-cancel]');
  await expect(B.locator('#s-tagged')).toBeHidden();
  await expect(B.locator('#toasts')).toContainText('The hunter cancelled the catch');
  // Opened by the prey themselves, it stays until they close it.
  await B.click('[data-act=self-tag]');
  await sleep(2500);
  await expect(B.locator('#s-tagged')).toBeVisible();
  await B.click('[data-act=tag-back]');

  // Menu: sound switch, then leave the match.
  await B.click('#map-btns [data-act=menu]');
  await expect(B.locator('#modal [data-act=sound]')).toHaveAttribute('aria-checked', 'true');
  await B.click('#modal [data-act=sound]');
  await expect(B.locator('#modal [data-act=sound]')).toHaveAttribute('aria-checked', 'false');
  expect(await B.evaluate(() => window.CH.sound.on)).toBe(false);
  await B.click('#modal [data-act=menu-leave]');
  await expect(B.locator('#modal')).toContainText('Leave this match?');
  await B.click('[data-act=modal-yes]');
  await B.waitForSelector('#s-home:not([hidden])');
  await expect.poll(async () => (await hostPlayer(A, 'NOMAD')).dropped).toBe(true);
  await expect(A.locator('#toasts')).toContainText('NOMAD is out of the match');
  // Out of a match, the phone stops reading its location.
  expect(await B.evaluate(() => window.CH.geo.timer)).toBeNull();

  // The host's menu warns that leaving ends the match.
  await A.click('#map-btns [data-act=menu]');
  await expect(A.locator('#modal [data-act=menu-leave]')).toContainText('End match and leave');
  await A.click('#modal [data-act=modal-close]');

  // Results: the host tapping Home is asked first, because it sends everyone home.
  await send(A, { k: 'admin', op: 'end' });
  await A.waitForSelector('#s-results:not([hidden]) .res-head');
  await C.waitForSelector('#s-results:not([hidden]) .res-head');
  await A.click('[data-act=res-home]');
  await expect(A.locator('#modal')).toContainText('Close the lobby for everyone?');
  await A.click('#modal [data-act=modal-close]');
  await expect(A.locator('#s-results')).toBeVisible();
  await expect(C.locator('#s-results')).toBeVisible();
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('small phone (360 x 640): the next step is always on screen', async ({ game }) => {
  // Invite link: the code is filled in and JOIN is the main button, in view.
  const A = await game.host('GABRIEL', offset(0, 0));
  const code = (await snap(A)).code;
  const B = await game.player('VIPER', offset(8, 0), { viewport: SMALL, url: URL + '&join=' + code });
  await expect(B.locator('#join-code')).toHaveValue(code);
  await expect(B.locator('.join-btn')).toHaveClass(/btn-lime/);
  await expect(B.locator('.invite-note')).toBeVisible();
  await expect.poll(() => onScreen(B, '.join-btn')).toBe(true);
  if (process.env.SHOTS) await B.screenshot({ path: process.env.SHOTS + '/small-home-invite.png' });
  await B.click('.join-btn');

  // Safety reminder: the button is in view without scrolling the page.
  await B.waitForSelector('#modal:not([hidden]) [data-act=safety-ok]');
  expect(await onScreen(B, '[data-act=safety-ok]')).toBe(true);
  if (process.env.SHOTS) await B.screenshot({ path: process.env.SHOTS + '/small-safety.png' });
  await B.click('[data-act=safety-ok]');
  const C = await game.join('NOMAD', code, offset(16, 0));
  const D = await game.join('JUNO', code, offset(300, 0));
  const E = await game.join('KESTREL', code, offset(-300, 0));

  await A.evaluate((rules) => {
    const h = window.CH.host;
    for (const p of h.all()) h.setLobbyRole(p, p.name === 'VIPER' ? 'hunter' : 'prey');
    Object.assign(h.G.rules, rules);
    h.dirty = true;
  }, RULES);
  await expect.poll(async () => (await snap(A)).players.filter((p) => p.role === 'hunter').length).toBe(1);
  await A.click('[data-act=start]');

  // Role reveal: OPEN MAP is on screen straight away.
  await B.waitForSelector('#s-reveal:not([hidden]) [data-act=open-map]');
  expect(await onScreen(B, '[data-act=open-map]')).toBe(true);
  if (process.env.SHOTS) await B.screenshot({ path: process.env.SHOTS + '/small-reveal.png' });
  for (const p of [A, B, C, D, E]) await p.click('[data-act=open-map]');

  // Map: the panel starts folded with a handle that says what it holds, and
  // nothing overlaps the map buttons.
  await expect(B.locator('.sheet-handle.closed')).toContainText('Shop and abilities');
  await live(B);
  await expect(B.locator('.catch-btn')).toBeVisible();
  const boxes = await B.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { hud: r('#hud').bottom, banners: r('#banners').bottom, btnsTop: r('#map-btns').top, btnsBottom: r('#map-btns').bottom, sheet: r('#sheet').top };
  });
  expect(boxes.btnsTop).toBeGreaterThanOrEqual(Math.max(boxes.hud, boxes.banners) - 1);
  expect(boxes.btnsBottom).toBeLessThanOrEqual(boxes.sheet + 1);
  await B.click('[data-act=sheet-toggle]');
  await expect(B.locator('#sheet .wallet')).toBeVisible();

  // Confirm catch with four prey: the whole keypad is on screen.
  await expect.poll(async () => ((await snap(B)).targets || []).filter((t) => t.inRange).length).toBe(2);
  await B.click('[data-act=catch-open]');
  await expect(B.locator('.targets .target')).toHaveCount(2);
  await expect(B.locator('.targets-rest')).toContainText('Too far: JUNO, KESTREL');
  for (const k of ['1', '3', '0', 'back']) expect(await onScreen(B, '[data-act=key][data-k="' + k + '"]')).toBe(true);
  expect(await onScreen(B, '[data-act=scan-open]')).toBe(true);
  expect(await onScreen(B, '[data-act=catch-cancel]')).toBe(true);
  expect(await onScreen(B, '.pin-boxes')).toBe(true);
  if (process.env.SHOTS) {
    await B.screenshot({ path: process.env.SHOTS + '/small-catch.png' });
    await B.click('[data-act=catch-cancel]');
    await B.screenshot({ path: process.env.SHOTS + '/small-map-hunter.png' });
    await B.click('#map-btns [data-act=menu]');
    await B.screenshot({ path: process.env.SHOTS + '/small-menu.png' });
    await C.setViewportSize(SMALL);
    await C.screenshot({ path: process.env.SHOTS + '/small-tagged-or-map-prey.png' });
  }
  // The prey's side on a small phone: PIN and scan code both on screen, no scrolling.
  // (VIPER's Confirm catch picked GABRIEL, the first prey in range, so GABRIEL's phone shows it.)
  await A.setViewportSize(SMALL);
  await A.waitForSelector('#s-tagged:not([hidden]) .tagged-qr');
  expect(await onScreen(A, '.tagged-pin')).toBe(true);
  expect(await onScreen(A, '.tagged-qr')).toBe(true);
  expect(await onScreen(A, '[data-act=tag-back]')).toBe(true);
  expect(A.errors.concat(B.errors, C.errors, D.errors, E.errors)).toEqual([]);
});

test('joining shows progress and can be cancelled; a reloaded guest waits for an absent host and gets back in', async ({ game }) => {
  test.slow();
  // A code nobody is hosting: progress card, then a clear answer, and the form works again.
  const X = await game.player('SOLO');
  await X.fill('#join-code', 'ZZZZZZ');
  await X.click('.join-btn');
  await expect(X.locator('#home-joining .joining')).toContainText('Joining');
  await expect(X.locator('[data-act=host]')).toBeDisabled();
  await expect(X.locator('#toasts')).toContainText('No lobby with code', { timeout: 30000 });
  await expect(X.locator('#home-joining .joining')).toHaveCount(0);
  await expect(X.locator('[data-act=host]')).toBeEnabled();
  // Cancel while it is still trying.
  await X.ctx.setOffline(true);
  await X.click('.join-btn');
  await expect(X.locator('#home-joining .joining')).toBeVisible();
  await X.click('[data-act=join-cancel]');
  await expect(X.locator('#home-joining .joining')).toHaveCount(0);
  expect(await X.evaluate(() => window.CH.session)).toBeNull();

  // Host away (its tab is on another page). The guest reloads: it must keep
  // trying instead of giving up after a few seconds.
  const [A, B] = await game.match(['GABRIEL', 'NOMAD'], ['NOMAD'], RULES, [offset(0, 0), offset(60, 0)]);
  await live(B);
  await A.goto('about:blank');
  await B.reload();
  await expect(B.locator('#home-joining .joining')).toContainText('Rejoining', { timeout: 15000 });
  await sleep(12000);                                    // well past three failed attempts
  await expect(B.locator('#home-joining .joining')).toBeVisible();
  await expect(B.locator('#joining-note')).toContainText('Waiting for the host');
  expect(await B.evaluate(() => !!window.CH.session)).toBe(true);

  // The host comes back: the guest is in the match again without touching anything.
  await A.goto(URL);
  await A.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 60000 });
  await B.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 60000 });
  await expect.poll(async () => (await snap(A)).players.find((p) => p.name === 'NOMAD').conn, { timeout: 30000 }).toBe(true);
  expect((await snap(B)).me.role).toBe('hunter');

  // Giving up on a rejoin keeps the offer on Home.
  await A.goto('about:blank');
  await B.reload();
  await expect(B.locator('#home-joining .joining')).toContainText('Rejoining', { timeout: 15000 });
  await B.click('[data-act=join-cancel]');
  await expect(B.locator('#home-resume [data-act=resume]')).toBeVisible();
  expect(B.errors.concat(X.errors)).toEqual([]);
});

test('lobby size ignores spectators; a stray retry never tears down a working connection', async ({ game }) => {
  const A = await game.host('GABRIEL');
  await config(A, { lobby: { maxPlayers: 2 } });
  const code = (await snap(A)).code;
  // Two spectators first: they must not use up the players' places.
  for (const name of ['WATCH1', 'WATCH2']) {
    const S = await game.player(name);
    await S.fill('#join-code', code);
    await S.click('[data-act=watch]');
    await S.waitForSelector('#s-lobby:not([hidden]) .code-big');
  }
  const B = await game.join('NOMAD', code);
  await expect.poll(async () => (await snap(A)).players.length).toBe(4);
  // A third player is one too many.
  const C = await game.player('JUNO');
  await C.fill('#join-code', code);
  await C.click('.join-btn');
  await expect(C.locator('#toasts')).toContainText('That lobby is full');

  // A retry timer left over from an earlier hiccup fires while connected.
  const steady = await B.evaluate(async () => {
    const n = window.CH.net;
    const conn = n.conn;
    n._attempt();
    await new Promise((r) => setTimeout(r, 800));
    return n.conn === conn && n.state.status === 'online' && conn.open;
  });
  expect(steady).toBe(true);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});
