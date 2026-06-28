import { describe, it, expect } from 'vitest';
import { buildExtractionPrompt, type FormItem, type PromptCandidate } from './extractPrompt';

const SAMPLE_TEMPLATE: FormItem[] = [
  { id: 'sec_medical', label: '【医療的ケア・身体介護】', type: 'section', required: false },
  { id: 'sputum_suction', label: '痰等の吸引（気管・口腔）', type: 'checkbox', required: false },
  { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,他', required: false, hasDetail: true },
  { id: 'urine_disposal', label: '排尿：尿破棄 (ml)', type: 'number', required: false },
  { id: 'special_note', label: '《特記事項》', type: 'text', required: false },
];

const SAMPLE_CLIENTS: PromptCandidate[] = [
  { id: 'client-1', name: '山田太郎' },
  { id: 'client-2', name: '鈴木花子' },
];

const SAMPLE_HELPERS: PromptCandidate[] = [
  { id: 'helper-1', name: '田中一郎' },
];

describe('buildExtractionPrompt', () => {
  it('systemPrompt と userPromptTemplate の両方を返す', () => {
    const { systemPrompt, userPromptTemplate } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(typeof systemPrompt).toBe('string');
    expect(typeof userPromptTemplate).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPromptTemplate.length).toBeGreaterThan(0);
  });

  it('systemPrompt にフィールドIDが含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('sputum_suction');
    expect(systemPrompt).toContain('meal_help');
    expect(systemPrompt).toContain('urine_disposal');
    expect(systemPrompt).toContain('special_note');
  });

  it('section フィールドはフィールド一覧に含まれない', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    // section の id は values の出力対象外なのでフィールドとして列挙されない
    // ただし "section見出し（値なし）" という型説明ではなく、sec_medical が一覧に出ないことを確認
    // フィールド一覧には "sec_medical" というIDが単独行で含まれないこと
    const lines = systemPrompt.split('\n');
    const fieldLines = lines.filter((l) => l.includes('id:'));
    expect(fieldLines.every((l) => !l.includes('"sec_medical"'))).toBe(true);
  });

  it('hasDetail フィールドには "_detail" の言及が含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('meal_help_detail');
  });

  it('利用者名候補が systemPrompt に含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('山田太郎');
    expect(systemPrompt).toContain('鈴木花子');
    expect(systemPrompt).toContain('client-1');
    expect(systemPrompt).toContain('client_id_candidate');
  });

  it('スタッフ名候補が systemPrompt に含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('田中一郎');
    expect(systemPrompt).toContain('helper-1');
    expect(systemPrompt).toContain('helper_id_candidates');
  });

  it('候補が空のとき "候補なし" が含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: [],
      helpers: [],
    });
    expect(systemPrompt).toContain('候補なし');
  });

  it('multicheckbox の options が systemPrompt に含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('朝,昼,晩,他');
  });

  it('JSON 出力形式の指示が含まれる', () => {
    const { systemPrompt } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(systemPrompt).toContain('"records"');
    expect(systemPrompt).toContain('"meta"');
    expect(systemPrompt).toContain('"confidence"');
    expect(systemPrompt).toContain('"warnings"');
  });

  it('userPromptTemplate がファイルの添付について言及する', () => {
    const { userPromptTemplate } = buildExtractionPrompt({
      formTemplate: SAMPLE_TEMPLATE,
      clients: SAMPLE_CLIENTS,
      helpers: SAMPLE_HELPERS,
    });
    expect(userPromptTemplate).toContain('添付');
  });

  it('フォームテンプレートが空でもエラーにならない', () => {
    expect(() =>
      buildExtractionPrompt({ formTemplate: [], clients: [], helpers: [] })
    ).not.toThrow();
  });
});
