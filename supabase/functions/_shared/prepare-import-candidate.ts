// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { buildClarificationQuestions } from './clarify-candidate.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { normalizeDate, normalizeTime, normalizeValues, type FormItem } from './validate-candidate.ts';

export type CandidateInput = {
  meta: { date: string | null; start_at: string | null; end_at: string | null; client_name: string | null; helper_names: string[]; travel_time_hours?: number | null };
  values: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
};

/** Keep single and batch submissions on the same normalization path. */
export function prepareImportCandidate(record: CandidateInput, template: FormItem[]) {
  const warnings = [...record.warnings];
  const payload = {
    meta: {
      date: normalizeDate(record.meta.date, warnings),
      start_at: normalizeTime(record.meta.start_at, '開始時刻', warnings),
      end_at: normalizeTime(record.meta.end_at, '終了時刻', warnings),
      client_name: record.meta.client_name,
      helper_names: record.meta.helper_names,
      client_id_candidate: null,
      helper_id_candidates: [],
      travel_time_hours: record.meta.travel_time_hours ?? null,
    },
    values: normalizeValues(record.values, template, warnings),
    confidence: record.confidence,
    warnings: [...new Set(warnings)].slice(0, 50),
  };
  return { payload, questions: buildClarificationQuestions(record, payload.warnings, template) };
}
