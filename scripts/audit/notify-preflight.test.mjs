import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { notifyPreflightFailure } from './notify-preflight.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'shougayaki-1/care-record',
  GITHUB_SERVER_URL:'https://github.com',GITHUB_RUN_ID:'123',APP_ENV:'staging',DISCORD_ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/1/token'};
test('sends only a confirmed fixed-category alert without mentions',async () => {
  await notifyPreflightFailure(env,async (url,init) => {
    assert.equal(url.toString(),'https://discord.com/api/webhooks/1/token?wait=true'); assert.equal(init.redirect,'error');
    assert.deepEqual(JSON.parse(init.body),{content:'Critical | staging | unavailable | https://github.com/shougayaki-1/care-record/actions/runs/123',allowed_mentions:{parse:[]}});
    return Response.json({id:'123'});
  });
});
test('refuses unsafe configuration before sending and treats unconfirmed delivery as failure',async () => {
  for (const change of [{GITHUB_ACTIONS:''},{APP_ENV:'../secret'},{GITHUB_REPOSITORY:'other/repo'},
    {GITHUB_RUN_ID:'1/secret'},{DISCORD_ALERT_WEBHOOK_URL:'https://discord.com.evil.test/api/webhooks/1/token'}]) {
    await assert.rejects(notifyPreflightFailure({...env,...change},async () => {throw Error('unexpected');}));
  }
  for (const response of [new Response(null,{status:204}),Response.json({}),new Response('x'.repeat(65537))]) {
    await assert.rejects(notifyPreflightFailure(env,async () => response));
  }
});
