const fs = require('fs');
const path = require('path');
const { test, expect, ORIGIN, sleep } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');

test('manifest and icons are valid', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./');
  expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect(fs.existsSync(path.join(ROOT, i.src))).toBe(true);
});

test('service worker precache list matches the files in the repo', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/'((?:js|css|vendor|icons)\/[^']+|index\.html|manifest\.webmanifest)'/g)].map((m) => m[1]);
  for (const f of listed) expect(fs.existsSync(path.join(ROOT, f)), f + ' is precached but missing').toBe(true);
  // Every game script and stylesheet must be in the list, or the app breaks offline.
  const need = [];
  for (const dir of ['js', 'js/ui', 'js/lang', 'css']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (/\.(js|css)$/.test(f)) need.push(dir + '/' + f);
  }
  for (const f of need) expect(listed, f + ' is not precached').toContain(f);
});

test('installed app shell loads with no network', async ({ game }) => {
  const ctx = await game.context(undefined, { serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  await sleep(1500);                                   // let the precache finish
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator('.home-title')).toContainText('CITY');
  await expect(page.locator('[data-act=host]')).toBeVisible();
  expect(await page.evaluate(() => typeof window.CH)).toBe('object');
  // A join link also opens offline (query strings share the cached page).
  await page.goto(ORIGIN + '/index.html?join=ABC234');
  expect(await page.inputValue('#join-code')).toBe('ABC234');
});
