const { test, expect, offset, snap, sleep, typePin, live } = require('./helpers');

test('catch PIN: range check, wrong PIN, lockout, conversion', async ({ game }) => {
  // NOMAD stands 8 m from VIPER (hunter); GABRIEL is 150 m away.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 3, pingSec: 8, matchSec: 600, zoneRadiusM: 400 }, [offset(150, 0), offset(8, 0), offset(0, 0)]);
  await live(C);
  await expect.poll(async () => ((await snap(C)).targets || []).length).toBe(2);
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(true);
  let sc = await snap(C);
  const tG = sc.targets.find((t) => t.name === 'GABRIEL');
  expect(tG.inRange).toBe(false);

  const pinB = (await snap(B)).me.pin, pinA = (await snap(A)).me.pin;
  expect(JSON.stringify(sc)).not.toContain('"' + pinB + '"');
  expect(JSON.stringify(await snap(A))).not.toContain('"' + pinB + '"');

  await C.click('[data-act=catch-open]');
  await expect(C.locator('.target.sel .target-name')).toHaveText('NOMAD');
  // Prey out of range are listed in one line, not as rows you cannot tap.
  await expect(C.locator('.targets .target')).toHaveCount(1);
  await expect(C.locator('.targets-rest')).toContainText('Too far: GABRIEL');
  // Yes-or-no only: the snapshot never carries a live distance to a prey.
  expect(sc.targets.every((t) => !('d' in t))).toBe(true);
  await expect(C.locator('.range.ok')).toContainText('GPS range check passed');

  // The prey's phone flips to the big-PIN screen.
  await B.waitForSelector('#s-tagged:not([hidden]) .tagged-pin');
  await expect(B.locator('.tagged-who')).toContainText('Waiting for VIPER');
  await expect(B.locator('.tagged-pin')).toHaveText(pinB);
  expect(await B.evaluate(() => window.CH.sound.log)).toContain('tagged');

  // Wrong PIN.
  await typePin(C, pinB === '0000' ? '1111' : '0000');
  await expect(C.locator('.pin-status')).toContainText('Wrong PIN. 2 tries left');
  expect((await snap(B)).me.role).toBe('prey');

  // The RIGHT PIN for a prey 150 m away is still refused.
  const far = await C.evaluate((arg) => new Promise((resolve) => {
    const s = window.CH.session;
    const off = s.on('catch:result', (m) => { off(); resolve(m); });
    s.send({ k: 'catch:submit', target: arg.id, pin: arg.pin });
  }), { id: tG.id, pin: pinA });
  expect(far).toMatchObject({ ok: false, reason: 'range' });

  // Correct PIN.
  await typePin(C, pinB);
  await C.waitForSelector('.catch-done');
  await expect(C.locator('.catch-done')).toContainText('NOMAD is now a hunter');
  await B.waitForSelector('#s-converted:not([hidden]) .conv-big');
  const sb = await snap(B);
  expect(sb.me.role).toBe('hunter');
  expect(sb.me.pin).toBeNull();
  sc = await snap(C);
  expect(sc.me.gc).toBe(250);
  expect(sc.counts.prey).toBe(1);
  await expect(A.locator('#toasts')).toContainText('VIPER caught NOMAD');

  await B.click('[data-act=conv-go]');
  await C.click('[data-act=catch-back]');
  await expect(B.locator('#banners')).toContainText('BEEN CONVERTED');
  await expect.poll(async () => (await snap(B)).live.some((l) => l.name === 'VIPER' && l.kind === 'mate')).toBe(true);
  await B.click('[data-act=banner-x]');
  await expect(B.locator('#banners')).not.toContainText('CONVERTED');

  // Lockout after three wrong PINs.
  await C.setGeo(offset(145, 0));
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'GABRIEL').inRange).toBe(true);
  await C.click('[data-act=catch-open]');
  await expect(C.locator('.target.sel .target-name')).toHaveText('GABRIEL');
  const wrong = pinA === '0000' ? '1111' : '0000';
  for (let i = 0; i < 3; i++) {
    await typePin(C, wrong);
    await expect(C.locator('.pin-box.filled')).toHaveCount(0);
    await sleep(300);
  }
  await expect(C.locator('.pin-status')).toContainText('Too many wrong PINs');
});

test('full match: hunters win, results, route replay, rematch', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 5, matchSec: 600, zoneRadiusM: 400 }, [offset(0, 0), offset(100, 0), offset(-60, 0)]);
  await live(C);
  for (let i = 1; i <= 6; i++) { await A.setGeo(offset(i * 12, i * i * 2)); await sleep(600); }

  // VIPER catches GABRIEL (host).
  await C.setGeo(offset(74, 70));
  await expect.poll(async () => ((await snap(C)).targets || []).some((t) => t.name === 'GABRIEL' && t.inRange)).toBe(true);
  await C.click('[data-act=catch-open]');
  await expect(C.locator('.target.sel .target-name')).toHaveText('GABRIEL');
  await typePin(C, (await snap(A)).me.pin);
  await C.waitForSelector('.catch-done');
  await C.click('[data-act=catch-back]');
  await A.waitForSelector('#s-converted:not([hidden])');
  await A.click('[data-act=conv-go]');

  // GABRIEL, now a hunter, walks on and catches NOMAD: match over.
  for (let i = 1; i <= 4; i++) { await A.setGeo(offset(72 + i * 6, 72 - i * 16)); await sleep(600); }
  await A.setGeo(offset(97, 2));
  await expect.poll(async () => ((await snap(A)).targets || []).some((t) => t.name === 'NOMAD' && t.inRange)).toBe(true);
  await A.click('[data-act=catch-open]');
  await typePin(A, (await snap(B)).me.pin);
  await A.waitForSelector('#s-results:not([hidden]) .res-head');

  const r = (await snap(A)).result;
  expect(r.winner).toBe('hunters');
  expect(r.lastCatch).toEqual({ hunter: 'GABRIEL', prey: 'NOMAD' });
  await expect(A.locator('.res-head')).toContainText('HUNTERS');
  await expect(A.locator('.rank.you')).toContainText('GABRIEL');
  expect(await A.locator('.route-line.prey').count()).toBeGreaterThan(0);
  expect(await A.locator('.route-line.hunter').count()).toBeGreaterThan(0);
  await expect(A.locator('.route-ring.me')).toHaveCount(1);
  await A.click('[data-act=replay]');
  await expect(B.locator('.res-foot')).toContainText('WAITING FOR HOST');

  await A.click('[data-act=rematch]');
  await B.waitForSelector('#s-lobby:not([hidden]) .code-big');
  const s = await snap(B);
  expect(s.players).toHaveLength(3);
  expect(s.players.find((p) => p.name === 'VIPER').role).toBe('hunter');
  expect(s.players.find((p) => p.name === 'GABRIEL').role).toBe('prey');
});

test('two players, clock runs out: prey survive and collect the bonus', async ({ game }) => {
  const [A, B] = await game.match(['VIPER', 'JUNO'], ['VIPER'], { headStartSec: 2, pingSec: 3, matchSec: 9, zoneRadiusM: 300 }, [offset(0, 0), offset(120, 0)]);
  await B.waitForSelector('#s-results:not([hidden]) .res-head', { timeout: 30000 });
  const r = (await snap(B)).result;
  expect(r.winner).toBe('prey');
  expect(r.survivors).toEqual(['JUNO']);
  expect(r.board.find((x) => x.name === 'JUNO').earned).toBeGreaterThanOrEqual(220);
  await expect(A.locator('.res-head')).toContainText('SURVIVED');
});

test('host console: pause, resume, extend, end with no winner', async ({ game }) => {
  const [A, B] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 5, matchSec: 600, zoneRadiusM: 400 });
  await live(B);
  await A.click('#map-btns [data-act=admin]');
  await A.click('[data-act=adm][data-op=pause]');
  await expect.poll(async () => (await snap(B)).paused).toBe(true);
  const t1 = (await snap(B)).T;
  await sleep(1500);
  expect((await snap(B)).T).toBe(t1);
  await A.click('[data-act=adm][data-op=resume]');
  await expect.poll(async () => (await snap(B)).paused).toBe(false);
  const end0 = (await snap(B)).endT;
  await A.click('[data-act=adm][data-op=time][data-min="5"]');
  await expect.poll(async () => (await snap(B)).endT).toBe(end0 + 300000);
  await A.click('[data-act=adm-end]');
  await A.click('[data-act=modal-yes]');
  await B.waitForSelector('#s-results:not([hidden]) .res-head');
  await expect(B.locator('.res-head')).toContainText('WINNER');
  expect((await snap(B)).result.winner).toBe('none');
});
