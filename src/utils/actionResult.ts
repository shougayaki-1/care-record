import type { ActionErrorCode, ActionResult } from '@/types/actionResult';

const GENERIC_MESSAGE = '処理に失敗しました。時間をおいて再度お試しください。';

/** A local UI error created from public result data, never from a server exception. */
export class ActionResultError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ActionResultError';
  }
}

export function getActionErrorMessage(error: unknown, fallback = GENERIC_MESSAGE): string {
  return error instanceof ActionResultError ? error.message : fallback;
}

export function needsActionRecovery(error: unknown): boolean {
  return error instanceof ActionResultError
    && (error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED');
}

/** Preserve existing async UI flows while making rejection messages safe and codes available. */
export async function readActionResult<T, Code extends string = ActionErrorCode>(
  request: Promise<ActionResult<T, Code>>,
): Promise<T> {
  let result: ActionResult<T, Code>;
  try {
    result = await request;
  } catch {
    throw new ActionResultError('UNEXPECTED_ERROR', GENERIC_MESSAGE);
  }
  if (!result.ok) throw new ActionResultError(result.error.code, result.error.message);
  return result.data;
}
