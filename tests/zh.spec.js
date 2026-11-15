// Chinese: switch language, play through the main screens, and fail on any
// English text left on screen.
const { test, expect, offset, snap, sleep, typePin, live } = require('./helpers');

const NAMES = ['GABRIEL', 'NOMAD', 'VIPER', 'WATCHER'];
// Words that are meant to stay as they are.
const KEEP = /\b(GPS|PIN|GC|MVP|QR|City Hunter|CITY|HUNTER|Leaflet|OpenStreetMap|contributors|English|iPhone|Android|Safari|Google Fonts|Supabase)\b/g;

// Every piece of visible text (and label) that still contains English.
const leftovers = (page, names) => page.evaluate(({ names, keep }) => {
  const keepRe = new RegExp(keep, 'g');
  const clean = (t) => {
    let s = t;
    for (const n of names) s = s.split(n).join('');
    return s.replace(/[A-Z0-9]{3}\u00B7[A-Z0-9]{3}/g, '').replace(keepRe, '');   // lobby codes are random letters
  };
  const skip = '[translate="no"], .leaflet-control-attribution, .smap-attr, textarea, script, style, noscript, [hidden]';
  const out = new Set();
  const it = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest(skip)) continue;
    if (/[A-Za-z]{2,}/.test(clean(n.nodeValue))) out.add(n.nodeValue.trim());
  }
  for (const el of document.querySelectorAll('#app [aria-label], #app [placeholder]')) {
    if (el.closest(skip)) continue;
    for (const a of ['aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && /[A-Za-z]{2,}/.test(clean(v))) out.add(a + '=' + v);
    }
  }
  return Array.from(out);
}, { names, keep: KEEP.source });

async function toChinese(page) {
  await page.click('[data-act=lang]');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
}

test('Chinese: Home, lobby, zone picker, safety and QR are fully translated', async ({ game }) => {
  const A = await game.player('GABRIEL');
  await toChinese(A);
  await expect(A.locator('[data-act=host]')).toContainText('创建追捕');
  await expect(A.locator('.home-title')).toHaveText('CITY HUNTER');           // the wordmark stays
  expect(await leftovers(A, NAMES)).toEqual([]);

  // How to play (all four screens) and the privacy note.
  await A.click('[data-act=howto]');
  for (let i = 0; i < 4; i++) {
    expect(await leftovers(A, NAMES), 'how to play ' + (i + 1)).toEqual([]);
    await A.click('[data-act=how-next]');
  }
  await A.click('[data-act=privacy]');
  await expect(A.locator('#modal h2')).toHaveText('隐私');
  expect(await leftovers(A, NAMES), 'privacy').toEqual([]);
  await A.click('#modal [data-act=modal-close]');

  await A.click('[data-act=host]');
  await A.waitForSelector('#modal:not([hidden]) .safety-list');
  expect(await leftovers(A, NAMES)).toEqual([]);
  await A.click('[data-act=safety-ok]');
  await expect(A.locator('#s-lobby .topbar h1')).toHaveText('房间');
  const code = (await snap(A)).code;
  const B = await game.join('NOMAD', code, offset(30, 0));                    // stays in English
  await expect(A.locator('.block-head .label')).toContainText('玩家 · 2');
  expect(await leftovers(A, NAMES)).toEqual([]);

  await A.click('[data-act=qr]');
  expect(await leftovers(A, NAMES)).toEqual([]);
  await A.click('[data-act=modal-close]');
  await A.click('[data-act=rule][data-rule=zoneShrinkTo]');
  expect(await leftovers(A, NAMES)).toEqual([]);
  await A.click('[data-act=modal-close]');
  await A.click('[data-act=zone-edit]');
  await A.waitForSelector('#s-zone:not([hidden]) #zone-map.leaflet-container');
  expect(await leftovers(A, NAMES)).toEqual([]);
  // The other two tools: draw a shape, mark no-go areas.
  const tap = async (dx, dy) => { const b = await A.locator('#zone-map').boundingBox(); await A.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy); };
  await A.click('[data-act=zone-tool][data-tool=draw]');
  expect(await leftovers(A, NAMES), 'zone: draw, empty').toEqual([]);
  await tap(-60, -80); await tap(70, -70); await tap(60, 80); await tap(-70, 60);
  expect(await leftovers(A, NAMES), 'zone: draw, four corners').toEqual([]);
  await A.click('[data-act=zone-tool][data-tool=nogo]');
  expect(await leftovers(A, NAMES), 'zone: no-go, empty').toEqual([]);
  await tap(-10, -10); await tap(10, -10);
  expect(await leftovers(A, NAMES), 'zone: no-go, two corners').toEqual([]);
  await tap(10, 10);
  expect(await leftovers(A, NAMES), 'zone: no-go, one area').toEqual([]);
  await A.click('[data-act=zone-done]');
  await expect(A.locator('.zone-text')).toContainText('自定义形状');
  expect(await leftovers(A, NAMES), 'lobby with a drawn zone').toEqual([]);
  await A.click('[data-act=zone-reset]');
  await A.click('.topbar [data-act=admin]');
  expect(await leftovers(A, NAMES)).toEqual([]);
  await A.click('#s-admin [data-act=report]');
  expect(await leftovers(A, NAMES)).toEqual([]);
  // The other player's page is untouched.
  await expect(B.locator('#s-lobby .topbar h1')).toHaveText('LOBBY');

  // Switching back restores English everywhere.
  await A.click('[data-act=modal-close]');
  await A.evaluate(() => window.CH.i18n.set('en'));
  await expect(A.locator('#s-admin .topbar h1')).toHaveText('HOST CONSOLE');
  await A.reload();
});

test('Chinese: a whole match (map, shop, chat, catch, results) has no English left', async ({ game }) => {
  const [A, B, C] = await game.match(['GABRIEL', 'NOMAD', 'VIPER'], ['VIPER'], { headStartSec: 6, pingSec: 6, matchSec: 600, zoneRadiusM: 300, zoneShrinkTo: 0.4 },
    [offset(120, 0), offset(8, 0), offset(0, 0)], { stayOnReveal: true });
  for (const p of [A, B, C]) await p.evaluate(() => window.CH.i18n.set('zh'));
  const check = async (page, where) => expect(await leftovers(page, NAMES), where).toEqual([]);

  await check(A, 'prey reveal');
  await check(C, 'hunter reveal');
  await A.click('[data-act=pin-toggle]');
  for (const p of [A, B, C]) await p.click('[data-act=open-map]');
  await check(C, 'hunter map, head start');
  await live(C);
  await expect.poll(async () => (await snap(C)).pings.length).toBe(2);
  await sleep(1200);
  await check(A, 'prey map');
  await check(C, 'hunter map');
  await expect(A.locator('#hud .chip')).toHaveText('猎物');

  // Map menu, its switches, and the leave confirmations (host and guest).
  await A.click('#map-btns [data-act=menu]');
  await check(A, 'menu (host)');
  await expect(A.locator('#modal h2')).toHaveText('菜单');
  await A.click('#modal [data-act=saver]');
  await check(A, 'menu, saver on');
  await A.click('#modal [data-act=saver]');
  await A.click('#modal [data-act=menu-leave]');
  await check(A, 'host leave confirm');
  await A.click('#modal [data-act=modal-close]');
  await B.click('#map-btns [data-act=menu]');
  await B.click('#modal [data-act=menu-leave]');
  await check(B, 'guest leave confirm');
  await B.click('#modal [data-act=modal-close]');
  await A.click('[data-act=sheet-toggle]');
  await check(A, 'prey map, panel folded');
  await A.click('[data-act=sheet-toggle]');
  await sleep(3000);                                    // let the battery-saver toasts go
  await expect(C.locator('.catch-btn .head')).toHaveText('抓捕');

  // Shop, both tabs.
  await A.evaluate(() => { for (const p of window.CH.host.all()) p.gc = 600; window.CH.host.dirty = true; });
  await A.click('[data-act=shop]');
  await check(A, 'shop, prey tab');
  await A.click('[data-act=shop-tab][data-tab=hunter]');
  await check(A, 'shop, hunter tab');
  await A.click('[data-act=buy][data-id=scan]');
  await A.click('[data-act=shop-tab][data-tab=prey]');
  await A.click('[data-act=buy][data-id=ghost]');
  await A.click('[data-act=buy][data-id=jammer]');
  await A.click('.shop-back');
  await A.click('[data-act=use][data-id=ghost]');
  await A.click('[data-act=use][data-id=jammer]');
  await sleep(1200);
  await check(A, 'prey map with active abilities');

  // Chat: the message itself is never translated.
  await A.click('#sheet [data-act=chat]');
  await A.fill('#chat-input', 'Ready at the gate');
  await A.press('#chat-input', 'Enter');
  await expect(A.locator('.msg-text')).toHaveText('Ready at the gate');
  await check(A, 'chat');
  await A.click('.chat-head [data-act=layer-close]');

  // Help request banners.
  await B.click('#map-btns [data-act=help]');
  await check(B, 'help confirm');
  await B.click('[data-act=modal-yes]');
  await expect(C.locator('#banners')).toContainText('需要帮助');
  await sleep(600);
  await check(C, 'help banner');
  await check(B, 'help requested');
  await B.click('[data-act=help-ok]');
  await sleep(4500);                                    // let the toasts go

  // Catch flow.
  await C.click('[data-act=catch-open]');
  await sleep(800);
  await check(C, 'confirm catch');
  await C.click('[data-act=scan-open]');
  await sleep(1200);
  await check(C, 'scanner');
  await C.click('[data-act=scan-close]');
  await B.waitForSelector('#s-tagged:not([hidden]) .tagged-pin');
  await check(B, 'tagged');
  await typePin(C, (await snap(B)).me.pin === '0000' ? '1111' : '0000');
  await expect(C.locator('.pin-status')).toContainText('PIN 错误');
  await check(C, 'wrong PIN');
  await typePin(C, (await snap(B)).me.pin);
  await C.waitForSelector('.catch-done');
  await check(C, 'caught');
  await B.waitForSelector('#s-converted:not([hidden])');
  await check(B, 'converted');
  await B.click('[data-act=conv-go]');
  await C.click('[data-act=catch-back]');
  await sleep(800);
  await check(B, 'converted banner');
  await sleep(4000);

  // Out of zone and GPS lost.
  await A.setGeo(offset(520, 0));                      // 400 m from the zone centre (the host's start point)
  await A.waitForSelector('#oz:not([hidden]) .oz-top');
  await sleep(700);
  await check(A, 'out of zone');
  await A.setGeo(offset(120, 0));
  await expect(A.locator('#oz')).toBeHidden();
  await A.evaluate(() => { window.CH.geo.blocked = true; });
  await A.waitForSelector('#gps-sheet:not([hidden]) #gps-title', { timeout: 25000 });
  await check(A, 'GPS lost');
  await A.click('[data-act=gps-settings]');
  await check(A, 'location help');
  await A.click('[data-act=modal-close]');
  await A.evaluate(() => { window.CH.geo.blocked = false; });
  await expect(A.locator('#gps-sheet')).toBeHidden();

  // Console, then end the match and check results.
  await A.click('#map-btns [data-act=admin]');
  await sleep(600);
  await check(A, 'host console');
  await A.click('[data-act=adm-end]');
  await check(A, 'end confirm');
  await A.click('[data-act=modal-yes]');
  await C.waitForSelector('#s-results:not([hidden]) .res-head');
  await sleep(1500);
  await check(C, 'results (hunter)');
  await check(A, 'results (host)');
  await expect(A.locator('.awards .award').first()).toBeVisible();
  await check(A, 'results with awards');
  await A.click('[data-act=res-home]');
  await check(A, 'host home confirm');
  await A.click('#modal [data-act=modal-yes]');
  // Home again: past matches, then a new lobby that offers the last setup.
  await A.waitForSelector('#s-home:not([hidden])');
  await A.click('#home-history');
  await expect(A.locator('.past-list .past')).toHaveCount(1);
  await check(A, 'past matches');
  await A.click('[data-act=history-clear]');
  await check(A, 'clear history confirm');
  await A.click('#modal [data-act=modal-close]');
  await A.evaluate(() => { const v = JSON.parse(localStorage.getItem('ch2.setup')); v.mode = 'SKIRMISH'; localStorage.setItem('ch2.setup', JSON.stringify(v)); });
  await A.click('[data-act=host]');
  await A.waitForSelector('#modal:not([hidden]) [data-act=safety-ok]');
  await A.click('[data-act=safety-ok]');
  await expect(A.locator('.setup-use')).toBeVisible();
  await check(A, 'lobby with last setup');
  // The update bar.
  await A.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: '{"version":"9.9.9"}' }));
  await A.evaluate(() => window.CH.update.check());
  await expect(A.locator('#update-bar')).toBeVisible();
  await check(A, 'update bar');
  await expect(C.locator('.res-head h1')).toHaveText('没有赢家');
  expect(A.errors.concat(B.errors, C.errors)).toEqual([]);
});

test('Chinese is picked automatically on a Chinese-language phone, and the choice is remembered', { tag: '@webkit' }, async ({ game }) => {
  const ctx = await game.browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  game.contexts.push(ctx);
  await ctx.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8080/index.html?ps=127.0.0.1:9000&relay=off');
  await expect(page.locator('[data-act=host]')).toContainText('创建追捕');
  await page.click('[data-act=lang]');                       // switch to English
  await expect(page.locator('[data-act=host]')).toContainText('HOST A HUNT');
  await page.reload();
  await expect(page.locator('[data-act=host]')).toContainText('HOST A HUNT');
});
