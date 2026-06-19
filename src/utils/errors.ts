import 'server-only';

// Server Action のエラー秘匿（3省2ガイドライン: 多層防御 / 情報露出の防止）。
// 想定済みの利用者向けメッセージ（認可エラー等）はそのまま返してよいが、
// 想定外の内部エラー（DBメッセージ・スタックなど）はクライアントへ反射させず、
// サーバーログにのみ詳細を残し、利用者には汎用メッセージを返す。

/**
 * 利用者に提示してよい想定済みエラー。これを throw したものは withSafeError でそのまま通す。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const GENERIC_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';

// 認可・入力検証として既存コードが throw している定型メッセージ。
// これらは利用者向けに安全なので、移行期間中は素通しする。
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
 * Server Action 本体を包み、想定外エラーを汎用メッセージへ置き換える。
 * 詳細は console.error に残す（監査が必要な操作は呼び出し側で recordAuditEvent すること）。
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
export function sanitizeDbError(error: unknown, context = 'db'): Error {
  console.error(`[db:${context}]`, error);
  return new Error(GENERIC_MESSAGE);
}

export async function withSafeError<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UserFacingError || isSafeMessage(message)) {
      throw err instanceof Error ? err : new Error(message);
    }
    // 想定外: 内部詳細はサーバーログにのみ残し、利用者には汎用メッセージを返す。
    console.error(`[action:${context}]`, err);
    throw new Error(GENERIC_MESSAGE);
  }
}
