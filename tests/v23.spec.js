// v2.3: update prompt, how to play, privacy, link preview, awards, past
// matches and the saved lobby setup. Tests tagged @webkit also run on the
// engine behind every iPhone browser.

const fs = require('fs');
const path = require('path');
const { test, expect, offset, snap, sleep, live, typePin } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const send = (page, msg) => page.evaluate((msg) => window.CH.session.send(msg), msg);

test('Home: how to play, privacy note, link preview, and the new-version prompt', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.player('GABRIEL');

  // How to play: four screens, then back to Home.
  await A.click('[data-act=howto]');
  await expect(A.locator('#modal h2')).toHaveText('Two sides');
  await expect(A.locator('[data-act=how-back]')).toBeDisabled();
  for (const title of ['Pings', 'The catch', 'Caught? Now you hunt']) {
    await A.click('[data-act=how-next]');
    await expect(A.locator('#modal h2')).toHaveText(title);
  }
  await expect(A.locator('.how-list')).toContainText('Roads come first');
  await A.click('[data-act=how-back]');
  await expect(A.locator('#modal h2')).toHaveText('The catch');
  await expect(A.locator('.how-list')).toContainText('within 15 m');
  await A.click('[data-act=how-next]');
  await A.click('[data-act=how-next]');                 // "Got it"
  await expect(A.locator('#modal')).toBeHidden();

  // Privacy note.
  await A.click('[data-act=privacy]');
  await expect(A.locator('#modal h2')).toHaveText('PRIVACY');
  await expect(A.locator('.privacy')).toContainText('Your catch PIN goes to nobody');
  await A.click('#modal [data-act=modal-close]');

  // Link preview: the tags are there and the picture exists.
  const og = await A.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute('property'), m.content])));
  expect(og['og:title']).toContain('City Hunter');
  expect(og['og:image']).toMatch(/^https:\/\/.+\/icons\/og\.png$/);
  expect(fs.existsSync(path.join(ROOT, 'icons/og.png'))).toBe(true);

  // "Past matches" stays hidden until there is one.
  await expect(A.locator('#home-history')).toBeHidden();

  // A newer version on the server: the bar offers a reload.
  await expect(A.locator('#update-bar')).toBeHidden();
  await A.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: '{"version":"9.9.9"}' }));
  await A.evaluate(() => window.CH.update.check());
  await expect(A.locator('#update-bar')).toContainText('A new version of City Hunter is ready');
  await A.unroute('**/version.json*');
  await Promise.all([A.waitForEvent('load'), A.click('[data-act=update-reload]')]);
  await expect(A.locator('#update-bar')).toBeHidden();
  expect(A.errors).toEqual([]);
});

test('version.json matches the app version', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  const cfg = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  expect(cfg).toContain("version: '" + v + "'");
  expect(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')).toContain('cityhunter-shell-v' + v);
});

test('hosting alone: lobby, rules, zone picker and join code all work', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.host('GABRIEL');
  await expect(A.locator('.code-big')).toHaveText(/^[A-Z0-9]{3}.[A-Z0-9]{3}$/);
  await A.click('[data-act=mode][data-mode=SKIRMISH]');
  await expect.poll(async () => (await snap(A)).mode).toBe('SKIRMISH');
  await A.click('[data-act=rule][data-rule=matchSec]');
  await A.click('[data-act=rule-set][data-v="600"]');
  await expect.poll(async () => (await snap(A)).rules.matchSec).toBe(600);
  await A.click('[data-act=qr]');
  await expect(A.locator('.qr-box svg')).toBeVisible();
  await A.click('#modal [data-act=modal-close]');
  await A.click('[data-act=zone-edit]');
  await expect(A.locator('#s-zone')).toBeVisible();
  await expect(A.locator('#zone-map.leaflet-container')).toBeVisible();
  await A.click('[data-act=zone-done]');
  await expect.poll(async () => !!(await snap(A)).zoneCenter).toBe(true);
  await expect(A.locator('.foot-note')).toContainText('Waiting for players to join');
  expect(A.errors).toEqual([]);
});

test('awards on the results screen, past matches on Home, and the last setup offered in the next lobby', async ({ game }) => {
  // GABRIEL (host, prey) 60 m from VIPER (hunter); NOMAD (prey) 8 m from VIPER.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 5, matchSec: 600, zoneRadiusM: 400 },
    [offset(60, 0), offset(8, 0), offset(0, 0)],
    { beforeStart: async (pages) => {
      await pages[0].click('[data-act=mode][data-mode=SKIRMISH]');
      await expect.poll(async () => (await snap(pages[0])).mode).toBe('SKIRMISH');
      await pages[0].click('[data-act=rule][data-rule=pingSec]');
      await pages[0].click('[data-act=rule-set][data-v="90"]');
      await expect.poll(async () => (await snap(pages[0])).rules.pingSec).toBe(90);
      // Switching mode reset the rules: keep the head start short for the test.
      await pages[0].evaluate(() => { Object.assign(window.CH.host.G.rules, { headStartSec: 2, zoneRadiusM: 400 }); window.CH.host.dirty = true; });
      await expect.poll(async () => (await snap(pages[0])).rules.headStartSec).toBe(2);
    } });
  await live(C);
  for (let i = 1; i <= 8; i++) { await A.setGeo(offset(60 + i * 20, i * 4)); await sleep(700); }   // GABRIEL walks about 160 m
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(true);
  await C.click('[data-act=catch-open]');
  await typePin(C, (await snap(B)).me.pin);
  await C.waitForSelector('.catch-done');
  await sleep(1500);
  await send(A, { k: 'admin', op: 'end' });
  for (const p of [A, B, C]) await p.waitForSelector('#s-results:not([hidden]) .res-head');

  const awards = (await snap(A)).result.awards;
  const by = Object.fromEntries(awards.map((a) => [a.id, a]));
  expect(by.survivor.name).toBe('GABRIEL');
  expect(by.first).toMatchObject({ name: 'VIPER', other: 'NOMAD' });
  expect(by.distance.name).toBe('GABRIEL');
  expect(by.distance.value).toBeGreaterThan(100);
  expect(by.escape.name).toBe('GABRIEL');               // still free, and VIPER had been within 100 m
  expect(by.hunter).toBeUndefined();                     // one catch is not enough for "Top hunter"
  await expect(A.locator('.awards .award')).toHaveCount(awards.length);
  await expect(A.locator('.awards .award.you')).toHaveCount(3);
  await expect(C.locator('.awards')).toContainText('First catch');
  await expect(C.locator('.awards .award.you')).toContainText('caught NOMAD');

  // Each phone keeps its own record of the match.
  const hist = await B.evaluate(() => JSON.parse(localStorage.getItem('ch2.history')));
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ startRole: 'prey', role: 'hunter', winner: 'none', players: 3 });
  await C.waitForSelector('#s-results:not([hidden])');
  await A.click('[data-act=res-home]');
  await A.click('#modal [data-act=modal-yes]');
  await A.waitForSelector('#s-home:not([hidden])');
  await A.click('#home-history');
  await expect(A.locator('.past-list .past')).toHaveCount(1);
  await expect(A.locator('.past-list')).toContainText('No winner');
  await expect(A.locator('.past-list')).toContainText('3 awards');
  await A.click('#modal [data-act=modal-close]');

  // Next lobby: one tap brings back the mode, rules and zone the host last used.
  await A.click('[data-act=host]');
  await game.inLobby(A);
  expect((await snap(A)).mode).toBe('DEAD_RECKONING');
  await expect(A.locator('.setup-use')).toContainText('Use last setup');
  await expect(A.locator('.setup-use')).toContainText('Skirmish');
  await A.click('.setup-use');
  await expect.poll(async () => (await snap(A)).mode).toBe('SKIRMISH');
  await expect.poll(async () => (await snap(A)).rules.pingSec).toBe(90);
  await expect(A.locator('.setup-use')).toHaveCount(0);  // nothing left to change
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});
