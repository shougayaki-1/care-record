// Synthetic requests only. Snapshots remain in the disposable database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const container=process.argv[2];
if (!/^(?:supabase_db_care-record-(?:audit-verify-test|owner-add-test)(?:-[a-z0-9]+)?|supabase_db_care-record-213-raw)$/.test(container ?? '')) {
  throw new Error('Pass a dedicated disposable audit verification test container.');
}
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
function sql(input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:30_000});
  if (r.error || r.status!==0) throw new Error('Synthetic DB query failed');
  return r.stdout.trim();
}
if (container === 'supabase_db_care-record-213-raw') {
  assert.equal(sql("SELECT count(*) FROM public.audit_events WHERE action_type NOT LIKE 'synthetic.%';"),'0','raw fixture must contain only synthetic events');
}
const sessions=[];
class Session {
  constructor(name) {
    this.name=name; this.output=''; this.counter=0; this.proc=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
    sessions.push(this); this.proc.stdout.on('data',chunk => {
      this.output+=chunk;
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending=this.pending; this.pending=null; clearTimeout(pending.timer); pending.resolve(this.output);
      }
    });
    this.exit=new Promise(resolve => this.proc.on('close',code => {
      if (this.pending) { const pending=this.pending; this.pending=null; clearTimeout(pending.timer); pending.reject(new Error('Synthetic session ended')); }
      resolve(code);
    }));
  }
  query(command) {
    assert.ok(!this.pending);
    return new Promise((resolve,reject) => {
      const marker=`VERIFY152_${this.name}_${++this.counter}`;
      this.pending={marker,resolve,reject,timer:setTimeout(() => { this.proc.kill(); reject(new Error('Synthetic query timeout')); },20_000)};
      this.proc.stdin.write(`${command}\nSELECT '${marker}';\n`);
    });
  }
  async begin() { await this.query(`SET application_name='verify152-${this.name}'; SET statement_timeout='15s'; BEGIN;`); }
  async finish(commit) { await this.query(commit ? 'COMMIT;' : 'ROLLBACK;'); this.proc.stdin.end(); assert.equal(await this.exit,0); }
}
async function waitForLock(name) {
  const deadline=Date.now()+8000;
  while (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='verify152-${name}' AND wait_event_type='Lock';`) !== '1') {
    if (Date.now()>deadline) throw new Error('Expected concurrent request to wait on the lock');
    await new Promise(resolve => setTimeout(resolve,50));
  }
}
function runId(output) {
  const ids=output.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/gm) ?? [];
  assert.equal(ids.length,1,'expected one snapshot ID'); return ids[0];
}
try {
  const isolated=spawnSync('docker',args,{input:`BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT public.begin_audit_verification_request('${randomUUID()}','${'a'.repeat(64)}');`,encoding:'utf8',timeout:30_000});
  assert.notEqual(isolated.status,0,'unsupported isolation must fail');
  assert.match(isolated.stderr,/audit_verification_request_invalid/);
  for (const commit of [true,false]) {
    const request=randomUUID(), digest='a'.repeat(64);
    const a=new Session(commit?'commit-a':'rollback-a'),b=new Session(commit?'commit-b':'rollback-b');
    await a.begin();
    const first=runId(await a.query(`SELECT public.begin_audit_verification_request('${request}','${digest}');`));
    await b.begin();
    const waiting=b.query(`SELECT public.begin_audit_verification_request('${request}','${digest}');`);
    await waitForLock(b.name);
    await a.finish(commit);
    const second=runId(await waiting);
    await b.finish(true);
    if (commit) assert.equal(first,second,'committed concurrent retry must reuse the snapshot');
    else assert.notEqual(first,second,'retry after rollback must create a new snapshot');
    assert.equal(sql(`SELECT count(*) FROM private.audit_verification_requests WHERE request_id='${request}';`),'1');
    assert.equal(sql(`SELECT count(*) FROM private.audit_verification_requests r JOIN private.audit_archive_runs a ON a.id=r.run_id WHERE r.request_id='${request}' AND r.run_id='${second}';`),'1');
  }
  console.log('PASS: concurrent retry reuses the committed snapshot; rollback allows one new snapshot');
} finally {
  for (const session of sessions) if (!session.proc.killed && session.proc.exitCode===null) session.proc.kill();
}
