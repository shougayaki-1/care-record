import { describe, expect, it } from 'vitest';
import { prepareImportBatch, mergeImportBatchResults } from '../../../supabase/functions/_shared/prepare-import-batch';
import type { CandidateInput } from '../../../supabase/functions/_shared/prepare-import-candidate';
const clear: CandidateInput = { meta: { date: '2026-11-01', start_at: '10:00', end_at: '11:00', client_name: 'A', helper_names: ['B'] }, values: {}, confidence: 'high', warnings: [] };
describe('MCP一括取込', () => {
  it('質問待ちと送信結果を入力順に対応付ける', () => {
    const items = [{ request_id: 'a', record: clear, send_anyway: false, allow_duplicate: false },
      { request_id: 'b', record: { ...clear, meta: { ...clear.meta, date: null } }, send_anyway: false, allow_duplicate: false },
      { request_id: 'c', record: clear, send_anyway: true, allow_duplicate: true }];
    const { results, pending } = prepareImportBatch(items, []);
    expect(pending.map(item => item.request_id)).toEqual(['a','c']);
    expect(mergeImportBatchResults(results, pending, [{ index: 1, status: 'submitted', candidate_id: '10000000-0000-4000-8000-000000000001', replayed: false }, { index: 2, status: 'possible_duplicate' }])).toEqual([
      { request_id: 'a', status: 'submitted', candidate_id: '10000000-0000-4000-8000-000000000001', replayed: false },
      expect.objectContaining({ request_id: 'b', status: 'needs_clarification' }),
      { request_id: 'c', status: 'possible_duplicate' },
    ]);
  });
  it('形式不正の行を分離し、ほかの行の送信を妨げない', () => {
    const { results, pending } = prepareImportBatch([{ request_id: 'bad', record: null, send_anyway: false, allow_duplicate: false },
      { request_id: 'good', record: clear, send_anyway: false, allow_duplicate: false }], []);
    expect(results[0]).toEqual({ request_id: 'bad', status: 'invalid_input' });
    expect(pending.map(item => item.request_id)).toEqual(['good']);
  });
  it('対応しない件数や順序のDB応答を成功扱いしない', () => {
    const { results, pending } = prepareImportBatch([{ request_id: 'a', record: clear, send_anyway: false, allow_duplicate: false }], []);
    expect(() => mergeImportBatchResults(results, pending, [])).toThrow('invalid_batch_response');
    expect(() => mergeImportBatchResults(results, pending, [{ index: 2, status: 'submitted' }])).toThrow('invalid_batch_response');
  });
});
