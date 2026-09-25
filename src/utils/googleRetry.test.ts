import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from './googleRetry';

afterEach(() => vi.useRealTimers());

describe('Google retries', () => {
    it('recovers a temporary health-check failure without asking for reauthentication', async () => {
        vi.useFakeTimers();
        const request = vi.fn()
            .mockRejectedValueOnce({ response: { status: 503 } })
            .mockResolvedValue('healthy');
        const result = withRetry(request, 2);
        await vi.runAllTimersAsync();
        await expect(result).resolves.toBe('healthy');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each([
        [{ response: { status: 400, data: { error: 'invalid_grant' } } }, 'auth'],
        [{ response: { status: 403 } }, 'forbidden'],
        [{ response: { status: 401, data: { error: 'invalid_client' } } }, 'misconfigured'],
    ])('does not repeatedly retry a nonrecoverable credential/permission error', async (error, kind) => {
        const request = vi.fn().mockRejectedValue(error);
        await expect(withRetry(request, 2)).rejects.toMatchObject({ kind });
        expect(request).toHaveBeenCalledTimes(1);
    });
});
