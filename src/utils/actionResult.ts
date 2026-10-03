/** Server Action の戻り値。Error インスタンスや内部例外を含めない。 */
export type ActionErrorCode = 'STAFF_NOT_LINKED' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'UNEXPECTED_ERROR';

export type ActionError = { code: ActionErrorCode; message: string };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export const GENERIC_ACTION_ERROR_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';
