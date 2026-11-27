import { describe, expect, it } from 'vitest';
import template from '../../../supabase/functions/_shared/default-form-template.json';
import { prepareImportCandidate } from '../../../supabase/functions/_shared/prepare-import-candidate';
import type { FormItem } from '../../../supabase/functions/_shared/validate-candidate';

describe('MCP一括取込の候補', () => {
  it('不明な日時や選択を推測せず、確認質問と警告を返す', () => {
    const result = prepareImportCandidate({ meta: { date: '2026-02-30', start_at: '25:00', end_at: null, client_name: null, helper_names: [] },
      values: { water_supply: true, unknown_field: 'value' }, confidence: 'low', warnings: [] }, template as FormItem[]);
    expect(result.payload.meta.date).toBeNull();
    expect(result.payload.meta.start_at).toBeNull();
    expect(result.payload.values).toEqual({ water_supply: true });
    expect(result.payload.warnings).toEqual(expect.arrayContaining([expect.stringContaining('記録日'), expect.stringContaining('開始時刻'), expect.stringContaining('フォームにない')]));
    expect(result.questions.map(question => question.field_id)).toEqual(expect.arrayContaining(['date','start_at','end_at','client_name','helper_names']));
  });
});
