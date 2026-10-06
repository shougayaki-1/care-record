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
      // onUnhandledError runs on the main thread after the error is
      // serialized back from the worker, so `instanceof ReferenceError`
      // does not reliably hold — match on name/message/stack instead.
      if (
        error.name === 'ReferenceError'
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
          // 通知の jsdom テストを含む DOM suite の CPU 競合を避ける。
          // timeout・isolation・アサーションは維持して順番に検証する。
          maxWorkers: 1,
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
        // 新しいシフトstoryの初回読込中に依存再最適化でテストを再読込しない。
        optimizeDeps: { include: ['@mui/icons-material/Add', '@mui/icons-material/Delete', '@mui/icons-material/EditNote'] },
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
