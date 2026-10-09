import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), record: vi.fn(), shift: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertRecordPermission: mocks.record, assertShiftPermission: mocks.shift, createSessionClient: async () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: unknown) => error }));
import { getShiftSuggestions } from './reportShifts';
function query(data: unknown, error: unknown = null) {
  const response = { data, error };
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), neq: vi.fn(() => q), is: vi.fn(() => q), lt: vi.fn(() => q), gt: vi.fn(() => q), maybeSingle: vi.fn(async () => response), then: (resolve: (value: typeof response) => void) => Promise.resolve(response).then(resolve) };
  return q;
}
beforeEach(() => vi.resetAllMocks());
it.each(['primary', 'existing', 'candidates'])('keeps a failed %s read distinct from an empty suggestion list', async step => {
  const primary = { shift_id: 'shift', shifts: { client_id: 'client', start_at: '2026-10-06T10:00:00Z', end_at: '2026-10-06T11:00:00Z' } };
  if (step !== 'primary') mocks.from.mockReturnValueOnce(query(primary));
  if (step === 'candidates') mocks.from.mockReturnValueOnce(query([]));
  mocks.from.mockReturnValueOnce(query(null, { message: 'private shift SQL 権限 detail' }));
  const result = await getShiftSuggestions('org', 'report');
  expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  expect(JSON.stringify(result)).not.toContain('private shift SQL');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('returns an empty success when a report has no primary link', async () => {
  mocks.from.mockReturnValueOnce(query(null));
  await expect(getShiftSuggestions('org', 'report')).resolves.toEqual({ ok: true, data: [] });
});
