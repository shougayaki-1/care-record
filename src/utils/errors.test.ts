import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeError } from './log';
import { getSafeExternalErrorDetails, logExternalError, sanitizeDbError, UserFacingError, withSafeError } from './errors';

vi.mock('./log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./log')>();
  return { ...actual, logError: vi.fn() };
});

const GENERIC_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeDbError', () => {
  it('logs the original error with context and returns only the generic message', async () => {
    const { logError } = await import('./log');
    const originalError = new Error('relation private_table does not exist');

    const result = sanitizeDbError(originalError, 'loadPrivateData');

    expect(result).toEqual(new Error(GENERIC_MESSAGE));
    expect(logError).toHaveBeenCalledWith('[db:loadPrivateData]', { organizationId: undefined, error: serializeError(originalError) });
  });

  it('attaches organizationId when provided', async () => {
    const { logError } = await import('./log');
    const originalError = new Error('relation private_table does not exist');

    sanitizeDbError(originalError, 'loadPrivateData', { organizationId: 'org-1' });

    expect(logError).toHaveBeenCalledWith('[db:loadPrivateData]', { organizationId: 'org-1', error: serializeError(originalError) });
  });
});

describe('withSafeError', () => {
  it('returns a successful result unchanged', async () => {
    await expect(withSafeError('success', async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('passes UserFacingError through unchanged', async () => {
    const error = new UserFacingError('操作を完了できませんでした');

    await expect(withSafeError('userFacing', async () => {
      throw error;
    })).rejects.toBe(error);
  });

  it.each([
    '認証が必要です',
    'この操作を行う権限がありません',
    '利用者へのアクセス権がありません',
    '入力内容が不正です',
    '対象が見つかりません',
    '氏名を入力してください',
    '100文字以内で入力してください',
  ])('passes a safe existing message through: %s', async (message) => {
    const error = new Error(message);

    await expect(withSafeError('safeMessage', async () => {
      throw error;
    })).rejects.toBe(error);
  });

  it('hides an unexpected Error and logs the original value', async () => {
    const { logError } = await import('./log');
    const originalError = new Error('password authentication failed for database');

    await expect(withSafeError('unexpected', async () => {
      throw originalError;
    })).rejects.toThrow(GENERIC_MESSAGE);
    expect(logError).toHaveBeenCalledWith('[action:unexpected]', { organizationId: undefined, error: serializeError(originalError) });
  });

  it('hides a non-Error throw and logs the original value', async () => {
    const { logError } = await import('./log');
    const originalError = { database: 'secret detail' };

    await expect(withSafeError('nonError', async () => {
      throw originalError;
    })).rejects.toThrow(GENERIC_MESSAGE);
    expect(logError).toHaveBeenCalledWith('[action:nonError]', { organizationId: undefined, error: serializeError(originalError) });
  });

  it('attaches organizationId when provided', async () => {
    const { logError } = await import('./log');
    const originalError = new Error('password authentication failed for database');

    await expect(withSafeError('unexpected', async () => {
      throw originalError;
    }, { organizationId: 'org-1' })).rejects.toThrow(GENERIC_MESSAGE);
    expect(logError).toHaveBeenCalledWith('[action:unexpected]', { organizationId: 'org-1', error: serializeError(originalError) });
  });
});

describe('external error logging', () => {
  it('keeps safe scalars and excludes request headers and tokens', () => {
    const error = Object.assign(new Error('Request failed with status 401 Bearer message-secret?access_token=query-secret'), {
      code: 'AUTH_FAILED',
      response: { status: 401, data: { access_token: 'response-secret' } },
      config: { headers: { Authorization: 'Bearer header-secret' } },
    });

    expect(getSafeExternalErrorDetails(error)).toEqual({
      name: 'Error', message: 'Request failed with status 401 Bearer [REDACTED]?access_token=[REDACTED]', code: 'AUTH_FAILED', status: 401,
    });
    expect(JSON.stringify(getSafeExternalErrorDetails(error))).not.toContain('secret');
  });

  it('logs only the sanitized projection', async () => {
    const { logError } = await import('./log');
    const error = Object.assign(new Error('failure'), { config: { headers: { Authorization: 'Bearer secret' } } });
    logExternalError('calendar', error);
    expect(logError).toHaveBeenCalledWith('[external:calendar]', { organizationId: undefined, name: 'Error', message: 'failure' });
  });
});
