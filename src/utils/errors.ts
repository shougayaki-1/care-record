import 'server-only';

import { logError, serializeError } from '@/utils/log';
import { GENERIC_ACTION_ERROR_MESSAGE, type ActionErrorCode, type ActionResult } from '@/utils/actionResult';

// Server Action のエラー秘匿（3省2ガイドライン: 多層防御 / 情報露出の防止）。
// 想定済みの利用者向けメッセージは withActionResult の戻り値で返す。
// throw したメッセージは production の React/Next.js により秘匿されるため、
// withSafeError の rethrow をクライアントへのメッセージ伝達には使わない。
// 想定外の内部エラー（DBメッセージ・スタックなど）はクライアントへ反射させず、
// サーバーログにのみ詳細を残し、利用者には汎用メッセージを返す。

/**
 * サーバー内部で使う想定済みエラー。Server Action 境界では withActionResult で値に変換する。
 */
export class UserFacingError extends Error {
  constructor(message: string, public readonly code: Exclude<ActionErrorCode, 'UNEXPECTED_ERROR'> = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'UserFacingError';
  }
}

const GENERIC_MESSAGE = GENERIC_ACTION_ERROR_MESSAGE;

// 認可・入力検証として既存コードが throw している定型メッセージ。
// 旧 API の互換性のためだけに残す。withActionResult ではこの部分一致判定を使わない。
const SAFE_MESSAGE_PATTERNS = [
  '認証が必要です',
  '権限',
  'アクセス権',
  '不正',
  '見つかりません',
  '入力してください',
  '文字で',
];

function isSafeMessage(message: string): boolean {
  return SAFE_MESSAGE_PATTERNS.some((p) => message.includes(p));
}

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

/**
 * 旧 API の例外サニタイズ。戻り値の互換性維持のために残すが、
 * production で catch(e).message を UI 表示する契約ではない。
 * 新規・移行済みのクライアント向け Action は withActionResult を使う。
 */
export async function withSafeError<T>(context: string, fn: () => Promise<T>, opts: LogOptions = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UserFacingError || isSafeMessage(message)) {
      throw err instanceof Error ? err : new Error(message);
    }
    // 想定外: 内部詳細はサーバーログにのみ残し、利用者には汎用メッセージを返す。
    logError(`[action:${context}]`, { organizationId: opts.organizationId, error: serializeError(err) });
    throw new Error(GENERIC_MESSAGE);
  }
}

/** 明示したドメインエラーだけを公開し、内部例外は詳細ログと汎用結果に分ける。 */
export async function withActionResult<T>(context: string, fn: () => Promise<T>, opts: LogOptions = {}): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof UserFacingError) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    logError(`[action:${context}]`, { organizationId: opts.organizationId, error: serializeError(err) });
    return { ok: false, error: { code: 'UNEXPECTED_ERROR', message: GENERIC_MESSAGE } };
  }
}
