import { z } from 'zod';
import { SchemaType, type ResponseSchema } from '@google-cloud/vertexai';

/** メタ情報（記録ヘッダー） */
export const MetaSchema = z.object({
  date: z.string().describe('記録日 "YYYY-MM-DD" 形式'),
  start_at: z.string().describe('開始時刻 "HH:MM" 形式'),
  end_at: z.string().describe('終了時刻 "HH:MM" 形式'),
  client_name: z.string().describe('利用者名（候補照合用）'),
  helper_names: z.array(z.string()).describe('スタッフ名リスト（候補照合用）'),
  client_id_candidate: z.string().nullable().describe('利用者候補ID。一致候補がなければ null'),
  helper_id_candidates: z.array(z.string()).describe('スタッフ候補IDリスト。一致候補がなければ []'),
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

export const ExtractionResponseVertexSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    records: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          meta: {
            type: SchemaType.OBJECT,
            properties: {
              date: { type: SchemaType.STRING },
              start_at: { type: SchemaType.STRING },
              end_at: { type: SchemaType.STRING },
              client_name: { type: SchemaType.STRING },
              helper_names: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
              },
              client_id_candidate: { type: SchemaType.STRING, nullable: true },
              helper_id_candidates: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
              },
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
            type: SchemaType.OBJECT,
            description: 'report_values.data に保存するフィールドIDと値のオブジェクト',
          },
          confidence: {
            type: SchemaType.STRING,
            enum: ['high', 'medium', 'low'],
          },
          warnings: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
        },
        required: ['meta', 'values', 'confidence', 'warnings'],
      },
    },
  },
  required: ['records'],
};
