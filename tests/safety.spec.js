const { test, expect, offset, snap, sleep, config, live, typePin } = require('./helpers');

test('out of zone: countdown, direction, live reveal, clears when back inside', async ({ game }) => {
  const [A, B, C] = await game.match(['VIPER', 'NOMAD', 'JUNO'], ['VIPER'], { headStartSec: 2, pingSec: 6, matchSec: 900, zoneRadiusM: 150 }, [offset(0, 0), offset(60, 0), offset(-50, 30)]);
  for (const p of [A, B, C]) await config(p, { zone: { outGraceSec: 6 } });
  await live(A);

  await B.setGeo(offset(185, 30));
  await B.waitForSelector('#oz:not([hidden]) .oz-top');
  await expect(B.locator('#zone-border')).toBeVisible();
  await expect(B.locator('.oz-top')).toContainText('GET BACK IN');
  await expect(B.locator('.oz-dir')).toContainText('Head south');
  await expect(B.locator('.oz-dir')).toContainText(/3\d m to the nearest edge/);
  expect((await snap(A)).live.some((l) => l.kind === 'revealed')).toBe(false);
  expect(await B.evaluate(() => window.CH.sound.log)).toContain('zone');

  await expect.poll(async () => (await snap(A)).live.find((l) => l.kind === 'revealed'), { timeout: 20000 }).toBeTruthy();
  const rv = (await snap(A)).live.find((l) => l.kind === 'revealed');
  expect(rv.name).toBe('NOMAD');
  expect(rv.lat).toBeCloseTo(offset(185, 30).latitude, 4);
  await expect(B.locator('.oz-top')).toContainText('LIVE POSITION IS REVEALED');

  await B.setGeo(offset(60, 0));
  await expect.poll(async () => (await snap(A)).live.some((l) => l.kind === 'revealed')).toBe(false);
  await expect(B.locator('#oz')).toBeHidden();
  await expect(B.locator('#zone-border')).toBeHidden();
});

test('weak GPS warning, GPS lost sheet, grace, widening circle', async ({ game }) => {
  const [A, B, C] = await game.match(['VIPER', 'NOMAD', 'JUNO'], ['VIPER'], { headStartSec: 2, pingSec: 6, matchSec: 900, zoneRadiusM: 300 }, [offset(0, 0), offset(60, 0), offset(-50, 30)]);
  for (const p of [A, B, C]) await config(p, { gps: { graceSec: 8 } });
  await live(A);
  await expect.poll(async () => (await snap(A)).pings.length).toBe(2);

  await C.setGeo(offset(-50, 30, 55));
  await expect(C.locator('#hud')).toContainText('WEAK GPS');
  await C.setGeo(offset(-50, 30, 5));

  await C.evaluate(() => { window.CH.geo.blocked = true; });
  await C.waitForSelector('#gps-sheet:not([hidden]) #gps-title', { timeout: 25000 });
  await expect(C.locator('#gps-sheet')).toContainText('GPS SIGNAL LOST');
  await expect(C.locator('#hud')).toContainText('NO GPS');
  expect(await C.evaluate(() => window.CH.sound.log)).toContain('gps');

  // Grace runs out: the host is told and the ping is flagged to keep widening.
  await expect.poll(async () => ((await snap(A)).admin || []).some((p) => p.name === 'JUNO' && p.gpsOut), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await snap(A)).pings.find((p) => p.name === 'JUNO').lost).toBe(true);
  await expect(A.locator('#toasts')).toContainText('JUNO has had no GPS');
  const radius = () => A.evaluate(() => window.CH.map.items.get('p' + window.CH.session.snap.pings.find((p) => p.name === 'JUNO').id).circle.getRadius());
  const r1 = await radius();
  await sleep(3000);
  expect(await radius()).toBeGreaterThan(r1 + 2);

  await C.click('[data-act=gps-min]');
  await expect(C.locator('.gps-bar')).toBeVisible();
  await C.evaluate(() => { window.CH.geo.blocked = false; });
  await expect(C.locator('#gps-sheet')).toBeHidden();
  await expect.poll(async () => ((await snap(A)).admin || []).some((p) => p.name === 'JUNO' && p.gpsOut)).toBe(false);
});

test('"I need help" pauses the match, alerts everyone and shows where the player is', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 30, matchSec: 600, zoneRadiusM: 300 }, [offset(0, 0), offset(70, 20), offset(-60, 0)]);
  await live(A);

  await B.click('#map-btns [data-act=help]');
  await B.click('[data-act=modal-yes]');
  await expect.poll(async () => (await snap(C)).paused).toBe(true);
  const sc = await snap(C);
  expect(sc.pauseReason).toBe('help');
  expect(sc.help.name).toBe('NOMAD');
  expect(sc.help.lat).toBeCloseTo(offset(70, 20).latitude, 4);     // a hunter is shown the prey's position
  await expect(C.locator('#banners')).toContainText('NOMAD NEEDS HELP');
  await expect(B.locator('#banners')).toContainText('HELP REQUESTED');
  await expect.poll(() => C.evaluate(() => window.CH.map.items.has('help'))).toBe(true);
  expect(await C.evaluate(() => window.CH.sound.log)).toContain('help');
  expect(await A.evaluate(() => window.CH.sound.log)).toContain('help');
  // Only the player who asked, or the host, can resume.
  await expect(C.locator('[data-act=help-ok]')).toHaveCount(0);
  await expect(A.locator('[data-act=help-ok]')).toHaveCount(1);

  await B.click('[data-act=help-ok]');
  await expect.poll(async () => (await snap(C)).paused).toBe(false);
  expect((await snap(C)).help).toBeUndefined();
  await expect(C.locator('#banners')).not.toContainText('NEEDS HELP');
});

test('fair play: impossible moves are flagged to the host', async ({ game }) => {
  const [A, B] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 30, matchSec: 600, zoneRadiusM: 1500 }, [offset(0, 0), offset(50, 0), offset(-50, 0)]);
  await live(A);
  await expect.poll(async () => ((await snap(A)).admin || []).find((p) => p.name === 'NOMAD').gpsAge).not.toBeNull();
  await B.setGeo(offset(50, 20));                  // an ordinary step: no flag
  await sleep(2500);
  expect((await snap(A)).admin.find((p) => p.name === 'NOMAD').jumps).toBe(0);

  await B.setGeo(offset(900, 400));                // about 900 m in a couple of seconds
  await expect.poll(async () => (await snap(A)).admin.find((p) => p.name === 'NOMAD').jumps).toBeGreaterThan(0);
  await expect(A.locator('#toasts')).toContainText(/NOMAD moved \d+ m in \d+ s/);
  await A.click('#map-btns [data-act=admin]');
  await expect(A.locator('.admin-player', { hasText: 'NOMAD' })).toContainText('impossible move');
});

test('fair play: a hunter who leaves their start point during the head start cannot catch for a while', async ({ game }) => {
  // NOMAD (prey) waits 60 m north. VIPER (hunter) walks there during the head start.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 12, pingSec: 30, matchSec: 600, zoneRadiusM: 400 }, [offset(-100, 0), offset(60, 0), offset(0, 0)]);
  await config(A, { fair: { holdPenaltySec: 8 } });
  await expect.poll(async () => !!(await snap(C)).me.hold).toBe(true);
  expect((await snap(C)).me.hold.out).toBe(false);
  await expect(C.locator('#banners')).toContainText('Hold your position');

  await C.setGeo(offset(55, 0));
  await expect.poll(async () => (await snap(C)).me.hold.out).toBe(true);
  await expect(C.locator('#banners')).toContainText('Go back to your start point');

  await live(C);
  await expect.poll(async () => (await snap(C)).me.penaltyT).toBeGreaterThan(0);
  await expect(C.locator('.catch-btn')).toBeDisabled();
  await expect(C.locator('#catch-sub')).toContainText('Head-start penalty');
  await expect(A.locator('#toasts')).toContainText('VIPER left their start point');
  const sc = await snap(C);
  const res = await C.evaluate((arg) => new Promise((resolve) => {
    const s = window.CH.session;
    const off = s.on('catch:result', (m) => { off(); resolve(m); });
    s.send({ k: 'catch:submit', target: arg.id, pin: '0000' });
  }), { id: sc.targets.find((t) => t.name === 'NOMAD').id });
  expect(res).toMatchObject({ ok: false, reason: 'penalty' });

  // Penalty served: the catch goes through.
  await expect.poll(async () => (await snap(C)).me.penaltyT, { timeout: 20000 }).toBe(0);
  await expect(C.locator('.catch-btn')).toBeEnabled();
  await C.click('[data-act=catch-open]');
  await typePin(C, (await snap(B)).me.pin);
  await C.waitForSelector('.catch-done');
});

test('a hunter who holds position gets no penalty', async ({ game }) => {
  const [, , C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 4, pingSec: 30, matchSec: 600, zoneRadiusM: 400 });
  await live(C);
  await sleep(1200);
  expect((await snap(C)).me.penaltyT).toBe(0);
  await expect(C.locator('.catch-btn')).toBeEnabled();
});

test('compass heading turns the direction wedge while standing still', async ({ game }) => {
  const [A] = await game.match(['GABRIEL', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 30, matchSec: 600, zoneRadiusM: 300 });
  await live(A);
  expect(await A.evaluate(() => window.CH.geo.heading())).toBeNull();   // no movement, no compass yet
  // Android-style absolute orientation: alpha 270 means facing east (90 degrees).
  await A.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 270, beta: 0, gamma: 0, absolute: true })));
  expect(await A.evaluate(() => window.CH.geo.heading())).toBeCloseTo(90, 0);
  await expect(A.locator('.me-wedge')).toHaveAttribute('style', /rotate\(90deg\)/);
  // iOS-style reading.
  await A.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 200; window.dispatchEvent(e); });
  expect(await A.evaluate(() => window.CH.geo.heading())).toBeCloseTo(200, 0);
});
