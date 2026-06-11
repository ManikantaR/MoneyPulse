import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — runs against a LOCAL dev server (never the NAS).
 * `pnpm e2e` boots the web app via `webServer` and runs the specs in apps/web/e2e.
 *
 * Testing posture: Vitest = unit gate; Playwright (here) = E2E gate against local dev.
 * Do NOT point this at moneypulse.home.lab / the NAS — keep it deterministic.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @moneypulse/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
