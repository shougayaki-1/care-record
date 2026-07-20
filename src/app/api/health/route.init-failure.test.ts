import { describe, expect, it, vi } from 'vitest';

// Simulate the production failure mode: the service-role module throws while it
// evaluates (e.g. auth.ts's top-level "SUPABASE_SERVICE_ROLE_KEY is required").
// Because the health route imports it lazily inside GET, this must degrade to a
// controlled 503 rather than an uncaught 500.
vi.mock('@/utils/supabase/serviceRole', () => {
  throw new Error('service role environment is not configured');
});

import { GET } from './route';

describe('GET /api/health (initialization failure)', () => {
  it('returns 503 unavailable instead of an uncaught 500 when the service-role client cannot be created', async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, service: 'care-record', status: 'unavailable' });
  });
});
