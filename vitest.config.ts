import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    alias: {
      '@': path.join(dirname, 'src'),
      'server-only': path.join(dirname, 'src/test/server-only.ts'),
    },
    // 一部のテストは並行して走る非同期処理の完了を待たずに終了する。React の
    // スケジューラがその後始末をjsdom破棄後に実行し window を参照して落ちる、
    // タイミング依存の既知の空振りエラーのみを対象を絞ってフィルタする
    // (テストのアサーション自体は全て成功している)。
    onUnhandledError(error) {
      if (
        error instanceof ReferenceError
        && error.message === 'window is not defined'
        && /react-dom|scheduler/.test(String(error.stack))
      ) {
        return false;
      }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
