// Activates v2 ONLY in a guarded disposable local DB. Run last, then destroy stack.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const container = process.argv[2];
if (!/^supabase_db_care-record-(?:audit-v2-test|owner-add-test)(?:-[a-z0-9]+)?$/.test(container ?? '')) {
  throw new Error('Pass a dedicated disposable audit-v2-test or owner-add-test container.');
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
function sql(input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const sessions = [];
class Session {
  constructor(name) {
    this.name = name; this.output = ''; this.errors = ''; this.counter = 0;
    this.process = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    sessions.push(this);
    this.process.stdout.on('data', b => {
      this.output += b;
      if (this.pending && this.output.includes(this.pending.marker)) {
        clearTimeout(this.pending.timer); this.pending.resolve(this.output); this.pending = null;
      }
    });
    this.process.stderr.on('data', b => { this.errors += b; });
    this.exit = new Promise(resolve => this.process.on('close', code => {
      this.closed = true;
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error(this.errors || `psql exited ${code}`)); this.pending = null; }
      resolve(code);
    }));
  }
  query(command) {
    assert.ok(!this.pending, 'one pending query per connection');
    return new Promise((resolve, reject) => {
      const marker = `AUDIT149_${this.name}_${++this.counter}`;
      this.pending = { resolve, reject, marker, timer: setTimeout(() => {
        reject(new Error(`Query timed out: ${this.name}`)); this.process.kill();
      }, 20_000) };
      this.process.stdin.write(`${command}\nSELECT '${marker}';\n`);
    });
  }
  async begin(level = 'READ COMMITTED') {
    // Hosted/local postgres need not have SET privilege for deadlock_timeout.
    // Keep the server default; the statement budget still allows real 40P01.
    await this.query(`SET application_name='audit149-${this.name}'; SET statement_timeout='15s'; BEGIN ISOLATION LEVEL ${level};`);
  }
  async finish(commit = true) {
    await this.query(commit ? 'COMMIT;' : 'ROLLBACK;'); this.process.stdin.end();
    assert.equal(await this.exit, 0, this.errors);
  }
}
const org = n => `149cc000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const insert = (n, action = 'fixture.concurrent') => `INSERT INTO public.audit_events(organization_id,action_type,resource_type) VALUES('${org(n)}','${action}','test');`;
async function waiting(name) {
  const deadline = Date.now() + 10_000;
  while (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='audit149-${name}' AND wait_event_type='Lock';`) !== '1') {
    if (Date.now() > deadline) throw new Error(`No real lock wait for ${name}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
function consistent() {
  assert.equal(sql(`SELECT bool_and(ok) FROM (
    SELECT h.scope, h.last_sequence=count(e.id) AND min(e.chain_sequence)=1
      AND max(e.chain_sequence)=h.last_sequence AND count(DISTINCT e.chain_sequence)=count(e.id)
      AND h.last_hash=(array_agg(e.event_hash ORDER BY e.chain_sequence DESC))[1]
      AND bool_and(e.event_hash=encode(extensions.digest(private.audit_canonical_v2(e),'sha256'),'hex'))
      AND bool_and(e.previous_hash=CASE WHEN e.chain_sequence=1 THEN private.audit_genesis_v2(e.chain_cutover_id,e.chain_scope)
        ELSE (SELECT p.event_hash FROM public.audit_events p WHERE p.chain_scope=e.chain_scope AND p.chain_sequence=e.chain_sequence-1) END) AS ok
    FROM private.audit_chain_heads h LEFT JOIN public.audit_events e ON e.chain_scope=h.scope GROUP BY h.scope
  ) checks;`), 't');
}
try {
  sql(`BEGIN;
    INSERT INTO public.organizations(id,name) VALUES ${[1,2,3,4,5,6,7,8,9].map(n => `('${org(n)}','Synthetic concurrency ${n}')`).join(',')};
    DROP TRIGGER audit_events_chain_insert ON public.audit_events;
    CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events FOR EACH ROW
      EXECUTE FUNCTION private.chain_audit_event_v2('14900000-0000-4000-8000-000000000001');
    ALTER TABLE public.audit_events ALTER COLUMN integrity_version SET DEFAULT 2;
    COMMIT;`);
  // Check real COMMIT failures as well as pgTAP's SET CONSTRAINTS path.
  sql(`INSERT INTO public.audit_events(id,action_type,resource_type)
    VALUES('14900000-0000-4000-8000-000000000099','commit-conflict-base','test');`);
  assert.throws(() => sql(`BEGIN;
    INSERT INTO public.audit_events(id,action_type,resource_type) VALUES
      ('14900000-0000-4000-8000-000000000098','commit-before-conflict','test'),
      ('14900000-0000-4000-8000-000000000099','commit-conflict','test'),
      ('14900000-0000-4000-8000-000000000097','commit-after-conflict','test') ON CONFLICT(id) DO NOTHING;
    COMMIT;`), /audit_v2_missing_allocated_event/);
  assert.equal(sql("SELECT last_sequence FROM private.audit_chain_heads WHERE scope='global';"), '1');
  assert.equal(sql("SELECT count(*) FROM public.audit_events WHERE action_type IN ('commit-before-conflict','commit-after-conflict');"), '0');
  sql(`CREATE FUNCTION private.audit149_skip_fixture() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN IF NEW.action_type='commit-skip' THEN RETURN NULL; END IF; RETURN NEW; END $fn$;
    REVOKE ALL ON FUNCTION private.audit149_skip_fixture() FROM PUBLIC,anon,authenticated,service_role;
    CREATE TRIGGER z_audit149_skip BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION private.audit149_skip_fixture();`);
  assert.throws(() => sql(`BEGIN;
    INSERT INTO public.audit_events(action_type,resource_type) VALUES ('commit-skip','test'),('commit-after-skip','test');
    COMMIT;`), /audit_v2_missing_allocated_event/);
  assert.equal(sql("SELECT last_sequence FROM private.audit_chain_heads WHERE scope='global';"), '1');
  assert.throws(() => sql(`BEGIN;
    INSERT INTO public.audit_events(organization_id,action_type,resource_type) VALUES('${org(1)}','commit-skip','test');
    COMMIT;`), /audit_v2_missing_genesis_event/);
  assert.equal(sql(`SELECT count(*) FROM private.audit_chain_heads WHERE scope='org:${org(1)}';`), '0');
  consistent();
  console.log('PASS: real COMMIT rejects a skipped middle allocation and skipped first event, restoring events and heads');

  for (const rollback of [false, true]) {
    const n = rollback ? 2 : 1;
    const a = new Session(`new-${n}-a`), b = new Session(`new-${n}-b`);
    await a.begin(); await a.query(insert(n)); await b.begin();
    const pending = b.query(insert(n));
    await waiting(b.name); await a.finish(!rollback); await pending; await b.finish();
    assert.equal(sql(`SELECT last_sequence FROM private.audit_chain_heads WHERE scope='org:${org(n)}';`), rollback ? '1' : '2');
    consistent();
  }
  console.log('PASS: two real connections serialize new scope creation; rollback reuses sequence 1');

  const older = new Session('older'), newer = new Session('newer');
  await older.begin(); await older.query(insert(3)); await newer.begin(); await newer.query(insert(4));
  await newer.finish(); await older.finish(); consistent();
  console.log('PASS: independent scopes commit in reverse transaction order');

  // The earlier transaction's now() is older, but it appends after the newer
  // transaction commits. Sequence, never created_at/UUID, determines the chain.
  const early = new Session('early-start'), late = new Session('late-start');
  await early.begin(); await late.begin(); await late.query(insert(9));
  const earlyInsert = early.query(insert(9));
  await waiting(early.name); await late.finish(); await earlyInsert; await early.finish();
  assert.equal(sql(`SELECT a.created_at < b.created_at FROM public.audit_events a
    JOIN public.audit_events b ON a.chain_scope=b.chain_scope
    WHERE a.chain_scope='org:${org(9)}' AND a.chain_sequence=2 AND b.chain_sequence=1;`), 't');
  consistent();
  console.log('PASS: same-scope earlier transaction commits later; sequence follows committed head despite older timestamp');

  for (const level of ['REPEATABLE READ', 'SERIALIZABLE']) {
    const n = level === 'REPEATABLE READ' ? 5 : 6;
    sql(insert(n));
    const stale = new Session(`stale-${n}`); await stale.begin(level);
    await stale.query(`SELECT last_sequence FROM private.audit_chain_heads WHERE scope='org:${org(n)}';`);
    sql(insert(n));
    await assert.rejects(stale.query(insert(n)), /40001/); await stale.exit;
    // Entire transaction retry; no external effects are performed by this harness.
    const retry = new Session(`retry-${n}`); await retry.begin(level); await retry.query(insert(n)); await retry.finish();
    assert.equal(sql(`SELECT last_sequence FROM private.audit_chain_heads WHERE scope='org:${org(n)}';`), '3');
    consistent();
  }
  console.log('PASS: actual 40001 at RR and Serializable, followed by entire transaction retry');

  sql(insert(7) + insert(8));
  const a = new Session('deadlock-a'), b = new Session('deadlock-b');
  await a.begin(); await a.query(insert(7)); await b.begin(); await b.query(insert(8));
  const first = a.query(insert(8));
  // Attach rejection handling immediately; either connection may be the victim.
  const firstResult = first.then(() => ({ session: a }), error => ({ session: a, error }));
  await waiting(a.name);
  const secondResult = b.query(insert(7)).then(() => ({ session: b }), error => ({ session: b, error }));
  const results = await Promise.all([firstResult, secondResult]);
  const victim = results.find(r => r.error), survivor = results.find(r => !r.error);
  assert.ok(victim && survivor); assert.match(victim.error.message, /40P01/);
  await survivor.session.finish(); await victim.session.exit;
  const retry = new Session('deadlock-retry'); await retry.begin();
  await retry.query(victim.session === a ? insert(7) + insert(8) : insert(8) + insert(7)); await retry.finish();
  consistent();
  assert.equal(sql(`SELECT string_agg(last_sequence::text,',' ORDER BY scope) FROM private.audit_chain_heads WHERE scope IN ('org:${org(7)}','org:${org(8)}');`), '3,3');
  console.log('PASS: actual 40P01 across scopes rolls back the victim; whole transaction retry leaves no gap');
} finally {
  for (const s of sessions) if (!s.closed) { s.process.stdin.end(); s.process.kill(); }
}
