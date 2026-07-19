import type { Json } from './database.generated';

/** Converts validated application payloads to the JSON shape accepted by Supabase. */
export function asJson(value: unknown): Json {
  return value as Json;
}

export function asJsonRecord(value: Json): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : null;
}

/**
 * Supabase's generated function types do not express nullable SQL arguments.
 * Keep the named argument present as JSON null so PostgREST can resolve the
 * exact function signature while preserving type checking for argument names.
 */
export function asNullableRpcArg<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}
