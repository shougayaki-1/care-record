import { defineConfig, devices } from '@playwright/test';

if (process.env.E2E_TEST_ENV !== 'true') {
  throw new Error('Playwrightは専用テスト環境でのみ実行できます。E2E_TEST_ENV=true とテスト用Supabase環境変数を設定してください。');
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  
  // ★変更点: ワーカー数を1に制限して、DB負荷や競合を避ける
  workers: 1, 
  
  reporter: 'html',
  timeout: 60 * 1000,

  // CI（リモートSupabase）ではデフォルト5秒のexpectタイムアウトが不足しがち
  expect: {
    timeout: 15 * 1000,
  },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
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
});
