import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  
  // ★変更点: ワーカー数を1に制限して、DB負荷や競合を避ける
  workers: 1, 
  
  reporter: 'html',
  timeout: 60 * 1000,

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 15 * 1000,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});