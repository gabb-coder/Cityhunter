const { test, expect, offset, snap, sleep, config, gameT, live, URL } = require('./helpers');

const RULES = { headStartSec: 2, pingSec: 6, matchSec: 900, zoneRadiusM: 300 };
const GEOS = [offset(0, 0), offset(80, 0), offset(-80, 0), offset(0, 90)];
const cutOff = async (page) => {
  await page.ctx.setOffline(true);
  await page.evaluate(() => window.CH.net.conn.close());
};

test('connection lost (you): overlay, match keeps running, same spot on return, spot released after the hold', async ({ game }) => {
  test.slow();
  const [A, B, C, D] = await game.match(['GABRIEL', 'NOMAD', 'VIPER', 'JUNO'], ['VIPER'], RULES, GEOS);
  await live(C);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(3);

  await cutOff(B);
  await B.waitForSelector('#net:not([hidden]) #net-title');
  await expect(B.locator('#net-title')).toHaveText('CONNECTION LOST');
  await expect(B.locator('#net-status')).toContainText(/attempt [2-9]/, { timeout: 20000 });
  await expect(B.locator('.net-facts')).toContainText('Running');
  await expect(B.locator('.net-facts')).toContainText(/held for\s*04:/);
  const t1 = await gameT(B);
  await sleep(2000);
  expect((await gameT(B)) - t1).toBeGreaterThan(1500);            // my clock keeps running

  await expect.poll(async () => (await snap(A)).players.find((p) => p.name === 'NOMAD').conn, { timeout: 20000 }).toBe(false);
  const sc = await snap(C);
  expect(sc.paused).toBe(false);
  expect(sc.pings.some((p) => p.name === 'NOMAD')).toBe(true);    // hunters still see the last ping

  await B.ctx.setOffline(false);
  await expect(B.locator('#net')).toBeHidden({ timeout: 30000 });
  await expect.poll(async () => (await snap(A)).players.find((p) => p.name === 'NOMAD').conn).toBe(true);
  expect((await snap(B)).me.role).toBe('prey');

  // Spot hold runs out: the prey forfeits, and comes back as a hunter.
  await config(A, { net: { spotHoldSec: 5 } });
  await cutOff(D);
  await expect.poll(async () => (await snap(A)).players.find((p) => p.name === 'JUNO').dropped, { timeout: 40000 }).toBe(true);
  const sa = await snap(A);
  expect(sa.counts.prey).toBe(2);
  expect(sa.players.find((p) => p.name === 'JUNO').role).toBe('hunter');
  await D.ctx.setOffline(false);
  await expect(D.locator('#net')).toBeHidden({ timeout: 30000 });
  await expect.poll(async () => (await snap(D)).me.role).toBe('hunter');
  expect((await snap(A)).players.find((p) => p.name === 'JUNO').dropped).toBe(false);
});

test('host offline: clients pause, host resumes the same match, downtime is not charged', async ({ game }) => {
  test.slow();
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER', 'JUNO'], ['VIPER'], RULES, GEOS);
  await live(C);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(3);
  await sleep(2500);                                              // let the host save its game
  const tHost = await gameT(A);
  const code = (await snap(A)).code;
  const ctxA = A.ctx;
  await A.close({ runBeforeUnload: false });

  await B.waitForSelector('#net:not([hidden]) #net-title', { timeout: 25000 });
  await expect(B.locator('#net-title')).toHaveText('HOST OFFLINE', { timeout: 20000 });
  await expect(B.locator('#net-status')).toContainText(/Waiting for GABRIEL · 0[12]:\d\d left/);
  await expect(B.locator('.net-facts')).toContainText('Paused at');
  const f1 = await gameT(B);
  await sleep(3000);
  expect(await gameT(B)).toBe(f1);                                // clock frozen

  // The host's tab died: a new tab on the same phone offers to resume.
  const A2 = await ctxA.newPage();
  A2.on('dialog', (d) => d.accept().catch(() => {}));
  await A2.goto(URL);
  await A2.click('[data-act=resume]');
  await A2.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 20000 });
  await expect(B.locator('#net')).toBeHidden({ timeout: 45000 });
  await expect(C.locator('#net')).toBeHidden({ timeout: 45000 });
  await expect.poll(async () => (await snap(A2)).players.filter((p) => p.conn).length, { timeout: 30000 }).toBe(4);

  const s2 = await snap(A2);
  expect(s2.code).toBe(code);
  expect(s2.phase).toBe('live');
  expect(s2.me.host).toBe(true);
  expect((await gameT(A2)) - tHost).toBeLessThan(20000);          // ~30 s away, but only seconds charged
  const sb = await snap(B);
  expect(sb.paused).toBe(false);
  expect(sb.me.role).toBe('prey');
  expect(sb.me.pin).toMatch(/^\d{4}$/);
  expect(Math.abs((await gameT(B)) - (await gameT(A2)))).toBeLessThan(2500);

  // Reloading the host tab resumes on its own; so does a guest reload.
  await A2.reload();
  await A2.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 20000 });
  await expect.poll(async () => (await snap(A2)).players.filter((p) => p.conn).length, { timeout: 45000 }).toBe(4);
  await C.reload();
  await C.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 25000 });
  await expect.poll(async () => (await snap(C)).me.name).toBe('VIPER');
  expect((await snap(C)).me.role).toBe('hunter');
});

test('host never returns: the match ends with no winner', async ({ game }) => {
  test.slow();
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], RULES, GEOS);
  await live(C);
  for (const p of [B, C]) await config(p, { net: { hostOfflineHoldSec: 14 } });
  await A.close({ runBeforeUnload: false });
  await B.waitForSelector('#s-results:not([hidden]) .res-head', { timeout: 60000 });
  await expect(B.locator('.res-head')).toContainText('WINNER');
  expect((await snap(B)).result).toMatchObject({ winner: 'none', reason: 'host-lost' });
  await expect(B.locator('[data-act=rematch]')).toHaveCount(0);
  await B.click('[data-act=res-home]');
  await B.waitForSelector('#s-home:not([hidden])');
});

test('a phone running an older version of the app is turned away', async ({ game }) => {
  const A = await game.host('GABRIEL');
  const code = (await snap(A)).code;
  const B = await game.player('OLDPHONE', offset(20, 0));
  await config(B, { protocol: {} });
  await B.evaluate(async () => { const { CONFIG } = await import('./js/config.js'); CONFIG.protocol = 1; });
  await B.fill('#join-code', code);
  await B.click('.join-btn');
  await expect(B.locator('#toasts')).toContainText('out of date');
  await sleep(1000);
  expect((await snap(A)).players).toHaveLength(1);
});
