import { describe, expect, it } from 'vitest';
import { buildOpenAIExtractionSchema } from './openaiSchema';
import type { FormItem } from './extractPrompt';

const template: FormItem[] = [
  { id: 'heading', label: '見出し', type: 'section', required: false },
  { id: 'checked', label: '確認', type: 'checkbox', required: false },
  { id: 'meal', label: '食事', type: 'multicheckbox', options: '朝,昼,晩', required: false, hasDetail: true },
  { id: 'amount', label: '数量', type: 'number', required: false },
  { id: 'choice', label: '選択', type: 'select', options: 'あり,なし', required: false },
];

describe('buildOpenAIExtractionSchema', () => {
  it('requires all form fields but allows unknown values to be null', () => {
    const root = buildOpenAIExtractionSchema(template);
    const records = (root.properties as Record<string, unknown>).records as Record<string, unknown>;
    const record = records.items as Record<string, unknown>;
    const properties = record.properties as Record<string, unknown>;
    const values = properties.values as Record<string, unknown>;
    const fields = values.properties as Record<string, Record<string, unknown>>;

    expect(root.additionalProperties).toBe(false);
    expect(record.additionalProperties).toBe(false);
    expect(values.additionalProperties).toBe(false);
    expect(values.required).toEqual(['checked', 'meal', 'meal_detail', 'amount', 'choice']);
    expect(fields.heading).toBeUndefined();
    expect(fields.checked.type).toEqual(['boolean', 'null']);
    expect(fields.meal.type).toEqual(['array', 'null']);
    expect(fields.meal.items).toEqual({ type: 'string', enum: ['朝', '昼', '晩'] });
    expect(fields.meal_detail.type).toEqual(['string', 'null']);
    expect(fields.amount.type).toEqual(['number', 'null']);
    expect(fields.choice.enum).toEqual(['あり', 'なし', null]);
  });

  it('requires nullable travel time in metadata', () => {
    const root = buildOpenAIExtractionSchema(template);
    const record = ((root.properties as Record<string, Record<string, unknown>>).records.items) as Record<string, unknown>;
    const meta = (record.properties as Record<string, Record<string, unknown>>).meta;
    expect(meta.required).toContain('travel_time_hours');
    expect((meta.properties as Record<string, Record<string, unknown>>).travel_time_hours.type).toEqual(['number', 'null']);
  });
});
