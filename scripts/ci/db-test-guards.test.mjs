import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('destructive concurrency fixtures refuse development and unrelated containers', () => {
  for (const script of ['test-owner-add-concurrency.mjs', 'test-internal-work-concurrency.mjs', 'check-upgrade-fixture.mjs', 'test-audit-v2-concurrency.mjs']) {
    for (const container of [undefined, 'supabase_db_care-record', 'supabase_db_production', 'supabase_db_care-record-owner-add-test-bad;name']) {
      const result = spawnSync(process.execPath, [`scripts/db/${script}`, ...(container ? [container] : [])], {
        encoding: 'utf8',
        // An invalid container must fail at the guard before looking for Docker.
        env: { PATH: '/nonexistent' },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /dedicated disposable/);
      assert.doesNotMatch(result.stderr, /ENOENT/);
    }
  }
});
