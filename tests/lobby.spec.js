const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const { test, expect, offset, snap, sleep } = require('./helpers');

test('lobby: join, rules, roles, ready, start, per-prey PIN', async ({ game }) => {
  const [A, B, C] = await game.lobby(['GABRIEL', 'VIPER', 'NOMAD'], [offset(0, 0), offset(100, 0), offset(0, 120)]);

  await B.click('[data-act=ready]');
  await A.click('[data-act=mode][data-mode=SKIRMISH]');
  await A.click('[data-act=hunters][data-d="1"]');
  await expect.poll(async () => (await snap(C)).mode).toBe('SKIRMISH');
  let s = await snap(C);
  expect(s.rules.matchSec).toBe(900);
  expect(s.players.filter((p) => p.role === 'hunter')).toHaveLength(1);
  expect(s.players.find((p) => p.name === 'VIPER').ready).toBe(true);

  await A.click('[data-act=rule][data-rule=headStartSec]');
  await A.click('[data-act=rule-set][data-v="30"]');
  await expect.poll(async () => (await snap(B)).rules.headStartSec).toBe(30);

  await A.click('[data-act=start]');
  for (const p of [A, B, C]) await p.waitForSelector('#s-reveal:not([hidden]) .role-big');
  const snaps = [await snap(A), await snap(B), await snap(C)];
  const prey = snaps.filter((x) => x.me.role === 'prey');
  const hunters = snaps.filter((x) => x.me.role === 'hunter');
  expect(prey).toHaveLength(2);
  expect(new Set(prey.map((x) => x.me.pin)).size).toBe(2);
  for (const x of prey) expect(x.me.pin).toMatch(/^\d{4}$/);
  for (const x of hunters) expect(x.me.pin).toBeNull();
  // Nobody else's snapshot contains a prey's PIN.
  for (const x of snaps) for (const y of prey) if (x !== y) expect(JSON.stringify(x)).not.toContain('"' + y.me.pin + '"');
  expect(snaps[0].zone.r).toBe(250);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('theme toggles, persists across reload, and sound switch is remembered', async ({ game }) => {
  const A = await game.player('GABRIEL');
  await A.click('[data-act=theme]');
  expect(await A.evaluate(() => document.documentElement.dataset.theme)).toBe('sun');
  await A.click('[data-act=sound]');
  expect(await A.evaluate(() => window.CH.sound.on)).toBe(false);
  await A.reload();
  expect(await A.evaluate(() => document.documentElement.dataset.theme)).toBe('sun');
  expect(await A.evaluate(() => window.CH.sound.on)).toBe(false);
});

test('safety reminder shows once per lobby and can be reopened', async ({ game }) => {
  const A = await game.player('GABRIEL');
  await A.click('[data-act=host]');
  await A.waitForSelector('#modal:not([hidden]) .safety-list');
  await expect(A.locator('.safety-list li')).toHaveCount(5);
  await A.click('[data-act=safety-ok]');
  await expect(A.locator('#modal')).toBeHidden();
  await A.click('[data-act=safety]');
  await expect(A.locator('#modal .safety-list')).toBeVisible();
});

test('host places the play zone on a map; guests see it; start uses it', async ({ game }) => {
  const [A, B] = await game.lobby(['GABRIEL', 'VIPER'], [offset(0, 0), offset(50, 0)]);
  await expect(A.locator('.zone-card .smap-zone')).toBeVisible();   // preview from the host's own fix
  await expect(B.locator('.zone-card .smap.empty')).toBeVisible();  // guests see nothing until it is placed

  await A.click('[data-act=zone-edit]');
  await A.waitForSelector('#s-zone:not([hidden]) #zone-map.leaflet-container');
  await A.click('[data-act=zone-radius][data-v="400"]');
  // Drag the map 150 px east: the zone centre moves west.
  const box = await A.locator('#zone-map').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await A.mouse.move(cx, cy);
  await A.mouse.down();
  await A.mouse.move(cx + 80, cy, { steps: 6 });
  await A.mouse.move(cx + 150, cy, { steps: 6 });
  await A.mouse.up();
  await sleep(600);
  await A.click('[data-act=zone-done]');

  await expect.poll(async () => (await snap(B)).zoneCenter).not.toBeNull();
  const s = await snap(B);
  expect(s.rules.zoneRadiusM).toBe(400);
  expect(s.zoneCenter.lng).toBeLessThan(-0.1657 - 0.0005);
  expect(Math.abs(s.zoneCenter.lat - 51.5073)).toBeLessThan(0.0005);
  await expect(B.locator('.zone-card .smap-zone')).toBeVisible();
  await expect(B.locator('.zone-text')).toContainText('Placed on the map by the host');

  await A.click('[data-act=role][data-id] >> nth=1');
  await A.click('[data-act=start]');
  await B.waitForSelector('#s-reveal:not([hidden])');
  const z = (await snap(B)).zone;
  expect(z.r).toBe(400);
  expect(z.lng).toBeCloseTo(s.zoneCenter.lng, 5);
});

test('join QR code decodes to a link that prefills the lobby code', async ({ game }) => {
  const A = await game.host('GABRIEL');
  const code = (await snap(A)).code;
  await A.click('[data-act=qr]');
  await A.waitForSelector('.qr-box svg');
  const dataUrl = await A.evaluate(async () => {
    const svg = document.querySelector('.qr-box svg');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 480, 480);
    g.drawImage(img, 40, 40, 400, 400);
    return c.toDataURL('image/png');
  });
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded).not.toBeNull();
  expect(decoded.data).toContain('?join=' + code);

  // Opening that link fills the code in on Home.
  const B = await game.player('VIPER', offset(30, 0), { url: decoded.data + '&ps=127.0.0.1:9000' });
  expect(await B.inputValue('#join-code')).toBe(code);
  await B.click('.join-btn');
  await game.inLobby(B);
  await expect.poll(async () => (await snap(A)).players.length).toBe(2);
});

test('host console can remove a player from the lobby for good', async ({ game }) => {
  const [A, B] = await game.lobby(['GABRIEL', 'NOMAD', 'VIPER']);
  const code = (await snap(A)).code;
  await A.click('.topbar [data-act=admin]');
  await A.click('[data-act=adm-kick][data-name=NOMAD]');
  await A.click('[data-act=modal-yes]');
  await B.waitForSelector('#s-home:not([hidden])');
  await expect.poll(async () => (await snap(A)).players.length).toBe(2);
  await B.fill('#join-code', code);
  await B.click('.join-btn');
  await expect(B.locator('#toasts')).toContainText('removed you');
  await sleep(1500);
  expect((await snap(A)).players.length).toBe(2);
});
