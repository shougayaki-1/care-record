/**
 * AI取込 Route Handler のファイル検証ロジック（純粋関数）
 * Server Action・Route Handlerに依存しないため単体テスト可能。
 */

export const MAX_FILES = 100;
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export type AllowedMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

export type FileValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * ファイル数の上限を検証する。
 * MAX_FILES を超える場合は400レスポンス相当のエラー。
 */
export function validateFileCount(count: number): FileValidationResult {
  if (count === 0) return { ok: false, reason: 'ファイルが指定されていません' };
  if (count > MAX_FILES) {
    return { ok: false, reason: `1リクエストあたり最大${MAX_FILES}ファイルまでです` };
  }
  return { ok: true };
}

/**
 * 個別ファイルの MIME タイプとサイズを検証する。
 * エラー時は SSE error イベントとして処理を継続するため、
 * ok:false + reason を返す（例外を throw しない）。
 */
export function validateFile(file: File): FileValidationResult {
  if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMimeType)) {
    return {
      ok: false,
      reason: `対応していないファイル形式です: ${file.type || '不明'}（PDF・JPEG・PNG・WebP のみ対応）`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      reason: `ファイルサイズが上限（20MB）を超えています: ${mb}MB`,
    };
  }
  return { ok: true };
}

/**
 * Gemini呼び出し単位のファイルグループを作る。
 * grouping指定時も未指定のファイルは単独グループとして残す。
 */
export function buildProcessingGroups(fileCount: number, grouping: number[][] | null): number[][] {
  if (!grouping || grouping.length === 0) {
    return Array.from({ length: fileCount }, (_, i) => [i]);
  }

  const used = new Set<number>();
  const groups: number[][] = [];

  for (const rawGroup of grouping) {
    const group = Array.from(
      new Set(rawGroup.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < fileCount)),
    );
    if (group.length === 0) continue;
    group.forEach((idx) => used.add(idx));
    groups.push(group);
  }

  for (let i = 0; i < fileCount; i++) {
    if (!used.has(i)) groups.push([i]);
  }

  return groups;
}
