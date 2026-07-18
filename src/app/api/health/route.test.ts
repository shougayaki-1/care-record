import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/utils/supabase/auth', () => ({ supabaseAdmin: { rpc } }));

import { GET } from './route';

describe('GET /api/health', () => {
  beforeEach(() => rpc.mockReset());

  it('returns a no-store response without tenant data', async () => {
    rpc.mockResolvedValue({ data: { level: 'normal', sizeBytes: 123 }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      service: 'care-record',
      status: 'ok',
      database: { capacity: 'normal' },
    });
  });

  it('reports a capacity restriction without exposing the database size', async () => {
    rpc.mockResolvedValue({ data: { level: 'restricted', sizeBytes: 420 * 1024 * 1024 }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'care-record',
      status: 'degraded',
      database: { capacity: 'restricted' },
    });
  });

  it('returns a generic 503 when the metadata-only database probe fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sensitive database detail' } });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
});
