import assert from 'node:assert/strict';
import test from 'node:test';
import { retentionPlan } from './retention-plan.mjs';

const buckets = { recent: 'fixture-recent', daily: 'fixture-daily', weekly: 'fixture-weekly', monthly: 'fixture-monthly' };
const input = { environment: 'production', generation: '20261007T001700Z', scheduled: true, buckets };
const plan = at => retentionPlan({ ...input, at });

test('both 12-hour runs select one deterministic daily representative', () => {
  const morning = plan('2026-10-07T00:17:00Z');
  const evening = plan('2026-10-07T12:17:00Z');
  assert.deepEqual(morning.map(p => p.tier), ['recent', 'daily']);
  assert.equal(morning[1].uri, evening[1].uri);
  assert.match(morning[1].uri, /daily\/2026\/10\/07\/care-record-production-2026-10-07.tar.gz$/);
});

test('Sunday and first-of-month select reproducible representatives, including overlaps', () => {
  assert.deepEqual(plan('2026-10-04T00:17:00Z').map(p => p.tier), ['recent', 'daily', 'weekly']);
  assert.deepEqual(plan('2026-10-01T12:17:00Z').map(p => p.tier), ['recent', 'daily', 'monthly']);
  assert.deepEqual(plan('2026-11-01T00:17:00Z').map(p => p.tier), ['recent', 'daily', 'weekly', 'monthly']);
});

test('calendar boundaries use JST, including midnight, month, year and leap day', () => {
  assert.deepEqual(plan('2026-10-31T14:59:59Z').map(p => p.tier), ['recent', 'daily']);
  assert.deepEqual(plan('2026-10-31T15:00:00Z').map(p => p.tier), ['recent', 'daily', 'weekly', 'monthly']);
  assert.match(plan('2026-12-31T15:00:00Z')[1].uri, /2027\/01\/01/);
  assert.match(plan('2028-02-29T00:17:00Z')[1].uri, /2028\/02\/29/);
  assert.deepEqual(plan('2028-02-29T15:00:00Z').map(p => p.tier), ['recent', 'daily', 'monthly']);
});

test('manual generations remain recent-only and never replace scheduled representatives', () => {
  const manual = retentionPlan({ ...input, at: '2026-11-01T12:17:00Z', scheduled: false });
  assert.deepEqual(manual.map(p => p.tier), ['recent']);
  assert.match(manual[0].uri, /20261007T001700Z.tar.gz$/);
});

test('reject partial or unsafe configuration, even on a manual non-representative date', () => {
  const valid = { ...input, at: '2026-10-07T00:17:00Z', scheduled: false };
  for (const invalid of [
    { environment: '../staging' }, { at: 'invalid' }, { generation: '../unsafe' },
    { buckets: { ...buckets, monthly: '' } }, { buckets: { ...buckets, weekly: 'replace-example' } },
    { buckets: { ...buckets, daily: buckets.recent } }, { buckets: { ...buckets, daily: 'bad\nbucket' } },
  ]) assert.throws(() => retentionPlan({ ...valid, ...invalid }));
});
