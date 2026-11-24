// Run only against the dedicated disposable local Supabase stack. No cleanup deletes data.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const container = process.argv[2];
if (!/^supabase_db_care-record-181-snapshot$/.test(container ?? '')) {
  throw new Error('The dedicated disposable care-record-181-snapshot stack is required.');
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'];
function query(sql) {
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8', timeout: 15_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function session(name) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; let sequence = 0;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.write(`SET application_name='${name}'; SET statement_timeout='15s';\n`);
  return {
    async execute(sql) {
      const marker = `STEP_COMPLETE_${++sequence}`;
      child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      const deadline = Date.now() + 20_000;
      while (!output.split(/\r?\n/).includes(marker)) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(errors || 'Session exited before its step completed');
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    },
    close() { child.stdin.end('ROLLBACK;\n\\q\n'); },
  };
}
const fixture = readFileSync(new URL('../../supabase/tests/mcp_shift_cancel_confirm.test.sql', import.meta.url), 'utf8');
const prefix = fixture.slice(0, fixture.indexOf("select set_config('test.stale'"));
assert.ok(prefix.includes("select set_config('test.cancel'"));
for (let scenario = 0; scenario < 4; scenario++) {
  const id = randomBytes(4).toString('hex');
  const firstConfirms = scenario % 2 === 0;
  const operation = scenario < 2 ? 'cancel' : 'soft_delete';
  const sql = prefix.replaceAll('18500000', id).replaceAll('cancel185-browser', `mcp${id}-browser`).replaceAll('mcp-cancel-confirm@example.invalid', `mcp${id}@example.invalid`)
    .replace('create extension if not exists pgtap with schema extensions;', '')
    .replace('select plan(19);', '').replace("'cancel','synthetic'", ` '${operation}','synthetic'`);
  const output = query(`${sql}\ninsert into public.retention_policies(organization_id,resource_type,retention_years,legal_basis,reviewed_at,reviewed_by) values ('${id}-0000-0000-0000-000000000002','shift',5,'synthetic',now(),'${id}-0000-0000-0000-000000000001'); select current_setting('test.cancel'); commit;`);
  const matches = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  assert.ok(matches?.length, 'fixture must produce a proposal id');
  const proposal = matches.at(-1);
  const org = `${id}-0000-0000-0000-000000000002`;
  const shift = `${id}-0000-0000-0000-000000000008`;
  const actor = `${id}-0000-0000-0000-000000000001`;
  const claims = JSON.stringify({sub:actor,role:'authenticated',session_id:`mcp${id}-browser`});
  const begin = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${claims}',true);`;
  const confirmer = session('ci-shift-confirmer');
  const stopper = session('ci-shift-stopper');
  let pending;
  try {
    const first = firstConfirms ? confirmer : stopper;
    const second = firstConfirms ? stopper : confirmer;
    const confirm = `SELECT public.confirm_mcp_shift_cancel('${proposal}');`;
    const stop = `SELECT public.disable_mcp_shift_cancel('${org}');`;
    const reject = `DO $$ BEGIN BEGIN PERFORM public.confirm_mcp_shift_cancel('${proposal}'); RAISE EXCEPTION 'confirmation unexpectedly accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'proposal_unavailable' THEN RAISE; END IF; END; END $$;`;
    await first.execute(begin);
    await first.execute(firstConfirms ? confirm : stop);
    await second.execute(begin);
    pending = second.execute(firstConfirms ? stop : reject);
    pending.catch(() => {});
    const waiting = firstConfirms ? 'ci-shift-stopper' : 'ci-shift-confirmer';
    const deadline = Date.now() + 4000;
    while (query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${waiting}' AND wait_event_type='Lock'`) !== '1') {
      if (Date.now() > deadline) throw new Error(`${waiting} did not wait for lock`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await first.execute('COMMIT;');
    await pending;
    await second.execute('COMMIT;');
    if (firstConfirms) {
      await confirmer.execute(begin);
      await confirmer.execute(reject);
      await confirmer.execute('COMMIT;');
    }
    assert.equal(query(`SELECT enabled FROM private.mcp_shift_cancel_controls WHERE organization_id='${org}'`), 'f');
    assert.equal(query(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='integration.mcp_shift_cancel.disable'`), '1');
    assert.equal(query(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='${operation === 'cancel' ? 'shift.cancel' : 'shift.bulk_soft_delete'}'`), firstConfirms ? '1' : '0');
    assert.equal(query(`SELECT status FROM public.shifts WHERE id='${shift}'`), firstConfirms && operation === 'cancel' ? 'cancelled' : 'published');
    assert.equal(query(`SELECT (deleted_at IS NOT NULL)::text FROM public.shifts WHERE id='${shift}'`), firstConfirms && operation === 'soft_delete' ? 'true' : 'false');
    console.log(`PASS: ${operation}, ${firstConfirms ? 'confirm then stop' : 'stop then confirm'} (real lock wait, state and audit)`);
  } finally {
    confirmer.close(); stopper.close();
    await pending?.catch(() => {});
  }
}
