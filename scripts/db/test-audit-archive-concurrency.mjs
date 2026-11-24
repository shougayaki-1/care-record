// Synthetic fixtures only. Commits into a guarded disposable local stack; run
// after pgTAP, then destroy this stack. Never accepts a hosted DB URL.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const container = process.argv[2];
if (!/^supabase_db_care-record-audit-150-test$/.test(container ?? '')) throw new Error('Dedicated audit-150-test container required');
const args = ['exec','-i',container,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
function sql(input) {
  const result = spawnSync('docker',args,{input,encoding:'utf8',timeout:15000});
  if (result.error || result.status !== 0) throw new Error('local_archive_fixture_failed');
  return result.stdout.trim().split('\n').at(-1);
}
async function delayedCommit(action, afterInsert) {
  const child = spawn('docker',args,{stdio:['pipe','pipe','pipe']});
  let output=''; let resolve; let reject;
  const ready = new Promise((res,rej) => { resolve=res; reject=rej; });
  const timer=setTimeout(()=>reject(new Error('fixture_ready_timeout')),10000);
  child.stdout.on('data',chunk=>{ output+=chunk; if(output.includes('ARCHIVE_READY')) resolve(); });
  child.stderr.on('data',()=>{});
  const closed=new Promise(res=>child.on('close',res));
  child.stdin.write(`BEGIN; SET LOCAL statement_timeout='10s'; INSERT INTO public.audit_events(action_type,resource_type) VALUES('${action}','test'); SELECT 'ARCHIVE_READY';\n`);
  try {
    await ready; clearTimeout(timer);
    const frozen=afterInsert();
    child.stdin.end('COMMIT;\n');
    assert.equal(await closed,0);
    return frozen;
  } finally { clearTimeout(timer); if(child.exitCode===null) child.kill(); }
}
function count(run,action) {
  return sql(`SELECT count(*) FROM private.audit_archive_items WHERE run_id='${run}' AND kind IN ('v1','v2') AND (convert_from(decode(payload->>'inventory','base64'),'UTF8')::jsonb->>5)='${action}';`);
}
const v1 = await delayedCommit('fixture.late.v1',()=>sql('SELECT public.begin_audit_archive();'));
assert.equal(count(v1,'fixture.late.v1'),'0');
const next=sql('SELECT public.begin_audit_archive();');
assert.equal(count(next,'fixture.late.v1'),'1');
console.log('PASS: real v1 delayed commit is excluded from frozen run and preserved by next full inventory');
sql(`DROP TRIGGER audit_events_chain_insert ON public.audit_events;
CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION private.chain_audit_event_v2('15000000-0000-4000-8000-000000000001');
ALTER TABLE public.audit_events ALTER COLUMN integrity_version SET DEFAULT 2;
INSERT INTO public.audit_events(action_type,resource_type) VALUES('fixture.v2.initial','test');`);
const v2=await delayedCommit('fixture.late.v2',()=>sql(`SELECT public.begin_audit_archive('{"global":"1"}',false);`));
assert.equal(count(v2,'fixture.late.v2'),'0');
assert.equal(sql(`SELECT payload->>'sequence' FROM private.audit_archive_items WHERE run_id='${v2}' AND kind='head' AND scope='global';`),'1');
const second=sql(`SELECT public.begin_audit_archive('{"global":"1"}',false);`);
assert.equal(count(second,'fixture.late.v2'),'1');
assert.equal(sql(`SELECT payload->>'sequence' FROM private.audit_archive_items WHERE run_id='${second}' AND kind='head' AND scope='global';`),'2');
console.log('PASS: real v2 delayed commit advances event and fixed head together only in the next snapshot');
