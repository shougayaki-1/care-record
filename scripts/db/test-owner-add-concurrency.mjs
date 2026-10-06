// Destructive fixtures are allowed ONLY in a dedicated disposable local stack.
// Run before destroying/resetting that stack; never against the development DB.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const container = process.argv[2];
if (!/^supabase_db_care-record-(?:owner-add|issues-84-85)-test(?:-[a-z0-9]+)?$/.test(container ?? '')) {
  throw new Error('Pass a dedicated disposable supabase_db_care-record-owner-add-test container.');
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'];
function sql(command) {
  const result = spawnSync('docker', args, { input: command, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Local fixture query failed');
  return result.stdout.trim();
}
const org = '85cc0000-0000-0000-0000-00000000000a';
const user = n => `85cc0000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = n => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: user(n), role: 'authenticated', session_id: `owner85-concurrent-${n}` })}',true);`;
const add = (n, proof) => `SELECT public.add_organization_owner_atomic('${org}','${user(n)}','${proof}');`;
const remove = n => `SELECT public.account_remove('${org}','${user(n)}','active');`;
const leave = `SELECT public.leave_organization_atomic('${org}');`;

sql(`BEGIN;
  INSERT INTO public.organizations(id,name) VALUES('${org}','Concurrency fixture');
  ${[1, 2, 3, 4].map(n => `
    INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      VALUES('${user(n)}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner85-concurrent-${n}@example.invalid','x',now(),now(),now());
    INSERT INTO public.profiles(id,name) VALUES('${user(n)}','Concurrency fixture ${n}') ON CONFLICT(id) DO NOTHING;
    INSERT INTO public.organization_members(organization_id,user_id,role) VALUES('${org}','${user(n)}','${n === 1 ? 'owner' : 'member'}');
    INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
      VALUES('owner85-concurrent-hash-${n}','owner85-concurrent-${n}','${user(n)}',now(),now()+interval '1 hour');
  `).join('')}
  ${['first', 'duplicate', 'removed-target', 'removed-actor', 'add-before-remove', 'revoked-while-waiting'].map(proof => `
    INSERT INTO public.reauth_grants(token_hash,user_id,auth_session_id,purpose,expires_at)
      VALUES(encode(extensions.digest('${proof}','sha256'),'hex'),'${user(proof === 'removed-actor' ? 2 : 1)}','owner85-concurrent-${proof === 'removed-actor' ? 2 : 1}','owner_add',now()+interval '10 minutes');
  `).join('')}
COMMIT;`);

async function race(firstActor, firstCommand, secondActor, secondCommand, expectedError) {
  const first = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let firstOutput = ''; let firstErrors = '';
  first.stderr.on('data', chunk => { firstErrors += chunk; });
  const firstExit = new Promise(resolve => first.on('close', code => resolve(code)));
  const held = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('First transaction did not acquire its lock')), 10_000);
    first.stdout.on('data', chunk => {
      firstOutput += chunk;
      if (firstOutput.includes('OWNER85_HELD')) { clearTimeout(timer); resolve(); }
    });
    first.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(firstErrors)); });
  });
  first.stdin.write(`BEGIN; ${actor(firstActor)} ${firstCommand} SELECT 'OWNER85_HELD';\n`);
  let second;
  try {
    await held;
    second = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let secondErrors = '';
    second.stderr.on('data', chunk => { secondErrors += chunk; }); second.stdout.resume();
    const secondExit = new Promise(resolve => second.on('close', code => resolve(code)));
    second.stdin.end(`SET application_name='owner85-lock-wait'; BEGIN; ${actor(secondActor)} ${secondCommand} COMMIT;`);
    const deadline = Date.now() + 10_000;
    while (sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='owner85-lock-wait' AND wait_event_type='Lock';") !== '1') {
      if (Date.now() > deadline) throw new Error('Second transaction did not wait on the organization lock');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    first.stdin.end('COMMIT;\n');
    assert.equal(await firstExit, 0, firstErrors);
    const code = await secondExit;
    if (expectedError) { assert.notEqual(code, 0); assert.ok(secondErrors.includes(expectedError), secondErrors); }
    else assert.equal(code, 0, secondErrors);
  } finally {
    first.stdin.end(); first.kill(); second?.kill();
  }
}

await race(1, add(2, 'first'), 1, add(2, 'duplicate'), 'invalid_owner_add_target');
assert.equal(sql(`SELECT count(*) FROM public.organization_members WHERE organization_id='${org}' AND role='owner';`), '2');
assert.equal(sql(`SELECT count(*) FROM public.audit_events WHERE organization_id='${org}' AND action_type='organization.owner_add';`), '1');
assert.equal(sql("SELECT used_at IS NULL FROM public.reauth_grants WHERE token_hash=encode(extensions.digest('duplicate','sha256'),'hex');"), 't');
console.log('PASS: parallel duplicate addition produces one promotion and one audit');

await race(1, remove(3), 1, add(3, 'removed-target'), 'invalid_owner_add_target');
console.log('PASS: removal wins before addition, leaving no promoted detached member');
sql(`INSERT INTO public.organization_members(organization_id,user_id,role) VALUES('${org}','${user(3)}','member');`);
await race(1, add(3, 'add-before-remove'), 1, remove(3));
console.log('PASS: addition wins before removal, which rechecks the owner target');

await race(1, `RESET ROLE; SELECT id FROM public.organizations WHERE id='${org}' FOR UPDATE;
  UPDATE public.user_session_activity SET revoked_at=now() WHERE user_id='${user(1)}';`,
  1, add(4, 'revoked-while-waiting'), 'authentication_required');
assert.equal(sql(`SELECT role FROM public.organization_members WHERE organization_id='${org}' AND user_id='${user(4)}';`), 'member');
sql(`UPDATE public.user_session_activity SET revoked_at=NULL WHERE user_id='${user(1)}';`);
console.log('PASS: a session revoked while the RPC waits cannot add an owner');

await race(1, remove(2), 2, add(4, 'removed-actor'), 'owner_required');
assert.equal(sql(`SELECT role FROM public.organization_members WHERE organization_id='${org}' AND user_id='${user(4)}';`), 'member');
console.log('PASS: removed caller cannot add an owner after waiting on the lock');
sql(`INSERT INTO public.organization_members(organization_id,user_id,role) VALUES('${org}','${user(2)}','owner');`);
await race(1, leave, 2, leave, 'sole_owner');
assert.equal(sql(`SELECT count(*) FROM public.organization_members WHERE organization_id='${org}' AND role='owner';`), '1');
console.log('PASS: simultaneous owner withdrawals retain the last owner');
