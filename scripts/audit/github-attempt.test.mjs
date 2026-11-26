import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { attemptStartedAt } from './github-attempt.mjs';
const env={GITHUB_REPOSITORY:'shougayaki-1/care-record',GITHUB_API_URL:'https://api.github.com',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',GITHUB_TOKEN:'synthetic'};
const body={repository:{full_name:env.GITHUB_REPOSITORY},run_attempt:2,run_started_at:'2026-01-01T00:00:00Z'};
test('gets stable attempt timestamp using fixed GitHub endpoint and no redirect',async () => {
  let calls=0;
  const request=async (url,init) => {
    calls++; assert.equal(url.toString(),'https://api.github.com/repos/shougayaki-1/care-record/actions/runs/123/attempts/2?exclude_pull_requests=true');
    assert.equal(init.redirect,'error'); assert.equal(init.headers.authorization,'Bearer synthetic'); return Response.json(body);
  };
  assert.equal(await attemptStartedAt(env,request),'2026-01-01T00:00:00Z');
  assert.equal(await attemptStartedAt(env,request),'2026-01-01T00:00:00Z'); assert.equal(calls,2);
});
test('rejects invalid identity, attempt, timestamp, redirect and oversized responses',async () => {
  await assert.rejects(attemptStartedAt({...env,GITHUB_API_URL:'https://elsewhere.test'},async () => {throw Error('must not call');}));
  for (const data of [{...body,run_attempt:1},{...body,repository:{full_name:'other/repo'}},{...body,run_started_at:'2999-01-01T00:00:00Z'},{...body,run_started_at:'2026-02-31T00:00:00Z'},{}]) {
    await assert.rejects(attemptStartedAt(env,async () => Response.json(data)));
  }
  await assert.rejects(attemptStartedAt(env,async () => new Response('',{status:302,headers:{location:'https://elsewhere.test'}})));
  await assert.rejects(attemptStartedAt(env,async () => new Response('x'.repeat(256*1024+1))));
});
