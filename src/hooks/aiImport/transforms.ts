import type { ReviewRow } from '@/components/ui/AiImportReviewTable';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import type { saveReport } from '@/app/actions/reports';

export type FileEntry = {
  id: string;
  file: File;
  groupId: string | null; // null = ungrouped, string = group UUID
  previewUrl: string | null;
};

export type FileGroup = {
  id: string;
  fileIds: string[];
};

export type Candidate = { id: string; name: string };

/** AIの名前照合: 候補リストからファジー一致でIDを返す */
function matchName(aiName: string, candidates: Candidate[]): string | null {
  if (!aiName) return null;
  const found = candidates.find(
    (c) => c.name.includes(aiName) || aiName.includes(c.name),
  );
  return found?.id ?? null;
}

function pickCandidateId(candidateId: string | null | undefined, candidates: Candidate[]): string | null {
  if (!candidateId) return null;
  return candidates.some((candidate) => candidate.id === candidateId) ? candidateId : null;
}

function pickFirstCandidateId(candidateIds: string[] | undefined, candidates: Candidate[]): string | null {
  for (const candidateId of candidateIds ?? []) {
    const matched = pickCandidateId(candidateId, candidates);
    if (matched) return matched;
  }
  return null;
}

export function buildProcessingGroups(fileEntries: FileEntry[], groups: FileGroup[]): number[][] {
  const groupedIndices = new Set<number>();
  const result: number[][] = [];

  for (const group of groups) {
    const indices = group.fileIds
      .map((fid) => fileEntries.findIndex((entry) => entry.id === fid))
      .filter((index) => index >= 0);
    if (indices.length > 0) {
      indices.forEach((index) => groupedIndices.add(index));
      result.push(indices);
    }
  }

  fileEntries.forEach((_, index) => {
    if (!groupedIndices.has(index)) result.push([index]);
  });

  return result;
}

export function isValidDraftTime(date: string, startAt: string, endAt: string): boolean {
  const start = new Date(`${date}T${startAt}:00`);
  const end = new Date(`${date}T${endAt}:00`);
  return Boolean(date && startAt && endAt && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start);
}

export function toReviewRow(id: string, result: ExtractionResult, fileIndex: number, orderedEntries: FileEntry[], processingGroups: number[][], clients: Candidate[], helpers: Candidate[]): ReviewRow {
  const aiMeta = result.meta;
  const clientId =
    pickCandidateId(aiMeta.client_id_candidate, clients) ??
    matchName(aiMeta.client_name, clients);
  const helperId =
    pickFirstCandidateId(aiMeta.helper_id_candidates, helpers) ??
    (aiMeta.helper_names.length > 0
      ? matchName(aiMeta.helper_names[0], helpers)
      : null);

  const row: ReviewRow = {
    id,
    fileIndex,
    fileName: orderedEntries[fileIndex]?.file.name ?? '',
    fileType: orderedEntries[fileIndex]?.file.type ?? '',
    previewUrl: orderedEntries[fileIndex]?.previewUrl ?? null,
    fileCount: processingGroups.find((group) => group[0] === fileIndex)?.length ?? 1,
    result,
    date: aiMeta.date,
    startAt: aiMeta.start_at,
    endAt: aiMeta.end_at,
    clientId,
    helperId,
    status: 'pending',
  };
  return row;
}

export function toErrorRow(id: string, message: string, fileIndex: number, orderedEntries: FileEntry[], processingGroups: number[][]): ReviewRow {
  const row: ReviewRow = {
    id,
    fileIndex,
    fileName: orderedEntries[fileIndex]?.file.name ?? '',
    fileType: orderedEntries[fileIndex]?.file.type ?? '',
    previewUrl: orderedEntries[fileIndex]?.previewUrl ?? null,
    fileCount: processingGroups.find((group) => group[0] === fileIndex)?.length ?? 1,
    result: null,
    errorMessage: message,
    date: '',
    startAt: '',
    endAt: '',
    clientId: null,
    helperId: null,
    status: 'error',
  };
  return row;
}

export function buildSavePayload(row: ReviewRow | undefined, organizationId: string, clients: Candidate[], helpers: Candidate[]) {
  if (!row || !row.clientId || !clients.some((client) => client.id === row.clientId)) throw new Error('利用者が未選択です');
  if (!row.helperId) throw new Error('スタッフが未選択です');
  if (!row.result) throw new Error('読み取り結果がありません');
  if (!isValidDraftTime(row.date, row.startAt, row.endAt)) {
    throw new Error('開始・終了日時が不正です');
  }
  const helper = helpers.find((h) => h.id === row.helperId);
  if (!helper) throw new Error('スタッフが未選択です');

  const date = row.date;
  const startAt = `${date}T${row.startAt}:00`;
  const endAt = `${date}T${row.endAt}:00`;

  return {
    organizationId,
    clientId: row.clientId,
    startAt,
    endAt,
    status: 'draft',
    values: { ...row.result.values, _helpers: [helper.name] },
    expectedVersion: 0,
    auditSource: 'ai_import',
    auditFileCount: row.fileCount,
  } satisfies Omit<Parameters<typeof saveReport>[0], 'idempotencyKey'>;
}
