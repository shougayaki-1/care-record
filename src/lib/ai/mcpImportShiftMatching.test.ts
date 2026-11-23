import { describe, expect, it } from 'vitest';
import { japanBusinessDate, matchImportShifts } from '../../../supabase/functions/_shared/match-import-shifts';
describe('MCP取込のシフト照合', () => {
  it('JSTの日付で検索し、重なりだけを候補として返す', () => {
    const start = Date.parse('2026-11-10T15:00:00Z'), end = Date.parse('2026-11-10T16:00:00Z');
    expect(japanBusinessDate(start)).toBe('2026-11-11');
    const shifts = [
      { id: 'overlap', start_at: '2026-11-10T15:30:00Z', end_at: '2026-11-10T16:30:00Z', status: 'published', secret: 'not returned' },
      { id: 'adjacent', start_at: '2026-11-10T16:00:00Z', end_at: '2026-11-10T17:00:00Z', status: 'published' },
      { id: 'cancelled', start_at: '2026-11-10T15:00:00Z', end_at: '2026-11-10T16:00:00Z', status: 'cancelled' },
    ];
    expect(matchImportShifts(shifts, start, end)).toEqual([{ id: 'overlap', start_at: '2026-11-10T15:30:00Z', end_at: '2026-11-10T16:30:00Z', status: 'published' }]);
  });
});
