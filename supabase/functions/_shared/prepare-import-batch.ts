// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { prepareImportCandidate, type CandidateInput } from './prepare-import-candidate.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import type { FormItem } from './validate-candidate.ts';

type BatchItem = { request_id: string; source_file_name?: string; record: CandidateInput | null; send_anyway: boolean; allow_duplicate: boolean };
type PendingItem = { input_index: number; request_id: string; source_file_name: string; payload: unknown; allow_duplicate: boolean };

export function prepareImportBatch(items: BatchItem[], template: FormItem[]) {
  const results: Record<string, unknown>[] = [];
  const pending: PendingItem[] = [];
  for (const [input_index, item] of items.entries()) {
    if (item.record === null) {
      results[input_index] = { request_id: item.request_id, status: 'invalid_input' };
      continue;
    }
    const { payload, questions } = prepareImportCandidate(item.record, template);
    if (questions.length && !item.send_anyway) {
      results[input_index] = { request_id: item.request_id, status: 'needs_clarification', questions };
    } else if (JSON.stringify(payload).length > 100000) {
      results[input_index] = { request_id: item.request_id, status: 'invalid_input' };
    } else {
      pending.push({ input_index, request_id: item.request_id, source_file_name: item.source_file_name ?? '', payload, allow_duplicate: item.allow_duplicate });
    }
  }
  return { results, pending };
}

/** Require one ordered response per submitted item before merging it into the input order. */
export function mergeImportBatchResults(results: Record<string, unknown>[], pending: PendingItem[], rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length !== pending.length) throw new Error('invalid_batch_response');
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || row.index !== index + 1
      || !['submitted', 'already_processed', 'possible_duplicate', 'request_conflict', 'invalid_input', 'limit_reached'].includes(row.status)) {
      throw new Error('invalid_batch_response');
    }
    const result: Record<string, unknown> = { status: row.status, request_id: pending[index].request_id };
    if (row.status === 'submitted' || row.status === 'already_processed') {
      if (typeof row.candidate_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.candidate_id)
        || typeof row.replayed !== 'boolean') throw new Error('invalid_batch_response');
      result.candidate_id = row.candidate_id;
      result.replayed = row.replayed;
    }
    results[pending[index].input_index] = result;
  }
  return results;
}
