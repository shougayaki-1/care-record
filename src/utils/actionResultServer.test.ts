import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError, requireActionResult, UserFacingError, withActionResult } from './errors';

vi.mock('./log', () => ({ logError: vi.fn(), serializeError: (error: unknown) => error }));
afterEach(() => vi.clearAllMocks());

describe('strict result conversion', () => {
  it('returns the explicitly classified application error as plain data', async () => {
    await expect(withActionResult('read', async () => {
      throw new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません');
    })).resolves.toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'この操作を行う権限がありません' } });
  });

  it.each([
    new Error('private_column が見つかりません'),
    new Error('内部の権限 SQL'),
    new UserFacingError('unclassified private detail'),
    { message: '内部の権限 SQL' },
  ])('logs unclassified details and never uses partial message matching: %s', async error => {
    const { logError } = await import('./log');
    const result = await withActionResult('read', async () => { throw error; });
    expect(result).toEqual({ ok: false, error: {
      code: 'UNEXPECTED_ERROR', message: '処理に失敗しました。時間をおいて再度お試しください。',
    } });
    expect(logError).toHaveBeenCalledWith('[action:read]', expect.objectContaining({ error }));
  });

  it('preserves the classification through a nested server call without double envelopes', async () => {
    const inner = () => withActionResult('inner', async () => {
      throw new ExpectedActionError('NOT_FOUND', '対象が見つかりません');
    });
    await expect(withActionResult('outer', () => requireActionResult(inner()))).resolves.toEqual({
      ok: false, error: { code: 'NOT_FOUND', message: '対象が見つかりません' },
    });
    await expect(withActionResult('outer', () => requireActionResult(Promise.resolve({ ok: true, data: [] })))).resolves.toEqual({ ok: true, data: [] });
  });

  it('round-trips classified states and generic failures through production Flight', async () => {
    const values = await Promise.all([
      withActionResult('empty', async () => []),
      withActionResult('forbidden', async () => { throw new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません'); }),
      withActionResult('db', async () => { throw new Error('private_column 権限 detail'); }),
    ]);
    const decoded = execFileSync(process.execPath, ['--conditions=react-server', '-e', `
      const fs = require('node:fs');
      const { renderToReadableStream } = require('next/dist/compiled/react-server-dom-webpack/server.node');
      const { createFromReadableStream } = require('next/dist/compiled/react-server-dom-webpack/client.node');
      (async () => {
        const value = JSON.parse(fs.readFileSync(0, 'utf8'));
        const stream = await renderToReadableStream({ a: Promise.resolve(value) }, {});
        const payload = await createFromReadableStream(stream, {
          serverConsumerManifest: { moduleMap: {}, serverModuleMap: {}, moduleLoading: null }
        });
        process.stdout.write(JSON.stringify(await payload.a));
      })().catch(() => process.exit(1));
    `], { input: JSON.stringify(values), encoding: 'utf8', env: { NODE_ENV: 'production' }, timeout: 10000 });
    expect(JSON.parse(decoded)).toEqual(values);
    expect(decoded).not.toContain('private_column');
  });
});
