const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 150000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'off' },
  // chromium: every test. webkit: the engine behind every iPhone browser;
  // it runs the tests tagged @webkit (see README, "Tests").
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns']
        }
      }
    },
    { name: 'webkit', grep: process.env.WEBKIT_ALL ? undefined : /@webkit/, use: { browserName: 'webkit' } }
  ],
  webServer: {
    command: 'node servers.js',
    url: 'http://127.0.0.1:8080/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
