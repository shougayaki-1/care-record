import { describe, expect, it } from 'vitest';
import { normalizeExtraction } from './normalizeExtraction';
import type { FormItem } from './extractPrompt';
import type { RawExtractionResult } from './mcpCandidateSchema';

const template: FormItem[] = [
  { id: 'amount', label: '尿量', type: 'number', required: false },
  { id: 'care', label: '介助', type: 'checkbox', required: false },
  { id: 'meal', label: '食事', type: 'multicheckbox', options: '朝,昼', required: true, hasDetail: true },
  { id: 'note', label: '特記事項', type: 'text', required: false },
];

const base: RawExtractionResult = {
  meta: {
    date: '2026-09-25', start_at: '09:00', end_at: '10:00', client_name: '利用者',
    helper_names: ['スタッフ'], client_id_candidate: 'client-1', helper_id_candidates: ['helper-1'],
  },
  values: {}, confidence: 'high', warnings: [],
};

const clients = [{ id: 'client-1', name: '利用者' }];
const helpers = [{ id: 'helper-1', name: 'スタッフ' }];

describe('normalizeExtraction', () => {
  it('unknown or unreadable values are omitted instead of becoming 0 or false', () => {
    const result = normalizeExtraction({
      ...base,
      values: { amount: null, care: 'unknown', meal: ['朝'], note: '', extra: 'guess' },
    }, template, clients, helpers);
    expect(result.values).toEqual({ meal: ['朝'] });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('介助'),
      expect.stringContaining('extra'),
    ]));
    expect(result.confidence).toBe('medium');
  });

  it('marks an empty extraction as low confidence even if the model says high', () => {
    const result = normalizeExtraction(base, template, clients, helpers);
    expect(result.values).toEqual({});
    expect(result.confidence).toBe('low');
    expect(result.warnings).toContain('フォーム項目を1件も抽出できませんでした');
  });

  it('keeps explicit zero, unchecked, and empty selection when their types are valid', () => {
    const result = normalizeExtraction({
      ...base, values: { amount: 0, care: false, meal: [], meal_detail: '補足' },
    }, template, clients, helpers);
    expect(result.values).toEqual({ amount: 0, care: false, meal: [], meal_detail: '補足' });
    expect(result.warnings).toEqual([]);
  });

  it('rejects choices outside the active form and IDs outside the supplied candidates', () => {
    const result = normalizeExtraction({
      ...base,
      meta: { ...base.meta, client_id_candidate: 'other', helper_id_candidates: ['helper-1', 'other'] },
      values: { meal: ['晩'] },
    }, template, clients, helpers);
    expect(result.values).toEqual({});
    expect(result.meta.client_id_candidate).toBeNull();
    expect(result.meta.helper_id_candidates).toEqual(['helper-1']);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('食事'),
      expect.stringContaining('利用者候補'),
      expect.stringContaining('スタッフ候補'),
    ]));
  });

  it('rejects candidate IDs when the read name points to a different person', () => {
    const result = normalizeExtraction({
      ...base,
      meta: { ...base.meta, client_id_candidate: 'client-2', helper_id_candidates: ['helper-2'] },
      values: { meal: ['昼'] },
    }, template,
    [...clients, { id: 'client-2', name: '別の利用者' }],
    [...helpers, { id: 'helper-2', name: '別のスタッフ' }]);
    expect(result.meta.client_id_candidate).toBeNull();
    expect(result.meta.helper_id_candidates).toEqual([]);
    expect(result.warnings).toContain('利用者候補を確認してください');
    expect(result.warnings).toContain('スタッフ候補を確認してください');
  });
});
