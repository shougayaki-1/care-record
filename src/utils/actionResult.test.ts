import { describe, expect, it } from 'vitest';
import { ActionResultError, getActionErrorMessage, needsActionRecovery, readActionResult } from './actionResult';

describe('public action results in the client', () => {
  it('keeps successful empty data distinct from a failure', async () => {
    await expect(readActionResult(Promise.resolve({ ok: true, data: [] }))).resolves.toEqual([]);
    await expect(readActionResult(Promise.resolve({ ok: false, error: {
      code: 'FORBIDDEN', message: 'この操作を行う権限がありません',
    } }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not display transport errors or arbitrary exception messages', async () => {
    let error: unknown;
    try { await readActionResult(Promise.reject(new Error('private schema 権限 detail'))); }
    catch (caught) { error = caught; }
    expect(getActionErrorMessage(error)).not.toContain('private schema');
    expect(getActionErrorMessage(new Error('private detail'), '取得できませんでした')).toBe('取得できませんでした');
  });

  it.each(['UNAUTHENTICATED', 'SESSION_EXPIRED', 'FORBIDDEN', 'UNEXPECTED_ERROR'])(
    'offers session recovery only for an authentication state: %s', code => {
      expect(needsActionRecovery(new ActionResultError(code, '公開文言')))
        .toBe(code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED');
    },
  );
});
