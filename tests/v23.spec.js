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

// ---------------------------------------------------------------- scan to catch
// A stand-in camera for the hunter: a canvas showing the prey's code.
const fakeCamera = (page, svg) => page.evaluate(async (svg) => {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const ctx = c.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#7a7f7c';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#fff';
    ctx.fillRect(170, 90, 300, 300);
    ctx.drawImage(img, 190, 110, 260, 260);
  };
  draw();
  setInterval(draw, 100);
  const stream = c.captureStream(10);
  navigator.mediaDevices.getUserMedia = async () => stream;
  window.__cam = stream;
}, svg);

test('scan to catch: the prey’s screen shows a code, the hunter’s camera reads it, and the catch goes through', async ({ game }) => {
  // NOMAD (prey) stands 8 m from VIPER (hunter); GABRIEL (host, prey) is far away.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 8, matchSec: 600, zoneRadiusM: 400 }, [offset(150, 0), offset(8, 0), offset(0, 0)]);
  await live(C);
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange).toBe(true);

  // The code is on the prey's own PIN screen, next to the PIN.
  await B.click('[data-act=self-tag]');
  await expect(B.locator('.tagged-pin')).toHaveText((await snap(B)).me.pin);
  await expect(B.locator('.tagged-qr svg')).toBeVisible();
  const code = await B.locator('.tagged-qr').innerHTML();
  // It is never in anybody else's snapshot.
  expect(JSON.stringify(await snap(C))).not.toContain((await snap(B)).me.pin);

  // Only catch codes count: a lobby link or junk is ignored.
  expect(await C.evaluate(() => [window.CH.scan.parse('https://example.com/?join=ABC234'), window.CH.scan.parse('ch:abc:12'), window.CH.scan.parse('ch:abcdef:1234')])).toEqual([null, null, { id: 'abcdef', pin: '1234' }]);

  // Hunter: open Confirm catch, tap Scan. No typing.
  await fakeCamera(C, code);
  await C.click('[data-act=catch-open]');
  await C.click('[data-act=scan-open]');
  await expect(C.locator('#scan-video')).toBeVisible();
  await C.waitForSelector('.catch-done', { timeout: 20000 });
  await expect(C.locator('.catch-done')).toContainText('NOMAD is now a hunter');
  await B.waitForSelector('#s-converted:not([hidden])');
  expect((await snap(B)).me.role).toBe('hunter');
  // The camera is released as soon as the code is read.
  expect(await C.evaluate(() => window.__cam.getTracks().every((t) => t.readyState === 'ended'))).toBe(true);
  expect(await C.evaluate(() => window.CH.scan.active())).toBe(false);

  // Scanning a prey who is too far away is refused by the host, like a typed PIN.
  await C.click('[data-act=catch-back]');
  const far = await A.evaluate(() => {
    document.querySelector('[data-act=self-tag]').click();
    return new Promise((resolve) => setTimeout(() => resolve(document.querySelector('.tagged-qr').innerHTML), 300));
  });
  await fakeCamera(C, far);
  await C.click('[data-act=catch-open]');
  await C.click('[data-act=scan-open]');
  await expect(C.locator('.pin-status')).toContainText('Too far away', { timeout: 20000 });
  expect((await snap(A)).me.role).toBe('prey');
  // Closing the scanner by hand also releases the camera.
  await C.click('[data-act=scan-open]');
  await expect(C.locator('#scan-video')).toBeVisible();
  await C.click('[data-act=scan-close]');
  await expect(C.locator('#modal')).toBeHidden();
  expect(await C.evaluate(() => window.CH.scan.active())).toBe(false);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('the bundled QR reader decodes the codes the app draws', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.player('GABRIEL');
  const out = await A.evaluate(async () => {
    const { qrSvg, scanText, parseScan } = await import('./js/ui/scan.js');
    await new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'vendor/jsQR.js';
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
    const text = scanText('k3x9pa', '4821');
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg(text));
    });
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 300, 300);
    ctx.drawImage(img, 30, 30, 240, 240);
    const d = ctx.getImageData(0, 0, 300, 300);
    const hit = window.jsQR(d.data, 300, 300);
    return { text, read: hit && hit.data, parsed: hit && parseScan(hit.data) };
  });
  expect(out.read).toBe(out.text);
  expect(out.parsed).toEqual({ id: 'k3x9pa', pin: '4821' });
});

// ---------------------------------------------------------------- drawn zones
const { config } = require('./helpers');
const corner = (o) => [+o.latitude.toFixed(6), +o.longitude.toFixed(6)];
// Tap the zone editor's map at a real-world point.
async function tapMap(page, o) {
  const pt = await page.evaluate(([lat, lng]) => {
    const m = window.CH.zoneEditor.map;
    const p = m.latLngToContainerPoint([lat, lng]);
    const r = m.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, corner(o));
  await page.mouse.click(pt.x, pt.y);
}

test('zone geometry: inside, outside, nearest edge, crossed shapes', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.player('GABRIEL');
  const out = await A.evaluate(async (pts) => {
    const g = await import('./js/geom.js');
    const poly = pts.rect;
    const at = (p) => ({ lat: p[0], lng: p[1] });
    const near = g.nearestOnPoly(at(pts.east), poly);
    const c = g.polyCentre(poly);
    return {
      area: Math.round(g.polyArea(poly)),
      inside: g.inPoly(at(pts.mid), poly), outside: g.inPoly(at(pts.east), poly),
      nearD: Math.round(near.d),
      centreOff: Math.round(Math.hypot((c.lat - pts.mid[0]) * 111320, (c.lng - pts.mid[1]) * 111320 * Math.cos(c.lat * Math.PI / 180))),
      radius: Math.round(g.polyRadius(c, poly)),
      crossed: g.selfCrossing(pts.bow), simple: g.selfCrossing(poly),
      half: Math.round(g.polyArea(g.scalePoly(poly, c, 0.5))),
      edgeOut: g.zoneEdge({ ...c, r: 180, poly }, at(pts.east)).out,
      edgeIn: Math.round(g.zoneEdge({ ...c, r: 180, poly }, at(pts.mid)).d),
      clean: g.cleanPoly(pts.bow, { maxCorners: 12 }), tooMany: g.cleanPoly(new Array(13).fill(poly[0]), { maxCorners: 12 })
    };
  }, {
    rect: [offset(150, -100), offset(150, 100), offset(-150, 100), offset(-150, -100)].map(corner),
    bow: [offset(150, -100), offset(-150, 100), offset(150, 100), offset(-150, -100)].map(corner),
    mid: corner(offset(0, 0)), east: corner(offset(0, 140))
  });
  expect(out.area).toBeGreaterThan(59000);
  expect(out.area).toBeLessThan(61000);
  expect(out.inside).toBe(true);
  expect(out.outside).toBe(false);
  expect(out.nearD).toBe(40);
  expect(out.centreOff).toBeLessThanOrEqual(1);
  expect(Math.abs(out.radius - 180)).toBeLessThanOrEqual(1);
  expect(out.crossed).toBe(true);
  expect(out.simple).toBe(false);
  expect(Math.abs(out.half - out.area / 4)).toBeLessThan(200);
  expect(out.edgeOut).toBe(true);
  expect(out.edgeIn).toBe(-100);                       // 100 m inside the nearest side
  expect(out.clean).toBeNull();
  expect(out.tooMany).toBeNull();
});

test('drawn zone and no-go area: the host taps them out, everyone sees them, and the rules follow the shape', async ({ game }) => {
  const [A, B, C] = await game.lobby(['GABRIEL', 'NOMAD', 'VIPER'], [offset(0, 0), offset(60, 0), offset(-120, 0)]);
  await config(A, { zone: { noGoTellHostSec: 2 } });

  // Host: Draw shape, four corners (a 300 x 200 m block), then one no-go area inside it.
  await A.click('[data-act=zone-edit]');
  await A.click('[data-act=zone-tool][data-tool=draw]');
  await expect(A.locator('#zone-hint')).toContainText('At least 3');
  for (const o of [offset(150, -100), offset(150, 100), offset(-150, 100), offset(-150, -100)]) await tapMap(A, o);
  await expect(A.locator('#zone-r')).toContainText('6.0 ha');
  await A.click('[data-act=zone-tool][data-tool=nogo]');
  for (const o of [offset(100, -20), offset(130, -20), offset(130, 20), offset(100, 20)]) await tapMap(A, o);
  await expect(A.locator('.zone-count')).toContainText('1 no-go area');
  await A.click('[data-act=zone-done]');

  // Guests get it in the lobby, with a preview.
  await expect.poll(async () => ((await snap(B)).zoneShape || []).length).toBe(4);
  expect((await snap(B)).nogo).toHaveLength(1);
  await expect(B.locator('.zone-text')).toContainText('Drawn shape · 6.0 ha');
  await expect(B.locator('.zone-text')).toContainText('1 no-go area marked');
  await expect(B.locator('.smap-poly')).toHaveCount(1);
  await expect(B.locator('.smap-nogo')).toHaveCount(1);
  await expect(A.locator('[data-rule=zoneRadiusM]')).toContainText('Drawn shape');

  // A shape whose sides cross is refused and changes nothing.
  await A.evaluate((bow) => window.CH.session.send({ k: 'cfg', shape: bow }), [offset(150, -100), offset(-150, 100), offset(150, 100), offset(-150, -100)].map(corner));
  await expect(A.locator('#toasts')).toContainText('cannot be used as a zone');
  expect((await snap(A)).zoneShape).toHaveLength(4);

  // Start: VIPER hunts. The zone shrinks to half between 6 s and 25 s.
  await A.evaluate(() => {
    const h = window.CH.host;
    for (const p of h.all()) h.setLobbyRole(p, p.name === 'VIPER' ? 'hunter' : 'prey');
    Object.assign(h.G.rules, { headStartSec: 2, pingSec: 30, matchSec: 30, zoneShrinkTo: 0.5 });
    h.dirty = true;
  });
  await expect.poll(async () => (await snap(A)).players.filter((p) => p.role === 'hunter').length).toBe(1);
  await A.click('[data-act=start]');
  for (const p of [A, B, C]) { await p.waitForSelector('[data-act=open-map]'); await p.click('[data-act=open-map]'); }
  await live(A);
  const z = (await snap(B)).zone;
  expect(z.poly).toHaveLength(4);
  expect(Math.abs(z.r - 180)).toBeLessThanOrEqual(2);
  await expect.poll(() => B.evaluate(() => window.CH.map.shapes.length)).toBeGreaterThanOrEqual(2);   // the no-go area and its label

  // NOMAD steps 40 m past the east side: inside the bounding circle, outside the shape.
  await B.setGeo(offset(0, 140));
  await expect(B.locator('#oz .oz-top')).toContainText('GET BACK IN');
  await expect(B.locator('.oz-dir')).toContainText('Head west');
  await expect.poll(async () => (await snap(B)).me.out.sinceT).not.toBeNull();
  await B.setGeo(offset(60, 0));
  await expect(B.locator('#oz')).toBeHidden();

  // NOMAD walks into the no-go area: a warning on that phone, and the host is told.
  await B.setGeo(offset(115, 0));
  await expect(B.locator('#banners')).toContainText('You are in a no-go area');
  await expect(A.locator('#toasts')).toContainText('NOMAD has been in a no-go area');
  await B.setGeo(offset(60, 0));
  await expect(B.locator('#banners')).not.toContainText('no-go area');

  // The shape closes in on its centre.
  await expect.poll(async () => (await snap(B)).zone.scale, { timeout: 25000 }).toBeLessThan(0.9);
  const z2 = (await snap(B)).zone;
  expect(z2.r).toBeLessThan(z.r);
  expect(z2.finalPoly).toHaveLength(4);
  await expect(B.locator('#hud-zone')).toContainText('of full size now');
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

// ---------------------------------------------------------------- relay
const { URL: PAGE, ORIGIN: SITE } = require('./helpers');
const relayStats = async () => (await fetch(SITE + '/__relay')).json();
// Join as a phone that cannot open direct links: everything goes through the relay.
async function joinRelayed(game, name, code, geo) {
  const page = await game.player(name, geo, { url: PAGE + '&relayonly=1' });
  await page.fill('#join-code', code);
  await page.click('.join-btn');
  await game.inLobby(page);
  return page;
}

test('relay: a phone that cannot open a direct link plays a whole catch through the relay, and the relay cannot read it', async ({ game }) => {
  const before = await relayStats();
  const A = await game.host('GABRIEL', offset(150, 0));
  const code = (await snap(A)).code;
  const B = await joinRelayed(game, 'NOMAD', code, offset(8, 0));
  const C = await game.join('VIPER', code, offset(0, 0));
  expect(await B.evaluate(() => window.CH.net.state.via)).toBe('relay');
  expect(await C.evaluate(() => window.CH.net.state.via)).toBe('direct');
  await expect(B.locator('#toasts')).toContainText('Connected through the relay');
  await expect.poll(async () => (await snap(A)).players.filter((p) => p.conn).length).toBe(3);
  // The host console shows who is relayed.
  await A.click('.topbar [data-act=admin]');
  await expect(A.locator('.admin-player', { hasText: 'NOMAD' })).toContainText('through the relay');
  await A.click('#s-admin [data-act=layer-close]');

  // Lobby chat crosses the relay both ways.
  await B.click('.lobby-chat');
  await B.fill('#chat-input', 'on mobile data here');
  await B.press('#chat-input', 'Enter');
  await expect.poll(() => C.evaluate(() => window.CH.session.chat.all.map((m) => m.text))).toContain('on mobile data here');
  await B.click('.chat-head [data-act=layer-close]');

  // A match: NOMAD (relayed prey) is pinged, tagged and caught like anyone else.
  await A.evaluate(() => {
    const h = window.CH.host;
    for (const p of h.all()) h.setLobbyRole(p, p.name === 'VIPER' ? 'hunter' : 'prey');
    Object.assign(h.G.rules, { headStartSec: 2, pingSec: 6, matchSec: 600, zoneRadiusM: 400 });
    h.dirty = true;
  });
  await expect.poll(async () => (await snap(B)).players.filter((p) => p.role === 'hunter').length).toBe(1);
  await A.click('[data-act=start]');
  for (const p of [A, B, C]) { await p.waitForSelector('#s-reveal:not([hidden]) [data-act=open-map]', { timeout: 15000 }); await p.click('[data-act=open-map]'); }
  await live(B);
  await expect.poll(async () => (await snap(C)).pings.some((p) => p.name === 'NOMAD'), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => (await snap(C)).targets.find((t) => t.name === 'NOMAD').inRange, { timeout: 20000 }).toBe(true);
  const pin = (await snap(B)).me.pin;
  expect(pin).toMatch(/^\d{4}$/);
  await C.click('[data-act=catch-open]');
  await B.waitForSelector('#s-tagged:not([hidden]) .tagged-pin', { timeout: 15000 });
  await typePin(C, pin);
  await C.waitForSelector('.catch-done');
  await B.waitForSelector('#s-converted:not([hidden])', { timeout: 15000 });
  expect((await snap(B)).me.role).toBe('hunter');

  // The relay carried traffic, and none of it was readable.
  const after = await relayStats();
  expect(after.messages - before.messages).toBeGreaterThan(20);
  expect(after.last).toMatch(/"t":"m"/);
  for (const secret of ['NOMAD', 'snap', pin, 'lat']) expect(after.last).not.toContain(secret);

  // The relay socket drops: the phone notices and gets back in on its own.
  await B.click('[data-act=conv-go]');
  await B.evaluate(() => window.CH.net.relay.sock.ws.close());
  await expect.poll(() => B.evaluate(() => window.CH.net.state.status), { timeout: 30000 }).toBe('online');
  const t = (await snap(B)).T;
  await expect.poll(async () => (await snap(B)).T, { timeout: 30000 }).toBeGreaterThan(t + 2000);
  expect((await snap(B)).me.role).toBe('hunter');
  // Voice is direct-only: a relayed player is told instead of failing silently.
  expect(await B.evaluate(() => window.CH.session.relayed)).toBe(true);
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('iPhone engine: two phones play a match through the relay', { tag: '@webkit' }, async ({ game }) => {
  const A = await game.host('GABRIEL', offset(0, 0));
  const code = (await snap(A)).code;
  const B = await joinRelayed(game, 'VIPER', code, offset(8, 0));
  await expect.poll(async () => (await snap(A)).players.length).toBe(2);
  await A.evaluate(() => {
    const h = window.CH.host;
    for (const p of h.all()) h.setLobbyRole(p, p.name === 'VIPER' ? 'hunter' : 'prey');
    Object.assign(h.G.rules, { headStartSec: 2, pingSec: 6, matchSec: 600, zoneRadiusM: 400 });
    h.dirty = true;
  });
  await expect.poll(async () => (await snap(B)).me.role).toBe('hunter');
  await A.click('[data-act=start]');
  for (const p of [A, B]) { await p.waitForSelector('#s-reveal:not([hidden]) [data-act=open-map]', { timeout: 15000 }); await p.click('[data-act=open-map]'); }
  await live(B);
  await expect.poll(async () => ((await snap(B)).targets || []).some((t) => t.inRange), { timeout: 25000 }).toBe(true);
  await B.click('[data-act=catch-open]');
  await A.waitForSelector('#s-tagged:not([hidden]) .tagged-pin', { timeout: 15000 });
  await typePin(B, (await snap(A)).me.pin);
  await B.waitForSelector('#s-results:not([hidden]) .res-head', { timeout: 20000 });
  await A.waitForSelector('#s-results:not([hidden]) .res-head', { timeout: 20000 });
  expect((await snap(A)).result.winner).toBe('hunters');
  expect(A.errors.concat(B.errors)).toEqual([]);
});

// ---------------------------------------------------------------- host handover
const { gameT } = require('./helpers');

test('host handover: the host vanishes, the deputy carries the match on, and the old host comes back as a player', async ({ game }) => {
  test.slow();
  // GABRIEL hosts (prey, far away). NOMAD (prey) joined first, so is the deputy. VIPER hunts, 8 m from NOMAD.
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 2, pingSec: 6, matchSec: 600, zoneRadiusM: 400 }, [offset(150, 0), offset(8, 0), offset(0, 0)]);
  await live(C);
  for (const p of [B, C]) await config(p, { net: { handoverAfterSec: 5 } });
  await expect.poll(async () => ((await snap(C)).deputy || {}).name).toBe('NOMAD');
  await expect.poll(() => B.evaluate(() => window.CH.session.backup && window.CH.session.backup.G.phase)).toBe('live');

  // The deputy's backup holds nothing a player may not see.
  const kept = await B.evaluate(() => Object.values(window.CH.session.backup.G.players).map((p) => ({ pin: p.pin, pos: p.pos, ping: p.ping, path: p.path.length, role: p.role, gc: p.gc })));
  expect(kept.every((p) => p.pin === null && p.pos === null && p.ping === null && p.path === 0)).toBe(true);
  expect(kept.map((p) => p.role).sort()).toEqual(['hunter', 'prey', 'prey']);
  const oldPin = (await snap(B)).me.pin;
  const T0 = await gameT(C);

  // The host's phone is gone.
  await A.goto('about:blank');
  await C.waitForSelector('#net:not([hidden]) #net-title', { timeout: 30000 });
  await expect(C.locator('.net-facts')).toContainText('NOMAD takes over as host', { timeout: 20000 });

  // The deputy becomes the host; the third phone finds it without doing anything.
  await expect.poll(() => B.evaluate(() => !!window.CH.host), { timeout: 60000 }).toBe(true);
  await expect(B.locator('#toasts')).toContainText('now hosting');
  await expect(C.locator('#net')).toBeHidden({ timeout: 60000 });
  await expect.poll(async () => ((await snap(C)).players.find((p) => p.host) || {}).name, { timeout: 30000 }).toBe('NOMAD');
  await expect(C.locator('#toasts')).toContainText('NOMAD is now the host');
  const sc = await snap(C);
  expect(sc.phase).toBe('live');
  expect(sc.me.role).toBe('hunter');
  expect(sc.players.find((p) => p.name === 'GABRIEL').conn).toBe(false);     // the old host's spot is held like anyone's
  expect(await gameT(C)).toBeGreaterThan(T0 - 6000);                         // the clock carried on, it did not restart
  expect((await snap(B)).me.host).toBe(true);
  expect((await snap(B)).me.role).toBe('prey');

  // Prey got fresh PINs, and the match is fully playable: VIPER catches NOMAD (the new host).
  const newPin = (await snap(B)).me.pin;
  expect(newPin).toMatch(/^\d{4}$/);
  await expect.poll(async () => ((await snap(C)).targets || []).some((t) => t.name === 'NOMAD' && t.inRange), { timeout: 30000 }).toBe(true);
  await C.click('[data-act=catch-open]');
  // (GABRIEL, offline with no known position, is listed too: for them the PIN alone decides.)
  await C.locator('.target', { hasText: 'NOMAD' }).click();
  await expect(C.locator('.target.sel .target-name')).toHaveText('NOMAD');
  await typePin(C, newPin);
  await C.waitForSelector('.catch-done');
  await B.waitForSelector('#s-converted:not([hidden])');
  await B.click('[data-act=conv-go]');
  expect((await snap(B)).phase).toBe('live');                                // GABRIEL is still free, so the hunt goes on

  // The old host's phone comes back: it finds its lobby taken over and rejoins as a player.
  await A.goto(PAGE);
  await A.waitForSelector('#s-game:not([hidden]) #hud', { timeout: 90000 });
  await expect.poll(async () => { const s = await snap(A); return s && s.me.host === false && s.phase; }, { timeout: 60000 }).toBe('live');
  expect(await A.evaluate(() => !!window.CH.host)).toBe(false);
  expect((await snap(A)).me.role).toBe('prey');
  await expect.poll(async () => (await snap(B)).players.find((p) => p.name === 'GABRIEL').conn, { timeout: 30000 }).toBe(true);
  expect(oldPin).toMatch(/^\d{4}$/);
  expect(B.errors.concat(C.errors)).toEqual([]);
});

// ---------------------------------------------------------------- problem reports
const REPORTS_PAGE = PAGE.replace('reports=off', 'reports=127.0.0.1:8080/__reports');
const sentBy = async (page) => {
  const device = await page.evaluate(() => JSON.parse(localStorage.getItem('ch2.device')));
  return (await (await fetch(SITE + '/__reports')).json()).filter((r) => r.device === device);
};

test('problem reports: sent by hand, or automatically only after the player agrees', { tag: '@webkit' }, async ({ game }) => {
  // By hand, from the report window.
  const A = await game.player('SOLO', undefined, { url: REPORTS_PAGE });
  await A.click('#s-home [data-act=report]');
  await A.click('[data-act=report-send]');
  await expect(A.locator('#toasts')).toContainText('Report sent');
  let rows = await sentBy(A);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reason: 'manual', lobby: null });
  expect(rows[0].app_version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(rows[0].body).toContain('CITY HUNTER PROBLEM REPORT');
  expect(rows[0].body).not.toContain('51.50');                    // no coordinates
  expect(rows[0].key).toMatch(/^sb_publishable_/);                // only the public key ever leaves the phone
  await expect(A.locator('[data-act=reports-toggle]')).toHaveAttribute('aria-checked', 'false');
  await A.click('#modal [data-act=modal-close]');

  // Something goes wrong (a failed join). Nothing is sent; the player is asked first.
  await A.fill('#join-code', 'ZZZZZZ');
  await A.click('.join-btn');
  await expect(A.locator('#modal')).toContainText('Send problem reports?', { timeout: 30000 });
  expect(await sentBy(A)).toHaveLength(1);
  await A.click('[data-act=reports-no]');
  expect(await A.evaluate(() => window.CH.reports.consent())).toBe('off');
  // Declined: the next failure neither asks again nor sends.
  await A.click('.join-btn');
  await expect(A.locator('#toasts')).toContainText('No lobby with code', { timeout: 30000 });
  await sleep(1500);
  await expect(A.locator('#modal')).toBeHidden();
  expect(await sentBy(A)).toHaveLength(1);

  // Another phone says yes: that failure is reported, once.
  const B = await game.player('OTHER', undefined, { url: REPORTS_PAGE });
  await B.fill('#join-code', 'ZZZZZZ');
  await B.click('.join-btn');
  await expect(B.locator('#modal')).toContainText('Send problem reports?', { timeout: 30000 });
  await B.click('[data-act=reports-yes]');
  await expect.poll(async () => (await sentBy(B)).map((r) => r.reason)).toEqual(['join-failed']);
  await B.click('.join-btn');
  await expect(B.locator('#toasts')).toContainText('No lobby with code', { timeout: 30000 });
  await sleep(1500);
  expect(await sentBy(B)).toHaveLength(1);                        // the same problem is not sent twice in one visit
  // The switch in the report window turns it off again.
  await B.click('#s-home [data-act=report]');
  await expect(B.locator('[data-act=reports-toggle]')).toHaveAttribute('aria-checked', 'true');
  await B.click('[data-act=reports-toggle]');
  await expect(B.locator('[data-act=reports-toggle]')).toHaveAttribute('aria-checked', 'false');
  expect(A.errors.concat(B.errors)).toEqual([]);
});
