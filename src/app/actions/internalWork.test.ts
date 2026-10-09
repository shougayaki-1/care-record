import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'owner', scope: 'assigned', ownStaff: 'staff-1', staffExists: true,
  assertOrg: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@/utils/supabase/auth', () => ({
  assertOrgRole: state.assertOrg, assertOrgPermission: vi.fn(), getAuthedUser: vi.fn(),
  createSessionClient: vi.fn(async () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const response = () => ({ error: null, data: table === 'organization_members'
        ? { role: state.role }
        : table === 'organization_member_roles'
          ? [{ organization_roles: { permissions: { internalWork: { create: state.scope } } } }]
          : state.staffExists ? { id: filters.id ?? state.ownStaff } : null });
      const query = {
        select: () => query,
        eq: (name: string, value: unknown) => { filters[name] = value; return query; },
        is: () => query, single: async () => response(), maybeSingle: async () => response(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve),
      };
      return query;
    },
  })),
}));
vi.mock('@/utils/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/errors')>();
  return { ...actual, sanitizeDbError: vi.fn(() => new Error('safe DB error')) };
});
import { saveInternalWork, type SaveInternalWorkInput } from './internalWork';
import { ExpectedActionError, sanitizeDbError } from '@/utils/errors';

const input: SaveInternalWorkInput = {
  organizationId: 'org-1', staffId: 'staff-1', idempotencyKey: '47000000-0000-4000-8000-000000000001',
  title: ' 会議 ', workType: '', startAt: '2026-10-04T10:00:00+09:00',
  endAt: '2026-10-04T11:00:00+09:00', workHours: 1, note: ' メモ ',
};
beforeEach(() => {
  vi.clearAllMocks(); state.role = 'owner'; state.scope = 'assigned'; state.staffExists = true;
  state.assertOrg.mockResolvedValue({ userId: 'actor-1' });
  state.rpc.mockResolvedValue({ data: { id: 'work-1', replayed: false }, error: null });
});
describe('saveInternalWork idempotent RPC boundary', () => {
  it('normalizes input, passes the caller key and returns the same ID on replay', async () => {
    expect(await readActionResult(saveInternalWork(input))).toEqual({ success: true, id: 'work-1' });
    state.rpc.mockResolvedValue({ data: { id: 'work-1', replayed: true }, error: null });
    expect(await readActionResult(saveInternalWork(input))).toEqual({ success: true, id: 'work-1' });
    expect(state.assertOrg).toHaveBeenCalledWith('org-1');
    expect(state.rpc).toHaveBeenCalledWith('save_internal_work_idempotent', {
      p_organization_id: 'org-1', p_staff_id: 'staff-1', p_idempotency_key: input.idempotencyKey,
      p_title: '会議', p_work_type: 'meeting', p_start_at: '2026-10-04T01:00:00.000Z',
      p_end_at: '2026-10-04T02:00:00.000Z', p_work_hours: 1, p_note: 'メモ',
    });
  });
  it('keeps the key after a lost RPC response for the client retry', async () => {
    state.rpc.mockRejectedValueOnce(new Error('response lost'));
    await expect(readActionResult(saveInternalWork(input))).rejects.toThrow();
    await expect(readActionResult(saveInternalWork(input))).resolves.toEqual({ success: true, id: 'work-1' });
    expect(state.rpc.mock.calls[1]).toEqual(state.rpc.mock.calls[0]);
  });
  it('returns a defined safe conflict without reflecting database payload details', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'CR409', message: 'database detail' } });
    await expect(readActionResult(saveInternalWork(input))).rejects.toThrow('同じ保存キーで入力内容が変更されています');
    expect(sanitizeDbError).not.toHaveBeenCalled();
  });
  it('sanitizes other DB failures using only their code', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'database detail', details: 'payload' } });
    await expect(readActionResult(saveInternalWork(input))).rejects.toThrow();
    expect(sanitizeDbError).toHaveBeenCalledWith({ code: '42501' }, 'action.internalWork');
  });
  it.each([
    { idempotencyKey: '' }, { title: '' }, { workHours: 0 }, { workHours: 25 },
    { startAt: 'invalid' }, { endAt: input.startAt },
  ])('rejects invalid input before RPC: %j', async (change) => {
    await expect(readActionResult(saveInternalWork({ ...input, ...change }))).rejects.toThrow();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('maintains assigned-staff, no-permission, tenant and live-staff checks before RPC', async () => {
    state.role = 'member';
    await expect(readActionResult(saveInternalWork({ ...input, staffId: 'other-staff' }))).rejects.toThrow('他のスタッフ');
    state.scope = 'none';
    await expect(readActionResult(saveInternalWork(input))).rejects.toThrow('権限');
    state.scope = 'assigned'; state.role = 'owner'; state.staffExists = false;
    await expect(readActionResult(saveInternalWork(input))).rejects.toThrow('見つかりません');
    state.assertOrg.mockRejectedValueOnce(new ExpectedActionError('FORBIDDEN', 'この事業所へのアクセス権がありません'));
    await expect(readActionResult(saveInternalWork({ ...input, organizationId: 'other-org' }))).rejects.toThrow('アクセス権');
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

it('returns classified permission, staff and conflict failures without performing extra saves', async () => {
  state.role = 'member'; state.scope = 'none';
  await expect(saveInternalWork(input)).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(state.rpc).not.toHaveBeenCalled();
  state.role = 'owner'; state.staffExists = false;
  await expect(saveInternalWork(input)).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(state.rpc).not.toHaveBeenCalled();
  state.staffExists = true; state.rpc.mockResolvedValue({ data: null, error: { code: 'CR409', message: 'private conflict details' } });
  const result = await saveInternalWork(input);
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  expect(JSON.stringify(result)).not.toContain('private conflict details');
});
