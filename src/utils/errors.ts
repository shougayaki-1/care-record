import 'server-only';

import { logError, serializeError } from '@/utils/log';
import type { ActionErrorCode, ActionResult } from '@/types/actionResult';

// Server Action のエラー秘匿（3省2ガイドライン: 多層防御 / 情報露出の防止）。
// 想定済み状態は ActionResult 等のシリアライズ可能な戻り値で明示的に返す。
// throw されたメッセージは安全化しても production の Next.js/React により秘匿される。
// 想定外の内部エラー（DBメッセージ・スタックなど）はクライアントへ反射させず、
// サーバーログにのみ詳細を残し、利用者には汎用メッセージを返す。

/**
 * 旧コード・型との互換性のための基底クラス。単独では公開可能な状態とみなさない。
 * 明示したcodeを持つExpectedActionErrorだけをwithActionResultで結果データへ変換する。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Only explicitly classified application states may become public result data. */
export class ExpectedActionError extends UserFacingError {
  constructor(readonly code: Exclude<ActionErrorCode, 'UNEXPECTED_ERROR'>, message: string) {
    super(message);
    this.name = 'ExpectedActionError';
  }
}

/** Server-to-server callers keep the same classified state without nesting result envelopes. */
export async function requireActionResult<T>(request: Promise<ActionResult<T>>): Promise<T> {
  const result = await request;
  if (result.ok) return result.data;
  if (result.error.code === 'UNEXPECTED_ERROR') throw new Error(GENERIC_MESSAGE);
  throw new ExpectedActionError(result.error.code, result.error.message);
}

export async function withActionResult<T>(
  context: string,
  fn: () => Promise<T>,
  opts: LogOptions = {},
): Promise<ActionResult<T>> {
  try {
    const data = await withSafeError(context, fn, opts);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ExpectedActionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: GENERIC_MESSAGE } };
  }
}

const GENERIC_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';

/**
 * Server Action 本体を包み、想定外エラーを汎用メッセージへ置き換える。
 * 詳細はサーバーログに残す（監査が必要な操作は呼び出し側で recordAuditEvent すること）。
 * エラー transport ではない。Client Component は catch した e.message を表示せず
 * 汎用エラーを表示し、想定済み状態は Action の戻り値で判定すること。
 *
 * 使い方:
 *   export const doThing = (input) => withSafeError('doThing', async () => { ... });
 */
/**
 * DB/外部APIのエラーをサニタイズして返す。生のエラー詳細はサーバーログにのみ残し、
 * 利用者には汎用メッセージを返す（DBスキーマやSQL断片の露出を防ぐ）。
 *
 * 使い方:  if (error) throw sanitizeDbError(error, 'updateOrganizationName');
 */
export type LogOptions = { organizationId?: string | null };

export function sanitizeDbError(error: unknown, context = 'db', opts: LogOptions = {}): Error {
  logError(`[db:${context}]`, { organizationId: opts.organizationId, error: serializeError(error) });
  return new Error(GENERIC_MESSAGE);
}

export type SafeExternalErrorDetails = {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
};

/** 外部SDKエラーから認証情報・request/response本文を除外したログ項目だけを取り出す。 */
export function getSafeExternalErrorDetails(error: unknown): SafeExternalErrorDetails {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: 'Unknown external error' };
  const candidate = error as Error & { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number' ? candidate.code : undefined;
  const rawStatus = candidate.status ?? candidate.response?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  return {
    name: error.name || 'Error',
    message: error.message
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:access_token|refresh_token|id_token)=)[^&\s]+/gi, '$1[REDACTED]')
      .slice(0, 500),
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

export function logExternalError(context: string, error: unknown, opts: LogOptions = {}): void {
  logError(`[external:${context}]`, { organizationId: opts.organizationId, ...getSafeExternalErrorDetails(error) });
}

export function sanitizeExternalError(error: unknown, context: string, opts: LogOptions = {}): Error {
  logExternalError(context, error, opts);
  return new Error(GENERIC_MESSAGE);
}

export async function withSafeError<T>(context: string, fn: () => Promise<T>, opts: LogOptions = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ExpectedActionError) {
      throw err;
    }
    // 想定外: 内部詳細はサーバーログにのみ残し、利用者には汎用メッセージを返す。
    logError(`[action:${context}]`, { organizationId: opts.organizationId, error: serializeError(err) });
    throw new Error(GENERIC_MESSAGE);
  }
}
