import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateSession } from './middleware';

afterEach(() => vi.unstubAllEnvs());

describe('updateSession', () => {
  it('serves public pages with CSP without requiring a Supabase Auth request', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const response = await updateSession(
      new NextRequest('https://example.com/'),
      'test-nonce',
      "default-src 'self'",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });

  it('keeps Supabase configuration mandatory on protected pages', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await expect(updateSession(
      new NextRequest('https://example.com/app'),
      'test-nonce',
      "default-src 'self'",
    )).rejects.toThrow('Supabase middleware environment is not configured');
  });
});
