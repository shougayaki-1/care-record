// Run only against the dedicated disposable local Supabase stack. No cleanup deletes data.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.argv[2];
if (!/^supabase_db_care-record-mcp-stop-test-[a-z0-9]+$/.test(container ?? '')) {
  throw new Error('A dedicated disposable care-record-mcp-stop-test stack is required.');
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
const raw = readFileSync(new URL('../../supabase/tests/isolation/specs/mcp_import_stop.spec', import.meta.url), 'utf8');
const permutations = [...raw.matchAll(/^permutation (.+)$/gm)].map(([, line]) => [...line.matchAll(/"([^"]+)"/g)].map(m => m[1]));
assert.deepEqual(permutations, [
  ['begin_sender','send','begin_stopper','stop','commit_sender','commit_stopper','begin_sender_again','send_rejected','commit_sender_again'],
  ['begin_stopper','stop','begin_sender','send_rejected','commit_stopper','commit_sender'],
]);
for (let scenario = 0; scenario < 2; scenario++) {
  // Different synthetic ids allow both scenarios in the same disposable stack.
  const spec = scenario === 0 ? raw : raw.replaceAll('19200000', '19300000').replaceAll('mcp192', 'mcp193');
  const setup = spec.match(/^setup\s*\n\{([\s\S]*?)^\}\s*\nsession /m)?.[1];
  const steps = new Map([...spec.matchAll(/^step "([^"]+)" \{([\s\S]*?)\}\s*(?=\n(?:step |session |#|permutation )|$)/gm)].map(([, name, sql]) => [name, sql]));
  assert.ok(setup);
  for (const step of permutations[scenario]) assert.ok(steps.has(step), `Missing step ${step}`);
  query(setup);
  const sender = session('ci-mcp-sender');
  const stopper = session('ci-mcp-stopper');
  let pending;
  try {
    const first = scenario === 0 ? sender : stopper;
    const second = scenario === 0 ? stopper : sender;
    const names = permutations[scenario];
    await first.execute(steps.get(names[0]));
    await first.execute(steps.get(names[1]));
    await second.execute(steps.get(names[2]));
    pending = second.execute(steps.get(names[3]));
    pending.catch(() => {});
    const waiting = scenario === 0 ? 'ci-mcp-stopper' : 'ci-mcp-sender';
    const deadline = Date.now() + 10_000;
    while (query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${waiting}' AND wait_event_type='Lock'`) !== '1') {
      if (Date.now() > deadline) throw new Error(`${waiting} did not wait for lock`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await first.execute(steps.get(names[4]));
    await pending;
    await second.execute(steps.get(names[5]));
    if (scenario === 0) {
      await sender.execute(steps.get(names[6]));
      await sender.execute(steps.get(names[7]));
      await sender.execute(steps.get(names[8]));
    }
    const org = scenario === 0 ? '19200000-0000-4000-8000-000000000011' : '19300000-0000-4000-8000-000000000011';
    assert.equal(query(`SELECT count(*) FROM public.ai_import_candidates WHERE organization_id='${org}'`), scenario === 0 ? '1' : '0');
    assert.equal(query(`SELECT enabled FROM private.mcp_import_controls WHERE organization_id='${org}'`), 'f');
    assert.equal(query(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='integration.mcp_import.disable'`), '1');
    console.log(`PASS: ${scenario === 0 ? 'send then stop' : 'stop then send'} (real lock wait, result and audit)`);
  } finally {
    sender.close(); stopper.close();
    await pending?.catch(() => {});
  }
}
