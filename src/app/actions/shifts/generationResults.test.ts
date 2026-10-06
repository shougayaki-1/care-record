import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), from: vi.fn(), save: vi.fn(), log: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertShiftPermission: mocks.permission, createSessionClient: async () => ({ from: mocks.from }) }));
vi.mock('./internal', () => ({ saveGeneratedShiftAtomic: mocks.save }));
vi.mock('@/utils/log', () => ({ logError: mocks.log, serializeError: (error: { message: string }) => ({ message: error.message }) }));
import { generateShiftsForMonth, previewShiftsForMonth } from './generation';
const privateDetail = 'private_column 権限 SQL';
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), not: vi.fn(() => q), gte: vi.fn(() => q), lte: vi.fn(() => q),
    then: (resolve: (value: { data: unknown; error: unknown }) => void) => Promise.resolve({ data, error }).then(resolve) };
  return q;
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ userId: 'actor' }); });
describe('generation failure and empty results', () => {
  it.each([previewShiftsForMonth, generateShiftsForMonth])('does not replace failed pattern reads with zero generated shifts', async action => {
    mocks.from.mockImplementation(table => query(table === 'shifts' ? [] : null, table === 'shift_patterns' ? { message: privateDetail } : null));
    const result = await action('org', '2026-10');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain(privateDetail);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith('[db:action.shift-generation.patterns]', expect.objectContaining({ error: { message: privateDetail } }));
  });
  it('stops before looking up patterns when existing-shift lookup fails', async () => {
    mocks.from.mockReturnValue(query(null, { message: privateDetail }));
    await expect(generateShiftsForMonth('org', '2026-10')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('shifts');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('keeps genuinely empty patterns as successful zero work', async () => {
    mocks.from.mockReturnValue(query([]));
    await expect(previewShiftsForMonth('org', '2026-10')).resolves.toEqual({ ok: true, data: { total: 0, details: [] } });
    await expect(generateShiftsForMonth('org', '2026-10')).resolves.toMatchObject({ ok: true, data: { count: 0, failed: 0 } });
  });
  it('returns permission and validation states before any DB query', async () => {
    mocks.permission.mockRejectedValueOnce(new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません'));
    await expect(generateShiftsForMonth('org', '2026-10')).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await expect(generateShiftsForMonth('org', '2026-13')).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('counts partial failures and logs private details without returning them', async () => {
    const pattern = { id: 'pattern', start_time: '10:00:00', end_time: '11:00:00', rrule: 'FREQ=DAILY;COUNT=2',
      title: '定期訪問', client_id: 'client', shift_pattern_segments: [], shift_pattern_staffs: [] };
    mocks.from.mockImplementation(table => query(table === 'shifts' ? [] : [pattern]));
    mocks.save.mockRejectedValueOnce(new Error(privateDetail)).mockResolvedValueOnce(undefined);
    const result = await generateShiftsForMonth('org', '2026-10');
    expect(result).toMatchObject({ ok: true, data: { count: 1, failed: 1, failureReasons: ['処理に失敗しました。時間をおいて再度お試しください。'] } });
    expect(JSON.stringify(result)).not.toContain(privateDetail);
    expect(mocks.log).toHaveBeenCalledWith('Generate Shift DB Error', { organizationId: 'org', reason: { message: privateDetail } });
  });
});
