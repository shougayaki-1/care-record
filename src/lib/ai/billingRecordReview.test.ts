import { describe, expect, it } from 'vitest';
import { reviewBillingRecords } from '../../../supabase/functions/_shared/billing-record-review';

const template = [{ id: 'note', label: '記録', type: 'text' as const, required: true }];
const source = {
  record_id: 'one', service_date: '2026-10-29', start_at: '2026-10-29T01:00:00Z', end_at: '2026-10-29T02:00:00Z',
  values: { note: '', service_time: '1', _helpers: ['helper'], travel_expenses: [{ amount_yen: 0 }] },
  template, actual_staff_count: 1, linked_shift_count: 1,
  shift: { id: 'shift', start_at: '2026-10-29T01:00:00Z', end_at: '2026-10-29T03:00:00Z', client_matches: true, status: 'published' },
};

describe('billing record review', () => {
  it('lists missing input, schedule differences and approval status without returning record values', async () => {
    const result = await reviewBillingRecords({ records: [{ id: 'one', service_date: '2026-10-29', status: 'pending' }], has_more: true, limit: 1, offset: 0 }, async () => source, template);
    expect(result.records[0].issues).toEqual(expect.arrayContaining(['記録の承認状態を確認してください', '記録: 必須項目を確認してください', '予定と実績の日時が異なります。理由を確認してください']));
    expect(result).toMatchObject({ scanned: 1, has_more: true });
    expect(JSON.stringify(result)).not.toContain('travel_expenses');
  });
  it('marks a record unavailable between reads for review', async () => {
    const result = await reviewBillingRecords({ records: [{ id: 'one', service_date: null, status: 'approved' }], has_more: false, limit: 1, offset: 0 }, async () => null, template);
    expect(result.records[0].issues).toContain('記録を再確認できませんでした');
  });
  it('does not list a complete approved record as a problem', async () => {
    const complete = { ...source, values: { ...source.values, note: 'synthetic' }, shift: { ...source.shift, end_at: source.end_at } };
    const result = await reviewBillingRecords({ records: [{ id: 'one', service_date: '2026-10-29', status: 'approved' }], has_more: false, limit: 20, offset: 0 }, async () => complete, template);
    expect(result).toMatchObject({ records: [], scanned: 1, has_more: false });
  });
});
