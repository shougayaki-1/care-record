import { describe, expect, it, vi } from 'vitest';
import {
  classifySessionActivityAuthentication,
  ensureSessionActivityWithRetry,
  type SessionActivityResult,
} from './sessionActivity';

describe('ensureSessionActivityWithRetry', () => {
  it('does not retry an invalid session', async () => {
    const ensure = vi.fn<() => Promise<SessionActivityResult>>().mockResolvedValue({ status: 'invalid_session' });

    await expect(ensureSessionActivityWithRetry(ensure, 3, vi.fn())).resolves.toEqual({ status: 'invalid_session' });
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('retries a transient registration failure and continues after success', async () => {
    const ensure = vi.fn<() => Promise<SessionActivityResult>>()
      .mockResolvedValueOnce({ status: 'transient_error' })
      .mockResolvedValueOnce({ status: 'ready' });
    const sleep = vi.fn<(_: number) => Promise<void>>().mockResolvedValue();

    await expect(ensureSessionActivityWithRetry(ensure, 3, sleep)).resolves.toEqual({ status: 'ready' });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('stops after the configured retry limit', async () => {
    const ensure = vi.fn<() => Promise<SessionActivityResult>>().mockResolvedValue({ status: 'transient_error' });
    const sleep = vi.fn<(_: number) => Promise<void>>().mockResolvedValue();

    await expect(ensureSessionActivityWithRetry(ensure, 3, sleep)).resolves.toEqual({ status: 'transient_error' });
    expect(ensure).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});

describe('classifySessionActivityAuthentication', () => {
  it.each([
    [400, true, true, 'invalid_session'],
    [401, false, true, 'invalid_session'],
    [403, true, true, 'invalid_session'],
    [500, false, true, 'transient_error'],
    [null, false, true, 'transient_error'],
    [null, false, false, 'invalid_session'],
    [null, true, false, 'ready'],
  ] as const)('classifies auth status %s with user=%s and auth error=%s as %s', (status, hasUser, hadAuthError, expected) => {
    expect(classifySessionActivityAuthentication(status, hasUser, hadAuthError)).toEqual({ status: expected });
  });
});
