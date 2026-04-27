import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the prod multi-persona walkthrough.
 *
 * baseURL points at the deployed SPA. Override via PROD_WEB_URL for
 * staging or branch-deploy probes.
 *
 * Trace + video on retry, screenshot on failure: design-partner demo
 * artifacts come from explicit `page.screenshot()` calls inside the
 * test (saved under apps/web-e2e/screenshots/<run>/), not from
 * Playwright's automatic on-failure capture — those serve different
 * purposes and we keep both.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.PROD_WEB_URL || 'https://erplaunch-web.vercel.app',
    headless: true,
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
