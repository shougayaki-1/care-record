import { z } from 'zod';

/** メタ情報（記録ヘッダー） */
export const MetaSchema = z.object({
  date: z.string().describe('記録日 "YYYY-MM-DD" 形式'),
  start_at: z.string().describe('開始時刻 "HH:MM" 形式'),
  end_at: z.string().describe('終了時刻 "HH:MM" 形式'),
  client_name: z.string().describe('利用者名（候補照合用）'),
  helper_names: z.array(z.string()).describe('スタッフ名リスト（候補照合用）'),
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
