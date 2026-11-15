const { test, expect, offset, snap, sleep, live } = require('./helpers');

const RULES = { headStartSec: 3, pingSec: 8, matchSec: 600, zoneRadiusM: 300 };
const giveGc = (host, amount) => host.evaluate((amount) => { for (const p of window.CH.host.all()) p.gc = amount; window.CH.host.dirty = true; }, amount);
const pingOf = async (page, name) => (await snap(page)).pings.filter((p) => p.name === name);

test('pings, Glowcoin, shop, Ghost, Decoy, Scan', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, [offset(0, 0), offset(60, 40), offset(-90, 60)]);
  await live(A);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);

  let sa = await snap(A), sc = await snap(C);
  expect(sc.pings.every((p) => p.kind === 'prey')).toBe(true);
  expect(sa.pings).toHaveLength(1);
  expect(sa.pings[0].kind).toBe('hunter');
  expect(sa.live).toHaveLength(0);                 // prey never get live positions
  expect(sa.me.gc).toBe(120);                      // paid for surviving the first ping
  expect(sc.me.gc).toBe(100);
  expect(JSON.stringify(sc)).not.toContain('"' + sa.me.pin + '"');

  // Shop
  await giveGc(A, 340);
  await A.click('[data-act=shop]');
  await A.click('[data-act=buy][data-id=ghost]');
  await A.click('[data-act=buy][data-id=decoy]');
  await expect.poll(async () => (await snap(A)).me.gc).toBe(140);
  await expect(A.locator('[data-act=buy][data-id=safehouse]')).toContainText('NEED 60');
  await A.click('.shop-back');

  // Ghost skips the next ping; Decoy adds a second, fake one.
  await A.click('[data-act=use][data-id=ghost]');
  await expect.poll(async () => (await snap(A)).me.fx.ghost).toBe(true);
  const before = (await pingOf(C, 'GABRIEL'))[0].t;
  await A.click('[data-act=use][data-id=decoy]');
  await expect.poll(async () => (await pingOf(C, 'NOMAD'))[0].t, { timeout: 20000 }).toBeGreaterThan(before);
  const g = await pingOf(C, 'GABRIEL');
  expect(g.some((p) => p.t === before)).toBe(true);
  expect(g).toHaveLength(2);

  // Scan: bought and used in one tap, fresh fix on every prey.
  await giveGc(A, 400);
  await expect.poll(async () => (await snap(C)).me.gc).toBe(400);
  const t0 = (await pingOf(C, 'NOMAD'))[0].t;
  await C.click('[data-act=quick]');
  await expect.poll(async () => (await snap(C)).me.gc).toBe(250);
  await expect.poll(async () => (await pingOf(C, 'NOMAD'))[0].t).toBeGreaterThan(t0);

  // Sound cues fired for the things that happened.
  const cues = await A.evaluate(() => window.CH.sound.log);
  expect(cues).toContain('release');
  expect(cues).toContain('ping');
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('Jammer, Safe House, Tracker, Proximity Radar, Lockdown', async ({ game }) => {
  // NOMAD (prey) stands 8 m from VIPER (hunter); GABRIEL (prey, host) is 60 m away.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { ...RULES, pingSec: 6 }, [offset(60, 0), offset(8, 0), offset(0, 0)]);
  await live(A);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);
  await giveGc(A, 1000);
  await expect.poll(async () => (await snap(B)).me.gc).toBe(1000);
  const send = (page, msg) => page.evaluate((msg) => window.CH.session.send(msg), msg);

  // Jammer doubles the ping circle the hunter sees.
  const r0 = (await pingOf(C, 'GABRIEL'))[0].r;
  await send(A, { k: 'buy', id: 'jammer' });
  await send(A, { k: 'use', id: 'jammer' });
  await expect.poll(async () => (await pingOf(C, 'GABRIEL'))[0].r).toBe(r0 * 2);
  await expect(A.locator('[data-act=use][data-id=jammer]')).toHaveAttribute('aria-pressed', 'true');

  // Safe House: a correct PIN from point-blank range is refused.
  await send(B, { k: 'buy', id: 'safehouse' });
  await send(B, { k: 'use', id: 'safehouse' });
  await expect.poll(async () => !!(await snap(B)).me.fx.safe).toBe(true);
  const pinB = (await snap(B)).me.pin;
  const idB = (await snap(C)).targets.find((t) => t.name === 'NOMAD').id;
  const res = await C.evaluate((arg) => new Promise((resolve) => {
    const s = window.CH.session;
    const off = s.on('catch:result', (m) => { off(); resolve(m); });
    s.send({ k: 'catch:submit', target: arg.id, pin: arg.pin });
  }), { id: idB, pin: pinB });
  expect(res).toMatchObject({ ok: false, reason: 'safe' });
  expect((await snap(B)).me.role).toBe('prey');

  // Tracker shows the nearest prey's direction of travel at the next ping.
  await send(C, { k: 'buy', id: 'tracker' });
  await send(C, { k: 'use', id: 'tracker' });
  await expect.poll(async () => ((await snap(C)).me.fx.tracker || {}).name).toBe('NOMAD');
  await B.setGeo(offset(8, 40));                           // walks east
  await expect.poll(async () => (await pingOf(C, 'NOMAD'))[0].hdg, { timeout: 20000 }).toBeDefined();
  const hdg = (await pingOf(C, 'NOMAD'))[0].hdg;
  expect(hdg).toBeGreaterThan(70);
  expect(hdg).toBeLessThan(110);

  // Proximity Radar buzzes when a prey is within 100 m.
  await send(C, { k: 'buy', id: 'radar' });
  await send(C, { k: 'use', id: 'radar' });
  await expect.poll(() => C.evaluate(() => window.CH.sound.log.includes('radar'))).toBe(true);

  // Lockdown shrinks the zone by 20% for everyone.
  await send(C, { k: 'buy', id: 'lockdown' });
  await send(C, { k: 'use', id: 'lockdown' });
  await expect.poll(async () => (await snap(A)).zone.r).toBe(240);
  expect((await snap(A)).zone.base).toBe(300);
});

test('team chat stays on its side; everyone channel reaches all; push-to-talk reaches teammates only', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES);
  await live(A);

  await A.click('#sheet [data-act=chat]');
  await A.fill('#chat-input', 'heading to the fountain');
  await A.press('#chat-input', 'Enter');
  await expect.poll(() => B.evaluate(() => window.CH.session.chat.team.map((m) => m.text))).toContain('heading to the fountain');
  expect(await B.evaluate(() => window.CH.session.unread.team)).toBe(1);
  expect(await C.evaluate(() => window.CH.session.chat.team.length)).toBe(0);
  expect(await B.evaluate(() => window.CH.sound.log)).toContain('msg');

  await A.click('[data-act=chat-tab][data-tab=all]');
  await A.fill('#chat-input', 'gg all');
  await A.press('#chat-input', 'Enter');
  await expect.poll(() => C.evaluate(() => window.CH.session.chat.all.map((m) => m.text))).toContain('gg all');
  await A.click('.chat-head [data-act=layer-close]');

  // Voice: wait until the host knows everyone's voice address.
  await expect.poll(async () => (await snap(A)).players.filter((p) => p.peer).length).toBe(1);
  await expect.poll(async () => (await snap(B)).players.filter((p) => p.peer).length).toBe(1);
  await A.evaluate(() => window.CH.voice.start());
  await expect.poll(() => B.evaluate(() => window.CH.ui.talking), { timeout: 15000 }).toBe('GABRIEL');
  expect(await C.evaluate(() => window.CH.ui.talking || null)).toBeNull();
  await A.evaluate(() => window.CH.voice.release());
  // The banner clears straight away, not when the audio link times out.
  await expect.poll(() => B.evaluate(() => window.CH.ui.talking || null), { timeout: 3000 }).toBeNull();
  expect(await B.evaluate(() => document.querySelectorAll('#voice-audio audio').length)).toBe(0);
});
