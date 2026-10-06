import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), user: vi.fn(), from: vi.fn(), audit: vi.fn(), fetch: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertOrgRole: mocks.role, getAuthedUser: mocks.user, createSessionClient: async () => ({ from: mocks.from }) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: unknown) => error }));
let callGasApi: typeof import('./gas').callGasApi;
beforeEach(async () => {
  vi.resetAllMocks(); vi.resetModules();
  vi.stubEnv('GAS_API_URL', 'https://synthetic.invalid/gas'); vi.stubEnv('GAS_SHARED_SECRET', 'synthetic-test-only');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.user.mockResolvedValue({ id: 'actor', email: 'synthetic@example.invalid' });
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data: { name: '事業所', google_folder_id: 'folder' }, error: null })) };
  mocks.from.mockReturnValue(q);
  ({ callGasApi } = await import('./gas'));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('projects successful folder data and excludes external messages/details', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', folderId: 'folder', folderUrl: 'https://drive.google.com/drive/folders/folder', message: 'private response', trace: 'private trace' }) });
  const result = await callGasApi({ action: 'manage_org_folder', organizationId: 'org' });
  expect(result).toMatchObject({ ok: true, data: { status: 'success', folderId: 'folder' } });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'google_drive.manage_org_folder' }));
});
it('does not treat a rejected external operation as successful response data', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'error', message: 'private external detail' }) });
  const result = await callGasApi({ action: 'manage_org_folder', organizationId: 'org' });
  expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
});
it('stops before external effects when the organization query fails', async () => {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'private DB 権限' } })) };
  mocks.from.mockReturnValue(q);
  const result = await callGasApi({ action: 'manage_org_folder', organizationId: 'org' });
  expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
