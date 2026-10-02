import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { isSameOriginPost } from './sameOrigin';

describe('same-origin POST verification', () => {
  it('NextURL が localhost に変換しても実際の Host でローカルフォームを検証する', () => {
    const request = new NextRequest('http://127.0.0.1:3100/api/auth/recover', {
      method: 'POST', headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', 'sec-fetch-site': 'same-origin' },
    });
    expect(request.nextUrl.hostname).toBe('localhost');
    expect(isSameOriginPost(request)).toBe(true);
  });

  it.each([
    [undefined, undefined], ['null', undefined], ['https://evil.example', undefined],
    ['http://app.example', undefined], ['https://app.example:1234', undefined],
    ['https://app.example', 'cross-site'], ['invalid-origin', undefined],
  ])('不正な送信元 %s / %s を拒否する', (origin, site) => {
    const headers = new Headers({ host: 'app.example' });
    if (origin) headers.set('origin', origin);
    if (site) headers.set('sec-fetch-site', site);
    expect(isSameOriginPost(new NextRequest('https://app.example/api/auth/recover', { method: 'POST', headers }))).toBe(false);
  });
});
