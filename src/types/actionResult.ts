/** Expected states cross the Server Action boundary as plain data, never as thrown errors. */
export type ActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'REAUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT'
  | 'STAFF_NOT_LINKED'
  | 'NOT_FOUND'
  | 'NOT_CONFIGURED'
  | 'UNEXPECTED_ERROR';

export type ActionResult<T, Code extends string = ActionErrorCode> =
  | { ok: true; data: T }
  | { ok: false; error: { code: Code; message: string } };
