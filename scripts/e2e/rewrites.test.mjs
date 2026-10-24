import assert from 'node:assert/strict';
import test from 'node:test';
import { localE2ERewrites } from './rewrites.mjs';

test('normal builds have no E2E forwarding endpoint', () => {
  for (const APP_ENV of ['local', 'test', 'staging', 'production']) {
    assert.deepEqual(localE2ERewrites({ APP_ENV, E2E_SUPABASE_TARGET_URL: 'http://127.0.0.1:54321' }), []);
  }
});

test('only the runner-controlled test environment can forward to an exact local API origin', () => {
  const env = { APP_ENV: 'test', E2E_TEST_ENV: 'true', E2E_SUPABASE_TARGET_URL: 'http://127.0.0.1:55421',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3000/api/e2e-supabase' };
  assert.deepEqual(localE2ERewrites(env), [{ source: '/api/e2e-supabase/:path*', destination: 'http://127.0.0.1:55421/:path*' }]);
  for (const APP_ENV of ['local', 'staging', 'production']) assert.throws(() => localE2ERewrites({ ...env, APP_ENV }));
  for (const target of [undefined, 'https://project.supabase.co', 'http://localhost.remote',
    'http://localhost:3000', 'http://user:secret@localhost:54321', 'http://localhost:54321/path',
    'http://localhost:54321/?target=remote', 'http://localhost', 'file://localhost/', 'not-a-url']) {
    assert.throws(() => localE2ERewrites({ ...env, E2E_SUPABASE_TARGET_URL: target }));
  }
  for (const NEXT_PUBLIC_SUPABASE_URL of [undefined, 'https://project.supabase.co', 'http://127.0.0.1:55421']) {
    assert.throws(() => localE2ERewrites({ ...env, NEXT_PUBLIC_SUPABASE_URL }));
  }
});
