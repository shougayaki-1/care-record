import { z } from 'zod';
import { Type, type Schema } from '@google/genai';
import type { FormItem } from './extractPrompt';

/** メタ情報（記録ヘッダー） */
export const MetaSchema = z.object({
  date: z.string().nullable().describe('記録日 "YYYY-MM-DD" 形式。不明なら null'),
  start_at: z.string().nullable().describe('開始時刻 "HH:MM" 形式。不明なら null'),
  end_at: z.string().nullable().describe('終了時刻 "HH:MM" 形式。不明なら null'),
  client_name: z.string().nullable().describe('利用者名（候補照合用）。不明なら null'),
  helper_names: z.array(z.string()).describe('スタッフ名リスト（候補照合用）'),
  client_id_candidate: z.string().nullable().describe('利用者候補ID。一致候補がなければ null'),
  helper_id_candidates: z.array(z.string()).describe('スタッフ候補IDリスト。一致候補がなければ []'),
  travel_time_hours: z.number().finite().nonnegative().nullable().optional().describe('紙面の移動(加算)時間。読めなければ null'),
});

export type Meta = z.infer<typeof MetaSchema>;

/** フォーム値（report_valuesのdataカラムに対応） */
export const FormValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
);

export type FormValues = z.infer<typeof FormValuesSchema>;

/** 1件の抽出結果 */
export const ExtractionResultSchema = z.object({
  meta: MetaSchema,
  values: FormValuesSchema,
  confidence: z.enum(['high', 'medium', 'low']).describe('AIの読み取り確信度'),
  warnings: z.array(z.string()).describe('読み取れなかった・不明確だったフィールド一覧'),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/** 複数件の抽出結果（PDFが複数記録を含む場合） */
export const ExtractionResponseSchema = z.object({
  records: z.array(ExtractionResultSchema),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

/** Model output is untrusted until each value has been checked against the active form. */
export const RawExtractionResponseSchema = z.object({
  records: z.array(ExtractionResultSchema.extend({
    values: z.record(z.string(), z.unknown()),
  })),
});

export type RawExtractionResult = z.infer<typeof RawExtractionResponseSchema>['records'][number];

export const ExtractionResponseVertexSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    records: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          meta: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING, nullable: true },
              start_at: { type: Type.STRING, nullable: true },
              end_at: { type: Type.STRING, nullable: true },
              client_name: { type: Type.STRING, nullable: true },
              helper_names: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              client_id_candidate: { type: Type.STRING, nullable: true },
              helper_id_candidates: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              travel_time_hours: { type: Type.NUMBER, nullable: true },
            },
            required: [
              'date',
              'start_at',
              'end_at',
              'client_name',
              'helper_names',
              'client_id_candidate',
              'helper_id_candidates',
            ],
          },
          values: {
            type: Type.OBJECT,
            description: 'report_values.data に保存するフィールドIDと値のオブジェクト',
          },
          confidence: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['meta', 'values', 'confidence', 'warnings'],
      },
    },
  },
  required: ['records'],
};

/** Build a concrete values schema; an unconstrained OBJECT can yield empty values. */
export function buildExtractionResponseVertexSchema(template: FormItem[]): Schema {
  const valueProperties: Record<string, Schema> = {};
  for (const item of template) {
    if (item.type === 'section') continue;
    const options = (item.options ?? '').split(',').map((option) => option.trim()).filter(Boolean);
    const description = `紙面の「${item.label}」。不明または空欄なら null`;
    switch (item.type) {
      case 'checkbox':
        valueProperties[item.id] = { type: Type.BOOLEAN, nullable: true, description };
        break;
      case 'multicheckbox':
        valueProperties[item.id] = {
          type: Type.ARRAY, nullable: true, description,
          items: { type: Type.STRING, ...(options.length ? { enum: options } : {}) },
        };
        break;
      case 'number':
        valueProperties[item.id] = { type: Type.NUMBER, nullable: true, description };
        break;
      case 'select':
        valueProperties[item.id] = {
          type: Type.STRING, nullable: true, description,
          ...(options.length ? { enum: options } : {}),
        };
        break;
      case 'time':
        valueProperties[item.id] = { type: Type.STRING, nullable: true, description: `${description}。HH:MM形式` };
        break;
      case 'text':
        valueProperties[item.id] = { type: Type.STRING, nullable: true, description };
        break;
    }
    if (item.hasDetail) {
      valueProperties[`${item.id}_detail`] = {
        type: Type.STRING, nullable: true,
        description: `紙面の「${item.label}」に関する手書きの詳細。なければ null`,
      };
    }
  }

  const recordSchema = ExtractionResponseVertexSchema.properties?.records.items;
  return {
    type: Type.OBJECT,
    properties: {
      records: {
        type: Type.ARRAY,
        items: {
          ...recordSchema,
          type: Type.OBJECT,
          properties: {
            ...recordSchema?.properties,
            values: {
              type: Type.OBJECT,
              properties: valueProperties,
              required: Object.keys(valueProperties),
            },
          },
        },
      },
    },
    required: ['records'],
  };
}
