import { readActionResult } from '@/utils/actionResult';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'owner', staffId: 'own-staff' as string | null, queries: [] as Array<{ table: string; filters: Record<string, unknown> }>, assertOrg: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  assertOrgRole: state.assertOrg,
  getAuthedUser: vi.fn(async () => ({ id: 'user-1' })),
  assertOrgPermission: vi.fn(),
  createSessionClient: vi.fn(async () => ({ from: (table: string) => {
    const filters: Record<string, unknown> = {}; state.queries.push({ table, filters });
    const response = () => ({ data: table === 'organization_members' ? { role: state.role } : table === 'staffs' ? (state.staffId ? { id: state.staffId } : null) : [], error: null });
    const query = { select: () => query, eq: (name: string, value: unknown) => { filters[name] = value; return query; }, is: (name: string, value: unknown) => { filters[name] = value; return query; }, order: () => query, limit: () => query, gte: (name: string, value: unknown) => { filters[`gte:${name}`] = value; return query; }, lt: (name: string, value: unknown) => { filters[`lt:${name}`] = value; return query; }, single: async () => response(), maybeSingle: async () => response(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve) };
    return query;
  } })),
}));
import { getMyInternalWorkHistory } from './internalWork';
beforeEach(() => { state.queries.length = 0; state.role = 'owner'; state.staffId = 'own-staff'; state.assertOrg.mockReset(); state.assertOrg.mockResolvedValue({ userId: 'user-1' }); });
describe('own internal history access', () => {
  it('keeps owners restricted to their own staff and organization in history', async () => {
    await readActionResult(getMyInternalWorkHistory('org-1', { startAt: 'from', endAt: 'until' }));
    expect(state.assertOrg).toHaveBeenCalledWith('org-1');
    expect(state.queries.find((query) => query.table === 'internal_work_records')?.filters).toEqual({ organization_id: 'org-1', staff_id: 'own-staff', deleted_at: null, 'gte:start_at': 'from', 'lt:start_at': 'until' });
  });
  it('returns no records without a staff mapping or view permission', async () => {
    state.staffId = null;
    expect(await readActionResult(getMyInternalWorkHistory('org-1'))).toEqual([]);
    expect(state.queries.some((query) => query.table === 'internal_work_records')).toBe(false);
    state.staffId = 'own-staff'; state.role = 'member'; state.queries.length = 0;
    expect(await readActionResult(getMyInternalWorkHistory('org-1'))).toEqual([]);
    expect(state.queries.some((query) => query.table === 'internal_work_records')).toBe(false);
  });
});
