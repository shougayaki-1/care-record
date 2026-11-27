import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './worker.mjs';
const now = Date.parse('2026-10-27T04:00:00Z');
const env = { GITHUB_DISPATCH_TOKEN: 'test-token', DISCORD_WEBHOOK_URL: 'https://example.test/webhook' };
function mock({ healthy = true, dispatch = true } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/runs?')) return Response.json({ workflow_runs: [{ id: 42, head_branch: 'main', status: 'completed', event: 'workflow_dispatch', created_at: new Date(now - 60000).toISOString() }] });
    if (url.includes('/jobs?')) return Response.json({ jobs: [{ name: 'monitor (production)', conclusion: 'success', steps: [{ name: 'Collect counts and deliver pending alerts', conclusion: healthy ? 'success' : 'skipped' }] }] });
    if (url.includes('/dispatches')) return new Response(null, { status: dispatch ? 204 : 403 });
    return new Response(null, { status: 204 });
  };
  return { calls, fetcher };
}
test('healthy collection dispatches without alert', async () => {
  const m = mock(); await run(env, m.fetcher, now);
  assert.equal(m.calls.length, 3);
  assert.ok(m.calls.every(call => call.options.redirect === 'manual'));
  assert.equal(JSON.parse(m.calls[2].options.body).ref, 'main');
});
test('skipped collection alerts and reports failure', async () => {
  const m = mock({ healthy: false }); await assert.rejects(run(env, m.fetcher, now));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
  assert.deepEqual(JSON.parse(m.calls.at(-1).options.body).allowed_mentions, { parse: [] });
});
test('dispatch failure alerts', async () => {
  const m = mock({ dispatch: false }); await assert.rejects(run(env, m.fetcher, now));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
});
test('read failures still attempt dispatch and alert', async () => {
  const m = mock();
  const fetcher = async (url, options) => url.includes('/runs?') ? new Response(null, { status: 503 }) : m.fetcher(url, options);
  await assert.rejects(run(env, fetcher, now));
  assert.ok(m.calls.some(call => call.url.includes('/dispatches')));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
});
test('old successful runs do not establish health', async () => {
  const m = mock();
  const fetcher = async (url, options) => url.includes('/runs?') ? Response.json({ workflow_runs: [{ id: 42, head_branch: 'main', status: 'completed', event: 'workflow_dispatch', created_at: new Date(now - 21 * 60000).toISOString() }] }) : m.fetcher(url, options);
  await assert.rejects(run(env, fetcher, now));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
});
test('oversized GitHub response fails closed and alerts', async () => {
  const m = mock();
  const fetcher = async (url, options) => url.includes('/runs?') ? new Response('x'.repeat(2_000_001)) : m.fetcher(url, options);
  await assert.rejects(run(env, fetcher, now));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
});

test('a redirect response is rejected and never followed', async () => {
  const m = mock();
  const fetcher = async (url, options) => url.includes('/dispatches') ? new Response(null, { status: 302, headers: { location: 'https://example.test/other' } }) : m.fetcher(url, options);
  await assert.rejects(run(env, fetcher, now));
  assert.equal(m.calls.at(-1).url, env.DISCORD_WEBHOOK_URL);
  assert.ok(m.calls.every(call => call.url !== 'https://example.test/other'));
});
