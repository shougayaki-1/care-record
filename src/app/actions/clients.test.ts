import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), from: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertOrgPermission: mocks.guard, createSessionClient: mocks.client }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
import { createClient, updateClientName, setClientArchived, softDeleteClient, saveClientForm, saveClientAssignments, updateClientGoogleLink, getClientAssignmentPermissionHints } from './clients';

const operations = [
  ['create', () => createClient('org-a', '名前')],
  ['rename', () => updateClientName('org-a', 'client-a', '名前')],
  ['archive', () => setClientArchived('org-a', 'client-a', true)],
  ['restore', () => setClientArchived('org-a', 'client-a', false)],
  ['delete', () => softDeleteClient('org-a', 'client-a', '削除理由')],
  ['form', () => saveClientForm('org-a', 'client-a', [])],
  ['assignments', () => saveClientAssignments('org-a', 'client-a', [])],
  ['google link', () => updateClientGoogleLink('org-a', 'client-a', { folderId: 'folder' })],
  ['permission hints', () => getClientAssignmentPermissionHints('org-a', 'client-a')],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ userId: 'owner' });
  mocks.client.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
});

describe('client action authorization', () => {
  it.each(operations)('%s rejects unauthenticated and unauthorized callers before data access', async (_name, run) => {
    for (const code of ['UNAUTHENTICATED', 'FORBIDDEN'] as const) {
      mocks.guard.mockRejectedValueOnce(new ExpectedActionError(code, 'アクセスできません'));
      expect(await run()).toEqual({ ok: false, error: { code, message: 'アクセスできません' } });
      expect(mocks.guard).toHaveBeenLastCalledWith('org-a', 'clients');
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  });

  it.each(operations.slice(1))('%s does not operate on missing, foreign, or deleted targets', async (_name, run) => {
    for (const data of [null, { id: 'client-a', archived_at: null, deleted_at: '2026-01-01' }]) {
      const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      mocks.from.mockReturnValue(query);
      expect(await run()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '利用者が見つかりません' } });
      expect(query.eq).toHaveBeenCalledWith('id', 'client-a');
      expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-a');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  });

  it.each(operations)('%s permits an authorized caller and performs the expected operation', async (name, run) => {
    const query = {
      select: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'client-a', archived_at: '2026-01-01', deleted_at: null }, error: null }),
      single: vi.fn().mockResolvedValue({ data: name === 'create' ? { id: 'client-a', name: '名前' } : { retention_years: 5 }, error: null }),
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
    };
    query.select.mockReturnValue(query); query.insert.mockReturnValue(query); query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await run()).toEqual(expect.objectContaining({ ok: true }));
    expect(mocks.guard).toHaveBeenCalledWith('org-a', 'clients');
    if (name === 'permission hints') expect(mocks.audit).not.toHaveBeenCalled();
    else expect(mocks.audit).toHaveBeenCalledOnce();
    if (['form', 'assignments', 'permission hints'].includes(name)) expect(mocks.rpc).toHaveBeenCalledOnce();
  });


  it('does not return database details when the target lookup fails', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'private database details' } }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.from.mockReturnValue(query);
    const result = await updateClientName('org-a', 'client-a', '名前');
    expect(result).toEqual({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: '処理に失敗しました。時間をおいて再度お試しください。' } });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });

});
