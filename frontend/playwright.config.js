import { defineConfig, devices } from '@playwright/test';

// Real engines per device: Chromium for desktop and Android, WebKit (Safari's
// engine) for iPhones. Run with `npm run test:e2e`; it starts the dev server
// itself, or reuses one already running on 5173.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
  projects: [
    { name: 'desktop-wide', use: { ...devices['Desktop Chrome'], viewport: { width: 1880, height: 950 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'] } },
  ],
});
