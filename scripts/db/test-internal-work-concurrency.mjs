// Execute the repository's three two-session permutations, never against a shared DB.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.argv[2];
if (!/^supabase_db_care-record-owner-add-test-[a-z0-9]+$/.test(container ?? '')) {
  throw new Error('A dedicated disposable care-record-owner-add-test stack is required.');
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-At', '-v', 'ON_ERROR_STOP=1'];
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

for (const filename of ['internal_work_idempotency', 'internal_work_idempotency_rollback', 'internal_work_idempotency_conflict']) {
  const spec = readFileSync(new URL(`../../supabase/tests/isolation/specs/${filename}.spec`, import.meta.url), 'utf8');
  const setup = spec.match(/^setup\s*\n\{([\s\S]*?)^\}\s*\nsession /m)?.[1];
  const steps = new Map([...spec.matchAll(/^step "([^"]+)" \{([\s\S]*?)\}\s*(?=\n(?:step |session |#|permutation )|$)/gm)]
    .map(([, name, sql]) => [name, sql]));
  const permutation = spec.match(/^permutation (.+)$/m)?.[1].match(/"([^"]+)"/g)?.map(name => name.slice(1, -1));
  const finish = filename.endsWith('_rollback') ? 'rollback_writer' : 'commit_writer';
  // This is deliberately a driver for these committed scenarios, not a general spec interpreter.
  assert.ok(setup, `Missing setup: ${filename}`);
  assert.deepEqual(permutation, ['begin_writer', 'save_writer', 'begin_retry', 'save_retry', finish, 'commit_retry', 'check']);
  for (const step of permutation) assert.ok(steps.has(step), `Missing ${step}: ${filename}`);
  query(setup);
  const writer = session('ci-internal-writer');
  const retry = session('ci-internal-retry');
  let pendingRetry;
  try {
    await writer.execute(steps.get('begin_writer'));
    await writer.execute(steps.get('save_writer'));
    await retry.execute(steps.get('begin_retry'));
    pendingRetry = retry.execute(steps.get('save_retry'));
    // Attach a handler immediately while the writer deliberately holds the lock.
    pendingRetry.catch(() => {});
    const deadline = Date.now() + 10_000;
    while (query("SELECT count(*) FROM pg_stat_activity WHERE application_name='ci-internal-retry' AND wait_event_type='Lock'") !== '1') {
      if (Date.now() > deadline) throw new Error('Retry did not wait for the writer lock');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await writer.execute(steps.get(finish));
    await pendingRetry;
    await retry.execute(steps.get('commit_retry'));
    query(steps.get('check'));
    console.log(`PASS: ${filename} (real lock wait, result, row/key/audit uniqueness)`);
  } finally {
    writer.close();
    await pendingRetry?.catch(() => {});
    retry.close();
  }
}
