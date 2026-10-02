import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const logError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/log', () => ({ logError }));
import { POST } from './route';

afterEach(() => vi.clearAllMocks());

const request = (body: unknown, origin = 'https://app.example') => new NextRequest('https://app.example/api/auth/recovery-error', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('recovery error observation', () => {
  it('既存ログ基盤に分類と digest だけを記録する', async () => {
    const response = await POST(request({ boundary: 'global', kind: 'chunk', digest: '123', message: 'private-care-data', stack: 'private-care-data' }));
    expect(response.status).toBe(204);
    expect(logError).toHaveBeenCalledWith('Client rendering failed', {
      context: 'recovery', boundary: 'global', kind: 'chunk', digest: '123',
    });
  });

  it.each([
    { boundary: 'wrong', kind: 'chunk' },
    { boundary: 'global', kind: 'wrong' },
    { boundary: 'segment', kind: 'runtime', digest: 'sensitive arbitrary text' },
    null,
  ])('不正な入力をログに流さない', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });

  it('外部サイトからの送信を拒否する', async () => {
    expect((await POST(request({ boundary: 'global', kind: 'runtime' }, 'https://evil.example'))).status).toBe(403);
    expect(logError).not.toHaveBeenCalled();
  });

  it('過大な入力を拒否する', async () => {
    expect((await POST(request({ boundary: 'global', kind: 'runtime', extra: 'x'.repeat(1024) }))).status).toBe(413);
    expect(logError).not.toHaveBeenCalled();
  });
});
