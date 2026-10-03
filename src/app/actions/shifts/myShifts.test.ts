import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ACTION_ERROR_MESSAGE } from '@/utils/actionResult';

const mocks = vi.hoisted(() => ({ from: vi.fn(), user: vi.fn(), log: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  getAuthedUser: mocks.user,
  createSessionClient: async () => ({ from: mocks.from }),
}));
vi.mock('@/utils/log', () => ({ logError: mocks.log, serializeError: (error: unknown) => error }));
import { getMyShiftsWithStatus } from './myShifts';

const shift = { id: 'shift-1', client_id: 'client-1' };
function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), lt: vi.fn(), gt: vi.fn(), in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result), order: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [builder.select, builder.eq, builder.is, builder.lt, builder.gt, builder.in]) {
    method.mockReturnValue(builder);
  }
  return builder;
}
const load = () => getMyShiftsWithStatus('org-1', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 'user-1' });
});

describe('getMyShiftsWithStatus', () => {
  it('スタッフが存在しシフト0件なら正常値 [] を返し、記録を検索しない', async () => {
    const staff = query({ data: { id: 'staff-1' }, error: null });
    mocks.from.mockReturnValueOnce(staff).mockReturnValueOnce(query({ data: [], error: null }));
    await expect(load()).resolves.toEqual({ ok: true, data: [] });
    expect(staff.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(staff.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['staffs', 'shifts']);
  });

  it.each([{ reports: [] }, { reports: [{ id: 'report-1', shift_id: 'shift-1', status: 'submitted' }] }])('記録0件も正常とし、存在する記録はシフトに対応付ける: %j', async ({ reports }) => {
    mocks.from.mockReturnValueOnce(query({ data: { id: 'staff-1' }, error: null }))
      .mockReturnValueOnce(query({ data: [shift], error: null }))
      .mockReturnValueOnce(query({ data: reports, error: null }));
    await expect(load()).resolves.toEqual({ ok: true, data: [{
      ...shift, report: reports.length ? { id: 'report-1', status: 'submitted' } : null,
    }] });
  });

  it('スタッフ未紐付けをシリアライズ可能な結果で返す', async () => {
    mocks.from.mockReturnValueOnce(query({ data: null, error: null }));
    const result = await load();
    expect(JSON.parse(JSON.stringify(result))).toEqual({ ok: false, error: {
      code: 'STAFF_NOT_LINKED', message: 'この事業所にスタッフとして紐付いていません。事業所の管理者に確認してください。',
    } });
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each(['staffs', 'shifts', 'reports'])('%s のDBエラーを未紐付けや0件と誤認せずログへ記録する', async failingTable => {
    const error = { message: '権限 denied: private_table secret', code: '42501' };
    mocks.from.mockImplementation(table => query({
      data: table === failingTable ? null : table === 'staffs' ? { id: 'staff-1' } : [shift],
      error: table === failingTable ? error : null,
    }));
    const result = await load();
    expect(result).toEqual({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: GENERIC_ACTION_ERROR_MESSAGE } });
    expect(JSON.stringify(result)).not.toContain('private_table');
    expect(mocks.log).toHaveBeenCalledWith('[action:getMyShiftsWithStatus]', { organizationId: 'org-1', error });
  });

  it('認証基盤の例外もクライアントには汎用結果のみ返す', async () => {
    const error = new Error('auth backend private detail');
    mocks.user.mockRejectedValueOnce(error);
    await expect(load()).resolves.toEqual({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: GENERIC_ACTION_ERROR_MESSAGE } });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith('[action:getMyShiftsWithStatus]', { organizationId: 'org-1', error });
  });
});
