import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ids: vi.fn(), csv: vi.fn(), json: vi.fn(), notify: vi.fn(), upload: vi.fn(), configured: vi.fn(), audit: vi.fn() }));
vi.mock('@/utils/gcs/export', () => ({ getActiveOrganizationIds: mocks.ids, exportReportsAsCsv: mocks.csv, exportReportsAsJson: mocks.json, notifyBackupFailure: mocks.notify }));
vi.mock('@/utils/gcs/upload', () => ({ isGcsBackupConfigured: mocks.configured, uploadToGCS: mocks.upload }));
vi.mock('@/utils/gcs/html', () => ({ generateBackupHtml: () => '<html></html>' }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: () => ({ message: 'safe' }) }));
import { GET as daily } from './backup-daily/route';
import { GET as monthly } from './backup-monthly/route';
const request = () => new NextRequest('http://localhost/api/cron/backup', { headers: { authorization: 'Bearer test-cron' } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-cron');
  mocks.ids.mockResolvedValue(['org-one', 'org-two']);
  mocks.csv.mockResolvedValue('id,name\n'); mocks.json.mockResolvedValue('{}');
  mocks.configured.mockReturnValue(true); mocks.notify.mockResolvedValue(undefined);
});
describe.each([['daily', daily], ['monthly', monthly]] as const)('%s backup notifications', (kind, handler) => {
  it('does not notify on success or unauthorized requests', async () => {
    expect((await handler(request())).status).toBe(200);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect((await handler(new NextRequest('http://localhost/'))).status).toBe(401);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('notifies eligible organizations for missing configuration or organization lookup failure', async () => {
    mocks.configured.mockReturnValue(false);
    expect((await handler(request())).status).toBe(500);
    expect(mocks.notify).toHaveBeenLastCalledWith(kind, expect.any(String), null);
    mocks.configured.mockReturnValue(true); mocks.ids.mockRejectedValue(new Error('fixture DB failure'));
    expect((await handler(request())).status).toBe(500);
    expect(mocks.notify).toHaveBeenLastCalledWith(kind, expect.any(String), null);
  });
  it('limits an upload failure to the failed organization and keeps its original response', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('fixture external failure'));
    const response = await handler(request());
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(kind, expect.any(String), 'org-one');
    if (kind === 'daily') {
      expect(response.status).toBe(200); expect((await response.json()).orgs).toBe(1);
      expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-one', outcome: 'failure' }));
    } else {
      expect(response.status).toBe(500); expect(await response.json()).toEqual({ ok: false, error: 'backup_failed' });
    }
  });
});
