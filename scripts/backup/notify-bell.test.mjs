import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('full backup bell adapter accepts only a numeric run, uses a fixed query, and preserves failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-bell-test-'));
  try {
    writeFileSync(join(dir, 'psql'), '#!/bin/sh\ncat > "$BELL_TEST_SQL"\nprintf "%s\\n" "$@" > "$BELL_TEST_ARGS"\necho "fixture credential error" >&2\nexit 1\n', { mode: 0o755 });
    const env = {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, DATABASE_URL: 'postgresql://fixture.invalid',
      GITHUB_RUN_ID: '123456', BELL_TEST_SQL: join(dir, 'sql'), BELL_TEST_ARGS: join(dir, 'args'),
    };
    const result = spawnSync('bash', ['scripts/backup/notify-bell.sh'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(readFileSync(env.BELL_TEST_SQL, 'utf8'), "SELECT private.notify_full_backup_failure(:'backup_run_id');\n");
    assert.match(readFileSync(env.BELL_TEST_ARGS, 'utf8'), /--set=backup_run_id=123456/);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'notification_creation_failed: backup.failed\n');
    rmSync(env.BELL_TEST_SQL);
    for (const runId of ['', "123'; DROP TABLE notifications; --", 'sensitive fixture']) {
      const invalid = spawnSync('bash', ['scripts/backup/notify-bell.sh'], { env: { ...env, GITHUB_RUN_ID: runId }, encoding: 'utf8' });
      assert.equal(invalid.status, 0);
      assert.equal(invalid.stderr, 'notification_creation_failed: backup.failed\n');
    }
    assert.throws(() => readFileSync(env.BELL_TEST_SQL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('successful backup does not notify when a later receipt or artifact step fails', () => {
  const workflow = readFileSync('.github/workflows/full-backup.yml', 'utf8');
  assert.match(workflow, /name: Create permission-scoped bell notifications on failure\n\s+if: failure\(\) && steps\.backup\.outcome != 'success'\n\s+run: bash scripts\/backup\/notify-bell\.sh/);
});
