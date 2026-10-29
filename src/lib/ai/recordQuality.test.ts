import { describe, expect, it } from 'vitest';
import { checkRecordQuality } from '../../../supabase/functions/_shared/record-quality';

const template = [{ id: 'note', label: '記録', type: 'text' as const, required: true }];
const source = {
  record_id: 'synthetic', service_date: '2026-10-29', start_at: '2026-10-29T01:00:00Z', end_at: '2026-10-29T02:00:00Z',
  values: { note: '記録', service_time: '1', _helpers: ['synthetic'], travel_expenses: [{ amount_yen: 0 }] },
  template, actual_staff_count: 1, linked_shift_count: 1,
  shift: { id: 'synthetic', start_at: '2026-10-29T01:00:00Z', end_at: '2026-10-29T02:00:00Z', client_matches: true, status: 'published' },
};
describe('record quality', () => {
  it('accepts complete matching data', () => expect(checkRecordQuality(source, template).issues).toEqual([]));
  it('reports a missing required item', () => expect(checkRecordQuality({ ...source, values: { ...source.values, note: '' } }, template).issues).toContain('記録: 必須項目を確認してください'));
  it('reports schedule differences and unavailable schedules as requiring review', () => {
    expect(checkRecordQuality({ ...source, shift: { ...source.shift, end_at: '2026-10-29T03:00:00Z' } }, template).issues).toContain('予定と実績の日時が異なります。理由を確認してください');
    expect(checkRecordQuality({ ...source, shift: null }, template).status).toBe('needs_confirmation');
  });
});
