import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWatchdog } from './watchdog.mjs';
const now = Date.parse('2026-10-26T01:00:00Z');
const run = { id: 123, created_at: '2026-10-26T00:55:00Z', status: 'completed', event: 'schedule', head_branch: 'main' };
async function check(runs, steps, conclusion = 'success') {
  return checkWatchdog({ environment: 'staging', token: 'synthetic', now, fetcher: async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, 'Bearer synthetic');
    return new Response(JSON.stringify(url.includes('/jobs?') ? { jobs: [{ name: 'monitor (staging)', conclusion, steps }] } : { workflow_runs: runs }));
  } });
}
test('watchdog requires recent main environment job AND successful collection step', async () => {
  const step = { name: 'Collect counts and deliver pending alerts', conclusion: 'success' };
  assert.equal(await check([run], [step]), true);
  assert.equal(await check([run], [{ ...step, conclusion: 'skipped' }]), false);
  assert.equal(await check([run], [step], 'failure'), false);
  assert.equal(await check([{ ...run, head_branch: 'feature/test' }], [step]), false);
  assert.equal(await check([{ ...run, created_at: '2026-10-26T00:00:00Z' }], [step]), false);
  assert.equal(await check([], []), false);
});
test('watchdog API denial or missing response is a failure, not healthy zero', async () => {
  for (const status of [403, 404, 429, 500]) await assert.rejects(checkWatchdog({ environment: 'staging', token: 'synthetic', now,
    fetcher: async () => new Response(null, { status }) }));
  await assert.rejects(checkWatchdog({ environment: 'staging', token: 'synthetic', now, fetcher: async () => new Response('{}') }));
});
