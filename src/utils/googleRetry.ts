import 'server-only';

import { classifyGoogleError } from './googleSync';

export async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const syncError = classifyGoogleError(error);
      attempt += 1;
      if (
        attempt > retries
        || (syncError.kind !== 'rate_limit' && syncError.kind !== 'transient')
      ) throw syncError;
      const backoff = Math.min(8000, 400 * 2 ** (attempt - 1))
        + Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}
