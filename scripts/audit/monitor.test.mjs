import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const script = new URL('./monitor.mjs', import.meta.url).href;
function run(body, status = 200, notificationStatus = 204) {
  const bootstrap = `globalThis.fetch=async(url,init)=>{
    if(new URL(url).hostname==='app.example.test') {
      if(init.redirect!=='error'||init.headers.authorization!=='Bearer synthetic') throw Error('private-error');
      return new Response(${JSON.stringify(body)},{status:${status}});
    }
    console.log(init.body); return new Response(null,{status:${notificationStatus}});
  }; await import(${JSON.stringify(script)});`;
  return spawnSync(process.execPath,['--input-type=module','-e',bootstrap],{encoding:'utf8',env:{
    APP_ENV:'staging', AUDIT_MONITOR_ORIGIN:'https://app.example.test', CRON_SECRET:'synthetic',
    DISCORD_ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/synthetic', EVIDENCE_URL:'https://github.com/example/repo/actions/runs/123',
  }});
}
test('successful independent health observation exits zero without a notification', () => {
  const result=run(JSON.stringify({ok:true,category:'archive_current'}));
  assert.equal(result.status,0); assert.equal(result.stdout,''); assert.equal(result.stderr,'');
});
test('stale/incomplete/unavailable send only a fixed classification and environment/run link', () => {
  for (const category of ['archive_stale','archive_incomplete','private-ID-secret']) {
    const result=run(JSON.stringify({ok:false,category,details:'private-ID-secret'}),503);
    assert.equal(result.status,1); assert.ok(!result.stdout.includes('private-ID-secret'));
    assert.ok(result.stdout.includes('Critical | staging | archive_'));
    assert.ok(!result.stdout.includes('synthetic')); assert.ok(!result.stderr.includes('private-ID-secret'));
  }
});
test('oversized response and notification failure cannot produce a success', () => {
  const result=run('x'.repeat(4097),503,500);
  assert.equal(result.status,1); assert.match(result.stderr,/audit_monitor_notification_failed/);
});
