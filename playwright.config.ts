import { defineConfig, devices } from '@playwright/test';
import { assertLocalSupabaseEnvironment } from './scripts/e2e/local-environment.mjs';
import { e2eAppOrigin } from './scripts/e2e/rewrites.mjs';

if (process.env.E2E_TEST_ENV !== 'true') {
  throw new Error('Playwright E2E tests must run through the local Supabase test runner.');
}
assertLocalSupabaseEnvironment(process.env);

if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('The isolated local Supabase test runner must provide API keys for E2E tests.');
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.GITHUB_ACTIONS ? 1 : 0,
  workers: 1,
  reporter: process.env.GITHUB_ACTIONS
    ? [['line'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : 'html',
  timeout: 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },

  use: {
    baseURL: e2eAppOrigin,
    actionTimeout: 15 * 1000,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1',
    url: e2eAppOrigin,
    // An existing app may point at a hosted database, even when this runner is local.
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
