import { describe, it, expect } from 'vitest';
import {
  MetaSchema,
  FormValuesSchema,
  ExtractionResultSchema,
  ExtractionResponseSchema,
  ExtractionResponseVertexSchema,
} from './extractSchema';

describe('MetaSchema', () => {
  it('正常なメタ情報をパースできる', () => {
    const input = {
      date: '2026-06-28',
      start_at: '09:00',
      end_at: '11:30',
      client_name: '山田太郎',
      helper_names: ['田中花子', '佐藤次郎'],
      client_id_candidate: 'client-1',
      helper_id_candidates: ['helper-1', 'helper-2'],
    };
    const result = MetaSchema.parse(input);
    expect(result.date).toBe('2026-06-28');
    expect(result.start_at).toBe('09:00');
    expect(result.end_at).toBe('11:30');
    expect(result.client_name).toBe('山田太郎');
    expect(result.helper_names).toEqual(['田中花子', '佐藤次郎']);
    expect(result.client_id_candidate).toBe('client-1');
    expect(result.helper_id_candidates).toEqual(['helper-1', 'helper-2']);
  });

  it('候補IDが null / 空配列でもパースできる', () => {
    const input = {
      date: '2026-01-01',
      start_at: '10:00',
      end_at: '12:00',
      client_name: 'テスト利用者',
      helper_names: [],
      client_id_candidate: null,
      helper_id_candidates: [],
    };
    expect(() => MetaSchema.parse(input)).not.toThrow();
  });

  it('必須フィールドが欠けていると失敗する', () => {
    const input = {
      date: '2026-06-28',
      // start_at missing
      end_at: '11:00',
      client_name: '山田太郎',
      helper_names: [],
      client_id_candidate: null,
      helper_id_candidates: [],
    };
    expect(() => MetaSchema.parse(input)).toThrow();
  });
});

describe('FormValuesSchema', () => {
  it('各種値の型を含む record をパースできる', () => {
    const input = {
      sputum_suction: true,
      meal_help: ['朝', '昼'],
      urine_disposal: 200,
      special_note: '特記事項テキスト',
      excretion: false,
    };
    const result = FormValuesSchema.parse(input);
    expect(result['sputum_suction']).toBe(true);
    expect(result['meal_help']).toEqual(['朝', '昼']);
    expect(result['urine_disposal']).toBe(200);
    expect(result['special_note']).toBe('特記事項テキスト');
    expect(result['excretion']).toBe(false);
  });

  it('空オブジェクトでもパースできる', () => {
    expect(() => FormValuesSchema.parse({})).not.toThrow();
  });
});

describe('ExtractionResultSchema', () => {
  const validResult = {
    meta: {
      date: '2026-06-28',
      start_at: '09:00',
      end_at: '11:00',
      client_name: '山田太郎',
      helper_names: ['田中花子'],
      client_id_candidate: 'client-1',
      helper_id_candidates: ['helper-1'],
    },
    values: {
      sputum_suction: true,
      meal_help: ['朝'],
      urine_disposal: 150,
      special_note: '',
    },
    confidence: 'high' as const,
    warnings: [],
  };

  it('正常な抽出結果をパースできる', () => {
    const result = ExtractionResultSchema.parse(validResult);
    expect(result.confidence).toBe('high');
    expect(result.warnings).toEqual([]);
    expect(result.meta.client_name).toBe('山田太郎');
  });

  it('confidence が medium / low でもパースできる', () => {
    expect(() =>
      ExtractionResultSchema.parse({ ...validResult, confidence: 'medium' })
    ).not.toThrow();
    expect(() =>
      ExtractionResultSchema.parse({ ...validResult, confidence: 'low' })
    ).not.toThrow();
  });

  it('confidence に不正な値があると失敗する', () => {
    expect(() =>
      ExtractionResultSchema.parse({ ...validResult, confidence: 'very-high' })
    ).toThrow();
  });

  it('warnings に文字列リストを含められる', () => {
    const withWarnings = {
      ...validResult,
      confidence: 'low' as const,
      warnings: ['vital_check が読み取れませんでした', 'date が不明瞭です'],
    };
    const result = ExtractionResultSchema.parse(withWarnings);
    expect(result.warnings).toHaveLength(2);
  });
});

describe('ExtractionResponseSchema', () => {
  it('複数の records を含む応答をパースできる', () => {
    const record = {
      meta: {
        date: '2026-06-28',
        start_at: '09:00',
        end_at: '11:00',
        client_name: '山田太郎',
        helper_names: [],
        client_id_candidate: null,
        helper_id_candidates: [],
      },
      values: { sputum_suction: false },
      confidence: 'medium' as const,
      warnings: [],
    };
    const input = { records: [record, { ...record, confidence: 'high' as const }] };
    const result = ExtractionResponseSchema.parse(input);
    expect(result.records).toHaveLength(2);
  });

  it('records が空でもパースできる', () => {
    const result = ExtractionResponseSchema.parse({ records: [] });
    expect(result.records).toEqual([]);
  });
});

describe('ExtractionResponseVertexSchema', () => {
  it('Vertex AI structured output 用の records スキーマを持つ', () => {
    expect(ExtractionResponseVertexSchema.type).toBe('OBJECT');
    expect(ExtractionResponseVertexSchema.required).toContain('records');
    expect(ExtractionResponseVertexSchema.properties?.records.type).toBe('ARRAY');
  });

  it('候補IDフィールドを required meta として定義している', () => {
    const recordItem = ExtractionResponseVertexSchema.properties?.records.items;
    const meta = recordItem?.properties?.meta;
    expect(meta?.required).toContain('client_id_candidate');
    expect(meta?.required).toContain('helper_id_candidates');
    expect(meta?.properties?.client_id_candidate.nullable).toBe(true);
  });
});
