import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyStaging } from './verify-staging.mjs';

function fixture() {
  const snapshot = { observed_at: '2026-10-27T01:00:00Z', day_start: '2026-10-25T15:00:00Z', day_end: '2026-10-26T15:00:00Z', version: 0, state: {},
    metrics: { failures_5m: 0, failures_15m: 0, spray_sources_15m: 0, distributed_targets_15m: 0, success_after_failures_15m: 0,
      missing_hashes_15m: 0, attempts_15m: 0, audit_logins_15m: 0 }, daily: { failures: 0, successes: 0, missing_hashes: 0, important_events: 0 } };
  let expired = 0;
  const messages = [];
  const set = value => { snapshot.metrics.failures_5m = value; snapshot.metrics.failures_15m = value; snapshot.metrics.attempts_15m = value; snapshot.metrics.audit_logins_15m = value; };
  return { snapshot, messages, expired: () => expired,
    io: { read: async () => structuredClone(snapshot), save: async (version, state) => { assert.equal(version, snapshot.version); snapshot.state = structuredClone(state); return ++snapshot.version; },
      insert: async () => set(20), expire: async () => { set(0); expired++; }, notify: async p => messages.push(p),
      link: 'https://github.com/shougayaki-1/care-record/actions/runs/123' } };
}
test('hosted verification driver checks duplicate suppression, recovery, failed delivery outbox and reopening', async () => {
  const f = fixture(); const result = await verifyStaging(f.io);
  assert.equal(result.ok, true); assert.equal(result.failureMessages, 6); assert.equal(result.outboxRetry, true);
  assert.ok(f.expired() >= 3);
  assert.ok(f.messages.every(m => m.content.startsWith('[SYNTHETIC TEST]') && m.content.includes('staging')));
  assert.equal(f.snapshot.state.alerts.failures_5m.active, false);
  assert.equal(f.snapshot.state.alerts.failures_5m.pending, undefined);
});
test('existing traffic or active incidents refuse fixture writes; delivery failure still ages this run fixture', async () => {
  const busy = fixture(); busy.snapshot.metrics.failures_5m = 1;
  await assert.rejects(verifyStaging(busy.io)); assert.equal(busy.expired(), 0);
  const incident = fixture(); incident.snapshot.state.alerts = { failures_5m: { active: true } };
  await assert.rejects(verifyStaging(incident.io)); assert.equal(incident.expired(), 0);
  const failed = fixture(); failed.io.notify = async () => { throw Error('PRIVATE'); };
  await assert.rejects(verifyStaging(failed.io)); assert.equal(failed.expired(), 1);
  assert.ok(failed.snapshot.state.alerts.failures_5m.pending);
});
test('CLI rejects Production before database/API access and never logs credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/security/verify-staging.mjs'], { encoding: 'utf8',
    env: { APP_ENV: 'production', PGPASSWORD: 'PRIVATE', SUPABASE_ACCESS_TOKEN: 'PRIVATE' } });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'staging_security_verification_failed');
});
