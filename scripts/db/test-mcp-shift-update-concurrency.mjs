// Run only against the dedicated disposable local Supabase stack. No cleanup deletes data.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const container = process.argv[2];
if (!/^supabase_db_care-record-180-template2$/.test(container ?? '')) {
  throw new Error('The dedicated disposable care-record-180-template2 stack is required.');
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
const fixture = readFileSync(new URL('../../supabase/tests/mcp_shift_update_confirm.test.sql', import.meta.url), 'utf8');
const prefix = fixture.slice(0, fixture.indexOf("select set_config('test.stale'"));
assert.ok(prefix.includes("select set_config('test.first'"));
for (let scenario = 0; scenario < 2; scenario++) {
  const id = randomBytes(4).toString('hex');
  const sql = prefix.replaceAll('18100000', id).replaceAll('mcp180-browser', `mcp${id}-browser`).replaceAll('mcp181@example.invalid', `mcp${id}@example.invalid`)
    .replace('create extension if not exists pgtap with schema extensions;', '')
    .replace('select plan(22);', '');
  const output = query(`${sql}\nselect current_setting('test.first'); commit;`);
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
    const first = scenario === 0 ? confirmer : stopper;
    const second = scenario === 0 ? stopper : confirmer;
    const confirm = `SELECT public.confirm_mcp_shift_update('${proposal}');`;
    const stop = `SELECT public.disable_mcp_shift_update('${org}');`;
    const reject = `DO $$ BEGIN BEGIN PERFORM public.confirm_mcp_shift_update('${proposal}'); RAISE EXCEPTION 'confirmation unexpectedly accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'proposal_unavailable' THEN RAISE; END IF; END; END $$;`;
    await first.execute(begin);
    await first.execute(scenario === 0 ? confirm : stop);
    await second.execute(begin);
    pending = second.execute(scenario === 0 ? stop : reject);
    pending.catch(() => {});
    const waiting = scenario === 0 ? 'ci-shift-stopper' : 'ci-shift-confirmer';
    const deadline = Date.now() + 4000;
    while (query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${waiting}' AND wait_event_type='Lock'`) !== '1') {
      if (Date.now() > deadline) throw new Error(`${waiting} did not wait for lock`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await first.execute('COMMIT;');
    await pending;
    await second.execute('COMMIT;');
    if (scenario === 0) {
      await confirmer.execute(begin);
      await confirmer.execute(reject);
      await confirmer.execute('COMMIT;');
    }
    assert.equal(query(`SELECT enabled FROM private.mcp_shift_update_controls WHERE organization_id='${org}'`), 'f');
    assert.equal(query(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='integration.mcp_shift_update.disable'`), '1');
    assert.equal(query(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='shift.update'`), scenario === 0 ? '1' : '0');
    assert.equal(query(`SELECT to_char(start_at AT TIME ZONE 'UTC','HH24:MI') FROM public.shifts WHERE id='${shift}'`), scenario === 0 ? '02:00' : '00:00');
    console.log(`PASS: ${scenario === 0 ? 'confirm then stop' : 'stop then confirm'} (real lock wait, state and audit)`);
  } finally {
    confirmer.close(); stopper.close();
    await pending?.catch(() => {});
  }
}
