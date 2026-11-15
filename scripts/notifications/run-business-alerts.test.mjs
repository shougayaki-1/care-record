import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'business-alerts-test-'));
  const marker = join(dir, 'called');
  const fake = join(dir, 'psql');
  writeFileSync(fake, '#!/bin/sh\nprintf called > "$ALERT_TEST_MARKER"\nprintf "2\\n"\n');
  chmodSync(fake, 0o755);
  return { marker, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ALERT_TEST_MARKER: marker,
    BUSINESS_ALERT_DATABASE_URL: 'postgresql://alert_user:synthetic-password@example.invalid/postgres?sslmode=verify-full',
    BUSINESS_ALERT_EXPECTED_HOST: 'example.invalid', BUSINESS_ALERT_EXPECTED_USER: 'alert_user' } };
}
test('dispatches via pinned host and role without printing credentials', () => {
  const { marker, env } = fixture();
  const result = spawnSync('bash', ['scripts/notifications/run-business-alerts.sh'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(marker, 'utf8'), 'called');
  assert.match(result.stdout, /2 notifications/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-password/);
});
test('rejects host, username and TLS mismatches before connecting', () => {
  for (const [key, value] of [['BUSINESS_ALERT_EXPECTED_HOST', 'other.invalid'], ['BUSINESS_ALERT_EXPECTED_USER', 'other'], ['BUSINESS_ALERT_DATABASE_URL', 'postgresql://alert_user:synthetic-password@example.invalid/postgres?sslmode=require']]) {
    const { marker, env } = fixture(); env[key] = value;
    const result = spawnSync('bash', ['scripts/notifications/run-business-alerts.sh'], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-password/);
  }
});
