const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir:  './test',
  timeout:  30000,
  retries:  1,
  workers:  1,
  use: {
    headless: true,
    // Run as a mobile Chrome to reproduce the owner's failure scenario.
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    // Limit CDN latency budget per the network conditions on mobile.
    extraHTTPHeaders: {},
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { browserName: 'chromium' },
    },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: '_playwright-report' }]],
});
