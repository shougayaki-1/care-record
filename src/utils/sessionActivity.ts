export type SessionActivityResult =
  | { status: 'ready' }
  | { status: 'invalid_session' }
  | { status: 'transient_error' };

export function classifySessionActivityAuthentication(
  authErrorStatus: number | null,
  hasUser: boolean,
  hadAuthError = false,
): SessionActivityResult {
  if (hadAuthError) {
    return authErrorStatus !== null && authErrorStatus >= 400 && authErrorStatus < 500
      ? { status: 'invalid_session' }
      : { status: 'transient_error' };
  }
  return hasUser ? { status: 'ready' } : { status: 'invalid_session' };
}

const RETRY_DELAY_MS = 200;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A just-created organization can briefly be unavailable while its session activity
 * record propagates. Retry only that recoverable condition, never an invalid token.
 */
export async function ensureSessionActivityWithRetry(
  ensure: () => Promise<SessionActivityResult>,
  maxRetries = 3,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<SessionActivityResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await ensure();
    if (result.status !== 'transient_error' || attempt === maxRetries) return result;
    await sleep(RETRY_DELAY_MS);
  }

  // The loop always returns, but keep TypeScript's control-flow analysis explicit.
  return { status: 'transient_error' };
}
