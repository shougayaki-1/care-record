import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: vi.fn(), store: vi.fn(), control: vi.fn(), run: vi.fn(), health: vi.fn(), source: vi.fn() }));
vi.mock('@/utils/auditArchive/config', () => ({ archiveConfig: mocks.config }));
vi.mock('@/utils/auditArchive/gcs', () => ({ createArchiveStore: mocks.store }));
vi.mock('@/utils/auditArchive/source', () => ({ createArchiveSource: mocks.source }));
vi.mock('@/utils/auditArchive/publisher', () => ({ loadControl: mocks.control, runArchive: mocks.run, archiveHealth: mocks.health, archivePrefix: () => 'archive/staging/pre-cutover/' }));
import { GET } from './route';
const request = (auth = 'Bearer test-only', environment = 'staging', mode = '') => new NextRequest(`https://example.test/api/cron/archive-audit${mode}`, { headers: { authorization: auth, 'x-carerecord-environment': environment } });
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'test-only');
  mocks.config.mockReturnValue({ environment: 'staging', mode: 'inventory', bucket: 'test', pinned: {} });
  mocks.control.mockResolvedValue({ environment: 'staging', baselineFinalized: false });
  mocks.run.mockResolvedValue({ status: 'inventory', archived: '501' });
});
describe('archive route', () => {
  it('rejects absent/invalid secrets before reading DB or GCS and never caches responses', async () => {
    for (const auth of ['', 'Bearer wrong']) {
      const response = await GET(request(auth));
      expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toContain('private, no-store');
    }
    vi.stubEnv('CRON_SECRET', ''); expect((await GET(request())).status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
  });
  it('rejects environment mismatch before any external access', async () => {
    expect((await GET(request('Bearer test-only', 'production'))).status).toBe(403);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it('reports inventory as provisional and complete only after baseline activation', async () => {
    let response = await GET(request()); expect(response.status).toBe(202); expect((await response.json()).ok).toBe(false);
    mocks.config.mockReturnValue({ environment: 'staging', mode: 'v2', bucket: 'test', pinned: {} });
    mocks.control.mockResolvedValue({ environment: 'staging', baselineFinalized: true });
    mocks.run.mockResolvedValue({ status: 'complete', archived: '501' });
    response = await GET(request()); expect(response.status).toBe(200); expect((await response.json()).ok).toBe(true);
  });
  it('returns fixed unavailable classification without leaking identifiers or error details', async () => {
    mocks.run.mockRejectedValue(new Error('sensitive-event-id SECRET canonical-data'));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false,"status":"unavailable"}');
  });
  it('health mode does not start a DB snapshot and treats backlog as non-success', async () => {
    mocks.health.mockResolvedValue({ critical: true, category: 'archive_incomplete' });
    const response = await GET(request('Bearer test-only', 'staging', '?mode=health'));
    expect(response.status).toBe(503); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
});
