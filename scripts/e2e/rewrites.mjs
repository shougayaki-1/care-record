import { assertLocalSupabaseEnvironment } from './local-environment.mjs';

export const e2eApiPath = '/api/e2e-supabase';
export const e2eAppOrigin = 'http://127.0.0.1:3000';

/** @param {Record<string, string | undefined>} env */
export function localE2ERewrites(env) {
  if (env.E2E_TEST_ENV !== 'true') return [];
  if (env.APP_ENV !== 'test') throw new Error('The E2E rewrite is restricted to APP_ENV=test.');
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `${e2eAppOrigin}${e2eApiPath}`) {
    throw new Error('The E2E browser must use the runner-controlled same-origin API path.');
  }
  const value = env.E2E_SUPABASE_TARGET_URL;
  if (!value) throw new Error('The E2E runner must provide its disposable Supabase target.');
  assertLocalSupabaseEnvironment({ NEXT_PUBLIC_SUPABASE_URL: value });
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/' || target.search || target.hash
      || target.username || target.password || !target.port || target.port === '3000') {
    throw new Error('The E2E target must be a separate loopback API origin.');
  }
  return [{ source: `${e2eApiPath}/:path*`, destination: `${target.origin}/:path*` }];
}
