import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalSupabaseEnvironment } from './local-environment.mjs';

const api = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };
const variables = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'API_URL',
  'SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'DB_URL'];

test('every API and database alias rejects hosted, malformed and deceptive URLs', () => {
  for (const name of variables) {
    for (const value of ['https://project.supabase.co', 'postgresql://db.example.com/app',
      'http://localhost.example.com', 'http://localhost@remote.example.com', 'not a URL']) {
      assert.throws(() => assertLocalSupabaseEnvironment({ ...api, [name]: value }), /loopback|localhost/);
    }
  }
});

test('loopback IPv4, IPv6 and localhost remain usable for disposable stacks', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.doesNotThrow(() => assertLocalSupabaseEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: `http://${host}:54321`,
      SUPABASE_DB_URL: `postgresql://postgres:synthetic@${host}:54322/postgres`,
    }));
  }
});

test('API is required after startup, and all inherited URLs are checked before startup', () => {
  assert.throws(() => assertLocalSupabaseEnvironment({}), /required/);
  assert.doesNotThrow(() => assertLocalSupabaseEnvironment({}, { requireApi: false }));
  assert.throws(() => assertLocalSupabaseEnvironment({ DATABASE_URL: 'postgresql://remote/db' },
    { requireApi: false }), /localhost/);
});
