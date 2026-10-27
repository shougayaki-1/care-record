import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAuthLogs } from './auth-logs.mjs';

const config = { environment: 'staging', project: 'xhvvfovvlqzlkirpjocv', token: 'private-token', now: Date.parse('2026-10-27T01:00:00Z') };
test('requests only a bounded aggregate and returns allowlisted fields', async () => {
  const result = await collectAuthLogs({ ...config, fetcher: async (url, init) => {
    assert.equal(url.host, 'api.supabase.com');
    assert.match(url.searchParams.get('sql'), /^select countIf/);
    assert.equal(init.redirect, 'error');
    assert.equal(url.searchParams.get('iso_timestamp_start'), '2026-10-27T00:45:00Z');
    return Response.json({ result: [{ invalid_credentials: 51, extra: 'secret' }] });
  } });
  assert.deepEqual(result, { status: 'available', invalid_credentials: 51, start: '2026-10-27T00:45:00.000Z', end: '2026-10-27T01:00:00.000Z' });
});
test('rejects production and treats bad or missing responses as unavailable', async () => {
  await assert.rejects(collectAuthLogs({ ...config, environment: 'production' }));
  assert.equal((await collectAuthLogs({ ...config, environment: 'production', project: 'ougdmklcwargnmaphkdn', fetcher: async () => Response.json({ result: [{ invalid_credentials: 0 }] }) })).status, 'available');
  for (const response of [new Response(null, { status: 403 }), Response.json({ result: [] }), Response.json({ result: [{ invalid_credentials: -1 }] }), Response.json({ result: [{ invalid_credentials: '1' }] })]) {
    assert.deepEqual(await collectAuthLogs({ ...config, fetcher: async () => response }), { status: 'unavailable' });
  }
  assert.deepEqual(await collectAuthLogs({ ...config, fetcher: async () => { throw new Error('private'); } }), { status: 'unavailable' });
});
